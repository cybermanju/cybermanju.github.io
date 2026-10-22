// CyberManju OS — transport target, authentication and replay regression tests.
// Contracts: explicit targets never fall back; unsafe requests are submitted once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureServerUrlReachable, getServerUrl, invoke, isStaticHost, setServerUrl } from '@/composables/useTauri'
import { useTransport } from '@/composables/useTransport'

const nativeInvoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeInvoke }))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  vi.stubEnv('VITE_TRANSPORT', '')
  vi.stubGlobal('window', { __TAURI__: false, location: { origin: 'https://dashboard.example', hostname: 'dashboard.example', port: '' } })
  setServerUrl('')
  nativeInvoke.mockReset()
})
afterEach(() => {
  setServerUrl('')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('dashboard classification and target preservation', () => {
  it('classifies a clean HTTPS dashboard as REST before authentication', async () => {
    expect(isStaticHost()).toBe(false)
    expect(useTransport().backend).toBe('rest')
    const fetchMock = vi.fn(async () => json({ bootstrap_required: true }))
    vi.stubGlobal('fetch', fetchMock)
    await invoke('auth_status')
    expect(fetchMock).toHaveBeenCalledWith('https://dashboard.example/api/auth/status', expect.anything())
  })
  it('keeps explicit static builds and GitHub Pages local', () => {
    vi.stubEnv('VITE_TRANSPORT', 'wasm')
    expect(isStaticHost()).toBe(true)
    vi.stubEnv('VITE_TRANSPORT', '')
    vi.stubGlobal('window', { location: { origin: 'https://owner.github.io', hostname: 'owner.github.io', port: '' } })
    expect(isStaticHost()).toBe(true)
  })
  it('preserves an unavailable selected endpoint and fails before any local write', async () => {
    setServerUrl('https://offline.example')
    const fetchMock = vi.fn(async () => json({ service: 'other' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(ensureServerUrlReachable()).resolves.toBe(false)
    expect(getServerUrl()).toBe('https://offline.example')
    await expect(invoke('os_write', { path: '/note', content: 'private' })).rejects.toThrow('not redirected')
    expect(isStaticHost()).toBe(false)
    expect(nativeInvoke).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.every(call => String(call[0]).endsWith('/api/health'))).toBe(true)
  })
  it.each([401, 403, 429, 500])('does not redirect remote HTTP %s to native storage', async status => {
    vi.stubGlobal('window', { __TAURI__: {}, location: { port: '' }, dispatchEvent: vi.fn() })
    vi.stubGlobal('navigator', { userAgent: 'desktop' })
    setServerUrl('https://remote.example')
    const fetchMock = vi.fn(async () => json({ message: 'denied' }, status))
    vi.stubGlobal('fetch', fetchMock)
    await expect(invoke('list_files')).rejects.toThrow(status === 401 || status === 403 ? 'auth:' : 'denied')
    expect(nativeInvoke).not.toHaveBeenCalled()
    expect(getServerUrl()).toBe('https://remote.example')
  })
  it('does not redirect an unavailable remote read to the native database', async () => {
    vi.stubGlobal('window', { __TAURI__: {}, location: { port: '' }, dispatchEvent: vi.fn() })
    setServerUrl('https://remote.example')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(invoke('list_files')).rejects.toThrow('network:')
    expect(nativeInvoke).not.toHaveBeenCalled()
  })
})

describe('no automatic mutation or AI replay', () => {
  it.each(['os_write', 'start_agent_run'])('submits %s only once when the response is lost', async cmd => {
    const fetchMock = vi.fn(async () => { throw new TypeError('connection lost after submission') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(invoke(cmd, { path: '/note', content: 'hello', prompt: 'run' })).rejects.toThrow('network:')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(nativeInvoke).not.toHaveBeenCalled()
  })
  it('does not retry a mutation when its successful response body stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ({
      ok: true, status: 200,
      text: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)
    const pending = expect(invoke('os_write', { path: '/note', content: 'hello' })).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not retry a mutation after a transient HTTP response', async () => {
    const fetchMock = vi.fn(async () => json({ message: 'rate_limited: busy' }, 429))
    vi.stubGlobal('fetch', fetchMock)
    await expect(invoke('start_agent_run', { prompt: 'run' })).rejects.toThrow('rate_limited:')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('still retries safe reads once', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json({ ready: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(invoke('get_sync_status')).resolves.toEqual({ ready: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
