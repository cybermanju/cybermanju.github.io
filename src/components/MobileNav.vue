<template>
  <nav class="mobile-nav" role="navigation" aria-label="MOBILE NAVIGATION">
    <button class="mn-btn" @click="wm.open('files')" aria-label="FILES" title="FILES"><AppIcon name="solar:folder-bold" :size="18" /></button>
    <button class="mn-btn" @click="wm.open('search')" aria-label="SEARCH" title="SEARCH"><AppIcon name="solar:magnifier-bold" :size="18" /></button>
    <button class="mn-btn" @click="wm.open('terminal')" aria-label="TERMINAL">[&gt;]</button>
    <button class="mn-btn" @click="wm.open('collections', { tab: 'favorites' })" aria-label="FAVORITES" title="FAVORITES"><AppIcon name="solar:star-bold" :size="18" /></button>
    <button class="mn-btn" @click="wm.open('settings')" aria-label="SETTINGS" title="SETTINGS"><AppIcon name="solar:settings-bold" :size="18" /></button>
  </nav>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { useWindowManager } from '@/composables/useWindowManager'
const wm = useWindowManager()
</script>

<style scoped>.mobile-nav {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--ui-glass);
  border-top: 1px solid var(--ui-border);
  z-index: 100;
  font-family: var(--ui-font);
  border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
}

.mn-btn {
  flex: 1;
  background: transparent;
  border: none;
  border-right: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 40%, transparent);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
}

.mn-btn:last-child {
  border-right: none;
}

.mn-btn.active {
  color: var(--ui-text);
  background: var(--ui-glass-2);
}

@media (max-width: 768px) {
  .mobile-nav {display: flex;
  border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
}
}
</style>
