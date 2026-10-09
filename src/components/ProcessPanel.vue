<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// CyberManju OS — process table (AGENT-8, item 10)
//
// Fed by `GET /api/os/ps` and `GET /api/os/top`; every control goes through
// the same syscall boundary the terminal uses (`kill <id>`, `compute run …`).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { humanBytes } from '@/utils/format'
import type { OsTask } from '@/types'

const store = useAppStore()
const refreshMs = 2000
let timer = 0

const jobPath = ref('/')
const starting = ref(false)
const note = ref('')

const tasks = computed<OsTask[]>(() => store.osPs?.tasks ?? store.osTop?.tasks ?? [])
const counts = computed(() => store.osTop?.counts ?? store.osPs?.counts ?? null)
const load = computed(() => store.osTop?.load ?? null)
const mem = computed(() => store.osTop?.mem ?? null)

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h${m}m` : m > 0 ? `${m}m${s}s` : `${s}s`
}

function pct(task: OsTask): number {
  return Math.max(0, Math.min(100, Math.round(task.progress * 100)))
}

function kill(task: OsTask) {
  void store.killOsTask(task.id)
}

async function startJob(job: string) {
  starting.value = true
  const result = await store.runComputeJob(job, jobPath.value || '/')
  starting.value = false
  note.value = result.output
}

async function refresh() {
  await Promise.all([store.fetchOsPs(), store.fetchOsTop(), store.fetchOsWorkers()])
}

onMounted(() => {
  void refresh()
  if (store.osJobs.length === 0) void store.fetchOsJobs()
  timer = window.setInterval(() => {
    void refresh()
  }, refreshMs)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="process-panel">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-processes"><AppIcon name="solar:cpu-bold" /></span>
        <h2 class="panel-title">Tasks</h2>
        <span class="text-muted">{{ counts ? `${counts.running} running / ${counts.total} total` : '…' }}</span>
      </div>
      <div class="header-right">
        <button class="ghost-btn" type="button" @click="refresh">Refresh</button>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat">
        <span class="stat-key">LOAD</span>
        <span class="stat-val">
          {{ load && load.source === 'proc' ? `${load.load1} ${load.load5} ${load.load15}` : 'n/a' }}
        </span>
      </div>
      <div class="stat">
        <span class="stat-key">CPU</span>
        <span class="stat-val">{{ store.osTop ? `${store.osTop.cpuPercent.toFixed(1)}%` : 'n/a' }}</span>
      </div>
      <div class="stat">
        <span class="stat-key">RSS</span>
        <span class="stat-val">{{ mem ? humanBytes(mem.rssBytes) : '—' }}</span>
      </div>
      <div class="stat">
        <span class="stat-key">UP</span>
        <span class="stat-val">{{ store.osTop ? clock(store.osTop.uptimeMs) : '—' }}</span>
      </div>
      <div class="stat">
        <span class="stat-key">WORKERS</span>
        <span class="stat-val">
          {{ store.osWorkers ? `${store.osWorkers.total} (${store.osWorkers.localThreads} local + ${store.osWorkers.providerSlots} provider)` : '—' }}
        </span>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:cpu-bold" :size="13" /> Process table</h3>
      <table v-if="tasks.length" class="task-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>Kind</th>
            <th>Name</th>
            <th>State</th>
            <th>Progress</th>
            <th>Provider</th>
            <th>Bytes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td data-label="PID">{{ task.id }}</td>
            <td data-label="Kind">{{ task.kind }}</td>
            <td data-label="Name" class="truncate name-cell" :title="task.name">{{ task.name }}</td>
            <td data-label="State">
              <span class="state" :class="`state-${task.state}`">{{ task.state }}</span>
            </td>
            <td data-label="Progress" class="progress-cell">
              <span class="bar"><span class="bar-fill" :style="{ width: `${pct(task)}%` }"></span></span>
              <span class="pct">{{ pct(task) }}%</span>
            </td>
            <td data-label="Provider">{{ task.provider }}</td>
            <td data-label="Bytes">{{ humanBytes(task.bytes) }}</td>
            <td class="task-action">
              <button
                v-if="task.state === 'running' || task.state === 'pending'"
                class="ghost-btn danger"
                type="button"
                :aria-label="`Kill task ${task.id}`"
                @click="kill(task)"
              >Kill</button>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="text-muted empty">No tasks yet — start one below, or run `compute run …` in cybsh.</p>
    </div>

    <div class="section">
      <h3 class="section-title"><AppIcon name="solar:server-square-bold" :size="13" /> Compute jobs</h3>
      <div class="jobs">
        <div v-for="job in store.osJobs" :key="job.name" class="job">
          <div class="job-info">
            <span class="job-name">{{ job.name }}</span>
            <span class="text-muted">{{ job.description }}</span>
          </div>
          <button
            class="ghost-btn"
            type="button"
            :disabled="starting"
            :aria-label="`Run ${job.name}`"
            @click="startJob(job.name)"
          >Run</button>
        </div>
        <p v-if="!store.osJobs.length" class="text-muted empty">Catalogue not loaded.</p>
      </div>
      <label class="path-row">
        <span class="text-muted">Path</span>
        <input v-model="jobPath" class="path-input" type="text" spellcheck="false" aria-label="Job path" />
      </label>
      <p v-if="note" class="note">{{ note }}</p>
    </div>
  </div>
</template>

<style scoped>
.process-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
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

.icon-processes {
  color: var(--ui-info);
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
  padding: 3px 8px;
  cursor: pointer;
  min-height: 32px;
}

.ghost-btn:hover:not(:disabled) {
  color: var(--ui-text);
  border-color: var(--ui-border-strong);
}

.ghost-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ghost-btn.danger {
  color: var(--ui-danger);
  border-color: color-mix(in srgb, var(--ui-danger) 60%, transparent);
}

.ghost-btn.danger:hover {
  color: var(--ui-text);
  background: var(--ui-danger);
  border-color: var(--ui-danger);
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-key {
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-text-2);
  letter-spacing: 0;
  text-transform: lowercase;
}

.stat-key::first-letter {
  text-transform: uppercase;
}

.stat-val {
  font-size: 13px;
}

.section {
  padding: 12px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ui-text-2);
}

.task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

/* Activity-Monitor style: 11px/600 secondary headers, zebra rows. */
.task-table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ui-text-2);
  border-bottom: 1px solid var(--ui-separator);
  padding: 4px 6px;
}

.task-table td {
  padding: 5px 6px;
  border-bottom: 1px solid var(--ui-hairline);
  vertical-align: middle;
}

.task-table tbody tr:nth-child(even):not(.sel) {
  background: color-mix(in srgb, var(--ui-text) 3%, transparent);
}

.task-action {
  text-align: right;
}

.name-cell {
  max-width: 220px;
}

.state {
  font-size: 11px;
}

.state-running {
  color: var(--ui-accent);
}

.state-pending {
  color: var(--ui-warning);
}

.state-done {
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
}

.state-failed {
  color: var(--ui-danger);
}

.state-killed {
  color: var(--ui-info);
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bar {
  display: inline-block;
  width: 80px;
  height: 8px;
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--ui-accent);
}

.pct {
  font-size: 11px;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
}

.jobs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.job {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--ui-border);
  padding: 6px 8px;
}

.job-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.job-name {
  font-size: 12px;
}

.path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.path-input {
  flex: 1;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  font-family: inherit;
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
}

.path-input:focus {
  border-color: var(--ui-accent);
}

.note {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ui-info);
  white-space: pre-wrap;
}

.empty {
  margin: 4px 0 0;
  font-size: 12px;
}

.text-muted {
  color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important;
}

@media (max-width: 700px) {
  .process-panel {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .panel-header {
    gap: 12px;
    padding: 12px 16px;
  }

  .header-left {
    min-width: 0;
    gap: 8px;
  }

  .header-left .text-muted {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-right,
  .header-right .ghost-btn {
    flex: 0 0 auto;
  }

  .ghost-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 12px;
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 12px 16px;
  }

  .stat {
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--ui-text) 3%, transparent);
  }

  .stat-val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section {
    padding: 16px;
  }

  .section-title {
    margin-bottom: 10px;
  }

  .task-table,
  .task-table tbody,
  .task-table tr,
  .task-table td {
    display: block;
    width: auto;
  }

  .task-table thead {
    display: none;
  }

  .task-table tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    margin-bottom: 10px;
    padding: 14px;
    border: 1px solid var(--ui-border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--ui-text) 3%, transparent);
  }

  .task-table tbody tr:nth-child(even):not(.sel) {
    background: color-mix(in srgb, var(--ui-text) 3%, transparent);
  }

  .task-table td {
    min-width: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
  }

  .task-table td::before {
    display: block;
    margin-bottom: 3px;
    color: var(--ui-text-2);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .task-table .name-cell,
  .task-table .progress-cell,
  .task-table .task-action {
    grid-column: 1 / -1;
  }

  .task-table .name-cell {
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-table .progress-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .task-table .progress-cell::before {
    flex: 0 0 auto;
  }

  .task-table .bar {
    flex: 1;
    min-width: 0;
    width: auto;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
  }

  .task-table .bar-fill {
    border-radius: inherit;
  }

  .task-table .task-action {
    display: flex;
    justify-content: flex-end;
    min-height: 44px;
  }

  .task-table .task-action::before {
    display: none;
  }

  .task-table .task-action .ghost-btn {
    min-width: 72px;
  }

  .job {
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    border-radius: 14px;
  }

  .job .ghost-btn {
    flex: 0 0 auto;
  }

  .path-row {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .path-input {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .process-panel * {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
