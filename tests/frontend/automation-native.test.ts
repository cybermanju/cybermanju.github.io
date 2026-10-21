// CyberManju OS — Native automation contract tests (tests/frontend/automation-native.test.ts).
// Role: Lock down native response correlation, validation, opaque identifiers and at-most-once dispatch.
// Exports: none.
// Integrates: Vitest, registerNativeActions, WorkflowRunner.
// Contracts: Native replies echo every request field exactly; post-dispatch uncertainty is never replayed.
import { describe, expect, it, vi } from 'vitest'
import { registerNativeActions } from '../../src/automation/actions'
import { ActionRegistry, MemoryExecutionJournal, WorkflowRunner } from '../../src/automation/runner'
import type { ActionResult, NativeActionRequest, NativeActionResponse } from '../../src/automation/schema'

const spec = [{ id: 'native.perform', effect: 'write' as const, validateInput: () => true }]
const workflow = {
  schemaVersion: 1 as const,
  id: 'workflow-one',
  revision: 7,
  entryNodeId: 'node-one',
  nodes: [{ id: 'node-one', type: 'action' as const, actionId: 'native.perform', input: { value: 1 }, next: 'done' }, { id: 'done', type: 'end' as const }],
}
const correlation = (request: NativeActionRequest) => ({
  protocolVersion: request.protocolVersion,
  requestId: request.requestId,
  workflowId: request.workflowId,
  workflowRevision: request.workflowRevision,
  nodeId: request.nodeId,
  actionId: request.actionId,
  idempotencyKey: request.idempotencyKey,
})
const envelope = (request: NativeActionRequest, result: ActionResult): NativeActionResponse => ({ ...correlation(request), ...result })

async function runWith(reply: (request: NativeActionRequest, signal: AbortSignal) => Promise<unknown> | unknown, runId = 'run-one') {
  const registry = new ActionRegistry()
  registerNativeActions(registry, spec, reply as (request: NativeActionRequest, signal: AbortSignal) => Promise<NativeActionResponse>)
  const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
  return runner.run(workflow, { runId })
}

describe('native action response contract', () => {
  it.each([
    [{ status: 'succeeded', output: { ok: true } }, { status: 'completed' }],
    [{ status: 'accepted', jobId: 'opaque:job/one' }, { status: 'halted', result: { status: 'accepted', jobId: 'opaque:job/one' } }],
    [{ status: 'needs_confirmation', confirmationId: 'opaque confirm/one', summary: 'Review', expiresAt: '2099-01-01T00:00:00Z' }, { status: 'halted', result: { status: 'needs_confirmation', confirmationId: 'opaque confirm/one', summary: 'Review', expiresAt: '2099-01-01T00:00:00Z' } }],
    [{ status: 'denied', code: 'permission_denied' }, { status: 'halted', result: { status: 'denied', code: 'permission_denied' } }],
    [{ status: 'failed', code: 'native_failure', retryable: true }, { status: 'halted', result: { status: 'failed', code: 'native_failure', retryable: true } }],
  ] as const)('maps exact status %s', async (result, expected) => {
    const output = await runWith(request => envelope(request, result as ActionResult))
    if (expected.status === 'completed') expect(output).toMatchObject({ status: 'completed', outputs: { 'node-one': { ok: true } }, steps: 2 })
    else expect(output).toMatchObject({ ...expected, nodeId: 'node-one', steps: 1 })
  })

  it('returns unknown with the request idempotency key after any invalid dispatched response', async () => {
    const output = await runWith(request => ({ ...envelope(request, { status: 'succeeded', output: null }), status: 'unknown', idempotencyKey: request.idempotencyKey }))
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })

  it('preserves a valid native unknown result and its exact idempotency key', async () => {
    const output = await runWith(request => envelope(request, { status: 'unknown', idempotencyKey: request.idempotencyKey }))
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })

  it('rejects unknown with a mismatched key and never redispatches on another run', async () => {
    const bridge = vi.fn((request: NativeActionRequest) => ({ ...correlation(request), status: 'unknown', idempotencyKey: 'wrong-key' }))
    const registry = new ActionRegistry()
    registerNativeActions(registry, spec, bridge as never)
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    const first = await runner.run(workflow, { runId: 'run-one' })
    const second = await runner.run(workflow, { runId: 'run-one' })
    expect(first).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
    expect(second).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
    expect(bridge).toHaveBeenCalledTimes(1)
  })

  it.each(['protocolVersion', 'requestId', 'workflowId', 'workflowRevision', 'nodeId', 'actionId', 'idempotencyKey'] as const)('rejects divergent echoed %s', async field => {
    const output = await runWith(request => ({ ...envelope(request, { status: 'succeeded', output: null }), [field]: field === 'protocolVersion' || field === 'workflowRevision' ? 999 : 'diverged' }) as NativeActionResponse)
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })

  it.each(['protocolVersion', 'requestId', 'workflowId', 'workflowRevision', 'nodeId', 'actionId', 'idempotencyKey'] as const)('rejects missing echoed %s', async field => {
    const output = await runWith(request => {
      const response = envelope(request, { status: 'succeeded', output: null }) as unknown as Record<string, unknown>
      delete response[field]
      return response as NativeActionResponse
    })
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })

  it('rejects extra fields, old unenveloped ActionResult responses and malformed results as unknown', async () => {
    const invalidReplies: unknown[] = [
      (request: NativeActionRequest) => ({ ...envelope(request, { status: 'succeeded', output: null }), extra: true }),
      () => ({ status: 'succeeded', output: null }),
      (request: NativeActionRequest) => envelope(request, { status: 'accepted', jobId: '' }),
      (request: NativeActionRequest) => envelope(request, { status: 'needs_confirmation', confirmationId: 'id', summary: '', expiresAt: 'not-a-date' }),
      (request: NativeActionRequest) => envelope(request, { status: 'failed', code: 'a'.repeat(129), retryable: true }),
      (request: NativeActionRequest) => envelope(request, { status: 'succeeded', output: undefined } as unknown as ActionResult),
    ]
    for (const makeReply of invalidReplies) {
      const output = await runWith(request => (makeReply as (request: NativeActionRequest) => unknown)(request))
      expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
    }
  })

  it('accepts opaque job/confirmation IDs at 512 UTF-16 units, rejects 513 and controls, and keeps codes short identifiers', async () => {
    for (const result of [
      { status: 'accepted', jobId: 'x'.repeat(512) },
      { status: 'needs_confirmation', confirmationId: 'y'.repeat(512), summary: 'ok', expiresAt: '2099-01-01T00:00:00Z' },
      { status: 'denied', code: 'short_code-1' },
      { status: 'failed', code: 'E_NATIVE.1', retryable: false },
    ] as const) {
      expect(await runWith(request => envelope(request, result))).toMatchObject({ status: 'halted', result })
    }
    for (const result of [
      { status: 'accepted', jobId: 'x'.repeat(513) },
      { status: 'accepted', jobId: 'a\u0000b' },
      { status: 'accepted', jobId: 'a\u007fb' },
      { status: 'accepted', jobId: 'a\u009fb' },
      { status: 'needs_confirmation', confirmationId: 'y'.repeat(513), summary: 'ok', expiresAt: '2099-01-01T00:00:00Z' },
      { status: 'needs_confirmation', confirmationId: 'a\u001fb', summary: 'ok', expiresAt: '2099-01-01T00:00:00Z' },
      { status: 'denied', code: 'not a short identifier' },
    ] as const) {
      expect(await runWith(request => envelope(request, result as ActionResult))).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
    }
  })

  it('uses external:<requestId> for opaque external job IDs while preserving tuple request correlation', async () => {
    let seen: NativeActionRequest | undefined
    const output = await runWith(request => { seen = request; return envelope(request, { status: 'accepted', jobId: `external:${request.requestId}` }) })
    expect(seen?.requestId).toBe('["workflow-one",7,"run-one","node-one"]')
    expect(seen?.idempotencyKey).toBe('["workflow-one",7,"run-one","node-one"]')
    expect(output).toMatchObject({ status: 'halted', result: { status: 'accepted', jobId: 'external:["workflow-one",7,"run-one","node-one"]' } })
  })

  it('uses the immutable original request snapshot if the host mutates correlation fields', async () => {
    const output = await runWith(request => {
      request.requestId = 'mutated-request'
      request.idempotencyKey = 'mutated-key'
      return { ...envelope(request, { status: 'succeeded', output: null }), requestId: request.requestId, idempotencyKey: request.idempotencyKey }
    })
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })

  it('rejects response accessors without invoking them', async () => {
    let getterCalls = 0
    const output = await runWith(request => {
      const response = envelope(request, { status: 'succeeded', output: null }) as unknown as Record<string, unknown>
      Object.defineProperty(response, 'requestId', { enumerable: true, get: () => { getterCalls++; return request.requestId } })
      return response
    })
    expect(getterCalls).toBe(0)
    expect(output).toMatchObject({ status: 'halted', result: { status: 'unknown', idempotencyKey: '["workflow-one",7,"run-one","node-one"]' } })
  })
})
