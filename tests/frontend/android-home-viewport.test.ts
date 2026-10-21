// CyberManju OS — Android home viewport tests (tests/frontend/android-home-viewport.test.ts).
// Role: Protect mobile viewport sizing across Android startup, keyboard, and resume transitions.
// Exports: none.
// Integrates: Vitest, src/composables/useMobileViewport.ts, mocked Vue lifecycle hooks.
// Contracts: Invalid startup measurements never write zero height; retries and listeners clean up.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({
  mounted: undefined as (() => void) | undefined,
  beforeUnmount: undefined as (() => void) | undefined,
}))

vi.mock('vue', () => ({
  onMounted: (callback: () => void) => { lifecycle.mounted = callback },
  onBeforeUnmount: (callback: () => void) => { lifecycle.beforeUnmount = callback },
}))

import { applyMobileViewport, useMobileViewport } from '@/composables/useMobileViewport'

type FakeRoot = HTMLElement & {
  style: {
    setProperty: ReturnType<typeof vi.fn>
    removeProperty: ReturnType<typeof vi.fn>
  }
  dataset: Record<string, string>
}

function fakeRoot() {
  const properties = new Map<string, string>()
  const root = {
    style: {
      setProperty: vi.fn((name: string, value: string) => { properties.set(name, value) }),
      removeProperty: vi.fn((name: string) => { properties.delete(name) }),
    },
    dataset: {} as Record<string, string>,
  } as FakeRoot
  return { root, properties }
}

type Listener = () => void

function eventTarget() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      const group = listeners.get(type) ?? new Set<Listener>()
      group.add(listener)
      listeners.set(type, group)
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => { listeners.get(type)?.delete(listener) }),
    dispatch(type: string) { for (const listener of [...(listeners.get(type) ?? [])]) listener() },
    listenerCount(type: string) { return listeners.get(type)?.size ?? 0 },
  }
}

function installBrowser(root: FakeRoot, initialHeight: number, initialVisibleHeight = initialHeight) {
  const winEvents = eventTarget()
  const viewportEvents = eventTarget()
  const docEvents = eventTarget()
  const visualViewport = Object.assign(viewportEvents, {
    height: initialVisibleHeight,
    offsetTop: 0,
  })
  const win = Object.assign(winEvents, {
    innerHeight: initialHeight,
    visualViewport,
  })
  let visibilityState = 'visible'
  const doc = Object.assign(docEvents, {
    documentElement: root,
    get visibilityState() { return visibilityState },
    set visibilityState(value: string) { visibilityState = value },
  })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  return { win, doc, winEvents, viewportEvents, docEvents }
}

beforeEach(() => {
  lifecycle.mounted = undefined
  lifecycle.beforeUnmount = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('applyMobileViewport', () => {
  it.each([
    ['zero layout height', 0, 0],
    ['negative layout height', -1, 0],
    ['non-finite layout height', Number.NaN, 0],
    ['infinite layout height', Number.POSITIVE_INFINITY, 0],
    ['zero visible height', 800, 0],
    ['negative visible height', 800, -1],
    ['non-finite visible height', 800, Number.NaN],
    ['infinite visible height', 800, Number.POSITIVE_INFINITY],
  ])('does not write a zero viewport for %s at startup', (_case, layoutHeight, visibleHeight) => {
    const { root } = fakeRoot()

    expect(applyMobileViewport(root, layoutHeight, visibleHeight)).toBe(false)
    expect(root.style.setProperty).not.toHaveBeenCalled()
    expect(root.dataset.mobileKeyboard).toBeUndefined()
  })

  it('preserves a previous valid viewport when measurements become hidden or invalid', () => {
    const { root, properties } = fakeRoot()
    expect(applyMobileViewport(root, 900, 900)).toBe(true)
    const previousValues = new Map(properties)
    root.style.setProperty.mockClear()

    expect(applyMobileViewport(root, 0, 0)).toBe(false)
    expect(applyMobileViewport(root, -10, 600)).toBe(false)
    expect(applyMobileViewport(root, 900, Number.NaN)).toBe(false)
    expect(properties).toEqual(previousValues)
    expect(root.style.setProperty).not.toHaveBeenCalled()
    expect(root.dataset.mobileKeyboard).toBe('false')
  })

  it('recovers with the next valid size and reports keyboard geometry', () => {
    const { root, properties } = fakeRoot()
    expect(applyMobileViewport(root, 800, 0)).toBe(false)
    expect(properties.size).toBe(0)

    expect(applyMobileViewport(root, 800, 500, 20)).toBe(true)
    expect(properties.get('--mobile-viewport-height')).toBe('500px')
    expect(properties.get('--mobile-keyboard-inset')).toBe('280px')
    expect(root.dataset.mobileKeyboard).toBe('true')
  })
})

describe('useMobileViewport lifecycle', () => {
  it('retries startup with a bounded schedule and recovers on pageshow, focus, visibility, and Android home', () => {
    vi.useFakeTimers()
    const { root, properties } = fakeRoot()
    const browser = installBrowser(root, 0, 0)
    useMobileViewport()
    expect(lifecycle.mounted).toBeTypeOf('function')
    lifecycle.mounted?.()

    expect(root.style.setProperty).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(2100)
    expect(vi.getTimerCount()).toBe(0)
    expect(root.style.setProperty).not.toHaveBeenCalled()

    browser.win.innerHeight = 900
    browser.win.visualViewport.height = 900
    browser.winEvents.dispatch('pageshow')
    expect(properties.get('--mobile-viewport-height')).toBe('900px')

    browser.win.innerHeight = 800
    browser.win.visualViewport.height = 500
    browser.win.visualViewport.offsetTop = 10
    browser.winEvents.dispatch('focus')
    expect(properties.get('--mobile-viewport-height')).toBe('500px')
    expect(properties.get('--mobile-keyboard-inset')).toBe('290px')
    expect(root.dataset.mobileKeyboard).toBe('true')

    browser.doc.visibilityState = 'hidden'
    browser.win.innerHeight = 700
    browser.win.visualViewport.height = 700
    browser.docEvents.dispatch('visibilitychange')
    expect(properties.get('--mobile-viewport-height')).toBe('500px')

    browser.doc.visibilityState = 'visible'
    browser.docEvents.dispatch('visibilitychange')
    expect(properties.get('--mobile-viewport-height')).toBe('700px')
    browser.win.innerHeight = 640
    browser.win.visualViewport.height = 640
    browser.winEvents.dispatch('cybermanju:android-home')
    expect(properties.get('--mobile-viewport-height')).toBe('640px')

    expect(browser.viewportEvents.listenerCount('resize')).toBe(1)
    expect(browser.viewportEvents.listenerCount('scroll')).toBe(1)
    expect(browser.winEvents.listenerCount('resize')).toBe(1)
  })

  it('cleans up pending retries, event listeners, and viewport styles before unmount', () => {
    vi.useFakeTimers()
    const { root, properties } = fakeRoot()
    const browser = installBrowser(root, 0, 0)
    useMobileViewport()
    lifecycle.mounted?.()
    expect(vi.getTimerCount()).toBe(1)

    lifecycle.beforeUnmount?.()
    expect(vi.getTimerCount()).toBe(0)
    expect(browser.viewportEvents.listenerCount('resize')).toBe(0)
    expect(browser.viewportEvents.listenerCount('scroll')).toBe(0)
    for (const type of ['resize', 'focus', 'pageshow', 'cybermanju:android-home']) {
      expect(browser.winEvents.listenerCount(type)).toBe(0)
    }
    expect(browser.docEvents.listenerCount('visibilitychange')).toBe(0)
    expect(root.style.removeProperty).toHaveBeenCalledWith('--mobile-viewport-height')
    expect(root.style.removeProperty).toHaveBeenCalledWith('--mobile-keyboard-inset')
    expect(properties.size).toBe(0)
    expect(root.dataset.mobileKeyboard).toBeUndefined()
  })
})
