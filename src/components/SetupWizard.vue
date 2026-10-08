<!-- CyberManju OS — first-run setup wizard.
  //
  // Six one-job steps, every one skippable: welcome → vault (bind a
  // `.cybermanju` file via the OS picker) → local sync (folder picker, no
  // typed paths) → cloud (broker + one-click sign-in) → agent AI (optional)
  // → done summary. Shown once on first launch; Help → "Setup wizard"
  // re-opens it any time. Closing via ✕ or Escape leaves the "seen" flag
  // unset, so the wizard returns next launch until finish/skip. -->
<template>
  <div class="sw-overlay" role="presentation" @keydown.esc="close">
    <div
      ref="cardRef"
      class="sw-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sw-title"
      tabindex="-1"
    >
      <header class="sw-head">
        <div class="sw-brand">
          <span class="sw-mark"><img src="/bhumisparsha.png" alt="Bhumisparsha" width="36" height="36" /></span>
          <div>
            <h2 id="sw-title" class="sw-title">Set up CyberManju OS</h2>
            <p class="sw-sub">{{ SETUP_STEP_LABELS[step] }} · {{ setupStepIndex(step) }} / {{ SETUP_STEPS.length }}</p>
          </div>
        </div>
        <button class="sw-icon-btn" type="button" title="Close (returns next launch)" aria-label="Close setup wizard" @click="close">
          <AppIcon name="solar:close-circle-bold" :size="18" />
        </button>
      </header>

      <nav class="sw-dots" aria-label="Setup progress">
        <button
          v-for="s in SETUP_STEPS"
          :key="s"
          type="button"
          class="sw-dot"
          :class="{ on: s === step, past: setupStepIndex(s) < setupStepIndex(step) }"
          :title="SETUP_STEP_LABELS[s]"
          :aria-label="SETUP_STEP_LABELS[s]"
          @click="go(s)"
        />
      </nav>

      <main class="sw-body">
        <!-- ── 1 · welcome ── -->
        <section v-if="step === 'welcome'" class="sw-section">
          <p class="sw-lead">3 quick things. Skip anything.</p>
          <ul class="sw-list">
            <li><AppIcon name="solar:diskette-bold" :size="16" /><span><strong>Vault</strong> — where your files live.</span></li>
            <li><AppIcon name="solar:folder-bold" :size="16" /><span><strong>Sync</strong> — mirror a folder, add cloud later.</span></li>
            <li><AppIcon name="solar:bot-bold" :size="16" /><span><strong>Agent</strong> <em class="sw-opt">optional</em> — chat + automation.</span></li>
          </ul>
          <div class="sw-actions">
            <button class="sw-btn primary" type="button" @click="go('vault')">Get started</button>
            <button class="sw-link" type="button" @click="skipAll">Skip all</button>
          </div>
        </section>

        <!-- ── 2 · vault ── -->
        <section v-if="step === 'vault'" class="sw-section">
          <div class="sw-status" :class="disk.bound ? 'ok' : 'idle'">
            <AppIcon :name="disk.bound ? 'solar:check-circle-bold' : 'solar:diskette-bold'" :size="16" />
            <span>{{ disk.bound ? `${disk.name} · ${humanBytes(disk.savedBytes)}` : 'No vault file yet — session only' }}</span>
          </div>
          <div class="sw-bigrow">
            <button class="sw-choice" type="button" :disabled="disk.busy" @click="createVault">
              <AppIcon name="solar:add-circle-bold" :size="20" />
              <span><strong>New vault</strong><small>Pick a folder + name</small></span>
            </button>
            <button class="sw-choice" type="button" :disabled="disk.busy" @click="openVault">
              <AppIcon name="solar:folder-open-bold" :size="20" />
              <span><strong>Open existing</strong><small>Pick a .cybermanju file</small></span>
            </button>
          </div>
          <p v-if="disk.lastError" class="sw-note err">{{ disk.lastError }}</p>
          <p v-else-if="disk.lastMessage" class="sw-note ok">{{ disk.lastMessage }}</p>

          <details v-if="showVaultFallback" class="sw-details">
            <summary>No picker? Use download / upload</summary>
            <div class="sw-row">
              <button class="sw-btn" type="button" :disabled="disk.busy" @click="exportVault">Export</button>
              <button class="sw-btn" type="button" :disabled="disk.busy" @click="triggerImport">Import</button>
              <input ref="importInput" type="file" accept=".cybermanju,application/octet-stream" class="sw-hidden-file" aria-label="Import .cybermanju file" @change="onImportPicked" />
            </div>
          </details>

          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('welcome')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('sync')">Next</button>
            <button class="sw-link" type="button" @click="go('sync')">Skip</button>
          </div>
        </section>

        <!-- ── 3 · local sync (picker-first, no typed path) ── -->
        <section v-if="step === 'sync'" class="sw-section">
          <div v-if="store.syncConfigs.length" class="sw-status ok">
            <AppIcon name="solar:check-circle-bold" :size="16" />
            <span>{{ store.syncConfigs.length }} folder{{ store.syncConfigs.length === 1 ? '' : 's' }} connected</span>
          </div>

          <label class="sw-field">
            <span class="sw-label">Name</span>
            <input v-model="localName" class="sw-input" placeholder="Local folder" autocomplete="off" />
          </label>

          <button class="sw-picker" type="button" @click="pickLocalFolder">
            <AppIcon name="solar:folder-bold" :size="20" />
            <span>
              <strong>{{ localFolderLabel || 'Choose folder…' }}</strong>
              <small>{{ pickerHint }}</small>
            </span>
          </button>

          <details class="sw-details">
            <summary>Advanced — type path manually</summary>
            <label class="sw-field">
              <span class="sw-label">Folder path</span>
              <input v-model="localPath" class="sw-input" placeholder="/DATA/SYNC" autocomplete="off" />
            </label>
          </details>

          <div class="sw-row">
            <button class="sw-btn primary" type="button" :disabled="localBusy || !canSaveLocal" @click="saveLocalSync">
              {{ localBusy ? 'Saving…' : 'Save & verify' }}
            </button>
          </div>
          <p v-if="localMsg" class="sw-note" :class="localOk === false ? 'err' : localOk ? 'ok' : ''">{{ localMsg }}</p>

          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('vault')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('cloud')">Next</button>
            <button class="sw-link" type="button" @click="go('cloud')">Skip</button>
          </div>
        </section>

        <!-- ── 4 · cloud ── -->
        <section v-if="step === 'cloud'" class="sw-section">
          <div v-if="oauthIdentity" class="sw-status ok">
            <AppIcon name="solar:check-circle-bold" :size="16" />
            <span>{{ oauthIdentity.name || oauthIdentity.email }} · {{ oauthIdentity.provider }}</span>
          </div>

          <div class="sw-row">
            <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('google')">{{ oauthBusy === 'google' ? '…' : 'Google' }}</button>
            <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('github')">{{ oauthBusy === 'github' ? '…' : 'GitHub' }}</button>
            <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('gitlab')">{{ oauthBusy === 'gitlab' ? '…' : 'GitLab' }}</button>
          </div>
          <p v-if="oauthMsg" class="sw-note" :class="oauthOk === false ? 'err' : 'ok'">{{ oauthMsg }}</p>
          <p v-if="!brokerOk" class="sw-hint">Needs the broker key below — one paste, once.</p>

          <details class="sw-details" :open="!brokerOk && isStatic">
            <summary>{{ brokerOk ? 'Broker · connected — edit' : 'Broker setup (Supabase URL + key)' }}</summary>
            <label class="sw-field">
              <span class="sw-label">Supabase URL</span>
              <input v-model="sbUrl" class="sw-input" placeholder="https://xyz.supabase.co" autocomplete="off" />
            </label>
            <label class="sw-field">
              <span class="sw-label">Supabase anon key</span>
              <input v-model="sbKey" class="sw-input" type="password" placeholder="Paste anon key" autocomplete="off" />
            </label>
            <div class="sw-row">
              <button class="sw-btn primary" type="button" @click="saveBroker">Save</button>
            </div>
            <p v-if="sbMsg" class="sw-note" :class="brokerOk ? 'ok' : 'err'">{{ sbMsg }}</p>
          </details>

          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('sync')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('agent')">Next</button>
            <button class="sw-link" type="button" @click="go('agent')">Skip</button>
          </div>
        </section>

        <!-- ── 5 · agent (optional) ── -->
        <section v-if="step === 'agent'" class="sw-section">
          <div v-if="!canAgent" class="sw-banner info">
            <AppIcon name="solar:info-circle-bold" :size="15" />
            <span>Needs the desktop app or Docker server. Skip — set it up later in Agent.</span>
          </div>
          <template v-else>
            <div v-if="store.agentProviders.length" class="sw-presets" role="radiogroup" aria-label="Model provider">
              <button
                v-for="p in store.agentProviders"
                :key="p.id"
                type="button"
                role="radio"
                :aria-checked="providerId === p.id"
                class="sw-preset"
                :class="{ on: providerId === p.id }"
                :title="`${p.baseUrl} · ${p.defaultModel}`"
                @click="pickPreset(p.id)"
              >
                <strong>{{ p.label }}</strong>
                <span class="muted">{{ p.defaultModel }}</span>
                <span v-if="p.keyless" class="sw-free">No key needed</span>
              </button>
            </div>
            <div class="sw-fields">
              <label class="sw-field">
                <span class="sw-label">Name</span>
                <input v-model="agentName" class="sw-input" placeholder="My assistant" autocomplete="off" />
              </label>
              <label class="sw-field grow">
                <span class="sw-label">Model</span>
                <input v-model="model" class="sw-input" :placeholder="presetDefault" autocomplete="off" />
              </label>
              <label v-if="!presetKeyless" class="sw-field grow">
                <span class="sw-label">API key</span>
                <input v-model="agentKey" class="sw-input" type="password" placeholder="Paste key (sealed, never shown back)" autocomplete="off" />
              </label>
            </div>
            <div class="sw-row">
              <button class="sw-btn primary" type="button" :disabled="agentBusy || !canSaveAgent" @click="saveAssistant">{{ agentBusy ? 'Saving…' : savedAgentId ? 'Save again' : 'Save assistant' }}</button>
              <span v-if="savedAgentName" class="sw-note ok" role="status">“{{ savedAgentName }}” ready{{ agentKeySealed ? ', key sealed' : '' }}.</span>
            </div>
            <p v-if="agentMsg" class="sw-note" :class="agentOk === false ? 'err' : ''">{{ agentMsg }}</p>
          </template>
          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('cloud')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('done')">Next</button>
            <button class="sw-link" type="button" @click="go('done')">Skip</button>
          </div>
        </section>

        <!-- ── 6 · done ── -->
        <section v-if="step === 'done'" class="sw-section">
          <ul class="sw-summary">
            <li>
              <AppIcon :name="disk.bound ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Vault: <strong>{{ disk.bound ? disk.name : 'skipped' }}</strong></span>
            </li>
            <li>
              <AppIcon :name="store.syncConfigs.length ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Sync: <strong>{{ store.syncConfigs.length ? `${store.syncConfigs.length} connected` : 'skipped' }}</strong></span>
            </li>
            <li>
              <AppIcon :name="oauthIdentity ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Cloud: <strong>{{ oauthIdentity ? `${oauthIdentity.provider} signed in` : 'skipped' }}</strong></span>
            </li>
            <li>
              <AppIcon :name="savedAgentName ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Agent: <strong>{{ savedAgentName ? `“${savedAgentName}”` : 'skipped' }}</strong></span>
            </li>
          </ul>
          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('agent')">Back</button>
            <button class="sw-btn primary" type="button" @click="finish">Finish</button>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { isStaticHost, isTauri } from '@/composables/useTauri'
import {
  getSupabaseConfig,
  identity as supabaseIdentity,
  refreshIdentity,
  setSupabaseConfig,
  signInWithPopup,
  supabaseConfigured,
  supabaseSession,
  supabaseSessionProvider,
  type OAuthBackend,
} from '@/composables/useSupabase'
import {
  createCyberManjuFile,
  disk,
  exportCyberManjuFile,
  importCyberManjuFile,
  openCyberManjuFile,
} from '@/composables/useCyberManjuFile'
import { syncConfigDefaults } from '@/utils/providers'
import { agentPermissionPreset, defaultMcpServers } from '@/types'
import type { SyncConfig } from '@/types'
import { humanBytes } from '@/utils/format'
import {
  SETUP_STEPS,
  SETUP_STEP_LABELS,
  markSetupSeen,
  setupStepIndex,
  type SetupStep,
} from '@/utils/setupWizard'

const emit = defineEmits<{ close: [] }>()

const store = useAppStore()
const cardRef = ref<HTMLElement | null>(null)

const step = ref<SetupStep>('welcome')

/** Static web builds have no server to seal keys with — agent step is read-only there. */
const canAgent = !isStaticHost()
const isStatic = isStaticHost()

/** Export/Import fallback only matters where the OS picker may be missing. */
const showVaultFallback = computed(() => isStatic || !disk.supported)

// ── OAuth broker: prefilled from localStorage / build env / vault hydration.
const sbInitial = getSupabaseConfig()
const sbUrl = ref(sbInitial.url)
const sbKey = ref(sbInitial.key)
const brokerOk = ref(sbInitial.url.startsWith('http') && sbInitial.key.length > 0)
const sbMsg = ref(brokerOk.value ? 'Connected.' : '')

function saveBroker() {
  const url = sbUrl.value.trim()
  const key = sbKey.value.trim()
  if (!url.startsWith('http') || !key) {
    brokerOk.value = false
    sbMsg.value = 'Paste both the URL (https://…) and the anon key.'
    return
  }
  setSupabaseConfig(url, key)
  brokerOk.value = true
  sbMsg.value = 'Saved.'
}

// ── OAuth quick sign-in (same popup as Accounts).
const oauthBusy = ref<OAuthBackend | null>(null)
const oauthMsg = ref('')
const oauthOk = ref<boolean | null>(null)
const oauthIdentity = computed(() => supabaseIdentity.value)

async function quickSignIn(provider: OAuthBackend) {
  if (oauthBusy.value) return
  if (!supabaseConfigured()) {
    oauthOk.value = false
    oauthMsg.value = 'Save the broker key first.'
    return
  }
  oauthBusy.value = provider
  oauthMsg.value = ''
  oauthOk.value = null
  try {
    const who = await signInWithPopup(provider)
    oauthOk.value = true
    oauthMsg.value = `Signed in as ${who.name || who.email}.`
    // Keep the two lists in sync like Accounts does: a fresh login provisions
    // its provider row (with the session token when scopes allow) so the
    // connection exists before any Save & verify.
    await ensureWizardProvider(provider, who.name || who.email).catch(() => {})
  } catch (e) {
    oauthOk.value = false
    oauthMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    oauthBusy.value = null
  }
}

function wizardBackendFor(provider: OAuthBackend): SyncConfig['backendType'] {
  if (provider === 'google') return 'googleDrive'
  if (provider === 'gitlab') return 'gitlab'
  return 'github'
}

/** Best-effort provider row for a fresh wizard sign-in (mirrors Accounts). */
async function ensureWizardProvider(provider: OAuthBackend, whoName: string): Promise<void> {
  await store.fetchSyncConfigs().catch(() => {})
  const backend = wizardBackendFor(provider)
  if (store.syncConfigs.some(c => c.backendType === backend)) return
  let token = ''
  try {
    const session = await supabaseSession()
    const prov = session ? supabaseSessionProvider(session) : null
    if (prov === provider) token = session?.provider_token ?? ''
  } catch {
    token = ''
  }
  const { backendLabel } = await import('@/utils/providers')
  const saved = await store.saveSyncConfig({
    ...syncConfigDefaults(),
    id: '',
    backendType: backend,
    name: token ? `${backendLabel(backend)} — ${whoName}` : backendLabel(backend),
    token: token || undefined,
  } as SyncConfig)
  if (saved) {
    await store.fetchSyncConfigs().catch(() => {})
    oauthMsg.value += token ? ' Connection added (see Accounts).' : ' Connection added — press Connect on its card in Accounts.'
  }
}

// ── `.cybermanju` import/export fallback (no File System Access API).
const importInput = ref<HTMLInputElement | null>(null)

async function exportVault() {
  await exportCyberManjuFile()
}

function triggerImport() {
  importInput.value?.click()
}

async function onImportPicked(e: Event) {
  const input = e.target as HTMLInputElement | null
  const file = input?.files?.[0]
  // Reset so picking the same file twice still fires `change`.
  if (input) input.value = ''
  if (!file) return
  await importCyberManjuFile(file)
}

// ── vault step ──
async function createVault() {
  await createCyberManjuFile()
}

async function openVault() {
  await openCyberManjuFile()
}

// ── sync step: picker-first, never a bare path field ──
const localName = ref('Local folder')
const localPath = ref('')
const localFolderLabel = ref('')
const localBusy = ref(false)
const localMsg = ref('')
const localOk = ref<boolean | null>(null)

const dirPickerSupported = computed(() => {
  try {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  } catch {
    return false
  }
})

const pickerHint = computed(() => {
  if (localFolderLabel.value) return 'Tap to change'
  if (isTauri()) return 'Opens the system folder picker'
  if (dirPickerSupported.value) return 'Opens the browser folder picker'
  return 'No picker here — use Advanced below'
})

const canSaveLocal = computed(() => localPath.value.trim().length > 0)

/** Folder picker → `localPath`. Desktop uses the native dialog, browsers
 * use `showDirectoryPicker` (which never reveals an absolute path, so we
 * store `/<name>` + the handle like Accounts does). */
async function pickLocalFolder() {
  localMsg.value = ''
  localOk.value = null
  // 1. Tauri desktop: native dialog returns a real absolute path.
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false })
      const path = typeof picked === 'string' ? picked : null
      if (!path) return
      localPath.value = path
      localFolderLabel.value = path.split('/').filter(Boolean).pop() ?? path
      return
    } catch (e) {
      localMsg.value = e instanceof Error ? e.message : String(e)
      localOk.value = false
      return
    }
  }
  // 2. Chromium browsers: File System Access directory picker.
  const w = window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> }
  if (typeof w.showDirectoryPicker === 'function') {
    try {
      const dir = await w.showDirectoryPicker()
      const name = String(dir?.name ?? '').trim()
      if (!name) return
      localPath.value = `/${name}`
      localFolderLabel.value = name
      try {
        const { idbSet } = await import('@/utils/idb')
        await idbSet('cybermanju.wizardLocalDir', dir as unknown as string)
      } catch {
        // Handle persistence is best-effort; the path is what sync uses.
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      localMsg.value = e instanceof Error ? e.message : String(e)
      localOk.value = false
    }
    return
  }
  // 3. No picker — point at the manual field.
  localMsg.value = 'No folder picker in this browser — type the path under Advanced.'
  localOk.value = false
}

async function saveLocalSync() {
  if (localBusy.value || !canSaveLocal.value) return
  localBusy.value = true
  localMsg.value = ''
  localOk.value = null
  try {
    const saved = await store.saveSyncConfig({
      ...syncConfigDefaults(),
      id: '',
      backendType: 'local',
      name: localName.value.trim() || 'Local folder',
      basePath: localPath.value.trim() || undefined,
    } as SyncConfig)
    if (!saved) {
      localMsg.value = 'Could not save — retry.'
      localOk.value = false
      return
    }
    await store.fetchSyncConfigs()
    const r = await store.probeSyncConnection(saved)
    localOk.value = r.ok
    localMsg.value = r.ok
      ? `“${saved.name}” connected.`
      : `Saved, but check failed: ${r.detail}`
  } finally {
    localBusy.value = false
  }
}

// ── agent step ──
const providerId = ref('openrouter')
const agentName = ref('')
const model = ref('')
const agentKey = ref('')
const agentBusy = ref(false)
const agentMsg = ref('')
const agentOk = ref<boolean | null>(null)
const savedAgentId = ref('')
const savedAgentName = ref('')
const agentKeySealed = ref(false)

const preset = computed(() => store.agentProviders.find(p => p.id === providerId.value) ?? null)
const presetDefault = computed(() => preset.value?.defaultModel ?? 'model id')
const presetKeyless = computed(() => preset.value?.keyless ?? false)
const canSaveAgent = computed(() => providerId.value !== '' && (model.value.trim() !== '' || presetDefault.value !== 'model id'))

function pickPreset(id: string) {
  providerId.value = id
  const p = store.agentProviders.find(x => x.id === id)
  if (p) model.value = p.defaultModel
}

async function saveAssistant() {
  if (agentBusy.value || !canSaveAgent.value) return
  agentBusy.value = true
  agentMsg.value = ''
  agentOk.value = null
  try {
    const saved = await store.saveAgentConfig({
      name: agentName.value.trim() || 'My assistant',
      providerId: providerId.value,
      model: model.value.trim() || presetDefault.value,
      workingDir: '',
      agentKind: 'build',
      permission: agentPermissionPreset('balanced'),
      autoApprove: false,
      maxTurns: 25,
      mcpServers: defaultMcpServers(),
    })
    if (!saved) {
      agentMsg.value = 'Could not save — is the server running?'
      agentOk.value = false
      return
    }
    savedAgentId.value = saved.id
    savedAgentName.value = saved.name
    const key = agentKey.value.trim()
    if (key && !presetKeyless.value) {
      const sealed = await store.saveAgentKey(saved.id, key)
      agentKeySealed.value = sealed
      agentKey.value = ''
      agentMsg.value = sealed ? 'Saved — key sealed.' : 'Saved, but sealing failed — seal it later in Agent.'
      agentOk.value = sealed
    } else {
      agentMsg.value = presetKeyless.value ? 'Saved — ready to chat.' : 'Saved — add the key later in Agent.'
      agentOk.value = true
    }
  } finally {
    agentBusy.value = false
  }
}

// ── navigation ──
function go(s: SetupStep) {
  step.value = s
}

function skipAll() {
  markSetupSeen()
  emit('close')
}

function finish() {
  markSetupSeen()
  emit('close')
}

function close() {
  // Unmarked close: the wizard returns next launch.
  emit('close')
}

onMounted(async () => {
  cardRef.value?.focus()
  await nextTick()
  // The broker may arrive after this card opens — re-read so a fresh
  // instance with the broker inside its `.cybermanju` file shows connected.
  const hydrated = getSupabaseConfig()
  if (hydrated.url || hydrated.key) {
    sbUrl.value = hydrated.url
    sbKey.value = hydrated.key
    brokerOk.value = hydrated.url.startsWith('http') && hydrated.key.length > 0
    if (brokerOk.value && !sbMsg.value) sbMsg.value = 'Connected.'
  }
  await refreshIdentity().catch(() => {})
  await Promise.allSettled([store.fetchSyncConfigs(), store.fetchAgentConfigs()])
  if (canAgent) {
    await store.fetchAgentProviders().catch(() => {})
    if (store.agentProviders.length && !store.agentProviders.some(p => p.id === providerId.value)) {
      pickPreset(store.agentProviders[0].id)
    } else {
      const p = store.agentProviders.find(x => x.id === providerId.value)
      if (p && !model.value) model.value = p.defaultModel
    }
  }
})
</script>

<style scoped>
.sw-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(0 0 0 / 0.6);
  backdrop-filter: blur(3px);
}
.sw-card {
  width: min(520px, 100%);
  max-height: min(86vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 13px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.5);
  outline: none;
}
.sw-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.sw-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sw-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  overflow: hidden;
  background: #0b0e14;
  border: 1px solid var(--ui-border);
}
.sw-mark img {
  display: block;
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 10px;
}
.sw-title { margin: 0; font-size: 15px; letter-spacing: 0.4px; }
.sw-sub { margin: 1px 0 0; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-icon-btn { background: none; border: none; color: color-mix(in srgb, var(--ui-text) 55%, transparent); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; }
.sw-icon-btn:hover { color: var(--ui-text); }
.sw-icon-btn:focus-visible, .sw-btn:focus-visible, .sw-link:focus-visible, .sw-preset:focus-visible, .sw-choice:focus-visible, .sw-picker:focus-visible, .sw-dot:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.sw-dots { display: flex; gap: 6px; padding: 10px 16px 0; }
.sw-dot { height: 4px; flex: 1; border-radius: 2px; border: none; padding: 0; cursor: pointer; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.sw-dot.past { background: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sw-dot.on { background: var(--ui-accent); }
.sw-body { overflow-y: auto; padding: 12px 16px 16px; }
.sw-section { display: flex; flex-direction: column; gap: 10px; }
.sw-lead { margin: 0; font-size: 13px; line-height: 1.55; }
.sw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-list li {
  display: flex; gap: 10px; align-items: center;
  border: 1px solid var(--ui-border); border-radius: 10px; padding: 10px 12px;
  font-size: 12.5px; line-height: 1.5;
}
.sw-list li > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-opt { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-status {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--ui-border); border-radius: 10px; padding: 8px 12px;
  font-size: 12px;
}
.sw-status.ok { border-color: color-mix(in srgb, var(--ui-accent) 50%, transparent); }
.sw-status.ok > :first-child { color: var(--ui-accent); }
.sw-status.idle > :first-child { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-bigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 440px) { .sw-bigrow { grid-template-columns: 1fr; } }
.sw-choice {
  display: flex; gap: 10px; align-items: center; text-align: left;
  padding: 12px; border-radius: 12px; border: 1px solid var(--ui-border);
  background: transparent; color: var(--ui-text); font-family: inherit; cursor: pointer;
}
.sw-choice:hover:not(:disabled) { border-color: var(--ui-border-strong); }
.sw-choice:disabled { opacity: 0.45; cursor: not-allowed; }
.sw-choice > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-choice strong { display: block; font-size: 13px; }
.sw-choice small { display: block; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-picker {
  display: flex; gap: 10px; align-items: center; text-align: left; width: 100%;
  padding: 12px; border-radius: 12px; border: 1px dashed var(--ui-border-strong);
  background: transparent; color: var(--ui-text); font-family: inherit; cursor: pointer;
}
.sw-picker:hover { border-color: var(--ui-accent); }
.sw-picker > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-picker strong { display: block; font-size: 13px; }
.sw-picker small { display: block; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-details { border: 1px solid var(--ui-border); border-radius: 10px; padding: 8px 12px; font-size: 12px; }
.sw-details summary { cursor: pointer; color: color-mix(in srgb, var(--ui-text) 70%, transparent); }
.sw-details .sw-field { margin-top: 8px; }
.sw-details .sw-row { margin-top: 8px; }
.sw-hint { margin: 0; font-size: 12px; line-height: 1.55; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.muted { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; padding-top: 10px; border-top: 1px dashed var(--ui-border); }
.sw-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.sw-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; min-width: 0; }
.sw-field.grow { grid-column: 1 / -1; }
.sw-label { font-size: 10px; letter-spacing: 0.8px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-input {
  background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 8px;
  color: var(--ui-text); font-family: inherit; font-size: 12px; padding: 8px 10px; outline: none; width: 100%;
}
.sw-input:focus { border-color: var(--ui-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 15%, transparent); }
.sw-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid var(--ui-border); border-radius: 8px;
  color: color-mix(in srgb, var(--ui-text) 75%, transparent);
  font-family: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px; cursor: pointer; white-space: nowrap;
}
.sw-btn:hover:not(:disabled) { color: var(--ui-text); border-color: var(--ui-border-strong); }
.sw-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.sw-btn.primary { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sw-btn.primary:hover:not(:disabled) { background: var(--ui-accent); color: var(--ui-text); }
.sw-link { background: none; border: none; color: var(--ui-info); cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; padding: 0; border-radius: 4px; margin-left: auto; }
.sw-hidden-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.sw-note { margin: 0; font-size: 11.5px; color: var(--ui-info); line-height: 1.5; }
.sw-note.err { color: var(--ui-danger); }
.sw-note.ok { color: var(--ui-accent); }
.sw-banner {
  display: flex; align-items: flex-start; gap: 10px; border-radius: 10px;
  padding: 10px 12px; font-size: 12px; line-height: 1.5; border: 1px solid;
}
.sw-banner.info { border-color: color-mix(in srgb, var(--ui-info) 50%, transparent); background: color-mix(in srgb, var(--ui-info) 8%, transparent); }
.sw-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.sw-preset {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 10px; border-radius: 10px; border: 1px solid var(--ui-border);
  background: transparent; color: var(--ui-text); font-family: inherit; font-size: 12px; cursor: pointer; text-align: left;
}
.sw-preset:hover { border-color: var(--ui-border-strong); }
.sw-preset.on { border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent); background: color-mix(in srgb, var(--ui-accent) 8%, transparent); }
.sw-preset .muted { font-size: 11px; }
.sw-free {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
  color: var(--ui-accent); border: 1px solid color-mix(in srgb, var(--ui-accent) 50%, transparent);
  border-radius: 10px; padding: 1px 7px; margin-top: 3px;
}
.sw-summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-summary li {
  display: flex; gap: 10px; align-items: center;
  border: 1px solid var(--ui-border); border-radius: 10px; padding: 10px 12px; font-size: 12.5px;
}
@media (prefers-reduced-motion: reduce) {
  .sw-btn, .sw-preset, .sw-choice, .sw-picker { transition: none; }
}
</style>
