<template>
  <!-- Mobile bottom bar: Home (launcher) + 5 apps. 60px tall + safe-area,
    labeled, active state follows the focused sheet. -->
  <nav class="mobile-nav" role="navigation" aria-label="Mobile navigation">
    <button
      class="mn-btn"
      :class="{ active: !hasOpenWindows }"
      type="button"
      aria-label="Home"
      :aria-current="!hasOpenWindows ? 'page' : undefined"
      @click="goHome"
    >
      <AppIcon name="solar:home-bold" :size="20" />
      <span class="mn-label">Home</span>
    </button>
    <button
      v-for="t in tabs"
      :key="t.id"
      class="mn-btn"
      :class="{ active: hasOpenWindows && isActive(t) }"
      type="button"
      :aria-label="t.label"
      :aria-current="hasOpenWindows && isActive(t) ? 'page' : undefined"
      @click="go(t)"
    >
      <AppIcon :name="t.icon" :size="20" />
      <span class="mn-label">{{ t.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import type { PanelType } from '@/types'

const wm = useWindowManager()
const store = useAppStore()

interface Tab {
  id: string
  label: string
  icon: string
  panel: PanelType
  props?: Record<string, unknown>
}

const tabs: Tab[] = [
  { id: 'files', label: 'Files', icon: 'solar:folder-bold', panel: 'files' },
  { id: 'search', label: 'Search', icon: 'solar:magnifier-bold', panel: 'search' },
  { id: 'agent', label: 'Agent', icon: 'solar:bot-bold', panel: 'agent' },
  { id: 'disks', label: 'Vaults', icon: 'solar:diskette-bold', panel: 'storage' },
  { id: 'settings', label: 'Settings', icon: 'solar:settings-bold', panel: 'settings' },
]

const hasOpenWindows = computed(() => wm.windows.value.some(w => !w.minimized))

const activePanel = computed(() => {
  const focused = wm.activeWindow.value?.panelType as string | undefined
  if (focused) return focused
  if (store.currentPanel === 'landing') return 'files'
  return store.currentPanel
})

function isActive(t: Tab): boolean {
  if (t.panel === 'storage') return activePanel.value === 'storage'
  return activePanel.value === t.panel
}

function goHome() {
  wm.closeAll()
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8)
  } catch { /* no haptics */ }
}

function go(t: Tab) {
  if (store.currentPanel === 'landing') store.currentPanel = 'files'
  wm.open(t.panel, t.props)
}
</script>

<style scoped>
.mobile-nav {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  min-height: 60px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border-top: 1px solid var(--ui-border);
  z-index: 100;
  font-family: var(--ui-font);
}

.mn-btn {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--ui-text-3);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 56px;
  padding: 6px 2px calc(6px + env(safe-area-inset-bottom, 0px));
  border-radius: 0;
  transition: color 120ms ease-out;
}
.mn-btn:active {
  color: var(--ui-text-2);
}

.mn-label {
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.mn-btn.active {
  color: var(--ui-accent);
}

@media (max-width: 768px) {
  .mobile-nav {
    display: flex;
  }
}
</style>
