// CyberManju OS — Automation host tests (tests/frontend/automation-host.test.ts).
// Role: Verify UI-independent composition, explicit policy/namespace and fail-closed capabilities.
// Exports: Vitest suites.
// Integrates: Public automation entry point, repository/service, storage and Android catalog.
// Contracts: No ambient integrations, session-backed writes, persisted outputs or plaintext secrets.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ANDROID_NATIVE_ACTION_SPECS, createShortcutsAutomationHost, MemoryAutomationStorage,
  type ActionDefinition, type AutomationStorage, type ExecutionJournal, type IntegrationOptions,
  type Json, type NativeActionBridge, type ShortcutsAutomationHostOptions, type Workflow,
  type WorkflowRepository, type WorkflowService, type ActionRegistry,
} from '../../src/automation'

const databaseName = 'shortcuts:owner-42:android-personal'
const authorize: ShortcutsAutomationHostOptions['authorize'] = async (_request, _effect, _signal) => 'allow'
const saveOptions = { expectedRevision: null, name: 'Host workflow' }
const runOptions = { runId: 'run1', expectedWorkflowRevision: 1 }
const scriptInput: Json = { steps: [{ id: 'value', op: 'value', args: ['local-value'] }] }
function graph(actionId = 'core.script', input: Json = scriptInput): Workflow {
  return { schemaVersion: 1, id: 'host-test', revision: 1, entryNodeId: 'action', nodes: [
    { id: 'action', type: 'action', actionId, input, next: 'end' }, { id: 'end', type: 'end' },
  ] }
}
function sessionHost(options: Partial<ShortcutsAutomationHostOptions> = {}) {
  return createShortcutsAutomationHost({ databaseName, authorize, storage: new MemoryAutomationStorage(), ...options })
}
/** Deliberately declared persistent test double, not a claim that Memory storage is durable. */
function persistentFixture(): AutomationStorage {
  const memory = new MemoryAutomationStorage()
  return { durability: 'persistent', get: memory.get.bind(memory), list: memory.list.bind(memory), update: memory.update.bind(memory) }
}
function customAction(effect: 'read' | 'write'): ActionDefinition {
  return { id: `custom.${effect}`, effect, validateInput: () => true,
    execute: vi.fn(async () => ({ status: 'succeeded' as const, output: 'ephemeral-result' })) }
}
const nativeBridge: NativeActionBridge = vi.fn(async request => ({ ...request, status: 'succeeded', output: null }))
const integrations: Array<[string, IntegrationOptions]> = [
  ['http', { http: { allowedOrigins: ['https://example.com'], fetch: vi.fn() } }],
  ['cybsh', { cybsh: { commandIds: ['status'], execute: vi.fn() } }],
  ['ai', { ai: { agentIds: ['assistant'], execute: vi.fn() } }],
]

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Shortcuts automation host', () => {
  it('requires an explicit authorization policy, including with injected storage', () => {
    for (const policy of [undefined, null, true, 'allow']) {
      expect(() => sessionHost({ authorize: policy as unknown as ShortcutsAutomationHostOptions['authorize'] }))
        .toThrow('missing_authorization_policy')
    }
  })

  it.each([undefined, null, '', ' ', ' owner ', 'owner\u0000env', 'owner\nenv'])('rejects invalid or implicit database namespace %s', name => {
    expect(() => sessionHost({ databaseName: name as unknown as string })).toThrow('invalid_database_name')
  })

  it('also rejects absent options, rather than inventing a namespace or policy', () => {
    expect(() => createShortcutsAutomationHost(undefined as unknown as ShortcutsAutomationHostOptions)).toThrow('invalid_database_name')
  })

  it('exposes typed composition with only local scripts by default and does not authorize validation', async () => {
    const policy = vi.fn(authorize), storage = new MemoryAutomationStorage()
    const host = sessionHost({ authorize: policy, storage })
    expectTypeOf(host.repository).toEqualTypeOf<WorkflowRepository>()
    expectTypeOf(host.service).toEqualTypeOf<WorkflowService>()
    expectTypeOf(host.registry).toEqualTypeOf<ActionRegistry>()
    expectTypeOf(host.durability).toEqualTypeOf<'persistent' | 'session'>()
    expect(host.durability).toBe('session')
    expect(host.repository.durability).toBe(host.durability)
    expect(host.service.listActions()).toEqual([{ id: 'core.script', effect: 'read' }])
    expect(host.service.validate(graph())).toMatchObject({ valid: true })
    expect(policy).not.toHaveBeenCalled()
    await host.repository.save(graph(), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'completed' })
    expect(policy).toHaveBeenCalledOnce()
    expect(policy.mock.calls[0][1]).toBe('read')
    expect(await storage.list('claim:')).toHaveLength(1)
  })

  it.each(integrations)('registers %s only on explicit opt-in with persistent storage', (_name, integration) => {
    const host = sessionHost({ storage: persistentFixture(), integrations: integration })
    const expected = integration.http ? 'core.http' : integration.cybsh ? 'core.cybsh' : 'core.ai.invoke'
    expect(host.service.listActions()).toEqual([
      { id: 'core.script', effect: 'read' }, { id: expected, effect: 'write' },
    ])
    expect(host.service.listActions().some(action => action.id.startsWith('android.'))).toBe(false)
    expect(host.durability).toBe('persistent')
  })

  it.each(integrations)('refuses session storage for the %s write adapter even with a supplied journal', (_name, integration) => {
    expect(() => sessionHost({ integrations: integration, journal: { claim: vi.fn(async () => true) } }))
      .toThrow('persistent_storage_required')
  })

  it('registers exactly the closed native catalog only with a bridge and persistent storage', () => {
    const without = sessionHost({ storage: persistentFixture() })
    expect(without.registry.list().map(action => action.id)).toEqual(['core.script'])
    const host = sessionHost({ storage: persistentFixture(), nativeBridge })
    expect(host.registry.list()).toEqual([
      { id: 'core.script', effect: 'read' },
      ...ANDROID_NATIVE_ACTION_SPECS.map(({ id, effect }) => ({ id, effect })),
    ])
    expect(nativeBridge).not.toHaveBeenCalled()
    expect(() => sessionHost({ nativeBridge })).toThrow('persistent_storage_required')
    expect(() => sessionHost({ nativeBridge: null as unknown as NativeActionBridge })).toThrow('invalid_bridge')
  })

  it('guards late custom write registration while allowing pure read adapters for session-only tests', () => {
    const host = sessionHost(), write = customAction('write'), read = customAction('read')
    expect(() => host.registry.register(write)).toThrow('persistent_storage_required')
    expect(host.registry.get(write.id)).toBeUndefined()
    expect(host.registry.register(read)).toBe(host.registry)
    expect(host.service.listActions()).toContainEqual({ id: read.id, effect: 'read' })
    const durable = sessionHost({ storage: persistentFixture() })
    expect(durable.registry.register(write)).toBe(durable.registry)
    expect(write.execute).not.toHaveBeenCalled()
  })

  it('fails closed when IndexedDB is absent, without using memory for native actions', () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(() => createShortcutsAutomationHost({ databaseName, authorize })).toThrow('storage_unavailable')
    expect(() => createShortcutsAutomationHost({ databaseName, authorize, nativeBridge })).toThrow('storage_unavailable')
    expect(nativeBridge).not.toHaveBeenCalled()
  })

  it('passes the exact caller namespace to IndexedDB and does not dispatch on lazy open failure', async () => {
    const open = vi.fn(() => { throw new Error('sensitive browser error') })
    vi.stubGlobal('indexedDB', { open })
    const policy = vi.fn(authorize)
    const host = createShortcutsAutomationHost({ databaseName, authorize: policy, nativeBridge })
    expect(host.durability).toBe('persistent')
    expect(open).not.toHaveBeenCalled()
    await expect(host.repository.save(graph('android.dial', { phone: '+5511999999999' }), saveOptions))
      .rejects.toThrow('storage_unavailable')
    expect(await host.service.run('host-test', runOptions)).toEqual({ status: 'rejected', code: 'storage_unavailable' })
    expect(open.mock.calls).toEqual([[databaseName, 1], [databaseName, 1]])
    expect(policy).not.toHaveBeenCalled()
    expect(nativeBridge).not.toHaveBeenCalled()
  })

  it('honors deny/throw/non-allow policies without dispatching native actions or claiming', async () => {
    for (const policy of [async () => 'deny' as const, async () => { throw new Error('private detail') }, async () => true as unknown as 'allow']) {
      const storage = persistentFixture(), host = sessionHost({ storage, authorize: policy, nativeBridge })
      await host.repository.save(graph('android.dial', { phone: '+5511999999999' }), saveOptions)
      expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'halted', result: { status: 'denied' } })
      expect(await storage.list('claim:')).toEqual([])
    }
    expect(nativeBridge).not.toHaveBeenCalled()
  })

  it('executes authorized native actions through the service and never stores adapter outputs', async () => {
    const storage = persistentFixture(), policy = vi.fn(authorize)
    const bridge: NativeActionBridge = vi.fn(async request => {
      const { input: _input, ...envelope } = request
      return { ...envelope, status: 'succeeded', output: 'native-ephemeral-output' }
    })
    const host = sessionHost({ storage, authorize: policy, nativeBridge: bridge })
    await host.repository.save(graph('android.dial', { phone: '+5511999999999' }), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'completed', outputs: { action: 'native-ephemeral-output' } })
    expect(policy.mock.calls[0][1]).toBe('write')
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'rejected', code: 'pending_run' })
    expect(bridge).toHaveBeenCalledOnce()
    expect(JSON.stringify(await storage.list(''))).not.toContain('native-ephemeral-output')
  })

  it('never stores plaintext secrets or outputs returned by custom adapters', async () => {
    const storage = persistentFixture(), host = sessionHost({ storage }), action = customAction('write')
    host.registry.register(action)
    await expect(host.repository.save(graph(action.id, { token: 'private-token-value' }), saveOptions))
      .rejects.toMatchObject({ code: 'invalid_workflow' })
    expect(await storage.list('')).toEqual([])
    await host.repository.save(graph(action.id), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'completed', outputs: { action: 'ephemeral-result' } })
    const persisted = JSON.stringify(await storage.list(''))
    expect(persisted).not.toContain('ephemeral-result')
    expect(persisted).not.toContain('private-token-value')
  })

  it('keeps repository claims across host recreation even if an optional journal always permits', async () => {
    const storage = persistentFixture(), claim = vi.fn(async () => true), action = customAction('write')
    const host = sessionHost({ storage, journal: { claim } })
    host.registry.register(action)
    await host.repository.save(graph(action.id), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'completed' })
    const recreated = sessionHost({ storage, journal: { claim } })
    recreated.registry.register(action)
    expect(await recreated.service.run('host-test', runOptions)).toMatchObject({ status: 'rejected', code: 'pending_run' })
    expect(action.execute).toHaveBeenCalledOnce()
    expect(claim).toHaveBeenCalledOnce()
  })

  it.each(['reject', 'throw'] as const)('does not dispatch after an optional journal %s', async failure => {
    const claim = vi.fn(async () => { if (failure === 'throw') throw new Error('private journal detail'); return false })
    const host = sessionHost({ journal: { claim } })
    const action = customAction('read')
    host.registry.register(action)
    await host.repository.save(graph(action.id), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'halted', result: { status: 'unknown' } })
    expect(action.execute).not.toHaveBeenCalled()
  })

  it('does not call an external journal or native bridge after a failed storage claim', async () => {
    const storage = persistentFixture(), claim = vi.fn(async () => true)
    const update = storage.update.bind(storage)
    storage.update = (key, change) => key.startsWith('claim:')
      ? Promise.reject(new Error('private persistence detail')) : update(key, change)
    const host = sessionHost({ storage, nativeBridge, journal: { claim } })
    await host.repository.save(graph('android.dial', { phone: '+5511999999999' }), saveOptions)
    expect(await host.service.run('host-test', runOptions)).toMatchObject({ status: 'halted', result: { status: 'unknown' } })
    expect(claim).not.toHaveBeenCalled()
    expect(nativeBridge).not.toHaveBeenCalled()
  })

  it('shares atomic claims across concurrent hosts over the same persistent storage', async () => {
    const storage = persistentFixture(), action = customAction('write')
    const hosts = [sessionHost({ storage }), sessionHost({ storage })]
    for (const host of hosts) host.registry.register(action)
    await hosts[0].repository.save(graph(action.id), saveOptions)
    const results = await Promise.all(hosts.map(host => host.service.run('host-test', runOptions)))
    expect(results.map(result => result.status).sort()).toEqual(['completed', 'rejected'])
    expect(results).toContainEqual({ status: 'rejected', code: 'pending_run' })
    expect(action.execute).toHaveBeenCalledOnce()
  })

  it('rejects malformed storage and journal injections', () => {
    expect(() => sessionHost({ storage: { durability: 'persistent' } as AutomationStorage })).toThrow('storage_unavailable')
    expect(() => sessionHost({ journal: {} as ExecutionJournal })).toThrow('missing_policy_or_journal')
  })
})
