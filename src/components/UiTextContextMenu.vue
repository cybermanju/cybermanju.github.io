<script setup lang="ts">
// CyberManju OS — Role: accessible text context menu for copy and personalization.
// CyberManju OS — Integrates: layout editor and appearance customization events.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { enterUiLayout, UI_LAYOUT_TEXT_EVENT } from '@/utils/uiLayout'
import { UI_APPEARANCE_SELECTION_EVENT } from '@/utils/uiAppearance'
import { focusTextMenuKey } from '@/utils/uiTextMenuKeyboard'
type TextMenu = { id: string; text?: string; x: number; y: number; target: HTMLElement; form?: boolean }
const menu = ref<TextMenu | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelSize = ref({ width: 240, height: 240 })
const message = ref('')
let previousFocus: HTMLElement | null = null
let savedRange: Range | null = null
watch([panel, message], () => {
  const rect = panel.value?.getBoundingClientRect()
  if (rect) panelSize.value = { width: rect.width, height: rect.height }
}, { flush: 'post' })
const placement = computed(() => {
  const vv = window.visualViewport
  const left = vv?.offsetLeft ?? 0; const top = vv?.offsetTop ?? 0
  const width = vv?.width ?? window.innerWidth; const height = vv?.height ?? window.innerHeight
  const w = panelSize.value.width; const h = panelSize.value.height
  return {
    left: `${Math.max(left + 8, Math.min(menu.value?.x ?? left + 8, left + width - w - 8))}px`,
    top: `${Math.max(top + 8, Math.min(menu.value?.y ?? top + 8, top + height - h - 8))}px`,
    maxWidth: `${Math.max(44, width - 16)}px`, maxHeight: `${Math.max(44, height - 16)}px`,
  }
})
function control(current: TextMenu) { return current.target instanceof HTMLInputElement || current.target instanceof HTMLTextAreaElement ? current.target : null }
function protectedField(field: HTMLInputElement | HTMLTextAreaElement | HTMLElement) {
  const metadata = `${'name' in field ? field.name : ''} ${field.id} ${field.getAttribute('autocomplete') || ''} ${field.getAttribute('aria-label') || ''} ${field.getAttribute('placeholder') || ''} ${field.getAttribute('data-secret') || ''}`
  return field.hasAttribute('data-secret') || (field instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(field.type)) || /password|passwd|secret|token|api.?key|private.?key|credential|one.?time.?code/i.test(metadata)
}
function canPaste(current: TextMenu) {
  const field = control(current)
  return (!!field && !protectedField(field) && !field.disabled && !field.readOnly && (!(field instanceof HTMLInputElement) || ['text', 'search', 'url', 'tel'].includes(field.type))) || (!!current.target.isContentEditable && !protectedField(current.target))
}
function close(restore = true) {
  const current = menu.value
  menu.value = null
  savedRange = null
  const saved = current && control(current)
  if (restore && current?.target.isConnected) {
    current.target.focus({ preventScroll: true })
    const field = current.form && control(current)
    if (field && field.dataset.uiMenuSelectionStart != null) {
      const start = Number(field.dataset.uiMenuSelectionStart); const end = Number(field.dataset.uiMenuSelectionEnd)
      field.setSelectionRange(start, end)
      delete field.dataset.uiMenuSelectionStart; delete field.dataset.uiMenuSelectionEnd
    }
  } else if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  if (saved) { delete saved.dataset.uiMenuSelectionStart; delete saved.dataset.uiMenuSelectionEnd }
}
async function open(event: Event) {
  const detail = (event as CustomEvent<TextMenu>).detail
  if (!detail?.target?.isConnected || (!detail.text && !detail.form)) return
  const field = detail.form && control(detail)
  if ((field && protectedField(field)) || (detail.form && detail.target.isContentEditable && protectedField(detail.target))) return
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  savedRange = null
  if (detail.target.isContentEditable) {
    const selection = window.getSelection()
    if (selection?.rangeCount && detail.target.contains(selection.anchorNode) && detail.target.contains(selection.focusNode)) savedRange = selection.getRangeAt(0).cloneRange()
  }
  if (field && field.selectionStart != null) {
    field.dataset.uiMenuSelectionStart = String(field.selectionStart)
    field.dataset.uiMenuSelectionEnd = String(field.selectionEnd ?? field.selectionStart)
  }
  menu.value = detail; message.value = ''
  await nextTick()
  panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
}
function getText(current: TextMenu): string | null {
  if (!current.form) return current.text ?? null
  const field = control(current)
  if (field) {
    if (protectedField(field)) return null
    const start = field.selectionStart; const end = field.selectionEnd
    return start != null && end != null && end > start ? field.value.slice(start, end) : field.value
  }
  if (current.target.isContentEditable) {
    if (protectedField(current.target)) return null
    const selection = window.getSelection()
    if (selection?.rangeCount && current.target.contains(selection.anchorNode) && current.target.contains(selection.focusNode)) return selection.toString() || current.target.textContent || ''
    return savedRange?.toString() || current.target.textContent || ''
  }
  return null
}
async function copy() {
  const current = menu.value
  if (!current) return
  const text = getText(current)
  if (text == null) { message.value = 'Text cannot be copied from this control.'; return }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    if (menu.value === current) close()
  } catch {
    if (menu.value !== current) return
    if (current.form) { message.value = 'Clipboard access was denied. Use the device copy action or keyboard shortcut.'; return }
    const input = document.createElement('textarea')
    input.value = text; input.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(input); input.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { /* Denied by platform. */ }
    input.remove()
    if (copied) close()
    else {
      message.value = 'Could not copy. The text below is selected; use your copy shortcut or device copy action.'
      await nextTick()
      const fallback = panel.value?.querySelector<HTMLTextAreaElement>('textarea')
      fallback?.focus({ preventScroll: true }); fallback?.select()
    }
  }
}
async function paste() {
  const current = menu.value; const field = current && control(current)
  if (!current || !current.form || (field && (protectedField(field) || field.disabled || field.readOnly)) || (!field && (!current.target.isContentEditable || protectedField(current.target)))) return
  if (!canPaste(current)) return
  let value: string
  try {
    if (!navigator.clipboard?.readText) throw new Error('Clipboard read unavailable')
    value = await navigator.clipboard.readText()
  } catch {
    if (menu.value === current) message.value = 'Clipboard reading was denied or is unavailable. Use the device paste action or keyboard shortcut.'
    return
  }
  if (menu.value !== current) return
  if (!canPaste(current)) return
  if (!field) {
    const target = current.target
    const selection = window.getSelection()
    const range = savedRange ?? (selection?.rangeCount && target.contains(selection.anchorNode) && target.contains(selection.focusNode) ? selection.getRangeAt(0) : null)
    if (!target.isConnected || !target.isContentEditable || protectedField(target) || !selection || !range || !target.contains(range.commonAncestorContainer)) { message.value = 'Paste is not supported because the editor selection is unavailable.'; return }
    try {
      const maxAttribute = target.getAttribute('maxlength')
      const max = maxAttribute == null ? -1 : Number(maxAttribute)
      const existing = target.textContent ?? ''
      const available = Number.isFinite(max) && max >= 0 ? Math.max(0, max - (existing.length - range.toString().length)) : value.length
      const inserted = value.slice(0, available)
      target.focus({ preventScroll: true })
      range.deleteContents()
      const text = document.createTextNode(inserted)
      range.insertNode(text); range.setStartAfter(text); range.collapse(true)
      selection.removeAllRanges(); selection.addRange(range)
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: inserted }))
      close(false)
    } catch { message.value = 'Plain-text paste is not supported by this editor.' }
    return
  }
  if (!field.isConnected || field.disabled || field.readOnly) return
  const start = field.dataset.uiMenuSelectionStart != null ? Number(field.dataset.uiMenuSelectionStart) : (field.selectionStart ?? field.value.length); const end = field.dataset.uiMenuSelectionEnd != null ? Number(field.dataset.uiMenuSelectionEnd) : (field.selectionEnd ?? start)
  const remaining = field.maxLength >= 0 ? Math.max(0, field.maxLength - (field.value.length - (end - start))) : value.length
  const inserted = value.slice(0, remaining)
  field.focus({ preventScroll: true }); field.setRangeText(inserted, start, end, 'end')
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: inserted }))
  close(false)
}
function selectAll() {
  const current = menu.value
  if (!current) return
  const field = current.form && control(current)
  if (field) {
    field.focus({ preventScroll: true }); field.select()
    if (field.selectionStart != null) { field.dataset.uiMenuSelectionStart = String(field.selectionStart); field.dataset.uiMenuSelectionEnd = String(field.selectionEnd ?? field.selectionStart) }
    return
  }
  if (current.target.isContentEditable) {
    current.target.focus({ preventScroll: true })
    const range = document.createRange(); range.selectNodeContents(current.target)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    savedRange = range.cloneRange()
  }
}
function customize() {
  const selection = menu.value
  if (!selection?.target.isConnected) { close(); return }
  close(false); enterUiLayout()
  window.dispatchEvent(new CustomEvent(UI_APPEARANCE_SELECTION_EVENT, { detail: { id: selection.id, label: (selection.text ?? '').slice(0, 160) } }))
  selection.target.focus?.({ preventScroll: true })
}
function outside(event: Event) { if (menu.value && event.target instanceof Node && !panel.value?.contains(event.target)) close(false) }
function key(event: KeyboardEvent) {
  if (!menu.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
  if (panel.value) focusTextMenuKey(event, panel.value, document.activeElement)
}
function dismiss(event: Event) {
  if (event.type === 'scroll' && event.target instanceof Node && panel.value?.contains(event.target)) return
  close(false)
}
onMounted(() => {
  window.addEventListener(UI_LAYOUT_TEXT_EVENT, open); window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', key, true); window.addEventListener('blur', dismiss)
  window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true); window.visualViewport?.addEventListener('resize', dismiss); window.visualViewport?.addEventListener('scroll', dismiss)
})
onUnmounted(() => {
  window.removeEventListener(UI_LAYOUT_TEXT_EVENT, open); window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('keydown', key, true); window.removeEventListener('blur', dismiss)
  window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); window.visualViewport?.removeEventListener('resize', dismiss); window.visualViewport?.removeEventListener('scroll', dismiss)
})
</script>
<template>
  <Teleport to="body">
    <div v-if="menu" ref="panel" class="ui-text-menu" data-ui-layout-ignore role="dialog" aria-label="Text options" :style="placement">
      <button type="button" @click="copy">Copy text</button>
      <button v-if="menu.form" type="button" @click="paste" :disabled="!canPaste(menu)">Paste</button>
      <button v-if="menu.form" type="button" @click="selectAll">Select all</button>
      <button type="button" @click="customize">Enable customization</button>
      <button type="button" @click="close()">Cancel</button>
      <p v-if="message" id="ui-text-copy-status" role="status">{{ message }}</p>
      <textarea v-if="message && !menu.form" readonly aria-label="Text to copy manually" aria-describedby="ui-text-copy-status" :value="menu.text" />
    </div>
  </Teleport>
</template>
<style scoped>
.ui-text-menu { position: fixed; z-index: 2147483647; width: min(240px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow: auto; box-sizing: border-box; padding: 8px; border: 1px solid var(--ui-border, #666); border-radius: 12px; background: var(--ui-bg, #111); color: var(--ui-text, #fff); box-shadow: 0 8px 32px #0009; font: 14px/1.4 var(--ui-font, sans-serif); }
.ui-text-menu button { display: block; width: 100%; min-height: 44px; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: start; font: inherit; cursor: pointer; }
.ui-text-menu button:focus-visible, .ui-text-menu textarea:focus-visible { outline: 2px solid var(--ui-accent, #9b8aff); outline-offset: -2px; }
.ui-text-menu textarea { box-sizing: border-box; width: 100%; min-height: 88px; padding: 8px; background: transparent; color: inherit; font: inherit; border: 1px solid currentColor; border-radius: 6px; resize: vertical; user-select: text; -webkit-user-select: text; }
</style>
