// CyberManju OS — Automation result validation (src/automation/result.ts).
// Role: Validate exact discriminated results at runner and native bridge boundaries.
// Exports: normalizeActionResult.
// Integrates: Generic adapters and correlation-checked native responses.
// Contracts: Bounded detached JSON; opaque job IDs, short error codes; no inferred success.
import { copyJson, identifier, LIMITS, record, type ActionResult, type Json } from './schema'

function opaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}
/** Throws on malformed results; the runner maps post-dispatch exceptions to unknown. */
export function normalizeActionResult(value: unknown, key: string): ActionResult {
  const v = copyJson(value, LIMITS.outputBytes, true)
  if (!record(v)) throw new Error('invalid_result')
  const only = (names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(v, k))
  switch (v.status) {
    case 'succeeded': if (only(['status', 'output'])) return { status: 'succeeded', output: v.output as Json }; break
    case 'accepted': if (only(['status', 'jobId']) && opaqueId(v.jobId)) return { status: 'accepted', jobId: v.jobId }; break
    case 'needs_confirmation':
      if (only(['status', 'confirmationId', 'summary', 'expiresAt']) && opaqueId(v.confirmationId) && typeof v.summary === 'string' && v.summary.length <= 1024 &&
        typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt)) && Date.parse(v.expiresAt) > Date.now())
        return { status: 'needs_confirmation', confirmationId: v.confirmationId, summary: v.summary, expiresAt: v.expiresAt }
      break
    case 'denied': if (only(['status', 'code']) && identifier(v.code)) return { status: 'denied', code: v.code }; break
    case 'failed': if (only(['status', 'code', 'retryable']) && identifier(v.code) && typeof v.retryable === 'boolean') return { status: 'failed', code: v.code, retryable: v.retryable }; break
    case 'unknown': if (only(['status', 'idempotencyKey']) && v.idempotencyKey === key) return { status: 'unknown', idempotencyKey: key }; break
  }
  throw new Error('invalid_result')
}
