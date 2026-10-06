<template>
  <div class="desktop-shell" :class="{ 'desktop-shell--glow': theme.settings.glow }">
    <TopMenuBar />

    <div class="desktop-area" @click="handleWorkspaceClick">
      <div class="desktop-wallpaper">
        <slot name="wallpaper" />
        <div class="desktop-aurora" aria-hidden="true" />
      </div>

      <div class="desktop-workspace">
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWindowManager } from '@/composables/useWindowManager'
import { useTheme } from '@/composables/useTheme'
import TopMenuBar from './TopMenuBar.vue'
import Dock from './Dock.vue'
import StatusBar from './StatusBar.vue'
import AppWindow from './AppWindow.vue'
import type { PanelType } from '@/types'

const wm = useWindowManager()
const theme = useTheme()
const selectShortcut = ref<PanelType | null>(null)

const shortcuts: { panel: PanelType; label: string; icon: string }[] = [
  { panel: 'files', label: 'Files', icon: 'solar:folder-bold' },
  { panel: 'collections', label: 'Collections', icon: 'solar:library-bold' },
  { panel: 'map', label: 'Map', icon: 'solar:map-bold' },
  { panel: 'code', label: 'Code', icon: 'solar:code-square-bold' },
  { panel: 'settings', label: 'Settings', icon: 'solar:settings-bold' },
  { panel: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold' },
]

const visibleWindows = computed(() =>
  wm.windows.value.filter(w => !w.minimized)
)

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
})

onUnmounted(() => {
  window.removeEventListener('cybermanju:dock-context', handleDockContext as EventListener)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('contextmenu', () => { dockMenu.value.visible = false })
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
</style>
