<!-- CyberManju OS — Dock (src/components/Dock.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…, vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <div
    ref="dockContainerEl"
    class="dock-container"
    :style="{ '--dock-drag-x': `${dockPosition.x}px`, '--dock-drag-y': `${dockPosition.y}px` }"
    :class="[`layout-${dock.layout.value}`, `visibility-${dock.visibility.value}`, { revealed: autohideShown, 'dock-container--flat-amoled': isFlatAmoled, 'dock-container--modern-glass': isModernGlass }]"
  >
    <div ref="dockControlsEl" class="dock-position-controls" aria-label="Dock position controls" @mouseenter="onDockEnter" @mouseleave="onDockLeave">
      <button class="dock-position-control dock-drag-handle" type="button" aria-label="Move dock" title="Drag to move dock; use arrow keys to nudge" @pointerdown.stop="startDockDrag" @keydown="moveDockByKey">Move</button>
      <button class="dock-position-control" type="button" aria-label="Reset dock position" title="Reset dock position" @click.stop="resetDockPosition">Reset</button>
    </div>
    <div
      ref="dockEl"
      class="dock"
      @click.stop
      @contextmenu.prevent.stop="handleDockSurfaceContext"
      @mouseenter="onDockEnter"
      @mouseleave="onDockLeave"
    >
      <div
        v-for="app in pinnedApps"
        :key="app.panelType"
        class="dock-item"
        :class="{ active: isAppActive(app.panelType), open: wm.isOpen(app.panelType) }"
        role="button"
        tabindex="0"
        :aria-label="app.label"
        :title="app.label"
        @keydown.enter.stop.prevent="handleDockClick(app.panelType)"
        @keydown.space.stop.prevent="handleDockClick(app.panelType)"
        @click="handleDockClick(app.panelType)"
        @contextmenu.prevent.stop="handleDockContext($event, app.panelType)"
      >
        <span class="dock-tip" aria-hidden="true">{{ app.label }}</span>
        <div class="dock-icon">
          <AppIcon class="dock-icon-text" :name="app.icon" :size="20" />
        </div>
        <span v-if="isFlatAmoled" class="dock-item-label">{{ app.label }}</span>
        <div class="dock-indicator">
          <div v-if="wm.isOpen(app.panelType)" class="indicator-dot" :class="{ active: isAppActive(app.panelType) }" />
        </div>
      </div>

      <div v-if="openUnpinned.length > 0" class="dock-divider" />

      <div
        v-for="win in openUnpinned"
        :key="win.id"
        class="dock-item"
        :class="{ active: isWindowActive(win.id), 'minimized-item': win.minimized }"
        role="button"
        tabindex="0"
        :aria-label="win.title"
        :title="win.title"
        @keydown.enter.stop.prevent="handleOpenWindowClick(win.id)"
        @keydown.space.stop.prevent="handleOpenWindowClick(win.id)"
        @click="handleOpenWindowClick(win.id)"
        @contextmenu.prevent.stop="handleOpenWindowContext($event, win.id)"
      >
        <span class="dock-tip" aria-hidden="true">{{ win.title }}</span>
        <div class="dock-icon" :class="{ minimized: win.minimized }">
          <AppIcon class="dock-icon-text" :name="win.icon" :size="20" />
        </div>
        <span v-if="isFlatAmoled" class="dock-item-label">{{ win.title }}</span>
        <div class="dock-indicator">
          <div class="indicator-dot" :class="{ active: isWindowActive(win.id), muted: win.minimized }" />
        </div>
      </div>

      <div class="dock-divider" />

      <div
        class="dock-item"
        :class="{ active: isAppActive('trash') }"
        role="button"
        tabindex="0"
        aria-label="Trash"
        title="Trash"
        @keydown.enter.stop.prevent="handleDockClick('trash')"
        @keydown.space.stop.prevent="handleDockClick('trash')"
        @click="handleDockClick('trash')"
        @contextmenu.prevent.stop="handleDockContext($event, 'trash')"
      >
        <span class="dock-tip" aria-hidden="true">Trash</span>
        <div class="dock-icon">
          <AppIcon class="dock-icon-text" name="solar:trash-bin-trash-bold" :size="20" />
        </div>
        <span v-if="isFlatAmoled" class="dock-item-label">Trash</span>
        <div class="dock-indicator">
          <div v-if="wm.isOpen('trash')" class="indicator-dot" :class="{ active: isAppActive('trash') }" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { useDock } from '@/composables/useDock'
import { useTheme } from '@/composables/useTheme'
import type { PanelType } from '@/types'
import { createDragMomentum } from '@/utils/dragPhysics'

const store = useAppStore()
const wm = useWindowManager()
const dock = useDock()
const theme = useTheme()
const isFlatAmoled = computed(() => theme.themeId.value === 'flat-amoled')
const isModernGlass = computed(() => theme.themeId.value === 'modern-glass')

const dockEl = ref<HTMLElement | null>(null)
const dockContainerEl = ref<HTMLElement | null>(null)
const dockControlsEl = ref<HTMLElement | null>(null)
const DOCK_POSITION_KEY = 'cybermanju_desktop_dock_position_v1'
const dockPosition = ref({ x: 0, y: 0 })
type DockGeometry = { base: { left: number; top: number; width: number; height: number }; bounds: { left: number; top: number; width: number; height: number } }
type DockDrag = { pointerId: number; x: number; y: number; dockX: number; dockY: number; target: HTMLElement; geometry: DockGeometry; settling: boolean; moved: boolean }
let dragOrigin: DockDrag | null = null
const dockMomentum = createDragMomentum()

try {
  const saved = localStorage.getItem(DOCK_POSITION_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown }
    if (typeof parsed.x === 'number' && Number.isFinite(parsed.x) && typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
      dockPosition.value = { x: parsed.x, y: parsed.y }
    }
  }
} catch { /* storage may be unavailable; the dock remains movable for this session */ }

function dockGeometry(): DockGeometry | null {
  const container = dockContainerEl.value
  const parent = container?.parentElement
  if (!container || !parent) return null
  const parentRect = parent.getBoundingClientRect()
  const rects = [container.getBoundingClientRect(), dockControlsEl.value?.getBoundingClientRect()].filter((rect): rect is DOMRect => !!rect)
  const left = Math.min(...rects.map(rect => rect.left))
  const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.right))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  // Restore the geometry at zero drag offset. The controls sit above the dock;
  // their bounds are part of the movable component, not an invisible screen-wide wrapper.
  return {
    base: { left: left - dockPosition.value.x, top: top + dockPosition.value.y, width: right - left, height: bottom - top },
    bounds: { left: parentRect.left, top: parentRect.top, width: parentRect.width, height: parentRect.height },
  }
}

function clampDockPoint(point: { x: number; y: number }, geometry: DockGeometry) {
  const { base, bounds } = geometry
  const minX = bounds.left - base.left
  const minY = bounds.top - base.top
  return {
    x: Math.max(minX, Math.min(minX + Math.max(0, bounds.width - base.width), point.x)),
    y: Math.max(minY, Math.min(minY + Math.max(0, bounds.height - base.height), point.y)),
  }
}

function clampDockPosition() {
  const geometry = dockGeometry()
  if (!geometry) return
  const point = clampDockPoint({ x: dockPosition.value.x, y: -dockPosition.value.y }, geometry)
  dockPosition.value = { x: point.x, y: -point.y }
}

function persistDockPosition() {
  try { localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(dockPosition.value)) }
  catch { /* private mode / quota — retain the position for this session */ }
}

function moveDock(e: PointerEvent) {
  if (!dragOrigin || dragOrigin.settling || e.pointerId !== dragOrigin.pointerId) return
  const delta = { x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y }
  if (Math.hypot(delta.x, delta.y) > 1) dragOrigin.moved = true
  dockMomentum.sample(delta)
  const point = clampDockPoint({ x: dragOrigin.dockX + delta.x, y: -dragOrigin.dockY + delta.y }, dragOrigin.geometry)
  dockPosition.value = { x: point.x, y: -point.y }
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
  } catch { /* a browser may already have released capture */ }
  if (!commit) {
    dockMomentum.stop()
    dragOrigin = null
    dockPosition.value = { x: origin.dockX, y: origin.dockY }
    return
  }
  if (!origin.moved) {
    dockMomentum.stop()
    dragOrigin = null
    persistDockPosition()
    return
  }
  origin.settling = true
  window.addEventListener('blur', cancelDockDrag)
  const position = { x: dockPosition.value.x, y: -dockPosition.value.y }
  dockMomentum.release({
    position,
    base: origin.geometry.base,
    bounds: origin.geometry.bounds,
    update: point => { dockPosition.value = { x: point.x, y: -point.y } },
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
  finishDockDrag(false)
}

function cancelDockDrag() {
  finishDockDrag(false)
}

function startDockDrag(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0) return
  e.preventDefault()
  const target = e.currentTarget
  if (!(target instanceof HTMLElement)) return
  const geometry = dockGeometry()
  if (!geometry) return
  dockMomentum.stop()
  dragOrigin = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dockX: dockPosition.value.x, dockY: dockPosition.value.y, target, geometry, settling: false, moved: false }
  dockMomentum.sample({ x: 0, y: 0 })
  try { target.setPointerCapture(e.pointerId) } catch { /* window listeners still cover browsers without capture */ }
  window.addEventListener('pointermove', moveDock)
  window.addEventListener('pointerup', endDockDrag)
  window.addEventListener('pointercancel', onDockPointerCancel)
  window.addEventListener('blur', cancelDockDrag)
}

function resetDockPosition() {
  cancelDockDrag()
  dockMomentum.stop()
  dockPosition.value = { x: 0, y: 0 }
  persistDockPosition()
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
    ArrowUp: { x: 0, y: step },
    ArrowDown: { x: 0, y: -step },
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
  const geometry = drag?.geometry ?? dockGeometry()
  if (!geometry) return
  const current = drag ? { x: drag.dockX, y: -drag.dockY } : { x: dockPosition.value.x, y: -dockPosition.value.y }
  if (drag) finishDockDrag(false)
  const point = clampDockPoint({ x: current.x + delta.x, y: current.y - delta.y }, geometry)
  dockPosition.value = { x: point.x, y: -point.y }
  persistDockPosition()
}

/** Auto-hide + menu-pin state (declared before emitDockMenu uses it). */
const autohideShown = ref(false)
const menuOpen = ref(false)
let hideTimer: number | undefined

const HIDE_DELAY_MS = 450

/** One entry of the shell-rendered dock context menu (DesktopShell.vue). */
interface DockMenuEntry {
  label: string
  action?: () => void
  checked?: boolean
  separator?: boolean
}

function emitDockMenu(x: number, y: number, items: DockMenuEntry[]) {
  menuOpen.value = true
  window.dispatchEvent(new CustomEvent('cybermanju:dock-context', {
    detail: { x, y, items },
  }))
}

/** Shared dock-preference section: appended to every item menu. */
function dockSettingsItems(): DockMenuEntry[] {
  return [
    { label: '', separator: true },
    { label: 'Full width', checked: dock.layout.value === 'full', action: () => dock.setLayout('full') },
    { label: 'Centered', checked: dock.layout.value === 'centered', action: () => dock.setLayout('centered') },
    { label: '', separator: true },
    { label: 'Fixed', checked: dock.visibility.value === 'fixed', action: () => dock.setVisibility('fixed') },
    { label: 'Auto-hide', checked: dock.visibility.value === 'autohide', action: () => dock.setVisibility('autohide') },
  ]
}

interface DockApp {
  panelType: PanelType
  label: string
  icon: string
  category: string
}

const dockApps = computed<DockApp[]>(() => [
  { panelType: 'files', label: 'File Browser', icon: 'solar:folder-bold', category: 'core' },
  { panelType: 'search', label: 'Search', icon: 'solar:magnifier-bold', category: 'core' },
  { panelType: 'collections', label: 'Organize', icon: 'solar:library-bold', category: 'organize' },
  { panelType: 'faces', label: 'People', icon: 'solar:face-scan-circle-bold', category: 'organize' },
  { panelType: 'archive', label: 'Archive', icon: 'solar:notebook-bold', category: 'organize' },
  { panelType: 'map', label: 'Map', icon: 'solar:map-bold', category: 'tools' },
  { panelType: 'editor', label: 'Code Studio', icon: 'solar:file-code-bold', category: 'tools' },
  { panelType: 'agent', label: 'Agent', icon: 'solar:bot-bold', category: 'tools' },
  { panelType: 'sync', label: 'Sync', icon: 'solar:refresh-bold', category: 'tools' },
  { panelType: 'disks', label: 'Storage & Disks', icon: 'solar:ssd-square-bold', category: 'tools' },
  { panelType: 'devices', label: 'Devices', icon: 'solar:plug-circle-bold', category: 'tools' },
  { panelType: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold', category: 'system' },
  { panelType: 'processes', label: 'Tasks', icon: 'solar:cpu-bold', category: 'system' },
  { panelType: 'settings', label: 'Settings', icon: 'solar:settings-bold', category: 'system' },
  { panelType: 'trash', label: 'Trash', icon: 'solar:trash-bin-trash-bold', category: 'system' },
  { panelType: 'accounts', label: 'Accounts & Users', icon: 'solar:user-circle-bold', category: 'system' },
])

const pinnedApps = computed(() => dockApps.value.filter((a) => a.panelType !== 'trash'))

/** Open windows whose app is not pinned (or minimized copies): live section. */
const openUnpinned = computed(() => {
  const pinned = new Set(pinnedApps.value.map((a) => a.panelType))
  return wm.windows.value.filter((w) => !pinned.has(w.panelType) || w.minimized)
})

function isAppActive(panelType: PanelType): boolean {
  return wm.windows.value.some(
    w => w.panelType === panelType && !w.minimized
  )
}

function isWindowActive(id: string): boolean {
  return wm.activeWindow.value?.id === id
}

function handleOpenWindowClick(id: string) {
  const win = wm.windows.value.find((w) => w.id === id)
  if (!win) return
  if (win.minimized) wm.restore(id)
  else wm.focus(id)
}

function handleDockClick(panelType: PanelType) {
  const existing = wm.windows.value.find(w => w.panelType === panelType)
  if (existing) {
    if (existing.minimized) {
      wm.restore(existing.id)
    } else {
      wm.focus(existing.id)
    }
  } else {
    wm.open(panelType)
  }
}

function handleDockContext(e: MouseEvent, panelType: PanelType) {
  const existing = wm.windows.value.find(w => w.panelType === panelType)
  const specific: DockMenuEntry[] = existing
    ? [
        { label: 'Focus', action: () => wm.focus(existing.id) },
        { label: 'Minimize', action: () => wm.minimize(existing.id) },
        { label: 'Close', action: () => wm.close(existing.id) },
      ]
    : [{ label: 'Open', action: () => wm.open(panelType) }]
  emitDockMenu(e.clientX, e.clientY, [...specific, ...dockSettingsItems()])
}

/** Right-click an open (unpinned/minimized) window icon: window actions + dock options. */
function handleOpenWindowContext(e: MouseEvent, id: string) {
  const win = wm.windows.value.find((w) => w.id === id)
  if (!win) return
  const specific: DockMenuEntry[] = win.minimized
    ? [
        { label: 'Restore', action: () => wm.restore(id) },
        { label: 'Close', action: () => wm.close(id) },
      ]
    : [
        { label: 'Focus', action: () => wm.focus(id) },
        { label: 'Minimize', action: () => wm.minimize(id) },
        { label: 'Close', action: () => wm.close(id) },
      ]
  emitDockMenu(e.clientX, e.clientY, [...specific, ...dockSettingsItems()])
}

/** Right-click the dock surface itself: layout + visibility sub-options. */
function handleDockSurfaceContext(e: MouseEvent) {
  emitDockMenu(e.clientX, e.clientY, dockSettingsItems().slice(1))
}

/** Auto-hide: the dock slides away until the pointer kisses the bottom edge.
 *  A short hide delay + an expanded grace zone keep it up while hovering:
 *  moving from the screen edge onto the icons must not retreat mid-travel,
 *  and an open context menu pins the dock until dismissed. */
function cancelHide() {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer)
    hideTimer = undefined
  }
}

function scheduleHide() {
  if (hideTimer !== undefined) return
  hideTimer = window.setTimeout(() => {
    hideTimer = undefined
    if (!menuOpen.value) autohideShown.value = false
  }, HIDE_DELAY_MS)
}

/** Pointer arrived on the dock surface itself — pin it open. */
function onDockEnter() {
  if (dock.visibility.value !== 'autohide') return
  cancelHide()
  autohideShown.value = true
}

/** Pointer left the dock — retreat after a grace delay (menu keeps it up). */
function onDockLeave() {
  if (dock.visibility.value !== 'autohide') return
  if (menuOpen.value) return
  if (dockControlsEl.value?.matches(':hover') || dockEl.value?.matches(':hover')) return
  scheduleHide()
}

function onMenuClosed() {
  menuOpen.value = false
  // If the pointer already left while the menu was open, retreat now.
  if (dock.visibility.value !== 'autohide') return
  const el = dockEl.value
  if (el && el.matches(':hover')) return
  scheduleHide()
}

function onAutohideMove(e: MouseEvent) {
  if (dock.visibility.value !== 'autohide') {
    autohideShown.value = false
    return
  }
  if (!autohideShown.value) {
    if (e.clientY >= window.innerHeight - 6) {
      cancelHide()
      autohideShown.value = true
    }
    return
  }
  // Open menu pins the dock; a reveal just happened at the edge.
  if (menuOpen.value) return
  const inBottomStrip = e.clientY >= window.innerHeight - 72
  const r = dockEl.value?.getBoundingClientRect()
  const inside =
    !!r &&
    e.clientX >= r.left - 24 &&
    e.clientX <= r.right + 24 &&
    e.clientY >= r.top - 56 &&
    e.clientY <= window.innerHeight + 24
  const controls = dockControlsEl.value?.getBoundingClientRect()
  const onControls = !!controls && e.clientX >= controls.left && e.clientX <= controls.right && e.clientY >= controls.top && e.clientY <= controls.bottom
  if (inside || onControls || inBottomStrip) cancelHide()
  else scheduleHide()
}

watch(() => dock.visibility.value, (v) => {
  cancelHide()
  if (v !== 'autohide') autohideShown.value = false
})

watch([() => dock.layout.value, () => dock.visibility.value, isFlatAmoled], () => {
  if (dragOrigin) finishDockDrag(false)
  clampDockPosition()
}, { flush: 'post' })

onMounted(() => {
  clampDockPosition()
  window.addEventListener('resize', onDockResize)
  window.addEventListener('mousemove', onAutohideMove, { passive: true })
  document.addEventListener('click', onMenuClosed)
  document.addEventListener('contextmenu', onMenuClosed)
})

onUnmounted(() => {
  window.removeEventListener('resize', onDockResize)
  window.removeEventListener('pointermove', moveDock)
  window.removeEventListener('pointerup', endDockDrag)
  window.removeEventListener('pointercancel', onDockPointerCancel)
  window.removeEventListener('blur', cancelDockDrag)
  cancelDockDrag()
  window.removeEventListener('mousemove', onAutohideMove)
  document.removeEventListener('click', onMenuClosed)
  document.removeEventListener('contextmenu', onMenuClosed)
  cancelHide()
})
</script>

<style scoped>
/* The container is a transparent overlay pinned to the bottom of the
   desktop area — the wallpaper (and windows, in centered/autohide modes)
   run full-screen behind it. Never clip: the shadow must fade smoothly
   around the dock's rounded surface, not hard-cut into a dark band. */
.dock-container {
  position: absolute;
  left: 50%;
  right: auto;
  width: max-content;
  bottom: var(--dock-drag-y, 0px);
  transform: translateX(calc(-50% + var(--dock-drag-x, 0px)));
  display: flex;
  justify-content: center;
  align-items: flex-end;
  height: 72px; /* matches DOCK_HEIGHT — the workspace inset in full+fixed */
  padding: 0 16px 6px;
  background: transparent;
  z-index: 50;
  pointer-events: none;
  min-width: 0;
  max-width: 100vw;
  overflow: visible;
}

.dock-position-controls {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 2px);
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  z-index: 1;
  pointer-events: auto;
}
.dock-position-control {
  padding: 3px 7px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-full);
  color: var(--ui-text-2);
  background: var(--ui-glass-2);
  font: 600 10px var(--ui-font);
  cursor: pointer;
  touch-action: none;
}
.dock-position-control:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.dock-drag-handle { cursor: grab; }
.dock-drag-handle:active { cursor: grabbing; }

.dock {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 10px 8px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  /* Directional shadow: biased downward, hugging the rounded dock shape
     (the hairline ring keeps the silhouette crisp on bright wallpapers). */
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.36),
    0 4px 12px rgba(0, 0, 0, 0.20),
    0 0 0 0.5px var(--ui-border);
  pointer-events: auto;
  position: relative;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: transform var(--ui-dur-slow) var(--ui-ease-out);
}

/* Full-width bar: edge-to-edge, square corners, shadow falls only
   downward (a floating look would leak darkness above the bar). */
.dock-container.layout-full {
  left: 0;
  right: 0;
  width: auto;
  transform: translateX(var(--dock-drag-x, 0px));
  padding: 0 0 6px;
}
.dock-container.layout-full .dock {
  flex: 1;
  max-width: none;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-bottom: none;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.34),
    0 0 0 0.5px var(--ui-border);
}

/* Auto-hide: slides below the viewport until the pointer reaches the
   bottom edge (revealed class flips it back up). */
.dock-container.visibility-autohide .dock {
  transform: translateY(calc(100% + 48px));
}
.dock-container.visibility-autohide.revealed .dock {
  transform: translateY(0);
}

/* Auto-hide stylized bar: invisible until hovered, then accent-tinted. */
.dock::-webkit-scrollbar {
  height: 6px;
}
.dock::-webkit-scrollbar-track {
  background: transparent;
}
.dock::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: var(--ui-radius-full);
}
.dock:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ui-text) 30%, transparent);
  border: 1px solid transparent;
  background-clip: content-box;
}
.dock:hover {
  scrollbar-color: color-mix(in srgb, var(--ui-text) 30%, transparent) transparent;
}

.dock::before {
  content: none;
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 2px 3px;
  cursor: pointer;
  border-radius: 10px;
  transition: background-color var(--ui-dur-fast) ease-out;
  position: relative;
  min-width: 44px;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-decoration: none;
}

.dock-item:hover {
  background: color-mix(in srgb, var(--ui-text) 7%, transparent);
}

/* Magnification: the hovered icon grows while neighbours stay put. */
.dock-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--ui-text) 7%, var(--ui-surface-2));
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  transition: transform var(--ui-dur-fast) ease-out;
}

.dock-item:hover .dock-icon {
  transform: scale(1.18) translateY(-3px);
}

.dock-item:active .dock-icon {
  transform: scale(1.05);
}

.dock-icon-text {
  color: var(--ui-text-2);
  transition: color var(--ui-dur-fast) ease-out;
}

.dock-item:hover .dock-icon-text,
.dock-item.active .dock-icon-text {
  color: var(--ui-text);
}

/* Hover label above the icon. */
.dock-tip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(2px);
  padding: 2px 8px;
  font-family: var(--ui-font);
  font-size: 12px;
  white-space: nowrap;
  color: var(--ui-text);
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  box-shadow: var(--ui-shadow-menu);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--ui-dur-fast) ease-out,
    transform var(--ui-dur-fast) ease-out;
}

.dock-item:hover .dock-tip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.dock-icon.minimized {
  opacity: 0.55;
}

.dock-indicator {
  height: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.indicator-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ui-text-faint);
  transition: background-color var(--ui-dur-fast) ease-out;
}

.indicator-dot.active {
  background: var(--ui-text-2);
}

.indicator-dot.muted {
  background: var(--ui-border-strong);
}

.minimized-item .dock-icon {
  opacity: 0.5;
}


.dock-item:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
.dock-item-label { display: none; }

/* Modern Glass gives the dock a crisp rim while retaining solid icon wells. */
.dock-container--modern-glass .dock {
  border-color: color-mix(in srgb, var(--ui-text) 20%, transparent);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34), 0 0 0 1px color-mix(in srgb, white 5%, transparent), inset 0 1px 0 color-mix(in srgb, white 9%, transparent);
}
.dock-container--modern-glass .dock-item.active .dock-icon {
  border-color: color-mix(in srgb, var(--ui-accent) 55%, var(--ui-border));
}

/* Flat AMOLED launcher: black dock, icon-only monochrome controls, visible
   compact names and no per-icon tiles. Labels remain the accessible names too. */
.dock-container--flat-amoled { height: 82px; padding-bottom: 4px; }
.dock-container--flat-amoled .dock,
.dock-container--flat-amoled.layout-full .dock {
  background: #000;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  gap: 3px;
  padding: 4px 8px 6px;
}
.dock-container--flat-amoled .dock-item {
  min-width: 48px;
  gap: 1px;
  padding: 2px 4px;
  border-radius: 0;
}
.dock-container--flat-amoled .dock-item:hover { background: transparent; }
.dock-container--flat-amoled .dock-icon {
  width: 34px;
  height: 30px;
  color: #fff;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.dock-container--flat-amoled .dock-icon-text,
.dock-container--flat-amoled .dock-item:hover .dock-icon-text,
.dock-container--flat-amoled .dock-item.active .dock-icon-text { color: #fff; }
.dock-container--flat-amoled .dock-item-label {
  display: block;
  max-width: 78px;
  overflow: hidden;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-container--flat-amoled .dock-tip { display: none; }
.dock-container--flat-amoled .dock-divider { background: rgba(255, 255, 255, 0.32); }
.dock-container--flat-amoled .dock-indicator { display: none; }

.dock-divider {
  width: 1px;
  align-self: stretch;
  margin: 6px 4px 12px;
  background: var(--ui-separator);
}
</style>
