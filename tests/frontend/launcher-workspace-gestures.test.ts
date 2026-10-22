// CyberManju OS — Launcher workspace gesture regression suite.
// Role: exercise complete touch sequences, boundary ownership and fail-closed cancellation.
// Integrates: real framework-free launcher recognizer; simulated DOM and input only.
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLauncherWorkspaceGestures } from '@/composables/useLauncherWorkspaceGestures'
const point = (y: number, x = 20, identifier = 1) => ({ identifier, clientX: x, clientY: y })
function setup(scrollTop = 0, maxScroll = 0) {
  document.body.innerHTML = '<main class="home-studio"><h2>Home</h2><div class="workspace-content"><span class="empty">Space</span></div></main>'
  const studio = document.querySelector('.home-studio')!, canvas = document.querySelector('.empty')!, scroller = document.querySelector('.workspace-content')! as HTMLElement
  Object.defineProperties(scroller, { scrollTop: { configurable: true, writable: true, value: scrollTop }, scrollHeight: { configurable: true, value: 300 + maxScroll }, clientHeight: { configurable: true, value: 300 } })
  const openDrawer = vi.fn(), openSearch = vi.fn(), progress = vi.fn(), suppressClick = vi.fn()
  let blocked = false
  const api = useLauncherWorkspaceGestures({ blocked: () => blocked, openDrawer, openSearch, progress, suppressClick })
  function event(type: string, touches: ReturnType<typeof point>[], changedTouches = touches, target: Element = canvas, cancelable = true) {
    const e = new Event(type, { bubbles: true, cancelable })
    Object.defineProperties(e, { target: { value: target }, touches: { value: touches }, changedTouches: { value: changedTouches } })
    return e as TouchEvent
  }
  const start = (y = 700, target = canvas) => api.start(event('touchstart', [point(y)], undefined, target))
  const end = (y = 570, target = canvas) => { const e = event('touchend', [], [point(y)], target); api.end(e); return e }
  return { api, event, studio, canvas, scroller, start, end, openDrawer, openSearch, progress, suppressClick, setBlocked: (value: boolean) => { blocked = value } }
}
beforeEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 }) })
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
describe('launcher workspace sequence ownership', () => {
  it('keeps search reachable below permanent bars on a short viewport', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 540 })
    const t = setup()
    vi.spyOn(t.studio, 'getBoundingClientRect').mockReturnValue({ top: 317, bottom: 462, height: 145 } as DOMRect)
    t.start(325, t.studio)
    t.end(410, t.studio)
    expect(t.openSearch).toHaveBeenCalledOnce()
    expect(t.openDrawer).not.toHaveBeenCalled()
  })

  it('commits drawer once, tracks live progress and retires before repeated end', () => {
    const t = setup(); t.start()
    const move = t.event('touchmove', [point(620)]); t.api.move(move)
    expect(move.defaultPrevented).toBe(true); expect(t.progress).toHaveBeenLastCalledWith(.1)
    expect(t.end().defaultPrevented).toBe(true); t.end()
    expect(t.openDrawer).toHaveBeenCalledOnce(); expect(t.openSearch).not.toHaveBeenCalled()
    expect(t.progress).toHaveBeenLastCalledWith(0)
  })
  it('commits search from coalesced final movement only at end', () => {
    const t = setup(); t.start(100); expect(t.openSearch).not.toHaveBeenCalled()
    expect(t.end(190).defaultPrevented).toBe(true)
    expect(t.openSearch).toHaveBeenCalledOnce(); expect(t.openDrawer).not.toHaveBeenCalled()
  })
  it('permits tiny horizontal jitter before a deliberate vertical swipe', () => {
    const t = setup(); t.start(); t.api.move(t.event('touchmove', [point(700, 23)])); t.end()
    expect(t.openDrawer).toHaveBeenCalledOnce()
  })
  it('leaves taps and neutral-zone starts alone', () => {
    const t = setup(); t.start(); expect(t.end(700).defaultPrevented).toBe(false)
    t.start(400); t.end(200)
    expect(t.openDrawer).not.toHaveBeenCalled(); expect(t.openSearch).not.toHaveBeenCalled(); expect(t.suppressClick).not.toHaveBeenCalled()
  })
  it('does not commit on a wrong-finger or partial release, even after claiming', () => {
    const t = setup(); t.start(); t.api.move(t.event('touchmove', [point(560)]))
    t.api.end(t.event('touchend', [point(560)], [point(500, 20, 9)])); t.end(550)
    expect(t.openDrawer).not.toHaveBeenCalled()
  })
  it('rejects 1→2 formation before move, partial releases, and attempted reenrollment until all lift', () => {
    const t = setup(); t.start()
    t.api.start(t.event('touchstart', [point(700), point(690, 50, 2)], [point(690, 50, 2)]))
    t.api.end(t.event('touchend', [point(690, 50, 2)], [point(700)]))
    t.api.start(t.event('touchstart', [point(690, 50, 2), point(700, 20, 3)], [point(700, 20, 3)]))
    t.api.move(t.event('touchmove', [point(500, 50, 2), point(500, 20, 3)]))
    t.api.end(t.event('touchend', [], [point(500, 50, 2), point(500, 20, 3)]))
    expect(t.openDrawer).not.toHaveBeenCalled()
    t.start(); t.end(); expect(t.openDrawer).toHaveBeenCalledOnce()
  })
  it('rejects multi-contact movement without a matching second start', () => {
    const t = setup(); t.start(); t.api.move(t.event('touchmove', [point(600), point(600, 50, 2)])); t.end()
    expect(t.openDrawer).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'blur', 'noncancelable', 'horizontal', 'reverse', 'blocked', 'removed', 'editing'])('does not commit after %s', reason => {
    const t = setup(); t.start()
    if (reason === 'cancel' || reason === 'blur') t.api.cancel()
    if (reason === 'noncancelable') t.api.move(t.event('touchmove', [point(560)], undefined, t.canvas, false))
    if (reason === 'horizontal') t.api.move(t.event('touchmove', [point(650, 100)]))
    if (reason === 'reverse') t.api.move(t.event('touchmove', [point(730)]))
    if (reason === 'blocked') t.setBlocked(true)
    if (reason === 'removed') t.canvas.remove()
    if (reason === 'editing') t.studio.classList.add('is-editing')
    t.end(); expect(t.openDrawer).not.toHaveBeenCalled(); expect(t.openSearch).not.toHaveBeenCalled()
  })
  it('retains remaining contacts on partial touchcancel', () => {
    const t = setup(); t.start(); t.api.cancel(t.event('touchcancel', [point(700)]))
    t.api.start(t.event('touchstart', [point(700), point(690, 50, 2)])); t.end()
    expect(t.openDrawer).not.toHaveBeenCalled()
  })
  it.each(['button', 'a', 'input', 'select', 'textarea', '[contenteditable]', '[role="button"]', '.workspace-app', '.workspace-widget', '[data-native-placement]', '.studio-picker', '.is-editing', '.is-overview', '.app-drawer-veil', '.msg-veil', '.mla-custom-veil', 'details', 'summary', '[inert]'])('excludes %s and its descendants', selector => {
    const t = setup(), owner = document.createElement(selector.startsWith('[') || selector.startsWith('.') ? 'div' : selector)
    if (selector.startsWith('.')) owner.className = selector.slice(1)
    if (selector.startsWith('[')) { const [name, value = ''] = selector.slice(1, -1).split('='); owner.setAttribute(name, value.replaceAll('"', '')) }
    const child = document.createElement('span'); owner.append(child); t.studio.append(owner)
    t.start(700, child); t.end(550, child)
    expect(t.openDrawer).not.toHaveBeenCalled(); expect(t.openSearch).not.toHaveBeenCalled()
  })
  it('preserves scroll in both directions until the relevant boundary', () => {
    const t = setup(200, 700); t.start(); const move = t.event('touchmove', [point(500)]); t.api.move(move); t.end(500)
    expect(move.defaultPrevented).toBe(false); expect(t.openDrawer).not.toHaveBeenCalled()
    t.start(100); t.end(200); expect(t.openSearch).not.toHaveBeenCalled()
    t.scroller.scrollTop = 0; t.start(100); t.end(200); expect(t.openSearch).toHaveBeenCalledOnce()
    t.scroller.scrollTop = 700; t.start(); t.end(); expect(t.openDrawer).toHaveBeenCalledOnce()
  })
  it('abandons a claim if content has actually scrolled', () => {
    const t = setup(700, 700); t.start(); t.api.move(t.event('touchmove', [point(650)])); t.scroller.scrollTop = 650; t.end()
    expect(t.openDrawer).not.toHaveBeenCalled(); expect(t.progress).toHaveBeenLastCalledWith(0)
  })
  it('uses the active visited scroller, never an inert previous page', () => {
    const t = setup(), inactive = document.createElement('div'); inactive.className = 'workspace-content'; inactive.setAttribute('inert', '')
    Object.defineProperty(inactive, 'scrollTop', { value: 500 }); t.studio.prepend(inactive)
    const heading = t.studio.querySelector('h2')!; t.start(100, heading); t.end(200, heading)
    expect(t.openSearch).toHaveBeenCalledOnce()
  })
  it('retains quick flick policy without accepting the same short slow pull', () => {
    let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now)
    const t = setup(); t.start(); now = 1080; t.end(640); expect(t.openDrawer).toHaveBeenCalledOnce()
    t.start(); now = 1580; t.end(640); expect(t.openDrawer).toHaveBeenCalledOnce()
  })
})
