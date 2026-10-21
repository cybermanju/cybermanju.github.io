<script setup lang="ts">
// CyberManju OS — UI layout editor (src/components/UiLayoutEditor.vue).
// Role: Session-only controls for the shared component layout editor.
// Exports: UiLayoutEditor.
// Integrates: useHomeLayout and app-wide UI entity layout events.
// Contracts: No visible entry button; only icon long-press enters customization.
import { onMounted, onUnmounted, ref } from 'vue'
const editing = ref(false)
const mode = ref<'move' | 'swap'>('move')
const status = ref('')
function onEditing(event: Event) {
  const enabled = (event as CustomEvent<{ editing?: boolean }>).detail?.editing
  if (typeof enabled === 'boolean') editing.value = enabled
}
function setMode(value: 'move' | 'swap') {
  mode.value = value
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-mode', { detail: { mode: value } }))
}
function done() {
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-edit', { detail: { editing: false } }))
}
function reset() {
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-reset'))
  status.value = 'All component positions reset on this device.'
}
function onStatus(event: Event) {
  const detail = (event as CustomEvent<{ message?: string }>).detail
  if (typeof detail?.message === 'string') status.value = detail.message
}
onMounted(() => {
  window.addEventListener('cybermanju:ui-layout-edit', onEditing)
  window.addEventListener('cybermanju:ui-layout-status', onStatus)
})
onUnmounted(() => {
  window.removeEventListener('cybermanju:ui-layout-edit', onEditing)
  window.removeEventListener('cybermanju:ui-layout-status', onStatus)
})
</script>
<template>
  <Teleport to="body">
    <section v-if="editing" class="ui-layout-editor" data-ui-layout-ignore role="region" aria-label="Customize UI components">
      <div class="ui-layout-editor__actions">
        <strong>Customize UI</strong>
        <div role="group" aria-label="Arrangement mode" class="ui-layout-editor__modes">
          <button type="button" :aria-pressed="mode === 'move'" @click="setMode('move')">Move</button>
          <button type="button" :aria-pressed="mode === 'swap'" @click="setMode('swap')">Swap</button>
        </div>
        <button type="button" @click="reset">Reset all</button>
        <button type="button" class="ui-layout-editor__done" @click="done">Done</button>
      </div>
      <p>{{ mode === 'swap' ? 'Drop one component onto another to exchange their positions.' : 'Drag any highlighted component anywhere on screen. Positions save on release.' }} Arrow keys move; Esc cancels.</p>
      <span v-if="status" role="status" aria-live="polite">{{ status }}</span>
    </section>
  </Teleport>
</template>
<style scoped>
.ui-layout-editor { position: fixed; inset: auto 8px calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 2147483646; margin-inline: auto; width: max-content; max-width: calc(100vw - 16px); box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--ui-border, #555); border-radius: 14px; background: var(--ui-bg, #161619); color: var(--ui-text, #fff); box-shadow: 0 6px 32px #0008; font: 12px/1.4 var(--ui-font, sans-serif); }
.ui-layout-editor__actions, .ui-layout-editor__modes { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ui-layout-editor strong { margin-right: 4px; }
.ui-layout-editor button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--ui-border, #555); border-radius: 8px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.ui-layout-editor button[aria-pressed="true"], .ui-layout-editor__done { background: var(--ui-accent, #8b7bff) !important; color: #fff !important; }
.ui-layout-editor p { max-width: 540px; margin: 7px 0 0; opacity: .8; }
.ui-layout-editor [role="status"] { display: block; margin-top: 4px; }
@media (max-width: 480px) { .ui-layout-editor { width: calc(100vw - 16px); padding: 8px; } .ui-layout-editor strong { width: 100%; } .ui-layout-editor button { min-height: 40px; } }
</style>
