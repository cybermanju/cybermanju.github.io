<template>
  <div class="dock-container">
    <div class="dock">
      <div
        v-for="app in dockApps"
        :key="app.panelType"
        class="dock-item"
        :class="{ active: isAppActive(app.panelType), open: wm.isOpen(app.panelType) }"
        @click="handleDockClick(app.panelType)"
        @contextmenu.prevent="handleDockContext($event, app.panelType)"
        :title="app.label"
      >
        <div class="dock-icon">
          <AppIcon class="dock-icon-text" :name="app.icon" :size="16" />
        </div>
        <div class="dock-indicator" v-if="wm.isOpen(app.panelType)">
          <div class="indicator-dot" :class="{ active: isAppActive(app.panelType) }" />
        </div>
      </div>

      <div class="dock-divider" />

      <div
        v-for="win in minimizedWindows"
        :key="win.id"
        class="dock-item minimized-item"
        @click="wm.restore(win.id)"
        :title="win.title + ' (minimized)'"
      >
        <div class="dock-icon minimized">
          <AppIcon class="dock-icon-text" :name="win.icon" :size="16" />
        </div>
        <div class="dock-indicator">
          <div class="indicator-dot muted" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import type { PanelType } from '@/types'

const store = useAppStore()
const wm = useWindowManager()

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

const minimizedWindows = computed(() =>
  wm.windows.value.filter(w => w.minimized)
)

function isAppActive(panelType: PanelType): boolean {
  return wm.windows.value.some(
    w => w.panelType === panelType && !w.minimized
  )
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
  if (existing) {
    const items = [
      { label: 'Focus', action: () => wm.focus(existing.id) },
      { label: 'Minimize', action: () => wm.minimize(existing.id) },
      { label: 'Close', action: () => wm.close(existing.id) },
    ]
    window.dispatchEvent(new CustomEvent('cybermanju:dock-context', {
      detail: { x: e.clientX, y: e.clientY, items },
    }))
  }
}
</script>

<style scoped>
.dock-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 62px;
  padding: 0 16px;
  background: transparent;
  z-index: 50;
  pointer-events: none;
  min-width: 0;
  max-width: 100vw;
  overflow: hidden;
}

.dock {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ui-glass-2) 88%, transparent), color-mix(in srgb, var(--ui-glass-2) 100%, transparent)),
    var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(160%);
  border: 1px solid color-mix(in srgb, var(--ui-text) 12%, transparent);
  border-radius: 22px;
  box-shadow:
    var(--ui-shadow-3),
    inset 0 1px 0 var(--ui-glass-highlight),
    inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  pointer-events: auto;
  position: relative;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
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
  background: color-mix(in srgb, var(--ui-accent) 50%, transparent);
  border: 1px solid transparent;
  background-clip: content-box;
}
.dock:hover {
  scrollbar-color: color-mix(in srgb, var(--ui-accent) 50%, transparent) transparent;
}

.dock::before {
  content: none;
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 12px;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-spring);
  position: relative;
  min-width: 46px;
  background: transparent;
  border: none;
}

.dock-item:hover {
  transform: translateY(-4px) scale(1.06);
}

.dock-item:active {
  transform: translateY(-1px) scale(1.02);
}

.dock-item.active {
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
}

.dock-icon {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-text) 10%, transparent), color-mix(in srgb, var(--ui-text) 4%, transparent));
  border: 1px solid color-mix(in srgb, var(--ui-text) 14%, transparent);
  border-radius: 12px;
  box-shadow:
    inset 0 1px 0 var(--ui-glass-highlight),
    0 1px 3px rgba(0, 0, 0, 0.14);
  transition:
    background-color var(--ui-dur) var(--ui-ease-out),
    border-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-spring);
}

.dock-item:hover .dock-icon {
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-accent) 22%, var(--ui-glass)), var(--ui-glass-2));
  border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  box-shadow:
    inset 0 1px 0 var(--ui-glass-highlight),
    0 6px 16px color-mix(in srgb, var(--ui-accent) 25%, transparent);
}

.dock-item.active .dock-icon {
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-accent) 30%, var(--ui-glass)), var(--ui-glass-2));
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
}

.dock-icon-text {
  color: var(--ui-text-2);
  transition: color var(--ui-dur) var(--ui-ease-out);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2));
}

.dock-item:hover .dock-icon-text,
.dock-item.active .dock-icon-text {
  color: var(--ui-text);
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
  transition:
    width var(--ui-dur) var(--ui-ease-spring),
    background-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out);
}

.indicator-dot.active {
  background: var(--ui-accent);
  width: 16px;
  border-radius: var(--ui-radius-full);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 75%, transparent);
}

.indicator-dot.muted {
  background: var(--ui-border-strong);
}

.minimized-item .dock-icon {
  opacity: 0.5;
}

.dock-divider {
  width: 1px;
  height: 28px;
  background: var(--ui-border-strong);
  margin: 0 4px;
}
</style>
