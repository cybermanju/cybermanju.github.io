// CyberManju OS — query auth stays scoped to the active provider route.
// Role: Verify provider query credentials survive browser turns and failover.
// Integrates: Vitest, useAgent and the AgentPanel caller contract.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runLocalAgent, type LocalRunOpts } from '@/composables/useAgent'
import { agentPermissionPreset } from '@/types'
const prompt = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useWasmBackend', async importOriginal => ({
  ...await importOriginal<typeof import('@/composables/useWasmBackend')>(),
  wasmAgentPrompt: prompt,
}))
const opts = (): LocalRunOpts => ({
  baseUrl: 'https://primary.example/v1?key=primary%2Bsecret', dialect: 'openAi',
  model: 'primary', headers: [], system: '', maxTurns: 3,
  permission: agentPermissionPreset('balanced'), autoApprove: true, agentKind: 'plan',
})
const done = { ok: true, turn: { content: 'done', tool_calls: [], usage: { inputTokens: 1, outputTokens: 1 } } }
beforeEach(() => { prompt.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })
it('retains the primary query credential across browser turns', async () => {
  prompt.mockResolvedValueOnce({ ok: true, turn: {
    content: '', tool_calls: [{ id: 'write-1', name: 'write', input: { path: '/note', content: 'x' } }],
    usage: { inputTokens: 1, outputTokens: 1 },
  } }).mockResolvedValueOnce(done)
  const result = await runLocalAgent(opts(), [{ role: 'user', content: 'hello' }], { inputTokens: 0, outputTokens: 0 })
  expect(result.stopped).toBe('done')
  expect(prompt).toHaveBeenCalledTimes(2)
  for (const [req] of prompt.mock.calls) expect(req.url).toBe('https://primary.example/v1/chat/completions?key=primary%2Bsecret')
})
it('uses only the fallback route own query credential after failover', async () => {
  prompt.mockResolvedValueOnce({ ok: false, error: 'auth: rejected' }).mockResolvedValueOnce(done)
  const options = opts()
  options.fallbacks = [{ label: 'fallback', baseUrl: 'https://fallback.example?api_key=fallback%2Fsecret',
    dialect: 'anthropic', model: 'fallback', headers: [] }]
  const result = await runLocalAgent(options, [{ role: 'user', content: 'hello' }], { inputTokens: 0, outputTokens: 0 })
  expect(result.stopped).toBe('done')
  expect(prompt.mock.calls.map(([req]) => req.url)).toEqual([
    'https://primary.example/v1/chat/completions?key=primary%2Bsecret',
    'https://fallback.example/v1/messages?api_key=fallback%2Fsecret',
  ])
  expect(prompt.mock.calls[1][0].url).not.toContain('primary')
})

it('accepts the caller complete endpoints unchanged for primary and fallback', async () => {
  const { localProviderEndpoint } = await import('@/composables/useAgent')
  const options = opts()
  options.requestUrl = localProviderEndpoint('https://primary.example/v1?tenant=test', 'openAi', { name: 'custom credential', value: 'primary +/secret' })
  options.fallbacks = [{ label: 'fallback', baseUrl: 'https://fallback.example',
    requestUrl: localProviderEndpoint('https://fallback.example', 'anthropic', { name: 'own_key', value: 'fallback +/secret' }),
    dialect: 'anthropic', model: 'fallback', headers: [] }]
  prompt.mockResolvedValueOnce({ ok: false, error: 'auth: rejected' }).mockResolvedValueOnce(done)
  expect((await runLocalAgent(options, [{ role: 'user', content: 'hello' }], { inputTokens: 0, outputTokens: 0 })).stopped).toBe('done')
  const urls = prompt.mock.calls.map(([req]) => req.url)
  expect(urls).toEqual([options.requestUrl, options.fallbacks[0].requestUrl])
  expect(new URL(urls[0]).searchParams.get('custom credential')).toBe('primary +/secret')
  expect(new URL(urls[0]).searchParams.get('tenant')).toBe('test')
  expect(new URL(urls[1]).searchParams.get('own_key')).toBe('fallback +/secret')
  expect(urls[1]).not.toContain('primary')
})
it.each(['throw', 'return'])('redacts custom query credentials when providers %s errors', async mode => {
  const options = opts()
  options.requestUrl = 'https://primary.example/v1/chat/completions?custom_auth=private%2Bsecret'
  const error = `invalid: failed ${options.requestUrl} private+secret`
  if (mode === 'throw') prompt.mockRejectedValueOnce(new Error(error))
  else prompt.mockResolvedValueOnce({ ok: false, error })
  const result = await runLocalAgent(options, [{ role: 'user', content: 'hello' }], { inputTokens: 0, outputTokens: 0 })
  expect(result.stopped).toBe('error')
  expect(result.error).not.toContain('private%2Bsecret')
  expect(result.error).not.toContain('private+secret')
})
it('wires only memory-local complete URLs from the actual Vue caller', async () => {
  const fs = await import('node:fs')
  const source = fs.readFileSync('src/components/AgentPanel.vue', 'utf8')
  const caller = source.slice(source.indexOf('  const fallbackRoutes: LocalFailoverRoute[] = []'), source.indexOf('// "Allow always" must survive'))
  expect(caller).toContain('localProviderEndpoint(fbase, fdialect')
  expect(caller).toContain("value: fkey")
  expect(caller).toContain('baseUrl: fbase, requestUrl,')
  expect(caller).toContain('localProviderEndpoint(base, dialect')
  expect(caller).toContain('requestUrl: url,')
  expect(caller).not.toMatch(/console\.(log|warn|error|debug)/)
  expect(caller).not.toMatch(/(?:localStorage|sessionStorage)\.setItem/)
})

it('redacts query values in form encoding without corrupting the error prefix', async () => {
  const options = opts()
  options.requestUrl = 'https://primary.example/chat/completions?custom=has+a+space&second=auth'
  prompt.mockResolvedValueOnce({ ok: false, error: `auth: ${options.requestUrl} has a space` })
  const result = await runLocalAgent(options, [{ role: 'user', content: 'hi' }], { inputTokens: 0, outputTokens: 0 })
  expect(result.error).toMatch(/^auth:/)
  expect(result.error).not.toContain('has+a+space')
  expect(result.error).not.toContain('has a space')
})
