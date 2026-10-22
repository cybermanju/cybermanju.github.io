// CyberManju OS — Automation schema (src/automation/schema.ts).
// Role: Versioned declarative DAG and defensive JSON validation.
// Exports: Workflow, native protocol, predicates, validation and data helpers.
// Integrates: TypeScript runner and host-owned Kotlin/JNI dispatcher.
// Contracts: No eval/loops; bounded JSON; secret references, never inline credentials.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface OutputReference { $output: { nodeId: string; path: string[] } }
export type Value = Json | OutputReference
export type Predicate =
  | { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; left: Value; right: Value }
  | { op: 'exists'; value: Value }
  | { op: 'all' | 'any'; predicates: Predicate[] }
  | { op: 'not'; predicate: Predicate }
export type WorkflowNode =
  | { id: string; type: 'action'; actionId: string; input: Json; next: string; expectedRevision?: number }
  | { id: string; type: 'condition'; predicate: Predicate; trueNext: string; falseNext: string }
  | { id: string; type: 'end' }
export interface Workflow {
  schemaVersion: 1; id: string; revision: number; entryNodeId: string; nodes: WorkflowNode[]
}
export interface NativeActionRequest {
  protocolVersion: 1; requestId: string; workflowId: string; workflowRevision: number
  nodeId: string; actionId: string; input: Json; idempotencyKey: string; expectedRevision?: number
}
export type ActionResult =
  | { status: 'succeeded'; output: Json }
  | { status: 'accepted'; jobId: string }
  | { status: 'needs_confirmation'; confirmationId: string; summary: string; expiresAt: string }
  | { status: 'denied'; code: string }
  | { status: 'failed'; code: string; retryable: boolean }
  | { status: 'unknown'; idempotencyKey: string }

/** Native replies echo correlation fields exactly; generic adapters still return ActionResult. */
export type NativeActionResponse = Pick<NativeActionRequest,
  'protocolVersion' | 'requestId' | 'workflowId' | 'workflowRevision' | 'nodeId' | 'actionId' | 'idempotencyKey'> & ActionResult

export const LIMITS = Object.freeze({ nodes: 128, depth: 24, jsonBytes: 262144, outputBytes: 65536, steps: 128 })
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const credentialKey = /^(authorization|proxy-authorization|cookie|password|passwd|token|access_token|refresh_token|api[-_]?key|client_secret|private_key|secret)$/i
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
export function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
}
export function secretReference(value: unknown): value is { secretRef: string } {
  if (!record(value) || Object.keys(value).length !== 1) return false
  const descriptor = Object.getOwnPropertyDescriptor(value, 'secretRef')
  return !!descriptor && 'value' in descriptor && identifier(descriptor.value)
}
export function outputReference(value: unknown): value is OutputReference {
  return record(value) && Object.keys(value).length === 1 && record(value.$output) &&
    Object.keys(value.$output).sort().join(',') === 'nodeId,path' && identifier(value.$output.nodeId) &&
    Array.isArray(value.$output.path) && value.$output.path.length <= LIMITS.depth &&
    value.$output.path.every(p => typeof p === 'string' && p.length <= 128 && !forbidden.has(p))
}
/** Rejects accessors/prototypes/cycles/non-JSON instead of invoking serialization hooks. */
export function copyJson(value: unknown, maxBytes: number = LIMITS.jsonBytes, protectSecrets = false): Json {
  const ancestors = new Set<object>()
  let entries = 0
  let stringUnits = 0
  function copy(v: unknown, depth: number): Json {
    if (depth > LIMITS.depth || ++entries > 16384) throw new Error('invalid_json')
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'string') {
      stringUnits += v.length
      if (stringUnits > maxBytes) throw new Error('invalid_json')
      return v
    }
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (!Array.isArray(v) && !record(v)) throw new Error('invalid_json')
    if (Array.isArray(v) && (v.length > 16384 ||
      (Object.getPrototypeOf(v) !== Array.prototype && Object.getPrototypeOf(v) !== null) ||
      Object.keys(v).length !== v.length || Object.keys(v).some((key, index) => key !== String(index)))) throw new Error('invalid_json')
    if (ancestors.has(v)) throw new Error('invalid_json')
    ancestors.add(v)
    const result: Json[] | Record<string, Json> = Array.isArray(v) ? [] : Object.create(null)
    for (const key of Object.keys(v)) {
      stringUnits += key.length
      if (stringUnits > maxBytes || (Array.isArray(v) && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error('invalid_json')
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!
      if (!('value' in descriptor) || forbidden.has(key)) throw new Error('invalid_json')
      if (protectSecrets && credentialKey.test(key) && !secretReference(descriptor.value)) throw new Error('plaintext_secret')
      ;(result as Record<string, Json>)[key] = copy(descriptor.value, depth + 1)
    }
    ancestors.delete(v)
    return result
  }
  const result = copy(value, 0)
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes) throw new Error('invalid_json')
  return result
}
function keys(v: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(k => Object.prototype.hasOwnProperty.call(v, k)) &&
    Object.keys(v).every(k => required.includes(k) || optional.includes(k))
}
function validValue(v: unknown, ids: Set<string>): boolean {
  if (record(v) && '$output' in v) return outputReference(v) && ids.has(v.$output.nodeId)
  if (Array.isArray(v)) return v.every(x => validValue(x, ids))
  if (record(v)) return Object.values(v).every(x => validValue(x, ids))
  return true
}
function validPredicate(v: unknown, ids: Set<string>, depth = 0): v is Predicate {
  if (!record(v) || depth > 16) return false
  if (v.op === 'not') return keys(v, ['op', 'predicate']) && validPredicate(v.predicate, ids, depth + 1)
  if (v.op === 'all' || v.op === 'any') return keys(v, ['op', 'predicates']) && Array.isArray(v.predicates) &&
    v.predicates.length > 0 && v.predicates.length <= 32 && v.predicates.every(p => validPredicate(p, ids, depth + 1))
  if (v.op === 'exists') return keys(v, ['op', 'value']) && validValue(v.value, ids)
  return typeof v.op === 'string' && ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(v.op) &&
    keys(v, ['op', 'left', 'right']) && validValue(v.left, ids) && validValue(v.right, ids)
}
/** Returns a detached snapshot: edits during execution cannot change this run. */
export function validateWorkflow(value: unknown): Workflow {
  const v = copyJson(value, LIMITS.jsonBytes, true)
  if (!record(v) || !keys(v, ['schemaVersion', 'id', 'revision', 'entryNodeId', 'nodes']) ||
    v.schemaVersion !== 1 || !identifier(v.id) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 ||
    !identifier(v.entryNodeId) || !Array.isArray(v.nodes) || !v.nodes.length || v.nodes.length > LIMITS.nodes) throw new Error('invalid_workflow')
  const ids = new Set<string>()
  for (const node of v.nodes) {
    if (!record(node) || !identifier(node.id) || ids.has(node.id)) throw new Error('invalid_workflow')
    ids.add(node.id)
  }
  const edges = new Map<string, string[]>()
  const actionIds = new Set(v.nodes.filter(n => record(n) && n.type === 'action').map(n => (n as Record<string, Json>).id as string))
  for (const n of v.nodes) {
    if (!record(n)) throw new Error('invalid_workflow')
    let next: unknown[] = []
    if (n.type === 'action') {
      if (!keys(n, ['id', 'type', 'actionId', 'input', 'next'], ['expectedRevision']) || !identifier(n.actionId) ||
        !validValue(n.input, actionIds) || (n.expectedRevision !== undefined && (!Number.isSafeInteger(n.expectedRevision) || (n.expectedRevision as number) < 0))) throw new Error('invalid_workflow')
      next = [n.next]
    } else if (n.type === 'condition') {
      if (!keys(n, ['id', 'type', 'predicate', 'trueNext', 'falseNext']) || !validPredicate(n.predicate, actionIds)) throw new Error('invalid_workflow')
      next = [n.trueNext, n.falseNext]
    } else if (n.type !== 'end' || !keys(n, ['id', 'type'])) throw new Error('invalid_workflow')
    if (!next.every(id => typeof id === 'string' && ids.has(id))) throw new Error('invalid_workflow')
    edges.set(n.id as string, next as string[])
  }
  const active = new Set<string>(), visited = new Set<string>()
  function visit(id: string) {
    if (active.has(id)) throw new Error('cyclic_workflow')
    if (visited.has(id)) return
    active.add(id)
    for (const next of edges.get(id) ?? []) visit(next)
    active.delete(id); visited.add(id)
  }
  if (!ids.has(v.entryNodeId)) throw new Error('invalid_workflow')
  visit(v.entryNodeId)
  if (visited.size !== ids.size) throw new Error('unreachable_node')
  return v as unknown as Workflow
}

/** Bind only own JSON properties. Missing branch outputs fail closed except exists. */
export function resolveValue(value: unknown, outputs: ReadonlyMap<string, Json>): Json | undefined {
  if (outputReference(value)) {
    let current: Json | undefined = outputs.get(value.$output.nodeId)
    for (const key of value.$output.path) {
      if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) return undefined
      current = (current as Record<string, Json>)[key]
    }
    return current
  }
  if (Array.isArray(value)) return value.map(v => {
    const resolved = resolveValue(v, outputs)
    if (resolved === undefined) throw new Error('missing_output')
    return resolved
  })
  if (record(value)) {
    const result: Record<string, Json> = Object.create(null)
    for (const [key, v] of Object.entries(value)) {
      const resolved = resolveValue(v, outputs)
      if (resolved === undefined) throw new Error('missing_output')
      result[key] = resolved
    }
    return result
  }
  return value as Json
}
export function evaluatePredicate(predicate: Predicate, outputs: ReadonlyMap<string, Json>): boolean {
  if (predicate.op === 'all') return predicate.predicates.every(p => evaluatePredicate(p, outputs))
  if (predicate.op === 'any') return predicate.predicates.some(p => evaluatePredicate(p, outputs))
  if (predicate.op === 'not') return !evaluatePredicate(predicate.predicate, outputs)
  if (predicate.op === 'exists') return resolveValue(predicate.value, outputs) !== undefined
  if (!('left' in predicate)) throw new Error('invalid_predicate')
  const left = resolveValue(predicate.left, outputs), right = resolveValue(predicate.right, outputs)
  if (left === undefined || right === undefined) throw new Error('missing_output')
  const equal = (a: Json, b: Json): boolean => {
    if (a === b) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
    const ak = Object.keys(a), bk = Object.keys(b)
    return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && equal((a as Record<string, Json>)[k], (b as Record<string, Json>)[k]))
  }
  switch (predicate.op) {
    case 'eq': return equal(left, right)
    case 'ne': return !equal(left, right)
    case 'contains': return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : Array.isArray(left) && left.some(v => equal(v, right))
    case 'gt': return typeof left === 'number' && typeof right === 'number' && left > right
    case 'gte': return typeof left === 'number' && typeof right === 'number' && left >= right
    case 'lt': return typeof left === 'number' && typeof right === 'number' && left < right
    case 'lte': return typeof left === 'number' && typeof right === 'number' && left <= right
  }
}
