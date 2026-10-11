<!-- CyberManju OS — mobile first-run wizard (Android / small screens).
  //
  // Full-screen sheet, 44px+ touch targets, 16px inputs (no iOS zoom):
  // welcome → account manager hand-off →
  // vaults (N `.cybermanju` partitions on any provider or local disk) →
  // providers (add N sync configs) → repos (N private vault repos) →
  // agent (optional) → appearance (theme + wallpaper, live preview) →
  // done. Every step skippable; Finish marks seen. -->
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

    <div class="msw-progress" aria-hidden="true">
      <div class="msw-progress-fill" :style="{ width: `${(mobileSetupStepIndex(step) / MOBILE_SETUP_STEPS.length) * 100}%` }" />
    </div>

    <main class="msw-body">
      <!-- welcome -->
      <section v-if="step === 'welcome'" class="msw-section">
        <div class="msw-welcome">
          <p class="msw-eyebrow">WELCOME TO CYBERMANJU</p>
          <h3 class="msw-welcome-title">Your private workspace, ready on this phone.</h3>
          <p class="msw-lead">Set up sign-in, local vaults and the services you actually use. Everything else can wait.</p>
        </div>
        <ul class="msw-list" aria-label="What you can set up">
          <li><AppIcon name="solar:user-circle-bold" :size="16" /><span><strong>Sign in</strong> — Google, GitHub or GitLab through the built-in sign-in broker.</span></li>
          <li><AppIcon name="solar:diskette-bold" :size="16" /><span><strong>Vaults</strong> — encrypted <code>.cybermanju</code> partitions, on a provider or this phone.</span></li>
          <li><AppIcon name="solar:cloud-bold" :size="16" /><span><strong>Providers + repos</strong> — GitHub, GitLab, Drive, local — then create private vault repos.</span></li>
          <li><AppIcon name="solar:monitor-bold" :size="16" /><span><strong>Appearance</strong> — theme + wallpaper, previewed live.</span></li>
        </ul>
        <button class="msw-btn primary big" type="button" @click="go('account')">Continue</button>
        <button class="msw-link" type="button" @click="skipAll">Skip setup entirely</button>
      </section>

      <!-- account -->
      <section v-if="step === 'account'" class="msw-section">
        <h3 class="msw-h">Your cloud account</h3>
        <p v-if="identity" class="msw-hint">Signed in as <strong>{{ identity.name || identity.email }}</strong> via {{ identity.provider }}.</p>
        <p v-else class="msw-hint">One tap per provider — no Account Manager detour needed.</p>
        <div class="msw-oauth-grid">
          <button
            v-for="p in MOBILE_LOGIN_CARDS"
            :key="p.id"
            class="msw-btn big msw-oauth"
            type="button"
            :disabled="mswSignInBusy === p.id || !mswSbConfigured"
            :title="mswSbConfigured ? `Continue with ${p.label}` : 'OAuth broker not set — add it in Settings → OAuth broker'"
            @click="mswSignIn(p.id)"
          >
            <ProviderLogo :provider="p.logo" :size="30" />
            <span>{{ mswSignInBusy === p.id ? 'Opening…' : `Continue with ${p.label}` }}</span>
          </button>
        </div>
        <p v-if="mswSignInMsg" class="msw-note" :class="mswSignInOk === false ? 'err' : mswSignInOk ? 'ok' : ''">{{ mswSignInMsg }}</p>
        <!-- substep · after sign-in OK: folder + .cybermanju size per logged provider -->
        <div v-if="mswSignInOk || identity" class="msw-substep">
          <h4 class="msw-substep-title">Vault home per provider</h4>
          <p class="msw-hint">Signed in — pick where each provider keeps its <code>.cybermanju</code> files and how big the disk is. Drive gets a folder, GitHub/GitLab a private repo (created when missing).</p>
          <div v-for="sp in mswSignedProviders" :key="sp.backend" class="msw-prov-card">
            <div class="msw-prov-head">
              <ProviderLogo :provider="sp.logo" :size="26" />
              <div class="msw-prov-meta">
                <strong>{{ sp.label }}</strong>
                <small>{{ sp.accountName }}</small>
              </div>
              <span v-if="mswCloudDone[sp.backend]" class="msw-note ok" style="margin:0">ready ✓</span>
            </div>
            <div v-if="sp.config" class="msw-grid2">
              <label class="msw-field"><span>Folder</span>
                <input v-model="mswCloudFolders[sp.backend]" class="msw-input" placeholder="cybermanju-vault" autocomplete="off" />
              </label>
              <label class="msw-field"><span>Size (MB)</span>
                <input v-model.number="mswCloudSizes[sp.backend]" class="msw-input" type="number" min="64" max="8192" step="64" placeholder="512" />
              </label>
            </div>
            <button
              v-if="sp.config"
              class="msw-btn primary big"
              type="button"
              :disabled="!!mswCloudBusy[sp.backend] || mswCloudDone[sp.backend]"
              @click="mswProvisionCloudDisk(sp.backend)"
            >{{ mswCloudBusy[sp.backend] ? 'Creating…' : mswCloudDone[sp.backend] ? 'Created ✓' : `Create in ${sp.label}` }}</button>
            <p v-else class="msw-note">No {{ sp.label }} connection yet — sign in again above to create it.</p>
            <p v-if="mswCloudMsgs[sp.backend]" class="msw-note" :class="mswCloudMsgs[sp.backend].ok ? 'ok' : 'err'">{{ mswCloudMsgs[sp.backend].text }}</p>
          </div>
        </div>
        <p v-if="!mswSbConfigured" class="msw-note err">OAuth broker is not set — sign-in stays off until you add the URL + key in Settings → OAuth broker.</p>
        <button class="msw-btn big" type="button" @click="openAccounts('vaults')">Open Account Manager</button>
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
        <h3 class="msw-h">Providers <span v-if="providerCount" class="msw-count">{{ providerCount }} connected</span></h3>
        <p class="msw-hint">Manage OAuth sign-in and cloud connections in Accounts, or grant Files access to a folder on this phone.</p>
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
        <template v-if="prov.backendType === 'local'">
          <p class="msw-hint">Android opens the system folder picker. Access remains limited to the folder you choose.</p>
          <button class="msw-btn big" type="button" :disabled="provBusy || folderBusy" @click="chooseLocalFolder">{{ folderBusy ? 'Opening picker…' : selectedFolder ? `Selected: ${selectedFolder.name}` : 'Choose a folder' }}</button>
          <p v-if="!scopedFolderAvailable" class="msw-hint">Persistent folder access is available in the native Android/iOS app, not a mobile browser tab.</p>
          <div v-if="selectedFolder" class="msw-mirror-setup">
            <p class="msw-hint">Create a live mirror in this folder. The <code>.cybermanju</code> file uses the web-compatible ChaCha20-Poly1305 + PBKDF2 format, not ML-KEM. The passphrase is never saved by the app.</p>
            <label class="msw-field"><span>Live Sync file name</span>
              <input v-model="mirrorFileName" class="msw-input" type="text" autocomplete="off" placeholder="cybermanju-vault.cybermanju" />
            </label>
            <label class="msw-field"><span>Vault passphrase (8+ characters)</span>
              <input v-model="mirrorPassphrase" class="msw-input" type="password" autocomplete="new-password" />
            </label>
            <label class="msw-field"><span>Confirm passphrase</span>
              <input v-model="mirrorPassphraseConfirm" class="msw-input" type="password" autocomplete="new-password" />
            </label>
          </div>
        </template>
        <template v-else>
          <p class="msw-hint">{{ matchingSessionToken ? `Your ${shortProv(prov.backendType)} session is available; Accounts manages OAuth connections.` : 'Connect this provider in Accounts first, or paste a personal access token.' }}</p>
          <button class="msw-btn big" type="button" @click="openAccounts(step)">Manage accounts &amp; sign in</button>
          <label class="msw-field"><span>Personal access token (optional when the session provides one)</span>
            <input v-model="prov.secret" class="msw-input" :type="showSecret ? 'text' : 'password'" autocomplete="off" placeholder="Paste a token, or connect in Accounts" />
          </label>
          <label class="msw-check"><input v-model="showSecret" type="checkbox" /> Show token</label>
        </template>
        <div class="msw-row">
          <button class="msw-btn primary big" type="button" :disabled="provBusy" @click="saveProvider">{{ provBusy ? 'Saving…' : 'Save provider' }}</button>
        </div>
        <p v-if="provMsg" class="msw-note" :class="provOk === false ? 'err' : 'ok'">{{ provMsg }}</p>
        <ul v-if="providerCount" class="msw-provs">
          <li v-for="c in store.syncConfigs" :key="c.id"><strong>{{ c.name || c.backendType }}</strong> <span class="muted">{{ c.backendType }}</span></li>
          <li v-for="mount in localFolderMounts" :key="mount.id"><strong>{{ mount.name }}</strong> <span class="muted">Phone folder · Files</span></li>
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
        <label v-if="agentProviderOptions.length" class="msw-field"><span>Provider</span>
          <select v-model="agentProviderId" class="msw-input">
            <option v-for="p in agentProviderOptions" :key="p.id" :value="p.id">{{ p.label }} · {{ p.defaultModel }}</option>
          </select>
        </label>
        <label class="msw-field"><span>Assistant name</span>
          <input v-model="agentName" class="msw-input" placeholder="My assistant" />
        </label>
        <label class="msw-field"><span>Model</span>
          <input v-model="agentModel" class="msw-input" :placeholder="agentProviderDefaultModel" />
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
          <button class="msw-btn primary" type="button" @click="go('appearance')">Next</button>
          <button class="msw-link" type="button" @click="go('appearance')">Skip</button>
        </div>
      </section>

      <!-- appearance -->
      <section v-if="step === 'appearance'" class="msw-section">
        <h3 class="msw-h">Appearance</h3>
        <p class="msw-hint">Pick a look — it applies instantly, and Settings → Appearance can change it later.</p>
        <span class="msw-sub-label">Theme</span>
        <div class="msw-theme-grid" role="radiogroup" aria-label="Theme">
          <button
            v-for="t in mswAppearanceChoices"
            :key="t.id"
            type="button"
            role="radio"
            :aria-checked="mswEffectiveAppearance === t.id"
            class="msw-btn big msw-theme"
            :class="{ on: mswEffectiveAppearance === t.id }"
            @click="mswPickAppearance(t.id)"
          >
            <span class="msw-theme-swatch" :style="t.swatch" aria-hidden="true" />
            <span class="msw-theme-meta"><strong>{{ t.label }}</strong><small>{{ t.blurb }}</small></span>
          </button>
        </div>
        <span class="msw-sub-label">Wallpaper</span>
        <div class="msw-theme-grid" role="radiogroup" aria-label="Wallpaper">
          <button
            v-for="w in mswWallpaperChoices"
            :key="w.id"
            type="button"
            role="radio"
            :aria-checked="mswActiveWallpaper === w.id"
            class="msw-btn big msw-theme col"
            :class="{ on: mswActiveWallpaper === w.id }"
            @click="mswPickWallpaper(w.id)"
          >
            <span class="msw-wp-swatch" :class="`msw-wp-${w.id}`" aria-hidden="true" />
            <span class="msw-theme-meta"><strong>{{ w.label }}</strong></span>
          </button>
        </div>
        <p v-if="mswCustomWallpaper.kind.value" class="msw-note">Custom image active — picking a preset above switches back to it.</p>
        <p v-else class="msw-hint">A custom image (URL or file) stays in Settings → Appearance.</p>
        <div class="msw-nav">
          <button class="msw-btn" type="button" @click="go('agent')">Back</button>
          <button class="msw-btn primary" type="button" @click="go('done')">Next</button>
          <button class="msw-link" type="button" @click="go('done')">Skip</button>
        </div>
      </section>

      <!-- done -->
      <section v-if="step === 'done'" class="msw-section">
        <ul class="msw-summary">
          <li>Account: <strong>{{ identity ? (identity.email || identity.name) : 'skipped' }}</strong></li>
          <li>Vaults: <strong>{{ createdCount ? `${createdCount} partition${createdCount > 1 ? 's' : ''} created` : 'skipped' }}</strong></li>
          <li>Providers: <strong>{{ providerCount ? `${providerCount} connected` : 'skipped' }}</strong></li>
          <li>Repos: <strong>{{ reposCreated ? `${reposCreated} created` : 'skipped' }}</strong></li>
          <li>Agent: <strong>{{ agentSavedName ? `“${agentSavedName}” ready` : 'skipped' }}</strong></li>
          <li>Appearance: <strong>{{ mswAppearanceSummary }}</strong></li>
        </ul>
        <p class="msw-hint">Everything skipped stays one tap away in Accounts, Disks and Agent.</p>
        <button class="msw-btn primary big" type="button" @click="finish">Enter CyberManju →</button>
        <button class="msw-link" type="button" @click="go('appearance')">Back</button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import ProviderLogo from '@/components/ProviderLogo.vue'
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { isStaticHost } from '@/composables/useTauri'
import { identity, connectedAccounts, refreshIdentity, signInWithPopup, supabaseConfigured, supabaseProviderFor, supabaseSession, supabaseSessionProvider, type OAuthBackend } from '@/composables/useSupabase'
import { configureMobileVaultMirror, normalizeMobileVaultFileName, pickMobileFolder, supportsNativeScopedStorage, type MobileFolderHandle } from '@/utils/mobileScopedStorage'
import { listVfsMounts, saveVfsMount } from '@/composables/useProviderCanal'
import type { ProviderMount } from '@/composables/useProviderCanal'
import {
  MOBILE_SETUP_STEPS,
  MOBILE_SETUP_STEP_LABELS,
  blankPartitionDraft,
  clampVaultSizeMb,
  mobileSetupStepIndex,
  markSetupSeen,
  normalizePartitionDraft,
  partitionDraftValid,
  signedProviderCards,
  type MobileSetupStep,
  type VaultPartitionDraft,
} from '@/utils/setupWizard'
import { backendLabel, syncConfigDefaults } from '@/utils/providers'
import { useTheme } from '@/composables/useTheme'
import { useCustomWallpaper } from '@/composables/useCustomWallpaper'
import { THEMES, WALLPAPERS, type ThemeId } from '@/ui/tokens'
import { agentPermissionPreset, defaultMcpServers } from '@/types'
import type { AgentConfig, SyncBackendType, SyncConfig } from '@/types'

const emit = defineEmits<{ close: [] }>()
const store = useAppStore()
const SETUP_STEP_KEY = 'cybermanju.mobileSetup.step'
function initialStep(): MobileSetupStep {
  try {
    const saved = localStorage.getItem(SETUP_STEP_KEY)
    return MOBILE_SETUP_STEPS.find(s => s === saved) ?? 'welcome'
  } catch {
    return 'welcome'
  }
}
const step = ref<MobileSetupStep>(initialStep())
const isStatic = isStaticHost()

function tap() {
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8)
  } catch { /* no haptics */ }
}

function go(s: MobileSetupStep) {
  tap()
  step.value = s
  try { localStorage.setItem(SETUP_STEP_KEY, s) } catch { /* storage may be disabled */ }
}
function close() { emit('close') }
function clearSavedStep() { try { localStorage.removeItem(SETUP_STEP_KEY) } catch { /* storage may be disabled */ } }
function skipAll() { clearSavedStep(); markSetupSeen(); emit('close') }
function finish() { clearSavedStep(); markSetupSeen(); emit('close') }
function openAccounts(returnStep: MobileSetupStep) {
  go(returnStep)
  emit('close')
  window.dispatchEvent(new CustomEvent('cybermanju:open-accounts', { detail: { resumeSetup: true } }))
}

// ── account step: inline OAuth (same broker as Account Manager) ──
const MOBILE_LOGIN_CARDS: Array<{ id: OAuthBackend; label: string; logo: string }> = [
  { id: 'google', label: 'Google', logo: 'google' },
  { id: 'github', label: 'GitHub', logo: 'github' },
  { id: 'gitlab', label: 'GitLab', logo: 'gitlab' },
]
const mswSbConfigured = computed(() => supabaseConfigured())
const mswSignInBusy = ref<OAuthBackend | null>(null)
const mswSignInMsg = ref('')
const mswSignInOk = ref<boolean | null>(null)

function mswBackendForOAuth(p: OAuthBackend | string): SyncBackendType {
  if (p === 'google') return 'googleDrive'
  if (p === 'gitlab') return 'gitlab'
  return 'github'
}

async function mswSignIn(provider: OAuthBackend) {
  if (mswSignInBusy.value) return
  mswSignInBusy.value = provider
  mswSignInMsg.value = ''
  mswSignInOk.value = null
  try {
    const who = await signInWithPopup(provider)
    // Same as Account Manager: provision the matching provider row so the
    // vault/provider steps can use it immediately.
    try {
      const backend = mswBackendForOAuth(provider)
      if (!store.syncConfigs.some(c => c.backendType === backend)) {
        let token = ''
        try {
          const session = await supabaseSession()
          if (session?.provider_token && supabaseSessionProvider(session) === provider) {
            token = session.provider_token ?? ''
          }
        } catch {
          token = ''
        }
        await store.saveSyncConfig({
          ...syncConfigDefaults(),
          id: '',
          backendType: backend,
          name: `${backendLabel(backend)} — ${who.name}`,
          token: token.trim() || undefined,
        } as unknown as SyncConfig)
        await store.fetchSyncConfigs().catch(() => {})
      }
    } catch {
      // Provider provisioning is best-effort — the sign-in already succeeded.
    }
    mswSignInMsg.value = `Signed in as ${who.name} (${who.provider}).`
    mswSignInOk.value = true
  } catch (e) {
    mswSignInMsg.value = e instanceof Error ? e.message : String(e)
    mswSignInOk.value = false
  } finally {
    mswSignInBusy.value = null
  }
}

// ── account substep: after 200-OK sign-in, one folder + `.cybermanju`
// size card per logged provider (same substep as the desktop wizard).
const mswCloudFolders = ref<Record<string, string>>({})
const mswCloudSizes = ref<Record<string, number>>({})
const mswCloudBusy = ref<Record<string, boolean>>({})
const mswCloudDone = ref<Record<string, boolean>>({})
const mswCloudMsgs = ref<Record<string, { ok: boolean; text: string }>>({})

const mswSignedProviders = computed(() => {
  const accounts = connectedAccounts.value.map(a => ({
    provider: a.provider,
    name: a.name,
    email: a.email,
  }))
  if (identity.value) {
    accounts.unshift({
      provider: identity.value.provider,
      name: identity.value.name,
      email: identity.value.email,
    })
  }
  return signedProviderCards(
    accounts,
    store.syncConfigs.map(c => ({ backendType: c.backendType })),
  ).map(card => ({
    ...card,
    config: store.syncConfigs.find(c => c.backendType === card.backend) ?? null,
  }))
})

/** Saved secret first, live OAuth session second (same precedence as desktop). */
async function mswDiskTokenFor(cfg: SyncConfig): Promise<string> {
  if (typeof cfg.token === 'string' && cfg.token.trim()) return cfg.token.trim()
  try {
    const session = await supabaseSession()
    const prov = session ? supabaseSessionProvider(session) : null
    if (prov && supabaseProviderFor(cfg.backendType) === prov) {
      return session?.provider_token ?? ''
    }
  } catch {
    // Session unreadable — the disk still gets created, remote warns.
  }
  return ''
}

async function mswProvisionCloudDisk(backend: SyncBackendType) {
  if (mswCloudBusy.value[backend] || mswCloudDone.value[backend]) return
  const cfg = store.syncConfigs.find(c => c.backendType === backend) ?? null
  if (!cfg) {
    mswCloudMsgs.value[backend] = { ok: false, text: 'No connection yet — sign in again above to create it.' }
    return
  }
  mswCloudBusy.value[backend] = true
  delete mswCloudMsgs.value[backend]
  try {
    const folder = (mswCloudFolders.value[backend] ?? '').trim() || 'cybermanju-vault'
    const sizeMb = clampVaultSizeMb(mswCloudSizes.value[backend] ?? 512)
    const out = await store.createDiskWithRemote(cfg, {
      sizeMb,
      passphrase: '',
      diskName: folder,
      token: await mswDiskTokenFor(cfg),
    })
    if (!out?.disk) {
      mswCloudMsgs.value[backend] = { ok: false, text: 'Could not create the disk — retry.' }
      return
    }
    mswCloudDone.value[backend] = true
    if (out.remote) {
      const where = backend === 'googleDrive'
        ? `Drive folder \`${out.remote.remoteDir}\``
        : `private repo \`${out.remote.config.repoName}\``
      mswCloudMsgs.value[backend] = { ok: true, text: `“${folder}” live (${sizeMb} MB) — ${where} holds its .cybermanju files.` }
    } else if (out.remoteWarning) {
      mswCloudMsgs.value[backend] = { ok: false, text: `Disk attached, but the remote seed failed: ${out.remoteWarning}` }
    } else {
      mswCloudMsgs.value[backend] = { ok: true, text: `“${folder}” created (${sizeMb} MB).` }
    }
  } catch (e) {
    mswCloudMsgs.value[backend] = { ok: false, text: e instanceof Error ? e.message : String(e) }
  } finally {
    mswCloudBusy.value[backend] = false
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
const selectedFolder = ref<MobileFolderHandle | null>(null)
const folderBusy = ref(false)
const mirrorFileName = ref('cybermanju-vault.cybermanju')
const mirrorPassphrase = ref('')
const mirrorPassphraseConfirm = ref('')
const scopedFolderAvailable = supportsNativeScopedStorage()
const localFolderMounts = ref<ProviderMount[]>([])
const providerCount = computed(() => store.syncConfigs.length + localFolderMounts.value.length)
const matchingSessionToken = computed(() => {
  const expected = supabaseProviderFor(prov.value.backendType)
  return !!expected && identity.value?.provider === expected
})

async function refreshLocalFolderMounts() {
  try {
    localFolderMounts.value = (await listVfsMounts()).filter(m => m.backendType === 'scopedStorage')
  } catch {
    localFolderMounts.value = []
  }
}

async function chooseLocalFolder() {
  if (!scopedFolderAvailable) {
    provMsg.value = 'Choose a folder from the native Android or iOS app to grant persistent access.'
    provOk.value = false
    return
  }
  folderBusy.value = true
  provMsg.value = ''
  try {
    const folder = await pickMobileFolder()
    selectedFolder.value = folder
    if (!prov.value.name.trim()) prov.value.name = folder.name
    provMsg.value = `“${folder.name}” selected. Save provider to add it to Files.`
    provOk.value = null
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    provMsg.value = e instanceof Error ? e.message : String(e)
    provOk.value = false
  } finally {
    folderBusy.value = false
  }
}

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
    if (prov.value.backendType === 'local') {
      const folder = selectedFolder.value
      if (!folder) {
        provMsg.value = 'Choose a phone folder first.'
        provOk.value = false
        return
      }
      if (mirrorPassphrase.value.length < 8) {
        provMsg.value = 'Choose a vault passphrase with at least 8 characters.'
        provOk.value = false
        return
      }
      if (mirrorPassphrase.value !== mirrorPassphraseConfirm.value) {
        provMsg.value = 'The vault passphrases do not match.'
        provOk.value = false
        return
      }
      const normalizedMirrorFileName = normalizeMobileVaultFileName(mirrorFileName.value)
      const safeId = folder.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 48)
      const mount = await saveVfsMount({
        id: `mobile-${safeId}`,
        configId: folder.id,
        folderId: folder.id,
        name: prov.value.name.trim() || folder.name,
        backendType: 'scopedStorage',
      })
      await refreshLocalFolderMounts()
      await configureMobileVaultMirror(folder, normalizedMirrorFileName, mirrorPassphrase.value)
      provMsg.value = `“${mount.name}” is available in Files; live mirror “${normalizedMirrorFileName}” is active and web-compatible.`
      provOk.value = true
      selectedFolder.value = null
      mirrorPassphrase.value = ''
      mirrorPassphraseConfirm.value = ''
      mirrorFileName.value = 'cybermanju-vault.cybermanju'
      prov.value = { backendType: 'local', name: '', secret: '' }
      return
    }
    let token = prov.value.secret.trim()
    if (!token) {
      const expected = supabaseProviderFor(prov.value.backendType)
      const session = await supabaseSession()
      if (expected && supabaseSessionProvider(session) === expected) token = session?.provider_token ?? ''
    }
    if (!token) {
      provMsg.value = `Sign in with ${shortProv(prov.value.backendType)} above or paste a personal access token.`
      provOk.value = false
      return
    }
    const base = syncConfigDefaults() as unknown as Record<string, unknown>
    const cfg = {
      ...base,
      id: '',
      backendType: prov.value.backendType,
      name: prov.value.name.trim(),
      token,
      basePath: undefined,
    } as unknown as SyncConfig
    const saved = await store.saveSyncConfig(cfg)
    if (!saved) {
      provMsg.value = 'Could not save — retry.'
      provOk.value = false
      return
    }
    await store.fetchSyncConfigs()
    provMsg.value = `“${saved.name}” saved. Add another, or continue.`
    provOk.value = true
    prov.value = { backendType: prov.value.backendType, name: '', secret: '' }
  } catch (error) {
    provMsg.value = error instanceof Error ? error.message : String(error)
    provOk.value = false
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
const agentProviderId = ref('')
const agentProviderOptions = computed(() => store.agentProviders.length
  ? store.agentProviders
  : [{ id: 'openrouter', label: 'OpenRouter', baseUrl: '', defaultModel: 'model id', keyless: false } as unknown as (typeof store.agentProviders)[number]])
const agentProviderDefaultModel = computed(() =>
  agentProviderOptions.value.find(p => p.id === agentProviderId.value)?.defaultModel ?? 'model id')

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
      const providerId = agentProviderId.value || (fallbackPreset?.providerId ?? store.agentProviders[0]?.id ?? 'openrouter')
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
      providerId: agentProviderId.value || (store.agentProviders[0]?.id ?? 'openrouter'),
      model: agentModel.value.trim() || agentProviderDefaultModel.value,
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

// ── appearance: theme + wallpaper (same store as Settings, live preview) ──
const mswTheme = useTheme()
const mswCustomWallpaper = useCustomWallpaper()

const mswAppearanceChoices = computed(() => [
  { id: 'auto', label: 'Auto', blurb: 'Follows the OS light / dark scheme', swatch: 'background: linear-gradient(90deg, #000000 50%, #ECECEC 50%)' },
  ...Object.values(THEMES).map(t => ({
    id: t.id as string,
    label: t.label,
    blurb: t.blurb,
    swatch: `background: linear-gradient(135deg, ${t.palette.bg} 55%, ${t.palette.accent} 55%)`,
  })),
])
const mswEffectiveAppearance = computed(() => (mswTheme.settings.followSystem ? 'auto' : mswTheme.settings.theme))

function mswPickAppearance(id: string) {
  if (id === 'auto') mswTheme.setAppearance('auto')
  else mswTheme.setAppearance(id as ThemeId)
}

const mswWallpaperChoices = WALLPAPERS
const mswActiveWallpaper = computed(() => (mswCustomWallpaper.kind.value ? 'custom' : mswTheme.settings.wallpaper))
const mswAppearanceSummary = computed(() => {
  const t = mswAppearanceChoices.value.find(c => c.id === mswEffectiveAppearance.value)
  const w = mswWallpaperChoices.find(wp => wp.id === mswTheme.settings.wallpaper)
  const wpLabel = mswCustomWallpaper.kind.value ? 'Custom image' : (w?.label ?? mswTheme.settings.wallpaper)
  return `${t?.label ?? mswEffectiveAppearance.value} · ${wpLabel}`
})

function mswPickWallpaper(id: string) {
  mswTheme.setWallpaper(id)
  if (mswCustomWallpaper.kind.value) void mswCustomWallpaper.clear()
}

onMounted(async () => {
  await Promise.allSettled([
    refreshIdentity(),
    refreshLocalFolderMounts(),
    store.fetchSyncConfigs(),
    store.fetchDisks(),
    store.fetchAgentProviders().catch(() => {}),
  ])
  if (!agentProviderId.value && agentProviderOptions.value.length) {
    agentProviderId.value = agentProviderOptions.value[0].id
  }
})
</script>

<style scoped>
.msw {
  position: fixed;
  inset: 0;
  z-index: 11000;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: contain;
  background: var(--ui-bg, #f2f2f7);
  color: var(--ui-text);
  font-family: var(--ui-font);
  padding-top: env(safe-area-inset-top, 0px);
}
.msw-progress {
  height: 3px;
  margin: 5px 16px 0;
  border-radius: var(--ui-radius-full);
  background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
  overflow: hidden;
}
.msw-progress-fill {
  height: 100%;
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent);
  transition: width 240ms ease-out;
}
.msw-title {
  letter-spacing: 0;
}
.msw-section {
  animation: msw-in 220ms ease-out both;
}
@keyframes msw-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: none; }
}
.msw-btn.primary.big, .msw-btn.primary {
  box-shadow: none;
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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px 9px;
  border-bottom: 1px solid var(--ui-border);
}
.msw-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.msw-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: var(--ui-radius-md); flex-shrink: 0;
  overflow: hidden;
  background: var(--ui-bg-deep);
  border: 1px solid var(--ui-border);
}
.msw-mark img {
  display: block;
  width: 38px;
  height: 38px;
  object-fit: cover;
  border-radius: var(--ui-radius-md);
}
.msw-title { margin: 0; font-size: 16px; letter-spacing: 0.3px; }
.msw-sub { margin: 1px 0 0; font-size: 11.5px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.msw-x { display: inline-flex; align-items: center; justify-content: center; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 999px; color: inherit; padding: 8px; min-width: 44px; min-height: 44px; cursor: pointer; }
.msw-x.sm { min-width: 32px; min-height: 32px; padding: 4px; }
.msw-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 16px max(24px, env(safe-area-inset-bottom, 0px)); -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.msw-section { display: flex; flex-direction: column; gap: 12px; max-width: 560px; margin: 0 auto; width: 100%; }
.msw-welcome { display: flex; flex-direction: column; gap: 10px; padding: clamp(22px, 6vh, 54px) 2px 8px; }
.msw-eyebrow { margin: 0; color: var(--ui-accent); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
.msw-welcome-title { max-width: 15ch; color: var(--ui-text); font-size: clamp(28px, 7vw, 34px); font-weight: 700; letter-spacing: -0.035em; line-height: 1.12; }
.msw-lead { margin: 0; font-size: 15px; line-height: 1.55; color: var(--ui-text-2); }
.msw-h { margin: 2px 0 0; font-size: 16px; font-weight: 650; letter-spacing: 0; color: var(--ui-text); display: flex; align-items: center; gap: 8px; }
.msw-count { font-size: 10px; border-radius: var(--ui-radius-md); padding: 1px 8px; background: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.msw-hint { margin: 0; font-size: 13px; line-height: 1.55; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.msw-hint code, .msw-lead code { font-family: var(--ui-font-mono); font-size: 12px; color: var(--ui-info); }
.msw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.msw-list li { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-surface); padding: 12px; font-size: 13px; line-height: 1.5; }
.msw-list li > :first-child { flex: 0 0 auto; margin-top: 2px; color: var(--ui-accent); }
.msw-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; letter-spacing: 0; }
.msw-field span { font-size: 11px; font-weight: 600; color: var(--ui-text-2); }
.msw-input {
  font-size: 16px; padding: 12px; border-radius: var(--ui-radius-md); width: 100%;
  background: var(--ui-surface); border: 1px solid var(--ui-border); color: var(--ui-text); font-family: inherit;
}
.msw-input:focus { border-color: var(--ui-accent); outline: none; box-shadow: var(--ui-focus-ring); }
.msw-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.msw-row { display: flex; gap: 8px; }
.msw-row .msw-btn { flex: 1; }
.msw-nav { display: flex; align-items: center; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--ui-border); }
.msw-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 10px 14px; border-radius: 12px;
  background: transparent; border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 80%, transparent);
  font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.msw-btn.big { width: 100%; min-height: 52px; font-size: 15px; }
.msw-btn.primary { color: var(--ui-on-accent); background: var(--ui-accent); border-color: transparent; font-weight: 650; }
.msw-btn.primary:disabled { opacity: 0.45; }
.msw-link { background: none; border: none; color: var(--ui-info); font: inherit; font-size: 14px; text-decoration: none; margin-left: auto; min-height: 44px; cursor: pointer; }
.msw-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ui-info); }
.msw-note.err { color: var(--ui-danger); }
.msw-note.ok { color: var(--ui-accent); }
.msw-card { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.msw-card-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.msw-card-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msw-status { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; padding: 2px 8px; border-radius: var(--ui-radius-md); background: color-mix(in srgb, var(--ui-text) 10%, transparent); }
.msw-status.done { color: var(--ui-accent); }
.msw-status.busy { color: var(--ui-info); }
.msw-logo-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.msw-logo { min-height: 48px; border-radius: var(--ui-radius-md); border: 1px solid var(--ui-border); background: transparent; color: var(--ui-text); font-weight: 700; font-size: 13px; cursor: pointer; }
.msw-logo.on { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.msw-oauth-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
.msw-oauth-grid .msw-btn { justify-content: flex-start; text-align: left; }
.msw-oauth { gap: 10px; }
.msw-sub-label { font-size: 11px; font-weight: 700; color: var(--ui-text-2); }
.msw-theme-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
.msw-theme { justify-content: flex-start; text-align: left; gap: 10px; height: auto; }
.msw-theme.col { flex-direction: column; align-items: stretch; gap: 8px; }
.msw-theme.on { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.msw-theme-swatch { width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--ui-border); flex-shrink: 0; }
.msw-theme-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.msw-theme-meta strong { font-size: 14px; }
.msw-theme-meta small { font-size: 12px; font-weight: 400; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.msw-wp-swatch { width: 100%; height: 40px; border-radius: 10px; border: 1px solid var(--ui-border); flex-shrink: 0; }
.msw-wp-slopes-dark { background: linear-gradient(180deg, #2b3136 0%, #1b1e20 55%, #101315 100%); }
.msw-wp-slopes-light { background: linear-gradient(180deg, #f4f5f6 0%, #dcdfe3 60%, #c9ced4 100%); }
.msw-wp-dunes { background: radial-gradient(120% 90% at 80% 110%, rgba(246, 116, 0, 0.35), transparent 55%), linear-gradient(180deg, #232629 0%, #0e1113 100%); }
.msw-substep {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px dashed var(--ui-border-strong); border-radius: 14px;
  padding: 12px;
}
.msw-substep-title { margin: 0; font-size: 14px; font-weight: 700; }
.msw-prov-card {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md);
  background: var(--ui-surface); padding: 12px;
}
.msw-prov-head { display: flex; align-items: center; gap: 10px; }
.msw-prov-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.msw-prov-meta strong { font-size: 14px; }
.msw-prov-meta small { font-size: 12px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msw-broker { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.msw-broker summary { cursor: pointer; min-height: 28px; display: flex; align-items: center; font-size: 13px; font-weight: 700; color: var(--ui-text-2); }
.msw-broker[open] summary { margin-bottom: 2px; }
.msw-broker code { overflow-wrap: anywhere; }
.msw-check { display: flex; align-items: center; gap: 8px; font-size: 13px; min-height: 44px; }
.msw-check input { width: 22px; height: 22px; }
.msw-provs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.msw-provs li { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 10px 12px; display: flex; gap: 8px; }
.msw-steps { margin: 0; padding-left: 18px; font-size: 12px; color: color-mix(in srgb, var(--ui-text) 70%, transparent); }
.msw-summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.msw-summary li { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); padding: 12px; font-size: 13.5px; }
.muted { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
@media (min-width: 700px) {
  .msw-body { padding-top: 20px; }
}
</style>
