<template>
  <div class="dash-panel">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-dash"><AppIcon name="solar:monitor-bold" /></span>
        <h2 class="panel-title">REMOTE DASHBOARD</h2>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:pulse-bold" :size="13" /> DASHBOARD STATUS</h3>
      <div class="status-card">
        <div class="s-row"><span class="s-key text-muted">STATUS</span><span class="s-value">{{ store.dashboardStatus?.running ? 'RUNNING' : 'STOPPED' }}</span></div>
        <div class="s-row"><span class="s-key text-muted">PORT</span><span class="s-value">{{ store.dashboardStatus?.port }}</span></div>
        <div class="s-row"><span class="s-key text-muted">URL</span><span class="s-value mono">{{ store.dashboardStatus?.url }}</span></div>
        <div class="s-row"><span class="s-key text-muted">CONNECTIONS</span><span class="s-value">{{ store.dashboardStatus?.activeConnections }}</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="bw-btn" style="flex:1;" @click="store.startDashboard()" :disabled="store.dashboardStatus?.running" title="START DASHBOARD"><AppIcon name="solar:play-bold" :size="12" /> START</button>
        <button class="bw-btn" style="flex:1;" @click="store.stopDashboard()" :disabled="!store.dashboardStatus?.running" title="STOP DASHBOARD"><AppIcon name="solar:close-square-bold" :size="12" /> STOP</button>
        <button class="bw-btn" style="flex:1;" @click="store.fetchDashboardStatus()"><AppIcon name="solar:refresh-bold" :size="13" /> REFRESH</button>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:brackets-bold" :size="13" /> API ENDPOINTS</h3>
      <div class="api-list">
        <div v-for="ep in apiEndpoints" :key="ep.path + ep.method" class="api-row">
          <span class="api-method">{{ ep.method }}</span>
          <span class="api-path">{{ ep.path }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import type { DashboardStatus, ApiEndpoint } from '@/types'

const store = useAppStore()

const apiEndpoints = ref<ApiEndpoint[]>([
  { method: 'GET', path: '/api/files', description: 'LIST FILES' },
  { method: 'GET', path: '/api/search', description: 'FULL-TEXT SEARCH' },
  { method: 'GET', path: '/api/health', description: 'HEALTH CHECK' },
  { method: 'GET', path: '/api/accounts', description: 'LIST ACCOUNTS' },
  { method: 'GET', path: '/api/collections', description: 'LIST COLLECTIONS' },
  { method: 'GET', path: '/api/face-groups', description: 'LIST FACE GROUPS' },
  { method: 'GET', path: '/api/encryption/status', description: 'ENCRYPTION STATUS' },
])

onMounted(() => {
  store.fetchDashboardStatus()
})
</script>

<style scoped>
.dash-panel {
  width: 100%;
  height: 100%;
  background: var(--ui-surface);
  overflow-y: auto;
  padding: 16px;
  font-family: var(--ui-font);
  color: var(--ui-text);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
  margin-bottom: 16px;
}

.header-left { display: flex; align-items: center; gap: 8px; }
.icon-dash { font-size: 16px; }
.panel-title { font-size: 14px; font-weight: 800; letter-spacing: 1px; margin: 0; }

.section { margin-bottom: 16px; }

.section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
  margin: 0 0 8px;
}

.status-card {
  border: 1px solid var(--ui-border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.s-row { display: flex; justify-content: space-between; }
.s-key { font-size: 10px; }
.s-value { font-size: 10px; font-weight: 700; }
.mono { font-family: var(--ui-font); }

.api-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.api-row {
  display: flex;
  gap: 8px;
  padding: 3px 6px;
  font-size: 10px;
  border-bottom: 1px solid var(--ui-border);
}

.api-method { font-weight: 700; min-width: 36px; }
.api-path { color: color-mix(in srgb, var(--ui-text) 70%, transparent); }

.text-muted { color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important; }
</style>
