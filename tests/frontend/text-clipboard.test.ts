// CyberManju OS — Explicit Android clipboard adapter regressions.
// Role: verify trusted gesture gating, native ACK validation and web fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => bridge)
const browserFallback = vi.hoisted(() => vi.fn())
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: browserFallback }))

import { isAndroidClipboard, readTextClipboard, writeTextClipboard } from '@/utils/textClipboard'

const trustedClick = () => ({ isTrusted: true, type: 'click', timeStamp: performance.now() } as Event)
const untrustedClick = () => ({ isTrusted: false, type: 'click' } as Event)

beforeEach(() => {
  vi.useRealTimers()
  bridge.invoke.mockReset()
  bridge.isTauri.mockReset().mockReturnValue(true)
  browserFallback.mockReset()
  vi.stubGlobal('navigator', { userAgent: 'Android', clipboard: { readText: vi.fn().mockResolvedValue('web text') } })
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Android clipboard bridge', () => {
  it.each(['copy', 'cut'] as const)('%s accepts only exact written ACK with matching action', async action => {
    bridge.invoke.mockResolvedValue({ ok: true, action, written: true })
    expect(await writeTextClipboard(action, 'hello', trustedClick())).toBe(true)
    expect(bridge.invoke).toHaveBeenCalledTimes(1)
    expect(bridge.invoke).toHaveBeenCalledWith('android_clipboard_command', {
      action, payload: { userInitiated: true, expiresAt: expect.any(Number), text: 'hello' },
    })
  })

  it.each([
    { ok: true, action: 'copy', written: true }, { ok: true, action: 'cut', written: false },
    { ok: true, action: 'cut' }, { ok: false, action: 'cut', written: true }, null,
  ])('rejects invalid write ACK %#', async ack => {
    bridge.invoke.mockResolvedValue(ack)
    expect(await writeTextClipboard('cut', 'x', trustedClick())).toBe(false)
  })

  it('paste requires text property including empty string, and matching paste ACK', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, action: 'paste', text: '' })
    await expect(readTextClipboard(trustedClick())).resolves.toBe('')
    expect(bridge.invoke.mock.calls[0][1].payload).not.toHaveProperty('text')
    for (const ack of [{ ok: true, action: 'paste' }, { ok: true, action: 'copy', text: 'x' }, { ok: false, action: 'paste', text: 'x' }, { ok: true, action: 'paste', text: null }]) {
      bridge.invoke.mockResolvedValueOnce(ack)
      await expect(readTextClipboard(trustedClick())).rejects.toThrow('integrity:')
    }
  })

  it.each([undefined, untrustedClick(), { isTrusted: true, type: 'keydown' } as Event])('rejects absent, untrusted, and wrong-type action events (%#)', async event => {
    expect(await writeTextClipboard('copy', 'x', event)).toBe(false)
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('rejects stale and invalid event timestamps without IPC', async () => {
    for (const timeStamp of [performance.now() - 5000, NaN, Infinity, performance.now() + 5000]) {
      expect(await writeTextClipboard('copy', 'x', { isTrusted: true, type: 'click', timeStamp } as Event)).toBe(false)
    }
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'unfocused'] as const)('rejects %s document before IPC', async condition => {
    if (condition === 'hidden') vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => true })
    else vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => false })
    expect(await writeTextClipboard('copy', 'x', trustedClick())).toBe(false)
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('native rejection returns false without retry or browser fallback; paste propagates error', async () => {
    bridge.invoke.mockRejectedValue(new Error('native failure'))
    expect(await writeTextClipboard('copy', 'x', trustedClick())).toBe(false)
    expect(bridge.invoke).toHaveBeenCalledTimes(1)
    expect(browserFallback).not.toHaveBeenCalled()
    await expect(readTextClipboard(trustedClick())).rejects.toThrow('native failure')
    expect(bridge.invoke).toHaveBeenCalledTimes(2)
    expect(browserFallback).not.toHaveBeenCalled()
  })

  it('times out native call without retry/fallback', async () => {
    vi.useFakeTimers()
    bridge.invoke.mockReturnValue(new Promise(() => {}))
    const pending = writeTextClipboard('cut', 'x', trustedClick())
    await vi.advanceTimersByTimeAsync(4000)
    await expect(pending).resolves.toBe(false)
    expect(bridge.invoke).toHaveBeenCalledTimes(1)
    expect(browserFallback).not.toHaveBeenCalled()
  })

  it('sets native expiry exactly 4000ms after invocation time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    bridge.invoke.mockResolvedValue({ ok: true, action: 'copy', written: true })
    await writeTextClipboard('copy', 'x', trustedClick())
    expect(bridge.invoke.mock.calls[0][1].payload.expiresAt).toBe(Date.now() + 4000)
  })

  it('does not invoke native bridge for background/non-Android mode', async () => {
    bridge.isTauri.mockReturnValue(false)
    browserFallback.mockResolvedValue(true)
    expect(isAndroidClipboard()).toBe(false)
    await expect(writeTextClipboard('copy', 'x')).resolves.toBe(true)
    expect(browserFallback).toHaveBeenCalledWith('x')
    expect(bridge.invoke).not.toHaveBeenCalled()
    await expect(readTextClipboard()).resolves.toBe('web text')
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})

describe('web clipboard fallback', () => {
  beforeEach(() => bridge.isTauri.mockReturnValue(false))
  it('uses browser write and read implementations', async () => {
    browserFallback.mockResolvedValue(true)
    expect(await writeTextClipboard('cut', 'web')).toBe(true)
    expect(browserFallback).toHaveBeenCalledWith('web')
    await expect(readTextClipboard()).resolves.toBe('web text')
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('rejects read if browser API is unavailable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Desktop' })
    await expect(readTextClipboard()).rejects.toThrow('unsupported:')
  })
})
