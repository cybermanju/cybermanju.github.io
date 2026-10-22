// CyberManju OS — Shortcut action authorization (src/utils/shortcutAuthorization.ts).
// Role: Validate detached host authorization requests without resolving bindings or vault values.
// Exports: AuthorizationRequest, AuthorizationDecision, timeout and bounded request parser.
// Integrates: ShortcutsPanel props/events and public automation JSON validation.
// Contracts: Only resolved JSON with literal secret refs; no runtime, storage, dispatch or logging.
import { copyJson, identifier, LIMITS, record, type Json } from '@/automation'

export interface AuthorizationRequest {
  requestId: string
  workflowId: string
  workflowRevision: number
  nodeId: string
  actionId: string
  input: Json
}
export interface AuthorizationDecision { requestId: string; decision: 'allow' | 'deny' }
export const AUTHORIZATION_TIMEOUT_MS = 60_000

/** Reject rather than redact: the displayed input must equal the host's exact JSON. */
export function parseAuthorizationRequest(value: unknown): AuthorizationRequest {
  const request = copyJson(value, LIMITS.jsonBytes, true)
  if (!record(request) || Object.keys(request).sort().join(',') !== 'actionId,input,nodeId,requestId,workflowId,workflowRevision' ||
    typeof request.requestId !== 'string' || request.requestId.length > 512 ||
    !identifier(request.workflowId) || !identifier(request.nodeId) || !identifier(request.actionId) ||
    !Number.isSafeInteger(request.workflowRevision) || (request.workflowRevision as number) < 1) throw new Error('invalid_authorization')
  // Runner requestId === idempotencyKey: accept only its canonical correlation tuple.
  let correlation: unknown
  try { correlation = JSON.parse(request.requestId) } catch { throw new Error('invalid_authorization') }
  if (!Array.isArray(correlation) || correlation.length !== 4 ||
    !identifier(correlation[0]) || !Number.isSafeInteger(correlation[1]) || correlation[1] < 1 ||
    !identifier(correlation[2]) || !identifier(correlation[3]) ||
    correlation[0] !== request.workflowId || correlation[1] !== request.workflowRevision || correlation[3] !== request.nodeId ||
    JSON.stringify(correlation) !== request.requestId) throw new Error('invalid_authorization')
  function resolved(input: Json): boolean {
    if (Array.isArray(input)) return input.every(resolved)
    if (record(input)) return !Object.prototype.hasOwnProperty.call(input, '$output') && Object.values(input).every(item => resolved(item as Json))
    return true
  }
  if (!resolved(request.input)) throw new Error('unresolved_authorization')
  return request as unknown as AuthorizationRequest
}
