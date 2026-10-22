// CyberManju OS — Shortcuts host composition tests (tests/frontend/shortcuts-host-composition.test.ts).
// Role: Verify ownership namespace, persistence, authorization, replay protection and recovery.
// Exports: Vitest coverage for useShortcutsAutomationHost.
// Integrates: IndexedDB repository/service contracts, runner and native action bridge.
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShortcutsAutomationHost, MemoryAutomationStorage, WorkflowService, type AutomationStorage, type NativeActionBridge, type ShortcutsAutomationHostOptions, type Workflow } from '../../src/automation'
import { useShortcutsAutomationHost } from '../../src/composables/useShortcutsAutomationHost'

const script: Workflow = { schemaVersion: 1, id: 'compose-flow', revision: 1, entryNodeId: 'script', nodes: [
  { id: 'script', type: 'action', actionId: 'core.script', input: { steps: [{ id: 'v', op: 'value', args: ['ok'] }] }, next: 'end' }, { id: 'end', type: 'end' },
] }
const graph = (actionId = 'core.script', input: any = script.nodes[0].type === 'action' ? script.nodes[0].input : {}): Workflow => ({ ...script, nodes: [
  { id: 'script', type: 'action', actionId, input, next: 'end' }, { id: 'end', type: 'end' },
] })
// Repository CAS, runner claims and the Vue prop delivery are all asynchronous.
const settle = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); await nextTick() }
function fixture() {
  const storages = new Map<string, AutomationStorage>()
  const getStorage = (name: string) => {
    let storage = storages.get(name)
    if (!storage) {
      const memory = new MemoryAutomationStorage()
      storage = { durability: 'persistent', get: memory.get.bind(memory), list: memory.list.bind(memory), update: memory.update.bind(memory) }
      storages.set(name, storage)
    }
    return storage
  }
  const names: string[] = []
  const createHost = (options: ShortcutsAutomationHostOptions) => { names.push(options.databaseName); return createShortcutsAutomationHost({ ...options, storage: getStorage(options.databaseName) }) }
  return { getStorage, names, createHost }
}
function mount(userId: any, f = fixture(), extra: Record<string, unknown> = {}) {
  const scope = effectScope()
  const host = scope.run(() => useShortcutsAutomationHost({ userId, environment: 'android app', android: false, createHost: f.createHost, indexedDBAvailable: () => true, ...extra } as any))!
  return { scope, host, fixture: f }
}
async function ready(m: ReturnType<typeof mount>) { await settle(); expect(m.host.canSave.value).toBe(true) }
async function save(m: ReturnType<typeof mount>, workflow = script, expectedRevision: number | null = null) {
  m.host.updateModel(workflow)
  await m.host.save(workflow, { requestId: `save-${expectedRevision ?? 0}`, name: 'Test', expectedRevision }); await settle()
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('useShortcutsAutomationHost composition', () => {
  it('requires explicit local opt-in, restores its persistent namespace, and keeps accounts separate', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    const f = fixture(), owner = ref<string | null>(null), allowLocalIdentity = ref(false)
    const m = mount(owner, f, { allowLocalIdentity }); await settle()
    expect(m.host.canSave.value).toBe(false); expect(values.size).toBe(0); expect(f.names).toEqual([])
    allowLocalIdentity.value = true; await ready(m)
    const localName = f.names[0]; expect(localName).toMatch(/^cybermanju:shortcuts:v1:android%20app:local:[0-9a-f-]{36}$/)
    await save(m); m.host.connect(); await m.host.run(script)
    expect(m.host.result.value?.status).toBe('completed'); await m.host.acknowledge(m.host.resultContext.value!)
    owner.value = 'alice'; await ready(m)
    expect(f.names.at(-1)).toBe('cybermanju:shortcuts:v1:android%20app:alice'); expect(m.host.records.value).toEqual([])
    owner.value = null; await ready(m)
    expect(f.names.at(-1)).toBe(localName); expect(m.host.savedWorkflow.value?.id).toBe(script.id)
    allowLocalIdentity.value = false; await settle()
    expect(m.host.canSave.value).toBe(false); expect(m.host.records.value).toEqual([]); m.scope.stop()
    const restored = mount(ref(null), f, { allowLocalIdentity: true }); await ready(restored)
    expect(f.names.at(-1)).toBe(localName); expect(restored.host.savedWorkflow.value?.id).toBe(script.id); restored.scope.stop()
  })
  it('fails closed when an opted-in local identity cannot be persisted or is invalid', async () => {
    for (const localStorage of [undefined, { getItem: () => null, setItem: () => {} }, { getItem: () => 'corrupt' }]) {
      vi.stubGlobal('localStorage', localStorage)
      const f = fixture(), m = mount(ref(null), f, { allowLocalIdentity: true }); await settle()
      expect(m.host.canSave.value).toBe(false); expect(m.host.canRun.value).toBe(false); expect(f.names).toEqual([]); m.scope.stop()
    }
  })
  it('fails closed without a valid identity, without IndexedDB, and on storage initialization failure', async () => {
    const f = fixture(), noOwner = mount(ref(' '), f); await settle()
    expect(noOwner.host.canSave.value).toBe(false); expect(f.names).toEqual([]); noOwner.scope.stop()
    const noDb = mount(ref('user'), f, { indexedDBAvailable: () => false }); await settle()
    expect(noDb.host.canRun.value).toBe(false); expect(noDb.host.notice.value).toContain('IndexedDB'); noDb.scope.stop()
    const bad = mount(ref('user'), { ...f, createHost: options => createShortcutsAutomationHost({ ...options, storage: { durability: 'persistent' } as AutomationStorage }) }); await settle()
    expect(bad.host.canSave.value).toBe(false); expect(bad.host.notice.value).toContain('Armazenamento persistente'); bad.scope.stop()
  })
  it('uses a stable encoded namespace isolated by user; persists with CAS ACK while retaining concurrent draft edits', async () => {
    const f = fixture(), owner = ref('alice / 1'), m = mount(owner, f); await ready(m)
    expect(f.names).toEqual(['cybermanju:shortcuts:v1:android%20app:alice%20%2F%201'])
    await save(m); expect(m.host.saveComplete.value?.requestId).toBe('save-0'); expect(m.host.savedWorkflow.value?.revision).toBe(1)
    const draft = { ...script, revision: 1, nodes: [{ id: 'script', type: 'action' as const, actionId: 'core.script', input: { steps: [{ id: 'v', op: 'value', args: ['draft'] }] }, next: 'end' }, { id: 'end', type: 'end' as const }] }
    m.host.updateModel(draft)
    const pending = m.host.save({ ...script, nodes: [{ id: 'script', type: 'action', actionId: 'core.script', input: { steps: [{ id: 'v', op: 'value', args: ['saved'] }] }, next: 'end' }, { id: 'end', type: 'end' }] }, { requestId: 'save-1', name: 'Test', expectedRevision: 1 })
    await pending; await settle(); expect(m.host.saveComplete.value?.record.workflow.revision).toBe(2)
    expect(m.host.modelValue.value?.nodes[0]).toMatchObject({ type: 'action', input: { steps: [{ args: ['draft'] }] } })
    expect(m.host.savedWorkflow.value?.revision).toBe(2)
    owner.value = 'bob'; await settle(); expect(f.names.at(-1)).toBe('cybermanju:shortcuts:v1:android%20app:bob'); expect(m.host.selectedWorkflowId.value).toBeNull()
    expect(m.host.modelValue.value).toBeUndefined(); expect(m.host.records.value).toEqual([])
    m.scope.stop()
  })
  it('runs only an identical saved snapshot and exposes exact pending result context and ACK', async () => {
    const m = mount(ref('runner')); await ready(m); await save(m); m.host.connect(); expect(m.host.canRun.value).toBe(true)
    await m.host.run({ ...script, revision: 1 }); await settle()
    expect(m.host.result.value).toMatchObject({ status: 'completed' }); expect(m.host.resultContext.value).toMatchObject({ workflowId: script.id, workflowRevision: 1 })
    expect(m.host.pendingRun.value).toMatchObject({ runId: m.host.resultContext.value?.runId, status: 'completed' })
    const context = m.host.resultContext.value!; await m.host.acknowledge({ ...context, runId: 'not-this-run' }); expect(m.host.pendingRun.value).not.toBeNull()
    await m.host.acknowledge(context); expect(m.host.pendingRun.value).toBeNull(); expect(m.host.result.value).toBeNull(); m.scope.stop()
  })
  it('does not exhaust authorization after more than 4096 valid actions across acknowledged runs', async () => {
    const m = mount(ref('long-lived')); await ready(m); await save(m); m.host.connect()
    try {
      for (let i = 0; i < 4097; i++) {
        await m.host.run(script)
        expect(m.host.result.value?.status, `run ${i + 1}`).toBe('completed')
        await m.host.acknowledge(m.host.resultContext.value!)
      }
    } finally { m.scope.stop() }
  }, 30_000)
  it('denies duplicate requests within a run and old requests after the run-scoped replay set is released', async () => {
    const f = fixture()
    let previous: Parameters<ShortcutsAutomationHostOptions['authorize']>[0] | undefined
    const createHost = (options: ShortcutsAutomationHostOptions) => createShortcutsAutomationHost({
      ...options, storage: f.getStorage(options.databaseName), authorize: async (request, effect, signal) => {
        if (previous) expect(await options.authorize(previous, effect, signal)).toBe('deny')
        const decision = await options.authorize(request, effect, signal)
        expect(decision).toBe('allow')
        expect(await options.authorize(request, effect, signal)).toBe('deny')
        previous = request
        return decision
      },
    })
    const m = mount(ref('replay-scope'), f, { createHost }); await ready(m); await save(m); m.host.connect()
    for (let i = 0; i < 2; i++) {
      await m.host.run(script); expect(m.host.result.value?.status).toBe('completed')
      await m.host.acknowledge(m.host.resultContext.value!)
    }
    m.scope.stop()
  })
  it('restores persisted pending state before enabling canRun', async () => {
    const f = fixture(), first = mount(ref('restore'), f); await ready(first); await save(first)
    const host = first.fixture.createHost({ databaseName: f.names[0], authorize: async () => 'allow' }); await host.repository.claimRun(script, 'interrupted-run')
    first.scope.stop(); const second = mount(ref('restore'), f); await settle()
    expect(second.host.pendingRun.value).toMatchObject({ runId: 'interrupted-run', status: 'unknown' }); expect(second.host.canRun.value).toBe(false); second.scope.stop()
  })
  it('requires explicit uncertainty acceptance and preserves ACK failure for retry', async () => {
    const f = fixture(), m = mount(ref('uncertain'), f); await ready(m); await save(m)
    const h = f.createHost({ databaseName: f.names[0], authorize: async () => 'allow' }); await h.repository.claimRun(script, 'unknown-run')
    await m.host.select(script.id); await settle(); expect(m.host.canRun.value).toBe(false)
    const ctx = m.host.resultContext.value!; await m.host.acknowledge(ctx); expect(m.host.pendingRun.value).not.toBeNull()
    const storage = f.getStorage(f.names[0]), original = storage.update.bind(storage); let fail = true
    vi.spyOn(storage, 'update').mockImplementation((key, change) => key === `workflow:${script.id}` && fail ? Promise.reject(Error('storage')) : original(key, change))
    await m.host.acknowledge(ctx, { acceptUncertain: true }); expect(m.host.acknowledgeFailedContext.value).toEqual(ctx)
    fail = false; await m.host.acknowledge(ctx, { acceptUncertain: true }); expect(m.host.pendingRun.value).toBeNull(); m.scope.stop()
  })
  it('authorizes Android for the exact resolved snapshot and correlation tuple; dispatches once and blocks replay', async () => {
    const f = fixture(), bridge: NativeActionBridge = vi.fn(async request => ({ protocolVersion: 1, requestId: request.requestId, workflowId: request.workflowId, workflowRevision: request.workflowRevision, nodeId: request.nodeId, actionId: request.actionId, idempotencyKey: request.idempotencyKey, status: 'succeeded' as const, output: null }))
    const m = mount(ref('android'), f, { android: true, nativeBridge: bridge }); await ready(m)
    const wf: Workflow = { schemaVersion: 1, id: 'compose-flow', revision: 1, entryNodeId: 'script', nodes: [
      { id: 'script', type: 'action', actionId: 'core.script', input: { steps: [{ id: 'v', op: 'value', args: ['resolved text'] }] }, next: 'native' },
      { id: 'native', type: 'action', actionId: 'android.share_text', input: { text: { $output: { nodeId: 'script', path: ['last'] } } }, next: 'end' }, { id: 'end', type: 'end' },
    ] }
    await save(m, wf); m.host.connect(); const run = m.host.run(wf); await settle()
    const request = m.host.authorizationRequest.value!; expect(request).toMatchObject({ workflowId: wf.id, workflowRevision: 1, nodeId: 'native', actionId: 'android.share_text', input: { text: 'resolved text' } })
    const tuple = JSON.parse(request.requestId); expect(tuple).toEqual([wf.id, 1, expect.any(String), 'native'])
    m.host.authorizationDecision({ requestId: request.requestId, decision: 'allow' }); await run; await settle()
    expect(bridge).toHaveBeenCalledOnce(); expect(vi.mocked(bridge).mock.calls[0][0]).toMatchObject({ requestId: request.requestId, input: { text: 'resolved text' } })
    m.host.authorizationDecision({ requestId: request.requestId, decision: 'allow' }); expect(bridge).toHaveBeenCalledOnce()
    await m.host.acknowledge(m.host.resultContext.value!)
    const second = m.host.run(wf); await settle()
    expect(m.host.authorizationRequest.value?.requestId).not.toBe(request.requestId)
    m.host.authorizationDecision({ requestId: request.requestId, decision: 'allow' })
    await second; expect(bridge).toHaveBeenCalledOnce(); m.scope.stop()
  })
  it('denies after the 25s authorization deadline without calling the bridge', async () => {
    vi.useFakeTimers(); const bridge: NativeActionBridge = vi.fn(async request => ({ ...request, status: 'succeeded' as const, output: null }))
    const m = mount(ref('timeout'), fixture(), { android: true, nativeBridge: bridge }); await ready(m); const wf = graph('android.dial', { phone: '+15551234567' }); await save(m, wf); m.host.connect()
    const running = m.host.run(wf); await settle(); expect(m.host.authorizationRequest.value).not.toBeNull(); await vi.advanceTimersByTimeAsync(25_000); await running; expect(bridge).not.toHaveBeenCalled(); m.scope.stop()
  })
  it('cannot reuse an approval for an earlier native step to approve the next step of the same run', async () => {
    const bridge: NativeActionBridge = vi.fn(async request => ({ protocolVersion: 1, requestId: request.requestId,
      workflowId: request.workflowId, workflowRevision: request.workflowRevision, nodeId: request.nodeId,
      actionId: request.actionId, idempotencyKey: request.idempotencyKey, status: 'succeeded' as const, output: null }))
    const m = mount(ref('next-step'), fixture(), { android: true, nativeBridge: bridge }); await ready(m)
    const wf: Workflow = { ...script, entryNodeId: 'first', nodes: [
      { id: 'first', type: 'action', actionId: 'android.dial', input: { phone: '+15551234567' }, next: 'second' },
      { id: 'second', type: 'action', actionId: 'android.dial', input: { phone: '+15559876543' }, next: 'end' },
      { id: 'end', type: 'end' },
    ] }
    await save(m, wf); m.host.connect(); const running = m.host.run(wf); await settle()
    const first = m.host.authorizationRequest.value!
    m.host.authorizationDecision({ requestId: first.requestId, decision: 'allow' }); await settle()
    expect(m.host.authorizationRequest.value?.nodeId).toBe('second')
    expect(m.host.authorizationRequest.value?.requestId).not.toBe(first.requestId)
    m.host.authorizationDecision({ requestId: first.requestId, decision: 'allow' })
    await running; expect(bridge).toHaveBeenCalledOnce(); expect(m.host.result.value?.status).toBe('halted'); m.scope.stop()
  })
  it('aborts authorization on disconnect and scope disposal', async () => {
    const bridge: NativeActionBridge = vi.fn(async request => ({ ...request, status: 'succeeded' as const, output: null }))
    const m = mount(ref('disconnect'), fixture(), { android: true, nativeBridge: bridge }); await ready(m); const wf = graph('android.dial', { phone: '+15551234567' }); await save(m, wf); m.host.connect()
    const running = m.host.run(wf); await settle(); expect(m.host.authorizationRequest.value).not.toBeNull(); m.host.disconnect(); await running; expect(bridge).not.toHaveBeenCalled(); m.scope.stop()
  })
  it('does not run without a connected UI or a matching immutable saved snapshot', async () => {
    const m = mount(ref('guard')); await ready(m); await save(m)
    const dispatch = vi.spyOn(WorkflowService.prototype, 'run')
    await m.host.run(script); expect(dispatch).not.toHaveBeenCalled()
    m.host.connect(); await m.host.run({ ...script, revision: 2 }); expect(dispatch).not.toHaveBeenCalled()
    expect(m.host.result.value).toBeNull(); m.scope.stop()
  })
  it('treats pending_run as a transient warning, never an automatic durable ACK', async () => {
    const f = fixture(), m = mount(ref('warning'), f); await ready(m); await save(m); m.host.connect()
    const external = f.createHost({ databaseName: f.names[0], authorize: async () => 'allow' })
    await external.repository.claimRun(script, 'external-run')
    const ack = vi.spyOn(WorkflowService.prototype, 'acknowledgePendingRun')
    await m.host.run(script); await settle()
    expect(m.host.result.value).toBeNull()
    expect(m.host.pendingRun.value?.runId).toBe('external-run'); expect(ack).not.toHaveBeenCalled()
    await m.host.acknowledge({ workflowId: script.id, workflowRevision: 1, runId: 'wrong-run' }, { acceptUncertain: true })
    expect(ack).not.toHaveBeenCalled(); expect(await external.service.getPendingRun(script.id)).not.toBeNull()
    await m.host.acknowledge(m.host.resultContext.value!, { acceptUncertain: true })
    expect(ack).toHaveBeenCalledOnce(); expect(m.host.pendingRun.value).toBeNull(); m.scope.stop()
  })
  it('rejects a swapped authorization prop even with an allow response for the original tuple', async () => {
    const bridge: NativeActionBridge = vi.fn(), m = mount(ref('swap'), fixture(), { android: true, nativeBridge: bridge })
    await ready(m); const wf = graph('android.dial', { phone: '+15551234567' }); await save(m, wf); m.host.connect()
    const running = m.host.run(wf); await settle()
    const original = m.host.authorizationRequest.value!
    m.host.authorizationRequest.value = { ...original, input: { phone: '+15559876543' } }
    m.host.authorizationDecision({ requestId: original.requestId, decision: 'allow' })
    await running; expect(bridge).not.toHaveBeenCalled(); expect(m.host.pendingRun.value?.status).toBe('unknown')
    const ack = vi.spyOn(WorkflowService.prototype, 'acknowledgePendingRun')
    await m.host.acknowledge(m.host.resultContext.value!); expect(ack).not.toHaveBeenCalled(); m.scope.stop()
  })
  it('rechecks exact resolved input at the actual bridge boundary after journal claim', async () => {
    const f = fixture(), bridge: NativeActionBridge = vi.fn()
    const createHost = (options: ShortcutsAutomationHostOptions) => {
      const approvedBridge = options.nativeBridge!
      return createShortcutsAutomationHost({ ...options, storage: f.getStorage(options.databaseName),
        nativeBridge: (request, signal) => approvedBridge({ ...request, input: { phone: '+15559876543' } }, signal),
      })
    }
    const m = mount(ref('dispatch-input'), f, { android: true, nativeBridge: bridge, createHost })
    await ready(m); const wf = graph('android.dial', { phone: '+15551234567' }); await save(m, wf); m.host.connect()
    const running = m.host.run(wf); await settle()
    m.host.authorizationDecision({ requestId: m.host.authorizationRequest.value!.requestId, decision: 'allow' })
    await running; expect(bridge).not.toHaveBeenCalled(); expect(m.host.pendingRun.value?.status).toBe('unknown'); m.scope.stop()
  })
  it('does not treat accepted Android intents as completed workflows', async () => {
    const bridge: NativeActionBridge = vi.fn(async request => ({ protocolVersion: 1, requestId: request.requestId,
      workflowId: request.workflowId, workflowRevision: request.workflowRevision, nodeId: request.nodeId,
      actionId: request.actionId, idempotencyKey: request.idempotencyKey, status: 'accepted' as const, jobId: 'private-job' }))
    const m = mount(ref('accepted'), fixture(), { android: true, nativeBridge: bridge }); await ready(m)
    const wf = graph('android.dial', { phone: '+15551234567' }); await save(m, wf); m.host.connect()
    const running = m.host.run(wf); await settle()
    m.host.authorizationDecision({ requestId: m.host.authorizationRequest.value!.requestId, decision: 'allow' })
    await running; expect(m.host.result.value).toMatchObject({ status: 'halted', result: { status: 'accepted' } })
    expect(m.host.pendingRun.value).toMatchObject({ status: 'unknown', code: 'uncertain' })
    const ctx = m.host.resultContext.value!; await m.host.acknowledge(ctx); expect(m.host.pendingRun.value).not.toBeNull()
    await m.host.acknowledge(ctx, { acceptUncertain: true }); expect(m.host.pendingRun.value).toBeNull(); m.scope.stop()
  })
})
