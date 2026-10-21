// CyberManju OS — useHomeLayout (src/composables/useHomeLayout.ts).
// Role: Pointer/touch and keyboard editing of home surfaces without hijacking normal app clicks.
// Exports: useHomeLayout.
// Integrates: MobileLauncher, homeLayout geometry and per-device localStorage.
// Contracts: Editing is explicit; cancel restores the start; release settles before persisting.
import { computed, nextTick, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { createDragMomentum } from '@/utils/dragPhysics'
import { HOME_LAYOUT_KEY, readHomeLayout, clampHomeOffset, type HomeOffset, type HomeRect } from '@/utils/homeLayout'

export function useHomeLayout(root: Ref<HTMLElement | null>, storageKey = HOME_LAYOUT_KEY) {
  let raw: string | null = null
  try { raw = localStorage.getItem(storageKey) } catch { /* Session-only storage. */ }
  const state = ref(readHomeLayout(raw))
  const editing = ref(false)
  const dragging = ref('')
  const width = ref(typeof window === 'undefined' ? 390 : window.innerWidth)
  const height = ref(typeof window === 'undefined' ? 844 : window.innerHeight)
  const status = ref('')
  const momentum = createDragMomentum()
  let settling = false
  let moved = false
  let active: { id: string; pointer: number; element: HTMLElement; start: HomeOffset; original: HomeOffset | undefined; base: HomeRect; bounds: HomeRect; x: number; y: number } | null = null
  const free = computed(() => state.value.free)
  const customized = computed(() => state.value.free || Object.keys(state.value.offsets).length > 0)
  const pixels = (id: string): HomeOffset => {
    const p = state.value.offsets[id]
    return { x: (p?.x ?? 0) * width.value, y: (p?.y ?? 0) * height.value }
  }
  function style(id: string) {
    const p = pixels(id)
    return { translate: `${Math.round(p.x * 100) / 100}px ${Math.round(p.y * 100) / 100}px`, position: id !== 'dock' && id !== 'drawer' ? 'relative' as const : undefined, zIndex: dragging.value === id || (id === 'widgets' && dragging.value.startsWith('widget:')) ? 20 : undefined, willChange: dragging.value === id ? 'translate' : undefined }
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(state.value)); status.value = 'Layout saved on this device.' }
    catch { status.value = 'Layout kept for this session; device storage is unavailable.' }
  }
  function setPixels(id: string, p: HomeOffset) {
    state.value.offsets[id] = { x: p.x / Math.max(1, width.value), y: p.y / Math.max(1, height.value) }
  }
  function geometry(element: HTMLElement, id: string) {
    const rect = element.getBoundingClientRect()
    const p = pixels(id)
    const host = root.value!
    const hostRect = host.getBoundingClientRect()
    const fixed = element.hasAttribute('data-home-fixed')
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null
    const safeBottom = Math.max(0, parseFloat(css?.getPropertyValue('--home-drag-safe-bottom') ?? '') || 0)
    const navigation = host.classList?.contains('with-app-nav') ? Math.max(0, parseFloat(css?.getPropertyValue('--mobile-nav-h') ?? '') || 0) : 0
    // All rectangles are in client space. Scroll-content extents include translated
    // descendants and would grow the allowed area as the user drags toward an edge.
    const left = Math.max(0, hostRect.left + (host.clientLeft || 0)) + 8
    const top = Math.max(0, hostRect.top + (host.clientTop || 0)) + 8
    const right = Math.min(width.value, hostRect.left + host.clientWidth) - 8
    const bottom = fixed
      ? height.value - 8 - safeBottom - navigation
      : Math.min(height.value, hostRect.top + host.clientHeight) - 8
    return {
      base: { left: rect.left - p.x, top: rect.top - p.y, width: rect.width, height: rect.height },
      bounds: { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    }
  }

  function item(event: Event): HTMLElement | null {
    const target = event.target as HTMLElement | null
    if (target?.closest('.mla-layout-toolbar, .mla-custom-veil, .desktop-home-controls')) return null
    return target?.closest<HTMLElement>('[data-home-item]') ?? null
  }
  function finish(cancel = false) {
    momentum.stop()
    settling = false
    if (!active) return
    const current = active
    active = null
    if (cancel) {
      if (current.original) state.value.offsets[current.id] = current.original
      else delete state.value.offsets[current.id]
      status.value = 'Move cancelled.'
    } else save()
    dragging.value = ''
    try { if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer) } catch { /* Capture may be lost on removal. */ }
  }
  function onPointerDown(event: PointerEvent) {
    if (!editing.value || !event.isPrimary || event.button !== 0 || (active && !settling)) return
    const element = item(event)
    const id = element?.dataset.homeItem
    if (!element || !id || !root.value) return
    if (settling) finish()
    event.preventDefault()
    event.stopPropagation()
    element.focus({ preventScroll: true })
    const original = state.value.offsets[id]
    active = { id, pointer: event.pointerId, element, start: pixels(id), original: original ? { ...original } : undefined, ...geometry(element, id), x: event.clientX, y: event.clientY }
    dragging.value = id
    moved = false
    momentum.sample(pixels(id))
    try { element.setPointerCapture(event.pointerId) } catch { /* Window listeners retain mouse fallback. */ }
  }
  function onPointerMove(event: PointerEvent) {
    if (!active || settling || event.pointerId !== active.pointer) return
    event.preventDefault()
    const { start, x, y, base, bounds, id } = active
    const point = clampHomeOffset({ x: start.x + event.clientX - x, y: start.y + event.clientY - y }, base, bounds)
    moved ||= Math.hypot(event.clientX - x, event.clientY - y) > 3
    setPixels(id, point)
    momentum.sample(point)
  }
  function onPointerUp(event: PointerEvent) {
    if (!active || settling || active.pointer !== event.pointerId) return
    if (event.type === 'pointercancel' || !moved) { finish(event.type === 'pointercancel'); return }
    const current = active
    settling = true
    try { if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer) } catch { /* Already released. */ }
    momentum.release({ position: pixels(current.id), ...geometry(current.element, current.id), update: point => setPixels(current.id, point), complete: () => finish() })
  }
  function onClickCapture(event: MouseEvent) {
    if (editing.value && item(event)) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  function onKeydown(event: KeyboardEvent) {
    if (!editing.value) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (active) finish(true); else toggle(); return }
    const element = item(event)
    const id = element?.dataset.homeItem
    if (!element || !id) return
    const delta: Record<string, HomeOffset> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
    if (!delta[event.key]) return
    event.preventDefault()
    event.stopPropagation()
    if (active) finish()
    const step = event.shiftKey ? 10 : 2
    const p = pixels(id)
    const g = geometry(element, id)
    setPixels(id, clampHomeOffset({ x: p.x + delta[event.key].x * step, y: p.y + delta[event.key].y * step }, g.base, g.bounds))
    save()
  }
  function toggle() {
    finish()
    editing.value = !editing.value
    if (editing.value) state.value.free = true
    save()
  }
  function reset() {
    finish(true)
    state.value = { free: false, offsets: {} }
    editing.value = false
    save()
  }
  async function resize() {
    finish(true)
    width.value = window.innerWidth
    height.value = window.innerHeight
    await nextTick()
    for (const element of root.value?.querySelectorAll<HTMLElement>('[data-home-item]') ?? []) {
      const id = element.dataset.homeItem!
      if (!state.value.offsets[id] || !element.getClientRects().length) continue
      const g = geometry(element, id)
      setPixels(id, clampHomeOffset(pixels(id), g.base, g.bounds))
    }
  }
  function onBlur() { finish(true) }
  onMounted(() => {
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('blur', onBlur)
    root.value?.addEventListener?.('scroll', onBlur, { passive: true })
    window.addEventListener('resize', resize)
    void resize()
  })
  onUnmounted(() => {
    finish(true)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('blur', onBlur)
    root.value?.removeEventListener?.('scroll', onBlur)
    window.removeEventListener('resize', resize)
  })
  return { editing, dragging, free, customized, status, style, toggle, reset, onPointerDown, onClickCapture, onKeydown }
}
