<!-- CyberManju OS — FileTooltip (src/components/FileTooltip.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <Teleport to="body">
    <div
      v-if="file && visible"
      class="file-tooltip"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <div class="tt-header">
        <span class="tt-icon"><AppIcon :name="icon" :size="14" /></span>
        <span class="tt-name truncate">{{ file.name }}</span>
      </div>
      <div class="tt-meta">
        <div class="tt-row"><span class="tt-label">SIZE</span><span>{{ humanBytes(file.sizeBytes) }}</span></div>
        <div class="tt-row"><span class="tt-label">TYPE</span><span>{{ file.mimeType || (file.fileType === 'folder' ? 'FOLDER' : 'FILE') }}</span></div>
        <div class="tt-row"><span class="tt-label">MODIFIED</span><span>{{ formatDate(file.modifiedAt) }}</span></div>
        <div class="tt-row" v-if="file.hashBlake3"><span class="tt-label">BLAKE3</span><span class="tt-hash">{{ file.hashBlake3.substring(0, 16) }}..</span></div>
      </div>
      <div class="tt-badges" v-if="file.encrypted || (file.compressionLayers && file.compressionLayers[0] && file.compressionLayers[0] !== 'none') || file.gpsLat || file.isStarred">
        <span v-if="file.encrypted" class="tt-badge">ENC {{ file.encryptionAlgorithm || '' }}</span>
        <span v-if="file.compressionLayers && file.compressionLayers[0] && file.compressionLayers[0] !== 'none'" class="tt-badge">CMP {{ file.compressionLayers.join('+') }}</span>
        <span v-if="file.isStarred" class="tt-badge">STARRED</span>
        <span v-if="file.gpsLat" class="tt-badge">GPS</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import type { FileNode } from '@/types'
import { humanBytes } from '@/utils/format'

defineProps<{
  file: FileNode | null
  visible: boolean
  x: number
  y: number
}>()

function formatDate(dateStr: string): string {
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getIcon(file: FileNode): string {
  if (file.fileType === 'folder') return 'solar:folder-bold'
  if (file.encrypted) return 'solar:lock-bold'
  if (file.compressionLayers && file.compressionLayers[0] && file.compressionLayers[0] !== 'none') return 'solar:archive-bold'
  if (file.mimeType?.startsWith('image/')) return 'solar:gallery-bold'
  if (file.mimeType?.startsWith('text/') || file.mimeType?.includes('json') || file.mimeType?.includes('xml')) return 'solar:file-text-bold'
  return 'solar:file-bold'
}

const icon = getIcon
</script>

<style scoped>.file-tooltip {
  position: fixed;
  z-index: 1000;
  background: var(--ui-glass-2);
  border: 1px solid var(--ui-border);
  padding: 10px 12px;
  min-width: 200px;
  max-width: 280px;
  pointer-events: none;
  font-family: var(--ui-font);
  color: var(--ui-text);
  transform: translate(12px, -50%);
  box-shadow: var(--ui-shadow-3);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  border-radius: var(--ui-radius-md);
}

.tt-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--ui-border);
}

.tt-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tt-name {
  font-size: 11px;
  font-weight: 700;
}

.tt-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 6px;
}

.tt-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 9px;
}

.tt-label {
  color: color-mix(in srgb, var(--ui-text) 40%, transparent);
  flex-shrink: 0;
}

.tt-hash {
  font-size: 8px;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
}

.tt-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--ui-border);
}

.tt-badge {
  font-size: 8px;
  font-weight: 700;
  border: 1px solid var(--ui-border-strong);
  padding: 1px 4px;
}
</style>
