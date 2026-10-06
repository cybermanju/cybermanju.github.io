<template>
  <div class="st">
    <!-- ── header (same visual language as Accounts) ─────────── -->
    <header class="st-top">
      <div class="st-brand">
        <span class="st-brand-mark"><AppIcon name="solar:settings-bold" :size="20" /></span>
        <div class="st-brand-text">
          <h2 class="st-title">Settings</h2>
          <p class="st-subtitle">Workspace preferences · connection · OAuth broker</p>
        </div>
      </div>
      <div class="st-top-actions">
        <UiBadge :label="transportShort" :tone="transportTone" icon="solar:server-bold" />
        <UiButton size="sm" icon="solar:restart-bold" @click="handleRefresh">Refresh</UiButton>
      </div>
    </header>

    <!-- ── one-line status strip (connection · broker · endpoint) ─ -->
    <section class="st-strip" aria-label="Connection summary">
      <span class="st-strip-k">Connection</span>
      <span class="st-strip-v">{{ activeTransport }}</span>
      <UiBadge
        :label="supabaseConfiguredNow ? 'Broker ready' : 'Broker not set'"
        :tone="supabaseConfiguredNow ? 'success' : 'warning'"
        :dot="true"
      />
      <span class="st-mono st-strip-url">{{ effectiveApiUrl }}</span>
    </section>

    <!-- ── section jump bar (always visible, works in small windows) ─ -->
    <nav class="st-jumps" aria-label="Settings sections">
      <button
        v-for="s in SECTIONS"
        :key="s.id"
        type="button"
        class="st-jump"
        :class="{ 'is-active': activeSection === s.id }"
        :aria-current="activeSection === s.id ? 'true' : undefined"
        @click="scrollToSection(s)"
      >
        {{ s.label }}
      </button>
    </nav>

    <main ref="bodyEl" class="st-body" @scroll.passive="onBodyScroll">
      <!-- ── appearance ── -->
      <UiCard id="st-sec-appearance" title="Appearance" icon="solar:monitor-bold" meta="View">
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
      <UiCard id="st-sec-remote" title="Remote dashboard" icon="solar:server-bold" meta="Connection">
        <div class="st-field-row">
          <UiInput
            v-model="serverUrlDraft"
            label="Dashboard URL"
            placeholder="https://my-server:3456 (empty = auto)"
            prefix-icon="solar:link-bold"
            clearable
            @enter="saveServerUrl"
          />
          <div class="st-actions">
            <UiButton variant="primary" size="sm" icon="solar:diskette-bold" @click="saveServerUrl">Save</UiButton>
            <UiButton v-if="serverUrlDraft || currentServerUrl" size="sm" icon="solar:close-bold" @click="clearServerUrl">Forget</UiButton>
          </div>
        </div>
        <UiText as="p" variant="small" tone="muted">
          Static build + your own server = full OAuth, sync + quota. Page reloads to reconnect.
        </UiText>
      </UiCard>

      <!-- ── supabase broker ── -->
      <UiCard
        id="oauth-broker-card"
        :class="{ 'is-target': focusFlash }"
        title="OAuth broker"
        icon="solar:key-bold"
        meta="Supabase"
        :accent="!supabaseConfiguredNow"
      >
        <template #actions>
          <UiBadge
            :label="supabaseConfiguredNow ? 'Configured' : 'Not configured'"
            :tone="supabaseConfiguredNow ? 'success' : 'warning'"
            :dot="true"
            :title="supabaseUrlDraft || undefined"
          />
        </template>
        <div class="st-stack">
          <UiInput
            v-model="supabaseUrlDraft"
            label="Project URL"
            placeholder="https://xyzcompany.supabase.co"
            prefix-icon="solar:link-bold"
            autocomplete="off"
            clearable
            @update:model-value="brokerMsg = null"
          />
          <div class="st-field-row">
            <UiInput
              v-model="supabaseKeyDraft"
              label="Anon / publishable key"
              type="password"
              :placeholder="supabaseConfiguredNow ? '•••••• — stored, paste to rotate' : 'sb_publishable_… or eyJ…'"
              prefix-icon="solar:lock-bold"
              autocomplete="off"
              clearable
              @update:model-value="brokerMsg = null"
            />
            <div class="st-actions">
              <UiButton variant="primary" size="sm" icon="solar:diskette-bold" @click="saveSupabase">Save</UiButton>
              <UiButton v-if="supabaseConfiguredNow" size="sm" icon="solar:close-bold" @click="clearSupabase">Forget</UiButton>
            </div>
          </div>
          <p v-if="brokerMsg" class="st-feedback" :class="`is-${brokerMsg.tone}`" role="status">{{ brokerMsg.text }}</p>
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
      <UiCard id="st-sec-sync" title="Sync behaviour" icon="solar:refresh-bold" meta="Refresh">
        <div class="st-row">
          <UiText as="span" variant="label" tone="muted">Auto-refresh</UiText>
          <UiSelect
            :model-value="String(store.autoRefreshInterval)"
            :options="REFRESH_OPTIONS"
            aria-label="Auto-refresh interval"
            @update:model-value="store.autoRefreshInterval = Number($event)"
          />
        </div>
        <UiDivider />
        <UiButton block icon="solar:refresh-bold" @click="handleRefresh">Refresh all data</UiButton>
        <UiText as="p" variant="small" tone="muted">Re-fetch files, accounts, collections, face groups and sync configs.</UiText>
      </UiCard>

      <!-- ── gestures ── -->
      <UiCard v-if="touchConfig" id="st-sec-gestures" title="Gestures" icon="solar:cursor-square-bold" :meta="touchMeta">
        <UiText as="p" variant="small" tone="muted">
          Device: {{ touchConfig.state.touchSupported ? 'touch enabled' : 'no touch' }} ·
          {{ touchConfig.state.isMobile ? 'mobile' : 'desktop' }}
        </UiText>
        <div class="st-table st-table--gestures" role="table" aria-label="Gesture bindings">
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
            :min="0"
            :step="1"
            @update:model-value="onThreshold"
          />
          <UiInput
            :model-value="String(touchConfig.state.longPressThreshold)"
            label="Long press (ms)"
            type="number"
            :min="0"
            :step="1"
            @update:model-value="onLongPress"
          />
          <UiInput
            :model-value="String(touchConfig.state.edgeZoneSize)"
            label="Edge zone (px)"
            type="number"
            :min="0"
            :step="1"
            @update:model-value="onEdgeZone"
          />
          <UiInput
            :model-value="String(touchConfig.state.doubleTapTimeout)"
            label="Double tap (ms)"
            type="number"
            :min="0"
            :step="1"
            @update:model-value="onDoubleTap"
          />
        </div>
        <div class="st-actions">
          <UiButton size="sm" icon="solar:undo-left-round-bold" @click="touchConfig.resetAll()">Reset all</UiButton>
          <UiButton size="sm" icon="solar:download-bold" @click="exportTouchConfig">Export</UiButton>
          <UiButton size="sm" icon="solar:upload-bold" @click="importTouchConfig">Import</UiButton>
        </div>
        <input ref="touchImportRef" type="file" accept=".json" class="st-hidden" @change="handleTouchImport" />
      </UiCard>

      <!-- ── keyboard ── -->
      <UiCard v-if="shortcuts" id="st-sec-keys" title="Keyboard bindings" icon="solar:keyboard-bold" :meta="keyMeta">
        <UiText as="p" variant="small" tone="muted">
          {{ isBrowserKeys ? 'Browser tab: Ctrl+T / Ctrl+W / Ctrl+Tab never reach the page — Alt+ fallbacks are listed.' : 'Tauri desktop: every binding fires, including Ctrl+T / Ctrl+W.' }}
          Window layout lives under WINDOWS / WORKSPACE · LAYOUT.
        </UiText>
        <UiInput
          v-model="keyFilter"
          label="Filter bindings"
          placeholder="Action, key or group…"
          prefix-icon="solar:magnifier-bold"
          clearable
        />
        <div class="st-table st-table--keys" role="table" aria-label="Keyboard bindings">
          <div v-for="sc in filteredShortcuts" :key="sc.action" class="st-table-row" role="row">
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
          <p v-if="filteredShortcuts.length === 0" class="st-empty" role="status">
            No binding matches “{{ keyFilter }}”. Clear the filter to see all {{ shortcuts.getAllShortcuts().length }}.
          </p>
        </div>
        <div class="st-actions">
          <UiButton size="sm" icon="solar:download-bold" @click="exportKeymap">Export</UiButton>
          <UiButton size="sm" icon="solar:upload-bold" @click="importKeymap">Import</UiButton>
          <UiButton size="sm" icon="solar:undo-left-round-bold" @click="resetAllBindings">Reset all</UiButton>
        </div>
        <input ref="importInputRef" type="file" accept=".kpl,.kpd,.json" class="st-hidden" @change="handleImportFile" />
      </UiCard>

      <!-- ── about ── -->
      <UiCard id="st-sec-about" title="About" icon="solar:info-circle-bold" meta="0.1.0">
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
import { ref, inject, computed, onMounted, onBeforeUnmount } from 'vue'
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
/** Inline result of the last Save / Forget (clears as soon as a field is edited). */
const brokerMsg = ref<{ text: string; tone: 'ok' | 'err' } | null>(null)

function saveSupabase() {
  const url = supabaseUrlDraft.value.trim()
  const key = supabaseKeyDraft.value.trim()
  if (!url && !key) {
    brokerMsg.value = { text: 'Paste the project URL and the anon / publishable key first.', tone: 'err' }
    return
  }
  if (!url) {
    brokerMsg.value = { text: 'Missing project URL — copy it from Supabase → Project Settings → API.', tone: 'err' }
    return
  }
  if (!url.startsWith('http')) {
    brokerMsg.value = { text: 'Project URL must be a full https://… address.', tone: 'err' }
    return
  }
  if (!key) {
    brokerMsg.value = { text: 'Missing key — paste the anon / publishable (sb_publishable_… or eyJ…) key.', tone: 'err' }
    return
  }
  setSupabaseConfig(url, key)
  supabaseUrlDraft.value = url
  supabaseKeyDraft.value = ''
  brokerMsg.value = { text: 'Broker saved — this window, the Accounts panel and OAuth sign-in pick it up right away.', tone: 'ok' }
  store.notifySuccess('OAuth broker configured')
}

async function clearSupabase() {
  await supabaseSignOut().catch(() => {})
  clearSupabaseConfig()
  supabaseUrlDraft.value = ''
  supabaseKeyDraft.value = ''
  brokerMsg.value = { text: 'Broker forgotten — OAuth sign-in stays off until you save credentials again.', tone: 'ok' }
}

// ── section jump bar + scroll spy ──────────────────────────────
interface Section {
  id: string
  el: string
  label: string
}

const SECTIONS: Section[] = [
  { id: 'appearance', el: 'st-sec-appearance', label: 'Appearance' },
  { id: 'remote', el: 'st-sec-remote', label: 'Dashboard' },
  { id: 'broker', el: 'oauth-broker-card', label: 'Broker' },
  { id: 'sync', el: 'st-sec-sync', label: 'Sync' },
  { id: 'gestures', el: 'st-sec-gestures', label: 'Gestures' },
  { id: 'keys', el: 'st-sec-keys', label: 'Keys' },
  { id: 'about', el: 'st-sec-about', label: 'About' },
]

const bodyEl = ref<HTMLElement | null>(null)
const activeSection = ref<string>('appearance')

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function scrollToSection(s: Section, smooth = true): boolean {
  const el = document.getElementById(s.el)
  if (!el) return false
  activeSection.value = s.id
  el.scrollIntoView({ block: 'start', behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
  return true
}

function onBodyScroll() {
  const body = bodyEl.value
  if (!body) return
  const base = body.getBoundingClientRect().top
  let current = SECTIONS[0].id
  for (const s of SECTIONS) {
    const el = document.getElementById(s.el)
    if (el && el.getBoundingClientRect().top - base <= 56) current = s.id
  }
  activeSection.value = current
}

// ── deep link: Accounts → "Configure" lands on this card ───────
const focusFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null

function focusSection(e: Event) {
  if ((e as CustomEvent<string>).detail !== 'oauth-broker') return
  const broker = SECTIONS.find(s => s.id === 'broker')
  if (!broker || !scrollToSection(broker)) return
  if (flashTimer) clearTimeout(flashTimer)
  focusFlash.value = false
  // Reset first so the glow replays when this card is requested twice.
  requestAnimationFrame(() => {
    focusFlash.value = true
    flashTimer = setTimeout(() => {
      focusFlash.value = false
    }, 2400)
  })
}

onMounted(() => window.addEventListener('cybermanju:settings-focus', focusSection))
onBeforeUnmount(() => {
  window.removeEventListener('cybermanju:settings-focus', focusSection)
  if (flashTimer) clearTimeout(flashTimer)
})

const rebindInputs: Record<string, HTMLInputElement> = {}
const rebindingAction = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)

/** 98 bindings is too many to scan in a small window — filter by action, label or keys. */
const keyFilter = ref('')

const filteredShortcuts = computed(() => {
  const all = shortcuts?.getAllShortcuts() ?? []
  const q = keyFilter.value.trim().toLowerCase()
  if (!q) return all
  return all.filter(sc =>
    sc.description.toLowerCase().includes(q) ||
    sc.action.toLowerCase().includes(q) ||
    sc.group.toLowerCase().includes(q) ||
    sc.keys.toLowerCase().includes(q) ||
    getBindingDisplay(sc.action).toLowerCase().includes(q),
  )
})

const keyMeta = computed(() => {
  const total = shortcuts?.getAllShortcuts().length ?? 0
  const shown = filteredShortcuts.value.length
  return shown === total ? `${total} bindings` : `${shown} of ${total} bindings`
})

function getBindingDisplay(action: string): string {
  return shortcuts?.getShortcut(action)?.replace(/,/g, ', ') || ''
}

function startRebind(action: string, e: FocusEvent) {
  rebindingAction.value = action
  const input = e.target as HTMLInputElement
  rebindInputs[action] = input
  input.value = 'Press keys…'
  input.select()
}

function captureRebind(e: KeyboardEvent) {
  const action = rebindingAction.value
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  // Escape / Enter cancel instead of being bound as shortcuts.
  if (e.key === 'Escape' || e.key === 'Enter') {
    const el = rebindInputs[action]
    if (el) el.value = getBindingDisplay(action)
    rebindingAction.value = null
    ;(e.target as HTMLInputElement).blur()
    return
  }
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key)
  }
  if (parts.length === 0) return
  const seq = parts.join('+')
  const el = rebindInputs[action]
  if (el) el.value = seq
  saveOverride(action, seq)
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

function onThreshold(v: string) { touchConfig.setThreshold(Number(v)) }
function onLongPress(v: string) { touchConfig.setLongPressThreshold(Number(v)) }
function onEdgeZone(v: string) { touchConfig.setEdgeZoneSize(Number(v)) }
function onDoubleTap(v: string) { touchConfig.setDoubleTapTimeout(Number(v)) }

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

/* header — mirrors Accounts; wraps instead of overflowing a narrow window */
.st-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--ui-border);
  flex-shrink: 0;
}
.st-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.st-brand-text { min-width: 0; }
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

/* status strip — connection · broker · endpoint on one wrapping line */
.st-strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin: 10px 14px 0;
  padding: 8px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-text) 3%, transparent);
  font-size: 12px;
}
.st-strip-k {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
}
.st-strip-v { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.st-strip-url { margin-left: auto; }

/* jump bar — one chip per card, always visible above the scroller.
   Wraps to a second row instead of relying on a hidden horizontal scroll
   (seven uppercase chips overflow a default 560px window otherwise). */
.st-jumps {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px 0;
}
.st-jump {
  appearance: none;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border);
  background: transparent;
  color: color-mix(in srgb, var(--ui-text) 62%, transparent);
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  padding: 5px 9px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.15s var(--ui-ease-out),
    background 0.15s var(--ui-ease-out),
    border-color 0.15s var(--ui-ease-out);
}
.st-jump:hover {
  color: var(--ui-text);
  border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent);
}
.st-jump.is-active {
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
  color: var(--ui-accent);
}

/* body — BLOCK flow (cards are never flex children, so they can never be
   shrunk to slivers: their contents used to spill over every other card). */
.st-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 24px;
}
.st-body > * + * { margin-top: 10px; }
/* give every card body a consistent 10px rhythm (its own .ui-card__body has none) */
.st-body > * > :deep(.ui-card__body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.st-body [id] { scroll-margin-top: 4px; }

.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.st-row + .st-row { border-top: 1px dashed var(--ui-hairline); }
.st-stack { display: flex; flex-direction: column; gap: 10px; }

/* field + actions: wrap when tight, buttons bottom-align with the control */
.st-field-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.st-field-row > :first-child { flex: 1 1 220px; min-width: 0; }
.st-actions { display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }

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
.st-feedback {
  margin: -2px 0 0;
  font-size: 11px;
  line-height: 1.45;
}
.st-feedback.is-ok { color: var(--ui-success); }
.st-feedback.is-err { color: var(--ui-danger); }

/* Accounts → Configure points here: scroll + glow the broker card. */
#oauth-broker-card.is-target {
  border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent);
  animation: st-card-target 2.4s var(--ui-ease-out) 1;
}
@keyframes st-card-target {
  0% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--ui-accent) 75%, transparent),
      var(--ui-glow-soft);
    transform: translateY(-2px);
  }
  70% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--ui-accent) 45%, transparent),
      var(--ui-glow-soft);
    transform: translateY(0);
  }
  100% { box-shadow: var(--ui-shadow-1); }
}

.st-grid-2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }

/* tables: rows wrap instead of relying on viewport media queries (which never
   fire inside a windowed panel — windows resize, not the browser viewport). */
.st-table {
  border: 1px solid var(--ui-hairline);
  border-radius: 10px;
  overflow: hidden;
  max-height: 280px;
  overflow-y: auto;
}
.st-table-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ui-hairline);
}
.st-table-row:last-child { border-bottom: none; }
.st-table-row > :first-child { flex: 1 1 150px; min-width: 0; }
.st-table-row > :not(:first-child) { flex-shrink: 0; }
.st-table--gestures .st-table-row > :nth-child(2) { flex: 1 1 130px; min-width: 110px; }
.st-table--keys .st-table-row > :first-child { flex: 1 1 170px; }
.st-empty { margin: 0; padding: 14px 10px; font-size: 12px; text-align: center; color: var(--ui-text-3); }
.st-key-fb {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  color: var(--ui-warning);
  white-space: nowrap;
}
.st-key-input {
  flex: 0 0 132px;
  width: 132px;
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

@media (prefers-reduced-motion: reduce) {
  .st-jump { transition: none; }
  #oauth-broker-card.is-target { animation: none; }
}
</style>
