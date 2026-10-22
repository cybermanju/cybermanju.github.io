// CyberManju OS — Swipe ownership (tests/frontend/swipe-ownership.test.ts).
// Role: prove DOM ownership, cancellation, capture listeners and cleanup for shell gestures.
// Exports: none.
// Integrates: Vitest, useSwipe composable.
// Contracts: a gesture is an atomic session; excluded/cancelled sessions cannot leak shell callbacks.
import { afterEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({ mounted: null as null | (() => void), unmounted: null as null | (() => void) }))
vi.mock('vue', () => ({
  onMounted: (fn: () => void) => { lifecycle.mounted = fn },
  onUnmounted: (fn: () => void) => { lifecycle.unmounted = fn },
}))
import { useSwipe } from '../../src/composables/useSwipe'

class FakeTarget {
  listeners = new Map<string, Array<{ fn: EventListener; capture: boolean }>>()
  addEventListener(type: string, fn: EventListener, options?: boolean | AddEventListenerOptions) {
    const list = this.listeners.get(type) ?? []
    list.push({ fn, capture: options === true || (typeof options === 'object' && options.capture === true) })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, fn: EventListener, options?: boolean | EventListenerOptions) {
    const capture = options === true || (typeof options === 'object' && options.capture === true)
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x.fn !== fn || x.capture !== capture))
  }
  fire(type: string, event: Record<string, unknown>) {
    for (const { fn } of [...(this.listeners.get(type) ?? [])]) fn(event as Event)
  }
  count() { return [...this.listeners.values()].reduce((n, x) => n + x.length, 0) }
}
const pointer = (pointerId: number, x: number, target: { closest: (s: string) => unknown } = { closest: () => null }, pointerType = 'touch') => ({ pointerId, pointerType, clientX: x, clientY: 300, target })
let oldWindow: typeof window
let win: FakeTarget
let root: FakeTarget & { clientWidth: number; clientHeight: number }
let unmount: (() => void) | null
function setup(onSwipe = vi.fn()) {
  win = new FakeTarget()
  oldWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
  root = Object.assign(new FakeTarget(), { clientWidth: 400, clientHeight: 800 })
  lifecycle.mounted = null; lifecycle.unmounted = null; unmount = null
  useSwipe({ value: root as unknown as HTMLElement }, {
    threshold: 30, onSwipe, onTwoFingerSwipe: onSwipe, onThreeFingerSwipe: onSwipe, onFourFingerSwipe: onSwipe,
  })
  lifecycle.mounted?.(); unmount = lifecycle.unmounted
  return onSwipe
}
function down(id: number, x: number, excluded = false, type = 'touch') {
  const target = { closest: (selector: string) => excluded && selector.includes('.home-studio') ? {} : null }
  root.fire('pointerdown', pointer(id, x, target, type))
}
function up(id: number, x: number) { win.fire('pointerup', pointer(id, x)) }
afterEach(() => { unmount?.(); Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow }) })

describe('shell swipe session ownership', () => {
  it('lets Home own an excluded pointer and suppresses the entire mixed chord', () => {
    const swipe = setup()
    down(1, 100, true); down(2, 100); up(1, 180); up(2, 180)
    expect(swipe).not.toHaveBeenCalled()
  })
  it('cancels an already-started shell chord when the second finger starts in Home', () => {
    const swipe = setup()
    down(1, 100); down(2, 200, true); up(1, 180); up(2, 280)
    expect(swipe).not.toHaveBeenCalled()
    down(3, 100); up(3, 160)
    expect(swipe).toHaveBeenCalledOnce()
  })
  it('retains explicit surface and terminal exclusion without changing their contract', () => {
    const swipe = setup()
    for (const selector of ['[data-shell-gesture-exclude]', '.terminal-gesture-exclude']) {
      root.fire('pointerdown', pointer(1, 100, { closest: s => s.includes(selector) ? {} : null }))
      up(1, 180)
    }
    expect(swipe).not.toHaveBeenCalled()
  })
  it('does not let a finger joining after the first excluded finger lifts escape the session', () => {
    const swipe = setup()
    down(1, 100, true); down(2, 100); up(1, 100); down(3, 100); up(3, 180); up(2, 180)
    expect(swipe).not.toHaveBeenCalled()
    down(3, 100); up(3, 160)
    expect(swipe).toHaveBeenCalledOnce()
  })
  it('tracks releases outside the root, ignores mouse, and uses capture listeners', () => {
    const swipe = setup()
    expect(root.listeners.get('pointerdown')?.[0]?.capture).toBe(true)
    expect(win.listeners.get('pointerup')?.[0]?.capture).toBe(true)
    down(1, 100, false, 'mouse'); up(1, 200); expect(swipe).not.toHaveBeenCalled()
    down(2, 100); win.fire('pointermove', pointer(2, 160)); up(2, 160)
    expect(swipe).toHaveBeenCalledOnce()
  })
  it('blocks a cancelled session until every current/new pointer is released', () => {
    const swipe = setup()
    down(1, 100); down(2, 200)
    win.fire('pointercancel', pointer(1, 100)); down(3, 100); up(1, 100); up(3, 180); up(2, 280)
    expect(swipe).not.toHaveBeenCalled()
    down(4, 100); up(4, 160); expect(swipe).toHaveBeenCalledOnce()
  })
  it('clears excluded ownership on blur so a new session works', () => {
    const swipe = setup()
    down(1, 100, true); win.fire('blur', {})
    down(2, 100); up(2, 160)
    expect(swipe).toHaveBeenCalledOnce()
  })
  it('removes every installed listener on unmount', () => {
    setup(); expect(root.count() + win.count()).toBeGreaterThan(0)
    unmount?.()
    expect(root.count() + win.count()).toBe(0)
    unmount = null
  })
})
