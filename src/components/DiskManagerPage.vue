<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// CyberManju OS — disk / volume manager (AGENT-8, item 9)
//
// One merged `df` bar over every `.cybermanju` disk, per-provider cards with
// an adjustable size, and the attach / detach / resize / check controls.
// Disk rows come from AGENT-6's catalog; the merged bar from `/api/os/df`.
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { humanBytes, diskPct } from '@/utils/format'

const store = useAppStore()

const configId = ref('')
const createSizeMb = ref(512)
const passphrase = ref('')
const creating = ref(false)
const resizeTarget = ref<string | null>(null)
const resizeMb = ref(512)
const busyId = ref<string | null>(null)
const note = ref('')

const MIN_MB = 64
const MAX_MB = 8192

const df = computed(() => store.osDf)
const usedPct = computed(() => {
  const d = df.value
  if (!d || d.totalBytes === 0) return 0
  return Math.min(100, (d.usedBytes / d.totalBytes) * 100)
})

async function refresh() {
  await Promise.all([store.fetchDisks(), store.fetchOsDf()])
  if (store.syncConfigs.length === 0) await store.fetchSyncConfigs()
}

async function create() {
  if (!configId.value) {
    note.value = 'create: pick a provider configuration first'
    return
  }
  creating.value = true
  const created = await store.createDisk(configId.value, createSizeMb.value * 1024 * 1024, passphrase.value)
  creating.value = false
  note.value = created ? `created ${created.id}` : ''
  if (created) passphrase.value = ''
}

async function attach(diskId: string) {
  busyId.value = diskId
  await store.attachDisk(diskId, passphrase.value)
  busyId.value = null
}

async function detach(diskId: string) {
  busyId.value = diskId
  await store.detachDisk(diskId)
  busyId.value = null
}

function beginResize(diskId: string, capacityBytes: number) {
  resizeTarget.value = diskId
  resizeMb.value = Math.max(MIN_MB, Math.min(MAX_MB, Math.round(capacityBytes / (1024 * 1024))))
}

async function applyResize(diskId: string) {
  await store.resizeDisk(diskId, resizeMb.value * 1024 * 1024)
  resizeTarget.value = null
}

async function check(diskId: string) {
  busyId.value = diskId
  await store.checkDisk(diskId)
  busyId.value = null
}

onMounted(refresh)
</script>

<template>
  <div class="disk-panel">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-disks"><AppIcon name="solar:ssd-square-bold" /></span>
        <h2 class="panel-title">DISKS &amp; VOLUME</h2>
        <span class="text-muted">{{ df ? `${df.diskCount} DISKS` : '…' }}</span>
      </div>
      <div class="header-right">
        <button class="ghost-btn" type="button" @click="refresh">REFRESH</button>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:layers-bold" :size="13" /> MERGED VOLUME</h3>
      <div class="df-bar" role="img" :aria-label="`Volume ${usedPct.toFixed(1)} percent used`">
        <div class="df-used" :style="{ width: `${usedPct}%` }"></div>
      </div>
      <div class="df-legend">
        <span><i class="dot used"></i>USED {{ humanBytes(df?.usedBytes ?? 0) }}</span>
        <span><i class="dot free"></i>FREE {{ humanBytes(df?.freeBytes ?? 0) }}</span>
        <span>TOTAL {{ humanBytes(df?.totalBytes ?? 0) }}</span>
        <span class="text-muted">ATTACHED {{ humanBytes(df?.attachedBytes ?? 0) }} · SCRATCH {{ humanBytes(df?.scratchBytes ?? 0) }}</span>
      </div>
      <p class="df-root text-muted">root {{ df?.root ?? '—' }}</p>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:add-bold" :size="13" /> CREATE DISK</h3>
      <div class="create-row">
        <label class="field">
          <span class="text-muted">PROVIDER</span>
          <select v-model="configId" class="input" aria-label="Provider configuration">
            <option value="" disabled>select a configuration</option>
            <option v-for="cfg in store.syncConfigs" :key="cfg.id" :value="cfg.id">
              {{ cfg.name || cfg.backendType }} · {{ cfg.id }}
            </option>
          </select>
        </label>
        <label class="field grow">
          <span class="text-muted">SIZE — {{ createSizeMb }} MB</span>
          <input
            v-model.number="createSizeMb"
            class="slider"
            type="range"
            :min="MIN_MB"
            :max="MAX_MB"
            :step="64"
            aria-label="Disk size in megabytes"
          />
        </label>
        <label class="field">
          <span class="text-muted">PASSPHRASE</span>
          <input v-model="passphrase" class="input" type="password" autocomplete="off" aria-label="Passphrase" />
        </label>
        <button class="ghost-btn primary" type="button" :disabled="creating" @click="create">
          {{ creating ? 'CREATING…' : 'CREATE' }}
        </button>
      </div>
      <p v-if="note" class="note">{{ note }}</p>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:ssd-square-bold" :size="13" /> PER-PROVIDER DISKS ({{ store.disks.length }})</h3>

      <div v-if="store.disks.length" class="cards">
        <article v-for="disk in store.disks" :key="disk.id" class="card">
          <header class="card-head">
            <div>
              <span class="card-name">{{ disk.name || disk.id }}</span>
              <span class="card-provider text-muted">{{ disk.provider }}</span>
            </div>
            <span class="health" :class="`health-${disk.health}`">{{ disk.health.toUpperCase() }}</span>
          </header>

          <div class="card-bar">
            <div class="card-used" :style="{ width: `${diskPct(disk.usedBytes, disk.capacityBytes)}%` }"></div>
          </div>
          <div class="card-figures">
            <span>{{ humanBytes(disk.usedBytes) }} / {{ humanBytes(disk.capacityBytes) }}</span>
            <span class="text-muted">{{ diskPct(disk.usedBytes, disk.capacityBytes).toFixed(0) }}% used</span>
          </div>

          <dl class="card-meta">
            <div><dt class="text-muted">STATE</dt><dd>{{ disk.state }}</dd></div>
            <div><dt class="text-muted">CONFIG</dt><dd class="truncate">{{ disk.configId }}</dd></div>
            <div><dt class="text-muted">PATH</dt><dd class="truncate" :title="disk.containerPath">{{ disk.containerPath }}</dd></div>
          </dl>

          <div class="card-actions">
            <button
              v-if="disk.state !== 'attached'"
              class="ghost-btn primary"
              type="button"
              :disabled="busyId === disk.id"
              @click="attach(disk.id)"
            >ATTACH</button>
            <button
              v-else
              class="ghost-btn"
              type="button"
              :disabled="busyId === disk.id"
              @click="detach(disk.id)"
            >DETACH</button>
            <button class="ghost-btn" type="button" @click="beginResize(disk.id, disk.capacityBytes)">RESIZE</button>
            <button class="ghost-btn" type="button" :disabled="busyId === disk.id" @click="check(disk.id)">CHECK</button>
          </div>

          <div v-if="resizeTarget === disk.id" class="resize-row">
            <input
              v-model.number="resizeMb"
              class="slider"
              type="range"
              :min="MIN_MB"
              :max="MAX_MB"
              :step="64"
              :aria-label="`Resize ${disk.name}`"
            />
            <span class="resize-size">{{ resizeMb }} MB</span>
            <button class="ghost-btn primary" type="button" @click="applyResize(disk.id)">APPLY</button>
            <button class="ghost-btn" type="button" @click="resizeTarget = null">CANCEL</button>
          </div>
        </article>
      </div>

      <p v-else class="text-muted empty">
        No disks yet — create one above. Every attached disk grows the merged volume and adds
        provider compute slots to the fan-out pool.
      </p>
    </div>
  </div>
</template>

<style scoped>
.disk-panel {
  height: 100%;
  overflow-y: auto;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 13px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-disks {
  color: var(--ui-accent);
}

.panel-title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 2px;
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  font-family: inherit;
  font-size: 11px;
  padding: 4px 9px;
  cursor: pointer;
}

.ghost-btn:hover:not(:disabled) {
  color: var(--ui-text);
  border-color: var(--ui-border-strong);
}

.ghost-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ghost-btn.primary {
  color: var(--ui-accent);
  border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent);
}

.ghost-btn.primary:hover:not(:disabled) {
  color: var(--ui-text);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.ghost-btn.danger {
  color: var(--ui-danger);
  border-color: color-mix(in srgb, var(--ui-danger) 55%, transparent);
}

.ghost-btn.danger:hover:not(:disabled) {
  color: var(--ui-text);
  background: var(--ui-danger);
  border-color: var(--ui-danger);
}

.section {
  padding: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.section-title {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 1.5px;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
}

.df-bar {
  height: 18px;
  background: color-mix(in srgb, var(--ui-text) 10%, transparent);
  border: 1px solid var(--ui-border);
}

.df-used {
  height: 100%;
  background: linear-gradient(90deg, var(--ui-accent), var(--ui-info));
}

.df-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  font-size: 11px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
}

.dot.used {
  background: var(--ui-accent);
}

.dot.free {
  background: color-mix(in srgb, var(--ui-text) 30%, transparent);
}

.df-root {
  margin: 6px 0 0;
  font-size: 11px;
}

.create-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  min-width: 160px;
}

.field.grow {
  flex: 1;
  min-width: 200px;
}

.input {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 6px;
  outline: none;
}

.input:focus {
  border-color: var(--ui-accent);
}

.slider {
  width: 100%;
  accent-color: var(--ui-accent);
}

.note {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ui-info);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.card {
  border: 1px solid var(--ui-border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.card-name {
  display: block;
  font-size: 13px;
}

.card-provider {
  font-size: 11px;
}

.health {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid currentColor;
}

.health-ok {
  color: var(--ui-accent);
}

.health-degraded,
.health-repairing {
  color: var(--ui-warning);
}

.health-failed {
  color: var(--ui-danger);
}

.card-bar {
  height: 10px;
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
}

.card-used {
  height: 100%;
  background: var(--ui-accent);
}

.card-figures {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.card-meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}

.card-meta div {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.card-meta dt {
  width: 52px;
  flex: 0 0 auto;
}

.card-meta dd {
  margin: 0;
  min-width: 0;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.resize-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.resize-size {
  font-size: 11px;
  white-space: nowrap;
}

.empty {
  margin: 0;
  font-size: 12px;
}

.text-muted {
  color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important;
}
</style>
