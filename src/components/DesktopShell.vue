<template>
  <div class="desktop-shell" :class="{ 'desktop-shell--glow': theme.settings.glow }">
    <TopMenuBar />

    <div class="desktop-area" @click="handleWorkspaceClick">
      <div class="desktop-wallpaper">
        <slot name="wallpaper" />
        <div class="desktop-aurora" aria-hidden="true" />
      </div>

      <!-- Niri-style infinite strip: columns append right (or down in
           vertical mode) and the viewport scrolls — existing windows keep
           their size. Native scroll + Alt+arrows both drive stripOffset. -->
      <div
        v-if="isStrip"
        ref="stripScrollRef"
        class="desktop-strip ui-scroll"
        :class="{ vertical: isVerticalStrip }"
        @wheel="onStripWheel"
      >
        <!-- Scroll extent: guarantees the viewport can reach every column
             even while windows animate in/out (absolute tiles alone are a
             fragile scroll driver across browsers). -->
        <div class="strip-sizer" :style="stripContentStyle" aria-hidden="true" />
        <div class="strip-position" aria-hidden="true">
          COL {{ wm.stripOffset.value + 1 }}/{{ wm.stripWindows.value.length || 1 }} · LINE {{ wm.stripLine.value }}
        </div>
        <TransitionGroup name="win">
          <AppWindow
            v-for="win in visibleWindows"
            :key="win.id"
            :win="win"
            :focused="win.id === focusedWindowId"
            @close="wm.close"
            @minimize="wm.minimize"
            @focus="wm.focus"
            @move="wm.updatePosition"
            @resize="wm.updateSize"
          />
        </TransitionGroup>
      </div>

      <!-- Overview: zoomed-out grid across every open window -->
      <div v-else-if="isOverview" class="desktop-overview" role="dialog" aria-label="Window overview">
        <button
          v-for="win in overviewWindows"
          :key="win.id"
          class="overview-card"
          :class="{ minimized: win.minimized }"
          type="button"
          @click="pickFromOverview(win.id)"
        >
          <span class="overview-card-icon"><AppIcon :name="win.icon" :size="18" /></span>
          <span class="overview-card-title">{{ win.title }}</span>
          <span class="overview-card-meta">COL {{ (win.column ?? 0) + 1 }} · LINE {{ win.line ?? 0 }}{{ win.minimized ? ' · MINIMIZED' : '' }}</span>
        </button>
        <div v-if="overviewWindows.length === 0" class="overview-empty">No windows open.</div>
      </div>

      <div v-else class="desktop-workspace">
        <div class="desktop-icons">
          <button
            v-for="shortcut in shortcuts"
            :key="shortcut.panel"
            class="desktop-shortcut"
            type="button"
            :title="shortcut.label"
            @dblclick="wm.open(shortcut.panel)"
            @click="selectShortcut = shortcut.panel"
          >
            <span class="shortcut-icon" :class="{ selected: selectShortcut === shortcut.panel }">
              <AppIcon :name="shortcut.icon" :size="20" />
            </span>
            <span class="shortcut-label">{{ shortcut.label }}</span>
          </button>
        </div>

        <TransitionGroup name="win">
          <AppWindow
            v-for="win in visibleWindows"
            :key="win.id"
            :win="win"
            :focused="win.id === focusedWindowId"
            @close="wm.close"
            @minimize="wm.minimize"
            @focus="wm.focus"
            @move="wm.updatePosition"
            @resize="wm.updateSize"
          />
        </TransitionGroup>
      </div>
    </div>

    <Dock />

    <!-- Right-bottom shell dock: shortcuts + tiling, above windows. -->
    <ShellShortcutDock />

    <div
      v-if="dockMenu.visible"
      class="dock-context-overlay"
      :style="{ left: dockMenu.x + 'px', top: dockMenu.y + 'px' }"
      @click="dockMenu.visible = false"
      @contextmenu.prevent="dockMenu.visible = false"
    >
      <div class="dock-context-menu ui-shine" @click.stop>
        <button
          v-for="(item, i) in dockMenu.items"
          :key="i"
          class="dock-context-item"
          type="button"
          @click="item.action(); dockMenu.visible = false"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <StatusBar />
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useWindowManager } from '@/composables/useWindowManager'
import { useTheme } from '@/composables/useTheme'
import { computeStripRects, stripColumnWidth } from '@/utils/shellLayout'
import TopMenuBar from './TopMenuBar.vue'
import Dock from './Dock.vue'
import StatusBar from './StatusBar.vue'
import AppWindow from './AppWindow.vue'
import ShellShortcutDock from './ShellShortcutDock.vue'
import type { PanelType } from '@/types'

const wm = useWindowManager()
const theme = useTheme()
const selectShortcut = ref<PanelType | null>(null)
const stripScrollRef = ref<HTMLElement | null>(null)

const shortcuts: { panel: PanelType; label: string; icon: string }[] = [
  { panel: 'files', label: 'Files', icon: 'solar:folder-bold' },
  { panel: 'collections', label: 'Collections', icon: 'solar:library-bold' },
  { panel: 'map', label: 'Map', icon: 'solar:map-bold' },
  { panel: 'editor', label: 'Code Studio', icon: 'solar:code-square-bold' },
  { panel: 'devices', label: 'Devices', icon: 'solar:plug-circle-bold' },
  { panel: 'settings', label: 'Settings', icon: 'solar:settings-bold' },
  { panel: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold' },
]

const visibleWindows = computed(() =>
  wm.windows.value.filter(w => !w.minimized)
)

/**
 * Overview ("three fingers up") zooms out to EVERY screen — open windows
 * and minimized ones alike — so nothing can hide from the grid.
 */
const overviewWindows = computed(() => wm.windows.value)

const isStrip = computed(() => wm.shellLayoutMode.value === 'strip')
const isOverview = computed(() => wm.shellLayoutMode.value === 'overview')
const isVerticalStrip = computed(() => wm.shellStripDirection.value === 'vertical')

/**
 * Explicit scroll extent for the infinite strip. Absolutely-positioned
 * tiles are a fragile scroll driver on their own (transition wrappers,
 * containing-block quirks), so a dedicated sizer guarantees the viewport
 * can always reach the last column / line.
 */
const stripContentStyle = computed(() => {
  const list = wm.stripWindows.value
  if (list.length === 0) return {}
  const maxRight = Math.max(...list.map(w => w.x + w.width))
  const maxBottom = Math.max(...list.map(w => w.y + w.height))
  if (isVerticalStrip.value) {
    return { width: '100%', height: `${Math.max(maxBottom + 24, 400)}px` }
  }
  return { width: `${Math.max(maxRight + 24, 800)}px`, height: '100%' }
})

function layoutStripColumns() {
  const list = [...wm.windows.value]
    .filter(w => !w.minimized && (w.line ?? 0) === wm.stripLine.value)
    .sort((a, b) => (a.column ?? 0) - (b.column ?? 0))
  if (list.length === 0) return
  const vertical = wm.shellStripDirection.value === 'vertical'
  const host = stripScrollRef.value
  const vw = host?.clientWidth || window.innerWidth
  const vh = host?.clientHeight || Math.max(400, window.innerHeight - 160)
  const rects = computeStripRects(list.length, vw, vh, 12, vertical, stripColumnWidth(vw))
  list.forEach((w, i) => {
    const r = rects[i]
    w.x = r.x
    w.y = r.y
    w.width = r.width
    w.height = r.height
  })
}

function scrollStripIntoView() {
  const host = stripScrollRef.value
  if (!host || !isStrip.value) return
  const vertical = isVerticalStrip.value
  const list = wm.stripWindows.value
  const target = list[wm.stripOffset.value]
  if (!target) return
  if (vertical) {
    host.scrollTo({ top: Math.max(0, target.y - 12), behavior: 'smooth' })
  } else {
    host.scrollTo({ left: Math.max(0, target.x - 12), behavior: 'smooth' })
  }
}

watch(
  () => [wm.shellLayoutMode.value, wm.shellStripDirection.value, wm.stripLine.value, wm.windows.value.length],
  async () => {
    if (wm.shellLayoutMode.value === 'strip') {
      await nextTick()
      layoutStripColumns()
      scrollStripIntoView()
    }
  },
  { immediate: true },
)

watch(
  () => wm.stripOffset.value,
  () => { scrollStripIntoView() },
)

/** Niri-style wheel: vertical wheel drives a horizontal strip (and vice versa
 *  only via Shift / horizontal deltas). Wheel events that start inside a
 *  nested scroller which can still move in that direction are left alone so
 *  terminal / file / code panes keep their own scroll. */
function onStripWheel(e: WheelEvent) {
  if (!isStrip.value) return
  const host = stripScrollRef.value
  if (!host) return
  const vertical = isVerticalStrip.value
  const target = e.target as HTMLElement | null
  const inner = target?.closest?.('.window-content, .term-scroll, .cs-term, .fm-grid, .fm-lbody, .window-content-panel') as HTMLElement | null
  if (inner && inner !== host) {
    const canY = inner.scrollHeight - inner.scrollTop - inner.clientHeight > 1 && e.deltaY !== 0
    const canX = inner.scrollWidth - inner.scrollLeft - inner.clientWidth > 1 && (e.deltaX !== 0 || e.shiftKey)
    if (!vertical && canY) return
    if (vertical && (canY || canX)) return
  }
  if (!vertical) {
    // Horizontal strip: plain vertical wheel would do nothing against
    // `overflow-y: hidden` — translate it (niri-style) instead.
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta === 0) return
    e.preventDefault()
    host.scrollLeft += delta
  } else {
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(delta) < 1) return
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault()
      host.scrollTop += e.deltaX
    }
    // Otherwise let the native vertical scroll run, then sync the index.
  }
  // Sync the column index after the viewport settles.
  requestAnimationFrame(() => {
    const list = wm.stripWindows.value
    if (list.length === 0) return
    const pos = vertical ? host.scrollTop : host.scrollLeft
    let best = 0
    let bestDist = Infinity
    list.forEach((w, i) => {
      const p = vertical ? w.y : w.x
      const d = Math.abs(p - pos - 12)
      if (d < bestDist) { bestDist = d; best = i }
    })
    wm.stripOffset.value = best
  })
}

function pickFromOverview(id: string) {
  const win = wm.windows.value.find(w => w.id === id)
  if (!win) return
  // Minimized windows restore straight out of the zoomed-out grid.
  if (win.minimized) wm.restore(id)
  else wm.focus(id)
  wm.setLayoutMode(wm.shellAutoTile.value ? 'tiled' : 'floating')
}

/** Viewport resizes re-run the active auto-layout so tiles stay dense. */
function handleViewportResize() {
  if (wm.shellLayoutMode.value === 'strip') layoutStripColumns()
  else if (wm.shellLayoutMode.value === 'tiled') wm.tileWindows()
}

const focusedWindowId = computed(() => wm.activeWindow.value?.id ?? null)

const dockMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  items: [] as { label: string; action: () => void }[],
})

function handleDockContext(e: CustomEvent) {
  dockMenu.value = {
    visible: true,
    x: e.detail.x,
    y: e.detail.y,
    items: e.detail.items,
  }
}

function handleClickOutside() {
  dockMenu.value.visible = false
}

function handleWorkspaceClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.app-window')) {
    selectShortcut.value = null
    return
  }
  if (target.closest('.desktop-shortcut')) return
  selectShortcut.value = null
  wm.blurAll()
}

onMounted(() => {
  window.addEventListener('cybermanju:dock-context', handleDockContext as EventListener)
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('contextmenu', () => { dockMenu.value.visible = false })
  window.addEventListener('resize', handleViewportResize)
})

onUnmounted(() => {
  window.removeEventListener('cybermanju:dock-context', handleDockContext as EventListener)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('contextmenu', () => { dockMenu.value.visible = false })
  window.removeEventListener('resize', handleViewportResize)
})
</script>

<style scoped>
.desktop-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--ui-bg);
  position: relative;
}

.desktop-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.desktop-wallpaper {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

/* Ambient accent glow behind everything — reads the active theme accent. */
.desktop-aurora {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(40% 45% at 18% 22%, color-mix(in srgb, var(--ui-accent) 16%, transparent), transparent 70%),
    radial-gradient(45% 40% at 82% 78%, color-mix(in srgb, var(--ui-info) 12%, transparent), transparent 70%),
    radial-gradient(60% 60% at 50% 110%, color-mix(in srgb, var(--ui-accent) 10%, transparent), transparent 70%);
  opacity: 0;
  transition: opacity 0.8s var(--ui-ease-out);
  animation: desktop-drift 26s ease-in-out infinite alternate;
}

.desktop-shell--glow .desktop-aurora {
  opacity: 1;
}

@keyframes desktop-drift {
  from { transform: translate3d(-2%, -1%, 0) scale(1); }
  to { transform: translate3d(2%, 2%, 0) scale(1.06); }
}

.desktop-workspace {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.desktop-icons {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 2;
}

.desktop-shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 8px;
  cursor: pointer;
  border-radius: var(--ui-radius-md);
  border: 1px solid transparent;
  background: transparent;
  width: 74px;
  text-align: center;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-spring);
  animation: ui-rise var(--ui-dur-slow) var(--ui-ease-out) both;
}

.desktop-shortcut:hover {
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 24%, transparent);
  transform: translateY(-1px);
}

.desktop-shortcut:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 80%, transparent);
  outline-offset: 1px;
}

.shortcut-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--ui-radius-md);
  color: var(--ui-text-2);
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  backdrop-filter: blur(var(--ui-blur));
  -webkit-backdrop-filter: blur(var(--ui-blur));
  transition:
    color var(--ui-dur) var(--ui-ease-out),
    border-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-spring);
}

.shortcut-icon.selected {
  color: var(--ui-accent);
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
  box-shadow: var(--ui-glow-soft);
}

.desktop-shortcut:hover .shortcut-icon {
  color: var(--ui-accent);
  border-color: color-mix(in srgb, var(--ui-accent) 40%, transparent);
  transform: translateY(-2px);
}

.shortcut-label {
  font-family: var(--ui-font);
  font-size: 10.5px;
  font-weight: 550;
  color: var(--ui-text-3);
  white-space: nowrap;
  text-shadow: 0 1px 6px color-mix(in srgb, var(--ui-bg) 90%, transparent);
  transition: color var(--ui-dur) var(--ui-ease-out);
}

.desktop-shortcut:hover .shortcut-label,
.shortcut-icon.selected + .shortcut-label {
  color: var(--ui-text);
}

.dock-context-overlay {
  position: fixed;
  z-index: 10000;
}

.dock-context-menu {
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  padding: 5px;
  min-width: 170px;
  box-shadow: var(--ui-shadow-3);
  animation: ui-pop var(--ui-dur) var(--ui-ease-spring) both;
}

.dock-context-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  color: var(--ui-text-2);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-out);
}

.dock-context-item:hover {
  background: var(--ui-accent-softer);
  color: var(--ui-text);
  transform: translateX(2px);
}

/* window open / close transitions */
.win-enter-active,
.win-leave-active {
  transition:
    opacity var(--ui-dur) var(--ui-ease-out),
    transform var(--ui-dur-slow) var(--ui-ease-out),
    filter var(--ui-dur) var(--ui-ease-out);
}

.win-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
  filter: blur(6px);
}

.win-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
  filter: blur(4px);
}

.win-leave-active {
  pointer-events: none;
}

/* ── niri-style infinite strip ─────────────────────────────────── */
.desktop-strip {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow-x: auto;
  overflow-y: hidden;
  /* Wheel deltas drive `scrollLeft` directly per tick — `smooth` here would
     queue an animation per tick and feel laggy. Programmatic jumps
     (stripOffset) still pass `behavior: 'smooth'` explicitly. */
  scroll-behavior: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}
.desktop-strip.vertical {
  overflow-x: hidden;
  overflow-y: auto;
}
.desktop-strip::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}
.desktop-strip::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  border-radius: var(--ui-radius-full);
  border: 3px solid transparent;
  background-clip: content-box;
}
.desktop-strip::-webkit-scrollbar-thumb:hover {
  background: var(--ui-accent);
  background-clip: content-box;
  border: 2px solid transparent;
}
/* Explicit scroll extent behind the absolute tiles (see template). */
.strip-sizer {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  visibility: hidden;
}
.desktop-strip :deep(.app-window) {
  /* columns keep their size; the viewport moves, never the tiles */
  transition: box-shadow var(--ui-dur-slow) var(--ui-ease-out), border-color var(--ui-dur-slow) var(--ui-ease-out);
}
.strip-position {
  position: sticky;
  left: 12px;
  top: 10px;
  display: inline-block;
  z-index: 5;
  font-family: var(--ui-font-mono);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--ui-text-3);
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-full);
  padding: 3px 10px;
  margin: 10px 0 0 12px;
  backdrop-filter: blur(var(--ui-blur));
  -webkit-backdrop-filter: blur(var(--ui-blur));
  pointer-events: none;
}
.desktop-strip.vertical .strip-position {
  position: sticky;
  top: 10px;
}

/* ── overview grid ─────────────────────────────────────────────── */
.desktop-overview {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 24px;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-gutter: stable;
  background: color-mix(in srgb, var(--ui-bg-deep) 35%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.desktop-overview::-webkit-scrollbar {
  width: 10px;
}
.desktop-overview::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  border-radius: var(--ui-radius-full);
  border: 3px solid transparent;
  background-clip: content-box;
}
.desktop-overview::-webkit-scrollbar-thumb:hover {
  background: var(--ui-accent);
  background-clip: content-box;
  border: 2px solid transparent;
}
.overview-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-glass-2);
  border: 1px solid var(--ui-border-strong);
  color: var(--ui-text);
  cursor: pointer;
  text-align: left;
  transition: transform var(--ui-dur-fast) var(--ui-ease-spring), border-color var(--ui-dur-fast) var(--ui-ease-out);
  animation: ui-pop var(--ui-dur) var(--ui-ease-spring) both;
}
.overview-card:hover {
  transform: translateY(-2px) scale(1.01);
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
}
.overview-card.minimized {
  opacity: 0.72;
  border-style: dashed;
}
.overview-card-icon { color: var(--ui-accent); }
.overview-card-title { font-size: 13px; font-weight: 800; letter-spacing: 0.02em; }
.overview-card-meta { font-family: var(--ui-font-mono); font-size: 9px; letter-spacing: 0.08em; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.overview-empty { grid-column: 1 / -1; text-align: center; color: color-mix(in srgb, var(--ui-text) 50%, transparent); font-size: 12px; padding: 40px; }
</style>
