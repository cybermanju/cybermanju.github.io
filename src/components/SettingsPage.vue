<template>
  <div class="st">
    <!-- ── header (same visual language as Accounts) ─────────── -->
    <header class="st-top">
      <div class="st-brand">
        <span class="st-brand-mark"><AppIcon name="solar:settings-bold" :size="20" /></span>
        <div>
          <h2 class="st-title">Settings</h2>
          <p class="st-subtitle">Workspace preferences · connection · OAuth broker</p>
        </div>
      </div>
      <div class="st-top-actions">
        <UiBadge :label="transportShort" :tone="transportTone" icon="solar:server-bold" />
        <UiButton size="sm" icon="solar:restart-bold" @click="handleRefresh">Refresh</UiButton>
      </div>
    </header>

    <!-- ── connection hero ───────────────────────────────────── -->
    <section class="st-hero" aria-label="Connection summary">
      <div class="st-hero-row">
        <div class="st-hero-stat">
          <span class="st-hero-label">Connection</span>
          <strong class="st-hero-value">{{ activeTransport }}</strong>
        </div>
        <div class="st-hero-stat right">
          <span class="st-hero-label">Broker</span>
          <strong class="st-hero-value">
            <UiBadge
              :label="supabaseConfiguredNow ? 'Broker ready' : 'Broker not set'"
              :tone="supabaseConfiguredNow ? 'success' : 'warning'"
              :dot="true"
            />
          </strong>
        </div>
      </div>
      <div class="st-hero-legend">
        <span class="st-mono">{{ effectiveApiUrl }}</span>
        <span>Static build + your own server = full OAuth, sync + quota here.</span>
      </div>
    </section>

    <main class="st-body">
      <!-- ── appearance ── -->
      <UiCard title="Appearance" icon="solar:monitor-bold" meta="View">
        <div class="st-row">
          <UiText as="span" variant="label" tone="muted">Default view</UiText>
          <UiSelect
            :model-value="store.viewMode"
            :options="['grid', 'list', 'masonry']"
            aria-label="Default view"
            @update:model-value="store.viewMode = $event as 'grid' | 'list' | 'masonry'"
          />
        </div>
        <div class="st-row">
          <UiText as="span" variant="label" tone="muted">Matrix rain</UiText>
          <UiToggle v-model="store.matrixRainEnabled" aria-label="Matrix rain" />
        </div>
        <div class="st-row">
          <UiText as="span" variant="label" tone="muted">Sidebar expanded</UiText>
          <UiToggle
            :model-value="!store.sidebarCollapsed"
            aria-label="Sidebar expanded"
            @update:model-value="store.sidebarCollapsed = !$event"
          />
        </div>
      </UiCard>

      <!-- ── remote dashboard ── -->
      <UiCard title="Remote dashboard" icon="solar:server-bold" meta="Connection">
        <div class="st-field-row">
          <UiInput
            v-model="serverUrlDraft"
            label="Dashboard URL"
            placeholder="https://my-server:3456 (empty = auto)"
            hint="Static build + your own server = full OAuth, sync + quota. Page reloads to reconnect."
            prefix-icon="solar:link-bold"
            clearable
            @enter="saveServerUrl"
          />
          <div class="st-actions">
            <UiButton variant="primary" size="sm" icon="solar:diskette-bold" @click="saveServerUrl">Save</UiButton>
            <UiButton v-if="serverUrlDraft || currentServerUrl" size="sm" icon="solar:close-bold" @click="clearServerUrl">Forget</UiButton>
          </div>
        </div>
      </UiCard>

      <!-- ── supabase broker ── -->
      <UiCard title="OAuth broker" icon="solar:key-bold" meta="Supabase" :accent="!supabaseConfiguredNow">
        <template #actions>
          <UiBadge :label="supabaseStatus" :tone="supabaseConfiguredNow ? 'success' : 'warning'" :dot="true" />
        </template>
        <div class="st-stack">
          <UiInput
            v-model="supabaseUrlDraft"
            label="Project URL"
            placeholder="https://xyzcompany.supabase.co"
            prefix-icon="solar:link-bold"
            autocomplete="off"
            clearable
          />
          <div class="st-field-row">
            <UiInput
              v-model="supabaseKeyDraft"
              label="Anon / publishable key"
              type="password"
              placeholder="sb_publishable_… or eyJ…"
              prefix-icon="solar:lock-bold"
              autocomplete="off"
            />
            <div class="st-actions">
              <UiButton variant="primary" size="sm" icon="solar:diskette-bold" @click="saveSupabase">Save</UiButton>
              <UiButton v-if="supabaseConfiguredNow" size="sm" icon="solar:close-bold" @click="clearSupabase">Forget</UiButton>
            </div>
          </div>
          <UiText as="p" variant="small" tone="muted">
            Static-build OAuth broker: GitHub / Google / GitLab login without your own server.
            Enable the providers in Supabase → Authentication → Sign-in, and add this page's URL to redirect URLs.
          </UiText>
          <div v-if="!supabaseConfiguredNow" class="st-banner warn">
            <AppIcon name="solar:info-circle-bold" :size="15" />
            <span>Accounts sign-in and provider OAuth need this broker. Paste the URL + key, then enable providers in Supabase.</span>
          </div>
        </div>
      </UiCard>

      <!-- ── auto-refresh + data ── -->
      <UiCard title="Sync behaviour" icon="solar:refresh-bold" meta="Refresh">
        <div class="st-row">
          <UiText as="span" variant="label" tone="muted">Auto-refresh</UiText>
          <UiSelect
            :model-value="String(store.autoRefreshInterval)"
            :options="REFRESH_OPTIONS"
            aria-label="Auto-refresh interval"
            @update:model-value="store.autoRefreshInterval = Number($event)"
          />
        </div>
        <UiDivider spaced />
        <UiButton block icon="solar:refresh-bold" @click="handleRefresh">Refresh all data</UiButton>
        <UiText as="p" variant="small" tone="muted">Re-fetch files, accounts, collections, face groups and sync configs.</UiText>
      </UiCard>

      <!-- ── gestures ── -->
      <UiCard v-if="touchConfig" title="Gestures" icon="solar:cursor-square-bold" :meta="touchMeta">
        <UiText as="p" variant="small" tone="muted">
          Device: {{ touchConfig.state.touchSupported ? 'touch enabled' : 'no touch' }} ·
          {{ touchConfig.state.isMobile ? 'mobile' : 'desktop' }}
        </UiText>
        <div class="st-table" role="table" aria-label="Gesture bindings">
          <div v-for="gesture in touchConfig.getAllGestures()" :key="gesture" class="st-table-row" role="row">
            <UiText as="span" variant="small" tone="muted" truncate>{{ touchConfig.getGestureLabel(gesture) }}</UiText>
            <UiSelect
              :model-value="touchConfig.getAction(gesture)"
              :options="touchConfig.getAllActions().map(a => ({ label: touchConfig.getActionLabel(a), value: a }))"
              :aria-label="`Action for ${touchConfig.getGestureLabel(gesture)}`"
              @update:model-value="onGestureChange(gesture, $event)"
            />
            <UiButton size="xs" icon="solar:undo-left-round-bold" aria-label="Reset gesture" @click="onGestureReset(gesture)" />
          </div>
        </div>
        <div class="st-grid-2">
          <UiInput
            :model-value="String(touchConfig.state.threshold)"
            label="Swipe threshold"
            type="number"
            @update:model-value="touchConfig.state.threshold = Number($event)"
          />
          <UiInput
            :model-value="String(touchConfig.state.longPressThreshold)"
            label="Long press (ms)"
            type="number"
            @update:model-value="touchConfig.state.longPressThreshold = Number($event)"
          />
          <UiInput
            :model-value="String(touchConfig.state.edgeZoneSize)"
            label="Edge zone (px)"
            type="number"
            @update:model-value="touchConfig.state.edgeZoneSize = Number($event)"
          />
          <UiInput
            :model-value="String(touchConfig.state.doubleTapTimeout)"
            label="Double tap (ms)"
            type="number"
            @update:model-value="touchConfig.state.doubleTapTimeout = Number($event)"
          />
        </div>
        <div class="st-actions wrap">
          <UiButton size="sm" icon="solar:undo-left-round-bold" @click="touchConfig.resetAll()">Reset all</UiButton>
          <UiButton size="sm" icon="solar:download-bold" @click="exportTouchConfig">Export</UiButton>
          <UiButton size="sm" icon="solar:upload-bold" @click="importTouchConfig">Import</UiButton>
        </div>
        <input ref="touchImportRef" type="file" accept=".json" class="st-hidden" @change="handleTouchImport" />
      </UiCard>

      <!-- ── keyboard ── -->
      <UiCard v-if="shortcuts" title="Keyboard bindings" icon="solar:keyboard-bold" :meta="`${shortcuts.getAllShortcuts().length} bindings`">
        <UiText as="p" variant="small" tone="muted">
          {{ isBrowserKeys ? 'Browser tab: Ctrl+T / Ctrl+W / Ctrl+Tab never reach the page — Alt+ fallbacks are listed.' : 'Tauri desktop: every binding fires, including Ctrl+T / Ctrl+W.' }}
          Window layout lives under WINDOWS / WORKSPACE · LAYOUT.
        </UiText>
        <div class="st-table st-table--keys" role="table" aria-label="Keyboard bindings">
          <div v-for="sc in shortcuts.getAllShortcuts()" :key="sc.action" class="st-table-row" role="row">
            <UiText as="span" variant="small" tone="muted" truncate>{{ sc.description }}</UiText>
            <input
              class="st-key-input"
              :value="getBindingDisplay(sc.action)"
              :placeholder="sc.keys"
              :aria-label="`Shortcut for ${sc.description}`"
              readonly
              @focus="startRebind(sc.action, $event)"
              @keydown="captureRebind($event)"
            />
            <span v-if="sc.blockedInBrowser" class="st-key-fb" :title="`Browser fallback: ${sc.fallback}`">→ {{ sc.fallback }}</span>
            <UiButton size="xs" icon="solar:undo-left-round-bold" aria-label="Reset to default" @click="resetBinding(sc.action)" />
          </div>
        </div>
        <div class="st-actions wrap">
          <UiButton size="sm" icon="solar:download-bold" @click="exportKeymap">Export</UiButton>
          <UiButton size="sm" icon="solar:upload-bold" @click="importKeymap">Import</UiButton>
          <UiButton size="sm" icon="solar:undo-left-round-bold" @click="resetAllBindings">Reset all</UiButton>
        </div>
        <input ref="importInputRef" type="file" accept=".kpl,.kpd,.json" class="st-hidden" @change="handleImportFile" />
      </UiCard>

      <!-- ── about ── -->
      <UiCard title="About" icon="solar:info-circle-bold" meta="0.1.0">
        <dl class="st-info">
          <div class="st-info-row"><dt>Version</dt><dd>0.1.0</dd></div>
          <div class="st-info-row"><dt>Framework</dt><dd>Vue 3 + Pinia</dd></div>
          <div class="st-info-row"><dt>Desktop</dt><dd>Tauri v2</dd></div>
          <div class="st-info-row"><dt>Search</dt><dd>Tantivy BM25</dd></div>
          <div class="st-info-row"><dt>Encryption</dt><dd>RustPQ (PQC)</dd></div>
          <div class="st-info-row"><dt>Database</dt><dd>redb</dd></div>
        </dl>
      </UiCard>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, inject, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { isWebMode, isTauri, getServerUrl, setServerUrl } from '@/composables/useTauri'
import {
  getSupabaseConfig,
  setSupabaseConfig,
  clearSupabaseConfig,
  supabaseConfigured,
  supabaseSignOut,
} from '@/composables/useSupabase'
import { wasmBackendActive } from '@/composables/useWasmBackend'
import { ShortcutsKey } from '@/composables/shortcutsKey'
import { useTouchConfig, type GestureType, type TouchAction } from '@/composables/useTouchConfig'

/** Active transport: tauri IPC, REST dashboard, or local WASM (GitHub Pages). */
const activeTransport = computed(() => {
  if (import.meta.env.VITE_TRANSPORT) return String(import.meta.env.VITE_TRANSPORT).toUpperCase()
  if (isTauri()) return 'Tauri desktop (REST-first: os/disk via :3456)'
  if (wasmBackendActive()) return 'WASM local (Pages)'
  if (isWebMode()) return 'Web / REST (:3456)'
  return 'Unknown'
})

const transportShort = computed(() => {
  if (isTauri()) return 'Tauri'
  if (wasmBackendActive()) return 'WASM'
  if (isWebMode()) return 'Web'
  return 'Unknown'
})

const transportTone = computed<'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'>(() => {
  if (isTauri()) return 'accent'
  if (wasmBackendActive()) return 'info'
  return 'neutral'
})

const store = useAppStore()
const shortcuts = inject(ShortcutsKey, null)
const isBrowserKeys = computed(() => typeof window !== 'undefined' && !('__TAURI__' in window))
const touchConfig = useTouchConfig()
const touchMeta = computed(() =>
  touchConfig.state.touchSupported ? (touchConfig.state.isMobile ? 'Touch · mobile' : 'Touch · desktop') : 'No touch',
)

const REFRESH_OPTIONS = [
  { label: 'Disabled', value: '0' },
  { label: 'Every 10 seconds', value: '10' },
  { label: 'Every 30 seconds', value: '30' },
  { label: 'Every minute', value: '60' },
  { label: 'Every 5 minutes', value: '300' },
]

const currentServerUrl = computed(() => getServerUrl())
const serverUrlDraft = ref(getServerUrl())
const effectiveApiUrl = computed(() => {
  if (currentServerUrl.value) return currentServerUrl.value.toUpperCase()
  if (isTauri()) return 'TAURI IPC + HTTP://LOCALHOST:3456'
  return 'HTTP://LOCALHOST:3456'
})

function saveServerUrl() {
  setServerUrl(serverUrlDraft.value.trim())
  window.location.reload()
}

function clearServerUrl() {
  serverUrlDraft.value = ''
  setServerUrl('')
  window.location.reload()
}

const supabaseUrlDraft = ref(getSupabaseConfig().url)
const supabaseKeyDraft = ref('')
const supabaseConfiguredNow = computed(() => supabaseConfigured())
const supabaseStatus = computed(() =>
  supabaseConfiguredNow.value ? `Configured (${getSupabaseConfig().url})` : 'Not configured',
)

function saveSupabase() {
  if (!supabaseUrlDraft.value.trim() || !supabaseKeyDraft.value.trim()) return
  setSupabaseConfig(supabaseUrlDraft.value, supabaseKeyDraft.value)
  supabaseKeyDraft.value = ''
}

async function clearSupabase() {
  await supabaseSignOut().catch(() => {})
  clearSupabaseConfig()
  supabaseUrlDraft.value = ''
}

const rebindInputs: Record<string, HTMLInputElement> = {}
const rebindingAction = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)

function getBindingDisplay(action: string): string {
  return shortcuts?.getShortcut(action)?.replace(/,/g, ', ') || ''
}

function startRebind(action: string, e: FocusEvent) {
  rebindingAction.value = action
  const input = e.target as HTMLInputElement
  input.value = 'Press keys…'
  input.select()
}

function captureRebind(e: KeyboardEvent) {
  if (!rebindingAction.value) return
  e.preventDefault()
  e.stopPropagation()
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  if (parts.length === 0) return
  const seq = parts.join('+')
  const el = rebindInputs[rebindingAction.value]
  if (el) el.value = seq
  saveOverride(rebindingAction.value, seq)
  rebindingAction.value = null
  ;(e.target as HTMLInputElement).blur()
}

function saveOverride(action: string, keys: string) {
  try {
    const raw = localStorage.getItem('cybermanju_keybindings')
    const overrides = raw ? JSON.parse(raw) : {}
    overrides[action] = keys
    localStorage.setItem('cybermanju_keybindings', JSON.stringify(overrides))
    window.location.reload()
  } catch {}
}

function resetBinding(action: string) {
  try {
    const raw = localStorage.getItem('cybermanju_keybindings')
    const overrides = raw ? JSON.parse(raw) : {}
    delete overrides[action]
    localStorage.setItem('cybermanju_keybindings', JSON.stringify(overrides))
    window.location.reload()
  } catch {}
}

function resetAllBindings() {
  localStorage.removeItem('cybermanju_keybindings')
  window.location.reload()
}

function exportKeymap() {
  const all = shortcuts?.getAllShortcuts() || []
  const lines = ['[Global]', 'name=Cybermanju Exported', 'version=1.0', 'description=Exported from Settings', '']
  lines.push('[Global Shortcuts]')
  for (const s of all) {
    const keys = shortcuts?.getShortcut(s.action) || s.keys
    lines.push(`${s.action}=${keys.replace(/,\s*/g, ',')}`)
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'cybermanju-shortcuts.kpl'
  a.click()
  URL.revokeObjectURL(url)
}

function importKeymap() {
  importInputRef.value?.click()
}

function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    try {
      const parsed = JSON.parse(text)
      localStorage.setItem('cybermanju_keybindings', JSON.stringify(parsed))
      window.location.reload()
    } catch {
      const overrides: Record<string, string> = {}
      for (const line of text.split('\n')) {
        const eqIdx = line.indexOf('=')
        if (eqIdx === -1 || line.startsWith('[') || line.startsWith('#') || line.startsWith(';')) continue
        const key = line.slice(0, eqIdx).trim()
        const val = line.slice(eqIdx + 1).trim()
        if (key && val) overrides[key] = val
      }
      localStorage.setItem('cybermanju_keybindings', JSON.stringify(overrides))
      window.location.reload()
    }
  }
  reader.readAsText(file)
}

const touchImportRef = ref<HTMLInputElement | null>(null)

function onGestureChange(gesture: GestureType, action: string) {
  touchConfig.setAction(gesture, action as TouchAction)
}

function onGestureReset(gesture: GestureType) {
  touchConfig.resetGesture(gesture)
}

function exportTouchConfig() {
  const json = touchConfig.exportConfig()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'cybermanju-touch-config.json'
  a.click()
  URL.revokeObjectURL(url)
}

function importTouchConfig() {
  touchImportRef.value?.click()
}

function handleTouchImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    if (touchConfig.importConfig(text)) {
      window.location.reload()
    }
  }
  reader.readAsText(file)
}

async function handleRefresh() {
  await Promise.allSettled([
    store.fetchFiles(),
    store.fetchAccounts(),
    store.fetchCollections(),
    store.fetchFaceGroups(),
    store.fetchLooseGroups(),
    store.fetchEncryptionStatus(),
    store.fetchSyncConfigs(),
  ])
}
</script>

<style scoped>
.st {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 13px;
}

/* header — mirrors Accounts */
.st-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.st-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.st-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
  color: var(--ui-accent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent);
  flex-shrink: 0;
}
.st-title { margin: 0; font-size: 15px; letter-spacing: 0.4px; }
.st-subtitle { margin: 1px 0 0; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.st-top-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* hero — mirrors Accounts */
.st-hero {
  margin: 12px 14px 0;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--ui-text) 3%, transparent);
}
.st-hero-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.st-hero-stat { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.st-hero-stat.right { text-align: right; align-items: flex-end; }
.st-hero-label { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.st-hero-value { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.st-hero-legend { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 60%, transparent); }
.st-mono { font-family: var(--ui-font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* body */
.st-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
}
.st-row + .st-row { border-top: 1px dashed var(--ui-hairline); }
.st-stack { display: flex; flex-direction: column; gap: 10px; }
.st-field-row { display: flex; gap: 8px; align-items: flex-start; }
.st-field-row > :first-child { flex: 1; min-width: 0; }
.st-actions { display: flex; gap: 6px; flex-shrink: 0; padding-top: 22px; }
.st-actions.wrap { flex-wrap: wrap; padding-top: 0; }
.st-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid;
}
.st-banner.warn {
  border-color: color-mix(in srgb, var(--ui-warning) 55%, transparent);
  background: color-mix(in srgb, var(--ui-warning) 10%, transparent);
}
.st-grid-2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.st-table {
  border: 1px solid var(--ui-hairline);
  border-radius: 10px;
  overflow: hidden;
  max-height: 280px;
  overflow-y: auto;
}
.st-table-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ui-hairline);
}
.st-table-row:last-child { border-bottom: none; }
.st-table--keys .st-table-row { grid-template-columns: 1fr 140px auto auto; }
.st-key-fb {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  color: var(--ui-warning);
  white-space: nowrap;
}
.st-key-input {
  width: 140px;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 11px;
  padding: 6px 8px;
  text-align: center;
  cursor: pointer;
  outline: none;
}
.st-key-input:focus {
  border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 14%, transparent);
}
.st-info { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.st-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.st-info-row dt { color: color-mix(in srgb, var(--ui-text) 55%, transparent); text-transform: uppercase; letter-spacing: 0.8px; font-size: 10px; }
.st-info-row dd { margin: 0; font-weight: 700; }
.st-hidden { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

@media (max-width: 560px) {
  .st-top { flex-wrap: wrap; }
  .st-hero-legend { flex-direction: column; gap: 4px; }
  .st-field-row { flex-direction: column; }
  .st-field-row > :first-child { width: 100%; }
  .st-actions { padding-top: 0; }
  .st-table--keys .st-table-row { grid-template-columns: 1fr; }
  .st-key-input { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .st-top-actions, .st-hero, .st-body { transition: none; }
}
</style>
