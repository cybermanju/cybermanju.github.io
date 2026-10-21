// CyberManju OS — Automation runner (src/automation/runner.ts).
// Role: Allowlisted, permission-gated, bounded execution of versioned workflows.
// Exports: ActionRegistry, WorkflowRunner, ExecutionJournal, MemoryExecutionJournal.
// Integrates: NativeActionRequest bridge, constrained scripts, HTTP and agent adapters.
// Contracts: No retries/eval/shell; claim before dispatch; ambiguous effects return unknown.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted
// Logging policy: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
import {
  copyJson, evaluatePredicate, identifier, LIMITS, resolveValue, validateWorkflow,
  type ActionResult, type Json, type NativeActionRequest,
} from './schema'
import { normalizeActionResult } from './result'

export interface ActionDefinition {
  id: string
  effect: 'read' | 'write'
  validateInput: (input: Json) => boolean
  execute: (request: NativeActionRequest, signal: AbortSignal) => Promise<ActionResult>
}
export class ActionRegistry {
  private readonly actions = new Map<string, Readonly<ActionDefinition>>()
  register(definition: ActionDefinition): this {
    if (!identifier(definition.id) || this.actions.has(definition.id) ||
      !['read', 'write'].includes(definition.effect) || typeof definition.validateInput !== 'function' || typeof definition.execute !== 'function') throw new Error('invalid_action_registration')
    this.actions.set(definition.id, Object.freeze({ ...definition }))
    return this
  }
  get(id: string): Readonly<ActionDefinition> | undefined { return this.actions.get(id) }
  list(): ReadonlyArray<{ id: string; effect: 'read' | 'write' }> {
    return [...this.actions.values()].map(({ id, effect }) => ({ id, effect }))
  }
}
/** Host MUST persist atomic claims before native effects; an uncertain claim is not permission to dispatch. */
export interface ExecutionJournal { claim(key: string): Promise<boolean> }
/** Session-only implementation, NOT crash-safe. Use a durable implementation for native actions. */
export class MemoryExecutionJournal implements ExecutionJournal {
  private readonly claimed = new Set<string>()
  async claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return false
    this.claimed.add(key); return true
  }
}
export interface RunnerOptions {
  registry: ActionRegistry
  journal: ExecutionJournal
  authorize: (request: NativeActionRequest, effect: 'read' | 'write', signal: AbortSignal) => Promise<'allow' | 'deny'>
  actionTimeoutMs?: number
  maxRunMs?: number
  maxSteps?: number
}
export interface RunOptions { runId: string; signal?: AbortSignal; expectedWorkflowRevision?: number }
export type RunResult =
  | { status: 'completed'; outputs: Record<string, Json>; steps: number }
  | { status: 'halted'; nodeId: string; result: ActionResult; steps: number }
  | { status: 'failed'; code: 'invalid_workflow' | 'revision_conflict' | 'invalid_run' | 'cancelled' | 'run_timeout' | 'step_limit' | 'predicate_failed'; steps: number }

function limit(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error('invalid_runner_limits')
  return value
}
/** Race protects the runner even if a trusted adapter ignores AbortSignal. It cannot undo native effects. */
async function bounded<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('interrupted')
  let cancel: () => void = () => undefined
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('interrupted'))
    signal.addEventListener('abort', cancel, { once: true })
  })
  try { return await Promise.race([Promise.resolve().then(() => {
    if (signal.aborted) throw new Error('interrupted')
    return task()
  }), interruption]) } finally { signal.removeEventListener('abort', cancel) }
}
export class WorkflowRunner {
  private readonly timeout: number
  private readonly maxRun: number
  private readonly maxSteps: number
  private readonly options: RunnerOptions
  constructor(options: RunnerOptions) {
    if (typeof options.authorize !== 'function' || !options.journal || typeof options.journal.claim !== 'function') throw new Error('missing_policy_or_journal')
    this.options = { ...options }
    this.timeout = limit(options.actionTimeoutMs, 30000, 60000)
    this.maxRun = limit(options.maxRunMs, 120000, 300000)
    this.maxSteps = limit(options.maxSteps, LIMITS.steps, LIMITS.steps)
  }
  async run(value: unknown, run: RunOptions): Promise<RunResult> {
    let workflow
    try { workflow = validateWorkflow(value) } catch { return { status: 'failed', code: 'invalid_workflow', steps: 0 } }
    // Caller mutations during authorization must not change subsequent claim keys or cleanup signal.
    if (!run) return { status: 'failed', code: 'invalid_run', steps: 0 }
    run = { ...run }
    if (!identifier(run.runId)) return { status: 'failed', code: 'invalid_run', steps: 0 }
    if (run.expectedWorkflowRevision !== undefined && workflow.revision !== run.expectedWorkflowRevision) return { status: 'failed', code: 'revision_conflict', steps: 0 }
    // Preflight the entire graph: a forbidden action on a later branch cannot follow an earlier effect.
    const actions = new Map<string, Readonly<ActionDefinition>>()
    for (const n of workflow.nodes) if (n.type === 'action') {
      const definition = this.options.registry.get(n.actionId)
      if (!definition) return { status: 'halted', nodeId: n.id, result: { status: 'denied', code: 'unregistered_action' }, steps: 0 }
      actions.set(n.id, definition)
    }
    const control = new AbortController()
    let timedOut = false
    const onAbort = () => control.abort()
    run.signal?.addEventListener('abort', onAbort, { once: true })
    if (run.signal?.aborted) control.abort()
    const timer = setTimeout(() => { timedOut = true; control.abort() }, this.maxRun)
    const outputs = new Map<string, Json>()
    const nodes = new Map(workflow.nodes.map(n => [n.id, n]))
    let nodeId = workflow.entryNodeId, steps = 0
    const halt = (result: ActionResult): RunResult => ({ status: 'halted', nodeId, result, steps })
    try {
      while (steps < this.maxSteps) {
        if (control.signal.aborted) return { status: 'failed', code: timedOut ? 'run_timeout' : 'cancelled', steps }
        const node = nodes.get(nodeId)!
        steps++
        if (node.type === 'end') return { status: 'completed', outputs: Object.fromEntries(outputs), steps }
        if (node.type === 'condition') {
          try { nodeId = evaluatePredicate(node.predicate, outputs) ? node.trueNext : node.falseNext }
          catch { return { status: 'failed', code: 'predicate_failed', steps } }
          continue
        }
        const definition = actions.get(node.id)!
        let input: Json
        try {
          const resolved = resolveValue(node.input, outputs)
          if (resolved === undefined) throw new Error('missing_output')
          input = copyJson(resolved, LIMITS.outputBytes, true)
          if (!definition.validateInput(copyJson(input))) throw new Error('invalid_input')
        } catch { return halt({ status: 'denied', code: 'invalid_input' }) }
        // runId is explicit host intent. Same logical run+revision+node always gets the same key.
        const idempotencyKey = JSON.stringify([workflow.id, workflow.revision, run.runId, node.id])
        const request: NativeActionRequest = {
          protocolVersion: 1, requestId: idempotencyKey, workflowId: workflow.id, workflowRevision: workflow.revision,
          nodeId: node.id, actionId: node.actionId, input, idempotencyKey,
          ...(node.expectedRevision === undefined ? {} : { expectedRevision: node.expectedRevision }),
        }
        const actionControl = new AbortController()
        const abortAction = () => actionControl.abort()
        control.signal.addEventListener('abort', abortAction, { once: true })
        if (control.signal.aborted) actionControl.abort()
        const actionTimer = setTimeout(abortAction, this.timeout)
        let dispatched = false
        try {
          const permission = await bounded(() => this.options.authorize(copyJson(request) as unknown as NativeActionRequest, definition.effect, actionControl.signal), actionControl.signal)
          if (permission !== 'allow') return halt({ status: 'denied', code: 'policy_denied' })
          let claimed: boolean
          try { claimed = await bounded(() => this.options.journal.claim(idempotencyKey), actionControl.signal) }
          catch { return halt({ status: 'unknown', idempotencyKey }) }
          if (claimed !== true) return halt({ status: 'unknown', idempotencyKey })
          if (actionControl.signal.aborted) return halt({ status: 'unknown', idempotencyKey })
          const raw = await bounded(() => {
            dispatched = true
            return definition.execute(copyJson(request) as unknown as NativeActionRequest, actionControl.signal)
          }, actionControl.signal)
          const result = normalizeActionResult(raw, idempotencyKey)
          if (result.status !== 'succeeded') return halt(result)
          outputs.set(node.id, result.output)
          nodeId = node.next
        } catch {
          return halt(dispatched ? { status: 'unknown', idempotencyKey } : { status: 'denied', code: 'authorization_unavailable' })
        } finally {
          clearTimeout(actionTimer)
          control.signal.removeEventListener('abort', abortAction)
        }
      }
      return { status: 'failed', code: 'step_limit', steps }
    } finally {
      clearTimeout(timer)
      run.signal?.removeEventListener('abort', onAbort)
    }
  }
}
