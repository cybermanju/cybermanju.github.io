// CyberManju OS — Workflow service (src/automation/service.ts).
// Role: Canonical editor preflight and saved-workflow execution facade.
// Exports: WorkflowService, validation issues, service options and run results.
// Integrates: WorkflowRepository, ActionRegistry and unchanged WorkflowRunner.
// Contracts: Explicit run/revision; host authorization; no resume, retries or persisted outputs.
import { copyJson, identifier, LIMITS, outputReference, record, validateWorkflow, type Json, type Workflow } from './schema'
import { WorkflowRunner, type ActionRegistry, type RunnerOptions, type RunResult } from './runner'
import { AutomationRepositoryError, WorkflowRepository, type PendingRun, type AcknowledgePendingRunOptions } from './repository'

export interface WorkflowValidationIssue {
  code: 'invalid_workflow' | 'plaintext_secret' | 'cyclic_workflow' | 'unreachable_node' |
    'unregistered_action' | 'invalid_input' | 'binding_not_available' | 'input_deferred'
  severity: 'error' | 'info'
  nodeId?: string
}
export type WorkflowValidation =
  | { valid: true; workflow: Workflow; issues: WorkflowValidationIssue[] }
  | { valid: false; issues: WorkflowValidationIssue[] }
export interface WorkflowServiceOptions extends Omit<RunnerOptions, 'journal'> {
  repository: WorkflowRepository
  /** Defaults to repository.executionJournal. Native hosts may supply their stronger durable journal. */
  journal?: RunnerOptions['journal']
}
export interface ExecuteWorkflowOptions {
  runId: string
  expectedWorkflowRevision: number
  signal?: AbortSignal
}
export type WorkflowServiceRunResult = RunResult | {
  status: 'rejected'
  code: 'not_found' | 'revision_conflict' | 'invalid_run' | 'validation_failed' | 'run_conflict' | 'storage_unavailable' | 'pending_run'
  issues?: WorkflowValidationIssue[]
}
function references(value: Json, result = new Set<string>()): Set<string> {
  if (outputReference(value)) result.add(value.$output.nodeId)
  else if (Array.isArray(value)) value.forEach(v => references(v, result))
  else if (record(value)) Object.values(value).forEach(v => references(v as Json, result))
  return result
}

/** No network, policy prompts, native calls, secret resolution or claims during validation. */
export class WorkflowService {
  private readonly repository: WorkflowRepository
  private readonly registry: ActionRegistry
  private readonly runner: WorkflowRunner
  constructor(options: WorkflowServiceOptions) {
    this.repository = options.repository
    this.registry = options.registry
    this.runner = new WorkflowRunner({ ...options, journal: options.journal ?? options.repository.executionJournal })
  }
  listActions(): ReturnType<ActionRegistry['list']> { return this.registry.list() }
  /** Durable metadata only; persisted running is conservatively exposed as unknown/interrupted. */
  async getPendingRun(workflowId: string): Promise<PendingRun | null> {
    try { return await this.repository.getPendingRun(workflowId) }
    catch (error) {
      throw error instanceof AutomationRepositoryError ? error : new Error('storage_unavailable')
    }
  }
  /** Exact-key ACK only, never retry/resume. Unknown/interrupted requires acceptUncertain === true.
   * May throw AutomationRepositoryError (run_conflict, uncertain_run, invalid_id, invalid_run,
   * corrupt_record) or a safe storage error. Repeated ACK is a run_conflict, not a wildcard clear.
   */
  async acknowledgePendingRun(workflowId: string, runId: string, options?: AcknowledgePendingRunOptions): Promise<void> {
    try { await this.repository.acknowledgePendingRun(workflowId, runId, options) }
    catch (error) {
      throw error instanceof AutomationRepositoryError ? error : new Error('storage_unavailable')
    }
  }
  validate(value: unknown): WorkflowValidation {
    let workflow: Workflow
    try { workflow = validateWorkflow(value) }
    catch (error) {
      const known = ['plaintext_secret', 'cyclic_workflow', 'unreachable_node'] as const
      const code = error instanceof Error && known.some(c => c === error.message)
        ? error.message as typeof known[number] : 'invalid_workflow'
      return { valid: false, issues: [{ code, severity: 'error' }] }
    }
    const issues: WorkflowValidationIssue[] = []
    // Definite-output analysis: intersection across predecessors, not merely graph reachability.
    const incoming = new Map<string, Set<string>[]>()
    const nodes = new Map(workflow.nodes.map(n => [n.id, n]))
    const indegree = new Map(workflow.nodes.map(n => [n.id, 0]))
    const nextIds = (n: Workflow['nodes'][number]): string[] => n.type === 'action' ? [n.next] :
      n.type === 'condition' ? [...new Set([n.trueNext, n.falseNext])] : []
    for (const n of workflow.nodes) for (const target of nextIds(n)) indegree.set(target, indegree.get(target)! + 1)
    const queue = [workflow.entryNodeId]
    while (queue.length) {
      const id = queue.shift()!, node = nodes.get(id)!
      const paths = incoming.get(id) ?? []
      const available = new Set(paths[0] ?? [])
      for (const path of paths.slice(1)) for (const output of available) if (!path.has(output)) available.delete(output)
      const checkedValue = node.type === 'action' ? node.input : node.type === 'condition' ? node.predicate as unknown as Json : null
      for (const ref of references(checkedValue)) {
        // exists deliberately permits missing output; predicates retain runtime missing-value semantics.
        if (!available.has(ref) && node.type === 'action') issues.push({ code: 'binding_not_available', severity: 'error', nodeId: id })
      }
      if (node.type === 'action') {
        const definition = this.registry.get(node.actionId)
        if (!definition) issues.push({ code: 'unregistered_action', severity: 'error', nodeId: id })
        else if (references(node.input).size) issues.push({ code: 'input_deferred', severity: 'info', nodeId: id })
        else {
          try {
            const input = copyJson(node.input, LIMITS.outputBytes, true)
            if (definition.validateInput(input) !== true) throw new Error()
          } catch { issues.push({ code: 'invalid_input', severity: 'error', nodeId: id }) }
        }
        available.add(id)
      }
      for (const target of nextIds(node)) {
        const paths = incoming.get(target) ?? []
        paths.push(new Set(available)); incoming.set(target, paths)
        indegree.set(target, indegree.get(target)! - 1)
        if (indegree.get(target) === 0) queue.push(target)
      }
    }
    return issues.some(i => i.severity === 'error') ? { valid: false, issues } : { valid: true, workflow, issues }
  }
  /** Executes the captured saved revision, never an unsaved editor object. Throws no raw storage errors. */
  async run(id: string, options: ExecuteWorkflowOptions): Promise<WorkflowServiceRunResult> {
    if (!identifier(id) || !options || !identifier(options.runId) ||
      !Number.isSafeInteger(options.expectedWorkflowRevision) || options.expectedWorkflowRevision < 1) {
      return { status: 'rejected', code: 'invalid_run' }
    }
    const run = { ...options }
    if (run.signal?.aborted) return { status: 'failed', code: 'cancelled', steps: 0 }
    try {
      const saved = await this.repository.get(id)
      if (!saved) return { status: 'rejected', code: 'not_found' }
      if (await this.repository.getPendingRun(id)) return { status: 'rejected', code: 'pending_run' }
      if (saved.workflow.revision !== run.expectedWorkflowRevision) return { status: 'rejected', code: 'revision_conflict' }
      const validation = this.validate(saved.workflow)
      if (!validation.valid) return { status: 'rejected', code: 'validation_failed', issues: validation.issues }
      if (run.signal?.aborted) return { status: 'failed', code: 'cancelled', steps: 0 }
      // Claim and saved-revision comparison share one transaction. Never dispatch on claim failure.
      await this.repository.claimRun(validation.workflow, run.runId)
      await this.repository.bindRun(validation.workflow, run.runId)
      const result = await this.runner.run(validation.workflow, run)
      try { await this.repository.finishRun(id, run.runId, result) }
      catch { /* Keep the durable running claim uncertain. Outputs remain transient, never persisted. */ }
      return result
    } catch (error) {
      const code = error instanceof AutomationRepositoryError ? error.code : undefined
      return { status: 'rejected', code: code === 'run_conflict' || code === 'pending_run' || code === 'revision_conflict'
        ? code : code === 'not_found' || code === 'deleted_workflow' ? 'not_found' : 'storage_unavailable' }
    }
  }
}
