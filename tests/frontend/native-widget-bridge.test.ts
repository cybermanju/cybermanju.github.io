// CyberManju OS — Native widget bridge tests.
// Role: regressions for safe native command handling and user-confirmed mutations.
// Exports: none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { invokeMock, androidFlag } = vi.hoisted(() => ({ invokeMock: vi.fn(), androidFlag: { value: false } }))
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => androidFlag.value, isTauri: () => androidFlag.value }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
import { createWidgetRequest, useAndroidWidgets, widgetConfirmation } from '@/composables/useAndroidWidgets'

const reply = (action: string, extra = {}) => ({ ok: true, action, viewport: { widthDp: 400, heightDp: 800 }, ...extra })
describe('native widget bridge', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-01T00:00:00Z')); invokeMock.mockReset(); androidFlag.value = false })
  afterEach(() => { vi.useRealTimers() })

  it('times out once and does not repeat a late transport; eventual completion is retained only by the original promise', async () => {
    let finish!: (value: { ok: boolean; action: string; viewport: { widthDp: number; heightDp: number } }) => void
    const transport = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const request = createWidgetRequest(transport, 100)
    const pending = request('add', {})
    const rejected = expect(pending).rejects.toThrow(/timeout/)
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(transport).toHaveBeenCalledTimes(1)
    const late = { ok: true, action: 'add', viewport: { widthDp: 1, heightDp: 2 } }
    finish(late)
    await Promise.resolve()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('returns the transport result unchanged when it finishes before the deadline', async () => {
    const value = reply('list', { widgets: [] })
    const transport = vi.fn().mockResolvedValue(value)
    await expect(createWidgetRequest(transport, 100)('list', {})).resolves.toBe(value)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('propagates a transport error without retrying', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('host failure'))
    await expect(createWidgetRequest(transport, 100)('configure', {})).rejects.toThrow('host failure')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('sets userInitiated confirmation to exactly four seconds using the current clock', () => {
    expect(widgetConfirmation()).toEqual({ userInitiated: true, expiresAt: Date.now() + 4000 })
  })

  it('does not call core.invoke when unsupported', async () => {
    const bridge = useAndroidWidgets()
    expect(bridge.supported).toBe(false)
    expect(await bridge.refresh()).toBe(false)
    expect(await bridge.mutate('add', {}, widgetConfirmation())).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('refreshes and mutates through android_widget_command; add timeout only performs a status list, never another add', async () => {
    androidFlag.value = true
    invokeMock.mockImplementation((command: string, { action }: { action: string }) => {
      if (command !== 'android_widget_command') throw new Error(`unexpected ${command}`)
      if (action === 'add') return new Promise(() => {})
      return Promise.resolve(reply(action, action === 'list' ? { widgets: [] } : {}))
    })
    const bridge = useAndroidWidgets()
    expect(await bridge.refresh()).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('android_widget_command', { action: 'list', payload: {} })
    const mutation = bridge.mutate('add', { provider: 'example.Widget' }, widgetConfirmation())
    await vi.advanceTimersByTimeAsync(8000)
    expect(await mutation).toBe(false)
    expect(invokeMock.mock.calls.map(([_, arg]) => (arg as { action: string }).action)).toEqual(['list', 'add', 'list'])
    expect(bridge.error.value).toMatch(/no action was repeated/i)
  })

  it('sends cancel as a confirmed command with its payload', async () => {
    androidFlag.value = true
    invokeMock.mockImplementation(async (_command: string, { action, payload }: { action: string; payload: Record<string, unknown> }) => reply(action, action === 'list' ? { widgets: [] } : { received: payload }))
    const bridge = useAndroidWidgets()
    const confirmation = widgetConfirmation()
    expect(await bridge.mutate('cancel', { appWidgetId: 17, placementId: 'p-17' }, confirmation)).toBe(true)
    const call = invokeMock.mock.calls.find(([, arg]) => (arg as { action: string }).action === 'cancel')?.[1] as { payload: Record<string, unknown> }
    expect(call.payload).toEqual({ appWidgetId: 17, placementId: 'p-17', userInitiated: true, expiresAt: confirmation.expiresAt })
  })
})
