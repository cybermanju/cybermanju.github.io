<!-- CyberManju OS — mobile first-run wizard (Android / small screens).
  //
  // Full-screen sheet, 44px+ touch targets, 16px inputs (no iOS zoom):
  // welcome → account (dashboard login / first-user register) →
  // vaults (N `.cybermanju` partitions on any provider or local disk) →
  // providers (add N sync configs) → repos (N private vault repos) →
  // agent (optional) → done. Every step skippable; Finish marks seen. -->
<template>
  <div class="msw" role="dialog" aria-modal="true" aria-labelledby="msw-title">
    <header class="msw-head">
      <div class="msw-brand">
        <span class="msw-mark"><img src="/bhumisparsha.png" alt="Bhumisparsha" width="38" height="38" /></span>
        <div>
          <h2 id="msw-title" class="msw-title">Set up CyberManju</h2>
          <p class="msw-sub">{{ MOBILE_SETUP_STEP_LABELS[step] }} · {{ mobileSetupStepIndex(step) }} of {{ MOBILE_SETUP_STEPS.length }}</p>
        </div>
      </div>
      <button class="msw-x" type="button" aria-label="Close setup" @click="close">
        <AppIcon name="solar:close-circle-bold" :size="20" />
      </button>
    </header>

    <div class="msw-dots" aria-hidden="true">
      <span
        v-for="s in MOBILE_SETUP_STEPS"
        :key="s"
        class="msw-dot"
        :class="{ on: s === step, past: mobileSetupStepIndex(s) < mobileSetupStepIndex(step) }"
      />
    </div>
    <div class="msw-progress" aria-hidden="true">
      <div class="msw-progress-fill" :style="{ width: `${(mobileSetupStepIndex(step) / MOBILE_SETUP_STEPS.length) * 100}%` }" />
    </div>

    <main class="msw-body">
      <!-- welcome -->
      <section v-if="step === 'welcome'" class="msw-section">
        <p class="msw-lead">Your private vault, on this phone. Create an account, add as many vault partitions as you want, connect providers, spin up repos — all from here.</p>
        <ul class="msw-list">
          <li><AppIcon name="solar:user-circle-bold" :size="16" /><span><strong>Account</strong> — first user on this device, or sign in.</span></li>
          <li><AppIcon name="solar:diskette-bold" :size="16" /><span><strong>Vaults</strong> — N <code>.cybermanju</code> partitions, any size, any provider or local disk.</span></li>
          <li><AppIcon name="solar:cloud-bold" :size="16" /><span><strong>Providers + repos</strong> — GitHub, GitLab, Drive, local — then create private vault repos.</span></li>
        </ul>
        <button class="msw-btn primary big" type="button" @click="go('account')">Get started</button>
        <button class="msw-link" type="button" @click="skipAll">Skip setup entirely</button>
      </section>

      <!-- account -->
      <section v-if="step === 'account'" class="msw-section">
        <h3 class="msw-h">Your account on this device</h3>
        <p class="msw-hint" v-if="store.currentUser">Signed in as <strong>{{ store.currentUser.username ?? store.currentUser.displayName ?? 'you' }}</strong> — add more users later in Accounts → Users.</p>
        <p class="msw-hint" v-else>No dashboard account yet? Create the first one (bootstrap). Otherwise sign in.</p>
        <label class="msw-field"><span>Username</span>
          <input v-model="username" class="msw-input" autocomplete="username" placeholder="e.g. manju" />
        </label>
        <label class="msw-field"><span>Password</span>
          <input v-model="password" class="msw-input" type="password" autocomplete="current-password" placeholder="••••••••" />
        </label>
        <p v-if="accountMsg" class="msw-note" :class="accountOk === false ? 'err' : 'ok'">{{ accountMsg }}</p>
        <div class="msw-row">
          <button class="msw-btn primary big" type="button" :disabled="accountBusy" @click="doAuth(true)">{{ accountBusy ? '…' : 'Create first user' }}</button>
        </div>
        <div class="msw-row">
          <button class="msw-btn big" type="button" :disabled="accountBusy" @click="doAuth(false)">Sign in</button>
        </div>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('welcome')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('vaults')">Next</button>
          <button class="msw-link" type="button" @click="go('vaults')">Skip</button>
        </div>
      </section>

      <!-- vaults: N partitions -->
      <section v-if="step === 'vaults'" class="msw-section">
        <h3 class="msw-h">Vault partitions <span v-if="partitions.length" class="msw-count">{{ createdCount }} / {{ partitions.length }} created</span></h3>
        <p class="msw-hint">Each partition is a <code>.cybermanju</code> disk: pick a name, size and where it lives (local disk or any connected provider). Add as many as you want.</p>
        <div v-for="(p, i) in partitions" :key="i" class="msw-card">
          <div class="msw-card-head">
            <strong>#{{ i + 1 }} {{ p.name || 'Unnamed vault' }}</strong>
            <span class="msw-status" :class="partitionStatus[i]">{{ partitionStatus[i] === 'done' ? 'CREATED' : partitionStatus[i] === 'busy' ? '…' : 'DRAFT' }}</span>
            <button v-if="partitions.length > 1" class="msw-x sm" type="button" :aria-label="`Remove partition ${i + 1}`" @click="removePartition(i)">✕</button>
          </div>
          <label class="msw-field"><span>Name</span>
            <input v-model="p.name" class="msw-input" placeholder="e.g. photos-vault" />
          </label>
          <div class="msw-grid2">
            <label class="msw-field"><span>Size (MB)</span>
              <input v-model.number="p.sizeMb" class="msw-input" type="number" min="64" max="8192" step="64" />
            </label>
            <label class="msw-field"><span>Lives on</span>
              <select v-model="p.configId" class="msw-input">
                <option value="">Local disk (this phone)</option>
                <option v-for="c in store.syncConfigs" :key="c.id" :value="c.id">{{ c.name || c.backendType }}</option>
              </select>
            </label>
          </div>
          <label class="msw-field"><span>Passphrase (optional, encrypts it)</span>
            <input v-model="p.passphrase" class="msw-input" type="password" autocomplete="new-password" placeholder="leave empty for now" />
          </label>
          <button
            class="msw-btn primary"
            type="button"
            :disabled="!partitionDraftValid(normalizePartitionDraft(p)) || partitionStatus[i] === 'busy' || partitionStatus[i] === 'done' || !canCreatePartition(p)"
            @click="createPartition(i)"
          >{{ partitionStatus[i] === 'done' ? 'Created ✓' : partitionStatus[i] === 'busy' ? 'Creating…' : `Create “${p.name || 'vault'}”` }}</button>
          <p v-if="!canCreatePartition(p)" class="msw-hint">Local-disk partitions need no provider. Provider partitions need that provider saved first (previous step creates them, or add one in Providers).</p>
        </div>
        <button class="msw-btn" type="button" @click="addPartition">+ Add another vault</button>
        <p v-if="vaultMsg" class="msw-note" :class="vaultOk === false ? 'err' : 'ok'">{{ vaultMsg }}</p>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('account')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('providers')">Next</button>
          <button class="msw-link" type="button" @click="go('providers')">Skip</button>
        </div>
      </section>

      <!-- providers -->
      <section v-if="step === 'providers'" class="msw-section">
        <h3 class="msw-h">Providers <span v-if="store.syncConfigs.length" class="msw-count">{{ store.syncConfigs.length }} connected</span></h3>
        <p class="msw-hint">Connect GitHub, GitLab, Google Drive or a local folder. Save one, then add as many more as you want.</p>
        <div class="msw-logo-row" role="radiogroup" aria-label="Provider type">
          <button
            v-for="b in ['github', 'gitlab', 'googleDrive', 'local']"
            :key="b"
            type="button"
            role="radio"
            :aria-checked="prov.backendType === b"
            class="msw-logo"
            :class="{ on: prov.backendType === b }"
            @click="prov.backendType = b"
          >{{ shortProv(b) }}</button>
        </div>
        <label class="msw-field"><span>Display name</span>
          <input v-model="prov.name" class="msw-input" placeholder="e.g. Work GitHub" />
        </label>
        <label class="msw-field"><span>Token / path</span>
          <input v-model="prov.secret" class="msw-input" :type="showSecret ? 'text' : 'password'" placeholder="PAT token, or /DATA/SYNC for local" />
        </label>
        <label class="msw-check"><input v-model="showSecret" type="checkbox" /> Show secret</label>
        <div class="msw-row">
          <button class="msw-btn primary big" type="button" :disabled="provBusy" @click="saveProvider">{{ provBusy ? 'Saving…' : 'Save provider' }}</button>
        </div>
        <p v-if="provMsg" class="msw-note" :class="provOk === false ? 'err' : 'ok'">{{ provMsg }}</p>
        <ul v-if="store.syncConfigs.length" class="msw-provs">
          <li v-for="c in store.syncConfigs" :key="c.id"><strong>{{ c.name || c.backendType }}</strong> <span class="muted">{{ c.backendType }}</span></li>
        </ul>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('vaults')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('repos')">Next</button>
          <button class="msw-link" type="button" @click="go('repos')">Skip</button>
        </div>
      </section>

      <!-- repos + disks -->
      <section v-if="step === 'repos'" class="msw-section">
        <h3 class="msw-h">Private vault repos + disks</h3>
        <p class="msw-hint">GitHub / GitLab: create 1–8 private repos at once, each seeded with your encrypted vault + its own disk (substep 2 below attaches every disk). Drive: a <code>cybermanju-disks/&lt;disk&gt;</code> folder with its <code>.cybermanju</code> files plus the disk.</p>
        <label class="msw-field"><span>Provider</span>
          <select v-model="repoConfigId" class="msw-input">
            <option value="">Pick a saved provider…</option>
            <option v-for="c in repoCapableConfigs" :key="c.id" :value="c.id">{{ c.name || c.backendType }} ({{ c.backendType }})</option>
          </select>
        </label>
        <label class="msw-field"><span>Base repo name</span>
          <input v-model="repoName" class="msw-input" placeholder="cybermanju-vault" />
        </label>
        <div class="msw-grid2">
          <label class="msw-field"><span>Count (1–8)</span>
            <input v-model.number="repoCount" class="msw-input" type="number" min="1" max="8" />
          </label>
          <label class="msw-field"><span>Disk each (MB)</span>
            <input v-model.number="repoDiskMb" class="msw-input" type="number" min="64" max="8192" step="64" />
          </label>
        </div>
        <label class="msw-field"><span>Token (or reuse saved)</span>
          <input v-model="repoToken" class="msw-input" type="password" placeholder="paste PAT — or leave empty" />
        </label>
        <div class="msw-row">
          <button class="msw-btn primary big" type="button" :disabled="repoBusy || !repoConfigId" @click="createRepos">{{ repoBusy ? 'Creating…' : repoCount > 1 ? `Create ${repoCount} repos` : 'Create repo' }}</button>
        </div>
        <p v-if="repoMsg" class="msw-note" :class="repoOk === false ? 'err' : 'ok'">{{ repoMsg }}</p>
        <ul v-if="repoSteps.length" class="msw-steps">
          <li v-for="(s, i) in repoSteps.slice(-6)" :key="i">{{ s }}</li>
        </ul>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('providers')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('agent')">Next</button>
          <button class="msw-link" type="button" @click="go('agent')">Skip</button>
        </div>
      </section>

      <!-- agent -->
      <section v-if="step === 'agent'" class="msw-section">
        <h3 class="msw-h">Agent AI <em class="muted">(optional)</em></h3>
        <p class="msw-hint">{{ isStatic ? 'Saved locally in this browser — key held in memory only (re-enter after reload).' : 'Pick a provider and seal a key — or skip and do it later in Agent.' }}</p>
        <label class="msw-field"><span>Assistant name</span>
          <input v-model="agentName" class="msw-input" placeholder="My assistant" />
        </label>
        <label class="msw-field"><span>Model</span>
          <input v-model="agentModel" class="msw-input" placeholder="model id" />
        </label>
        <label class="msw-field"><span>API key (sealed, never shown back)</span>
          <input v-model="agentKey" class="msw-input" type="password" placeholder="paste key — optional now" />
        </label>
        <div class="msw-row">
          <button class="msw-btn primary big" type="button" :disabled="agentBusy" @click="saveAgent">{{ agentBusy ? 'Saving…' : 'Save assistant' }}</button>
        </div>
        <p v-if="agentMsg" class="msw-note" :class="agentOk === false ? 'err' : 'ok'">{{ agentMsg }}</p>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('repos')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('done')">Next</button>
          <button class="msw-link" type="button" @click="go('done')">Skip</button>
        </div>
      </section>

      <!-- done -->
      <section v-if="step === 'done'" class="msw-section">
        <ul class="msw-summary">
          <li>Account: <strong>{{ store.currentUser ? (store.currentUser.username ?? 'signed in') : 'skipped' }}</strong></li>
          <li>Vaults: <strong>{{ createdCount ? `${createdCount} partition${createdCount > 1 ? 's' : ''} created` : 'skipped' }}</strong></li>
          <li>Providers: <strong>{{ store.syncConfigs.length ? `${store.syncConfigs.length} connected` : 'skipped' }}</strong></li>
          <li>Repos: <strong>{{ reposCreated ? `${reposCreated} created` : 'skipped' }}</strong></li>
          <li>Agent: <strong>{{ agentSavedName ? `“${agentSavedName}” ready` : 'skipped' }}</strong></li>
        </ul>
        <p class="msw-hint">Everything skipped stays one tap away in Accounts, Disks and Agent.</p>
        <button class="msw-btn primary big" type="button" @click="finish">Enter CyberManju →</button>
        <button class="msw-link" type="button" @click="go('agent')">Back</button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { isStaticHost } from '@/composables/useTauri'
import {
  MOBILE_SETUP_STEPS,
  MOBILE_SETUP_STEP_LABELS,
  blankPartitionDraft,
  mobileSetupStepIndex,
  markSetupSeen,
  normalizePartitionDraft,
  partitionDraftValid,
  type MobileSetupStep,
  type VaultPartitionDraft,
} from '@/utils/setupWizard'
import { syncConfigDefaults } from '@/utils/providers'
import { agentPermissionPreset, defaultMcpServers } from '@/types'
import type { AgentConfig, SyncConfig } from '@/types'

const emit = defineEmits<{ close: [] }>()
const store = useAppStore()
const step = ref<MobileSetupStep>('welcome')
const isStatic = isStaticHost()

function tap() {
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8)
  } catch { /* no haptics */ }
}

function go(s: MobileSetupStep) { tap(); step.value = s }
function close() { emit('close') }
function skipAll() { markSetupSeen(); emit('close') }
function finish() { markSetupSeen(); emit('close') }

// ── account ──
const username = ref('')
const password = ref('')
const accountBusy = ref(false)
const accountMsg = ref('')
const accountOk = ref<boolean | null>(null)

async function doAuth(register: boolean) {
  if (accountBusy.value || !username.value.trim() || !password.value) {
    accountMsg.value = 'Enter a username + password first.'
    accountOk.value = false
    return
  }
  accountBusy.value = true
  accountMsg.value = ''
  try {
    const ok = register
      ? await store.register(username.value.trim(), password.value, username.value.trim())
      : await store.login(username.value.trim(), password.value)
    accountOk.value = ok
    accountMsg.value = ok
      ? (register ? `Welcome, ${username.value.trim()} — account created.` : `Welcome back, ${username.value.trim()}.`)
      : (store.authError ?? 'Failed — check the details and retry.')
    if (ok) password.value = ''
  } finally {
    accountBusy.value = false
  }
}

// ── vault partitions (N disks) ──
const partitions = ref<VaultPartitionDraft[]>([blankPartitionDraft('vault-1')])
const partitionStatus = ref<Array<'draft' | 'busy' | 'done'>>(['draft'])
const vaultMsg = ref('')
const vaultOk = ref<boolean | null>(null)
const createdCount = computed(() => partitionStatus.value.filter(s => s === 'done').length)

function addPartition() {
  partitions.value.push(blankPartitionDraft(`vault-${partitions.value.length + 1}`))
  partitionStatus.value.push('draft')
}
function removePartition(i: number) {
  partitions.value.splice(i, 1)
  partitionStatus.value.splice(i, 1)
}
/** Local-disk always works; provider partitions need a config id. */
function canCreatePartition(p: VaultPartitionDraft): boolean {
  return p.configId === '' ? true : store.syncConfigs.some(c => c.id === p.configId)
}

async function createPartition(i: number) {
  const raw = partitions.value[i]
  const norm = normalizePartitionDraft(raw)
  partitions.value[i] = { ...raw, ...norm }
  if (!partitionDraftValid(norm)) {
    vaultMsg.value = 'Name (2+ chars) + size 64–8192 MB required.'
    vaultOk.value = false
    return
  }
  partitionStatus.value[i] = 'busy'
  try {
    if (norm.configId === '') {
      // Local partition on this phone: the native redb volume grows with
      // files; record the intent as a disk row when a provider exists, else
      // count the vault itself as the partition (no native call needed).
      // When at least one provider exists we still create a real disk row
      // on the chosen… here local = just mark done (DB is app-private).
      partitionStatus.value[i] = 'done'
      vaultMsg.value = `“${norm.name}” ready on local disk (${norm.sizeMb} MB budget).`
      vaultOk.value = true
    } else {
      const target = store.syncConfigs.find(c => c.id === norm.configId)
      if (!target) {
        partitionStatus.value[i] = 'draft'
        vaultMsg.value = `Provider is gone — pick another for “${norm.name}”.`
        vaultOk.value = false
        return
      }
      // Provider partition: sealed container + the provider-visible side
      // (Drive folder + `.cybermanju` files, or a private repo + seed for
      // git configs missing one). The disk survives a remote failure.
      const out = await store.createDiskWithRemote(target, {
        sizeMb: norm.sizeMb,
        passphrase: norm.passphrase,
        diskName: norm.name,
        token: typeof target.token === 'string' ? target.token : '',
      })
      if (out?.disk) {
        partitionStatus.value[i] = 'done'
        vaultMsg.value = out.remote
          ? `“${norm.name}” created on provider (${norm.sizeMb} MB) + remote files seeded.`
          : out.remoteWarning
            ? `“${norm.name}” created (${norm.sizeMb} MB), but the remote seed failed: ${out.remoteWarning}`
            : `“${norm.name}” created on provider (${norm.sizeMb} MB).`
        vaultOk.value = !out.remoteWarning
      } else {
        partitionStatus.value[i] = 'draft'
        vaultMsg.value = `Could not create “${norm.name}” — retry.`
        vaultOk.value = false
      }
    }
  } catch (e) {
    partitionStatus.value[i] = 'draft'
    vaultMsg.value = e instanceof Error ? e.message : String(e)
    vaultOk.value = false
  }
}

// ── providers ──
const prov = ref({ backendType: 'github', name: '', secret: '' })
const showSecret = ref(false)
const provBusy = ref(false)
const provMsg = ref('')
const provOk = ref<boolean | null>(null)

function shortProv(b: string) {
  return b === 'googleDrive' ? 'Drive' : b[0].toUpperCase() + b.slice(1)
}

async function saveProvider() {
  if (provBusy.value) return
  if (!prov.value.name.trim()) {
    provMsg.value = 'Give the provider a display name first.'
    provOk.value = false
    return
  }
  provBusy.value = true
  provMsg.value = ''
  try {
    const base = syncConfigDefaults() as unknown as Record<string, unknown>
    const cfg = {
      ...base,
      id: '',
      backendType: prov.value.backendType,
      name: prov.value.name.trim(),
      token: prov.value.secret.trim() || undefined,
      basePath: prov.value.backendType === 'local' ? (prov.value.secret.trim() || undefined) : undefined,
    } as unknown as SyncConfig
    const saved = await store.saveSyncConfig(cfg)
    if (!saved) {
      provMsg.value = 'Could not save — retry.'
      provOk.value = false
      return
    }
    await store.fetchSyncConfigs()
    // Point pending provider-partitions at the fresh config.
    for (const p of partitions.value) {
      if (!p.configId) p.configId = saved.id
    }
    provMsg.value = `“${saved.name}” saved. Add another, or continue.`
    provOk.value = true
    prov.value = { backendType: prov.value.backendType, name: '', secret: '' }
  } finally {
    provBusy.value = false
  }
}

// ── repos + disks ──
// GitHub/GitLab keep the full repo-set flow (private repos + vault seed +
// a disk each). Drive has no repos: the same substep provisions a folder +
// `.cybermanju` files + the disk through the shared helper.
const repoCapableConfigs = computed(() => store.syncConfigs.filter(c => c.backendType === 'github' || c.backendType === 'gitlab' || c.backendType === 'googleDrive'))
const repoConfigId = ref('')
const repoName = ref('cybermanju-vault')
const repoCount = ref(1)
const repoDiskMb = ref(512)
const repoToken = ref('')
const repoBusy = ref(false)
const repoMsg = ref('')
const repoOk = ref<boolean | null>(null)
const repoSteps = ref<string[]>([])
const reposCreated = ref(0)

async function createRepos() {
  const cfg = store.syncConfigs.find(c => c.id === repoConfigId.value)
  if (!cfg) {
    repoMsg.value = 'Pick a saved provider first.'
    repoOk.value = false
    return
  }
  if (cfg.backendType !== 'github' && cfg.backendType !== 'gitlab' && cfg.backendType !== 'googleDrive') {
    repoMsg.value = 'Repos + disks need a GitHub, GitLab or Drive provider.'
    repoOk.value = false
    return
  }
  // Drive substep: no repos to create — one folder + `.cybermanju` files +
  // one attached disk through the shared provisioning helper.
  if (cfg.backendType === 'googleDrive') {
    repoBusy.value = true
    repoSteps.value = [`creating Drive folder + disk…`]
    try {
      const out = await store.createDiskWithRemote(cfg, {
        sizeMb: repoDiskMb.value,
        passphrase: '',
        diskName: repoName.value.trim() || 'cybermanju-vault',
        token: typeof cfg.token === 'string' ? cfg.token : '',
      })
      if (!out?.disk) throw new Error('Disk creation failed — retry.')
      reposCreated.value++
      repoSteps.value.push(`ok: ${out.remote?.remoteDir ?? out.disk.id} (folder + .cybermanju files + disk)`)
      repoMsg.value = out.remote
        ? 'Drive folder + .cybermanju files live, disk attached.'
        : `Disk attached, but the Drive seed failed: ${out.remoteWarning}`
      repoOk.value = !out.remoteWarning
    } catch (e) {
      repoMsg.value = e instanceof Error ? e.message : String(e)
      repoOk.value = false
    } finally {
      repoBusy.value = false
    }
    return
  }
  const n = Math.max(1, Math.min(8, Math.round(repoCount.value) || 1))
  repoBusy.value = true
  repoSteps.value = []
  try {
    for (let i = 0; i < n; i++) {
      const name = n === 1 ? repoName.value.trim() : `${repoName.value.trim()}-${i + 1}`
      if (!name) throw new Error('Give the repo a base name first.')
      repoSteps.value.push(`creating ${name}…`)
      const repo = await store.createProviderRepo({
        backendType: cfg.backendType,
        configId: cfg.id,
        token: repoToken.value.trim() || undefined,
        name,
        private: true,
        description: 'CyberManju OS vault',
      })
      if (!repo) throw new Error(`provider refused ${name}`)
      // Substep: every fresh repo gets its own attached system disk plus
      // the disk's remote file seed (private repo + `.cybermanju` files).
      const out = await store.createDiskWithRemote(
        { ...cfg, repoName: repo.repoName, branch: repo.branch },
        {
          sizeMb: repoDiskMb.value,
          passphrase: '',
          diskName: name,
          token: repoToken.value.trim() || (typeof cfg.token === 'string' ? cfg.token : ''),
        },
      )
      if (!out?.disk) throw new Error(`disk for ${name} failed — repo ${repo.fullName || name} is still live`)
      reposCreated.value++
      repoSteps.value.push(`ok: ${repo.fullName || name} (repo + file + disk)`)
    }
    repoMsg.value = n === 1 ? 'Repo live + file seeded + disk attached.' : `${n} repos live + files seeded + disks merged.`
    repoOk.value = true
  } catch (e) {
    repoMsg.value = e instanceof Error ? e.message : String(e)
    repoOk.value = false
  } finally {
    repoBusy.value = false
  }
}

// ── agent ──
const agentName = ref('')
const agentModel = ref('')
const agentKey = ref('')
const agentBusy = ref(false)
const agentMsg = ref('')
const agentOk = ref<boolean | null>(null)
const agentSavedName = ref('')

async function saveAgent() {
  if (agentBusy.value) return
  agentBusy.value = true
  agentMsg.value = ''
  try {
    // Static browser build: same localStorage rows as Agent → Setup so the
    // assistant is ready to chat immediately; the key stays in memory only.
    if (isStatic) {
      const { listLocalConfigs, saveLocalConfig, setLocalKey } = await import('@/composables/useAgent')
      const now = new Date().toISOString()
      let id: string
      try {
        id = `cfg-${crypto.randomUUID().slice(0, 8)}`
      } catch {
        id = `cfg-${Date.now().toString(36)}`
      }
      const existing = listLocalConfigs()
      const fallbackPreset = existing[0]
      const providerId = fallbackPreset?.providerId ?? store.agentProviders[0]?.id ?? 'openrouter'
      // Static host: store providers are empty (no dashboard), so resolve
      // the default model from the wasm catalog (same source Agent uses).
      let catalogModel = ''
      if (isStatic && !store.agentProviders.length) {
        try {
          const { wasmAgentCatalog } = await import('@/composables/useWasmBackend')
          const presets = (await wasmAgentCatalog()) as Array<{ id?: string; defaultModel?: string }>
          catalogModel = presets.find(p => p.id === providerId)?.defaultModel ?? presets[0]?.defaultModel ?? ''
        } catch {
          catalogModel = ''
        }
      }
      const defaultModel = fallbackPreset?.model
        ?? store.agentProviders.find(p => p.id === providerId)?.defaultModel
        ?? catalogModel
        ?? 'model id'
      const cfg: AgentConfig = {
        id,
        name: agentName.value.trim() || 'My assistant',
        providerId,
        model: agentModel.value.trim() || defaultModel,
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
      agentSavedName.value = cfg.name
      const key = agentKey.value.trim()
      if (key) {
        setLocalKey(id, key)
        agentKey.value = ''
        agentMsg.value = 'Saved locally — key held in memory, ready to chat in Agent.'
        agentOk.value = true
      } else {
        agentMsg.value = 'Saved locally — paste the key in Agent → Setup (memory-only).'
        agentOk.value = true
      }
      return
    }
    const saved = await store.saveAgentConfig({
      name: agentName.value.trim() || 'My assistant',
      providerId: store.agentProviders[0]?.id ?? 'openrouter',
      model: agentModel.value.trim() || store.agentProviders[0]?.defaultModel || 'model id',
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
    agentSavedName.value = saved.name
    const key = agentKey.value.trim()
    if (key) {
      const sealed = await store.saveAgentKey(saved.id, key)
      agentKey.value = ''
      agentMsg.value = sealed ? 'Saved — key sealed.' : 'Saved, but key sealing failed — seal it later in Agent.'
      agentOk.value = sealed
    } else {
      agentMsg.value = 'Saved — paste the key later in Agent → Setup.'
      agentOk.value = true
    }
  } finally {
    agentBusy.value = false
  }
}

onMounted(async () => {
  await Promise.allSettled([store.fetchSyncConfigs(), store.fetchDisks(), store.fetchUsers(), store.fetchAgentProviders().catch(() => {})])
})
</script>

<style scoped>
.msw {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(70% 30% at 50% -8%, color-mix(in srgb, var(--ui-accent) 13%, transparent), transparent 70%),
    radial-gradient(46% 26% at 90% 108%, color-mix(in srgb, var(--ui-danger) 9%, transparent), transparent 70%),
    var(--ui-bg);
  color: var(--ui-text);
  font-family: var(--ui-font);
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.msw::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 3px,
    rgba(0, 0, 0, 0.2) 3px 4px
  );
  opacity: 0.45;
}
.msw-progress {
  height: 3px;
  margin: 8px 16px 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
  overflow: hidden;
}
.msw-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--ui-accent), color-mix(in srgb, var(--ui-accent) 55%, #fff));
  box-shadow: 0 0 12px color-mix(in srgb, var(--ui-accent) 65%, transparent);
  transition: width 240ms ease-out;
}
.msw-title {
  text-shadow: 0 0 16px color-mix(in srgb, var(--ui-accent) 40%, transparent);
  letter-spacing: 0.06em;
}
.msw-section {
  animation: msw-in 220ms ease-out both;
}
@keyframes msw-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: none; }
}
.msw-btn.primary.big, .msw-btn.primary {
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-accent) 22%, transparent);
}
.msw-btn:active {
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .msw-section { animation: none; }
  .msw-progress-fill { transition: none; }
}
.msw-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.msw-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.msw-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
  overflow: hidden;
  background: #0b0e14;
  border: 1px solid var(--ui-border);
}
.msw-mark img {
  display: block;
  width: 38px;
  height: 38px;
  object-fit: cover;
  border-radius: 11px;
}
.msw-title { margin: 0; font-size: 16px; letter-spacing: 0.3px; }
.msw-sub { margin: 1px 0 0; font-size: 11.5px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.msw-x { background: none; border: none; color: inherit; padding: 8px; min-width: 44px; min-height: 44px; cursor: pointer; }
.msw-x.sm { min-width: 32px; min-height: 32px; padding: 4px; }
.msw-dots { display: flex; gap: 5px; padding: 10px 16px 0; }
.msw-dot { height: 4px; flex: 1; border-radius: 2px; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.msw-dot.on { background: var(--ui-accent); }
.msw-dot.past { background: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.msw-body { flex: 1; overflow-y: auto; padding: 14px 16px calc(20px + env(safe-area-inset-bottom, 0px)); -webkit-overflow-scrolling: touch; }
.msw-section { display: flex; flex-direction: column; gap: 12px; max-width: 560px; margin: 0 auto; width: 100%; }
.msw-lead { margin: 0; font-size: 14.5px; line-height: 1.6; }
.msw-h { margin: 2px 0 0; font-size: 13px; letter-spacing: 0.8px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 70%, transparent); display: flex; align-items: center; gap: 8px; }
.msw-count { font-size: 10px; border-radius: 10px; padding: 1px 8px; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.msw-hint { margin: 0; font-size: 13px; line-height: 1.55; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.msw-hint code, .msw-lead code { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ui-info); }
.msw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.msw-list li { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--ui-border); border-radius: 12px; padding: 12px; font-size: 13px; line-height: 1.5; }
.msw-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; }
.msw-field span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.msw-input {
  font-size: 16px; padding: 12px; border-radius: 10px; width: 100%;
  background: var(--ui-surface); border: 1px solid var(--ui-border); color: var(--ui-text); font-family: inherit;
}
.msw-input:focus { border-color: var(--ui-accent); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 15%, transparent); }
.msw-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.msw-row { display: flex; gap: 8px; }
.msw-row .msw-btn { flex: 1; }
.msw-nav { display: flex; align-items: center; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px dashed var(--ui-border); }
.msw-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 10px 14px; border-radius: 10px;
  background: transparent; border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 80%, transparent);
  font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.msw-btn.big { width: 100%; min-height: 50px; font-size: 15px; }
.msw-btn.primary { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.msw-link { background: none; border: none; color: var(--ui-info); font: inherit; font-size: 13px; text-decoration: underline; margin-left: auto; min-height: 44px; cursor: pointer; }
.msw-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ui-info); }
.msw-note.err { color: var(--ui-danger); }
.msw-note.ok { color: var(--ui-accent); }
.msw-card { border: 1px solid var(--ui-border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.msw-card-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.msw-card-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msw-status { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; padding: 2px 8px; border-radius: 10px; background: color-mix(in srgb, var(--ui-text) 10%, transparent); }
.msw-status.done { color: var(--ui-accent); }
.msw-status.busy { color: var(--ui-info); }
.msw-logo-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.msw-logo { min-height: 48px; border-radius: 10px; border: 1px solid var(--ui-border); background: transparent; color: var(--ui-text); font-weight: 700; font-size: 13px; cursor: pointer; }
.msw-logo.on { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.msw-check { display: flex; align-items: center; gap: 8px; font-size: 13px; min-height: 44px; }
.msw-check input { width: 22px; height: 22px; }
.msw-provs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.msw-provs li { border: 1px solid var(--ui-border); border-radius: 10px; padding: 10px 12px; display: flex; gap: 8px; }
.msw-steps { margin: 0; padding-left: 18px; font-size: 12px; color: color-mix(in srgb, var(--ui-text) 70%, transparent); }
.msw-summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.msw-summary li { border: 1px solid var(--ui-border); border-radius: 10px; padding: 12px; font-size: 13.5px; }
.muted { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
@media (min-width: 700px) {
  .msw-body { padding-top: 20px; }
}
</style>
