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
      :class="{ 'window-titlebar--narrow': isNarrow }"
      @mousedown.prevent="startDrag"
      @dblclick="toggleMaximize"
    >
      <div class="titlebar-dots" @mousedown.stop>
        <button
          class="dot dot-close"
          type="button"
          :aria-label="`Close ${win.title}`"
          title="Close"
          @click.stop="onClose"
        >
          <AppIcon name="solar:close-bold" :size="7" class="dot-glyph" />
        </button>
        <button
          class="dot dot-minimize"
          type="button"
          :aria-label="`Minimize ${win.title}`"
          title="Minimize"
          @click.stop="onMinimize"
        >
          <AppIcon name="solar:minus-bold" :size="7" class="dot-glyph" />
        </button>
        <button
          class="dot dot-maximize"
          type="button"
          :aria-label="`Maximize ${win.title}`"
          :title="isMaximized ? 'Restore' : 'Maximize'"
          @click.stop="toggleMaximize"
        >
          <AppIcon name="solar:maximize-bold" :size="7" class="dot-glyph" />
        </button>
      </div>

      <div class="titlebar-icon" aria-hidden="true">
        <AppIcon :name="win.icon" :size="13" />
      </div>

      <div class="titlebar-label" :title="win.title">{{ win.title }}</div>

      <div class="titlebar-spacer" />

      <div class="titlebar-status" :class="{ active: isFocused }" aria-hidden="true">
        <span class="titlebar-status__dot" />
        <span v-if="!isNarrow" class="titlebar-status__text">{{ isFocused ? 'FOCUS' : 'IDLE' }}</span>
      </div>

      <button
        class="titlebar-action"
        type="button"
        :aria-label="isMaximized ? 'Restore window' : 'Maximize window'"
        :title="isMaximized ? 'Restore' : 'Maximize'"
        @mousedown.stop
        @click.stop="toggleMaximize"
      >
        <AppIcon :name="isMaximized ? 'solar:minimize-bold' : 'solar:maximize-bold'" :size="11" />
      </button>
    </div>

    <div class="window-content" ref="contentRef">
      <component :is="win.component" v-bind="win.props" @close="onClose" />
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
const isMaximized = ref(false)
const savedRect = ref({ x: 0, y: 0, width: 0, height: 0 })

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

const windowStyle = computed(() => {
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
      zIndex: props.win.zIndex,
    }
  }
  const style: Record<string, string | number> = {
    left: `${props.win.x}px`,
    top: `${props.win.y}px`,
    width: `${props.win.width}px`,
    height: `${props.win.height}px`,
    zIndex: props.win.zIndex,
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

function stopDrag() {
  dragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
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
  }
  if (resizeDir.includes('s')) newH = Math.max(240, resizeOrigH + dy)
  if (resizeDir.includes('n')) {
    newH = Math.max(240, resizeOrigH - dy)
    newY = resizeOrigY + (resizeOrigH - newH)
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
  border-radius: var(--ui-radius-lg);
  overflow: hidden;
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  box-shadow:
    var(--ui-shadow-3),
    inset 0 1px 0 var(--ui-glass-highlight);
  transition:
    box-shadow var(--ui-dur-slow) var(--ui-ease-out),
    border-color var(--ui-dur-slow) var(--ui-ease-out),
    background-color var(--ui-dur-slow) var(--ui-ease-out);
  min-width: 320px;
  min-height: 240px;
  will-change: left, top, width, height;
}

.app-window.focused {
  border-color: color-mix(in srgb, var(--ui-accent) 42%, var(--ui-border-strong));
  background: var(--ui-window);
  box-shadow:
    var(--ui-shadow-3),
    0 0 0 1px color-mix(in srgb, var(--ui-accent) 26%, transparent),
    0 24px 64px color-mix(in srgb, var(--ui-accent) 12%, transparent),
    inset 0 1px 0 var(--ui-glass-highlight);
}

.app-window.blurred {
  background: var(--ui-window-idle);
  box-shadow:
    var(--ui-shadow-1),
    inset 0 1px 0 var(--ui-glass-highlight);
  filter: saturate(0.85);
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
  min-height: 30px;
  padding: 0 10px;
  gap: 8px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-surface-2) 92%, transparent),
    color-mix(in srgb, var(--ui-surface) 75%, transparent)
  );
  border-bottom: 1px solid var(--ui-hairline);
  cursor: default;
  user-select: none;
  flex-shrink: 0;
  position: relative;
}

.window-titlebar::after {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--ui-accent) 35%, transparent) 35%,
    transparent
  );
  opacity: 0;
  transition: opacity var(--ui-dur-slow) var(--ui-ease-out);
  pointer-events: none;
}

.app-window.focused .window-titlebar::after {
  opacity: 1;
}

.titlebar-dots {
  display: flex;
  gap: 7px;
  flex-shrink: 0;
}

.dot {
  position: relative;
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  transition:
    transform var(--ui-dur-fast) var(--ui-ease-spring),
    box-shadow var(--ui-dur) var(--ui-ease-out),
    filter var(--ui-dur-fast) var(--ui-ease-out);
  box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.25);
}

.dot:hover {
  transform: scale(1.18);
  filter: brightness(1.12);
}

.dot:active {
  transform: scale(0.94);
}

.dot:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 80%, transparent);
  outline-offset: 2px;
}

.dot-glyph {
  opacity: 0;
  transform: scale(0.5);
  transition:
    opacity var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-spring);
  color: rgba(0, 0, 0, 0.72);
}

.dot:hover .dot-glyph {
  opacity: 1;
  transform: scale(1);
}

.dot-close {
  background: var(--ui-danger);
}

.dot-minimize {
  background: var(--ui-warning);
}

.dot-maximize {
  background: var(--ui-success);
}

.titlebar-icon {
  display: inline-flex;
  align-items: center;
  color: var(--ui-text-2);
  flex-shrink: 0;
  transition: color var(--ui-dur) var(--ui-ease-out), transform var(--ui-dur) var(--ui-ease-spring);
}

.app-window.focused .titlebar-icon {
  color: var(--ui-accent);
}

.app-window.focused .titlebar-icon:hover {
  transform: rotate(-6deg) scale(1.1);
}

.titlebar-label {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  font-weight: 650;
  color: var(--ui-text-2);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46ch;
  transition: color var(--ui-dur) var(--ui-ease-out);
}

.app-window.focused .titlebar-label {
  color: var(--ui-text);
  text-shadow: 0 0 18px color-mix(in srgb, var(--ui-accent) 35%, transparent);
}

.titlebar-spacer {
  flex: 1;
}

.titlebar-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: var(--ui-radius-full);
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
  border: 1px solid var(--ui-hairline);
  flex-shrink: 0;
}

.titlebar-status__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-text-faint);
  transition:
    background-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out);
}

.titlebar-status.active .titlebar-status__dot {
  background: var(--ui-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 80%, transparent);
  animation: bw-pulse 2.4s ease-in-out infinite;
}

.titlebar-status__text {
  font-family: var(--ui-font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--ui-text-3);
}

.titlebar-status.active .titlebar-status__text {
  color: var(--ui-accent);
}

.titlebar-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border-radius: var(--ui-radius-xs);
  color: var(--ui-text-3);
  background: transparent;
  border: 1px solid transparent;
  flex-shrink: 0;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out);
}

.titlebar-action:hover {
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 30%, transparent);
  color: var(--ui-accent);
}

.titlebar-action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 80%, transparent);
  outline-offset: 1px;
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
  overflow: auto;
  position: relative;
  background: color-mix(in srgb, var(--ui-content) 96%, transparent);
}

.window-content > :deep(*) {
  height: 100%;
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
