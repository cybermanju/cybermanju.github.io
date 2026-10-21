// CyberManju OS — App screen reader state.test (tests/frontend/app-screen-reader-state.test.ts).
// Role: Vitest frontend suite.
// Exports: module root (see items below).
// Integrates: vitest, ../….
// Contracts: none special (pure logic; errors bubble to caller).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderStatus } from '../../src/utils/androidScreenReader'

const { statusCall, pollCall, startCall, stopCall, overlayCall, notificationCall } = vi.hoisted(() => ({
  statusCall: vi.fn(), pollCall: vi.fn(), startCall: vi.fn(), stopCall: vi.fn(), overlayCall: vi.fn(), notificationCall: vi.fn(),
}))
vi.mock('@/utils/androidScreenReader', () => ({
  AndroidScreenReader: class {
    status = statusCall
    poll = pollCall
    start = startCall
    stop = stopCall
    overlaySettings = overlayCall
    notificationSettings = notificationCall
  },
}))
const idle = (overlayGranted = true): ReaderStatus => ({ sessionId: null, state: 'idle', packageName: null, index: 0, total: 0, overlayGranted, packages: [], mode: null, captures: [], engine: '', limitation: '' })
const reading = (): ReaderStatus => ({ sessionId: 'session-1', state: 'reading', packageName: 'a', index: 0, total: 1, overlayGranted: true, packages: ['a'], mode: 'single', captures: [], engine: 'native', limitation: '' })
async function fresh() {
  vi.resetModules()
  const mod = await import('../../src/composables/useAppScreenReader')
  return mod.useAppScreenReader()
}
beforeEach(() => { vi.useRealTimers(); statusCall.mockReset(); pollCall.mockReset(); startCall.mockReset(); stopCall.mockReset(); overlayCall.mockReset(); notificationCall.mockReset() })
afterEach(() => vi.useRealTimers())

describe('useAppScreenReader state', () => {
  it('deduplica refresh concorrente e adota status nativo', async () => {
    let resolve!: (s: ReaderStatus) => void
    statusCall.mockImplementation(() => new Promise(r => { resolve = r }))
    const reader = await fresh()
    const one = reader.refresh(), two = reader.refresh()
    expect(statusCall).toHaveBeenCalledTimes(1)
    resolve(idle())
    await Promise.all([one, two])
    expect(reader.checked.value).toBe(true)
    expect(reader.status.value.overlayGranted).toBe(true)
    expect(reader.busy.value).toBe(false)
  })

  it('envia start explicitamente consentido, sem duplicatas, e não inicia durante busy/ativo', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue(idle())
    await reader.refresh()
    let resolve!: (s: ReaderStatus) => void
    startCall.mockImplementation(() => new Promise(r => { resolve = r }))
    const started = reader.start([' z ', 'a', 'z', '', ' a '])
    await reader.start(['other'])
    expect(startCall).toHaveBeenCalledTimes(1)
    const payload = startCall.mock.calls[0][0]
    expect(payload.packages).toEqual(['z', 'a'])
    expect(payload.mode).toBe('batch')
    expect(payload.consentDisclosure).toBe(true)
    expect(payload.expiresAt).toBeGreaterThan(Date.now())
    resolve(reading())
    await started
    expect(reader.active.value).toBe(true)
    await reader.start(['b'])
    expect(startCall).toHaveBeenCalledTimes(1)
  })

  it('bloqueia start sem overlay autorizado', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue(idle(false))
    await reader.refresh()
    await reader.start(['a'])
    expect(startCall).not.toHaveBeenCalled()
  })

  it('bloqueia start quando notificações são negadas, mas deixa o gate desconhecido ao nativo', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue({ ...idle(), notificationGranted: false })
    await reader.refresh(); await reader.start(['a'])
    expect(startCall).not.toHaveBeenCalled()
    statusCall.mockResolvedValue({ ...idle(), notificationsEnabled: false })
    await reader.refresh(); await reader.start(['a'])
    expect(startCall).not.toHaveBeenCalled()
    statusCall.mockResolvedValue(idle())
    await reader.refresh(); startCall.mockResolvedValue(reading())
    await reader.start(['a'])
    expect(startCall).toHaveBeenCalledTimes(1)
  })

  it('notification Settings reconcilia sem retry e bloqueia busy/active/uncertain', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue(idle())
    await reader.refresh()
    notificationCall.mockResolvedValue({ ...idle(), notificationGranted: true, notificationsEnabled: true })
    await reader.notificationSettings()
    expect(notificationCall).toHaveBeenCalledTimes(1)
    expect(reader.status.value.notificationGranted).toBe(true)
    vi.useFakeTimers()
    startCall.mockImplementation(() => new Promise(() => {}))
    const pendingStart = reader.start(['a'])
    await reader.notificationSettings()
    expect(notificationCall).toHaveBeenCalledTimes(1)
    const settled = expect(pendingStart).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000); await settled
    await reader.notificationSettings()
    expect(notificationCall).toHaveBeenCalledTimes(1)
    expect(reader.uncertain.value).toBe(true)
  })

  it('timeout de start mantém incerteza, não retenta, e refresh limpa a incerteza', async () => {
    vi.useFakeTimers()
    const reader = await fresh()
    statusCall.mockResolvedValue(idle())
    await reader.refresh()
    startCall.mockImplementation(() => new Promise(() => {}))
    const starting = reader.start(['a'])
    const settled = expect(starting).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
    await settled
    expect(reader.uncertain.value).toBe(true)
    await reader.start(['b'])
    expect(startCall).toHaveBeenCalledTimes(1)
    statusCall.mockResolvedValue(reading())
    await reader.refresh()
    expect(reader.uncertain.value).toBe(false)
    expect(reader.status.value.state).toBe('reading')
  })

  it('poll usa somente status autoritativo, overlay settings e stop respeitam guards', async () => {
    const reader = await fresh()
    pollCall.mockResolvedValue({ events: [], status: reading() })
    await reader.refresh(true)
    expect(reader.status.value.sessionId).toBe('session-1')
    expect(pollCall).toHaveBeenCalledTimes(1)
    await reader.overlaySettings()
    expect(overlayCall).not.toHaveBeenCalled()
    stopCall.mockResolvedValue(idle())
    await reader.stop()
    expect(stopCall).toHaveBeenCalledTimes(1)
    expect(reader.status.value.state).toBe('idle')
  })

  it('abre configurações de overlay inativo e adota o status retornado', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue(idle(false))
    await reader.refresh()
    overlayCall.mockResolvedValue(idle(true))
    await reader.overlaySettings()
    expect(overlayCall).toHaveBeenCalledTimes(1)
    expect(reader.status.value.overlayGranted).toBe(true)
  })

  it('não perde refresh solicitado enquanto Settings está ocupando a ponte', async () => {
    const reader = await fresh()
    statusCall.mockResolvedValue(idle(false))
    await reader.refresh()
    let finishSettings!: (s: ReaderStatus) => void
    overlayCall.mockImplementation(() => new Promise(r => { finishSettings = r }))
    const settings = reader.overlaySettings()
    const revalidate = reader.refresh()
    finishSettings(idle(false)) // abrir Settings, por si só, não concede overlay
    await Promise.all([settings, revalidate])
    expect(statusCall).toHaveBeenCalledTimes(2)
    expect(reader.checked.value).toBe(true)
    expect(reader.status.value.overlayGranted).toBe(false)
    expect(reader.uncertain.value).toBe(false)
  })
})
