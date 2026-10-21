// CyberManju OS — External search link regressions (tests/frontend/search-external.test.ts).
// Role: verify browser and native URL handoff without unsafe navigation fallbacks.
// Exports: Vitest regression suites; Integrates: searchExternal and mocked Tauri openers.
// Contracts: preserve browser gestures and reject unsafe or credentialed URLs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  android: false,
  tauri: false,
  invocations: [] as Array<[string, Record<string, unknown> | undefined]>,
  shellOpen: vi.fn((_url: string) => Promise.resolve()),
}))

vi.mock('@/composables/useTauri', () => ({
  isAndroidApp: () => mocks.android,
  isTauri: () => mocks.tauri,
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    mocks.invocations.push([cmd, args])
    return Promise.resolve(null)
  },
}))

vi.mock('@tauri-apps/plugin-shell', () => ({ open: mocks.shellOpen }))

import { handleSearchLink, openSearchLink, searchLinkBehavior } from '@/utils/searchExternal'

function click(options: Partial<MouseEvent> = {}): { event: MouseEvent; prevented: () => boolean } {
  let wasPrevented = false
  const event = {
    button: 0,
    detail: 1,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => { wasPrevented = true },
    ...options,
  } as MouseEvent
  return { event, prevented: () => wasPrevented }
}

beforeEach(() => {
  mocks.android = false
  mocks.tauri = false
  mocks.invocations.length = 0
  mocks.shellOpen.mockReset().mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllGlobals())

describe('searchLinkBehavior', () => {
  it('distinguishes browser tabs from native external browsers', () => {
    expect(searchLinkBehavior()).toBe('browser-tab')
    mocks.tauri = true
    expect(searchLinkBehavior()).toBe('external-browser')
    mocks.android = true
    expect(searchLinkBehavior()).toBe('external-browser')
  })
})

describe('handleSearchLink', () => {
  it.each([
    ['primary', { button: 0, detail: 1 }],
    ['keyboard activation', { button: 0, detail: 0 }],
    ['ctrl-click', { button: 0, ctrlKey: true }],
    ['meta-click', { button: 0, metaKey: true }],
    ['shift-click', { button: 0, shiftKey: true }],
    ['middle-click', { button: 1 }],
  ])('leaves browser %s to native target=_blank handling', async (_name, options) => {
    const { event, prevented } = click(options)
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    await handleSearchLink(event, 'https://example.com/search?q=cybermanju')

    expect(prevented()).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(mocks.shellOpen).not.toHaveBeenCalled()
    expect(mocks.invocations).toEqual([])
  })

  it.each([
    ['primary', { button: 0, detail: 1 }],
    ['keyboard activation', { button: 0, detail: 0 }],
    ['ctrl-click', { button: 0, ctrlKey: true }],
    ['meta-click', { button: 0, metaKey: true }],
    ['shift-click', { button: 0, shiftKey: true }],
    ['middle-click', { button: 1 }],
  ])('intercepts native %s and hands the safe URL to the system browser', async (_name, options) => {
    mocks.tauri = true
    const { event, prevented } = click(options)
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    await handleSearchLink(event, 'https://example.com/article')

    expect(prevented()).toBe(true)
    expect(mocks.shellOpen).toHaveBeenCalledTimes(1)
    expect(mocks.shellOpen).toHaveBeenCalledWith('https://example.com/article')
    expect(open).not.toHaveBeenCalled()
  })

  it('routes Android links through the Intent opener and prevents WebView navigation', async () => {
    mocks.android = true
    mocks.tauri = true
    const { event, prevented } = click({ ctrlKey: true })
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    await handleSearchLink(event, 'https://example.com/android')

    expect(prevented()).toBe(true)
    expect(mocks.invocations).toEqual([['launcher_open_url', { url: 'https://example.com/android' }]])
    expect(mocks.shellOpen).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('suppresses invalid anchor navigation and rejects unsafe or credentialed URLs', async () => {
    const { event, prevented } = click()
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    await expect(handleSearchLink(event, 'javascript:alert(1)')).rejects.toThrow(/credential-free HTTP\(S\)/)
    expect(prevented()).toBe(true)
    await expect(openSearchLink('https://user:password@example.com/private')).rejects.toThrow(/credential-free HTTP\(S\)/)
    expect(open).not.toHaveBeenCalled()
    expect(mocks.shellOpen).not.toHaveBeenCalled()
    expect(mocks.invocations).toEqual([])
  })
})

describe('openSearchLink', () => {
  it('opens synchronously in a new tab from a browser user gesture', async () => {
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    const pendingOpen = openSearchLink('https://example.com/answer')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/answer', '_blank', 'noopener,noreferrer')
    await pendingOpen
  })

  it('does not turn native opener failures into unsafe WebView fallbacks', async () => {
    mocks.tauri = true
    const error = new Error('system browser denied this link')
    mocks.shellOpen.mockRejectedValueOnce(error)
    const open = vi.fn(() => null)
    vi.stubGlobal('window', { open })

    await expect(openSearchLink('https://example.com/native-failure')).rejects.toBe(error)
    expect(mocks.shellOpen).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })
})
