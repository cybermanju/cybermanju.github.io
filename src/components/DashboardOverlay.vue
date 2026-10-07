<template>
  <div class="dash-overlay" @click.self="$emit('close')">
    <div class="dash-content">
      <div class="dash-header">
        <h2>WEB DASHBOARD</h2>
        <button class="close-btn" @click="$emit('close')" aria-label="CLOSE"><AppIcon name="solar:close-bold" :size="13" /></button>
      </div>
      <div class="dash-body">
        <p class="text-muted">WEB DASHBOARD. ACCESS FROM ANY DEVICE ON YOUR NETWORK.</p>
        <div class="status-row">
          <span class="text-muted">STATUS</span>
          <span class="s-value">{{ store.dashboardStatus?.running ? 'RUNNING' : 'STOPPED' }}</span>
        </div>
        <div class="status-row">
          <span class="text-muted">PORT</span>
          <span class="s-value">{{ store.dashboardStatus?.port }}</span>
        </div>
        <div class="status-row">
          <span class="text-muted">CONNECTIONS</span>
          <span class="s-value">{{ store.dashboardStatus?.activeConnections }}</span>
        </div>
        <div class="dash-url">
          <span class="mono">{{ store.dashboardStatus?.url }}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="bw-btn" style="flex:1;" @click="store.startDashboard()" :disabled="store.dashboardStatus?.running" title="START DASHBOARD"><AppIcon name="solar:play-bold" :size="12" /> START</button>
          <button class="bw-btn" style="flex:1;" @click="store.stopDashboard()" :disabled="!store.dashboardStatus?.running" title="STOP DASHBOARD"><AppIcon name="solar:close-square-bold" :size="12" /> STOP</button>
          <button class="bw-btn" style="flex:1;" @click="store.fetchDashboardStatus()"><AppIcon name="solar:refresh-bold" :size="13" /> REFRESH</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
defineEmits<{ close: [] }>()
</script>

<style scoped>
.dash-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ui-bg-deep) 62%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.dash-content {background: var(--ui-glass-2);
  border: 1px solid var(--ui-border);
  padding: 24px;
  max-width: 400px;
  width: 90%;
  font-family: var(--ui-font);
  color: var(--ui-text);
  border-radius: var(--ui-radius-md);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
}

.dash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ui-border);
}

.dash-header h2 {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 1px;
  margin: 0;
}

.close-btn {
  background: none;
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: var(--ui-font);
  font-weight: 700;
  font-size: 10px;
}

.close-btn:hover { background: var(--ui-glass-2); color: var(--ui-text); }

.dash-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dash-body p { font-size: 11px; margin: 0; }

.dash-url {
  border: 1px solid var(--ui-border);
  padding: 10px;
  text-align: center;
}

.mono { font-family: var(--ui-font); font-size: 12px; font-weight: 700; }
.bw-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  padding: 4px 12px;
  cursor: pointer;
  font-family: var(--ui-font);
  font-size: 10px;
  font-weight: 700;
}
.bw-btn:hover:not(:disabled) { background: var(--ui-glass-2); color: var(--ui-text); }
.bw-btn:disabled { opacity: 0.3; cursor: default; }
.status-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 10px;
  border-bottom: 1px solid var(--ui-border);
}
.s-value { font-weight: 700; }
.text-muted { color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important; }
</style>
