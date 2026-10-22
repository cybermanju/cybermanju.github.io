// CyberManju OS — Automation runner tests (tests/frontend/automation-runner.test.ts).
// Role: Exercise real workflow dispatch and fail-closed security behavior.
// Exports: Vitest suites.
// Integrates: Isolated automation schema and TypeScript runner.
// Contracts: No effects without permission, no loops, no replay after uncertainty.
import { describe, expect, it, vi } from 'vitest'
import { ActionRegistry, MemoryExecutionJournal, WorkflowRunner, type RunnerOptions } from '../../src/automation/runner'
import { copyJson, evaluatePredicate, validateWorkflow, type ActionResult, type Json, type Workflow, type NativeActionRequest } from '../../src/automation/schema'

const graph = (): Workflow => ({ schemaVersion: 1, id: 'test', revision: 1, entryNodeId: 'a', nodes: [
  { id: 'a', type: 'action', actionId: 'test.read', input: { value: 4 }, next: 'end' }, { id: 'end', type: 'end' },
] })
function setup(execute = vi.fn(async (_request: NativeActionRequest, _signal: AbortSignal): Promise<ActionResult> => ({ status: 'succeeded', output: { value: 4 } })), extra: Partial<RunnerOptions> = {}) {
  const registry = new ActionRegistry().register({ id: 'test.read', effect: 'write', validateInput: () => true, execute })
  const authorize = vi.fn(async () => 'allow' as const)
  const journal = new MemoryExecutionJournal()
  const runner = new WorkflowRunner({ registry, journal, authorize, ...extra })
  return { runner, execute, registry, journal, authorize }
}
describe('automation graph validation', () => {
  it('accepts a versioned detached snapshot', () => {
    const original = graph(), snapshot = validateWorkflow(original)
    original.nodes[0].id = 'changed'
    expect(snapshot.nodes[0].id).toBe('a')
  })
  it.each([
    (w: Workflow) => { w.schemaVersion = 2 as 1 },
    (w: Workflow) => { w.nodes[0].id = 'end' },
    (w: Workflow) => { if (w.nodes[0].type === 'action') w.nodes[0].next = 'missing' },
    (w: Workflow) => { if (w.nodes[0].type === 'action') w.nodes[0].next = 'a' },
    (w: Workflow) => { w.nodes.push({ id: 'unused', type: 'end' }) },
    (w: Workflow) => { w.revision = NaN },
    (w: Workflow) => { if (w.nodes[0].type === 'action') w.nodes[0].input = { password: 'plaintext' } },
    (w: Workflow) => { if (w.nodes[0].type === 'action') w.nodes[0].input = { $output: { nodeId: 'missing', path: [] } } },
    (w: Workflow) => { if (w.nodes[0].type === 'action') w.nodes[0].input = JSON.parse('{"__proto__":{"polluted":true}}') },
  ])('rejects malformed, cyclic or unsafe definitions', mutate => {
    const workflow = graph(); mutate(workflow)
    expect(() => validateWorkflow(workflow)).toThrow()
  })
  it('accepts secret references, not inline credentials', () => {
    const w = graph()
    if (w.nodes[0].type === 'action') w.nodes[0].input = { authorization: { secretRef: 'vault.api' } }
    expect(validateWorkflow(w)).toMatchObject({ id: 'test' })
  })
  it('rejects accessors without evaluating them, cycles, sparse arrays and non-finite JSON', () => {
    const getter = vi.fn(() => 'secret')
    expect(() => copyJson(Object.defineProperty({}, 'value', { get: getter, enumerable: true }))).toThrow()
    expect(getter).not.toHaveBeenCalled()
    const cycle: unknown[] = []; cycle.push(cycle)
    for (const bad of [cycle, [NaN], new Array(1000000), { value: undefined }, new Date()]) expect(() => copyJson(bad)).toThrow()
  })
  it('evaluates typed predicates without coercion or property inheritance', () => {
    const outputs = new Map<string, Json>([['a', { n: 4, value: ['yes'] }]])
    expect(evaluatePredicate({ op: 'gt', left: { $output: { nodeId: 'a', path: ['n'] } }, right: 3 }, outputs)).toBe(true)
    expect(evaluatePredicate({ op: 'eq', left: { a: 1, b: 2 }, right: { b: 2, a: 1 } }, outputs)).toBe(true)
    expect(evaluatePredicate({ op: 'eq', left: 4, right: '4' }, outputs)).toBe(false)
    expect(evaluatePredicate({ op: 'exists', value: { $output: { nodeId: 'missing', path: [] } } }, outputs)).toBe(false)
    expect(evaluatePredicate({ op: 'all', predicates: [{ op: 'not', predicate: { op: 'eq', left: 1, right: 2 } }, { op: 'contains', left: ['yes'], right: 'yes' }] }, outputs)).toBe(true)
  })
})
describe('automation runner', () => {
  it('dispatches exact native envelope and produces output', async () => {
    const { runner, execute, authorize } = setup()
    expect(await runner.run(graph(), { runId: 'run-1' })).toEqual({ status: 'completed', outputs: { a: { value: 4 } }, steps: 2 })
    expect(execute.mock.calls[0][0]).toMatchObject({ protocolVersion: 1, workflowId: 'test', workflowRevision: 1, nodeId: 'a', actionId: 'test.read', input: { value: 4 }, idempotencyKey: '["test",1,"run-1","a"]' })
    expect(authorize).toHaveBeenCalledOnce()
  })
  it('branches on prior output and binds it into subsequent actions', async () => {
    const { runner, execute } = setup()
    const w = graph()
    if (w.nodes[0].type === 'action') w.nodes[0].next = 'if'
    w.nodes.push({ id: 'if', type: 'condition', predicate: { op: 'eq', left: { $output: { nodeId: 'a', path: ['value'] } }, right: 4 }, trueNext: 'b', falseNext: 'end' },
      { id: 'b', type: 'action', actionId: 'test.read', input: { previous: { $output: { nodeId: 'a', path: ['value'] } } }, next: 'end' })
    expect(await runner.run(w, { runId: 'branch' })).toMatchObject({ status: 'completed', steps: 4 })
    expect(execute.mock.calls[1][0].input).toEqual({ previous: 4 })
  })
  it('preflights unknown actions before performing any effect', async () => {
    const { runner, execute } = setup(), w = graph()
    if (w.nodes[0].type === 'action') w.nodes[0].next = 'b'
    w.nodes.push({ id: 'b', type: 'action', actionId: 'unregistered', input: {}, next: 'end' })
    expect(await runner.run(w, { runId: 'r' })).toMatchObject({ status: 'halted', result: { status: 'denied', code: 'unregistered_action' } })
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects revision mismatch, cancellation, invalid inputs and denied permissions without effects', async () => {
    const { runner, execute } = setup(undefined, { authorize: async () => 'deny' })
    expect(await runner.run(graph(), { runId: 'r', expectedWorkflowRevision: 2 })).toMatchObject({ code: 'revision_conflict' })
    expect(await runner.run(graph(), { runId: 'r', signal: AbortSignal.abort() })).toMatchObject({ code: 'cancelled' })
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ result: { code: 'policy_denied' } })
    expect(execute).not.toHaveBeenCalled()
  })
  it('never dispatches the same claimed action twice, including concurrent attempts', async () => {
    const { runner, execute } = setup()
    const results = await Promise.all([runner.run(graph(), { runId: 'r' }), runner.run(graph(), { runId: 'r' })])
    expect(results.map(r => r.status).sort()).toEqual(['completed', 'halted'])
    expect(execute).toHaveBeenCalledOnce()
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ result: { status: 'unknown' } })
  })
  it.each<ActionResult>([
    { status: 'accepted', jobId: 'job-1' },
    { status: 'needs_confirmation', confirmationId: 'confirm', summary: 'Send message?', expiresAt: '2099-01-01T00:00:00Z' },
    { status: 'denied', code: 'permission_denied' },
    { status: 'failed', code: 'network', retryable: true },
  ])('stops without polling/retry for $status', async result => {
    const { runner, execute } = setup(vi.fn(async () => result))
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ status: 'halted', result })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('treats rejected or malformed post-dispatch results as unknown without exposing exceptions', async () => {
    for (const execute of [vi.fn(async () => { throw new Error('secret-body') }), vi.fn(async () => ({ status: 'succeeded', output: undefined } as unknown as ActionResult))]) {
      const { runner } = setup(execute)
      const result = await runner.run(graph(), { runId: 'r' })
      expect(result).toMatchObject({ result: { status: 'unknown' } })
      expect(JSON.stringify(result)).not.toContain('secret-body')
      await runner.run(graph(), { runId: 'r' })
      expect(execute).toHaveBeenCalledOnce()
    }
  })
  it('bounds non-cooperative actions and authorization', async () => {
    const execute = vi.fn(() => new Promise<ActionResult>(() => undefined))
    const { runner } = setup(execute, { actionTimeoutMs: 10 })
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ result: { status: 'unknown' } })
    const blocked = setup(undefined, { authorize: () => new Promise(() => undefined), actionTimeoutMs: 10 })
    expect(await blocked.runner.run(graph(), { runId: 'r' })).toMatchObject({ result: { code: 'authorization_unavailable' } })
    expect(blocked.execute).not.toHaveBeenCalled()
  })
  it('fails closed on uncertain durable journal claims', async () => {
    const { runner, execute } = setup(undefined, { journal: { claim: async () => { throw new Error('database') } } })
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ result: { status: 'unknown' } })
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects illegal limits and duplicate registry IDs', () => {
    const { registry, journal, authorize } = setup()
    for (const actionTimeoutMs of [NaN, 0, -1, Infinity, 60001]) expect(() => new WorkflowRunner({ registry, journal, authorize, actionTimeoutMs })).toThrow()
    expect(() => registry.register({ id: 'test.read', effect: 'read', validateInput: () => true, execute: async () => ({ status: 'succeeded', output: null }) })).toThrow()
  })
  it('enforces step bounds and does not mutate graph input through adapters', async () => {
    const { runner } = setup(undefined, { maxSteps: 1 })
    expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ code: 'step_limit' })
    const w = graph()
    const mutation = setup(vi.fn(async (request: NativeActionRequest): Promise<ActionResult> => { (request.input as Record<string, Json>).value = 99; return { status: 'succeeded', output: null } }))
    await mutation.runner.run(w, { runId: 'r' })
    expect(w.nodes[0]).toMatchObject({ input: { value: 4 } })
  })
})
