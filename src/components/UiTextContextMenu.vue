<script setup lang="ts">
// CyberManju OS — Role: accessible text context menu for copy and personalization.
// CyberManju OS — Integrates: layout editor and appearance customization events.
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { enterUiLayout, UI_LAYOUT_TEXT_EVENT } from '@/utils/uiLayout'
import { UI_APPEARANCE_SELECTION_EVENT } from '@/utils/uiAppearance'
type TextMenu = { id: string; text: string; x: number; y: number; target: HTMLElement }
const menu = ref<TextMenu | null>(null)
const panel = ref<HTMLElement | null>(null)
const message = ref('')
let previousFocus: HTMLElement | null = null
const placement = computed(() => ({ left: `${Math.max(8, Math.min(menu.value?.x ?? 8, window.innerWidth - 256))}px`, top: `${Math.max(8, Math.min(menu.value?.y ?? 8, window.innerHeight - 180))}px` }))
function close(restore = true) {
  menu.value = null
  if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
}
async function open(event: Event) {
  const detail = (event as CustomEvent<TextMenu>).detail
  if (!detail?.target?.isConnected || !detail.text) return
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  menu.value = detail
  message.value = ''
  await nextTick()
  panel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}
async function copy() {
  if (!menu.value) return
  const text = menu.value.text
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    close()
  } catch {
    // Older Android WebViews may not expose Clipboard API. Copy only this text,
    // never input values or markup, and do not dismiss on a denied clipboard.
    const input = document.createElement('textarea')
    input.value = text
    input.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(input)
    input.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { /* Denied by platform. */ }
    input.remove()
    if (copied) close()
    else { message.value = 'Could not copy. Select the text below to copy it manually.'; await nextTick(); panel.value?.querySelector<HTMLButtonElement>('button')?.focus() }
  }
}
function customize() {
  const selection = menu.value
  if (!selection?.target.isConnected) { close(); return }
  close(false)
  enterUiLayout()
  window.dispatchEvent(new CustomEvent(UI_APPEARANCE_SELECTION_EVENT, { detail: { id: selection.id, label: selection.text.slice(0, 160) } }))
  selection.target.focus?.({ preventScroll: true })
}
function outside(event: Event) { if (menu.value && event.target instanceof Node && !panel.value?.contains(event.target)) close(false) }
function key(event: KeyboardEvent) {
  if (!menu.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
  if (!['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
  event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus()
}
function dismiss() { close(false) }
onMounted(() => {
  window.addEventListener(UI_LAYOUT_TEXT_EVENT, open)
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', dismiss)
  window.addEventListener('resize', dismiss)
  window.addEventListener('scroll', dismiss, true)
})
onUnmounted(() => {
  window.removeEventListener(UI_LAYOUT_TEXT_EVENT, open)
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('keydown', key, true)
  window.removeEventListener('blur', dismiss)
  window.removeEventListener('resize', dismiss)
  window.removeEventListener('scroll', dismiss, true)
})
</script>
<template>
  <Teleport to="body">
    <div v-if="menu" ref="panel" class="ui-text-menu" data-ui-layout-ignore role="dialog" aria-label="Text options" :style="placement">
      <button type="button" @click="copy">Copy text</button>
      <button type="button" @click="customize">Enable customization</button>
      <button type="button" @click="close()">Cancel</button>
      <p v-if="message" role="status">{{ message }}</p>
      <pre v-if="message" tabindex="0">{{ menu.text }}</pre>
    </div>
  </Teleport>
</template>
<style scoped>
.ui-text-menu { position: fixed; z-index: 2147483647; width: min(240px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow: auto; box-sizing: border-box; padding: 8px; border: 1px solid var(--ui-border, #666); border-radius: 12px; background: var(--ui-bg, #111); color: var(--ui-text, #fff); box-shadow: 0 8px 32px #0009; font: 14px/1.4 var(--ui-font, sans-serif); }
.ui-text-menu button { display: block; width: 100%; min-height: 44px; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: start; font: inherit; cursor: pointer; }
.ui-text-menu button:focus-visible { outline: 2px solid var(--ui-accent, #9b8aff); outline-offset: -2px; }
.ui-text-menu pre { white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
</style>
