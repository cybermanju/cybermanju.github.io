// CyberManju OS — Home layout tests (tests/frontend/home-layout.test.ts).
// Role: Exercise persisted layout validation, drag bounds and explicit edit-mode interactions.
// Exports: Vitest suites.
// Integrates: homeLayout, useHomeLayout, Vue lifecycle test stubs.
// Contracts: Normal clicks stay untouched; cancellation restores state; no app executes on drag.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { clampHomeOffset, HOME_LAYOUT_KEY, moveHomeOrder, readHomeLayout } from '@/utils/homeLayout'
const hooks = vi.hoisted(() => ({ mount: [] as Array<() => void>, unmount: [] as Array<() => void> }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onMounted: (fn: () => void) => hooks.mount.push(fn), onUnmounted: (fn: () => void) => hooks.unmount.push(fn) }))
import { useHomeLayout } from '@/composables/useHomeLayout'
import { readFileSync } from 'node:fs'

const memory = new Map<string, string>()
const listeners = new Map<string, (event: any) => void>()
let elementsAtPoint: Element[] = []
beforeEach(() => {
  memory.clear(); listeners.clear(); hooks.mount.length = 0; hooks.unmount.length = 0; elementsAtPoint = []
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v) })
  vi.stubGlobal('window', { innerWidth: 400, innerHeight: 800, addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) })
})
afterEach(() => { hooks.unmount.forEach(fn => fn()); vi.unstubAllGlobals() })
function setup() {
  const root = { getBoundingClientRect: () => ({ left: 0, top: 40 }), clientWidth: 400, clientHeight: 600, scrollHeight: 600, scrollTop: 0, querySelectorAll: () => [] }
  const element = { dataset: { homeItem: 'app:agent' }, getBoundingClientRect: () => ({ left: 100, top: 100, width: 60, height: 80 }), hasAttribute: () => false, focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() }
  const layout = useHomeLayout(ref(root as unknown as HTMLElement))
  hooks.mount.forEach(fn => fn())
  const event = (x = 100, y = 100) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, target: { closest: (selector: string) => selector === '[data-home-item]' ? element : null }, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() })
  return { layout, element, event, root }
}

describe('home layout geometry and storage', () => {
  it('ignores malformed, unknown and non-finite stored positions', () => {
    expect(readHomeLayout('{oops')).toEqual({ free: false, offsets: {} })
    expect(readHomeLayout(JSON.stringify({ free: true, offsets: { 'app:agent': { x: 0.2, y: 0.4 }, dock: { x: 1000, y: -1000 }, unknown: { x: 1, y: 1 }, search: { x: 'bad', y: 0 } } }))).toEqual({ free: true, offsets: { 'app:agent': { x: 0.2, y: 0.4 }, dock: { x: 2, y: -2 } } })
  })
  it('clamps every edge and anchors oversized surfaces', () => {
    const base = { left: 100, top: 100, width: 60, height: 80 }
    const bounds = { left: 8, top: 48, width: 384, height: 584 }
    expect(clampHomeOffset({ x: -1000, y: 1000 }, base, bounds)).toEqual({ x: -92, y: 452 })
    expect(clampHomeOffset({ x: 1000, y: -1000 }, base, bounds)).toEqual({ x: 232, y: -52 })
    expect(clampHomeOffset({ x: 0, y: 0 }, { ...base, width: 900, height: 900 }, bounds)).toEqual({ x: -92, y: -52 })
  })
  it('moves default-order tiles to unique neighboring slots without collisions', () => {
    expect(moveHomeOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveHomeOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveHomeOrder(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
  })
})

describe('explicit home editing', () => {
  it('shares mode and editing events, swaps placements atomically, and global reset clears only home state', () => {
    memory.set(HOME_LAYOUT_KEY, JSON.stringify({ free: false, offsets: { 'app:agent': { x: 0.1, y: 0.05 }, 'app:files': { x: -0.1, y: 0.1 } } }))
    const { layout, event, element, root } = setup()
    const rectFor = (id: string, left: number, top: number) => {
      const [x, y] = layout.style(id).translate.split(' ').map(parseFloat)
      return { left: left + x, top: top + y, width: 60, height: 80 }
    }
    element.getBoundingClientRect = () => rectFor('app:agent', 100, 100)
    const other = { dataset: { homeItem: 'app:files' }, getBoundingClientRect: () => rectFor('app:files', 240, 300), hasAttribute: () => false, contains: () => false, closest: () => other }
    ;(element as any).getClientRects = () => [element]
    ;(other as any).getClientRects = () => [other]
    ;(element as any).contains = () => false
    root.querySelectorAll = () => [element, other] as unknown as HTMLElement[]
    const oldDocument = globalThis.document
    vi.stubGlobal('document', { elementsFromPoint: () => elementsAtPoint })
    const write = vi.spyOn(localStorage, 'setItem')
    listeners.get('cybermanju:ui-layout-edit')!({ detail: { editing: true } })
    expect(layout.free.value).toBe(true)
    expect(listeners.has('cybermanju:ui-layout-mode')).toBe(true)
    listeners.get('cybermanju:ui-layout-mode')!({ detail: { mode: 'swap' } })
    write.mockClear()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(150, 150))
    elementsAtPoint = [other as unknown as Element]
    listeners.get('pointerup')!({ pointerId: 1, type: 'pointerup', clientX: 150, clientY: 150 })
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets).toEqual({ 'app:agent': { x: 0.25, y: 0.35 }, 'app:files': { x: -0.25, y: -0.2 } })
    expect(element.getBoundingClientRect()).toMatchObject({ left: 200, top: 380 })
    expect(other.getBoundingClientRect()).toMatchObject({ left: 140, top: 140 })
    expect(write).toHaveBeenCalledTimes(1) // one atomic swap
    listeners.get('cybermanju:ui-layout-reset')!({})
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!)).toEqual({ free: false, offsets: {} })
    expect(oldDocument).toBeUndefined()
  })
  it('cancels swap when release has no valid target and writes no incorrect position', () => {
    const { layout, event } = setup()
    vi.stubGlobal('document', { elementsFromPoint: () => [] })
    listeners.get('cybermanju:ui-layout-mode')!({ detail: { mode: 'swap' } })
    layout.toggle()
    const writes = vi.spyOn(localStorage, 'setItem')
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(200, 200))
    listeners.get('pointerup')!({ pointerId: 1, type: 'pointerup', clientX: 200, clientY: 200 })
    expect(layout.style('app:agent').translate).toBe('0px 0px')
    expect(writes).not.toHaveBeenCalled()
    expect(layout.status.value).toBe('Move cancelled.')
  })
  it('exchanges a home placement with a panel entity through position-only metadata', () => {
    const { layout, element, root } = setup()
    element.getBoundingClientRect = () => {
      const [x, y] = layout.style('app:agent').translate.split(' ').map(parseFloat)
      return { left: 100 + x, top: 100 + y, width: 60, height: 80 }
    }
    ;(element as any).closest = () => element
    ;(element as any).contains = () => false
    ;(root as any).contains = (candidate: unknown) => candidate === element
    vi.stubGlobal('document', { elementsFromPoint: () => [element] })
    listeners.get('cybermanju:ui-layout-edit')!({ detail: { editing: true } })
    const detail = { source: { contains: () => false }, start: { left: 200, top: 300 }, clientX: 100, clientY: 100, result: undefined }
    listeners.get('cybermanju:ui-layout-swap')!({ detail })
    expect(detail.result).toEqual({ left: 100, top: 100 })
    expect(element.getBoundingClientRect()).toMatchObject(detail.start)
    expect(Object.keys(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets)).toEqual(['app:agent'])
  })
  it('leaves ordinary launches and touch gestures alone outside editing', () => {
    const { layout, event } = setup(); const e = event()
    layout.onPointerDown(e as unknown as PointerEvent)
    layout.onClickCapture(e as unknown as MouseEvent)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(layout.dragging.value).toBe('')
  })
  it('moves, clamps, captures and persists only at pointer release', () => {
    const { layout, event, element } = setup()
    layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(900, 900))
    expect(layout.style('app:agent').translate).toBe('232px 452px')
    expect(element.setPointerCapture).toHaveBeenCalledWith(1)
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets).toEqual({})
    listeners.get('pointerup')!({ pointerId: 1, type: 'pointerup' })
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets['app:agent']).toEqual({ x: 0.58, y: 0.565 })
    const click = event(); layout.onClickCapture(click as unknown as MouseEvent)
    expect(click.stopImmediatePropagation).toHaveBeenCalled()
  })
  it('restores cancelled movement, ignores another pointer and cleans up listeners', () => {
    const { layout, event } = setup(); layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!({ ...event(200, 200), pointerId: 2 })
    expect(layout.style('app:agent').translate).toBe('0px 0px')
    listeners.get('pointermove')!(event(200, 200))
    listeners.get('pointercancel')!({ pointerId: 1, type: 'pointercancel' })
    expect(layout.style('app:agent').translate).toBe('0px 0px')
    expect(layout.status.value).toBe('Move cancelled.')
  })
  it('supports keyboard movement and reset without changing tile overrides', () => {
    const { layout, event } = setup(); layout.toggle()
    layout.onKeydown({ ...event(), key: 'ArrowRight', shiftKey: true } as unknown as KeyboardEvent)
    expect(layout.style('app:agent').translate).toBe('10px 0px')
    layout.reset()
    expect(layout.free.value).toBe(false)
    expect(layout.editing.value).toBe(false)
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!)).toEqual({ free: false, offsets: {} })
  })
  it('keeps the lower dock safe-area-aware and exposes all major movable surfaces', () => {
    const source = readFileSync('src/components/MobileLauncher.vue', 'utf8')
    for (const id of ['greeting', 'widget:vault', 'widget:sync', 'search', 'commands', 'dock', 'drawer']) expect(source).toContain(`data-home-item="${id}"`)
    expect(source).toContain(':data-home-item="`app:${app.panel}`"')
    expect(source).toContain('bottom: calc(8px + env(safe-area-inset-bottom, 0px))')
    expect(source).toContain('homeLayout.onPointerDown')
    expect(source).toContain('<HomeCommandBar')
  })
})

describe('component-space clipping and release lifecycle', () => {
  it('uses the visible scrollport, not transformed scroll extents', () => {
    const { layout, event, root } = setup()
    root.scrollHeight = 4000
    root.scrollTop = 700
    layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(900, 900))
    expect(layout.style('app:agent').translate).toBe('232px 452px')
  })
  it('bounds fixed surfaces to the host horizontal area instead of the entire viewport', () => {
    const { layout, event, root, element } = setup()
    root.getBoundingClientRect = () => ({ left: 50, top: 40 })
    root.clientWidth = 250
    element.hasAttribute = () => true
    layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(900, 900))
    expect(layout.style('app:agent').translate).toBe('132px 612px')
  })
  it('saves the exact release point without gravity or momentum moving it afterward', () => {
    const animate = vi.fn()
    vi.stubGlobal('requestAnimationFrame', animate)
    const { layout, event, element } = setup()
    element.getBoundingClientRect = () => {
      const [x, y] = layout.style('app:agent').translate.split(' ').map(parseFloat)
      return { left: 100 + x, top: 100 + y, width: 60, height: 80 }
    }
    layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointermove')!(event(150, 150))
    listeners.get('pointerup')!({ pointerId: 1, type: 'pointerup', clientX: 180, clientY: 170 })
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets['app:agent']).toEqual({ x: 0.2, y: 0.0875 })
    expect(layout.style('app:agent').translate).toBe('80px 70px')
    expect(layout.dragging.value).toBe('')
    expect(animate).not.toHaveBeenCalled()
    layout.toggle()
    expect(layout.style('app:agent').translate).toBe('80px 70px')
    const restored = useHomeLayout(ref(null))
    expect(restored.style('app:agent').translate).toBe('80px 70px')
  })
  it('uses pointerup coordinates even when the browser coalesces every pointermove', () => {
    const { layout, event } = setup()
    layout.toggle()
    layout.onPointerDown(event() as unknown as PointerEvent)
    listeners.get('pointerup')!({ pointerId: 1, type: 'pointerup', clientX: 180, clientY: 170 })
    expect(layout.style('app:agent').translate).toBe('80px 70px')
    expect(readHomeLayout(memory.get(HOME_LAYOUT_KEY)!).offsets['app:agent']).toEqual({ x: 0.2, y: 0.0875 })
  })
  it('clips edit highlights inside rounded component silhouettes', () => {
    const source = readFileSync('src/components/MobileLauncher.vue', 'utf8')
    expect(source).toContain('outline-offset: -1px')
    expect(source).toContain('clip-path: inset(0 round var(--home-item-radius, 18px))')
    expect(source).toContain('data-home-item="commands" tabindex="0"')
  })
})

describe('visible surface alignment', () => {
  it('preserves legacy widget-group offsets while independently moving the two actual cards', () => {
    const state = readHomeLayout(JSON.stringify({ free: true, offsets: { widgets: { x: 0.1, y: 0.2 }, 'widget:vault': { x: 0.2, y: 0.3 }, 'widget:sync': { x: 0.3, y: 0.4 } } }))
    expect(Object.keys(state.offsets)).toEqual(['widgets', 'widget:vault', 'widget:sync'])
    const source = readFileSync('src/components/MobileLauncher.vue', 'utf8')
    expect(source).not.toContain('data-home-item="widgets"')
    expect(source).toContain(":style=\"homeLayout.style('widgets')\"")
  })
  it('does not add window-only mobile padding around the home search bar', () => {
    const source = readFileSync('src/components/OmniSearchPanel.vue', 'utf8')
    expect(source).toContain('.omni:not(.omni--home) { min-width: 0; padding:')
  })
})
