<template>
  <div
    ref="rootRef"
    class="app-window"
    :class="{
      minimized: win.minimized,
      focused: isFocused,
      blurred: !isFocused,
      maximized: isMaximized,
      'app-window--narrow': isNarrow,
    }"
    :style="windowStyle"
    @mousedown="onFocus"
  >
    <div
      class="window-titlebar"
      :class="{ 'window-titlebar--narrow': isNarrow, 'window-titlebar--plasma': isPlasma }"
      @mousedown.prevent="startDrag"
      @dblclick="toggleMaximize"
      @contextmenu.prevent="openWindowMenu($event)"
    >
      <template v-if="isPlasma">
        <div class="titlebar-app" aria-hidden="true">
          <AppIcon :name="win.icon" :size="15" />
        </div>
        <div class="titlebar-label titlebar-label--left" :title="win.title">{{ win.title }}</div>
        <div class="titlebar-spacer" />
        <UiTitlebarButtons
          :focused="isFocused"
          :maximized="isMaximized"
          @close="onClose"
          @minimize="onMinimize"
          @zoom="toggleMaximize"
        />
      </template>
      <template v-else>
        <UiTrafficLights
          :focused="isFocused"
          @close="onClose"
          @minimize="onMinimize"
          @zoom="toggleMaximize"
        />

        <div class="titlebar-spacer" />

        <div class="titlebar-label" :title="win.title">{{ win.title }}</div>

        <div class="titlebar-spacer" />
      </template>
    </div>

    <div class="window-content" ref="contentRef">
      <div v-if="panelError" class="panel-async-state is-error">
        <p class="panel-async-title">This window crashed</p>
        <p class="panel-async-msg">{{ panelError }}</p>
        <p class="panel-async-hint">Close and reopen the window — if it persists, hard-refresh (Ctrl+Shift+R) to load the current build.</p>
        <button class="panel-async-retry" type="button" @click="onClose">Close window</button>
      </div>
      <component v-else :is="win.component" v-bind="win.props" @close="onClose" />
    </div>

    <div class="resize-handle n" @mousedown.prevent.stop="startResize('n', $event)"></div>
    <div class="resize-handle s" @mousedown.prevent.stop="startResize('s', $event)"></div>
    <div class="resize-handle e" @mousedown.prevent.stop="startResize('e', $event)"></div>
    <div class="resize-handle w" @mousedown.prevent.stop="startResize('w', $event)"></div>
    <div class="resize-handle ne" @mousedown.prevent.stop="startResize('ne', $event)"></div>
    <div class="resize-handle nw" @mousedown.prevent.stop="startResize('nw', $event)"></div>
    <div class="resize-handle se" @mousedown.prevent.stop="startResize('se', $event)"></div>
    <div class="resize-handle sw" @mousedown.prevent.stop="startResize('sw', $event)"></div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useWindowManager } from '@/composables/useWindowManager'
import { useContextMenu } from '@/composables/useContextMenu'
import type { WindowState } from '@/composables/useWindowManager'
import { createWindowUi, provideWindowUi } from '@/composables/useWindowUi'

const props = defineProps<{
  win: WindowState
  focused: boolean
}>()

const emit = defineEmits<{
  close: [id: string]
  minimize: [id: string]
  focus: [id: string]
  move: [id: string, x: number, y: number]
  resize: [id: string, w: number, h: number]
}>()

const contentRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const isFocused = computed(() => props.focused)
const isPlasma = computed(() => useTheme().shellStyle.value === 'plasma')
const wmShell = useWindowManager()
const ctx = useContextMenu()
const isMaximized = ref(false)
/** Plasma "always on top" pin — renders above tiled siblings. */
const pinned = ref(false)
const savedRect = ref({ x: 0, y: 0, width: 0, height: 0 })

ctx.registerContext('window_titlebar', [
  { id: 'w-max', label: 'Maximize', icon: 'solar:maximize-bold', action: (d) => d?.toggleMax?.() },
  { id: 'w-min', label: 'Minimize', icon: 'solar:minus-bold', action: (d) => d?.minimize?.() },
  { id: 'w-pin', label: 'Always on top', icon: 'solar:layers-bold', action: (d) => d?.togglePin?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'w-close', label: 'Close', icon: 'solar:close-bold', action: (d) => d?.close?.() },
])

function openWindowMenu(e: MouseEvent) {
  ctx.open(e, 'window_titlebar', {
    toggleMax: () => toggleMaximize(),
    minimize: () => onMinimize(),
    close: () => onClose(),
    togglePin: () => { pinned.value = !pinned.value },
    pinned: pinned.value,
  })
}

/**
 * Window-aware context: everything rendered inside this window (via
 * `useWindowUi()`) now knows its host window's live size, focus state and
 * effective density, so panels can adapt as the window is resized.
 */
const winUi = provideWindowUi(
  createWindowUi({
    id: props.win.id,
    panelType: props.win.panelType,
    title: props.win.title,
    icon: props.win.icon,
    width: computed(() => props.win.width),
    height: computed(() => props.win.height),
    focused: isFocused,
  })
)

const isNarrow = computed(() => winUi.isNarrow.value)

/** Setup/render crashes in the hosted panel (e.g. a TDZ in a panel's
 * setup()) otherwise leave a blank window with only a console error. */
const panelError = ref('')
onErrorCaptured((err) => {
  panelError.value = err instanceof Error ? err.message : String(err ?? 'Unknown error')
  return false
})

const windowStyle = computed(() => {
  // Plasma pin: stay above tiled siblings without touching manager order.
  const z = pinned.value ? 9999 : props.win.zIndex
  if (props.win.minimized) {
    return { display: 'none' }
  }
  if (isMaximized.value) {
    // Maximized = fill the whole desktop workspace: from the bottom of the
    // desktop area up to the start of the top header. The window lives inside
    // `.desktop-workspace` (inset:0 of `.desktop-area`, directly below
    // TopMenuBar), so 0/0 + 100% is exactly that region — no magic offsets.
    return {
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
      zIndex: z,
    }
  }
  const style: Record<string, string | number> = {
    left: `${props.win.x}px`,
    top: `${props.win.y}px`,
    width: `${props.win.width}px`,
    height: `${props.win.height}px`,
    zIndex: z,
  }
  return style
})

let dragging = false
let dragStartX = 0
let dragStartY = 0
let dragOrigX = 0
let dragOrigY = 0

function startDrag(e: MouseEvent) {
  if (isMaximized.value) return
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOrigX = props.win.x
  dragOrigY = props.win.y
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e: MouseEvent) {
  if (!dragging) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  const newX = Math.max(0, dragOrigX + dx)
  const newY = Math.max(0, dragOrigY + dy)
  emit('move', props.win.id, newX, newY)
}

function stopDrag(e?: MouseEvent) {
  dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  // Plasma snap: drag to the top edge maximizes, to a side edge tiles.
  if (isPlasma.value && e && !isMaximized.value) {
    try {
      if (e.clientY <= 2) {
        toggleMaximize()
      } else if (e.clientX <= 2 || e.clientX >= window.innerWidth - 2) {
        wmShell.setLayoutMode('tiled')
      }
    } catch { /* pointer left the viewport — keep the drop position */ }
  }
}

let resizing = false
let resizeDir = ''
let resizeStartX = 0
let resizeStartY = 0
let resizeOrigX = 0
let resizeOrigY = 0
let resizeOrigW = 0
let resizeOrigH = 0

function startResize(dir: string, e?: MouseEvent) {
  if (isMaximized.value) return
  resizing = true
  resizeDir = dir
  resizeStartX = e ? e.clientX : 0
  resizeStartY = e ? e.clientY : 0
  resizeOrigX = props.win.x
  resizeOrigY = props.win.y
  resizeOrigW = props.win.width
  resizeOrigH = props.win.height
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (!resizing) return
  const dx = e.clientX - resizeStartX
  const dy = e.clientY - resizeStartY
  let newX = resizeOrigX
  let newY = resizeOrigY
  let newW = resizeOrigW
  let newH = resizeOrigH

  if (resizeDir.includes('e')) newW = Math.max(320, resizeOrigW + dx)
  if (resizeDir.includes('w')) {
    newW = Math.max(320, resizeOrigW - dx)
    newX = resizeOrigX + (resizeOrigW - newW)
    // West edge hit the workspace border (below TopMenuBar): pin it and
    // shrink the growth instead of pushing the window off-screen.
    if (newX < 0) {
      newX = 0
      newW = resizeOrigX + resizeOrigW
    }
  }
  if (resizeDir.includes('s')) newH = Math.max(240, resizeOrigH + dy)
  if (resizeDir.includes('n')) {
    newH = Math.max(240, resizeOrigH - dy)
    newY = resizeOrigY + (resizeOrigH - newH)
    // North edge hit the workspace top (directly below TopMenuBar): pin it
    // instead of sliding the titlebar up under (behind) the header.
    if (newY < 0) {
      newY = 0
      newH = resizeOrigY + resizeOrigH
    }
  }

  if (newX !== resizeOrigX || newY !== resizeOrigY) {
    emit('move', props.win.id, newX, newY)
  }
  emit('resize', props.win.id, newW, newH)
}

function stopResize() {
  resizing = false
  resizeDir = ''
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}

function onClose() {
  emit('close', props.win.id)
}

function onMinimize() {
  emit('minimize', props.win.id)
}

function onFocus() {
  emit('focus', props.win.id)
}

function getWorkspaceSize(): { w: number; h: number } {
  // The window is a child of `.desktop-workspace`, whose inset:0 box is
  // exactly the usable desktop area (below TopMenuBar, above Dock/StatusBar).
  const host: HTMLElement | null | undefined =
    rootRef.value?.closest('.desktop-workspace') ??
    rootRef.value?.parentElement
  if (host && host.clientWidth > 0 && host.clientHeight > 0) {
    return { w: host.clientWidth, h: host.clientHeight }
  }
  const area = document.querySelector('.desktop-workspace') ?? document.querySelector('.desktop-area')
  if (area && (area as HTMLElement).clientWidth > 0) {
    return {
      w: (area as HTMLElement).clientWidth,
      h: (area as HTMLElement).clientHeight,
    }
  }
  return { w: window.innerWidth, h: window.innerHeight }
}

function applyMaximizedRect() {
  // Keep the stored rect in sync so window-aware children (useWindowUi)
  // see the real maximized geometry.
  const { w, h } = getWorkspaceSize()
  emit('move', props.win.id, 0, 0)
  emit('resize', props.win.id, w, h)
}

function toggleMaximize() {
  if (isMaximized.value) {
    isMaximized.value = false
    emit('move', props.win.id, savedRect.value.x, savedRect.value.y)
    emit('resize', props.win.id, savedRect.value.width, savedRect.value.height)
  } else {
    savedRect.value = {
      x: props.win.x,
      y: props.win.y,
      width: props.win.width,
      height: props.win.height,
    }
    isMaximized.value = true
    applyMaximizedRect()
  }
}

function handleViewportResize() {
  if (isMaximized.value) applyMaximizedRect()
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (!isFocused.value) return
  if (e.key === 'Escape' && isMaximized.value) {
    toggleMaximize()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('resize', handleViewportResize)
  // Hand the live element to the window context so descendants get real geometry.
  winUi.observe(rootRef.value)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', handleViewportResize)
  stopDrag()
  stopResize()
})
</script>

<style scoped>
.app-window {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--ui-window);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-xl);
  overflow: hidden;
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  box-shadow: var(--ui-shadow-window);
  transition:
    box-shadow var(--ui-dur) ease-out,
    border-color var(--ui-dur) ease-out,
    background-color var(--ui-dur) ease-out;
  min-width: 320px;
  min-height: 240px;
  will-change: left, top, width, height;
}

.app-window.focused {
  border-color: var(--ui-border);
  background: var(--ui-window);
  box-shadow: var(--ui-shadow-window);
}

.app-window.blurred {
  background: var(--ui-window-idle);
  border-color: var(--ui-border);
  box-shadow: var(--ui-shadow-window-idle);
}

.app-window.minimized {
  pointer-events: none;
}

.app-window.maximized {
  border-radius: 0;
  border-left: none;
  border-right: none;
}

/* ── titlebar ─────────────────────────────────────────────────────────── */

.window-titlebar {
  display: flex;
  align-items: center;
  height: var(--ui-titlebar-h);
  min-height: 28px;
  padding: 0 12px;
  gap: 8px;
  background: transparent;
  border-bottom: 1px solid var(--ui-separator);
  cursor: default;
  user-select: none;
  flex-shrink: 0;
  position: relative;
}

/* Centered 13px/600 title, no icon. Dimmed when the window is inactive. */
.titlebar-label {
  font-family: var(--ui-font);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ui-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  max-width: 46ch;
  transition: color var(--ui-dur) ease-out;
}

.app-window.focused .titlebar-label {
  color: var(--ui-text);
}

.titlebar-spacer {
  flex: 1;
}

/* Plasma titlebar: 30px, app icon + left title, glyph buttons right,
   rounded top corners, 1px outline, dimmed title when inactive. */
.window-titlebar--plasma {
  padding: 0 4px 0 10px;
  gap: 8px;
}

.titlebar-app {
  display: inline-flex;
  align-items: center;
  color: var(--ui-text-2);
  flex-shrink: 0;
}

.titlebar-label--left {
  text-align: left;
  font-weight: 400;
  max-width: 60ch;
}

.window-titlebar--narrow {
  gap: 6px;
  padding: 0 8px;
}

.window-titlebar--narrow .titlebar-label {
  font-size: var(--ui-fs-xs);
  max-width: 18ch;
}

/* ── content ──────────────────────────────────────────────────────────── */

.window-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
  background: var(--ui-surface);
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-gutter: stable;
}

/* Mobile sheets: traffic lights hide, title stays centered. */
@media (max-width: 768px) {
  .window-titlebar {
    padding: 0 12px;
  }
  .window-titlebar .ui-lights {
    display: none;
  }
  .window-titlebar .titlebar-spacer:first-of-type {
    display: none;
  }
}

.window-content > :deep(*) {
  /* Fill short windows but grow tall content so the outer scroller can
     actually scroll: `height: 100%` pinned every panel to the viewport
     height, clipping anything taller with no way to reach it. */
  min-height: 100%;
  /* Global overflow safety net: no window child may push content past the
     window frame horizontally — shrink, wrap, and scroll internally. */
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: break-word;
}

/* Wide media / code / tables must scroll inside the window, never widen it. */
.window-content :deep(img, video, canvas, table) {
  max-width: 100%;
}
.window-content :deep(pre) {
  max-width: 100%;
  overflow: auto;
}

/* ── resize handles ───────────────────────────────────────────────────── */

.resize-handle {
  position: absolute;
  z-index: 10;
}

.resize-handle.n { top: -3px; left: 4px; right: 4px; height: 6px; cursor: n-resize; }
.resize-handle.s { bottom: -3px; left: 4px; right: 4px; height: 6px; cursor: s-resize; }
.resize-handle.e { right: -3px; top: 4px; bottom: 4px; width: 6px; cursor: e-resize; }
.resize-handle.w { left: -3px; top: 4px; bottom: 4px; width: 6px; cursor: w-resize; }
.resize-handle.ne { top: -4px; right: -4px; width: 10px; height: 10px; cursor: ne-resize; }
.resize-handle.nw { top: -4px; left: -4px; width: 10px; height: 10px; cursor: nw-resize; }
.resize-handle.se { bottom: -4px; right: -4px; width: 10px; height: 10px; cursor: se-resize; }
.resize-handle.sw { bottom: -4px; left: -4px; width: 10px; height: 10px; cursor: sw-resize; }
</style>

<style>
/* Shared async-panel states: used by AppWindow's crash fallback AND the
 * PanelLoading/PanelLoadError components in useWindowManager (unscoped so
 * both trees match). */
.panel-async-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 20px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--ui-text-2);
}
.panel-async-state.is-error { color: var(--ui-text); }
.panel-async-title { margin: 0; font-weight: 700; }
.panel-async-msg {
  margin: 0;
  font-family: var(--ui-font-mono);
  font-size: 12px;
  color: var(--ui-text-2);
  overflow-wrap: anywhere;
}
.panel-async-hint { margin: 0; font-size: 12px; color: var(--ui-text-3); }
.panel-async-retry {
  margin-top: 4px;
  padding: 6px 14px;
  border-radius: var(--ui-radius-full);
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-surface-2);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.panel-async-retry:hover { border-color: var(--ui-accent); }
</style>
