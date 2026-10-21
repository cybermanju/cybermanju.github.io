// CyberManju OS — per-item UI appearance overrides.
import { h, render, type VNode } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { hasLocalIcon } from './iconify'
import { ensureUiIconCatalog } from './uiIconCatalog'
import { deploymentStorageEventKey } from './deploymentScope'

export const UI_APPEARANCE_SELECTION_EVENT = 'cybermanju:ui-appearance-selection'
export const UI_APPEARANCE_STORAGE_KEY = 'cybermanju.ui.appearance.v1'
const EDIT_EVENT = 'cybermanju:ui-layout-edit'
const MODE_EVENT = 'cybermanju:ui-layout-mode'
const RESET_EVENT = 'cybermanju:ui-layout-reset'
const MAX_ENTRIES = 300
const MAX_ID = 512
const MAX_LABEL = 160
const MAX_ICON = 160
const MAX_IMAGE = 256 * 1024
const MAX_TOTAL = 3 * 1024 * 1024
const HOST = 'data-ui-appearance-host'
export type UiAppearance = { kind: 'icon' | 'image'; value: string }
export type UiAppearanceMap = Record<string, UiAppearance>

function safeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID && !['__proto__', 'prototype', 'constructor'].includes(id)
}
function validAppearance(raw: unknown): UiAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  if (item.kind === 'icon' && typeof item.value === 'string' && item.value.length <= MAX_ICON && /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(item.value)) return { kind: 'icon', value: item.value }
  if (item.kind === 'image' && typeof item.value === 'string' && item.value.length <= MAX_IMAGE && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i.test(item.value)) return { kind: 'image', value: item.value }
  return null
}
export function validateUiAppearance(value: unknown): UiAppearanceMap {
  const output: UiAppearanceMap = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  let total = 0
  for (const [id, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!safeId(id)) continue
    const valid = validAppearance(entry)
    if (valid && total + valid.value.length <= MAX_TOTAL) { output[id] = valid; total += valid.value.length }
  }
  return output
}
function read(): UiAppearanceMap {
  try { return validateUiAppearance(JSON.parse(localStorage.getItem(UI_APPEARANCE_STORAGE_KEY) || 'null')) }
  catch { return validateUiAppearance(null) }
}
let current: UiAppearanceMap = read()
let expandedCatalogReady = false
const savedNodes = new Map<HTMLElement, { hidden: HTMLElement[]; hiddenDisplay: Map<HTMLElement, string>; host: HTMLElement }>()
function findTarget(id: string): HTMLElement | null {
  const explicit = Array.from(document.querySelectorAll<HTMLElement>('[data-ui-appearance-id]')).find(el => el.dataset.uiAppearanceId === id)
  if (explicit) return explicit
  if (id.startsWith('home:')) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-home-item], [data-home-item] button, [data-home-item] [role="button"], [data-home-item] a')) if (targetId(el) === id) return el
    return null
  }
  return Array.from(document.querySelectorAll<HTMLElement>('[data-ui-layout-id]')).find(el => el.dataset.uiLayoutId === id) ?? null
}
function labelFor(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || el.dataset.homeItem || 'Item').trim().slice(0, MAX_LABEL)
}
function targetId(el: HTMLElement): string | null {
  if (el.dataset.uiAppearanceId) return el.dataset.uiAppearanceId
  const home = el.closest<HTMLElement>('[data-home-item]')
  if (home) return `home:${home.dataset.homeItem || domPath(home)}${home === el ? '' : `/${domPath(el).slice(domPath(home).length + 1)}`}`
  return el.dataset.uiLayoutId || el.closest<HTMLElement>('[data-ui-layout-id]')?.dataset.uiLayoutId || null
}
function domPath(el: HTMLElement): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement
    const tag = node.tagName.toLowerCase()
    const ordinal = parent ? Array.from(parent.children).filter(s => s.tagName === node!.tagName).indexOf(node) : 0
    parts.unshift(`${tag}-${ordinal}`); node = parent
  }
  return parts.join('/')
}
function originalIcon(target: HTMLElement): HTMLElement[] {
  if (target.matches('svg, img, .app-icon, [data-icon]')) return [target]
  const found = target.querySelectorAll<HTMLElement>('svg, img, .app-icon, [data-icon], .drawer-letter, .mla-letter')
  const icon = Array.from(found).filter(el => !el.closest(`[${HOST}]`)).slice(0, 1)
  return icon
}
function draw(target: HTMLElement, appearance: UiAppearance): void {
  remove(target)
  const host = document.createElement('span')
  host.setAttribute(HOST, '')
  host.className = 'ui-appearance-host'
  host.setAttribute('aria-hidden', 'true')
  const hidden = originalIcon(target)
  const bounds = hidden[0]?.getBoundingClientRect()
  if (bounds?.width && bounds.height) { host.style.width = `${bounds.width}px`; host.style.height = `${bounds.height}px` }
  const displays = new Map<HTMLElement, string>()
  hidden.forEach(el => { displays.set(el, el.style.display); el.style.display = 'none' })
  // SVG is never a mount parent. Attach an overlay host to its owning control.
  const svgRoot = typeof SVGElement !== 'undefined' && target instanceof SVGElement
  const owner = svgRoot ? target.closest<HTMLElement>('button,[role="button"],a') : target
  if (hidden[0]?.parentElement && hidden[0] !== target) hidden[0].before(host)
  else if (hidden[0] === target) target.before(host)
  else if (owner) owner.prepend(host)
  else target.parentElement?.append(host)
  const vnode: VNode = appearance.kind === 'icon'
    ? h(Icon, { icon: appearance.value, class: 'ui-appearance-icon', 'aria-hidden': 'true' })
    : h('img', { src: appearance.value, alt: '', class: 'ui-appearance-image', draggable: false })
  render(vnode, host)
  savedNodes.set(target, { hidden, hiddenDisplay: displays, host })
}
function remove(target: HTMLElement): void {
  const old = savedNodes.get(target)
  if (!old) return
  render(null, old.host)
  old.host.remove()
  old.hidden.forEach(el => { el.style.display = old.hiddenDisplay.get(el) || '' })
  savedNodes.delete(target)
}
function applyAll(root: HTMLElement): void {
  for (const [target, saved] of savedNodes) if (!target.isConnected || !saved.host.isConnected || !current[targetId(target) || '']) remove(target)
  for (const [id, appearance] of Object.entries(current)) {
    if (appearance.kind === 'icon' && !hasLocalIcon(appearance.value) && !expandedCatalogReady) continue
    const target = findTarget(id)
    if (target && root.contains(target) && !savedNodes.has(target)) draw(target, appearance)
  }
}
async function prepareNonlocalIcons(): Promise<void> {
  if (!Object.values(current).some(value => value.kind === 'icon' && !hasLocalIcon(value.value))) return
  try { await ensureUiIconCatalog(); expandedCatalogReady = true } catch { /* Retain the persisted override for a later retry. */ }
}
function save(): boolean {
  try { localStorage.setItem(UI_APPEARANCE_STORAGE_KEY, JSON.stringify(current)); return true } catch { return false }
}
function status(message: string) { window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-status', { detail: { message } })) }
export function setUiAppearance(id: string, appearance: UiAppearance | null): boolean {
  if (!safeId(id)) return false
  const valid = appearance === null ? null : validAppearance(appearance)
  if (appearance !== null && !valid) return false
  const next = validateUiAppearance(current)
  if (valid) next[id] = valid
  else delete next[id]
  if (Object.keys(next).length > MAX_ENTRIES) return false
  const before = current
  current = next
  if (Object.values(next).reduce((sum, item) => sum + item.value.length, 0) > MAX_TOTAL) { current = before; status('Image storage is full. Restore unused icons or choose a smaller image.'); return false }
  if (!save()) { current = before; status('Could not save this icon: device storage is unavailable or full.'); return false }
  const target = findTarget(id)
  if (target && valid?.kind === 'icon' && !hasLocalIcon(valid.value)) {
    void ensureUiIconCatalog().then(() => { expandedCatalogReady = true; if (target.isConnected && current[id]) draw(target, current[id]) }).catch(() => status('Could not load this icon. Your choice is saved; reopen the icon library to retry.'))
  } else if (target) valid ? draw(target, valid) : remove(target)
  status(valid ? 'Button appearance saved on this device.' : 'Original icon restored on this device.')
  return true
}
export function installUiAppearance(root: HTMLElement): () => void {
  let editing = false
  let mode = ''
  let disposed = false
  let frame = 0
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) applyAll(root) }) }
  const select = (event: Event) => {
    if (!editing || mode !== 'appearance' || !(event.target instanceof Element)) return
    if (event.target.closest('[data-ui-layout-ignore]') || !root.contains(event.target)) return
    const hit = event.target.closest<HTMLElement>('button,[role="button"],a') || event.target.closest<HTMLElement>('[data-home-item]') || event.target.closest<HTMLElement>('[data-ui-layout-id]')
    if (!hit) return
    const id = targetId(hit)
    if (!id) return
    event.preventDefault(); event.stopImmediatePropagation()
    window.dispatchEvent(new CustomEvent(UI_APPEARANCE_SELECTION_EVENT, { detail: { id, label: labelFor(hit) } }))
  }
  const suppress = (event: Event) => {
    if (!editing || mode !== 'appearance' || !(event.target instanceof Element)) return
    if (event.target.closest('[data-home-item],.desktop-icons')) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  const keySelect = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') select(event)
  }
  const edit = (event: Event) => { editing = !!(event as CustomEvent).detail?.editing }
  const modeChange = (event: Event) => { mode = (event as CustomEvent).detail?.mode || '' }
  const reset = () => { current = validateUiAppearance(null); save(); for (const el of [...savedNodes.keys()]) remove(el); schedule() }
  const storage = (event: StorageEvent) => {
    if (deploymentStorageEventKey(event.key) !== UI_APPEARANCE_STORAGE_KEY && event.key !== null) return
    current = read(); for (const el of [...savedNodes.keys()]) remove(el); void prepareNonlocalIcons().then(schedule); schedule()
  }
  window.addEventListener('pointerdown', select, true)
  window.addEventListener('keydown', keySelect, true)
  for (const type of ['click','pointerdown','pointerup','dblclick','contextmenu']) window.addEventListener(type, suppress, true)
  window.addEventListener(EDIT_EVENT, edit); window.addEventListener(MODE_EVENT, modeChange); window.addEventListener(RESET_EVENT, reset); window.addEventListener('storage', storage)
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ui-layout-id','data-home-item','data-ui-appearance-id'] })
  void prepareNonlocalIcons().then(schedule)
  schedule()
  return () => {
    disposed = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('pointerdown', select, true)
    window.removeEventListener('keydown', keySelect, true)
    for (const type of ['click','pointerdown','pointerup','dblclick','contextmenu']) window.removeEventListener(type, suppress, true)
    window.removeEventListener(EDIT_EVENT, edit); window.removeEventListener(MODE_EVENT, modeChange); window.removeEventListener(RESET_EVENT, reset); window.removeEventListener('storage', storage)
    for (const el of [...savedNodes.keys()]) remove(el)
  }
}
