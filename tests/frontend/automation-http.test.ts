// CyberManju OS — automation HTTP tests (tests/frontend/automation-http.test.ts).
// Role: verify secure workflow HTTP handler behavior without live network access.
// Exports: none (Vitest suite).
// Integrates: src/automation/http.ts using mocked Fetch and streamed response bodies.
// Contracts: no redirect following; HTTPS allowlist does not pin DNS (native transport responsibility).
import { describe, expect, it, vi } from 'vitest'
import { createHttpHandler } from '../../src/automation/http'

const stream = (chunks: string[], delay = 0) => new ReadableStream<Uint8Array>({
  async start(controller) { for (const chunk of chunks) { if (delay) await new Promise(r => setTimeout(r, delay)); controller.enqueue(new TextEncoder().encode(chunk)) } controller.close() },
})
const response = (body = 'ok', status = 200, contentType = 'text/plain') => new Response(body, { status, headers: { 'content-type': contentType, 'set-cookie': 'secret=hidden' } })
const origin = 'https://api.example.test'

describe('automation HTTP transport', () => {
  it('performs allowlisted request and returns only content-type plus bounded body', async () => {
    const fetcher = vi.fn(async () => response('hello', 201)) as unknown as typeof fetch
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher })
    expect(await run({ url: `${origin}/v1`, method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'data' })).toEqual({ status: 201, headers: { 'content-type': 'text/plain' }, body: 'hello' })
    expect(fetcher).toHaveBeenCalledWith(`${origin}/v1`, expect.objectContaining({ redirect: 'error', method: 'POST' }))
  })
  it('rejects non-HTTPS, credentials, fragments, unlisted origin and redirect; never follows redirect', async () => {
    const fetcher = vi.fn(async () => response('', 302)) as unknown as typeof fetch
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher })
    for (const url of ['http://api.example.test/a', 'https://user:pw@api.example.test/a', `${origin}/a#frag`, 'https://other.test/a']) await expect(run({ url })).rejects.toThrow()
    await expect(run({ url: origin })).rejects.toThrow('network_error')
    expect(fetcher).toHaveBeenCalledTimes(1)
    // Origin allowlisting alone is not DNS pinning; native networking must enforce destination IP policy.
  })
  it('resolves Authorization only from secretRef and does not leak resolver failure', async () => {
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch
    const resolveSecret = vi.fn(async (ref: string) => `Bearer ${ref}-value`)
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: fetcher, resolveSecret })
    await run({ url: origin, headers: { Authorization: { secretRef: 'vault-key' } } })
    expect(resolveSecret).toHaveBeenCalledWith('vault-key')
    expect(fetcher).toHaveBeenCalledWith(`${origin}/`, expect.objectContaining({ headers: expect.any(Headers) }))
    const failed = createHttpHandler({ allowedOrigins: [origin], resolveSecret: async () => { throw new Error('TOPSECRET') } })
    await expect(failed({ url: origin, headers: { authorization: { secretRef: 'k' } } })).rejects.toThrow('secret_unavailable')
    await expect(run({ url: origin, headers: { authorization: 'Bearer plaintext' } })).rejects.toThrow('secret_denied')
  })
  it('rejects unsafe method/header and CRLF injection', async () => {
    const run = createHttpHandler({ allowedOrigins: [origin], fetch: vi.fn(async () => response()) as unknown as typeof fetch })
    await expect(run({ url: origin, method: 'TRACE' })).rejects.toThrow('method_denied')
    for (const name of ['Host', 'Cookie', 'X-Anything']) await expect(run({ url: origin, headers: { [name]: 'x' } })).rejects.toThrow('header_denied')
    await expect(run({ url: origin, headers: { accept: 'ok\r\nInjected: yes' } })).rejects.toThrow('header_denied')
  })
  it('rejects request and streamed response beyond configured byte ceilings', async () => {
    const run = createHttpHandler({ allowedOrigins: [origin], maxRequestBytes: 3, maxResponseBytes: 3, fetch: vi.fn(async () => new Response(stream(['ab', 'cd']))) as unknown as typeof fetch })
    await expect(run({ url: origin, method: 'POST', body: 'four' })).rejects.toThrow('request_too_large')
    await expect(run({ url: origin })).rejects.toThrow('response_too_large')
  })
  it('validates config numbers, defaults and clamps max timeout to hard ceiling', () => {
    expect(() => createHttpHandler({ allowedOrigins: [origin], maxResponseBytes: Number.NaN })).toThrow('invalid_config')
    expect(() => createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 0 })).toThrow('invalid_config')
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch
    const run = createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 999999, fetch: fetcher })
    return run({ url: origin, timeoutMs: 999999 }).then(() => expect(fetcher).toHaveBeenCalled())
  })
  it('times out during response body consumption and honors external abort', async () => {
    const delayed = new Response(stream(['late'], 50))
    const timed = createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 10, fetch: vi.fn(async () => delayed) as unknown as typeof fetch })
    await expect(timed({ url: origin })).rejects.toThrow('timeout')
    const controller = new AbortController()
    const slow = createHttpHandler({ allowedOrigins: [origin], fetch: vi.fn(async () => new Response(stream(['wait'], 500))) as unknown as typeof fetch })
    const pending = slow({ url: origin }, controller.signal)
    setTimeout(() => controller.abort(), 5)
    await expect(pending).rejects.toThrow('aborted')
  })
  it('bounds pending secret resolution and snapshots the resolver at construction', async () => {
    const never = new Promise<string>(() => undefined)
    const resolver = vi.fn(() => never)
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch
    const run = createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 10, resolveSecret: resolver, fetch: fetcher })
    const pending = run({ url: origin, headers: { authorization: { secretRef: 'vault:key' } } })
    await expect(pending).rejects.toThrow('timeout')
    expect(fetcher).not.toHaveBeenCalled()
    const captured = vi.fn(async () => 'Bearer snapshot')
    const options = { allowedOrigins: [origin], resolveSecret: captured, fetch: fetcher }
    const snapshotRun = createHttpHandler(options)
    options.resolveSecret = vi.fn(async () => 'Bearer changed')
    await snapshotRun({ url: origin, headers: { authorization: { secretRef: 'key' } } })
    expect(captured).toHaveBeenCalledOnce()
  })
  it('bounds a non-cooperative fetch and skips fetch for a pre-aborted signal', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
    const run = createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 10, fetch: fetcher })
    await expect(run({ url: origin })).rejects.toThrow('timeout')
    const controller = new AbortController()
    controller.abort()
    await expect(run({ url: origin }, controller.signal)).rejects.toThrow('aborted')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('cancels a pending response reader on timeout without waiting for cancellation', async () => {
    let cancelCalled = false
    const body = new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => undefined) },
      cancel() { cancelCalled = true; return new Promise<void>(() => undefined) },
    })
    const run = createHttpHandler({ allowedOrigins: [origin], maxTimeoutMs: 10, fetch: vi.fn(async () => new Response(body)) as unknown as typeof fetch })
    await expect(run({ url: origin })).rejects.toThrow('timeout')
    expect(cancelCalled).toBe(true)
  })
})
