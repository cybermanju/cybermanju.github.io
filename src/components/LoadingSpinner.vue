<!-- CyberManju OS — LoadingSpinner (src/components/LoadingSpinner.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <div class="loading-spinner" :class="sizeClass" role="status" aria-label="Loading">
    <div class="spinner-ring"></div>
    <span v-if="label" class="spinner-label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  label?: string
}>(), {
  size: 'md',
})

const sizeClass = computed(() => `spinner-${props.size}`)
</script>

<style scoped>
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.spinner-ring {
  border: 3px solid color-mix(in srgb, var(--ui-text) 4%, transparent);
  border-top-color: var(--ui-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner-sm .spinner-ring { width: 16px; height: 16px; border-width: 2px; }
.spinner-md .spinner-ring { width: 24px; height: 24px; border-width: 3px; }
.spinner-lg .spinner-ring { width: 36px; height: 36px; border-width: 4px; }

.spinner-label {
  font-family: var(--ui-font);
  font-size: 10px;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
