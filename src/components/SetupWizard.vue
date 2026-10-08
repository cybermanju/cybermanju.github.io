<!-- CyberManju OS — first-run setup wizard (desktop).
  //
  // Four short steps, every one skippable: welcome → storage & sync (local
  // vault file + a local-folder sync provider + a door to cloud providers) →
  // agent AI (provider preset + model + sealed key, optional) → done summary.
  // Shown automatically once on desktop (Tauri) first launch; Help →
  // "Setup wizard" re-opens it any time. Closing via ✕ or Escape leaves the
  // "seen" flag unset, so the wizard returns next launch until the user
  // finishes or explicitly skips. -->
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
            <p class="sw-sub">{{ SETUP_STEP_LABELS[step] }} · step {{ setupStepIndex(step) }} of {{ SETUP_STEPS.length }}</p>
          </div>
        </div>
        <button class="sw-icon-btn" type="button" title="Close (returns next launch)" aria-label="Close setup wizard" @click="close">
          <AppIcon name="solar:close-circle-bold" :size="18" />
        </button>
      </header>

      <div class="sw-dots" aria-hidden="true">
        <span v-for="s in SETUP_STEPS" :key="s" class="sw-dot" :class="{ on: s === step, past: setupStepIndex(s) < setupStepIndex(step) }"></span>
      </div>

      <main class="sw-body">
        <!-- ── 1 · welcome ── -->
        <section v-if="step === 'welcome'" class="sw-section">
          <p class="sw-lead">Three quick things, then you're in. Skip anything — everything stays available later in <strong>Accounts</strong> and <strong>Agent</strong>.</p>
          <ul class="sw-list">
            <li><AppIcon name="solar:diskette-bold" :size="15" /><span><strong>Storage</strong> — a local vault file plus an optional local-folder sync.</span></li>
            <li><AppIcon name="solar:cloud-bold" :size="15" /><span><strong>Cloud providers</strong> — GitHub, GitLab, Drive via one-click OAuth.</span></li>
            <li><AppIcon name="solar:bot-bold" :size="15" /><span><strong>Agent AI</strong> <em class="sw-opt">(optional)</em> — pick a model provider, seal a key, done.</span></li>
          </ul>
          <div class="sw-actions">
            <button class="sw-btn primary" type="button" @click="go('storage')">Get started</button>
            <button class="sw-link" type="button" @click="skipAll">Skip setup entirely</button>
          </div>
        </section>

        <!-- ── 2 · storage & sync ── -->
        <section v-if="step === 'storage'" class="sw-section">
          <h3 class="sw-card-title">Local vault file</h3>
          <p class="sw-hint">
            <span v-if="disk.bound"><strong>{{ disk.name }}</strong> is bound ({{ humanBytes(disk.savedBytes) }}) — you're good, or bind a different one.</span>
            <span v-else>Not bound yet — the vault lives in this session only until you create or open a <code class="sw-code">.cybermanju</code> file.</span>
          </p>
          <div class="sw-row">
            <button class="sw-btn primary" type="button" :disabled="disk.busy" @click="createVault">{{ disk.busy ? '…' : 'Create vault file' }}</button>
            <button class="sw-btn" type="button" :disabled="disk.busy" @click="openVault">Open existing</button>
          </div>
          <p v-if="disk.lastError" class="sw-note err">{{ disk.lastError }}</p>
          <p v-else-if="disk.lastMessage" class="sw-note ok">{{ disk.lastMessage }}</p>

          <template v-if="isStatic">
            <p class="sw-hint">No file picker in this browser? Move the <code class="sw-code">.cybermanju</code> file with a download / upload instead — same vault, no picker needed.</p>
            <div class="sw-row">
              <button class="sw-btn" type="button" :disabled="disk.busy" @click="exportVault">Export (.cybermanju)</button>
              <button class="sw-btn" type="button" :disabled="disk.busy" @click="triggerImport">Import (.cybermanju)</button>
              <input ref="importInput" type="file" accept=".cybermanju,application/octet-stream" class="sw-hidden-file" aria-label="Import .cybermanju file" @change="onImportPicked" />
            </div>
          </template>

          <h3 class="sw-card-title">Local-folder sync <span class="sw-count" v-if="store.syncConfigs.length">{{ store.syncConfigs.length }} configured</span></h3>
          <p class="sw-hint">Mirror a folder on this machine. Cloud providers (GitHub, GitLab, Drive) connect later in <strong>Accounts → Connections</strong> with one-click OAuth.</p>
          <div class="sw-fields">
            <label class="sw-field">
              <span class="sw-label">Display name</span>
              <input v-model="localName" class="sw-input" placeholder="Local folder" autocomplete="off" />
            </label>
            <label class="sw-field grow">
              <span class="sw-label">Folder path</span>
              <input v-model="localPath" class="sw-input" placeholder="/DATA/SYNC" autocomplete="off" />
            </label>
          </div>
          <div class="sw-row">
            <button class="sw-btn primary" type="button" :disabled="localBusy" @click="saveLocalSync">{{ localBusy ? 'Saving…' : 'Save & verify' }}</button>
            <button class="sw-btn" type="button" @click="openConnections">Connect cloud instead →</button>
          </div>
          <p v-if="localMsg" class="sw-note">{{ localMsg }}</p>

          <template v-if="isStatic">
            <h3 class="sw-card-title">Cloud OAuth broker <span v-if="brokerOk" class="sw-count">connected</span></h3>
            <p class="sw-hint">One-click GitHub / Google / Drive sign-in runs through your Supabase project — it holds the client secrets a static page can't. Paste its URL + anon key once; sign-in and every provider card use the same broker.</p>
            <div class="sw-fields">
              <label class="sw-field grow">
                <span class="sw-label">Supabase URL</span>
                <input v-model="sbUrl" class="sw-input" placeholder="https://xyz.supabase.co" autocomplete="off" />
              </label>
              <label class="sw-field grow">
                <span class="sw-label">Supabase anon key</span>
                <input v-model="sbKey" class="sw-input" type="password" placeholder="Paste anon key" autocomplete="off" />
              </label>
            </div>
            <div class="sw-row">
              <button class="sw-btn primary" type="button" @click="saveBroker">Save broker</button>
              <button class="sw-btn" type="button" @click="openConnections">Connect providers →</button>
            </div>
            <p v-if="sbMsg" class="sw-note" :class="brokerOk ? 'ok' : 'err'">{{ sbMsg }}</p>

            <h3 class="sw-card-title">One-click sign-in <span v-if="oauthIdentity" class="sw-count">signed in</span></h3>
            <p class="sw-hint">Needs the broker above (or a build with <code class="sw-code">VITE_SUPABASE_URL</code> set). Sign-in mints a provider token for GitHub / Drive / GitLab sync — same popup the Accounts panel uses.</p>
            <div class="sw-row">
              <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('google')">{{ oauthBusy === 'google' ? '…' : 'Google' }}</button>
              <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('github')">{{ oauthBusy === 'github' ? '…' : 'GitHub' }}</button>
              <button class="sw-btn" type="button" :disabled="!brokerOk || !!oauthBusy" @click="quickSignIn('gitlab')">{{ oauthBusy === 'gitlab' ? '…' : 'GitLab' }}</button>
            </div>
            <p v-if="oauthIdentity" class="sw-note ok">Signed in as {{ oauthIdentity.name || oauthIdentity.email }} ({{ oauthIdentity.provider }}).</p>
            <p v-else-if="oauthMsg" class="sw-note" :class="oauthOk === false ? 'err' : ''">{{ oauthMsg }}</p>
          </template>

          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('welcome')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('agent')">Next</button>
            <button class="sw-link" type="button" @click="go('agent')">Skip this step</button>
          </div>
        </section>

        <!-- ── 3 · agent AI (optional) ── -->
        <section v-if="step === 'agent'" class="sw-section">
          <div v-if="!canAgent" class="sw-banner info">
            <AppIcon name="solar:info-circle-bold" :size="15" />
            <span>Agent AI needs the desktop app or Docker server — the key is sealed server-side. Skip for now; set it up later in <strong>Agent</strong>.</span>
          </div>
          <template v-else>
            <h3 class="sw-card-title">Pick a provider</h3>
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
            <p v-else class="sw-hint">No provider presets reachable — the server may be offline. You can skip and configure later.</p>
            <div class="sw-fields">
              <label class="sw-field">
                <span class="sw-label">Assistant name</span>
                <input v-model="agentName" class="sw-input" placeholder="My assistant" autocomplete="off" />
              </label>
              <label class="sw-field grow">
                <span class="sw-label">Model</span>
                <input v-model="model" class="sw-input" :placeholder="presetDefault" autocomplete="off" />
              </label>
              <label v-if="!presetKeyless" class="sw-field grow">
                <span class="sw-label">API key <span class="muted">(sealed server-side, never shown back)</span></span>
                <input v-model="agentKey" class="sw-input" type="password" placeholder="Paste key — optional now, seal later in Agent" autocomplete="off" />
              </label>
            </div>
            <div class="sw-row">
              <button class="sw-btn primary" type="button" :disabled="agentBusy || !canSaveAgent" @click="saveAssistant">{{ agentBusy ? 'Saving…' : savedAgentId ? 'Save again' : 'Save assistant' }}</button>
              <span v-if="savedAgentName" class="sw-note ok" role="status">“{{ savedAgentName }}” ready{{ agentKeySealed ? ', key sealed' : '' }}.</span>
            </div>
            <p v-if="agentMsg" class="sw-note" :class="agentOk === false ? 'err' : ''">{{ agentMsg }}</p>
          </template>
          <div class="sw-actions">
            <button class="sw-btn" type="button" @click="go('storage')">Back</button>
            <button class="sw-btn primary" type="button" @click="go('done')">Next</button>
            <button class="sw-link" type="button" @click="go('done')">Skip agent setup</button>
          </div>
        </section>

        <!-- ── 4 · done ── -->
        <section v-if="step === 'done'" class="sw-section">
          <ul class="sw-summary">
            <li>
              <AppIcon :name="disk.bound ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Vault file: <strong>{{ disk.bound ? disk.name : 'skipped (session only)' }}</strong></span>
            </li>
            <li>
              <AppIcon :name="store.syncConfigs.length ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Sync providers: <strong>{{ store.syncConfigs.length ? `${store.syncConfigs.length} configured` : 'skipped' }}</strong></span>
            </li>
            <li>
              <AppIcon :name="savedAgentName ? 'solar:check-circle-bold' : 'solar:minus-circle-bold'" :size="15" />
              <span>Agent AI: <strong>{{ savedAgentName ? `“${savedAgentName}” ready` : 'skipped' }}</strong></span>
            </li>
          </ul>
          <p class="sw-hint">Everything skipped stays one click away: <strong>Accounts → Connections</strong> for providers, <strong>Agent → Setup</strong> for AI, and this wizard re-runs from <strong>Help → Setup wizard</strong>.</p>
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
import { useWindowManager } from '@/composables/useWindowManager'
import { isStaticHost } from '@/composables/useTauri'
import {
  getSupabaseConfig,
  identity as supabaseIdentity,
  refreshIdentity,
  setSupabaseConfig,
  signInWithPopup,
  supabaseConfigured,
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
const wm = useWindowManager()
const cardRef = ref<HTMLElement | null>(null)

const step = ref<SetupStep>('welcome')

/** Static web builds have no server to seal keys with — agent step is read-only there. */
const canAgent = !isStaticHost()
const isStatic = isStaticHost()

// ── OAuth broker (static only): Supabase URL + anon key so one-click
// provider OAuth works straight from onboarding. Prefilled from
// localStorage or the build-time env fallback, if either exists.
const sbInitial = getSupabaseConfig()
const sbUrl = ref(sbInitial.url)
const sbKey = ref(sbInitial.key)
const brokerOk = ref(sbInitial.url.startsWith('http') && sbInitial.key.length > 0)
const sbMsg = ref(sbInitial.url || sbInitial.key
  ? (brokerOk.value ? 'Broker configured — sign in or connect providers.' : 'Broker values found but incomplete — check both fields.')
  : '')

function saveBroker() {
  const url = sbUrl.value.trim()
  const key = sbKey.value.trim()
  if (!url.startsWith('http') || !key) {
    brokerOk.value = false
    sbMsg.value = 'Paste both the Supabase URL (https://…) and the anon key first.'
    return
  }
  setSupabaseConfig(url, key)
  brokerOk.value = true
  sbMsg.value = 'Broker saved — sign in above or connect providers in Accounts → Connections.'
}

// ── OAuth quick sign-in (static onboarding): same popup as Accounts, so a
// fresh WASM instance can mint its GitHub/Drive/GitLab token from the
// wizard instead of hunting for the Connections tab.
const oauthBusy = ref<OAuthBackend | null>(null)
const oauthMsg = ref('')
const oauthOk = ref<boolean | null>(null)
const oauthIdentity = computed(() => supabaseIdentity.value)

async function quickSignIn(provider: OAuthBackend) {
  if (oauthBusy.value) return
  if (!supabaseConfigured()) {
    oauthOk.value = false
    oauthMsg.value = 'Save the OAuth broker first — sign-in needs its URL + key.'
    return
  }
  oauthBusy.value = provider
  oauthMsg.value = ''
  oauthOk.value = null
  try {
    const who = await signInWithPopup(provider)
    oauthOk.value = true
    oauthMsg.value = `Signed in as ${who.name || who.email} — token ready for providers.`
  } catch (e) {
    oauthOk.value = false
    oauthMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    oauthBusy.value = null
  }
}

// ── `.cybermanju` import/export fallback (static hosts without the File
// System Access API, e.g. Firefox/Safari): download/upload moves the same
// vault bytes the picker would bind.
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

// ── storage step ──
const localName = ref('Local folder')
const localPath = ref('')
const localBusy = ref(false)
const localMsg = ref('')

async function createVault() {
  await createCyberManjuFile()
}

async function openVault() {
  await openCyberManjuFile()
}

async function saveLocalSync() {
  if (localBusy.value) return
  localBusy.value = true
  localMsg.value = ''
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
      return
    }
    await store.fetchSyncConfigs()
    const r = await store.probeSyncConnection(saved)
    localMsg.value = r.ok
      ? `Connected — “${saved.name}” verified.`
      : `Saved, but verification failed: ${r.detail}`
  } finally {
    localBusy.value = false
  }
}

function openConnections() {
  emit('close')
  wm.open('accounts', { tab: 'connections' })
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
      agentMsg.value = sealed
        ? 'Saved — key sealed. Ready to chat in Agent.'
        : 'Assistant saved, but sealing the key failed — seal it later in Agent → Setup.'
      agentOk.value = sealed
    } else {
      agentMsg.value = presetKeyless.value
        ? 'Saved — keyless provider, ready to chat in Agent.'
        : 'Saved — paste the key later in Agent → Setup, then chat.'
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
  // The broker may arrive after this card opens (build-env is sync, but the
  // vault hydration in App.vue is async) — re-read so a fresh WASM instance
  // with the broker inside its `.cybermanju` file shows "connected".
  const hydrated = getSupabaseConfig()
  if (hydrated.url || hydrated.key) {
    sbUrl.value = hydrated.url
    sbKey.value = hydrated.key
    brokerOk.value = hydrated.url.startsWith('http') && hydrated.key.length > 0
    if (brokerOk.value && !sbMsg.value) sbMsg.value = 'Broker configured — sign in or connect providers.'
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
  width: min(560px, 100%);
  max-height: min(86vh, 760px);
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
.sw-icon-btn:focus-visible, .sw-btn:focus-visible, .sw-link:focus-visible, .sw-preset:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.sw-dots { display: flex; gap: 6px; padding: 10px 16px 0; }
.sw-dot { height: 4px; flex: 1; border-radius: 2px; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.sw-dot.past { background: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sw-dot.on { background: var(--ui-accent); }
.sw-body { overflow-y: auto; padding: 12px 16px 16px; }
.sw-section { display: flex; flex-direction: column; gap: 10px; }
.sw-lead { margin: 0; font-size: 13px; line-height: 1.55; }
.sw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-list li {
  display: flex; gap: 10px; align-items: flex-start;
  border: 1px solid var(--ui-border); border-radius: 10px; padding: 10px 12px;
  font-size: 12.5px; line-height: 1.5;
}
.sw-list li > :first-child { color: var(--ui-accent); flex-shrink: 0; margin-top: 1px; }
.sw-opt { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.sw-card-title { margin: 6px 0 0; font-size: 12px; letter-spacing: 0.8px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 65%, transparent); display: flex; align-items: center; gap: 8px; }
.sw-count {
  font-size: 10px; border-radius: 10px; padding: 1px 7px;
  background: color-mix(in srgb, var(--ui-text) 12%, transparent);
}
.sw-hint { margin: 0; font-size: 12px; line-height: 1.55; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.sw-code { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ui-info); }
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
  .sw-btn, .sw-preset { transition: none; }
}
</style>
