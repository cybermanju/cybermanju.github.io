// CyberManju OS — useHomeLayout (src/composables/useHomeLayout.ts).
// Role: Pointer/touch and keyboard editing of home surfaces without hijacking normal app clicks.
// Exports: useHomeLayout.
// Integrates: MobileLauncher, homeLayout geometry and per-device localStorage.
// Contracts: Editing is explicit; cancel restores the start; release persists the exact drop point.
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { updateUiEntityPosition } from '@/utils/uiEntities'
import { HOME_LAYOUT_KEY, readHomeLayout, clampHomeOffset, type HomeOffset, type HomeRect } from '@/utils/homeLayout'
import { requestUiLayoutSwap, UI_LAYOUT_SWAP_EVENT, type UiLayoutSwapRequest } from '@/utils/uiLayout'

export function useHomeLayout(root: Ref<HTMLElement | null>, storageKey = HOME_LAYOUT_KEY) {
  let raw: string | null = null
  try { raw = localStorage.getItem(storageKey) } catch { /* Session-only storage. */ }
  const state = ref(readHomeLayout(raw))
  watch(() => state.value.offsets, offsets => {
    for (const element of root.value?.querySelectorAll<HTMLElement>('[data-home-item]') ?? []) {
      const id = element.dataset.homeItem
      if (id) updateUiEntityPosition(`home:${id}`, offsets[id] ?? { x: 0, y: 0 })
    }
  }, { deep: true })
  const editing = ref(false)
  const dragging = ref('')
  const width = ref(typeof window === 'undefined' ? 390 : window.innerWidth)
  const height = ref(typeof window === 'undefined' ? 844 : window.innerHeight)
  const status = ref('')
  let moved = false
  let mode: 'move' | 'swap' | 'resize' | 'appearance' = 'move'
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
  function swapTarget(event: PointerEvent, current: NonNullable<typeof active>): HTMLElement | null {
    if (mode !== 'swap' || typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null
    for (const candidate of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = candidate?.closest?.<HTMLElement>('[data-home-item]') ?? null
      if (!target || target === current.element || target.contains(current.element) || current.element.contains(target)) continue
      if (root.value?.contains && !root.value.contains(target)) continue
      if (target.dataset.homeItem === current.id) continue
      return target
    }
    return null
  }
  function finishSwap(current: NonNullable<typeof active>, target: HTMLElement) {
    const otherId = target.dataset.homeItem
    if (!otherId || !root.value) { finish(true); return }
    const targetGeometry = geometry(target, otherId)
    const otherOffset = pixels(otherId)
    const draggedPlacement = clampHomeOffset({
      x: targetGeometry.base.left + otherOffset.x - current.base.left,
      y: targetGeometry.base.top + otherOffset.y - current.base.top,
    }, current.base, current.bounds)
    const targetPlacement = clampHomeOffset({
      x: current.base.left + current.start.x - targetGeometry.base.left,
      y: current.base.top + current.start.y - targetGeometry.base.top,
    }, targetGeometry.base, targetGeometry.bounds)
    setPixels(current.id, draggedPlacement)
    setPixels(otherId, targetPlacement)
    active = null
    dragging.value = ''
    try { if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer) } catch { /* Capture may be lost on removal. */ }
    save()
  }
  function onPointerDown(event: PointerEvent) {
    if (mode === 'resize' || mode === 'appearance') return
    if (!editing.value || !event.isPrimary || event.button !== 0 || active) return
    const element = item(event)
    const id = element?.dataset.homeItem
    if (!element || !id || !root.value) return
    event.preventDefault()
    event.stopPropagation()
    element.focus({ preventScroll: true })
    const original = state.value.offsets[id]
    active = { id, pointer: event.pointerId, element, start: pixels(id), original: original ? { ...original } : undefined, ...geometry(element, id), x: event.clientX, y: event.clientY }
    dragging.value = id
    moved = false
    try { element.setPointerCapture(event.pointerId) } catch { /* Window listeners retain mouse fallback. */ }
  }
  function onPointerMove(event: PointerEvent) {
    if (!active || event.pointerId !== active.pointer) return
    event.preventDefault()
    const { start, x, y, base, bounds, id } = active
    const point = clampHomeOffset({ x: start.x + event.clientX - x, y: start.y + event.clientY - y }, base, bounds)
    moved ||= Math.hypot(event.clientX - x, event.clientY - y) > 3
    setPixels(id, point)
  }
  function onPointerUp(event: PointerEvent) {
    if (!active || active.pointer !== event.pointerId) return
    if (event.type === 'pointercancel') { finish(true); return }
    const current = active
    // Browsers can coalesce the last move into pointerup. Use its coordinates,
    // but never let inertial animation/gravity change a deliberate placement.
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3
      if (moved) setPixels(current.id, clampHomeOffset({ x: current.start.x + event.clientX - current.x, y: current.start.y + event.clientY - current.y }, current.base, current.bounds))
    }
    if (!moved) { finish(); return }
    if (mode === 'swap') {
      const target = swapTarget(event, current)
      if (target) finishSwap(current, target)
      else {
        const placement = requestUiLayoutSwap(current.element, { left: current.base.left + current.start.x, top: current.base.top + current.start.y }, event.clientX, event.clientY)
        if (placement) {
          setPixels(current.id, clampHomeOffset({ x: placement.left - current.base.left, y: placement.top - current.base.top }, current.base, current.bounds))
          finish()
        } else finish(true)
      }
      return
    }
    finish()
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
    if (mode === 'resize' || mode === 'appearance') return
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
    publishEditing()
  }
  function reset() {
    finish(true)
    state.value = { free: false, offsets: {} }
    editing.value = false
    save()
    publishEditing()
  }
  // One editing session for home and panel entities. Layout is app-owned;
  // these events never execute cybsh commands or touch backend credentials.
  function publishEditing() {
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-edit', { detail: { editing: editing.value } }))
    }
  }
  function onGlobalEditing(event: Event) {
    const enabled = (event as CustomEvent<{ editing?: boolean }>).detail?.editing
    if (typeof enabled !== 'boolean' || enabled === editing.value) return
    finish()
    editing.value = enabled
    const rects = root.value?.getClientRects?.()
    if (enabled && (!rects || rects.length > 0)) { state.value.free = true; save() }
  }
  function onLayoutMode(event: Event) {
    const next = (event as CustomEvent<{ mode?: string }>).detail?.mode
    if (next === 'move' || next === 'swap' || next === 'resize' || next === 'appearance') {
      if (next === 'resize' || next === 'appearance') finish(true)
      mode = next
    }
  }
  function onGlobalReset() {
    finish(true)
    state.value = { free: false, offsets: {} }
    save()
  }
  function onExternalSwap(event: Event) {
    const detail = (event as CustomEvent<UiLayoutSwapRequest>).detail
    if (!editing.value || !detail || detail.result || !root.value || typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return
    for (const node of document.elementsFromPoint(detail.clientX, detail.clientY)) {
      const target = node.closest<HTMLElement>('[data-home-item]')
      if (!target || !root.value.contains(target) || target === detail.source || target.contains(detail.source) || detail.source.contains(target)) continue
      const id = target.dataset.homeItem
      if (!id) continue
      const before = target.getBoundingClientRect(); const g = geometry(target, id)
      setPixels(id, clampHomeOffset({ x: detail.start.left - g.base.left, y: detail.start.top - g.base.top }, g.base, g.bounds))
      save()
      detail.result = { left: before.left, top: before.top }
      return
    }
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
    window.addEventListener('cybermanju:ui-layout-edit', onGlobalEditing)
    window.addEventListener('cybermanju:ui-layout-reset', onGlobalReset)
    window.addEventListener('cybermanju:ui-layout-mode', onLayoutMode)
    window.addEventListener(UI_LAYOUT_SWAP_EVENT, onExternalSwap)
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
    window.removeEventListener('cybermanju:ui-layout-edit', onGlobalEditing)
    window.removeEventListener('cybermanju:ui-layout-reset', onGlobalReset)
    window.removeEventListener('cybermanju:ui-layout-mode', onLayoutMode)
    window.removeEventListener(UI_LAYOUT_SWAP_EVENT, onExternalSwap)
    root.value?.removeEventListener?.('scroll', onBlur)
    window.removeEventListener('resize', resize)
  })
  return { editing, dragging, free, customized, status, style, toggle, reset, onPointerDown, onClickCapture, onKeydown }
}
