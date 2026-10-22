// CyberManju OS — Automation pending-run tests (tests/frontend/automation-pending.test.ts).
// Role: Verify persisted pending-run exclusion, safe recovery and explicit acknowledgment.
// Exports: Vitest coverage for the automation repository and service pending-run contract.
// Integrates: MemoryAutomationStorage, independent storage adapters, repository and service.
// Contracts: Pending state is an atomic gate; it never stores outputs, secrets or runner details.
import { describe, expect, it, vi } from 'vitest'
import { WorkflowRepository } from '../../src/automation/repository'
import { WorkflowService } from '../../src/automation/service'
import { ActionRegistry } from '../../src/automation/runner'
import { MemoryAutomationStorage, type AutomationStorage } from '../../src/automation/storage'
import type { ActionResult, Workflow } from '../../src/automation/schema'

const graph = (revision = 1): Workflow => ({
  schemaVersion: 1, id: 'test', revision, entryNodeId: 'a', nodes: [
    { id: 'a', type: 'action', actionId: 'test.read', input: { value: 4 }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
})
const saveOptions = { expectedRevision: null, name: 'Pending workflow' }
const runOptions = (runId: string, revision = 1) => ({ runId, expectedWorkflowRevision: revision })

function adapter(backing: MemoryAutomationStorage): AutomationStorage {
  // Separate handles over the same backing store model reopened database connections.
  return {
    durability: 'persistent',
    get: backing.get.bind(backing),
    list: backing.list.bind(backing),
    update: backing.update.bind(backing),
  }
}
function harness(storage: AutomationStorage = new MemoryAutomationStorage(), execute = vi.fn<() => Promise<ActionResult>>(async () => ({
  status: 'succeeded' as const, output: { value: 7 },
}))) {
  const repository = new WorkflowRepository(storage)
  const registry = new ActionRegistry().register({ id: 'test.read', effect: 'read', validateInput: () => true, execute })
  const authorize = vi.fn(async () => 'allow' as const)
  const service = new WorkflowService({ repository, registry, authorize })
  return { storage, repository, service, execute, authorize }
}

async function savedHarness() {
  const h = harness()
  await h.repository.save(graph(), saveOptions)
  return h
}

describe('automation pending-run safety', () => {
  it('persists a completed result as safe metadata and ACK removes the gate', async () => {
    const h = await savedHarness()
    expect(await h.service.run('test', runOptions('run-one'))).toMatchObject({ status: 'completed' })
    expect(await h.service.getPendingRun('test')).toMatchObject({
      workflowId: 'test', workflowRevision: 1, runId: 'run-one', status: 'completed', code: 'completed',
    })
    const raw = await h.storage.get('workflow:test') as Record<string, unknown>
    const pending = raw.pendingRun as Record<string, unknown>
    expect(Object.keys(pending).sort()).toEqual(['code', 'runId', 'startedAt', 'status', 'updatedAt', 'workflowId', 'workflowRevision'])
    expect(JSON.stringify(pending)).not.toMatch(/output|jobId|confirmationId|summary/i)
    await expect(h.service.acknowledgePendingRun('test', 'run-one')).resolves.toBeUndefined()
    expect(await h.service.getPendingRun('test')).toBeNull()
  })

  it('reopens through another service/storage handle, reports running as interrupted, and blocks a new run until ACK', async () => {
    const backing = new MemoryAutomationStorage()
    const first = harness(adapter(backing))
    await first.repository.save(graph(), saveOptions)
    await first.repository.claimRun(graph(), 'persisted-run')
    const reopened = harness(adapter(backing))
    expect(await reopened.service.getPendingRun('test')).toMatchObject({ runId: 'persisted-run', status: 'unknown', code: 'interrupted' })
    expect(await reopened.service.run('test', runOptions('new-run'))).toEqual({ status: 'rejected', code: 'pending_run' })
    expect(reopened.execute).not.toHaveBeenCalled()
    await expect(reopened.service.acknowledgePendingRun('test', 'wrong-run')).rejects.toMatchObject({ code: 'run_conflict' })
    await expect(reopened.service.acknowledgePendingRun('test', 'persisted-run')).rejects.toMatchObject({ code: 'uncertain_run' })
    await reopened.service.acknowledgePendingRun('test', 'persisted-run', { acceptUncertain: true })
    expect(await reopened.service.getPendingRun('test')).toBeNull()
    expect((await reopened.service.run('test', runOptions('new-run'))).status).toBe('completed')
  })

  it('allows only one concurrent claim across two services and blocks edits/deletes while pending', async () => {
    const backing = new MemoryAutomationStorage()
    const a = harness(adapter(backing)), b = harness(adapter(backing))
    await a.repository.save(graph(), saveOptions)
    const claims = await Promise.allSettled([
      a.repository.claimRun(graph(), 'claim-a'),
      b.repository.claimRun(graph(), 'claim-b'),
    ])
    expect(claims.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    expect(claims.filter(x => x.status === 'rejected')).toHaveLength(1)
    await expect(a.repository.save(graph(2), { expectedRevision: 1, name: 'Changed' })).rejects.toMatchObject({ code: 'pending_run' })
    await expect(b.repository.delete('test', 1)).rejects.toMatchObject({ code: 'pending_run' })
    const pending = await a.service.getPendingRun('test')
    expect(pending?.runId).toMatch(/^claim-/)
    await a.service.acknowledgePendingRun('test', pending!.runId, { acceptUncertain: true })
    await b.repository.save(graph(2), { expectedRevision: 1, name: 'Changed' })
  })

  it('rejects stale revision at claim CAS after preflight observes an older revision', async () => {
    const h = await savedHarness()
    const originalGet = h.repository.get.bind(h.repository)
    let preflighted = false
    vi.spyOn(h.repository, 'get').mockImplementation(async id => {
      const result = await originalGet(id)
      if (!preflighted) {
        preflighted = true
        await h.repository.save(graph(2), { expectedRevision: 1, name: 'Raced update' })
      }
      return result
    })
    const result = await h.service.run('test', runOptions('stale-run'))
    expect(result).toMatchObject({ status: 'rejected' })
    expect(h.execute).not.toHaveBeenCalled()
    expect(await h.service.getPendingRun('test')).toBeNull()
  })

  it('does not dispatch if the atomic claim write fails', async () => {
    const base = new MemoryAutomationStorage()
    const storage = adapter(base)
    const originalUpdate = storage.update.bind(storage)
    vi.spyOn(storage, 'update').mockImplementation(async (key, change) => {
      if (key === 'workflow:test') throw new Error('storage-failure-secret')
      return originalUpdate(key, change)
    })
    const h = harness(storage)
    // Create workflow before enabling the claim failure.
    const working = adapter(base)
    await new WorkflowRepository(working).save(graph(), saveOptions)
    const result = await h.service.run('test', runOptions('blocked'))
    expect(result).toMatchObject({ status: 'rejected' })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('retains running/interrupted state if finalization fails but returns runner outputs intact', async () => {
    const base = new MemoryAutomationStorage()
    const storage = adapter(base)
    const originalUpdate = storage.update.bind(storage)
    let claimed = false
    vi.spyOn(storage, 'update').mockImplementation(async (key, change) => {
      if (key === 'workflow:test' && claimed) throw new Error('finalize-secret')
      const result = await originalUpdate(key, change)
      if (key === 'workflow:test') claimed = true
      return result
    })
    const h = harness(storage)
    await new WorkflowRepository(adapter(base)).save(graph(), saveOptions)
    const result = await h.service.run('test', runOptions('finish-fails'))
    expect(result).toMatchObject({ status: 'completed', outputs: { a: { value: 7 } } })
    expect(await h.service.getPendingRun('test')).toMatchObject({ status: 'unknown', code: 'interrupted' })
  })

  it('does not persist arbitrary runner codes, outputs or provider metadata in pendingRun', async () => {
    const execute = vi.fn(async () => ({ status: 'failed' as const, code: 'provider-secret-code', output: { secret: 'secret-value', summary: 'private summary' } }))
    const h = await savedHarness()
    const alternate = harness(h.storage, execute)
    const result = await alternate.service.run('test', runOptions('failed-run'))
    expect(result.status).toBe('halted')
    const raw = await h.storage.get('workflow:test') as Record<string, unknown>
    const pending = raw.pendingRun as Record<string, unknown>
    expect(JSON.stringify(pending)).not.toMatch(/provider-secret-code|secret-value|private summary|jobId|confirmationId/)
    expect(pending.code).toBe('uncertain')
  })

  it('commits running before authorization or execution and keeps outputs/secret references out of pending', async () => {
    const storage = new MemoryAutomationStorage()
    const execute = vi.fn(async (): Promise<ActionResult> => {
      expect((await storage.get('workflow:test') as any).pendingRun.status).toBe('running')
      return { status: 'succeeded', output: 'resolved-secret-transient-output' }
    })
    const h = harness(storage, execute), input = graph()
    if (input.nodes[0].type === 'action') input.nodes[0].input = { authorization: { secretRef: 'vault.private' } }
    await h.repository.save(input, saveOptions)
    h.authorize.mockImplementation(async () => {
      expect((await storage.get('workflow:test') as any).pendingRun).toMatchObject({ status: 'running', code: 'running' })
      return 'allow'
    })
    expect(await h.service.run('test', runOptions('transient'))).toMatchObject({
      status: 'completed', outputs: { a: 'resolved-secret-transient-output' },
    })
    const pending = JSON.stringify((await storage.get('workflow:test') as any).pendingRun)
    expect(pending).not.toMatch(/secretRef|vault.private|resolved-secret|authorization|input|output/)
  })

  it.each([
    { status: 'accepted', jobId: 'private-job' },
    { status: 'needs_confirmation', confirmationId: 'private-confirmation', summary: 'private-summary', expiresAt: '2099-01-01T00:00:00.000Z' },
    { status: 'failed', code: 'private-error-code', retryable: false },
    { status: 'denied', code: 'private-denial' },
    { status: 'unknown', idempotencyKey: JSON.stringify(['test', 1, 'uncertain', 'a']) },
  ] as ActionResult[])('requires explicit uncertainty ACK for action result $status', async action => {
    const h = harness(undefined, vi.fn(async () => action))
    await h.repository.save(graph(), saveOptions)
    expect(await h.service.run('test', runOptions('uncertain'))).toMatchObject({ status: 'halted', result: action })
    const pending = await h.service.getPendingRun('test')
    expect(pending).toMatchObject({ status: 'unknown', code: 'uncertain' })
    expect(JSON.stringify(pending)).not.toMatch(/private-|jobId|confirmationId|summary|retryable/)
    await expect(h.service.acknowledgePendingRun('test', 'uncertain', { acceptUncertain: false }))
      .rejects.toMatchObject({ code: 'uncertain_run' })
    await h.service.acknowledgePendingRun('test', 'uncertain', { acceptUncertain: true })
    expect(await h.service.getPendingRun('test')).toBeNull()
  })

  it('keeps a prior write and authorization denial transient while uncertain pending blocks reruns until exact ACK', async () => {
    const backing = new MemoryAutomationStorage()
    const storage = adapter(backing)
    const repository = new WorkflowRepository(storage)
    const execute = vi.fn(async () => ({ status: 'succeeded' as const, output: { written: true } }))
    const registry = new ActionRegistry().register({ id: 'test.write', effect: 'write', validateInput: () => true, execute })
    const authorize = vi.fn(async (request: { nodeId: string }) => request.nodeId === 'b' ? 'deny' as const : 'allow' as const)
    const workflow: Workflow = { schemaVersion: 1, id: 'test', revision: 1, entryNodeId: 'a', nodes: [
      { id: 'a', type: 'action', actionId: 'test.write', input: { value: 1 }, next: 'b' },
      { id: 'b', type: 'action', actionId: 'test.write', input: { value: 2 }, next: 'end' },
      { id: 'end', type: 'end' },
    ] }
    await repository.save(workflow, saveOptions)
    const service = new WorkflowService({ repository, registry, authorize })
    const result = await service.run('test', runOptions('denied-write'))
    expect(result).toMatchObject({ status: 'halted', nodeId: 'b', result: { status: 'denied', code: 'policy_denied' }, steps: 2 })
    expect(execute).toHaveBeenCalledTimes(1)
    const raw = await storage.get('workflow:test') as any
    expect(raw.pendingRun).toMatchObject({ status: 'unknown', code: 'uncertain', runId: 'denied-write' })
    expect(await service.getPendingRun('test')).toMatchObject({ status: 'unknown', code: 'uncertain', runId: 'denied-write' })
    await expect(service.acknowledgePendingRun('test', 'denied-write')).rejects.toMatchObject({ code: 'uncertain_run' })
    await expect(service.acknowledgePendingRun('test', 'denied-write', { acceptUncertain: false })).rejects.toMatchObject({ code: 'uncertain_run' })
    expect(await service.run('test', runOptions('retry-write'))).toEqual({ status: 'rejected', code: 'pending_run' })
    const reopenedRepository = new WorkflowRepository(adapter(backing))
    const reopened = new WorkflowService({ repository: reopenedRepository, registry, authorize })
    expect(await reopened.getPendingRun('test')).toMatchObject({ runId: 'denied-write', status: 'unknown', code: 'uncertain' })
    expect(await reopened.run('test', runOptions('retry-after-reopen'))).toEqual({ status: 'rejected', code: 'pending_run' })
    expect(execute).toHaveBeenCalledTimes(1)
    await reopened.acknowledgePendingRun('test', 'denied-write', { acceptUncertain: true })
    expect(await reopened.getPendingRun('test')).toBeNull()
  })

  it('normalizes a legacy denied pending record to uncertain and requires exact true ACK', async () => {
    const h = await savedHarness()
    const raw = await h.storage.get('workflow:test') as any
    const now = new Date().toISOString()
    await h.storage.update('workflow:test', () => ({ value: { ...raw, pendingRun: {
      workflowId: 'test', workflowRevision: 1, runId: 'legacy-denied', status: 'halted', code: 'denied', startedAt: now, updatedAt: now,
    } }, result: undefined }))
    expect(await h.service.getPendingRun('test')).toMatchObject({ status: 'unknown', code: 'uncertain', runId: 'legacy-denied' })
    await expect(h.service.acknowledgePendingRun('test', 'legacy-denied')).rejects.toMatchObject({ code: 'uncertain_run' })
    await h.service.acknowledgePendingRun('test', 'legacy-denied', { acceptUncertain: true })
    expect(await h.service.getPendingRun('test')).toBeNull()
  })

  it('does not let wrong-workflow, repeated or stale ACK clear a newer claim', async () => {
    const h = await savedHarness()
    await h.repository.claimRun(graph(), 'old')
    await expect(h.service.acknowledgePendingRun('other-workflow', 'old', { acceptUncertain: true }))
      .rejects.toMatchObject({ code: 'run_conflict' })
    await h.service.acknowledgePendingRun('test', 'old', { acceptUncertain: true })
    await expect(h.service.acknowledgePendingRun('test', 'old', { acceptUncertain: true }))
      .rejects.toMatchObject({ code: 'run_conflict' })
    await h.repository.claimRun(graph(), 'new')
    await expect(h.service.acknowledgePendingRun('test', 'old', { acceptUncertain: true }))
      .rejects.toMatchObject({ code: 'run_conflict' })
    await expect(h.repository.finishRun('test', 'old', { status: 'completed', outputs: {}, steps: 1 }))
      .rejects.toMatchObject({ code: 'run_conflict' })
    expect(await h.service.getPendingRun('test')).toMatchObject({ runId: 'new', status: 'unknown' })
  })

  it('fails closed on corrupt pending fields, revision or status and does not clear them with ACK', async () => {
    const h = await savedHarness()
    await h.repository.claimRun(graph(), 'corrupt')
    const original = await h.storage.get('workflow:test') as any
    for (const mutation of [{ outputs: 'sensitive' }, { workflowRevision: 2 }, { status: 'arbitrary' }, { startedAt: '2026 (sensitive)' }]) {
      await h.storage.update('workflow:test', () => ({ value: { ...original, pendingRun: { ...original.pendingRun, ...mutation } }, result: undefined }))
      await expect(h.service.getPendingRun('test')).rejects.toMatchObject({ code: 'corrupt_record' })
      await expect(h.service.acknowledgePendingRun('test', 'corrupt', { acceptUncertain: true })).rejects.toMatchObject({ code: 'corrupt_record' })
      expect(await h.service.run('test', runOptions('new'))).toEqual({ status: 'rejected', code: 'storage_unavailable' })
    }
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('sanitizes storage errors from pending query and ACK without clearing the claim', async () => {
    const h = await savedHarness()
    await h.repository.claimRun(graph(), 'pending')
    vi.spyOn(h.repository, 'getPendingRun').mockRejectedValue(new Error('private-read-detail'))
    await expect(h.service.getPendingRun('test')).rejects.toThrow('storage_unavailable')
    vi.spyOn(h.repository, 'acknowledgePendingRun').mockRejectedValue(new Error('private-write-detail'))
    await expect(h.service.acknowledgePendingRun('test', 'pending', { acceptUncertain: true })).rejects.toThrow('storage_unavailable')
    expect((await h.storage.get('workflow:test') as any).pendingRun.runId).toBe('pending')
  })
})
