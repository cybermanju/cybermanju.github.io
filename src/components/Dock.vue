<template>
  <div class="dock-container">
    <div class="dock">
      <div
        v-for="app in pinnedApps"
        :key="app.panelType"
        class="dock-item"
        :class="{ active: isAppActive(app.panelType), open: wm.isOpen(app.panelType) }"
        @click="handleDockClick(app.panelType)"
        @contextmenu.prevent="handleDockContext($event, app.panelType)"
      >
        <span class="dock-tip" aria-hidden="true">{{ app.label }}</span>
        <div class="dock-icon">
          <AppIcon class="dock-icon-text" :name="app.icon" :size="20" />
        </div>
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
        @click="handleOpenWindowClick(win.id)"
      >
        <span class="dock-tip" aria-hidden="true">{{ win.title }}</span>
        <div class="dock-icon" :class="{ minimized: win.minimized }">
          <AppIcon class="dock-icon-text" :name="win.icon" :size="20" />
        </div>
        <div class="dock-indicator">
          <div class="indicator-dot" :class="{ active: isWindowActive(win.id), muted: win.minimized }" />
        </div>
      </div>

      <div class="dock-divider" />

      <div
        class="dock-item"
        :class="{ active: isAppActive('trash') }"
        @click="handleDockClick('trash')"
      >
        <span class="dock-tip" aria-hidden="true">Trash</span>
        <div class="dock-icon">
          <AppIcon class="dock-icon-text" name="solar:trash-bin-trash-bold" :size="20" />
        </div>
        <div class="dock-indicator">
          <div v-if="wm.isOpen('trash')" class="indicator-dot" :class="{ active: isAppActive('trash') }" />
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
  align-items: flex-end;
  gap: 4px;
  padding: 6px 10px 8px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  box-shadow: var(--ui-shadow-menu);
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

.dock-divider {
  width: 1px;
  align-self: stretch;
  margin: 6px 4px 12px;
  background: var(--ui-separator);
}
</style>
