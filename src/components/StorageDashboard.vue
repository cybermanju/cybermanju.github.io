<template>
  <div class="storage-panel">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-storage"><AppIcon name="solar:database-bold" /></span>
        <h2 class="panel-title">STORAGE DASHBOARD</h2>
      </div>
      <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH STORAGE" aria-label="REFRESH STORAGE" :loading="store.isLoading" @click="refresh()" />
    </div>

    <UiError
      v-if="store.lastError"
      size="sm"
      title="Could not load storage"
      :message="store.lastError"
      retryable
      @retry="refresh()"
    />

    <div v-if="store.isLoading && store.files.length === 0" class="storage-loading">
      <UiSpinner show-label label="Loading storage" />
    </div>

    <template v-else>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:checklist-bold" :size="13" /> FILE COUNTS</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{{ store.files.length }}</span>
          <span class="stat-label text-muted">TOTAL FILES</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ store.folders.length }}</span>
          <span class="stat-label text-muted">FOLDERS</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ store.encryptedFiles.length }}</span>
          <span class="stat-label text-muted">ENCRYPTED</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ store.compressedFiles.length }}</span>
          <span class="stat-label text-muted">COMPRESSED</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ store.starredFiles.length }}</span>
          <span class="stat-label text-muted">STARRED</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ trashCount }}</span>
          <span class="stat-label text-muted">IN TRASH</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:ruler-bold" :size="13" /> TOTAL BY TYPE</h3>
      <div class="type-breakdown">
        <div v-for="entry in byType" :key="entry.label" class="type-row">
          <span class="type-label">{{ entry.label }}</span>
          <span class="type-bar"><span class="type-bar-fill" :style="{ width: entry.percent + '%' }" /></span>
          <span class="type-size">{{ humanBytes(entry.totalBytes) }}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:database-bold" :size="13" /> STORAGE FOOTPRINT</h3>
      <div class="info-card">
        <div class="info-row"><span class="info-key text-muted">TOTAL SIZE</span><span class="info-value">{{ totalSizeFormatted }}</span></div>
        <div class="info-row"><span class="info-key text-muted">LARGEST FILE</span><span class="info-value">{{ largestFile }}</span></div>
        <div class="info-row"><span class="info-key text-muted">AVG FILE SIZE</span><span class="info-value">{{ avgSizeFormatted }}</span></div>
        <div class="info-row"><span class="info-key text-muted">FILES WITH GPS</span><span class="info-value">{{ gpsCount }}</span></div>
        <div class="info-row"><span class="info-key text-muted">FILES WITH FACES</span><span class="info-value">{{ faceCount }}</span></div>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:ssd-square-bold" :size="13" /> MERGED DISKS ({{ df ? df.diskCount : 0 }})</h3>
      <div class="df-bar" role="img" :aria-label="`Volume ${usedPct.toFixed(1)} percent used`">
        <div class="df-used" :style="{ width: usedPct + '%' }"></div>
      </div>
      <div class="df-figures">
        <span>USED {{ df ? humanBytes(df.usedBytes) : '—' }}</span>
        <span>FREE {{ df ? humanBytes(df.freeBytes) : '—' }}</span>
        <span>TOTAL {{ df ? humanBytes(df.totalBytes) : '—' }}</span>
        <span class="text-muted">ROOT {{ df ? df.root : '—' }}</span>
      </div>
      <button class="open-disks" type="button" @click="wm.open('disks')">OPEN DISK MANAGER</button>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { humanBytes } from '@/utils/format'

const store = useAppStore()
const wm = useWindowManager()

async function refresh() {
  store.clearError()
  await Promise.allSettled([
    store.fetchFiles(),
    store.fetchTrashItems(),
    store.fetchOsDf(),
    store.fetchDisks(),
  ])
}

// AGENT-8: the storage dashboard doubles as the volume overview — the merged
// `df` bar grows as providers are attached.
const df = computed(() => store.osDf)
const usedPct = computed(() => {
  const d = df.value
  if (!d || d.totalBytes === 0) return 0
  return Math.min(100, (d.usedBytes / d.totalBytes) * 100)
})

onMounted(() => {
  void refresh()
})

const trashCount = computed(() => store.trashItems.length)

const totalSize = computed(() => store.files.reduce((s, f) => s + f.sizeBytes, 0))

const totalSizeFormatted = computed(() => humanBytes(totalSize.value))

const largestFile = computed(() => {
  if (store.files.length === 0) return '--'
  const biggest = [...store.files].sort((a, b) => b.sizeBytes - a.sizeBytes)[0]
  return `${biggest.name} (${humanBytes(biggest.sizeBytes)})`
})

const avgSizeFormatted = computed(() => {
  if (store.files.length === 0) return '--'
  return humanBytes(Math.round(totalSize.value / store.files.length))
})

const gpsCount = computed(() => store.files.filter(f => f.gpsLat).length)
const faceCount = computed(() => store.files.filter(f => f.faceGroupIds && f.faceGroupIds.length > 0).length)

const byType = computed(() => {
  const groups: Record<string, { totalBytes: number; count: number }> = {}
  for (const f of store.files) {
    const type = f.mimeType?.split('/')[0] || f.fileType || 'unknown'
    if (!groups[type]) groups[type] = { totalBytes: 0, count: 0 }
    groups[type].totalBytes += f.sizeBytes
    groups[type].count++
  }
  const total = totalSize.value
  const entries = Object.entries(groups).map(([label, data]) => ({
    label: label.toUpperCase(),
    totalBytes: data.totalBytes,
    count: data.count,
    percent: total > 0 ? (data.totalBytes / total) * 100 : 0,
  }))
  entries.sort((a, b) => b.totalBytes - a.totalBytes)
  return entries
})

</script>

<style scoped>
.storage-panel {
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
.icon-storage { font-size: 16px; }
.panel-title { font-size: 14px; font-weight: 800; letter-spacing: 1px; margin: 0; }

.section { margin-bottom: 16px; }

.section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
  margin: 0 0 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.stat-card {
  border: 1px solid var(--ui-border);
  padding: 10px;
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 8px;
  letter-spacing: 0.5px;
}

.type-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9px;
}

.type-label {
  width: 80px;
  flex-shrink: 0;
  font-weight: 700;
}

.type-bar {
  flex: 1;
  height: 10px;
  border: 1px solid var(--ui-border-strong);
  position: relative;
  background: transparent;
}

.type-bar-fill {
  display: block;
  height: 100%;
  background: var(--ui-glass-2);
}

.type-size {
  width: 70px;
  text-align: right;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
}

.info-card {
  border: 1px solid var(--ui-border);
  padding: 10px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  padding: 3px 0;
  border-bottom: 1px solid var(--ui-border);
}

.info-row:last-child {
  border-bottom: none;
}

.info-key { color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.info-value { font-weight: 700; }

.df-bar {
  height: 16px;
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
  border: 1px solid var(--ui-border);
}

.df-used {
  height: 100%;
  background: linear-gradient(90deg, var(--ui-accent), var(--ui-info));
}

.df-figures {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 10px;
  margin-top: 6px;
}

.open-disks {
  margin-top: 8px;
  background: transparent;
  border: 1px solid var(--ui-border-strong);
  color: var(--ui-text);
  font-family: inherit;
  font-size: 10px;
  padding: 4px 8px;
  cursor: pointer;
}

.open-disks:hover {
  background: var(--ui-glass-2);
  color: var(--ui-text);
}

.storage-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 0;
}

.text-muted { color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important; }

@media (prefers-reduced-motion: reduce) {
  .storage-panel .ui-empty,
  .storage-panel .ui-error {
    animation: none;
  }
}
</style>
