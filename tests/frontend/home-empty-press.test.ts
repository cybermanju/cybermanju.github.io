// CyberManju OS — Empty Home canvas gesture regression tests.
// Role: verify real-picker holds cannot hijack controls, swipes, or multitouch.
// Exports: Vitest suite. Integrates: useHomeEmptyPress with lifecycle stubs.
// Contracts: gesture cleanup and post-hold click suppression stay app-local.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const hooks = vi.hoisted(() => ({ mount: [] as (() => void)[], unmount: [] as (() => void)[] }))
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: (fn: () => void) => hooks.mount.push(fn), onUnmounted: (fn: () => void) => hooks.unmount.push(fn) }))
import { useHomeEmptyPress } from '@/composables/useHomeEmptyPress'
const listeners = new Map<string, () => void>()
beforeEach(() => {
  vi.useFakeTimers(); hooks.mount.length = 0; hooks.unmount.length = 0; listeners.clear()
  const source = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
  vi.stubGlobal('window', source); vi.stubGlobal('document', source)
})
afterEach(() => { hooks.unmount.forEach(fn => fn()); vi.useRealTimers(); vi.unstubAllGlobals() })
function fixture() {
  const open = vi.fn(); let enabled = true
  const press = useHomeEmptyPress(open, () => enabled)
  hooks.mount.forEach(fn => fn())
  const event = (occupied = false, props = {}) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: 100, clientY: 100, target: { closest: () => occupied ? {} : null }, ...props }) as unknown as PointerEvent
  return { open, press, event, disable: () => { enabled = false } }
}
describe('empty-space Home long press', () => {
  it('opens once after 550ms, never on a normal click', () => {
    const { press, event, open } = fixture()
    press.down(event()); vi.advanceTimersByTime(549); expect(open).not.toHaveBeenCalled()
    press.cancel(); vi.advanceTimersByTime(1000); expect(open).not.toHaveBeenCalled()
    press.down(event()); vi.advanceTimersByTime(550); expect(open).toHaveBeenCalledOnce()
  })
  it('does not arm on app/widget/control descendants or nonprimary/right click', () => {
    const { press, event, open } = fixture()
    for (const e of [event(true), event(false, { isPrimary: false }), event(false, { button: 2 })]) { press.down(e); vi.advanceTimersByTime(600) }
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['move', 'multitouch', 'pointercancel', 'pointerup', 'blur', 'visibilitychange', 'unmount', 'blocked'])('cancels a pending hold on %s', reason => {
    const { press, event, open, disable } = fixture(); press.down(event())
    if (reason === 'move') press.move(event(false, { clientX: 111 }))
    else if (reason === 'multitouch') press.touch({ touches: { length: 2 } } as TouchEvent)
    else if (reason === 'unmount') hooks.unmount.forEach(fn => fn())
    else if (reason === 'blocked') disable()
    else listeners.get(reason)!()
    vi.advanceTimersByTime(600); expect(open).not.toHaveBeenCalled()
  })
  it('consumes the release click and deduplicates Android contextmenu', () => {
    const { press, event, open } = fixture(); press.down(event()); vi.advanceTimersByTime(550)
    const e = { ...event(), detail: 1, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as MouseEvent
    press.context(e); press.click(e)
    expect(open).toHaveBeenCalledOnce(); expect(e.preventDefault).toHaveBeenCalled(); expect(e.stopImmediatePropagation).toHaveBeenCalledOnce()
    press.newPointer(event()); vi.mocked(e.preventDefault).mockClear(); press.click(e); expect(e.preventDefault).not.toHaveBeenCalled()
    vi.advanceTimersByTime(701); vi.mocked(e.preventDefault).mockClear(); press.click(e); expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
