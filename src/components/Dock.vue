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
  { panelType: 'collections', label: 'Collections', icon: 'solar:library-bold', category: 'organize' },
  { panelType: 'faces', label: 'People', icon: 'solar:face-scan-circle-bold', category: 'organize' },
  { panelType: 'map', label: 'Map', icon: 'solar:map-bold', category: 'tools' },
  { panelType: 'code', label: 'Code', icon: 'solar:code-bold', category: 'tools' },
  { panelType: 'editor', label: 'Editor', icon: 'solar:file-code-bold', category: 'tools' },
  { panelType: 'agent', label: 'Agent', icon: 'solar:bot-bold', category: 'tools' },
  { panelType: 'sync', label: 'Sync', icon: 'solar:refresh-bold', category: 'tools' },
  { panelType: 'storage', label: 'Storage', icon: 'solar:database-bold', category: 'tools' },
  { panelType: 'disks', label: 'Disks', icon: 'solar:ssd-square-bold', category: 'tools' },
  { panelType: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold', category: 'system' },
  { panelType: 'processes', label: 'Tasks', icon: 'solar:cpu-bold', category: 'system' },
  { panelType: 'settings', label: 'Settings', icon: 'solar:settings-bold', category: 'system' },
  { panelType: 'trash', label: 'Trash', icon: 'solar:trash-bin-trash-bold', category: 'system' },
  { panelType: 'users', label: 'Users', icon: 'solar:users-group-rounded-bold', category: 'system' },
  { panelType: 'accounts', label: 'Accounts', icon: 'solar:user-circle-bold', category: 'system' },
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
  gap: 4px;
  padding: 6px 10px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border-strong);
  border-radius: 18px;
  box-shadow:
    var(--ui-shadow-3),
    inset 0 1px 0 var(--ui-glass-highlight);
  pointer-events: auto;
  position: relative;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.dock::-webkit-scrollbar {
  display: none;
}

.dock::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  border-radius: 18px 18px 0 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--ui-accent) 45%, transparent) 30%,
    color-mix(in srgb, var(--ui-accent) 45%, transparent) 70%,
    transparent
  );
  opacity: 0.7;
  pointer-events: none;
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 10px;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-spring);
  position: relative;
  min-width: 44px;
  background: transparent;
  border: none;
}

.dock-item:hover {
  background: var(--ui-accent-softer);
  transform: translateY(-4px) scale(1.06);
}

.dock-item:active {
  transform: translateY(-1px) scale(1.01);
}

.dock-item.active {
  background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
}

.dock-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  transition:
    background-color var(--ui-dur) var(--ui-ease-out),
    border-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-spring);
}

.dock-item:hover .dock-icon {
  background: var(--ui-surface-3);
  border-color: var(--ui-border-hover);
}

.dock-item.active .dock-icon {
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  box-shadow: var(--ui-glow-soft);
}

.dock-icon-text {
  color: var(--ui-text-2);
  transition: color var(--ui-dur) var(--ui-ease-out), transform var(--ui-dur) var(--ui-ease-spring);
}

.dock-item:hover .dock-icon-text {
  transform: scale(1.08);
}

.dock-item.active .dock-icon-text {
  color: var(--ui-accent);
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
