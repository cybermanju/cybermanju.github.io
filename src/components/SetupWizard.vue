<!-- CyberManju OS — first-run setup wizard.
//
// Seven one-job steps, every one skippable: welcome → vault (bind a
// `.cybermanju` file via the OS picker) → local sync (folder picker, no
// typed paths) → cloud (broker + one-click sign-in) → disks (one system
// disk per provider, with its cloud folder + files) → agent AI (optional)
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
          <p class="sw-lead">4 quick things. Skip anything.</p>
          <ul class="sw-list">
            <li><AppIcon name="solar:diskette-bold" :size="16" /><span><strong>Vault</strong> — where your files live.</span></li>
            <li><AppIcon name="solar:folder-bold" :size="16" /><span><strong>Sync</strong> — mirror a folder, add cloud later.</span></li>
<li><AppIcon name="solar:ssd-square-bold" :size="16" /><span><strong>Disks</strong> — a system disk per provider, with its cloud folder + files.</span></li>
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
          <button class="sw-picker" type="button" :disabled="disk.busy || oneFolderBusy" @click="setupOneFolder">
            <AppIcon name="solar:folder-bold" :size="20" />
            <span>
              <strong>One folder — vault + local copies together (Recommended)</strong>
              <small>{{ oneFolderBusy ? 'Setting up…' : 'Pick a folder → vault.cybermanju + files/ inside it' }}</small>
            </span>
          </button>
          <p v-if="oneFolderMsg" class="sw-note" :class="oneFolderOk === false ? 'err' : oneFolderOk ? 'ok' : ''">{{ oneFolderMsg }}</p>
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
          <p v-if="insecureContext && !isTauri()" class="sw-note">
            Plain-HTTP page (Docker over LAN): the browser hides its file pickers here, so the
            vault lives on the server — create disks and files normally, they persist in /data
            with no binding step. Serve over HTTPS (or open Pages) for local file binding.
          </p>

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
          <p v-if="wizardDirNote" class="sw-note" :class="wizardDirOk === false ? 'err' : wizardDirOk ? 'ok' : ''">
            {{ wizardDirNote }}
            <button v-if="wizardDirReallow" class="sw-link" type="button" @click="reallowWizardDir">
              {{ wizardDirBusy ? 'Allowing…' : 'Re-allow access' }}
            </button>
          </p>

          <details class="sw-details">
            <summary>Advanced — type path manually</summary>
            <label class="sw-field">
              <span class="sw-label">Folder path</span>
              <input v-model="localPath" class="sw-input" placeholder="/DATA/SYNC" autocomplete="off" />
            </label>
          </details>

          <p v-if="loopWarning" class="sw-note err">{{ loopWarning }} <button class="sw-link" type="button" @click="fixLoopPath">Use files/ subfolder</button></p>
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
            <button class="sw-btn primary" type="button" @click="go('disks')">Next</button>
            <button class="sw-link" type="button" @click="go('disks')">Skip</button>
          </div>
        </section>

        <!-- ── 5 · disks (substep: one system disk per provider) ── -->
        <section v-if="step === 'disks'" class="sw-section">
          <div v-if="store.disks.length" class="sw-status ok">
            <AppIcon name="solar:check-circle-bold" :size="16" />
            <span>{{ store.disks.length }} disk{{ store.disks.length === 1 ? '' : 's' }} attached</span>
          </div>
          <p v-else class="sw-hint">No system disk yet — pick a provider below. Drive gets a <code>cybermanju-disks/&lt;disk&gt;</code> folder with its <code>.cybermanju</code> files; GitHub/GitLab get a private repo (created when missing) with the same seed.</p>

          <label class="sw-field">
            <span class="sw-label">Provider</span>
            <select v-model="diskConfigId" class="sw-input">
              <option value="">Pick a connected provider…</option>
              <option v-for="c in store.syncConfigs" :key="c.id" :value="c.id">{{ c.name || c.backendType }} ({{ c.backendType }})</option>
            </select>
          </label>

          <div class="sw-row">
            <label class="sw-field">
              <span class="sw-label">Size (MB)</span>
              <input v-model.number="diskSizeMb" class="sw-input" type="number" min="64" max="8192" step="64" />
            </label>
            <label class="sw-field grow">
              <span class="sw-label">Passphrase (encrypts the disk)</span>
              <input v-model="diskPassphrase" class="sw-input" type="password" placeholder="leave empty for now" autocomplete="new-password" />
            </label>
          </div>

          <div class="sw-row">
            <button class="sw-btn primary" type="button" :disabled="diskBusy || !diskConfigId" @click="createDiskStep">
              {{ diskBusy ? 'Creating…' : 'Create & attach disk' }}
            </button>
          </div>
          <p v-if="diskMsg" class="sw-note" :class="diskOk === false ? 'err' : diskOk ? 'ok' : ''">{{ diskMsg }}</p>

          <details class="sw-details" :open="store.syncConfigs.length > 1">
            <summary>Unified disk — single copy home, mirrors opt-in, key holder</summary>
            <p class="sw-hint">Files live on ONE home provider by default. Tick mirror only for providers that must hold a duplicate. Pick which provider's <code>.cybermanju</code> unwraps the other disks.</p>
            <div v-for="c in store.syncConfigs" :key="`place-${c.id}`" class="sw-row">
              <strong>{{ c.name || c.backendType }}</strong>
              <label class="sw-check"><input type="checkbox" :checked="!!c.mirror" @change="setMirror(c, ($event.target as HTMLInputElement).checked)" /> mirror</label>
              <label class="sw-check"><input type="radio" name="sw-keyholder" :checked="!!c.keyHolder" @change="setKeyHolder(c.id)" /> key holder</label>
            </div>
            <p v-if="placementMsg" class="sw-note ok">{{ placementMsg }}</p>
          </details>

          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('cloud')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('agent')">Next</button>
            <button class="sw-link" type="button" @click="go('agent')">Skip</button>
          </div>
        </section>

        <!-- ── 6 · agent (optional) ── -->
        <section v-if="step === 'agent'" class="sw-section">
          <div v-if="isStatic" class="sw-banner info">
            <AppIcon name="solar:info-circle-bold" :size="15" />
            <span>Browser build — saved locally in this browser, key held in memory only (re-enter after reload).</span>
          </div>
          <template v-if="canAgent">
            <div v-if="agentProviderList.length" class="sw-presets" role="radiogroup" aria-label="Model provider">
              <button
                v-for="p in agentProviderList"
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
            <button class="sw-btn" type="button" @click="go('disks')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('done')">Next</button>
            <button class="sw-link" type="button" @click="go('done')">Skip</button>
          </div>
        </section>

        <!-- ── 7 · done ── -->
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
              <AppIcon :name="store.disks.length ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Disks: <strong>{{ store.disks.length ? `${store.disks.length} attached` : 'skipped' }}</strong></span>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
  createCyberManjuFileInDirectory,
  disk,
  exportCyberManjuFile,
  importCyberManjuFile,
  openCyberManjuFile,
} from '@/composables/useCyberManjuFile'
import {
  SYNC_SUBDIR,
  VAULT_FILENAME,
  isProtectedSyncPath,
  isVaultContainerPath,
  oneFolderLayout,
  suggestLoopSafeSubdir,
} from '@/utils/vaultFolder'
import { syncConfigDefaults } from '@/utils/providers'
import { agentPermissionPreset, defaultMcpServers } from '@/types'
import type { AgentConfig, ProviderPreset, SyncConfig } from '@/types'
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

/** The browser (WASM/Pages) build runs the agent locally — same setup form,
// configs in localStorage, provider catalog from the wasm bundle, keys in
// memory only. Nothing here needs the desktop app or Docker server. */
const canAgent = true
const isStatic = isStaticHost()
const wasmPresets = ref<ProviderPreset[]>([])
const agentProviderList = computed(() =>
  isStatic ? wasmPresets.value : store.agentProviders,
)

/** Export/Import fallback only matters where the OS picker may be missing. */
const showVaultFallback = computed(() => isStatic || !disk.supported)

/**
 * Plain-HTTP LAN (e.g. a Docker dashboard at `http://nas:3456`) is not a
 * secure context, so Chromium hides the file pickers entirely. The vault
 * then lives on the server and needs no browser binding — say so instead
 * of showing a dead picker.
 */
const insecureContext = computed(() => {
  try {
    return typeof window !== 'undefined' && window.isSecureContext === false
  } catch {
    return false
  }
})

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

// ── one-folder setup: <picked>/vault.cybermanju + <picked>/files/ ──
const oneFolderBusy = ref(false)
const oneFolderMsg = ref('')
const oneFolderOk = ref<boolean | null>(null)

async function setupOneFolder() {
  if (oneFolderBusy.value || disk.busy) return
  oneFolderBusy.value = true
  oneFolderMsg.value = ''
  oneFolderOk.value = null
  try {
    // 1. Tauri desktop: native dir pick → vault path + files/ sync root.
    // The server DB stays authoritative; the vault file is the portable copy.
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false })
      const path = typeof picked === 'string' ? picked : null
      if (!path) return
      const clean = path.replace(/\/+$/g, '')
      localPath.value = `${clean}/${SYNC_SUBDIR}`
      localFolderLabel.value = `${clean.split('/').filter(Boolean).pop() ?? clean}/${SYNC_SUBDIR}`
      localName.value = 'Local folder'
      oneFolderMsg.value = `Folder picked — vault goes to ${clean}/${VAULT_FILENAME}, copies to ${localPath.value}. Press Save & verify on the next step.`
      oneFolderOk.value = true
      go('sync')
      return
    }
    // 2. Chromium: one directory pick creates both entries, no second picker.
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    }
    if (typeof w.showDirectoryPicker !== 'function') {
      oneFolderMsg.value = 'No folder picker in this browser — use New vault + Advanced path instead.'
      oneFolderOk.value = false
      return
    }
    const dir = await w.showDirectoryPicker()
    const layout = oneFolderLayout(String((dir as { name?: string }).name ?? 'vault'))
    const made = await createCyberManjuFileInDirectory(dir, layout.vaultName)
    if (!made) return
    // `files/` subdir beside the vault (created, handle remembered).
    let syncLabel = layout.syncVirtualPath
    try {
      const sub = await dir.getDirectoryHandle(layout.syncSubdir, { create: true })
      syncLabel = `/${made.dirName || layout.folderName}/${layout.syncSubdir}`
      try {
        const { rememberLocalDir, WIZARD_LOCAL_DIR_KEY } = await import('@/utils/localDir')
        await rememberLocalDir(WIZARD_LOCAL_DIR_KEY, sub)
      } catch {
        // Handle persistence is best-effort; the virtual path is what sync uses.
      }
    } catch {
      // Subdir creation is best-effort — the virtual path still guides setup.
    }
    localPath.value = syncLabel
    localFolderLabel.value = `${made.dirName || layout.folderName}/${layout.syncSubdir}`
    localName.value = 'Local folder'
    oneFolderMsg.value = `Vault bound (${made.dirName || 'folder'}/${VAULT_FILENAME}) + sync root ${syncLabel} — vault itself is never synced.`
    oneFolderOk.value = true
    go('sync')
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    oneFolderMsg.value = e instanceof Error ? e.message : String(e)
    oneFolderOk.value = false
  } finally {
    oneFolderBusy.value = false
  }
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

// ── remembered folder status (browser leg): a reloaded page keeps the
// handle but loses the grant — one click re-allows, never a re-pick.
const wizardDirNote = ref('')
const wizardDirOk = ref<boolean | null>(null)
const wizardDirReallow = ref(false)
const wizardDirBusy = ref(false)

async function refreshWizardDir() {
  wizardDirReallow.value = false
  if (isTauri()) return
  try {
    const { localDirs, ensureLocalDir, WIZARD_LOCAL_DIR_KEY } = await import('@/utils/localDir')
    const st = localDirs[WIZARD_LOCAL_DIR_KEY] ?? (await ensureLocalDir(WIZARD_LOCAL_DIR_KEY))
    if (st.status === 'ready') {
      wizardDirNote.value = `“${st.label}” still attached — files read and write without re-picking.`
      wizardDirOk.value = true
    } else if (st.status === 'needs-permission') {
      wizardDirNote.value = `“${st.label}” is remembered but the browser wants one click to reopen it.`
      wizardDirOk.value = null
      wizardDirReallow.value = true
    } else {
      wizardDirNote.value = ''
      wizardDirOk.value = null
    }
  } catch {
    wizardDirNote.value = ''
    wizardDirOk.value = null
  }
}

async function reallowWizardDir() {
  if (wizardDirBusy.value) return
  wizardDirBusy.value = true
  try {
    const { reallowLocalDir, WIZARD_LOCAL_DIR_KEY } = await import('@/utils/localDir')
    const ok = await reallowLocalDir(WIZARD_LOCAL_DIR_KEY)
    if (ok) {
      wizardDirNote.value = 'Access restored — the folder works without re-picking.'
      wizardDirOk.value = true
      wizardDirReallow.value = false
    } else {
      wizardDirNote.value = 'Still closed — allow access or pick the folder again.'
      wizardDirOk.value = false
    }
  } finally {
    wizardDirBusy.value = false
  }
}

/** Loop guard: the vault file itself (or its folder) must never be the sync root. */
const loopWarning = computed(() => {
  const p = localPath.value.trim()
  if (!p) return ''
  if (isVaultContainerPath(p)) return 'That path is the vault file itself — sync would chase its own tail.'
  if (isProtectedSyncPath(p)) return 'That path holds vault/secret files — use the files/ subfolder.'
  return ''
})

function fixLoopPath() {
  const fixed = suggestLoopSafeSubdir(localPath.value)
  if (fixed) {
    localPath.value = fixed
    localFolderLabel.value = fixed.split('/').filter(Boolean).slice(-2).join('/')
  }
}

/** Folder picker → `localPath`. Desktop uses the native dialog, browsers
 * use `showDirectoryPicker` (which never reveals an absolute path, so we
 * store `/<name>` + the handle like Accounts does). */
async function pickLocalFolder() {
  localMsg.value = ''
  localOk.value = null
  // 1. Tauri desktop: native dialog returns a real absolute path.
  // Append the loop-safe `files/` subdir (vault lives beside it).
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false })
      const path = typeof picked === 'string' ? picked : null
      if (!path) return
      const clean = path.replace(/\/+$/g, '')
      const safe = clean.toLowerCase().endsWith(`/${SYNC_SUBDIR}`) ? clean : `${clean}/${SYNC_SUBDIR}`
      localPath.value = safe
      localFolderLabel.value = safe.split('/').filter(Boolean).slice(-2).join('/')
      return
    } catch (e) {
      localMsg.value = e instanceof Error ? e.message : String(e)
      localOk.value = false
      return
    }
  }
  // 2. Chromium browsers: File System Access directory picker.
  // Nudge toward the loop-safe `files/` subdir (vault lives beside it).
  const w = window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> }
  if (typeof w.showDirectoryPicker === 'function') {
    try {
      const dir = await w.showDirectoryPicker()
      const name = String(dir?.name ?? '').trim()
      if (!name) return
      localPath.value = `/${name}/${SYNC_SUBDIR}`
      localFolderLabel.value = `${name}/${SYNC_SUBDIR}`
      try {
        const { rememberLocalDir, WIZARD_LOCAL_DIR_KEY } = await import('@/utils/localDir')
        await rememberLocalDir(WIZARD_LOCAL_DIR_KEY, dir)
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
  if (loopWarning.value) {
    localMsg.value = `${loopWarning.value} Press “Use files/ subfolder” first.`
    localOk.value = false
    return
  }
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

// ── disks step: one system disk per provider (explicit substep) ──
const diskConfigId = ref('')
const diskSizeMb = ref(512)
const diskPassphrase = ref('')
const diskBusy = ref(false)
const diskMsg = ref('')
const diskOk = ref<boolean | null>(null)

/** Saved secret first, live OAuth session second (same precedence as Accounts). */
async function diskTokenFor(cfg: SyncConfig): Promise<string> {
  if (typeof cfg.token === 'string' && cfg.token.trim()) return cfg.token.trim()
  try {
    const session = await supabaseSession()
    const prov = session ? supabaseSessionProvider(session) : null
    const { supabaseProviderFor } = await import('@/composables/useSupabase')
    if (prov && supabaseProviderFor(cfg.backendType) === prov) {
      return session?.provider_token ?? ''
    }
  } catch {
    // Session unreadable — the disk still gets created, remote warns.
  }
  return ''
}

async function createDiskStep() {
  const cfg = store.syncConfigs.find(c => c.id === diskConfigId.value)
  if (!cfg || diskBusy.value) {
    if (!cfg) {
      diskMsg.value = 'Pick a connected provider first (or add one in Accounts).'
      diskOk.value = false
    }
    return
  }
  diskBusy.value = true
  diskMsg.value = ''
  diskOk.value = null
  try {
    const out = await store.createDiskWithRemote(cfg, {
      sizeMb: Math.min(8192, Math.max(64, Math.round(diskSizeMb.value) || 512)),
      passphrase: diskPassphrase.value,
      diskName: cfg.name || cfg.backendType,
      token: await diskTokenFor(cfg),
    })
    if (!out?.disk) {
      diskMsg.value = 'Could not create the disk — retry.'
      diskOk.value = false
      return
    }
    diskPassphrase.value = ''
    if (out.remote) {
      const where = cfg.backendType === 'googleDrive'
        ? `Drive folder \`${out.remote.remoteDir}\``
        : `private repo \`${out.remote.config.repoName}\``
      diskMsg.value = `Disk attached — ${where} holds its .cybermanju files. Add another, or continue.`
      diskOk.value = true
    } else if (out.remoteWarning) {
      diskMsg.value = `Disk attached, but the remote seed failed: ${out.remoteWarning}`
      diskOk.value = false
    } else {
      diskMsg.value = 'Disk attached.'
      diskOk.value = true
    }
  } finally {
    diskBusy.value = false
  }
}

// ── unified-disk placement: single-copy home + mirror opt-in + key holder ──
const placementMsg = ref('')

async function setMirror(cfg: SyncConfig, on: boolean) {
  placementMsg.value = ''
  const saved = await store.saveSyncConfig({ ...cfg, mirror: on })
  if (saved) {
    await store.fetchSyncConfigs()
    placementMsg.value = on
      ? `“${cfg.name || cfg.backendType}” will hold duplicates (mirror).`
      : `“${cfg.name || cfg.backendType}” holds single-copy homes only.`
  }
}

async function setKeyHolder(id: string) {
  placementMsg.value = ''
  const { designateKeyHolder } = await import('@/utils/filePlacement')
  const next = designateKeyHolder(store.syncConfigs, id)
  for (const c of next) {
    const prev = store.syncConfigs.find((x) => x.id === c.id)
    if (!prev || !!prev.keyHolder === !!c.keyHolder) continue
    await store.saveSyncConfig({ ...c })
  }
  await store.fetchSyncConfigs()
  const holder = next.find((c) => c.id === id)
  placementMsg.value = `“${holder?.name || holder?.backendType}” unwraps the other disks.`
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

const preset = computed(() => agentProviderList.value.find(p => p.id === providerId.value) ?? null)
const presetDefault = computed(() => preset.value?.defaultModel ?? 'model id')
const presetKeyless = computed(() => preset.value?.keyless ?? false)
const canSaveAgent = computed(() => providerId.value !== '' && (model.value.trim() !== '' || presetDefault.value !== 'model id'))

function pickPreset(id: string) {
  providerId.value = id
  const p = agentProviderList.value.find(x => x.id === id)
  if (p) model.value = p.defaultModel
}

function newWizardId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${prefix}-${Date.now().toString(36)}`
  }
}

async function saveAssistant() {
  if (agentBusy.value || !canSaveAgent.value) return
  agentBusy.value = true
  agentMsg.value = ''
  agentOk.value = null
  try {
    // Browser build: same shapes as Agent → Setup, kept in localStorage;
    // the key is shared in-memory so Agent can chat immediately.
    if (isStatic) {
      const { saveLocalConfig, setLocalKey } = await import('@/composables/useAgent')
      const now = new Date().toISOString()
      const id = savedAgentId.value || newWizardId('cfg')
      const cfg: AgentConfig = {
        id,
        name: agentName.value.trim() || 'My assistant',
        providerId: providerId.value,
        model: model.value.trim() || presetDefault.value,
        workingDir: '',
        agentKind: 'build',
        permission: agentPermissionPreset('balanced'),
        autoApprove: false,
        maxTurns: 25,
        mcpServers: defaultMcpServers(),
        hasKey: false,
        createdAt: now,
        updatedAt: now,
      }
      saveLocalConfig(cfg)
      savedAgentId.value = id
      savedAgentName.value = cfg.name
      const key = agentKey.value.trim()
      if (key && !presetKeyless.value) {
        setLocalKey(id, key)
        agentKey.value = ''
        agentKeySealed.value = true
        agentMsg.value = 'Saved locally — key held in memory, ready to chat in Agent.'
        agentOk.value = true
      } else {
        agentMsg.value = presetKeyless.value
          ? 'Saved locally — ready to chat in Agent.'
          : 'Saved locally — paste the key in Agent → Setup (memory-only).'
        agentOk.value = true
      }
      return
    }
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
  await Promise.allSettled([store.fetchSyncConfigs(), store.fetchDisks(), store.fetchAgentConfigs()])
  if (isStatic) {
    try {
      const { wasmAgentCatalog } = await import('@/composables/useWasmBackend')
      const presets = (await wasmAgentCatalog()) as ProviderPreset[]
      if (presets.length) wasmPresets.value = presets
    } catch {
      wasmPresets.value = []
    }
    // Prefer an existing local assistant so re-opening the wizard edits it.
    try {
      const { listLocalConfigs } = await import('@/composables/useAgent')
      const existing = listLocalConfigs()
      if (existing.length && !existing.some(c => c.id === savedAgentId.value)) {
        const first = existing[0]
        savedAgentId.value = first.id
        savedAgentName.value = first.name
        providerId.value = first.providerId
        model.value = first.model
        agentName.value = first.name
      }
    } catch {
      // localStorage unavailable — presets still render.
    }
  } else {
    await store.fetchAgentProviders().catch(() => {})
  }
  if (agentProviderList.value.length && !agentProviderList.value.some(p => p.id === providerId.value)) {
    pickPreset(agentProviderList.value[0].id)
  } else {
    const p = agentProviderList.value.find(x => x.id === providerId.value)
    if (p && !model.value) model.value = p.defaultModel
  }
  // Folder attach follows the step: entering sync re-checks the remembered
  // directory without prompting (lapsed grants show the one-click re-allow).
  watch(step, (s) => {
    if (s === 'sync') void refreshWizardDir()
  })
  void refreshWizardDir()
})
</script>

<style scoped>
.sw-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 20px 20px;
  background: rgba(0, 0, 0, 0.35);
}
/* Sheet: slides down from the top edge. */
.sw-card {
  width: min(480px, 100%);
  max-height: min(86vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--ui-radius-lg);
  border: 1px solid var(--ui-border);
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 13px;
  box-shadow: var(--ui-shadow-menu);
  outline: none;
  animation: ui-fade-in var(--ui-dur) ease-out both;
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
  border-radius: var(--ui-radius-md);
  flex-shrink: 0;
  overflow: hidden;
  background: var(--ui-bg-deep);
  border: 1px solid var(--ui-border);
}
.sw-mark img {
  display: block;
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: var(--ui-radius-md);
}
.sw-title { margin: 0; font-size: 15px; letter-spacing: 0.4px; }
.sw-sub { margin: 1px 0 0; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-icon-btn { background: none; border: none; color: color-mix(in srgb, var(--ui-text) 55%, transparent); cursor: pointer; padding: 4px; border-radius: var(--ui-radius-sm); display: inline-flex; }
.sw-icon-btn:hover { color: var(--ui-text); }
.sw-icon-btn:focus-visible, .sw-btn:focus-visible, .sw-link:focus-visible, .sw-preset:focus-visible, .sw-choice:focus-visible, .sw-picker:focus-visible, .sw-dot:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.sw-dots { display: flex; gap: 6px; padding: 10px 16px 0; }
.sw-dot { height: 4px; flex: 1; border-radius: var(--ui-radius-full); border: none; padding: 0; cursor: pointer; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.sw-dot.past { background: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sw-dot.on { background: var(--ui-accent); }
.sw-body { overflow-y: auto; padding: 12px 16px 16px; }
.sw-section { display: flex; flex-direction: column; gap: 10px; }
.sw-lead { margin: 0; font-size: 13px; line-height: 1.55; }
.sw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-list li {
  display: flex; gap: 10px; align-items: center;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 10px 12px;
  font-size: 12.5px; line-height: 1.5;
}
.sw-list li > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-opt { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-status {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 8px 12px;
  font-size: 12px;
}
.sw-status.ok { border-color: color-mix(in srgb, var(--ui-accent) 50%, transparent); }
.sw-status.ok > :first-child { color: var(--ui-accent); }
.sw-status.idle > :first-child { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-bigrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 440px) { .sw-bigrow { grid-template-columns: 1fr; } }
.sw-choice {
  display: flex; gap: 10px; align-items: center; text-align: left;
  padding: 12px; border-radius: var(--ui-radius-md); border: 1px solid var(--ui-border);
  background: transparent; color: var(--ui-text); font-family: inherit; cursor: pointer;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out), background-color var(--ui-dur-fast) var(--ui-ease-out), transform var(--ui-dur-fast) var(--ui-ease-out);
}
.sw-choice:hover:not(:disabled) { border-color: var(--ui-border-hover); background: var(--ui-glass); transform: translateY(-1px); }
.sw-choice:disabled { opacity: 0.45; cursor: not-allowed; }
.sw-choice > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-choice strong { display: block; font-size: 13px; }
.sw-choice small { display: block; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-picker {
  display: flex; gap: 10px; align-items: center; text-align: left; width: 100%;
  padding: 12px; border-radius: var(--ui-radius-md); border: 1px dashed var(--ui-border-strong);
  background: transparent; color: var(--ui-text); font-family: inherit; cursor: pointer;
}
.sw-picker:hover { border-color: var(--ui-accent); }
.sw-picker > :first-child { color: var(--ui-accent); flex-shrink: 0; }
.sw-picker strong { display: block; font-size: 13px; }
.sw-picker small { display: block; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-details { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 8px 12px; font-size: 12px; }
.sw-details summary { cursor: pointer; color: color-mix(in srgb, var(--ui-text) 70%, transparent); }
.sw-details .sw-field { margin-top: 8px; }
.sw-details .sw-row { margin-top: 8px; }
.sw-hint { margin: 0; font-size: 12px; line-height: 1.55; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.muted { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: color-mix(in srgb, var(--ui-text) 75%, transparent); cursor: pointer; }
.sw-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; padding-top: 10px; border-top: 1px dashed var(--ui-border); }
.sw-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.sw-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; min-width: 0; }
.sw-field.grow { grid-column: 1 / -1; }
.sw-label { font-size: 11px; font-weight: 600; letter-spacing: 0; color: var(--ui-text-2); }
.sw-input {
  background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  color: var(--ui-text); font-family: inherit; font-size: 12px; padding: 8px 10px; outline: none; width: 100%;
}
.sw-input:focus { border-color: var(--ui-accent); box-shadow: var(--ui-focus-ring); }
.sw-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  color: color-mix(in srgb, var(--ui-text) 75%, transparent);
  font-family: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px; cursor: pointer; white-space: nowrap;
}
.sw-btn:hover:not(:disabled) { color: var(--ui-text); border-color: var(--ui-border-strong); }
.sw-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.sw-btn.primary { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sw-btn.primary:hover:not(:disabled) { background: var(--ui-accent); border-color: var(--ui-accent); color: var(--ui-on-accent); box-shadow: var(--ui-shadow-1); }
.sw-link { background: none; border: none; color: var(--ui-info); cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; padding: 0; border-radius: var(--ui-radius-xs); margin-left: auto; }
.sw-hidden-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.sw-note { margin: 0; font-size: 11.5px; color: var(--ui-info); line-height: 1.5; }
.sw-note.err { color: var(--ui-danger); }
.sw-note.ok { color: var(--ui-accent); }
.sw-banner {
  display: flex; align-items: flex-start; gap: 10px; border-radius: var(--ui-radius-md);
  padding: 10px 12px; font-size: 12px; line-height: 1.5; border: 1px solid;
}
.sw-banner.info { border-color: color-mix(in srgb, var(--ui-info) 50%, transparent); background: color-mix(in srgb, var(--ui-info) 8%, transparent); }
.sw-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.sw-preset {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 10px; border-radius: var(--ui-radius-md); border: 1px solid var(--ui-border);
  background: transparent; color: var(--ui-text); font-family: inherit; font-size: 12px; cursor: pointer; text-align: left;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out), background-color var(--ui-dur-fast) var(--ui-ease-out), transform var(--ui-dur-fast) var(--ui-ease-out), box-shadow var(--ui-dur) var(--ui-ease-out);
}
.sw-preset:hover { border-color: var(--ui-border-hover); transform: translateY(-1px); }
.sw-preset.on { border-color: var(--ui-accent); background: var(--ui-accent-softer); box-shadow: var(--ui-focus-ring); }
.sw-preset .muted { font-size: 11px; }
.sw-free {
  font-size: 11px; font-weight: 600; letter-spacing: 0;
  color: var(--ui-accent); border: 1px solid color-mix(in srgb, var(--ui-accent) 50%, transparent);
  border-radius: var(--ui-radius-xs); padding: 1px 7px; margin-top: 3px;
}
.sw-summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-summary li {
  display: flex; gap: 10px; align-items: center;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 10px 12px; font-size: 12.5px;
}
@media (prefers-reduced-motion: reduce) {
  .sw-btn, .sw-preset, .sw-choice, .sw-picker { transition: none; }
}
</style>
