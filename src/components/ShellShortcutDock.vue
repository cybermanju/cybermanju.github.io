<!-- CyberManju OS — ShellShortcutDock (src/components/ShellShortcutDock.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…, vue, @vueuse. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <div ref="dockRef" class="shell-dock" :style="dockPositionStyle" :class="{ open: expanded, 'shell-dock--modern-glass': isModernGlass, 'shell-dock--flat-amoled': isFlatAmoled }">
    <!-- Expanded cheat-sheet panel -->
    <div v-if="expanded" class="shell-dock-panel" role="dialog" aria-label="Shell shortcuts and window management">
      <div class="dock-panel-head">
        <div class="dock-panel-title">
          <AppIcon name="solar:keyboard-bold" :size="14" />
          <span>SHORTCUTS · {{ transportLabel }}</span>
        </div>
        <div class="dock-panel-head-actions">
          <span class="dock-layout-badge" :title="`Layout: ${layoutLabel}`">{{ layoutLabel }}</span>
          <button class="dock-x" type="button" aria-label="Collapse shortcuts" @click="expanded = false">
            <AppIcon name="solar:close-bold" :size="11" />
          </button>
        </div>
      </div>

      <div v-if="inBrowser" class="dock-notice">
        <AppIcon name="solar:info-circle-bold" :size="13" />
        <span>
          Browser owns <b>Ctrl+T / Ctrl+W / Ctrl+Tab</b> — the page never sees them.
          Use the <b>Alt+</b> fallbacks below in browser mode. Tauri supports both.
        </span>
      </div>

      <!-- Layout / window management controls -->
      <div class="dock-section">
        <div class="dock-section-label">WINDOW LAYOUT</div>
        <div class="dock-layout-row">
          <button
            v-for="m in layoutModes"
            :key="m.id"
            class="dock-mode"
            :class="{ active: wm.shellLayoutMode.value === m.id }"
            type="button"
            :title="`${m.label} (${m.key})`"
            @click="wm.setLayoutMode(m.id)"
          >
            <AppIcon :name="m.icon" :size="13" />
            <span>{{ m.label }}</span>
            <kbd>{{ m.key }}</kbd>
          </button>
        </div>
        <div class="dock-layout-row">
          <button class="dock-act" type="button" title="Toggle autotiling (Alt+T)" @click="wm.toggleAutoTile()">
            <AppIcon name="solar:grid-3x3-bold" :size="12" />
            <span>Autotile {{ wm.shellAutoTile.value ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="dock-act" type="button" :title="`Strip scrolls ${stripDirLabel} (Alt+D flips)`" @click="wm.toggleStripDirection()">
            <AppIcon name="solar:arrow-right-bold" :size="12" />
            <span>Strip: {{ stripDirLabel }}</span>
          </button>
        </div>
        <div class="dock-layout-row">
          <button class="dock-act" type="button" title="Tile now" @click="wm.tileWindows()">
            <AppIcon name="solar:columns-3-bold" :size="12" />
            <span>Tile</span>
          </button>
          <button class="dock-act" type="button" title="Cascade (Alt+C)" @click="wm.cascadeWindows()">
            <AppIcon name="solar:layers-bold" :size="12" />
            <span>Cascade</span>
          </button>
          <button class="dock-act" type="button" title="Overview (Alt+O)" @click="wm.setLayoutMode('overview')">
            <AppIcon name="solar:widget-bold" :size="12" />
            <span>Overview</span>
          </button>
          <button class="dock-act danger" type="button" title="Close all (Alt+Shift+W)" @click="wm.closeAll()">
            <AppIcon name="solar:close-bold" :size="12" />
            <span>Close all</span>
          </button>
        </div>
        <div v-if="wm.shellLayoutMode.value === 'strip'" class="dock-strip-hint">
          Column {{ wm.stripOffset.value + 1 }}/{{ wm.stripWindows.value.length || 1 }} · line {{ wm.stripLine.value }} ·
          {{ stripDirHint }}
        </div>
      </div>

      <!-- Grouped shortcuts -->
      <div class="dock-groups">
        <div v-for="g in grouped" :key="g.label" class="dock-group">
          <div class="dock-group-label">{{ g.label }}</div>
          <button
            v-for="s in g.items"
            :key="s.action"
            class="dock-row"
            type="button"
            :title="rowTitle(s)"
            @click="fireAction(s.action)"
          >
            <kbd class="dock-key">{{ s.keys }}</kbd>
            <span class="dock-desc">{{ s.description }}</span>
            <span v-if="s.blockedInBrowser && inBrowser" class="dock-fb" :title="`Browser fallback: ${s.fallback} (primary ${s.primary} is owned by the browser)`">
              was {{ s.primary }}
            </span>
          </button>
        </div>
        <div v-if="grouped.length === 0" class="dock-empty">No shortcuts registered.</div>
      </div>

      <div class="dock-foot">? help · Esc close · {{ inBrowser ? 'Browser: Alt+ fallbacks' : 'Tauri: all keys live' }}</div>
    </div>

    <div class="shell-dock-position-controls" aria-label="Shortcut dock position controls">
      <button class="shell-dock-position-control shell-dock-drag-handle" type="button" aria-label="Move shortcut dock" title="Drag to move shortcut dock; use arrow keys to nudge" @pointerdown.stop="startDockDrag" @keydown="moveDockByKey">Move</button>
      <button class="shell-dock-position-control" type="button" aria-label="Reset shortcut dock position" title="Reset shortcut dock position" @click.stop="resetDockPosition">Reset</button>
    </div>

    <!-- Collapsed FAB -->
    <button
      class="shell-dock-fab"
      type="button"
      :aria-label="expanded ? 'Collapse shortcuts' : 'Show shortcuts and window layout'"
      :title="expanded ? 'Collapse (shortcuts)' : `Shortcuts · ${transportLabel} · ${layoutLabel} — click for all keys + tiling`"
      @click="expanded = !expanded"
    >
      <AppIcon :name="expanded ? 'solar:close-bold' : 'solar:keyboard-bold'" :size="16" />
      <span class="fab-transport">{{ transportShort }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, inject, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { ShortcutsKey } from '@/composables/shortcutsKey'
import { useWindowManager, type ShellLayoutMode } from '@/composables/useWindowManager'
import { isTauri } from '@/composables/useTauri'
import { useTransport } from '@/composables/useTransport'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/composables/useTheme'
import { createDragMomentum } from '@/utils/dragPhysics'

const dockRef = ref<HTMLElement | null>(null)
const expanded = ref(false)
onClickOutside(dockRef, () => { expanded.value = false })
const POSITION_KEY = 'cybermanju_shell_shortcut_dock_position_v1'
const dockPosition = ref<{ left: number; top: number } | null>(null)
type ShortcutDockDrag = { pointerId: number; x: number; y: number; left: number; top: number; target: HTMLElement; previousPosition: { left: number; top: number } | null; base: { left: number; top: number; width: number; height: number }; settling: boolean; moved: boolean }
let dragOrigin: ShortcutDockDrag | null = null
const dockMomentum = createDragMomentum()
try {
  const saved = localStorage.getItem(POSITION_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as { left?: unknown; top?: unknown }
    if (typeof parsed.left === 'number' && Number.isFinite(parsed.left) && typeof parsed.top === 'number' && Number.isFinite(parsed.top)) {
      dockPosition.value = { left: parsed.left, top: parsed.top }
    }
  }
} catch { /* storage may be unavailable; keep the default position */ }

const dockPositionStyle = computed(() => dockPosition.value
  ? { left: `${dockPosition.value.left}px`, top: `${dockPosition.value.top}px`, right: 'auto', bottom: 'auto' }
  : {})

function clampDockPosition() {
  if (!dockPosition.value || !dockRef.value) return
  // The root's measured box includes the panel, position controls, and FAB.
  const rect = dockRef.value.getBoundingClientRect()
  dockPosition.value = {
    left: Math.min(Math.max(0, window.innerWidth - rect.width), Math.max(0, dockPosition.value.left)),
    top: Math.min(Math.max(0, window.innerHeight - rect.height), Math.max(0, dockPosition.value.top)),
  }
}

function clampPoint(point: { x: number; y: number }, width: number, height: number) {
  return {
    x: Math.min(Math.max(0, window.innerWidth - width), Math.max(0, point.x)),
    y: Math.min(Math.max(0, window.innerHeight - height), Math.max(0, point.y)),
  }
}

function moveDock(e: PointerEvent) {
  if (!dragOrigin || dragOrigin.settling || e.pointerId !== dragOrigin.pointerId) return
  const delta = { x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y }
  if (Math.hypot(delta.x, delta.y) > 1) dragOrigin.moved = true
  dockMomentum.sample(delta)
  const point = clampPoint({ x: dragOrigin.left + delta.x, y: dragOrigin.top + delta.y }, dragOrigin.base.width, dragOrigin.base.height)
  dockPosition.value = { left: point.x, top: point.y }
}

function persistDockPosition() {
  if (!dockPosition.value) return
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(dockPosition.value)) }
  catch { /* private mode / quota — retain the position for this session */ }
}

function restoreProfileShortcutDockPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null') as { left?: unknown; top?: unknown } | null
    dockPosition.value = saved && Number.isFinite(saved.left) && Number.isFinite(saved.top) ? { left: Number(saved.left), top: Number(saved.top) } : null
    requestAnimationFrame(clampDockPosition)
  } catch { dockPosition.value = null }
}

function finishDockDrag(commit: boolean) {
  if (!dragOrigin) return
  const origin = dragOrigin
  window.removeEventListener('pointermove', moveDock)
  window.removeEventListener('pointerup', endDockDrag)
  window.removeEventListener('pointercancel', onDockPointerCancel)
  window.removeEventListener('blur', cancelDockDrag)
  try {
    if (origin.target.hasPointerCapture(origin.pointerId)) origin.target.releasePointerCapture(origin.pointerId)
  } catch { /* capture may already be gone */ }
  if (!commit) {
    dockMomentum.stop()
    dragOrigin = null
    dockPosition.value = origin.previousPosition
    return
  }
  if (!origin.moved) {
    dockMomentum.stop()
    dragOrigin = null
    dockPosition.value = origin.previousPosition
    return
  }
  origin.settling = true
  window.addEventListener('blur', cancelDockDrag)
  const position = { x: dockPosition.value?.left ?? origin.left, y: dockPosition.value?.top ?? origin.top }
  dockMomentum.release({
    position,
    base: origin.base,
    bounds: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    update: point => { dockPosition.value = { left: point.x, top: point.y } },
    complete: () => {
      if (dragOrigin !== origin) return
      window.removeEventListener('blur', cancelDockDrag)
      dragOrigin = null
      persistDockPosition()
    },
  })
}

function endDockDrag(e: PointerEvent) {
  if (!dragOrigin || e.pointerId !== dragOrigin.pointerId) return
  finishDockDrag(true)
}

function onDockPointerCancel(e: PointerEvent) {
  if (!dragOrigin || e.pointerId !== dragOrigin.pointerId) return
  cancelDockDrag()
}

function cancelDockDrag() {
  finishDockDrag(false)
}

function startDockDrag(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0) return
  e.preventDefault()
  const rect = dockRef.value?.getBoundingClientRect()
  const target = e.currentTarget
  if (!rect || !(target instanceof HTMLElement)) return
  dockMomentum.stop()
  dragOrigin = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, target, previousPosition: dockPosition.value ? { ...dockPosition.value } : null, base: { left: 0, top: 0, width: rect.width, height: rect.height }, settling: false, moved: false }
  dockMomentum.sample({ x: 0, y: 0 })
  dockPosition.value = { left: rect.left, top: rect.top }
  try { target.setPointerCapture(e.pointerId) } catch { /* window listeners remain as a fallback */ }
  window.addEventListener('pointermove', moveDock)
  window.addEventListener('pointerup', endDockDrag)
  window.addEventListener('pointercancel', onDockPointerCancel)
  window.addEventListener('blur', cancelDockDrag)
}

function resetDockPosition() {
  cancelDockDrag()
  dockMomentum.stop()
  dockPosition.value = null
  try { localStorage.removeItem(POSITION_KEY) } catch { /* default applies for this session */ }
}

function onDockResize() {
  if (dragOrigin) finishDockDrag(false)
  clampDockPosition()
}

function moveDockByKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelDockDrag()
    return
  }
  const step = e.shiftKey ? 48 : 16
  const movement: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  }
  if (e.key === 'Home') {
    e.preventDefault()
    resetDockPosition()
    return
  }
  const delta = movement[e.key]
  if (!delta) return
  e.preventDefault()
  const drag = dragOrigin
  const rect = dockRef.value?.getBoundingClientRect()
  if (!rect && !drag) return
  const left = drag?.previousPosition?.left ?? drag?.left ?? rect!.left
  const top = drag?.previousPosition?.top ?? drag?.top ?? rect!.top
  const width = drag?.base.width ?? rect!.width
  const height = drag?.base.height ?? rect!.height
  if (drag) finishDockDrag(false)
  const point = clampPoint({ x: left + delta.x, y: top + delta.y }, width, height)
  dockPosition.value = { left: point.x, top: point.y }
  persistDockPosition()
}

onMounted(() => {
  clampDockPosition()
  window.addEventListener('cybermanju:ui-personalization-import', restoreProfileShortcutDockPosition)
  window.addEventListener('resize', onDockResize)
})
onUnmounted(() => {
  window.removeEventListener('cybermanju:ui-personalization-import', restoreProfileShortcutDockPosition)
  window.removeEventListener('resize', onDockResize)
  window.removeEventListener('pointermove', moveDock)
  window.removeEventListener('pointerup', endDockDrag)
  window.removeEventListener('pointercancel', onDockPointerCancel)
  window.removeEventListener('blur', cancelDockDrag)
  cancelDockDrag()
})
watch(expanded, async () => {
  if (dragOrigin) finishDockDrag(false)
  await nextTick()
  clampDockPosition()
  persistDockPosition()
})

const shortcuts = inject(ShortcutsKey, null)
const wm = useWindowManager()
const store = useAppStore()
const theme = useTheme()
const isModernGlass = computed(() => theme.themeId.value === 'modern-glass')
const isFlatAmoled = computed(() => theme.themeId.value === 'flat-amoled')

const inBrowser = computed(() => !isTauri())
const transportShort = computed(() => useTransport().short)
const transportLabel = computed(() => {
  const t = useTransport()
  if (t.backend === 'tauri') return 'TAURI'
  return `${t.short} · BROWSER KEYS`
})

const layoutModes: { id: ShellLayoutMode; label: string; key: string; icon: string }[] = [
  { id: 'floating', label: 'Float', key: 'Alt+1', icon: 'solar:cursor-square-bold' },
  { id: 'tiled', label: 'Tiled', key: 'Alt+2', icon: 'solar:grid-3x3-bold' },
  { id: 'strip', label: 'Strip ∞', key: 'Alt+3', icon: 'solar:arrow-right-bold' },
  { id: 'overview', label: 'View', key: 'Alt+4', icon: 'solar:widget-bold' },
]
const layoutLabel = computed(() => {
  const m = layoutModes.find((x) => x.id === wm.shellLayoutMode.value)
  return m ? m.label.toUpperCase() : String(wm.shellLayoutMode.value).toUpperCase()
})
const stripDirLabel = computed(() => (wm.shellStripDirection.value === 'horizontal' ? '↔ left/right' : '↕ top/bottom'))
const stripDirHint = computed(() =>
  wm.shellStripDirection.value === 'horizontal'
    ? 'scroll ↔ columns, Alt+↑/↓ moves lines'
    : 'scroll ↕ columns, Alt+←/→ moves lines',
)

const groupOrder = ['Windows', 'Workspace', 'Global Shortcuts', 'Navigation', 'File Operations', 'View', 'Panels']
const grouped = computed(() => {
  const all = shortcuts?.getAllShortcuts() || []
  const map = new Map<string, typeof all>()
  for (const s of all) {
    const g = s.group || 'Global Shortcuts'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(s)
  }
  return [...map.entries()]
    .sort((a, b) => groupOrder.indexOf(a[0]) - groupOrder.indexOf(b[0]))
    .map(([label, items]) => ({ label: label.toUpperCase(), items }))
})

function rowTitle(s: { primary: string; fallback: string; blockedInBrowser: boolean }): string {
  if (inBrowser.value && s.blockedInBrowser && s.fallback) return `Primary ${s.primary} is browser-owned — press ${s.fallback} in browser mode`
  return s.primary || s.fallback
}

/** Clicking a row fires the matching shell action where one exists. */
function fireAction(action: string) {
  const inStrip = wm.shellLayoutMode.value === 'strip'
  const windowActions: Record<string, () => void> = {
    close_window: () => wm.closeFocused(),
    close_window_alt: () => wm.closeFocused(),
    minimize_window: () => wm.minimizeFocused(),
    focus_next: () => wm.focusNext(),
    focus_prev: () => wm.focusPrev(),
    focus_next_alt: () => wm.focusNext(),
    focus_prev_alt: () => wm.focusPrev(),
    focus_window: () => wm.focusNext(),
    tile_left: () => wm.tileWindows(),
    tile_right: () => wm.tileWindows(),
    tile_top: () => wm.tileWindows(),
    tile_bottom: () => wm.tileWindows(),
    move_window_left: () => { if (inStrip) wm.moveFocusedOnStrip(-1); else wm.nudgeFocused(-24, 0) },
    move_window_right: () => { if (inStrip) wm.moveFocusedOnStrip(1); else wm.nudgeFocused(24, 0) },
    move_window_up: () => { if (inStrip) wm.moveFocusedToLine(-1); else wm.nudgeFocused(0, -24) },
    move_window_down: () => { if (inStrip) wm.moveFocusedToLine(1); else wm.nudgeFocused(0, 24) },
    cascade_windows: () => wm.cascadeWindows(),
    autotile_toggle: () => wm.toggleAutoTile(),
    autotile_toggle_alt: () => wm.toggleAutoTile(),
    strip_left: () => wm.stripLeft(),
    strip_right: () => wm.stripRight(),
    strip_up: () => wm.stripLineMove(-1),
    strip_down: () => wm.stripLineMove(1),
    overview_toggle: () => wm.toggleOverview(),
    layout_floating: () => wm.setLayoutMode('floating'),
    layout_tiled: () => wm.setLayoutMode('tiled'),
    layout_strip: () => wm.setLayoutMode('strip'),
    layout_overview: () => wm.setLayoutMode('overview'),
    strip_direction: () => wm.toggleStripDirection(),
    close_all_windows: () => wm.closeAll(),
    minimize_all: () => wm.minimizeAll(),
    maximize_toggle: () => {},
    toggle_help: () => { store.showShortcutsHelp = !store.showShortcutsHelp },
    toggle_palette: () => { store.commandPaletteOpen = !store.commandPaletteOpen },
  }
  windowActions[action]?.()
}
</script>

<style scoped>
/* Right-bottom, desktop-shell layer: above windows, below modals. */
.shell-dock {
  position: fixed;
  right: 14px;
  bottom: 12px;
  z-index: 9900;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-family: var(--ui-font);
}

.shell-dock-position-controls {
  display: flex;
  gap: 4px;
  margin-bottom: -4px;
  z-index: 1;
}
.shell-dock-position-control {
  padding: 3px 7px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-full);
  color: var(--ui-text-2);
  background: var(--ui-glass-2);
  font: 600 10px var(--ui-font);
  cursor: pointer;
  touch-action: none;
}
.shell-dock-position-control:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.shell-dock-drag-handle { cursor: grab; }
.shell-dock-drag-handle:active { cursor: grabbing; }

.shell-dock-fab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: var(--ui-radius-full);
  background: var(--ui-glass-2);
  border: 1px solid var(--ui-border-strong);
  color: var(--ui-text);
  cursor: pointer;
  box-shadow: var(--ui-shadow-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  transition: transform var(--ui-dur-fast) var(--ui-ease-spring), border-color var(--ui-dur-fast) var(--ui-ease-out);
}
.shell-dock-fab:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.fab-transport {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--ui-accent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent);
  border-radius: var(--ui-radius-full);
  padding: 1px 7px;
}

.shell-dock-panel {
  width: 372px;
  max-width: calc(100vw - 28px);
  max-height: min(62vh, 560px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-glass-2);
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-3), 0 0 32px color-mix(in srgb, var(--ui-accent) 12%, transparent);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  animation: ui-pop var(--ui-dur) var(--ui-ease-spring) both;
}

.dock-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface);
}
.dock-panel-title { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; }
.dock-panel-head-actions { display: inline-flex; align-items: center; gap: 6px; }
.dock-layout-badge {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--ui-accent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 45%, transparent);
  border-radius: var(--ui-radius-full);
  padding: 2px 8px;
}
.dock-x {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--ui-radius-sm);
  border: 1px solid var(--ui-border);
  background: transparent; color: var(--ui-text-2); cursor: pointer;
}
.dock-x:hover { color: var(--ui-text); border-color: var(--ui-border-hover); }

.dock-notice {
  display: flex; gap: 8px; align-items: flex-start;
  margin: 8px 10px 0; padding: 8px 10px;
  font-size: 10.5px; line-height: 1.45;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 50%, transparent);
  background: color-mix(in srgb, var(--ui-warning) 9%, transparent);
  border-radius: var(--ui-radius-md);
  color: var(--ui-text-2);
}

.dock-section { padding: 8px 10px 4px; border-bottom: 1px dashed var(--ui-hairline); }
.dock-section-label { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; color: color-mix(in srgb, var(--ui-text) 45%, transparent); margin-bottom: 6px; }
.dock-layout-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 6px; }
.dock-layout-row:has(.dock-act) { grid-template-columns: repeat(2, 1fr); }
.dock-layout-row:has(.dock-act:nth-child(3)) { grid-template-columns: repeat(4, 1fr); }
.dock-mode, .dock-act {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 4px; font-size: 10px; font-weight: 700;
  border-radius: var(--ui-radius-sm);
  border: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface) 60%, transparent);
  color: var(--ui-text-2); cursor: pointer;
}
.dock-mode kbd, .dock-act kbd { font-family: var(--ui-font-mono); font-size: 8px; opacity: 0.7; }
.dock-mode.active { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); box-shadow: var(--ui-glow-soft); }
.dock-act.danger { color: var(--ui-danger); }
.dock-strip-hint { font-family: var(--ui-font-mono); font-size: 9px; color: color-mix(in srgb, var(--ui-text) 60%, transparent); padding: 2px 2px 6px; }

.dock-groups { flex: 1; overflow-y: auto; padding: 4px 0 8px; }
.dock-group-label { padding: 8px 12px 3px; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; color: color-mix(in srgb, var(--ui-text) 40%, transparent); }
.dock-row {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  padding: 3px 12px; background: transparent; border: none; cursor: pointer;
  color: inherit;
}
.dock-row:hover { background: var(--ui-accent-softer); }
.dock-key {
  font-family: var(--ui-font-mono); font-size: 9.5px; font-weight: 700;
  border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-surface) 55%, transparent);
  padding: 2px 7px; min-width: 86px; text-align: center; white-space: nowrap;
}
.dock-desc { font-size: 10.5px; color: color-mix(in srgb, var(--ui-text) 75%, transparent); flex: 1; }
.dock-fb { font-family: var(--ui-font-mono); font-size: 8.5px; color: var(--ui-warning); white-space: nowrap; }
.dock-empty { padding: 12px; text-align: center; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.dock-foot { padding: 7px 12px; border-top: 1px solid var(--ui-border); font-family: var(--ui-font-mono); font-size: 9px; letter-spacing: 0.05em; text-align: center; color: color-mix(in srgb, var(--ui-text) 50%, transparent); }


.shell-dock--modern-glass .shell-dock-fab,
.shell-dock--modern-glass .shell-dock-panel {
  border-color: color-mix(in srgb, var(--ui-text) 20%, transparent);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.32), 0 0 0 1px color-mix(in srgb, white 5%, transparent), inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}
.shell-dock--modern-glass .shell-dock-panel { background: var(--ui-surface-2); }
.shell-dock--modern-glass .dock-panel-head { background: var(--ui-surface-2); }
.shell-dock--flat-amoled .shell-dock-fab,
.shell-dock--flat-amoled .shell-dock-panel {
  background: #000;
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.shell-dock--flat-amoled .dock-panel-head { background: #000; }
.shell-dock--flat-amoled .dock-mode,
.shell-dock--flat-amoled .dock-act,
.shell-dock--flat-amoled .dock-key { background: #080808; }

@media (max-width: 560px) {
  .shell-dock { right: 10px; bottom: 70px; }
  .shell-dock-panel { width: calc(100vw - 20px); }
}
</style>
