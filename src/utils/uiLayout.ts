// CyberManju OS — UI entity layout (src/utils/uiLayout.ts).
// Role: Shared move/swap systems over stable UI entities and device-local position components.
// Exports: installUiLayout, edit/reset controls, getUiLayoutEntities and persistence validators.
// Integrates: ui/layout registration, home editing events and deployment-scoped localStorage.
// Contracts: Explicit editing only; release commits atomically; gestures never invoke backend commands.
import { registerUiEntity, pruneUiEntities, getUiEntitiesSnapshot } from './uiEntities'
import { deploymentStorageEventKey } from './deploymentScope'

export const UI_LAYOUT_TEXT_EVENT = 'cybermanju:ui-layout-text-menu'
export const UI_LAYOUT_EVENT = 'cybermanju:ui-layout-edit'
export const UI_LAYOUT_RESET_EVENT = 'cybermanju:ui-layout-reset'
export const UI_LAYOUT_MODE_EVENT = 'cybermanju:ui-layout-mode'
export const UI_LAYOUT_SWAP_EVENT = 'cybermanju:ui-layout-swap'
export const UI_LAYOUT_STORAGE_KEY = 'cybermanju.ui.layout.v1'
export const UI_LAYOUT_SIZE_STORAGE_KEY = 'cybermanju.ui.sizes.v1'
export const UI_LAYOUT_MODE_RESIZE = 'resize' as const
const MIN_SIZE = 48
const MAX_SIZE_FRACTION = 0.95
const MAX_ENTRIES = 5000
const MAX_ID_LENGTH = 512
const EDIT_CLASS = 'ui-layout-editing'
const X_VAR = '--ui-layout-x'
const Y_VAR = '--ui-layout-y'
export interface UiLayoutOffset { x: number; y: number }
export type UiLayoutMap = Record<string, UiLayoutOffset>
export interface UiLayoutSize { width: number; height: number }
export type UiLayoutSizeMap = Record<string, UiLayoutSize>
/** Width/height are normalized viewport fractions, isolated from position storage. */
export function validateUiLayoutSizes(value: unknown): UiLayoutSizeMap {
  const result: UiLayoutSizeMap = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [id, raw] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!id || id.length > MAX_ID_LENGTH || ['__proto__', 'prototype', 'constructor'].includes(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const { width, height } = raw as Record<string, unknown>
    if (typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) result[id] = { width: Math.min(MAX_SIZE_FRACTION, Math.max(0.02, width)), height: Math.min(MAX_SIZE_FRACTION, Math.max(0.02, height)) }
  }
  return result
}
export function readUiLayoutSizes(storage?: Pick<Storage, 'getItem'> | null): UiLayoutSizeMap {
  try { const target = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage; return validateUiLayoutSizes(JSON.parse(target?.getItem(UI_LAYOUT_SIZE_STORAGE_KEY) ?? 'null')) } catch { return validateUiLayoutSizes(null) }
}
export interface UiLayoutSwapRequest {
  source: HTMLElement
  start: { left: number; top: number }
  clientX: number
  clientY: number
  result?: { left: number; top: number }
}
/** Position-only exchange across layout systems; no components, commands or values are serialized. */
export function requestUiLayoutSwap(source: HTMLElement, start: { left: number; top: number }, clientX: number, clientY: number): UiLayoutSwapRequest['result'] {
  if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return undefined
  const detail: UiLayoutSwapRequest = { source, start, clientX, clientY }
  window.dispatchEvent(new CustomEvent(UI_LAYOUT_SWAP_EVENT, { detail }))
  return detail.result
}
export interface UiLayoutEntity {
  id: string
  component: string
  components: { position: UiLayoutOffset; size?: UiLayoutSize; movable: true; swappable: true; resizable: true; [component: string]: unknown }
}
const limit = (n: number) => Math.max(-1, Math.min(1, n))
/** Untrusted layouts cannot inject styles, prototype properties or unlimited entities. */
export function validateUiLayout(value: unknown): UiLayoutMap {
  const result: UiLayoutMap = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [id, raw] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!id || id.length > MAX_ID_LENGTH || ['__proto__', 'prototype', 'constructor'].includes(id)) continue
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const { x, y } = raw as Record<string, unknown>
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) result[id] = { x: limit(x), y: limit(y) }
  }
  return result
}
export function readUiLayout(storage?: Pick<Storage, 'getItem'> | null): UiLayoutMap {
  try {
    const target = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage
    return validateUiLayout(JSON.parse(target?.getItem(UI_LAYOUT_STORAGE_KEY) ?? 'null'))
  } catch { return validateUiLayout(null) }
}
interface Snapshot {
  display: string; translate: string; x: string; y: string; position: string; zIndex: string; touchAction: string; width: string; height: string
  minWidth: string; maxWidth: string; minHeight: string; maxHeight: string; boxSizing: string; flex: string
  baseX: string; baseY: string
}
interface Rect { left: number; top: number; width: number; height: number }
interface Drag {
  element: HTMLElement; id: string; pointerId: number; x: number; y: number; sizeOriginal?: UiLayoutSize
  original?: UiLayoutOffset; start: UiLayoutOffset; base: Rect; moved: boolean; kind: 'move' | 'resize'; pendingX?: number; pendingY?: number
}
interface Runtime { root: HTMLElement; cleanup: () => void; setEditing: (value: boolean) => void; reset: () => void; entities: () => UiLayoutEntity[] }
let activeRuntime: Runtime | null = null
const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }))
function eligible(el: HTMLElement, root: HTMLElement): boolean {
  const homeItem = el.hasAttribute('data-home-item')
  return el.isConnected && el !== root && (el.hasAttribute('data-ui-layout-id') || homeItem) &&
    !el.closest('[data-ui-layout-ignore]') &&
    !el.matches('html, body, #app, .mla, [data-ui-layout-shell]')
}
function size() { return { width: Math.max(1, typeof window === 'undefined' ? 1 : window.innerWidth), height: Math.max(1, typeof window === 'undefined' ? 1 : window.innerHeight) } }
/** Independent translate composes with the component's original transform and translate. */
function translationParts(value: string): [string, string] {
  if (!value || value === 'none') return ['0px', '0px']
  const parts = value.match(/calc\([^)]*\)|[^\s]+/g) ?? []
  return [parts[0] || '0px', parts[1] || '0px']
}
export function installUiLayout(root: HTMLElement): () => void {
  activeRuntime?.cleanup()
  const offsets = readUiLayout()
  const dimensions = readUiLayoutSizes()
  const originals = new Map<HTMLElement, Snapshot>()
  const focusOriginals = new Map<HTMLElement, string | null>()
  const unclipped = new Map<HTMLElement, { overflow: string; overflowX: string; overflowY: string }>()
  let editing = false
  let mode: 'move' | 'swap' | 'resize' | 'appearance' = 'move'
  let frame: number | ReturnType<typeof setTimeout> = 0
  let drag: Drag | null = null
  let suppressClickUntil = 0
  let textHoldTarget: HTMLElement | null = null
  let heldPointer: number | null = null
  let entry: { pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null
  let swapTarget: HTMLElement | null = null
  let disposed = false
  const idOf = (el: HTMLElement) => el.getAttribute('data-ui-layout-id') || (el.hasAttribute('data-home-item') ? `home:${el.getAttribute('data-home-item')}` : '')
  const targets = () => Array.from(root.querySelectorAll<HTMLElement>('[data-ui-layout-id], [data-home-item]')).filter(el => eligible(el, root))
  const status = (message: string) => emit('cybermanju:ui-layout-status', { message })
  const save = () => {
    try { localStorage.setItem(UI_LAYOUT_STORAGE_KEY, JSON.stringify(offsets)); status('Component positions saved on this device.') }
    catch { status('Positions kept for this session; device storage is unavailable.') }
  }
  function snapshot(el: HTMLElement): Snapshot {
    let original = originals.get(el)
    if (!original) {
      const css = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
      const [baseX, baseY] = translationParts(css?.translate || el.style.translate)
      original = { display: el.style.display, translate: el.style.translate, x: el.style.getPropertyValue(X_VAR), y: el.style.getPropertyValue(Y_VAR), position: el.style.position, zIndex: el.style.zIndex, touchAction: el.style.touchAction, width: el.style.width, height: el.style.height, minWidth: el.style.minWidth, maxWidth: el.style.maxWidth, minHeight: el.style.minHeight, maxHeight: el.style.maxHeight, boxSizing: el.style.boxSizing, flex: el.style.flex, baseX, baseY }
      originals.set(el, original)
    }
    return original
  }
  function restore(el: HTMLElement) {
    const original = originals.get(el)
    if (!original) return // Never erase unrelated/home-owned inline styles.
    if (!el.closest('[data-home-item], .desktop-icons')) {
      el.style.translate = original.translate
      el.style.position = original.position
      el.style.zIndex = original.zIndex
      original.x ? el.style.setProperty(X_VAR, original.x) : el.style.removeProperty(X_VAR)
      original.y ? el.style.setProperty(Y_VAR, original.y) : el.style.removeProperty(Y_VAR)
    }
    el.style.display = original.display
    el.style.width = original.width
    el.style.height = original.height
    el.style.minWidth = original.minWidth
    el.style.maxWidth = original.maxWidth
    el.style.minHeight = original.minHeight
    el.style.maxHeight = original.maxHeight
    el.style.boxSizing = original.boxSizing
    el.style.flex = original.flex
  }
  function unclip(el: HTMLElement) {
    for (let parent = el.parentElement; parent && parent !== root && parent.id !== 'app'; parent = parent.parentElement) {
      if (!unclipped.has(parent)) unclipped.set(parent, { overflow: parent.style.overflow, overflowX: parent.style.overflowX, overflowY: parent.style.overflowY })
      parent.style.overflow = 'visible'
      parent.style.overflowX = 'visible'
      parent.style.overflowY = 'visible'
    }
  }
  function restoreClipping() {
    for (const [el, original] of unclipped) {
      el.style.overflow = original.overflow
      el.style.overflowX = original.overflowX
      el.style.overflowY = original.overflowY
    }
    unclipped.clear()
  }
  function syncEntity(el: HTMLElement) {
    const id = idOf(el)
    const viewport = size()
    const homeTranslate = el.hasAttribute('data-home-item') ? translationParts(el.style.translate) : null
    const position = homeTranslate ? { x: (parseFloat(homeTranslate[0]) || 0) / viewport.width, y: (parseFloat(homeTranslate[1]) || 0) / viewport.height } : offsets[id] ?? { x: 0, y: 0 }
    const entity = registerUiEntity({ id, component: el.getAttribute('data-ui-component') || el.tagName.toLowerCase(), components: { position: { ...position }, movable: true, swappable: true, resizable: true, ...(dimensions[id] ? { size: { ...dimensions[id] } } : {}) } })
    if (entity && !dimensions[id]) delete entity.components.size
  }
  function apply(el: HTMLElement) {
    if (!eligible(el, root)) return
    syncEntity(el)
    const p = offsets[idOf(el)]
    const dimensionsForEl = dimensions[idOf(el)]
    if (!p && !dimensionsForEl) { restore(el); return }
    const original = snapshot(el)
    // CSS translate and dimensions do not apply to non-replaced inline text.
    if (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'inline') el.style.display = 'inline-block'
    const { width, height } = size()
    if (dimensionsForEl) {
      el.style.width = `${Math.round(dimensionsForEl.width * width * 100) / 100}px`; el.style.height = `${Math.round(dimensionsForEl.height * height * 100) / 100}px`
      el.style.boxSizing = 'border-box'; el.style.minWidth = '0px'; el.style.maxWidth = 'none'; el.style.minHeight = '0px'; el.style.maxHeight = 'none'; el.style.flex = '0 0 auto'
    } else { el.style.width = original.width; el.style.height = original.height; el.style.minWidth = original.minWidth; el.style.maxWidth = original.maxWidth; el.style.minHeight = original.minHeight; el.style.maxHeight = original.maxHeight; el.style.boxSizing = original.boxSizing; el.style.flex = original.flex }
    if (!p) { restore(el); if (dimensionsForEl) { if (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'inline') el.style.display = 'inline-block'; el.style.width = `${Math.round(dimensionsForEl.width * width * 100) / 100}px`; el.style.height = `${Math.round(dimensionsForEl.height * height * 100) / 100}px`; el.style.boxSizing = 'border-box'; el.style.minWidth = '0px'; el.style.maxWidth = 'none'; el.style.minHeight = '0px'; el.style.maxHeight = 'none'; el.style.flex = '0 0 auto' } return }
    el.style.setProperty(X_VAR, `${p.x * width}px`)
    el.style.setProperty(Y_VAR, `${p.y * height}px`)
    el.style.translate = `calc(${original.baseX} + var(${X_VAR})) calc(${original.baseY} + var(${Y_VAR}))`
    if (typeof getComputedStyle === 'function' && getComputedStyle(el).position === 'static') el.style.position = 'relative'
    // Window focus owns its stacking outside a drag; do not pin every saved
    // window to the same z-index and break the existing window manager.
    if (el === drag?.element) el.style.zIndex = '2147483640'
    else if (!el.classList.contains('app-window')) el.style.zIndex = '1000'
    else if (el.style.zIndex === '2147483640') el.style.zIndex = original.zIndex
    unclip(el)
  }
  function baseRect(el: HTMLElement, p = offsets[idOf(el)] ?? { x: 0, y: 0 }): Rect {
    const r = el.getBoundingClientRect(); const { width, height } = size()
    return { left: r.left - p.x * width, top: r.top - p.y * height, width: r.width, height: r.height }
  }
  function clamp(base: Rect, p: UiLayoutOffset): UiLayoutOffset {
    const { width, height } = size()
    const minX = (8 - base.left) / width; const minY = (8 - base.top) / height
    const maxX = (width - 8 - base.width - base.left) / width
    const maxY = (height - 8 - base.height - base.top) / height
    return { x: limit(Math.max(minX, Math.min(Math.max(minX, maxX), p.x))), y: limit(Math.max(minY, Math.min(Math.max(minY, maxY), p.y))) }
  }
  function restoreFocusability(el: HTMLElement) {
    if (!focusOriginals.has(el)) return
    const tabindex = focusOriginals.get(el)
    if (tabindex == null) el.removeAttribute('tabindex')
    else el.setAttribute('tabindex', tabindex)
    focusOriginals.delete(el)
  }
  function reconcile(rebound = false) {
    if (disposed) return
    restoreClipping()
    for (const el of originals.keys()) if (!el.isConnected) originals.delete(el)
    // A Vue rerender may have replaced an inline style object. Reapply first,
    // then measure; nested entities inherit their parent's persisted placement.
    const list = targets()
    for (const el of focusOriginals.keys()) if (!editing || !list.includes(el)) restoreFocusability(el)
    pruneUiEntities(list.map(idOf))
    list.forEach(apply)
    if (rebound) for (const el of list) {
      const id = idOf(el)
      if (offsets[id] && el.getClientRects().length) { offsets[id] = clamp(baseRect(el), offsets[id]); apply(el) }
    }
    for (const el of list) {
      // Plain text cannot receive focus() by default. Make it reachable only
      // during editing; preserve native controls and the author's tabindex.
      if (editing && el.tabIndex < 0 && !el.matches(':disabled')) {
        if (!focusOriginals.has(el)) focusOriginals.set(el, el.getAttribute('tabindex'))
        el.setAttribute('tabindex', '0')
      }
      if (editing) { snapshot(el); el.setAttribute('data-ui-layout-editable', ''); el.style.touchAction = 'none' }
      else { el.removeAttribute('data-ui-layout-editable'); const original = originals.get(el); if (original) el.style.touchAction = original.touchAction }
    }
  }
  function clearSwap() { swapTarget?.removeAttribute('data-ui-layout-swap-target'); swapTarget = null }
  function clearEntry() { if (entry) clearTimeout(entry.timer); entry = null }
  function finish(cancel: boolean) {
    if (frame) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame as number); else clearTimeout(frame as ReturnType<typeof setTimeout>); frame = 0 }
    const current = drag
    if (!current) return
    drag = null
    if (cancel) {
      if (current.original) offsets[current.id] = current.original
      else delete offsets[current.id]
      if (current.kind === 'resize') { if (current.sizeOriginal) dimensions[current.id] = current.sizeOriginal; else delete dimensions[current.id] }
      restore(current.element)
      apply(current.element)
      status(current.kind === 'resize' ? 'Resize cancelled.' : 'Move cancelled.')
    }
    current.element.removeAttribute('data-ui-layout-dragging')
    try { if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId) } catch { /* Removed or synthetic pointer. */ }
    clearSwap()
    reconcile()
  }
  function setEditing(next: boolean) {
    if (!next) {
      clearEntry()
      // Done commits the visible placement. Escape/pointercancel still explicitly
      // roll back; an unfinished swap has no destination and remains cancellable.
      if (drag?.moved && mode !== 'swap') {
        flushPending()
        persistDrag(drag)
        finish(false)
      } else finish(true)
    }
    editing = next
    root.classList.toggle(EDIT_CLASS, next)
    reconcile()
  }
  function closest(event: Event): HTMLElement | null {
    return event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-layout-id], [data-home-item]') : null
  }
  function ignored(event: Event): boolean { return event.target instanceof Element && !!event.target.closest('[data-ui-layout-ignore]') }
  function homeOwned(event: Event): boolean { const el = closest(event); return !!el && (el.hasAttribute('data-home-item') || (!el.hasAttribute('data-ui-layout-id') && !!el.closest('.desktop-icons'))) }
  function findPartner(x: number, y: number, source: HTMLElement): HTMLElement | null {
    if (typeof document.elementsFromPoint !== 'function') return null
    for (const node of document.elementsFromPoint(x, y)) {
      const el = node.closest<HTMLElement>('[data-ui-layout-id]')
      if (!el || !eligible(el, root) || el === source || idOf(el) === idOf(source) || el.contains(source) || source.contains(el) || !el.getClientRects().length) continue
      return el
    }
    return null
  }
  const candidate = (x: number, y: number) => drag ? findPartner(x, y, drag.element) : null
  function keepsNativeTextMenu(editable: HTMLElement): boolean {
    const input = editable instanceof HTMLInputElement ? editable : null
    const credentialHint = `${'name' in editable ? editable.name : ''} ${editable.id} ${editable.getAttribute('autocomplete') ?? ''} ${editable.getAttribute('aria-label') ?? ''} ${editable.getAttribute('placeholder') ?? ''} ${editable.getAttribute('data-secret') ?? ''}`
    if (editable.hasAttribute('data-secret') || /password|passwd|secret|token|api.?key|private.?key|credential|one.?time.?code/i.test(credentialHint)) return true
    return !!input && !['text', 'search', 'url', 'tel'].includes(input.type.toLowerCase())
  }
  function textFor(event: Event, el: HTMLElement, x: number, y: number): string {
    const target = event.target instanceof Element ? event.target : el
    // Editable targets use the form-aware menu. Never include their values in the event.
    const editable = target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])')
    if (editable) {
      if (keepsNativeTextMenu(editable)) return ''
      emit(UI_LAYOUT_TEXT_EVENT, { id: idOf(el), x, y, target: editable, form: true })
      return ''
    }
    const direct = Array.from(target.childNodes ?? []).filter(node => node.nodeType === 3).map(node => node.textContent || '').join('').trim()
    return direct || (target.matches('p, span, label, h1, h2, h3, h4, h5, h6, li, code, pre, blockquote') ? (target.textContent || '').trim() : '')
  }
  function activateHold(event: Event, el: HTMLElement, x: number, y: number, pointer?: number) {
    if (!el.isConnected) return
    const editable = event.target instanceof Element ? event.target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])') : null
    if (editable && keepsNativeTextMenu(editable)) return
    textHoldTarget = editable
    heldPointer = pointer ?? ('pointerId' in event ? (event as PointerEvent).pointerId : null)
    suppressClickUntil = Date.now() + 800
    const text = textFor(event, el, x, y)
    if (text) emit(UI_LAYOUT_TEXT_EVENT, { id: idOf(el), text, x, y, target: el })
    else {
      const target = event.target instanceof Element ? event.target : el
      // A protected/editor field is not text content and must not turn a hold into edit mode.
      if (target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
      emit(UI_LAYOUT_EVENT, { editing: true })
    }
  }
  function onDown(event: PointerEvent) {
    if (event.isPrimary === false) { clearEntry(); return }
    if (event.button !== 0 || ignored(event)) return
    if (editing && homeOwned(event) && mode !== 'resize') return
    if (editing && mode === 'appearance') { event.preventDefault(); event.stopImmediatePropagation(); return }
    if (!editing) {
      const el = closest(event) || (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-layout-entry]') : null)
      if (!el) return
      clearEntry()
      entry = { pointer: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
        entry = null
        activateHold(event, el, event.clientX, event.clientY)
      }, 550) }
      return
    }
    if (drag) return
    const el = closest(event)
    if (!el || !eligible(el, root)) return
    textHoldTarget = null
    const original = offsets[idOf(el)]
    const rect = el.getBoundingClientRect()
    drag = { element: el, id: idOf(el), pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...(original ?? { x: 0, y: 0 }) }, original: original ? { ...original } : undefined, base: baseRect(el), moved: false, kind: mode === 'resize' ? 'resize' : 'move', sizeOriginal: dimensions[idOf(el)] ? { ...dimensions[idOf(el)] } : undefined, pendingX: rect.width, pendingY: rect.height }
    snapshot(el)
    el.setAttribute('data-ui-layout-dragging', '')
    el.focus?.({ preventScroll: true })
    try { el.setPointerCapture(event.pointerId) } catch { /* Global listeners are the fallback. */ }
    event.preventDefault(); event.stopImmediatePropagation()
  }
  function applyPending() {
    frame = 0
    const current = drag
    if (!current || !current.moved) return
    const { width, height } = size()
    if (current.kind === 'resize') {
      const w = Math.max(MIN_SIZE, Math.min(width * MAX_SIZE_FRACTION, current.pendingX ?? current.base.width))
      const h = Math.max(MIN_SIZE, Math.min(height * MAX_SIZE_FRACTION, current.pendingY ?? current.base.height))
      dimensions[current.id] = { width: w / width, height: h / height }
      apply(current.element)
    } else {
      offsets[current.id] = clamp(current.base, { x: current.start.x + ((current.pendingX ?? current.x) - current.x) / width, y: current.start.y + ((current.pendingY ?? current.y) - current.y) / height })
      apply(current.element)
      clearSwap()
      if (mode === 'swap') { swapTarget = candidate(current.pendingX ?? current.x, current.pendingY ?? current.y); swapTarget?.setAttribute('data-ui-layout-swap-target', '') }
    }
  }
  function flushPending() {
    if (frame) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame as number); else clearTimeout(frame as ReturnType<typeof setTimeout>); frame = 0 }
    applyPending()
  }
  function persistDrag(current: Drag) {
    if (current.kind === 'resize') {
      try { localStorage.setItem(UI_LAYOUT_SIZE_STORAGE_KEY, JSON.stringify(dimensions)); status('Component sizes saved on this device.') }
      catch { status('Sizes kept for this session; device storage is unavailable.') }
    } else save()
    suppressClickUntil = Date.now() + 500
  }
  function onMove(event: PointerEvent) {
    if (entry && event.pointerId === entry.pointer && Math.hypot(event.clientX - entry.x, event.clientY - entry.y) > 10) clearEntry()
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x; const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    if (drag.kind === 'resize') { drag.pendingX = drag.base.width + dx; drag.pendingY = drag.base.height + dy }
    else { drag.pendingX = event.clientX; drag.pendingY = event.clientY }
    if (!frame) { if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(applyPending); else { applyPending(); frame = 0 } }
    event.preventDefault(); event.stopImmediatePropagation()
  }
  function onUp(event: PointerEvent) {
    if (heldPointer === event.pointerId) { heldPointer = null; suppressClickUntil = Date.now() + 800 }
    if (entry?.pointer === event.pointerId) clearEntry()
    if (!drag || drag.pointerId !== event.pointerId) return
    const current = drag
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      if (current.kind === 'resize') {
        current.pendingX = current.base.width + event.clientX - current.x
        current.pendingY = current.base.height + event.clientY - current.y
      } else { current.pendingX = event.clientX; current.pendingY = event.clientY }
      current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 3
    }
    flushPending()
    if (current.moved && current.kind === 'move' && mode === 'swap') {
      const other = candidate(event.clientX, event.clientY)
      const { width, height } = size()
      if (!other) {
        const placement = requestUiLayoutSwap(current.element, { left: current.base.left + current.start.x * width, top: current.base.top + current.start.y * height }, event.clientX, event.clientY)
        if (!placement) { finish(true); suppressClickUntil = Date.now() + 500; return }
        offsets[current.id] = clamp(current.base, { x: (placement.left - current.base.left) / width, y: (placement.top - current.base.top) / height })
        apply(current.element); save(); finish(false); suppressClickUntil = Date.now() + 500
        event.preventDefault(); event.stopImmediatePropagation()
        return
      }
      const otherId = idOf(other); const otherOffset = offsets[otherId] ?? { x: 0, y: 0 }
      const otherBase = baseRect(other, otherOffset)
      const otherRect = other.getBoundingClientRect()
      const startLeft = current.base.left + current.start.x * width
      const startTop = current.base.top + current.start.y * height
      offsets[current.id] = clamp(current.base, { x: (otherRect.left - current.base.left) / width, y: (otherRect.top - current.base.top) / height })
      offsets[otherId] = clamp(otherBase, { x: (startLeft - otherBase.left) / width, y: (startTop - otherBase.top) / height })
      apply(current.element); apply(other)
    }
    if (current.moved) persistDrag(current)
    finish(false)
    event.preventDefault(); event.stopImmediatePropagation()
  }
  function onCancel(event: Event) {
    if ('pointerId' in event) {
      const pointer = (event as PointerEvent).pointerId
      if (entry?.pointer === pointer) clearEntry()
      if (drag?.pointerId === pointer) finish(true)
    } else { clearEntry(); finish(true) }
  }
  function onClick(event: MouseEvent) {
    if (ignored(event)) return
    const ghostClick = Date.now() < suppressClickUntil && (!textHoldTarget || (event.target instanceof Node && textHoldTarget.contains(event.target)))
    if ((editing && closest(event)) || ghostClick) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  function onContext(event: Event) {
    if (ignored(event)) return
    const editor = event.target instanceof Element ? event.target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])') : null
    if (!editing && editor && keepsNativeTextMenu(editor)) { clearEntry(); return }
    const el = closest(event)
    if (!el) return
    // Android emits contextmenu before the 550ms timer. Consume the same hold once,
    // never let native selection or a legacy launcher sheet race the text menu.
    if (!editing && entry) {
      const { x, y, pointer } = entry
      clearEntry(); activateHold(event, el, x, y, pointer)
    } else if (!editing && !entry && event.target instanceof Element) {
      const editable = event.target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])')
      if (editable) activateHold(event, el, 'clientX' in event ? Number(event.clientX) : 0, 'clientY' in event ? Number(event.clientY) : 0)
    }
    if (editing || Date.now() < suppressClickUntil || (!editing && event.target instanceof Element && !!event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && entry) clearEntry()
    if (!editing || (homeOwned(event) && mode !== 'resize')) return
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation()
      if (drag) finish(true)
      else emit(UI_LAYOUT_EVENT, { editing: false })
      return
    }
    if (ignored(event)) return
    const el = closest(event)
    if (!el || !eligible(el, root)) return
    if (mode === 'appearance') return
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = arrows[event.key]
    if (delta) {
      finish(true)
      if (mode === 'resize') {
        const id = idOf(el), rect = el.getBoundingClientRect(), { width, height } = size(), old = dimensions[id] ?? { width: rect.width / width, height: rect.height / height }, step = event.shiftKey ? 10 : 2
        dimensions[id] = { width: Math.max(MIN_SIZE / width, Math.min(MAX_SIZE_FRACTION, old.width + delta[0] * step / width)), height: Math.max(MIN_SIZE / height, Math.min(MAX_SIZE_FRACTION, old.height + delta[1] * step / height)) }
        apply(el); try { localStorage.setItem(UI_LAYOUT_SIZE_STORAGE_KEY, JSON.stringify(dimensions)) } catch { status('Sizes kept for this session; device storage is unavailable.') }
        event.preventDefault(); event.stopImmediatePropagation(); return
      }
      const id = idOf(el); const p = offsets[id] ?? { x: 0, y: 0 }; const step = event.shiftKey ? 10 : 2; const { width, height } = size()
      offsets[id] = clamp(baseRect(el, p), { x: p.x + delta[0] * step / width, y: p.y + delta[1] * step / height })
      apply(el); save()
    }
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation() }
  }
  function reset() {
    finish(true)
    for (const id of Object.keys(offsets)) delete offsets[id]
    for (const id of Object.keys(dimensions)) delete dimensions[id]
    for (const el of originals.keys()) restore(el)
    restoreClipping()
    try { localStorage.removeItem(UI_LAYOUT_STORAGE_KEY); localStorage.removeItem(UI_LAYOUT_SIZE_STORAGE_KEY); status('All component positions and sizes reset on this device.') }
    catch { status('Positions and sizes reset for this session; device storage is unavailable.') }
    reconcile()
  }
  function onEdit(event: Event) {
    const next = (event as CustomEvent<{ editing?: boolean }>).detail?.editing
    if (typeof next === 'boolean') setEditing(next)
  }
  function onMode(event: Event) {
    const next = (event as CustomEvent<{ mode?: string }>).detail?.mode
    if (next === 'move' || next === 'swap' || next === 'resize' || next === 'appearance') { finish(true); mode = next; root.classList.toggle('ui-layout-resize-mode', next === 'resize') }
  }
  function onExternalSwap(event: Event) {
    const detail = (event as CustomEvent<UiLayoutSwapRequest>).detail
    if (!editing || !detail || detail.result || !detail.source?.closest('[data-home-item]')) return
    const other = findPartner(detail.clientX, detail.clientY, detail.source)
    if (!other) return
    const before = other.getBoundingClientRect(); const base = baseRect(other); const { width, height } = size()
    offsets[idOf(other)] = clamp(base, { x: (detail.start.left - base.left) / width, y: (detail.start.top - base.top) / height })
    apply(other); save()
    detail.result = { left: before.left, top: before.top }
  }
  function onStorage(event: StorageEvent) {
    const key = deploymentStorageEventKey(event.key)
    if (event.key !== null && key !== UI_LAYOUT_STORAGE_KEY && key !== UI_LAYOUT_SIZE_STORAGE_KEY) return
    finish(true)
    if (event.key === null || key === UI_LAYOUT_STORAGE_KEY) {
      let fresh: UiLayoutMap
      try { fresh = validateUiLayout(JSON.parse(event.newValue ?? 'null')) } catch { fresh = validateUiLayout(null) }
      for (const id of Object.keys(offsets)) delete offsets[id]
      Object.assign(offsets, fresh)
    }
    if (event.key === null || key === UI_LAYOUT_SIZE_STORAGE_KEY) {
      let fresh: UiLayoutSizeMap
      try { fresh = validateUiLayoutSizes(JSON.parse(event.newValue ?? 'null')) } catch { fresh = validateUiLayoutSizes(null) }
      for (const id of Object.keys(dimensions)) delete dimensions[id]
      Object.assign(dimensions, fresh)
    }
    reconcile(true)
  }
  const onResize = () => { finish(true); reconcile(true) }
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => reconcile(true))
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ui-layout-id'] })
  root.setAttribute('data-ui-layout-runtime', '')
  root.addEventListener('pointerdown', onDown, true)
  root.addEventListener('click', onClick, true)
  root.addEventListener('contextmenu', onContext, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('blur', onCancel)
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('storage', onStorage)
  window.addEventListener(UI_LAYOUT_EVENT, onEdit)
  window.addEventListener(UI_LAYOUT_RESET_EVENT, reset)
  window.addEventListener(UI_LAYOUT_MODE_EVENT, onMode)
  window.addEventListener(UI_LAYOUT_SWAP_EVENT, onExternalSwap)
  reconcile(true)
  function cleanup() {
    clearEntry(); heldPointer = null; finish(true); disposed = true
    observer?.disconnect()
    root.removeEventListener('pointerdown', onDown, true)
    root.removeEventListener('click', onClick, true)
    root.removeEventListener('contextmenu', onContext, true)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('blur', onCancel)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(UI_LAYOUT_EVENT, onEdit)
    window.removeEventListener(UI_LAYOUT_RESET_EVENT, reset)
    window.removeEventListener(UI_LAYOUT_MODE_EVENT, onMode)
    window.removeEventListener(UI_LAYOUT_SWAP_EVENT, onExternalSwap)
    root.removeAttribute('data-ui-layout-runtime')
    root.classList.remove(EDIT_CLASS, 'ui-layout-resize-mode')
    for (const el of focusOriginals.keys()) restoreFocusability(el)
    for (const [el, original] of originals) {
      restore(el); el.style.touchAction = original.touchAction
      el.removeAttribute('data-ui-layout-editable'); el.removeAttribute('data-ui-layout-dragging')
    }
    restoreClipping()
    pruneUiEntities([])
    if (activeRuntime?.root === root) activeRuntime = null
  }
  activeRuntime = { root, cleanup, setEditing, reset, entities: () => getUiEntitiesSnapshot() as UiLayoutEntity[] }
  return cleanup
}
/** Public controls broadcast the same app-owned session contract as icon long-press. */
export function enterUiLayout(): void { if (activeRuntime) emit(UI_LAYOUT_EVENT, { editing: true }) }
export function exitUiLayout(): void { if (activeRuntime) emit(UI_LAYOUT_EVENT, { editing: false }) }
export function resetUiLayout(): void { if (activeRuntime) emit(UI_LAYOUT_RESET_EVENT) }
export function getUiLayoutEntities(): UiLayoutEntity[] { return activeRuntime?.entities() ?? [] }
