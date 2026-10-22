// CyberManju OS — Automation repository tests (tests/frontend/automation-repository.test.ts).
// Role: Verify canonical editor persistence and actual runner integration.
// Exports: Vitest suites.
// Integrates: Memory atomic storage, repository, service and registered actions.
// Contracts: CAS, immutable run binding, no inline secrets, no automatic replay.
import { describe, expect, it, vi } from 'vitest'
import { WorkflowRepository, StorageExecutionJournal } from '../../src/automation/repository'
import { MemoryAutomationStorage } from '../../src/automation/storage'
import { WorkflowService } from '../../src/automation/service'
import { ActionRegistry } from '../../src/automation/runner'
import type { Json, Workflow } from '../../src/automation/schema'

const graph = (revision = 1): Workflow => ({ schemaVersion: 1, id: 'test', revision, entryNodeId: 'a', nodes: [
  { id: 'a', type: 'action', actionId: 'test.read', input: { value: 4 }, next: 'end' }, { id: 'end', type: 'end' },
] })
const createOptions = { expectedRevision: null, name: 'First workflow' }
function setup() {
  const storage = new MemoryAutomationStorage()
  const repository = new WorkflowRepository(storage)
  const execute = vi.fn(async () => ({ status: 'succeeded' as const, output: { value: 4 } }))
  const validateInput = vi.fn(() => true)
  const authorize = vi.fn(async () => 'allow' as const)
  const registry = new ActionRegistry().register({ id: 'test.read', effect: 'read', validateInput, execute })
  const service = new WorkflowService({ repository, registry, authorize })
  return { storage, repository, execute, validateInput, authorize, registry, service }
}

describe('workflow repository', () => {
  it('stores detached records and exports only canonical schema, not metadata', async () => {
    const { repository } = setup(), input = graph()
    const pending = repository.save(input, createOptions)
    input.nodes[0].id = 'changed'
    const result = await pending
    expect(result.workflow.nodes[0].id).toBe('a')
    result.workflow.nodes[0].id = 'mutated'
    expect((await repository.get('test'))?.workflow).toEqual(graph())
    expect(JSON.parse(await repository.exportWorkflow('test'))).toEqual(graph())
    expect(await repository.list()).toHaveLength(1)
    expect(repository.durability).toBe('session')
  })
  it('atomically chooses a single concurrent creator and updater', async () => {
    const { repository, storage } = setup(), other = new WorkflowRepository(storage)
    const created = await Promise.allSettled([repository.save(graph(), createOptions), other.save(graph(), createOptions)])
    expect(created.filter(v => v.status === 'fulfilled')).toHaveLength(1)
    const updated = await Promise.allSettled([
      repository.save(graph(2), { expectedRevision: 1, name: 'A' }),
      other.save(graph(2), { expectedRevision: 1, name: 'B' }),
    ])
    expect(updated.filter(v => v.status === 'fulfilled')).toHaveLength(1)
    expect((await repository.get('test'))?.workflow.revision).toBe(2)
  })
  it('rejects revision skips, stale deletion and recreating a tombstoned ID', async () => {
    const { repository } = setup()
    await repository.save(graph(), createOptions)
    await expect(repository.save(graph(3), { expectedRevision: 1, name: 'Skip' })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(repository.delete('test', 2)).rejects.toMatchObject({ code: 'revision_conflict' })
    await repository.delete('test', 1)
    expect(await repository.get('test')).toBeNull()
    expect(await repository.list()).toEqual([])
    await expect(repository.save(graph(), createOptions)).rejects.toMatchObject({ code: 'deleted_workflow' })
  })
  it('imports bounded JSON, refuses inline credentials and rejects corrupt persisted records', async () => {
    const { repository, storage } = setup(), input = graph()
    if (input.nodes[0].type === 'action') input.nodes[0].input = { token: 'do-not-store' }
    await expect(repository.save(input, createOptions)).rejects.toMatchObject({ code: 'invalid_workflow' })
    expect(await storage.list('workflow:')).toEqual([])
    await expect(repository.importWorkflow('not-json', createOptions)).rejects.toMatchObject({ code: 'invalid_workflow' })
    await expect(repository.importWorkflow(' '.repeat(262145), createOptions)).rejects.toMatchObject({ code: 'invalid_workflow' })
    await repository.importWorkflow(JSON.stringify(graph()), createOptions)
    await storage.update('workflow:test', () => ({ value: { recordVersion: 2 }, result: undefined }))
    await expect(repository.get('test')).rejects.toMatchObject({ code: 'corrupt_record' })
    await expect(repository.list()).rejects.toMatchObject({ code: 'corrupt_record' })
  })
  it('preserves the workflow depth budget inside storage envelopes', async () => {
    const { repository } = setup(), input = graph()
    let nested: Json = null
    for (let depth = 0; depth < 21; depth++) nested = { nested }
    if (input.nodes[0].type === 'action') input.nodes[0].input = nested
    await repository.save(input, createOptions)
    expect((await repository.get('test'))?.workflow).toEqual(input)
    await repository.bindRun(input, 'deep')
    await repository.bindRun(input, 'deep')
  })
  it('retains secret references without resolving them', async () => {
    const { repository } = setup(), input = graph()
    if (input.nodes[0].type === 'action') input.nodes[0].input = { authorization: { secretRef: 'vault.api' } }
    const saved = await repository.save(input, createOptions)
    expect(saved.workflow).toEqual(input)
    expect(await repository.exportWorkflow('test')).toContain('vault.api')
  })
  it('binds a run ID to content across repository recreation, revision changes and deletion', async () => {
    const { repository, storage } = setup()
    await repository.save(graph(), createOptions)
    await repository.bindRun(graph(), 'run1')
    const recreated = new WorkflowRepository(storage)
    await recreated.bindRun(graph(), 'run1')
    const reordered = { nodes: graph().nodes, entryNodeId: 'a', revision: 1, id: 'test', schemaVersion: 1 }
    await recreated.bindRun(reordered, 'run1')
    await expect(recreated.bindRun(graph(2), 'run1')).rejects.toMatchObject({ code: 'run_conflict' })
    const changed = graph()
    if (changed.nodes[0].type === 'action') changed.nodes[0].input = { value: 99 }
    await expect(recreated.bindRun(changed, 'run1')).rejects.toMatchObject({ code: 'run_conflict' })
    await recreated.delete('test', 1)
    await expect(recreated.bindRun(graph(2), 'run1')).rejects.toMatchObject({ code: 'run_conflict' })
  })
  it('shares atomic journal claims across runner/repository instances', async () => {
    const storage = new MemoryAutomationStorage()
    const a = new StorageExecutionJournal(storage), b = new StorageExecutionJournal(storage)
    expect((await Promise.all([a.claim('same'), b.claim('same')])).sort()).toEqual([false, true])
    expect(await new StorageExecutionJournal(storage).claim('same')).toBe(false)
  })
})

describe('workflow editor service', () => {
  it('validates without executing, authorizing or claiming anything', async () => {
    const { service, storage, execute, authorize } = setup()
    expect(service.validate(graph())).toMatchObject({ valid: true })
    expect(service.listActions()).toEqual([{ id: 'test.read', effect: 'read' }])
    expect(await storage.list('claim:')).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
  })
  it('reports secret, graph and registration errors without exposing rejected payloads', () => {
    const { service } = setup(), input = graph()
    if (input.nodes[0].type === 'action') input.nodes[0].input = { password: 'sensitive-content' }
    expect(service.validate(input)).toEqual({ valid: false, issues: [{ code: 'plaintext_secret', severity: 'error' }] })
    const unknown = graph()
    if (unknown.nodes[0].type === 'action') unknown.nodes[0].actionId = 'missing'
    expect(service.validate(unknown)).toMatchObject({ valid: false, issues: [{ code: 'unregistered_action', nodeId: 'a' }] })
    expect(service.validate({})).toMatchObject({ valid: false })
  })
  it('rejects invalid static inputs before dispatch and checks all registered validators', async () => {
    const { service, repository, execute, validateInput } = setup()
    validateInput.mockReturnValue(false)
    await repository.save(graph(), createOptions)
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 1 })).toMatchObject({ status: 'rejected', code: 'validation_failed' })
    expect(execute).not.toHaveBeenCalled()
  })
  it('executes saved revision through the real runner and never replays claims', async () => {
    const { repository, service, execute } = setup()
    await repository.save(graph(), createOptions)
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 1 })).toMatchObject({ status: 'completed', outputs: { a: { value: 4 } } })
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 1 })).toMatchObject({ status: 'rejected', code: 'pending_run' })
    expect(execute).toHaveBeenCalledOnce()
    await service.acknowledgePendingRun('test', 'r')
    await repository.save(graph(2), { expectedRevision: 1, name: 'Second' })
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 2 })).toMatchObject({ status: 'rejected', code: 'run_conflict' })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('rejects stale, absent or cancelled runs with no effects or bindings', async () => {
    const { repository, service, execute, storage } = setup()
    await repository.save(graph(), createOptions)
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 2 })).toMatchObject({ code: 'revision_conflict' })
    expect(await service.run('absent', { runId: 'r', expectedWorkflowRevision: 1 })).toMatchObject({ code: 'not_found' })
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 1, signal: AbortSignal.abort() })).toMatchObject({ code: 'cancelled' })
    expect(await storage.list('run:')).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
  it('defers bound inputs and rejects self/future/branch-only outputs', () => {
    const { service } = setup(), input = graph()
    input.nodes = [
      { id: 'a', type: 'action', actionId: 'test.read', input: {}, next: 'b' },
      { id: 'b', type: 'action', actionId: 'test.read', input: { $output: { nodeId: 'a', path: ['value'] } }, next: 'end' },
      { id: 'end', type: 'end' },
    ]
    expect(service.validate(input)).toMatchObject({ valid: true, issues: [{ code: 'input_deferred', nodeId: 'b' }] })
    if (input.nodes[0].type === 'action') input.nodes[0].input = { $output: { nodeId: 'b', path: [] } }
    expect(service.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([{ code: 'binding_not_available', severity: 'error', nodeId: 'a' }]) })
    input.entryNodeId = 'cond'
    input.nodes = [
      { id: 'cond', type: 'condition', predicate: { op: 'eq', left: 1, right: 1 }, trueNext: 'a', falseNext: 'b' },
      { id: 'a', type: 'action', actionId: 'test.read', input: {}, next: 'b' },
      { id: 'b', type: 'action', actionId: 'test.read', input: { $output: { nodeId: 'a', path: [] } }, next: 'end' },
      { id: 'end', type: 'end' },
    ]
    expect(service.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([{ code: 'binding_not_available', severity: 'error', nodeId: 'b' }]) })
  })
  it('does not turn storage errors into execution permission or leak their messages', async () => {
    const { repository, service, execute } = setup()
    vi.spyOn(repository, 'get').mockRejectedValue(new Error('sensitive storage detail'))
    expect(await service.run('test', { runId: 'r', expectedWorkflowRevision: 1 })).toEqual({ status: 'rejected', code: 'storage_unavailable' })
    expect(execute).not.toHaveBeenCalled()
  })
})
