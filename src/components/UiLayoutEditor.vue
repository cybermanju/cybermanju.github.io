<script setup lang="ts">
// CyberManju OS — global UI layout and appearance editor.
// Role: expose per-item customization through an icon long-press.
// Integrates: persisted UI appearance, local raster images and the offline icon catalog.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { ensureUiIconCatalog, readUiIconImage } from '@/utils/uiIconCatalog'
import { setUiAppearance, UI_APPEARANCE_SELECTION_EVENT } from '@/utils/uiAppearance'
type Mode = 'move' | 'swap' | 'resize' | 'appearance'
const editing = ref(false)
const mode = ref<Mode>('move')
const status = ref('')
const selected = ref<{ id: string; label: string } | null>(null)
const icons = ref<string[]>([])
const search = ref('')
const page = ref(0)
const busy = ref(false)
const loading = ref(false)
const filtered = computed(() => {
  const query = search.value.toLowerCase().trim().replace(/\s+/g, '-')
  return icons.value.filter(name => !query || name.includes(query))
})
const visible = computed(() => filtered.value.slice(page.value * 48, (page.value + 1) * 48))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 48)))
const instructions = computed(() => ({
  move: 'Drag any highlighted element. Arrow keys move; Shift moves faster. Esc cancels.',
  swap: 'Drop one component onto another to exchange their positions. Esc cancels.',
  resize: 'Drag a highlighted element to resize it. Arrow keys resize; Shift resizes faster. Esc cancels.',
  appearance: 'Tap any button or icon, then choose an icon or upload your own image. Labels and actions stay unchanged.',
})[mode.value])
function onEditing(event: Event) {
  const enabled = (event as CustomEvent<{ editing?: boolean }>).detail?.editing
  if (typeof enabled === 'boolean') {
    editing.value = enabled
    if (!enabled) { selected.value = null; status.value = '' }
  }
}
async function loadIcons() {
  if (icons.value.length || loading.value) return
  loading.value = true
  try { icons.value = await ensureUiIconCatalog() }
  catch { status.value = 'Could not load the offline icon library. Try again or upload an image.' }
  finally { loading.value = false }
}
function setMode(value: Mode) {
  mode.value = value
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-mode', { detail: { mode: value } }))
  if (value === 'appearance') void loadIcons()
}
function done() {
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-edit', { detail: { editing: false } }))
}
function reset() {
  window.dispatchEvent(new CustomEvent('cybermanju:ui-layout-reset'))
  selected.value = null
}
function onStatus(event: Event) {
  const detail = (event as CustomEvent<{ message?: string }>).detail
  if (typeof detail?.message === 'string') status.value = detail.message
}
function onSelection(event: Event) {
  const detail = (event as CustomEvent<{ id: string; label: string }>).detail
  if (detail?.id) selected.value = detail
}
function applyIcon(name: string) {
  if (selected.value) setUiAppearance(selected.value.id, { kind: 'icon', value: name })
}
function restoreIcon() {
  if (selected.value) setUiAppearance(selected.value.id, null)
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const id = selected.value?.id
  input.value = ''
  if (!file || !id) return
  busy.value = true
  try { setUiAppearance(id, { kind: 'image', value: await readUiIconImage(file) }) }
  catch (error) { status.value = error instanceof Error ? error.message : 'Could not read this image.' }
  finally { busy.value = false }
}
onMounted(() => {
  window.addEventListener('cybermanju:ui-layout-edit', onEditing)
  window.addEventListener('cybermanju:ui-layout-status', onStatus)
  window.addEventListener(UI_APPEARANCE_SELECTION_EVENT, onSelection)
})
onUnmounted(() => {
  window.removeEventListener('cybermanju:ui-layout-edit', onEditing)
  window.removeEventListener('cybermanju:ui-layout-status', onStatus)
  window.removeEventListener(UI_APPEARANCE_SELECTION_EVENT, onSelection)
})
</script>
<template>
  <Teleport to="body">
    <section v-if="editing" class="ui-layout-editor" data-ui-layout-ignore role="region" aria-label="Customize UI components">
      <div class="ui-layout-editor__actions">
        <strong>Customize UI</strong>
        <div role="group" aria-label="Arrangement mode" class="ui-layout-editor__modes">
          <button v-for="item in (['move', 'swap', 'resize', 'appearance'] as const)" :key="item" type="button" :aria-pressed="mode === item" @click="setMode(item)">{{ item === 'appearance' ? 'Icons / image' : item[0].toUpperCase() + item.slice(1) }}</button>
        </div>
        <button type="button" @click="reset">Reset all</button>
        <button type="button" class="ui-layout-editor__done" @click="done">Done</button>
      </div>
      <p>{{ instructions }}</p>
      <div v-if="mode === 'appearance'" class="ui-layout-editor__appearance">
        <p class="ui-layout-editor__selection">{{ selected ? `Selected: ${selected.label}` : 'No element selected — tap a button or icon outside this panel.' }}</p>
        <div class="ui-layout-editor__actions">
          <label class="ui-layout-editor__upload" :class="{ disabled: !selected || busy }">
            {{ busy ? 'Reading image…' : 'Upload image' }}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" :disabled="!selected || busy" aria-label="Upload custom button image" @change="upload" />
          </label>
          <button type="button" :disabled="!selected || busy" @click="restoreIcon">Original icon</button>
          <input v-model="search" type="search" placeholder="Search icons, e.g. camera" aria-label="Search offline icons" @input="page = 0" />
        </div>
        <p v-if="loading" role="status">Loading offline icon library…</p>
        <button v-else-if="!icons.length" type="button" @click="loadIcons">Load icon library</button>
        <div v-else class="ui-layout-editor__icons" role="group" aria-label="Choose replacement icon">
          <button v-for="name in visible" :key="name" type="button" :disabled="!selected || busy" :title="name" :aria-label="`Use ${name.replace('solar:', '')}`" @click="applyIcon(name)"><Icon :icon="name" width="24" height="24" aria-hidden="true" /></button>
        </div>
        <div v-if="icons.length" class="ui-layout-editor__pagination">
          <button type="button" :disabled="page === 0" aria-label="Previous icons" @click="page--">Previous</button>
          <span>{{ filtered.length }} icons · {{ page + 1 }} / {{ pages }}</span>
          <button type="button" :disabled="page + 1 >= pages" aria-label="Next icons" @click="page++">Next</button>
        </div>
        <p>Images stay on this device with your UI layout. PNG, JPEG, WebP, GIF or AVIF, up to 8 MB; animated images use a still frame.</p>
      </div>
      <span v-if="status" role="status" aria-live="polite">{{ status }}</span>
    </section>
  </Teleport>
</template>
<style scoped>
.ui-layout-editor { position: fixed; inset: auto 8px calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 2147483646; margin-inline: auto; width: max-content; max-width: calc(100vw - 16px); max-height: min(60dvh, 550px); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--ui-border, #555); border-radius: 14px; background: var(--ui-bg, #161619); color: var(--ui-text, #fff); box-shadow: 0 6px 32px #0008; font: 12px/1.4 var(--ui-font, sans-serif); }
.ui-layout-editor__actions, .ui-layout-editor__modes, .ui-layout-editor__pagination { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ui-layout-editor strong { margin-right: 4px; }
.ui-layout-editor button, .ui-layout-editor__upload { min-height: 44px; box-sizing: border-box; padding: 6px 10px; border: 1px solid var(--ui-border, #555); border-radius: 8px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.ui-layout-editor button:disabled, .disabled { opacity: .45; cursor: default; }
.ui-layout-editor button:focus-visible, .ui-layout-editor__upload:focus-within { outline: 2px solid var(--ui-accent, #8b7bff); outline-offset: 2px; }
.ui-layout-editor button[aria-pressed="true"], .ui-layout-editor__done { background: var(--ui-accent, #8b7bff) !important; color: #fff !important; }
.ui-layout-editor p { max-width: 540px; margin: 7px 0; opacity: .85; }
.ui-layout-editor [role="status"] { display: block; margin-top: 4px; }
.ui-layout-editor__appearance { max-width: 540px; }
.ui-layout-editor__selection { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-layout-editor__upload { position: relative; display: inline-flex; align-items: center; overflow: hidden; }
.ui-layout-editor__upload input { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: inherit; }
.ui-layout-editor input[type="search"] { flex: 1 1 180px; min-width: 0; min-height: 44px; box-sizing: border-box; border: 1px solid var(--ui-border, #555); border-radius: 8px; padding: 8px; background: transparent; color: inherit; font: inherit; }
.ui-layout-editor__icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; margin-block: 8px; }
.ui-layout-editor__icons button { display: grid; place-items: center; padding: 6px; }
.ui-layout-editor__pagination { justify-content: space-between; }
@media (max-width: 480px) { .ui-layout-editor { width: calc(100vw - 16px); padding: 8px; } .ui-layout-editor strong { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .ui-layout-editor * { scroll-behavior: auto; } }
</style>
