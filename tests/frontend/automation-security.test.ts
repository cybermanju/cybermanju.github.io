// CyberManju OS — automation security regressions (tests/frontend/automation-security.test.ts).
// Role: Prevent leaks, replay and malformed host data at automation boundaries.
// Exports: Vitest security regression coverage.
// Integrates: Automation schema, runner, HTTP, native bridge and action adapters.
// Contracts: Secret-bearing outputs fail closed; effects are never replayed after uncertainty.
import { describe, expect, it, vi } from 'vitest'
import { copyJson, type ActionResult, type Json, type Workflow } from '../../src/automation/schema'
import { createHttpHandler } from '../../src/automation/http'
import { normalizeActionResult } from '../../src/automation/result'
import { ActionRegistry, WorkflowRunner } from '../../src/automation/runner'

const origin = 'https://api.example.test'
const graph = (): Workflow => ({ schemaVersion: 1, id: 'security', revision: 1, entryNodeId: 'a', nodes: [
  { id: 'a', type: 'action', actionId: 'test.action', input: null, next: 'end' }, { id: 'end', type: 'end' },
] })

describe('automation security boundaries', () => {
  it('rejects sparse arrays disguised with non-index keys and custom array prototypes', () => {
    const disguised = new Array(1)
    Object.defineProperty(disguised, '4294967295', { value: 'hidden', enumerable: true })
    class CustomArray extends Array {}
    expect(() => copyJson(disguised)).toThrow('invalid_json')
    expect(() => copyJson(new CustomArray(1, 2))).toThrow('invalid_json')
  })

  it('does not expose plaintext credential-shaped fields in successful outputs', () => {
    for (const output of [{ token: 'TOPSECRET' }, { nested: { Authorization: 'Bearer TOPSECRET' } }]) {
      expect(() => normalizeActionResult({ status: 'succeeded', output }, 'key')).toThrow()
    }
    expect(normalizeActionResult({ status: 'succeeded', output: { token: { secretRef: 'vault.token' } } }, 'key')).toMatchObject({ status: 'succeeded' })
  })

  it('requires a literal true journal claim before dispatch', async () => {
    const execute = vi.fn(async (): Promise<ActionResult> => ({ status: 'succeeded', output: null }))
    const registry = new ActionRegistry().register({ id: 'test.action', effect: 'write', validateInput: () => true, execute })
    for (const claim of ['true', {}, 1]) {
      const runner = new WorkflowRunner({ registry, journal: { claim: async () => claim as unknown as boolean }, authorize: async () => 'allow' })
      expect(await runner.run(graph(), { runId: 'r' })).toMatchObject({ status: 'halted', result: { status: 'unknown' } })
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('snapshots HTTP input without invoking accessors or accepting inherited fields', async () => {
    const fetcher = vi.fn(async () => new Response('ok'))
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher as unknown as typeof fetch })
    const getter = vi.fn(() => origin)
    await expect(run(Object.defineProperty({}, 'url', { get: getter, enumerable: true }))).rejects.toThrow('invalid_input')
    expect(getter).not.toHaveBeenCalled()
    await expect(run(Object.assign(Object.create({ method: 'DELETE' }), { url: origin }))).rejects.toThrow('invalid_input')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses detached HTTP header values across asynchronous secret resolution', async () => {
    let release!: (value: string) => void
    const secret = new Promise<string>(resolve => { release = resolve })
    const resolveSecret = vi.fn(() => secret)
    const fetcher = vi.fn(async () => new Response('ok'))
    const run = createHttpHandler({ allowedOrigins: [origin], resolveSecret, fetch: fetcher as unknown as typeof fetch })
    const headers = { authorization: { secretRef: 'vault.original' } }
    const pending = run({ url: origin, headers })
    headers.authorization.secretRef = 'vault.changed'
    await Promise.resolve()
    expect(resolveSecret).toHaveBeenCalledWith('vault.original')
    release('Bearer resolved-value')
    await pending
  })

  it('omits ambient browser credentials and referrer information', async () => {
    const fetcher = vi.fn(async () => new Response('ok'))
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher as unknown as typeof fetch })
    await run({ url: origin })
    expect(fetcher).toHaveBeenCalledWith(`${origin}/`, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }))
  })

  it('bounds direct data-script inputs before parsing or executing them', async () => {
    const { runDataScript } = await import('../../src/automation/actions')
    const getter = vi.fn(() => [])
    const input = Object.defineProperty({}, 'steps', { get: getter, enumerable: true }) as Json
    expect(() => runDataScript(input)).toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(() => runDataScript({ steps: [{ id: 'a', op: 'json.parse', args: [' '.repeat(300000)] }] })).toThrow('invalid_json')
  })
})

describe('automation asynchronous boundary regressions', () => {
  it('does not dispatch HTTP after cancellation in the scheduling gap', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => new Response('ok'))
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher as unknown as typeof fetch })
    const pending = run({ url: origin }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not return resolved authorization credentials echoed by the server', async () => {
    const credential = 'Bearer confidential-credential-value'
    for (const headers of [false, true]) {
      const fetcher = vi.fn(async () => new Response(headers ? 'ok' : credential, {
        headers: { 'content-type': headers ? credential : 'text/plain' },
      }))
      const run = createHttpHandler({ allowedOrigins: [origin], resolveSecret: async () => credential, fetch: fetcher as unknown as typeof fetch })
      const pending = run({ url: origin, headers: { authorization: { secretRef: 'vault.key' } } })
      await expect(pending).rejects.toThrow('secret_response')
      await pending.catch(error => expect(String(error)).not.toContain(credential))
    }
  })

  it('keeps the logical run identity stable if the caller mutates its options', async () => {
    const run = { runId: 'original' }
    const execute = vi.fn(async (): Promise<ActionResult> => ({ status: 'succeeded', output: null }))
    const registry = new ActionRegistry().register({ id: 'test.action', effect: 'write', validateInput: () => true, execute })
    const claims: string[] = []
    const runner = new WorkflowRunner({ registry, journal: { claim: async key => { claims.push(key); return true } }, authorize: async () => { run.runId = 'changed'; return 'allow' } })
    const w = graph()
    if (w.nodes[0].type === 'action') w.nodes[0].next = 'b'
    w.nodes.push({ id: 'b', type: 'action', actionId: 'test.action', input: null, next: 'end' })
    expect(await runner.run(w, run)).toMatchObject({ status: 'completed' })
    expect(claims).toEqual(['["security",1,"original","a"]', '["security",1,"original","b"]'])
  })

  it('turns secret-bearing outputs into unknown without publishing or forwarding them', async () => {
    const execute = vi.fn(async (): Promise<ActionResult> => ({ status: 'succeeded', output: { token: 'TOPSECRET' } }))
    const registry = new ActionRegistry().register({ id: 'test.action', effect: 'write', validateInput: () => true, execute })
    const runner = new WorkflowRunner({ registry, journal: { claim: async () => true }, authorize: async () => 'allow' })
    const w = graph()
    if (w.nodes[0].type === 'action') w.nodes[0].next = 'b'
    w.nodes.push({ id: 'b', type: 'action', actionId: 'test.action', input: { value: { $output: { nodeId: 'a', path: ['token'] } } }, next: 'end' })
    const result = await runner.run(w, { runId: 'r' })
    expect(result).toMatchObject({ status: 'halted', result: { status: 'unknown' } })
    expect(JSON.stringify(result)).not.toContain('TOPSECRET')
    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('automation output caps and native secrets', () => {
  it('caps the final data-script result including the duplicated last value', async () => {
    const { runDataScript } = await import('../../src/automation/actions')
    expect(() => runDataScript({ steps: [{ id: 'a', op: 'value', args: ['x'.repeat(40000)] }] })).toThrow('invalid_json')
  })

  it('rejects a secret-bearing native output even with all correlation echoes valid', async () => {
    const { registerNativeActions } = await import('../../src/automation/actions')
    const registry = new ActionRegistry()
    registerNativeActions(registry, [{ id: 'test.action', effect: 'write', validateInput: () => true }], async request => ({
      protocolVersion: request.protocolVersion, requestId: request.requestId, workflowId: request.workflowId,
      workflowRevision: request.workflowRevision, nodeId: request.nodeId, actionId: request.actionId,
      idempotencyKey: request.idempotencyKey, status: 'succeeded', output: { nested: { access_token: 'TOPSECRET' } },
    }))
    const runner = new WorkflowRunner({ registry, journal: { claim: async () => true }, authorize: async () => 'allow' })
    const result = await runner.run(graph(), { runId: 'native' })
    expect(result).toMatchObject({ status: 'halted', result: { status: 'unknown' } })
    expect(JSON.stringify(result)).not.toContain('TOPSECRET')
  })
})
