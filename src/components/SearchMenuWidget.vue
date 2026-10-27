<template>
  <div ref="root" class="search-menu-widget" :class="{ 'is-open': open, 'is-block': props.block }">
    <button class="search-menu-trigger" type="button" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="toggle">
      <AppIcon name="solar:magnifier-bold" :size="18" />
      <span>{{ open ? 'Close search' : 'Search' }}</span>
    </button>
    <Teleport to="body"><div v-if="open" ref="panel" :id="panelId" class="search-menu-panel" :style="panelStyle" role="dialog" aria-label="Search apps and content" @keydown.esc.stop.prevent="close">
      <OmniSearchPanel :home="props.home" :menu-open="open" :auto-focus="false" :before-open="props.beforeOpen" />
    </div></Teleport>
  </div>
</template>

<script setup lang="ts">
// CyberManju OS — SearchMenuWidget (src/components/SearchMenuWidget.vue).
// Role: Reusable, click-open search menu that keeps keyboard focus explicit.
// Exports: SearchMenuWidget component.
// Integrates: OmniSearchPanel, home tools, and any screen menu or toolbar.
// Contracts: Opening the trigger never focuses the query field; outside pointer closes the menu.
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import OmniSearchPanel from '@/components/OmniSearchPanel.vue'

const props = withDefaults(defineProps<{ open?: boolean; home?: boolean; block?: boolean; beforeOpen?: () => Promise<boolean> }>(), { open: false, home: false, block: false })
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = `search-menu-${useId().replace(/[^a-zA-Z0-9_-]/g, '-')}`
const open = computed(() => props.open)
const panelStyle = ref<Record<string, string>>({})

function close() { if (open.value) emit('update:open', false) }
async function toggle() {
  if (open.value) { close(); return }
  if (props.beforeOpen) {
    try { if (!await props.beforeOpen()) return } catch { return }
  }
  emit('update:open', true)
}
function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (open.value && !root.value?.contains(target) && !panel.value?.contains(target)) close()
}
function positionPanel() {
  const trigger = root.value?.getBoundingClientRect()
  if (!trigger) return
  const width = Math.max(1, Math.min(620, window.innerWidth - 24))
  const viewport = window.visualViewport
  const visibleTop = viewport?.offsetTop ?? 0
  const visibleBottom = Math.min(window.innerHeight, visibleTop + (viewport?.height ?? window.innerHeight))
  const height = Math.min((visibleBottom - visibleTop) * .72, 720)
  const left = Math.max(12, Math.min(trigger.left, window.innerWidth - width - 12))
  const below = trigger.bottom + height + 8 <= visibleBottom - 12
  const top = below ? trigger.bottom + 8 : Math.max(visibleTop + 12, trigger.top - height - 8)
  panelStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${height}px` }
}
function onViewportChange() { if (open.value) positionPanel() }
watch(open, async value => {
  if (!value) return
  await nextTick()
  requestAnimationFrame(positionPanel)
})
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  window.visualViewport?.removeEventListener('resize', onViewportChange)
  window.visualViewport?.removeEventListener('scroll', onViewportChange)
})
</script>

<style scoped>
.search-menu-widget { position: relative; display: inline-flex; min-width: 0; }
.search-menu-widget.is-block { display: flex; width: 100%; }
.search-menu-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px 13px; border: 1px solid var(--ui-border); border-radius: 13px; color: var(--ui-text); background: var(--ui-surface); font: inherit; cursor: pointer; }
.search-menu-trigger:hover,.is-open .search-menu-trigger { border-color: var(--ui-accent); background: var(--ui-accent-softer, var(--ui-surface)); }
.search-menu-trigger:focus-visible { outline: 3px solid var(--ui-accent); outline-offset: 3px; }
.is-block .search-menu-trigger { width: 100%; justify-content: flex-start; }
.search-menu-panel { position: fixed; z-index: 13000; max-height: min(72dvh, 720px); overflow: auto; padding: 12px; border: 1px solid var(--ui-border-strong); border-radius: 18px; color: var(--ui-text); background: var(--ui-surface); box-shadow: 0 18px 48px #0008; }
.search-menu-panel :deep(.omni) { min-height: 0; height: auto; padding: 0; overflow: visible; background: transparent; }
.search-menu-panel :deep(.omni-col) { width: 100%; max-width: none; }
.search-menu-panel :deep(.omni-drop) { position: relative; inset: auto; width: 100%; max-height: 54dvh; margin-top: 8px; }
@media (prefers-reduced-motion: reduce) { .search-menu-panel { scroll-behavior: auto; } }
</style>
