// CyberManju OS — Automation adapters (src/automation/actions.ts).
// Role: Bounded data scripts and opt-in bridges, without ambient host privileges.
// Exports: createAutomationRegistry, registerNativeActions, runDataScript.
// Integrates: Host-owned native dispatcher, approved cybsh command IDs and AI agents.
// Contracts: No generic shell/JS; integrations absent by default; all calls use runner policy.
import { ActionRegistry, type ActionDefinition } from './runner'
import { copyJson, identifier, LIMITS, record, type ActionResult, type Json, type NativeActionRequest, type NativeActionResponse } from './schema'
import { createHttpHandler, type HttpHandlerOptions } from './http'
import { normalizeActionResult } from './result'

export type ActionBridge = (request: NativeActionRequest, signal: AbortSignal) => Promise<ActionResult>
export type NativeActionBridge = (request: NativeActionRequest, signal: AbortSignal) => Promise<NativeActionResponse>
export interface NativeActionSpec { id: string; effect: 'read' | 'write'; validateInput: (input: Json) => boolean }
const correlationFields = ['protocolVersion', 'requestId', 'workflowId', 'workflowRevision', 'nodeId', 'actionId', 'idempotencyKey'] as const
/** Register only capability IDs actually implemented by the native host; never wildcard arbitrary intents. */
export function registerNativeActions(registry: ActionRegistry, specs: readonly NativeActionSpec[], bridge: NativeActionBridge): void {
  if (typeof bridge !== 'function') throw new Error('invalid_bridge')
  for (const spec of specs) registry.register({ ...spec, async execute(request, signal) {
    // The bridge gets a separate snapshot: even a mutating host cannot rewrite expected echoes.
    const raw = await bridge(copyJson(request) as unknown as NativeActionRequest, signal)
    const response = copyJson(raw, LIMITS.outputBytes)
    if (!record(response) || !correlationFields.every(field =>
      Object.prototype.hasOwnProperty.call(response, field) && response[field] === request[field])) throw new Error('invalid_native_response')
    const result: Record<string, unknown> = Object.create(null)
    for (const [field, value] of Object.entries(response)) {
      // unknown shares idempotencyKey with the envelope; its generic result still needs it.
      if (!correlationFields.some(key => key === field) || (field === 'idempotencyKey' && response.status === 'unknown')) result[field] = value
    }
    return normalizeActionResult(result, request.idempotencyKey)
  } })
}
export interface IntegrationOptions {
  http?: HttpHandlerOptions
  cybsh?: { commandIds: readonly string[]; execute: ActionBridge }
  ai?: { agentIds: readonly string[]; execute: ActionBridge }
}
function exact(v: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k))
}
function scalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
}
const scriptOps = new Set(['text.concat', 'text.upper', 'text.lower', 'text.trim', 'math.add', 'math.subtract', 'math.multiply', 'math.divide', 'json.parse', 'json.stringify', 'value'])
function scriptInput(input: Json): boolean {
  if (!record(input) || !exact(input, ['steps']) || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 32) return false
  return input.steps.every(step => record(step) && exact(step, ['id', 'op', 'args']) && identifier(step.id) &&
    typeof step.op === 'string' && scriptOps.has(step.op) && Array.isArray(step.args) && step.args.length <= 32 &&
    step.args.every(arg => scalar(arg) || (record(arg) && exact(arg, ['from']) && identifier(arg.from))))
}
/** A script is a bounded data pipeline, not source code. References can only point backward. */
export function runDataScript(input: Json): Json {
  input = copyJson(input, LIMITS.outputBytes, true)
  if (!scriptInput(input)) throw new Error('invalid_script')
  const steps = (input as { steps: Array<{ id: string; op: string; args: Json[] }> }).steps
  const values = new Map<string, Json>()
  for (const step of steps) {
    if (values.has(step.id)) throw new Error('invalid_script')
    const args = step.args.map(arg => {
      if (record(arg)) {
        if (!values.has(arg.from as string)) throw new Error('invalid_script')
        return values.get(arg.from as string)!
      }
      return arg
    })
    let result: Json
    if (step.op === 'value') {
      if (args.length !== 1) throw new Error('invalid_script')
      result = args[0]
    } else if (step.op === 'text.concat') {
      if (!args.every(v => typeof v === 'string')) throw new Error('invalid_script')
      result = (args as string[]).join('')
    } else if (step.op.startsWith('text.')) {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('invalid_script')
      result = step.op === 'text.upper' ? args[0].toUpperCase() : step.op === 'text.lower' ? args[0].toLowerCase() : args[0].trim()
    } else if (step.op.startsWith('math.')) {
      if (args.length !== 2 || !args.every(v => typeof v === 'number')) throw new Error('invalid_script')
      const [a, b] = args as number[]
      result = step.op === 'math.add' ? a + b : step.op === 'math.subtract' ? a - b : step.op === 'math.multiply' ? a * b : a / b
      if (!Number.isFinite(result)) throw new Error('invalid_script')
    } else if (step.op === 'json.parse') {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('invalid_script')
      result = copyJson(JSON.parse(args[0]), 65536, true)
    } else {
      if (args.length !== 1) throw new Error('invalid_script')
      result = JSON.stringify(args[0])
    }
    values.set(step.id, copyJson(result, 65536, true))
    // Cap total intermediate storage, not just each operation.
    copyJson(Object.fromEntries(values), 65536, true)
  }
  return copyJson({ values: Object.fromEntries(values), last: values.get(steps[steps.length - 1].id)! }, LIMITS.outputBytes, true)
}
export function createAutomationRegistry(options: IntegrationOptions = {}): ActionRegistry {
  const registry = new ActionRegistry()
  registry.register({
    id: 'core.script', effect: 'read', validateInput: scriptInput,
    async execute(request) {
      try { return { status: 'succeeded', output: runDataScript(request.input) } }
      catch { return { status: 'failed', code: 'invalid_script', retryable: false } }
    },
  })
  if (options.http) {
    const http = createHttpHandler(options.http)
    registry.register({
      id: 'core.http', effect: 'write', validateInput: input => record(input),
      async execute(request, signal) {
        // Errors after network dispatch can represent an already-applied effect. Let runner return unknown.
        const output = await http(request.input, signal)
        return { status: 'succeeded', output: output as unknown as Json }
      },
    })
  }
  if (options.cybsh) {
    const commands = new Set(options.cybsh.commandIds)
    if (![...commands].every(identifier) || typeof options.cybsh.execute !== 'function') throw new Error('invalid_cybsh_adapter')
    registry.register({
      id: 'core.cybsh', effect: 'write', execute: options.cybsh.execute,
      validateInput: input => record(input) && exact(input, ['commandId', 'args']) && typeof input.commandId === 'string' &&
        commands.has(input.commandId) && Array.isArray(input.args) && input.args.length <= 32 && input.args.every(s => typeof s === 'string' && s.length <= 4096 && !s.includes('\0')),
    })
  }
  if (options.ai) {
    const agents = new Set(options.ai.agentIds)
    if (![...agents].every(identifier) || typeof options.ai.execute !== 'function') throw new Error('invalid_ai_adapter')
    registry.register({
      id: 'core.ai.invoke', effect: 'write', execute: options.ai.execute,
      validateInput: input => record(input) && exact(input, ['agentId', 'prompt', 'context']) && typeof input.agentId === 'string' &&
        agents.has(input.agentId) && typeof input.prompt === 'string' && input.prompt.length > 0 && input.prompt.length <= 16384,
    })
  }
  return registry
}
