<!-- CyberManju OS — Read-only workspace miniatures, never external window captures. -->
<!-- Role: render bounded Home data. Integrates: HomeLauncher, no native host or app mounting. -->
<template>
  <div class="home-preview" :style="{ '--preview-columns': columns || 4 }" aria-hidden="true">
    <span v-if="!items.length" class="preview-empty"><AppIcon name="solar:add-circle-linear" :size="26" /></span>
    <div v-for="item in items" :key="item.id" class="preview-item" :class="{ 'preview-widget': item.kind === 'widget' }" :style="placementStyle(item)">
      <template v-if="item.kind === 'app'"><img v-if="imageFor(item.ref)" :src="imageFor(item.ref)" alt="" /><AppIcon v-else :name="iconFor(item)" :size="22" /></template>
      <template v-else-if="item.ref === 'clock'"><time>{{ clock }}</time><small>{{ date }}</small></template>
      <template v-else-if="item.ref === 'notes' || item.ref === 'checklist'"><AppIcon :name="iconFor(item)" :size="15" /><p :class="{ complete: item.data?.done === true }">{{ item.data?.text || (item.ref === 'notes' ? 'An idea worth keeping…' : 'One small mission') }}</p></template>
      <template v-else-if="item.ref === 'counter'"><strong>{{ Number(item.data?.count || 0) }}</strong></template>
      <template v-else-if="item.ref === 'focus'"><strong>{{ remaining(item) }}</strong><small>Focus</small></template>
      <template v-else><AppIcon :name="iconFor(item)" :size="22" /><small>{{ item.ref.startsWith('native:') ? 'Android widget · no preview' : item.ref === 'pixel-pet' ? `${Number(item.data?.energy || 0)} sparks` : 'App shortcut' }}</small></template>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { homeItemPlacement, type HomeItem } from '@/utils/homeWorkspaces'
const props = defineProps<{ items: HomeItem[]; iconFor: (item: HomeItem) => string; imageFor: (id: string) => string | undefined; tintFor?: (id: string) => string | undefined; columns?: number; rows?: number }>()
const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | undefined
// One lightweight timer per visible miniature; no interactive widget or external app is mounted.
onMounted(() => { interval = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(interval))
const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))
const date = computed(() => new Date(now.value).toLocaleDateString([], { weekday: 'short', day: 'numeric' }))
function remaining(item: HomeItem) { const end = Number(item.data?.endsAt || 0); const seconds = Math.max(0, Math.ceil((end - now.value) / 1000)); return !end ? '25:00' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function placementStyle(item: HomeItem) {
  const placement = homeItemPlacement(item, props.items, props.columns || 4, props.rows || 4)
  return placement ? { gridColumn: `${placement.column + 1} / span ${placement.columnSpan}`, gridRow: `${placement.row + 1} / span ${placement.rowSpan}`, '--preview-tint': item.kind === 'app' ? props.tintFor?.(item.ref) || 'var(--hw-accent)' : 'var(--hw-accent)' } : {}
}
</script>
<style scoped>
.home-preview { display: grid; grid-template-columns: repeat(var(--preview-columns, 4),minmax(0,1fr)); grid-auto-rows: minmax(34px, auto); gap: 4px; align-content: start; min-height: 100px; width: 100%; pointer-events: none; }
.preview-item { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; min-height: 34px; border-radius: 11px; color: var(--preview-tint, var(--hw-accent)); background: color-mix(in srgb, var(--preview-tint, var(--hw-accent)) 13%, var(--hw-bg)); border: 1px solid color-mix(in srgb, var(--preview-tint, var(--hw-accent)) 28%, var(--hw-line)); overflow: hidden; }
.preview-item img { width: 100%; height: 34px; object-fit: contain; }
.preview-widget { padding: 9px; gap: 5px; min-height: 66px; color: var(--hw-text); background: var(--hw-bg); box-sizing: border-box; }
.preview-widget time,.preview-widget strong { font-size: clamp(12px,1.5vw,20px); font-variant-numeric: tabular-nums; line-height: 1.2; }
.preview-widget small { color: var(--hw-muted); font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }
.preview-widget p { font-size: 10px; margin: 0; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.complete { text-decoration: line-through; }.preview-empty { grid-column: 1 / -1; display: grid; place-items: center; min-height: 100px; color: var(--hw-muted); }
</style>
