import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AndroidApp } from '../../src/types'

const { invokeMock, androidMock, tauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), androidMock: vi.fn(() => true), tauriMock: vi.fn(() => true) }))
vi.mock('@/composables/useTauri', () => ({ invoke: invokeMock, isAndroidApp: androidMock, isTauri: tauriMock }))
const app = (packageName: string): AndroidApp => ({ packageName, label: packageName, iconBase64: '' })
async function fresh() { vi.resetModules(); return (await import('../../src/composables/useAndroidApps')).useAndroidApps() }
beforeEach(() => { invokeMock.mockReset(); vi.useRealTimers() })
afterEach(() => vi.useRealTimers())

describe('useAndroidApps timeout', () => {
  it('timeout produz erro; permite retry e resultado tardio não substitui resposta mais nova', async () => {
    vi.useFakeTimers()
    let resolveOld!: (apps: AndroidApp[]) => void
    invokeMock.mockImplementationOnce(() => new Promise(r => { resolveOld = r }))
    const catalog = await fresh()
    const old = catalog.refresh()
    const oldOutcome = expect(old).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(10_000)
    await oldOutcome
    expect(catalog.status.value).toBe('error')
    expect(catalog.lastError.value).toMatch(/timed out/i)

    invokeMock.mockResolvedValueOnce([app('new')])
    await expect(catalog.refresh()).resolves.toEqual([app('new')])
    expect(catalog.status.value).toBe('ready')
    expect(catalog.apps.value).toEqual([app('new')])

    resolveOld([app('late')])
    await Promise.resolve()
    await Promise.resolve()
    expect(catalog.apps.value).toEqual([app('new')])
    expect(catalog.status.value).toBe('ready')
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
})
