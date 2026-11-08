// CyberManju OS — UseSystemMetrics (src/composables/useSystemMetrics.ts).
// Role: Vue shared state: real-time system metrics for the HUD overlay.
// Exports: useSystemMetrics.
// Integrates: vue, @/stores/app (osTop/osDf), @/composables/useMotion.
// Contracts: FPS sampled via requestAnimationFrame; memory via
//   performance.memory (chromium-only, degrades gracefully); disk/CPU read
//   from the Rust-backed osTop/osDf refs exposed by the app store. All
//   refs are read-only from callers; start()/stop() own the RAF loop.

import { ref, computed, onBeforeUnmount } from 'vue'
import { useAppStore } from '@/stores/app'
import { useMotion } from './useMotion'

export interface SystemMetrics {
  fps: number
  memUsedMB: number | null
  memTotalMB: number | null
  memPercent: number | null
  cpuPercent: number | null
  diskUsedGB: number | null
  diskTotalGB: number | null
  diskPercent: number | null
  netRxMBps: number | null
  netTxMBps: number | null
  uptimeSec: number | null
}

/** Sampled FPS counter — one RAF tick per frame, averaged over 1s windows. */
let lastTime = 0
let frameCount = 0
let fps = 0

function tick(now: number) {
  if (!lastTime) lastTime = now
  frameCount++
  if (now - lastTime >= 1000) {
    fps = frameCount
    frameCount = 0
    lastTime = now
  }
}

export function useSystemMetrics() {
  const store = useAppStore()
  const { reduced } = useMotion()
  const enabled = ref(false)

  const metrics = ref<SystemMetrics>({
    fps: 0,
    memUsedMB: null,
    memTotalMB: null,
    memPercent: null,
    cpuPercent: null,
    diskUsedGB: null,
    diskTotalGB: null,
    diskPercent: null,
    netRxMBps: null,
    netTxMBps: null,
    uptimeSec: null,
  })

  let animId = 0

  /** Read chromium memory API — null on Firefox/Safari, never throws. */
  function readMemory(): void {
    const m = (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
    if (!m) return
    metrics.value.memUsedMB = Math.round(m.usedJSHeapSize / 1024 / 1024)
    metrics.value.memTotalMB = Math.round(m.jsHeapSizeLimit / 1024 / 1024)
    metrics.value.memPercent = Math.round((m.usedJSHeapSize / m.jsHeapSizeLimit) * 100)
  }

  /** Read osTop/osDf from the app store — best-effort, null on missing data. */
  function readOs(): void {
    const top = store.osTop
    const df = store.osDf
    if (top) {
      metrics.value.cpuPercent = top.cpuPercent ?? null
      metrics.value.uptimeSec = top.uptimeSec ?? null
      metrics.value.netRxMBps = top.netRxMBps ?? null
      metrics.value.netTxMBps = top.netTxMBps ?? null
    }
    if (df) {
      const total = df.totalBytes ?? 0
      const used = df.usedBytes ?? 0
      metrics.value.diskTotalGB = total > 0 ? Math.round(total / 1024 / 1024 / 1024) : null
      metrics.value.diskUsedGB = used > 0 ? Math.round(used / 1024 / 1024 / 1024) : null
      metrics.value.diskPercent = total > 0 ? Math.round((used / total) * 100) : null
    }
  }

  function loop(now: number): void {
    tick(now)
    readMemory()
    readOs()
    animId = requestAnimationFrame(loop)
  }

  function start(): void {
    if (animId) return
    lastTime = performance.now()
    animId = requestAnimationFrame(loop)
  }

  function stop(): void {
    if (animId) {
      cancelAnimationFrame(animId)
      animId = 0
    }
  }

  // Expose fps read-only (updated inside the RAF loop).
  const fpsRef = computed(() => fps)

  onBeforeUnmount(() => stop())

  return {
    enabled,
    metrics,
    fps: fpsRef,
    start,
    stop,
    readMemory,
    readOs,
  }
}

export default useSystemMetrics
