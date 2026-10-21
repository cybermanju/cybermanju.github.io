// CyberManju OS — Automation action tests (tests/frontend/automation-actions.test.ts).
// Role: Verify constrained pipelines and explicit integration opt-ins.
// Exports: Vitest action adapter coverage.
// Integrates: Automation registry and host bridge contract.
// Contracts: No arbitrary scripts, commands, agents or native actions.
import { describe, expect, it, vi } from 'vitest'
import { createAutomationRegistry, registerNativeActions, runDataScript } from '../../src/automation/actions'
import { MemoryExecutionJournal, WorkflowRunner } from '../../src/automation/runner'
import type { ActionResult, Json, Workflow, NativeActionRequest, NativeActionResponse } from '../../src/automation/schema'

function workflow(actionId: string, input: Json): Workflow {
  return { schemaVersion: 1, id: 'adapters', revision: 1, entryNodeId: 'a', nodes: [
    { id: 'a', type: 'action', actionId, input, next: 'end' }, { id: 'end', type: 'end' },
  ] }
}
describe('constrained data scripts', () => {
  it('evaluates bounded sequential operations and backward references', () => {
    expect(runDataScript({ steps: [
      { id: 'a', op: 'text.trim', args: [' hello '] },
      { id: 'b', op: 'text.upper', args: [{ from: 'a' }] },
      { id: 'c', op: 'text.concat', args: [{ from: 'b' }, '!'] },
    ] })).toEqual({ values: { a: 'hello', b: 'HELLO', c: 'HELLO!' }, last: 'HELLO!' })
    expect(runDataScript({ steps: [{ id: 'a', op: 'math.multiply', args: [4, 3] }] })).toMatchObject({ last: 12 })
    expect(runDataScript({ steps: [{ id: 'a', op: 'json.parse', args: ['{"n":2}'] }, { id: 'b', op: 'json.stringify', args: [{ from: 'a' }] }] })).toMatchObject({ last: '{"n":2}' })
  })
  it.each([
    { steps: [{ id: 'a', op: 'eval', args: ['process.exit()'] }] },
    { steps: [{ id: 'a', op: 'shell', args: ['rm -rf /'] }] },
    { steps: [{ id: 'a', op: 'math.divide', args: [1, 0] }] },
    { steps: [{ id: 'a', op: 'text.upper', args: [{ from: 'later' }] }] },
    { steps: [{ id: 'a', op: 'value', args: [1] }, { id: 'a', op: 'value', args: [2] }] },
    { steps: [{ id: 'a', op: 'json.parse', args: ['{"__proto__":{}}'] }] },
    { steps: [{ id: 'a', op: 'json.parse', args: ['{"password":"unsafe"}'] }] },
    { steps: Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, op: 'value', args: [1] })) },
  ])('rejects unsafe or invalid pipelines', input => {
    expect(() => runDataScript(input)).toThrow()
  })
})
describe('explicit host integrations', () => {
  it('exposes only local script by default; HTTP, AI and shell are disabled', () => {
    expect(createAutomationRegistry().list()).toEqual([{ id: 'core.script', effect: 'read' }])
  })
  it('runs data scripts through the same authorized workflow runner', async () => {
    const registry = createAutomationRegistry()
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    expect(await runner.run(workflow('core.script', { steps: [{ id: 'n', op: 'math.add', args: [2, 3] }] }), { runId: 'r' })).toMatchObject({ status: 'completed', outputs: { a: { last: 5 } } })
  })
  it('only allows named cybsh commands and passes arguments as data, never command lines', async () => {
    const execute = vi.fn(async (): Promise<ActionResult> => ({ status: 'succeeded', output: null }))
    const registry = createAutomationRegistry({ cybsh: { commandIds: ['files.list'], execute } })
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    expect(await runner.run(workflow('core.cybsh', { commandId: 'shell', args: ['ls; curl evil'] }), { runId: 'deny' })).toMatchObject({ result: { code: 'invalid_input' } })
    expect(execute).not.toHaveBeenCalled()
    expect(await runner.run(workflow('core.cybsh', { commandId: 'files.list', args: ['/safe path'] }), { runId: 'allow' })).toMatchObject({ status: 'completed' })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('only invokes named AI agents and stops at asynchronous acceptance', async () => {
    const execute = vi.fn(async (): Promise<ActionResult> => ({ status: 'accepted', jobId: 'agent-job' }))
    const registry = createAutomationRegistry({ ai: { agentIds: ['assistant'], execute } })
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    expect(await runner.run(workflow('core.ai.invoke', { agentId: 'unknown', prompt: 'hello', context: null }), { runId: 'bad' })).toMatchObject({ result: { code: 'invalid_input' } })
    expect(execute).not.toHaveBeenCalled()
    expect(await runner.run(workflow('core.ai.invoke', { agentId: 'assistant', prompt: 'Summarize context', context: { title: 'test' } }), { runId: 'good' })).toMatchObject({ result: { status: 'accepted', jobId: 'agent-job' } })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('registers native capabilities explicitly and propagates expectedRevision', async () => {
    const registry = createAutomationRegistry()
    const execute = vi.fn(async (request: NativeActionRequest, _signal: AbortSignal): Promise<NativeActionResponse> => ({
      protocolVersion: request.protocolVersion, requestId: request.requestId, workflowId: request.workflowId,
      workflowRevision: request.workflowRevision, nodeId: request.nodeId, actionId: request.actionId,
      idempotencyKey: request.idempotencyKey, status: 'denied', code: 'android_permission_denied',
    }))
    registerNativeActions(registry, [{ id: 'android.example', effect: 'write', validateInput: input => input === null }], execute)
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    const w = workflow('android.example', null)
    if (w.nodes[0].type === 'action') w.nodes[0].expectedRevision = 7
    expect(await runner.run(w, { runId: 'native' })).toMatchObject({ result: { code: 'android_permission_denied' } })
    expect(execute.mock.calls[0][0]).toMatchObject({ expectedRevision: 7, actionId: 'android.example' })
  })
})
