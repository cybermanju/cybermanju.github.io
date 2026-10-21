// CyberManju OS — UI Layout Gesture Tests (tests/frontend/ui-layout-gestures.test.ts).
// Role: Exercise delegated layout editing gestures with a minimal node-only DOM.
// Exports: Vitest gesture regression suite.
// Integrates: src/utils/uiLayout.ts public installUiLayout event interface.
// Contracts: No jsdom dependency; tests model only the DOM APIs used by the runtime.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installUiLayout, requestUiLayoutSwap, UI_LAYOUT_EVENT, UI_LAYOUT_MODE_EVENT, UI_LAYOUT_SIZE_STORAGE_KEY, UI_LAYOUT_STORAGE_KEY, UI_LAYOUT_SWAP_EVENT } from '../../src/utils/uiLayout'

class Style {
  private values = new Map<string, string>()
  translate = ''
  touchAction = ''
  position = ''
  zIndex = ''
  overflow = ''
  overflowX = ''
  overflowY = ''
  setProperty(k: string, v: string) { this.values.set(k, v) }
  getPropertyValue(k: string) { return this.values.get(k) || '' }
  removeProperty(k: string) { const old = this.getPropertyValue(k); this.values.delete(k); if (k === 'translate') this.translate = ''; if (k === 'touch-action') this.touchAction = ''; return old }
}
class Classes {
  private values = new Set<string>()
  toggle(k: string, force?: boolean) { const on = force ?? !this.values.has(k); on ? this.values.add(k) : this.values.delete(k); return on }
  contains(k: string) { return this.values.has(k) }
  add(k: string) { this.values.add(k) }
  remove(k: string) { this.values.delete(k) }
}
class MockElement extends EventTarget {
  parentElement: MockElement | null = null
  id = ''
  children: MockElement[] = []
  dataset: Record<string, string> = {}
  style = new Style()
  classList = new Classes()
  attrs = new Map<string, string>()
  isConnected = true
  base = { left: 100, top: 100, width: 100, height: 80 }
  getAttribute(k: string) { return this.attrs.get(k) ?? null }
  hasAttribute(k: string) { return this.attrs.has(k) }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v }
  removeAttribute(k: string) { this.attrs.delete(k); if (k.startsWith('data-')) delete this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] }
  append(child: MockElement) { child.parentElement = this; this.children.push(child) }
  closest<T extends MockElement = MockElement>(selector: string): T | null {
    let n: MockElement | null = this
    while (n) { if (n.matches(selector)) return n as T; n = n.parentElement }
    return null
  }
  matches(selector: string) {
    return selector.split(',').some(s => {
      const q = s.trim()
      if (q === '[data-ui-layout-id]') return this.hasAttribute('data-ui-layout-id')
      if (q === '[data-ui-layout-entry]') return this.hasAttribute('data-ui-layout-entry')
      if (q === '[data-ui-layout-ignore]') return this.hasAttribute('data-ui-layout-ignore')
      if (q === '[data-home-item]') return this.hasAttribute('data-home-item')
      if (q === '[data-ui-layout-shell]') return this.hasAttribute('data-ui-layout-shell')
      if (q === '#app') return this.attrs.get('id') === 'app'
      if (q === 'html' || q === 'body') return false
      if (q.startsWith('.')) return this.classList.contains(q.slice(1))
      return false
    })
  }
  querySelectorAll<T extends MockElement = MockElement>(selector: string): T[] {
    const found: MockElement[] = []
    const visit = (n: MockElement) => { for (const c of n.children) { if (c.matches(selector)) found.push(c); visit(c) } }
    visit(this); return found as T[]
  }
  getBoundingClientRect() {
    const x = parseFloat(this.style.getPropertyValue('--ui-layout-x')) || 0
    const y = parseFloat(this.style.getPropertyValue('--ui-layout-y')) || 0
    const width = parseFloat(this.style.width) || this.base.width, height = parseFloat(this.style.height) || this.base.height
    return { left: this.base.left + x, top: this.base.top + y, width, height, right: this.base.left + x + width, bottom: this.base.top + y + height }
  }
  setPointerCapture(_id: number) {}
  hasPointerCapture(_id: number) { return false }
  releasePointerCapture(_id: number) {}
  getClientRects() { return [this.getBoundingClientRect()] }
  contains(other: MockElement) { let n: MockElement | null = other; while (n) { if (n === this) return true; n = n.parentElement } return false }
  focus(_options?: unknown) {}
}
class Pointer extends Event {
  constructor(type: string, public pointerId = 1, public clientX = 100, public clientY = 100, public button = 0) { super(type, { bubbles: true, cancelable: true }) }
}
class Click extends Event { constructor() { super('click', { bubbles: true, cancelable: true }) } }
const storage = new Map<string, string>()
let root: MockElement, a: MockElement, b: MockElement, cleanup: (() => void) | undefined
const dispatch = (target: MockElement | EventTarget, event: Event) => {
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  return target instanceof MockElement ? root.dispatchEvent(event) : target.dispatchEvent(event)
}
const setEditing = (value: boolean) => window.dispatchEvent(new CustomEvent(UI_LAYOUT_EVENT, { detail: { editing: value } }))
const persisted = () => JSON.parse(storage.get(UI_LAYOUT_STORAGE_KEY) || '{}')

beforeEach(() => {
  vi.useFakeTimers(); storage.clear()
  class MockWindow extends EventTarget { innerWidth = 1000; innerHeight = 800 }
  class Key extends Event { key: string; constructor(type: string, init: { key: string }) { super(type); this.key = init.key } }
  class Store extends Event { key: string | null; newValue: string | null; constructor(type: string, init: { key: string; newValue: string }) { super(type); this.key = init.key; this.newValue = init.newValue } }
  const win = new MockWindow()
  Object.assign(globalThis, { window: win, Element: MockElement, HTMLElement: MockElement, KeyboardEvent: Key, StorageEvent: Store,
    document: { documentElement: { clientWidth: 1000, clientHeight: 800 }, elementsFromPoint: () => [] },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  })
  root = new MockElement(); a = new MockElement(); a.setAttribute('data-ui-layout-id', 'a'); root.append(a)
  b = new MockElement(); b.setAttribute('data-ui-layout-id', 'b'); b.base.left = 400; root.append(b)
  cleanup = installUiLayout(root)
})
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers() })

describe('UI layout pointer gestures', () => {
  it('leaves ordinary clicks alone, but suppresses click after even a stationary edit pointerdown', () => {
    const outside = new Click(); dispatch(a, outside); expect(outside.defaultPrevented).toBe(false)
    setEditing(true)
    const click = new Click(); let bubbled = false; root.addEventListener('click', () => { bubbled = true })
    dispatch(a, new Pointer('pointerdown')); dispatch(a, click)
    expect(click.defaultPrevented).toBe(true); expect(bubbled).toBe(false)
  })
  it('stops pointerdown from reaching legacy handlers and ignores non-primary pointers', () => {
    let parentDown = 0; a.addEventListener('pointerdown', () => parentDown++)
    setEditing(true)
    const nonprimary = new Pointer('pointerdown', 1, 100, 100, 2); dispatch(a, nonprimary)
    expect(parentDown).toBe(0)
    dispatch(window, new Pointer('pointermove', 1, 250, 200))
    expect(persisted()).toEqual({})
  })
  it('persists normalized movement once on primary pointer release', () => {
    setEditing(true)
    dispatch(a, new Pointer('pointerdown', 2, 100, 100))
    dispatch(window, new Pointer('pointermove', 2, 300, 180))
    expect(persisted()).toEqual({})
    dispatch(window, new Pointer('pointerup', 2, 300, 180))
    expect(persisted().a.x).toBeCloseTo(0.2); expect(persisted().a.y).toBeCloseTo(0.1)
  })
  it('cancels a drag without creating a persisted offset', () => {
    setEditing(true); dispatch(a, new Pointer('pointerdown', 3, 100, 100))
    dispatch(window, new Pointer('pointermove', 3, 300, 200))
    dispatch(window, new Pointer('pointercancel', 3, 300, 200))
    expect(persisted()).toEqual({}); expect(a.style.getPropertyValue('--ui-layout-x')).toBe('')
  })
  it('resizes home items, commits final pointerup coordinates, and restores size on reinstall', () => {
    const tile = new MockElement(); tile.setAttribute('data-home-item', 'app:files'); root.append(tile)
    window.dispatchEvent(new CustomEvent(UI_LAYOUT_MODE_EVENT, { detail: { mode: 'resize' } })); setEditing(true)
    dispatch(tile, new Pointer('pointerdown', 12, 100, 100)); dispatch(window, new Pointer('pointermove', 12, 120, 110)); dispatch(window, new Pointer('pointerup', 12, 150, 130))
    expect(tile.style.width).toBe('150px'); expect(tile.style.height).toBe('110px')
    expect(JSON.parse(storage.get(UI_LAYOUT_SIZE_STORAGE_KEY) || '{}')['home:app:files']).toEqual({ width: 0.15, height: 0.1375 })
    cleanup?.(); cleanup = installUiLayout(root)
    expect(tile.style.width).toBe('150px'); expect(tile.style.height).toBe('110px')
  })
  it('clamps the actual screen rectangle to every viewport edge', () => {
    setEditing(true)
    dispatch(a, new Pointer('pointerdown', 3, 100, 100))
    dispatch(window, new Pointer('pointermove', 3, 10000, 10000))
    expect(a.getBoundingClientRect().right).toBe(window.innerWidth - 8)
    expect(a.getBoundingClientRect().bottom).toBe(window.innerHeight - 8)
    dispatch(window, new Pointer('pointermove', 3, -10000, -10000))
    expect(a.getBoundingClientRect().left).toBeCloseTo(8)
    expect(a.getBoundingClientRect().top).toBeCloseTo(8)
  })
  it('swaps two screen placements on release without moving the target during hover', () => {
    setEditing(true)
    window.dispatchEvent(new CustomEvent(UI_LAYOUT_MODE_EVENT, { detail: { mode: 'swap' } }))
    const beforeA = a.getBoundingClientRect(); const beforeB = b.getBoundingClientRect()
    const writes = vi.spyOn(localStorage, 'setItem')
    document.elementsFromPoint = () => [b as unknown as Element]
    dispatch(a, new Pointer('pointerdown', 3, beforeA.left, beforeA.top))
    dispatch(window, new Pointer('pointermove', 3, beforeB.left, beforeB.top))
    expect(b.getBoundingClientRect()).toEqual(beforeB)
    expect(writes).not.toHaveBeenCalled()
    dispatch(window, new Pointer('pointerup', 3, beforeB.left, beforeB.top))
    expect(a.getBoundingClientRect()).toEqual(beforeB)
    expect(b.getBoundingClientRect()).toEqual(beforeA)
    expect(Object.keys(persisted())).toEqual(['a', 'b'])
    expect(writes).toHaveBeenCalledTimes(1)
  })
  it('rolls back a swap without a target, and never accepts an ancestor as the swap partner', () => {
    setEditing(true)
    window.dispatchEvent(new CustomEvent(UI_LAYOUT_MODE_EVENT, { detail: { mode: 'swap' } }))
    const beforeA = a.getBoundingClientRect()
    document.elementsFromPoint = () => [root as unknown as Element]
    dispatch(a, new Pointer('pointerdown', 3, beforeA.left, beforeA.top))
    dispatch(window, new Pointer('pointermove', 3, 400, 300))
    dispatch(window, new Pointer('pointerup', 3, 400, 300))
    expect(a.getBoundingClientRect()).toEqual(beforeA)
    expect(persisted()).toEqual({})
  })
  it('accepts a position exchange from the home system without storing home values', () => {
    setEditing(true)
    const home = new MockElement(); home.setAttribute('data-home-item', 'app:files'); root.append(home)
    const beforeB = b.getBoundingClientRect(); const start = { left: 120, top: 300 }
    document.elementsFromPoint = () => [b as unknown as Element]
    const result = requestUiLayoutSwap(home as unknown as HTMLElement, start, beforeB.left, beforeB.top)
    expect(result).toEqual({ left: beforeB.left, top: beforeB.top })
    expect(b.getBoundingClientRect()).toMatchObject(start)
    expect(Object.keys(persisted())).toEqual(['b'])
  })
  it('can drop a global component onto a home-owned position through the shared exchange', () => {
    setEditing(true)
    window.dispatchEvent(new CustomEvent(UI_LAYOUT_MODE_EVENT, { detail: { mode: 'swap' } }))
    const destination = { left: 400, top: 300 }
    let start: unknown
    window.addEventListener(UI_LAYOUT_SWAP_EVENT, event => {
      const detail = (event as CustomEvent).detail
      start = detail.start
      detail.result = destination
    })
    dispatch(a, new Pointer('pointerdown', 3, a.base.left, a.base.top))
    dispatch(window, new Pointer('pointermove', 3, destination.left, destination.top))
    dispatch(window, new Pointer('pointerup', 3, destination.left, destination.top))
    expect(start).toEqual({ left: a.base.left, top: a.base.top })
    expect(a.getBoundingClientRect()).toMatchObject(destination)
    expect(Object.keys(persisted())).toEqual(['a'])
  })
  it('cancels the current drag on Escape before the next Escape exits edit mode', () => {
    setEditing(true); dispatch(a, new Pointer('pointerdown', 4, 100, 100))
    dispatch(window, new Pointer('pointermove', 4, 250, 100))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(root.classList.contains('ui-layout-editing')).toBe(true); expect(persisted()).toEqual({})
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(root.classList.contains('ui-layout-editing')).toBe(false)
  })
  it('enters edit mode on a 550ms entry hold and cancels the hold after movement', () => {
    const entry = new MockElement(); entry.setAttribute('data-ui-layout-entry', ''); root.append(entry)
    dispatch(entry, new Pointer('pointerdown', 5, 20, 20)); vi.advanceTimersByTime(549)
    expect(root.classList.contains('ui-layout-editing')).toBe(false); vi.advanceTimersByTime(1)
    expect(root.classList.contains('ui-layout-editing')).toBe(true)
    setEditing(false); dispatch(entry, new Pointer('pointerdown', 6, 20, 20))
    dispatch(window, new Pointer('pointermove', 6, 40, 20)); vi.advanceTimersByTime(600)
    expect(root.classList.contains('ui-layout-editing')).toBe(false)
  })
  it('uses storage key contract and safely ignores malformed cross-tab storage updates', () => {
    expect(() => window.dispatchEvent(new StorageEvent('storage', { key: UI_LAYOUT_STORAGE_KEY, newValue: '{broken' }))).not.toThrow()
  })
  it('reset preserves an element’s home-owned translate value', () => {
    a.style.translate = '12px 4px'; storage.set(UI_LAYOUT_STORAGE_KEY, JSON.stringify({ a: { x: 0.2, y: 0.1 } }))
    cleanup?.(); cleanup = installUiLayout(root)
    window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-reset'))
    expect(a.style.translate).toBe('12px 4px'); expect(storage.has(UI_LAYOUT_STORAGE_KEY)).toBe(false)
  })
})
