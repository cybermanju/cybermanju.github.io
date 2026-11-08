// CyberManju OS — HudMetrics (src/components/HudMetrics.vue).
// Role: Vue desktop UI: heads-up display with real-time system metrics
//   (FPS, memory, CPU, disk, network) as a draggable glass overlay.
// Exports: module root component.
// Integrates: @/composables/useSystemMetrics, @/composables/useMotion,
//   @/ui/tokens, vue.
// Contracts: hidden under prefers-reduced-motion / motion=reduced; draggable
//   via pointer drag on the header; never blocks input underneath.

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSystemMetrics } from '@/composables/useSystemMetrics'
import { useMotion } from '@/composables/useMotion'

const { enabled, metrics, fps, start, stop } = useSystemMetrics()
const { duration, durationCss } = useMotion()

const visible = ref(false)
const dragging = ref(false)
const pos = ref({ x: 20, y: 60 })
let startX = 0
let startY = 0
let startPosX = 0
let startPosY = 0

const hudStyle = computed(() => ({
  left: `${pos.value.x}px`,
  top: `${pos.value.y}px`,
  transition: durationCss.value,
}))

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging.value = true
  startX = e.clientX
  startY = e.clientY
  startPosX = pos.value.x
  startPosY = pos.value.y
  ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return
  pos.value.x = startPosX + (e.clientX - startX)
  pos.value.y = startPosY + (e.clientY - startY)
}

function onPointerUp(): void {
  dragging.value = false
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  if (!reduced.value) start()
})

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

const { reduced } = useMotion()
</script>

<template>
  <div
    v-if="visible && !reduced"
    class="hud"
    :style="hudStyle"
    @pointerdown="onPointerDown"
  >
    <div class="hud-header">
      <span class="hud-title">CYBERMANJU OS — HUD</span>
      <button
        class="hud-close"
        @click.stop="visible = false"
        title="Hide HUD"
      >✕</button>
    </div>

    <div class="hud-grid">
      <div class="hud-row">
        <span class="hud-label">FPS</span>
        <span class="hud-value">{{ fps }}</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">CPU</span>
        <span class="hud-value">{{ metrics.cpuPercent ?? '—' }}%</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">MEM</span>
        <span class="hud-value">
          {{ metrics.memUsedMB ?? '—' }}MB / {{ metrics.memTotalMB ?? '—' }}MB
          {{ metrics.memPercent != null ? '(' + metrics.memPercent + '%)' : '' }}
        </span>
      </div>
      <div class="hud-row">
        <span class="hud-label">DISK</span>
        <span class="hud-value">
          {{ metrics.diskUsedGB ?? '—' }}GB / {{ metrics.diskTotalGB ?? '—' }}GB
          {{ metrics.diskPercent != null ? '(' + metrics.diskPercent + '%)' : '' }}
        </span>
      </div>
      <div class="hud-row">
        <span class="hud-label">NET ↓</span>
        <span class="hud-value">{{ metrics.netRxMBps != null ? metrics.netRxMBps.toFixed(1) : '—' }}MB/s</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">NET ↑</span>
        <span class="hud-value">{{ metrics.netTxMBps != null ? metrics.netTxMBps.toFixed(1) : '—' }}MB/s</span>
      </div>
    </div>

    <div class="hud-footer">
      <span class="hud-uptime">
        UP {{ metrics.uptimeSec != null ? Math.floor(metrics.uptimeSec / 60) : '—' }}m
      </span>
    </div>
  </div>

  <button
    v-else-if="visible"
    class="hud-toggle"
    @click="visible = false"
    title="Hide HUD (reduced motion)"
  >
    HUD
  </button>
</template>

<style scoped>
.hud {
  position: fixed;
  z-index: 200;
  width: 210px;
  padding: 10px;
  background: var(--ui-window);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  font-family: var(--ui-font-mono);
  font-size: 11px;
  color: var(--ui-text-2);
  user-select: none;
  pointer-events: auto;
}

.hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--ui-hairline);
  cursor: move;
}

.hud-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ui-accent);
}

.hud-close {
  background: transparent;
  border: none;
  color: var(--ui-text-3);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--ui-radius-sm);
  transition: background var(--ui-dur-fast) var(--ui-ease-out);
}

.hud-close:hover {
  background: var(--ui-accent-softer);
  color: var(--ui-text);
}

.hud-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}

.hud-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 30%, transparent);
  padding: 2px 0;
}

.hud-label {
  font-size: 9px;
  color: var(--ui-text-faint);
}

.hud-value {
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hud-footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--ui-hairline);
  font-size: 9px;
  color: var(--ui-text-faint);
  display: flex;
  justify-content: space-between;
}

.hud-uptime {
  color: var(--ui-accent);
}

.hud-toggle {
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 150;
  padding: 4px 8px;
  background: var(--ui-surface2);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-full);
  font-family: var(--ui-font-mono);
  font-size: 10px;
  color: var(--ui-text-2);
  cursor: pointer;
  pointer-events: auto;
}

.hud-toggle:hover {
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 30%, transparent);
  color: var(--ui-text);
}

@media (prefers-reduced-motion: reduce) {
  .hud {
    transition: none !important;
  }
}
</style>
