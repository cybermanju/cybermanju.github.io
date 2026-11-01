<!-- CyberManju OS — MobileNav (src/components/MobileNav.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…, vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <!-- Live tasks sit above the persistent favorites dock; Home minimizes rather than destroys them. -->
  <nav v-if="hasOpenWindows" class="mobile-nav" :class="{ 'motion-reduced': motion.reduced.value }" role="navigation" aria-label="Open tasks">
    <button
      class="mn-btn"
      type="button"
      aria-label="Home"
      @click="goHome"
    >
      <AppIcon name="solar:home-bold" :size="20" />
      <span class="mn-label">Home</span>
    </button>
    <button
      v-for="win in taskWindows"
      :key="win.id"
      class="mn-btn"
      :class="{ active: win.id === wm.activeWindow.value?.id }"
      type="button"
      :aria-label="`Switch to ${win.title}`"
      :aria-current="win.id === wm.activeWindow.value?.id ? 'page' : undefined"
      @click="showTask(win.id)"
    >
      <AppIcon :name="win.icon" :size="20" />
      <span class="mn-label">{{ win.title }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed } from 'vue'
import { useMotion } from '@/composables/useMotion'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'

const wm = useWindowManager()
const store = useAppStore()
const motion = useMotion()

const hasOpenWindows = computed(() => wm.windows.value.some(w => !w.minimized))
const taskWindows = computed(() => wm.windows.value.slice(-8))

function goHome() {
  wm.minimizeAll()
  store.currentPanel = 'files'
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8)
  } catch { /* no haptics */ }
}

function showTask(id: string) {
  if (store.currentPanel === 'landing') store.currentPanel = 'files'
  wm.restore(id)
  wm.focus(id)
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(5)
  } catch { /* no haptics */ }
}
</script>

<style scoped>
.mobile-nav {
  display: none;
  position: fixed;
  bottom: calc(var(--mobile-favorites-dock-h, 7vh) + env(safe-area-inset-bottom, 0px) + 2vh);
  left: 2vw;
  right: 2vw;
  height: var(--mobile-taskbar-h, 6vh);
  min-height: 40px;
  box-sizing: border-box;
  padding: 2px 1vw;
  align-items: center;
  gap: .5vw;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  /* iOS tab bar: hairline top edge + heavy blur, like Cupertino tab bars. */
  background: color-mix(in srgb, var(--ui-surface) 66%, transparent);
  backdrop-filter: blur(28px) saturate(1.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  border-top: 0.5px solid color-mix(in srgb, var(--ui-border) 68%, transparent);
  box-shadow: 0 -8px 28px rgba(16, 24, 40, .06);
  z-index: 111;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", var(--ui-font), sans-serif;
}
.mn-btn {
  flex: 0 0 auto;
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
  min-height: 38px;
  padding: 2px 3vw;
  border-radius: 12px;
  transition: color 120ms ease-out, transform 150ms cubic-bezier(.34,1.4,.4,1), background 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.mn-btn:active {
  color: var(--ui-text-2);
  background: color-mix(in srgb, var(--ui-accent) 9%, transparent);
  transform: scale(0.92);
}

.mn-label {
  font-size: 10px;
  font-weight: 600;
  max-width: 18vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mn-btn.active {
  color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
}

.motion-reduced .mn-btn { transition: none !important; }

@media (max-width: 768px), (pointer: coarse) and (max-height: 600px) {
  .mobile-nav {
    display: flex;
  }
}
</style>
