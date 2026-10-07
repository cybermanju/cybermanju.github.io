<template>
  <div class="am">
    <!-- ── header ─────────────────────────────────────────── -->
    <header class="am-top">
      <div class="am-brand">
        <span class="am-brand-mark"><AppIcon name="solar:user-circle-bold" :size="20" /></span>
        <div>
          <h2 class="am-title">Accounts</h2>
          <p class="am-subtitle">{{ store.syncConfigs.length }} providers · {{ attachedDisks }} disks · {{ identity ? identity.name : 'signed out' }}</p>
        </div>
      </div>
      <div class="am-top-actions">
        <span v-if="dbBackend" class="am-chip" :class="dbBackend === 'memory' ? 'is-warn' : 'is-ok'">
          <AppIcon name="solar:database-bold" :size="12" /> {{ dbBackend === 'memory' ? 'SESSION DB' : dbBackend.toUpperCase() + ' DB' }}
        </span>
        <button class="am-btn" type="button" :disabled="refreshing" @click="refresh">
          <AppIcon name="solar:restart-bold" :size="13" /> {{ refreshing ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <!-- ── merged volume hero ─────────────────────────────── -->
    <section class="am-hero">
      <div class="am-hero-row">
        <div class="am-hero-stat">
          <span class="am-hero-label">Merged volume</span>
          <strong class="am-hero-value">{{ humanBytes(volumeView?.usedBytes ?? 0) }} <span>of {{ humanBytes(volumeView?.totalBytes ?? 0) }}</span></strong>
        </div>
        <div class="am-hero-stat right">
          <span class="am-hero-label">{{ volumeView?.diskCount ?? 0 }} disks attached</span>
          <strong class="am-hero-value">{{ volumePct.toFixed(1) }}<span>% used</span></strong>
        </div>
      </div>
      <div class="am-bar" role="img" :aria-label="`Volume ${volumePct.toFixed(1)} percent used`">
        <div class="am-bar-fill" :style="{ width: `${volumePct}%` }"></div>
      </div>
      <div class="am-hero-legend">
        <span>Free {{ humanBytes(volumeView?.freeBytes ?? 0) }}</span>
        <span v-if="staticHost">Offline demo vault — providers, disks, users and files run here; only provider network sync needs the server.</span>
      </div>
    </section>

    <!-- ── tabs ───────────────────────────────────────────── -->
    <nav class="am-tabs" role="tablist" aria-label="Account sections" @keydown="onTabsKey">
      <button
        v-for="t in TABS"
        :key="t.id"
        :id="`am-tab-${t.id}`"
        role="tab"
        :aria-controls="`am-panel-${t.id}`"
        :aria-selected="activeTab === t.id"
        :tabindex="activeTab === t.id ? 0 : -1"
        class="am-tab"
        :class="{ active: activeTab === t.id }"
        type="button"
        @click="activeTab = t.id"
      >
        <AppIcon :name="t.icon" :size="14" /> {{ t.label }}
        <span v-if="t.id === 'providers' && store.syncConfigs.length" class="am-tab-count">{{ store.syncConfigs.length }}</span>
        <span v-if="t.id === 'signin' && identity" class="am-dot" aria-hidden="true"></span>
        <span v-if="t.id === 'vault' && disk.dirty" class="am-dot warn" aria-hidden="true"></span>
      </button>
    </nav>

    <main class="am-body">
      <!-- ══ SIGN IN ══ -->
      <section v-if="activeTab === 'signin'" id="am-panel-signin" class="am-section" role="tabpanel" aria-labelledby="am-tab-signin" tabindex="0">
        <div v-if="identity" class="am-card am-identity">
          <div class="am-identity-row">
            <img v-if="identity.avatarUrl" class="am-avatar" :src="identity.avatarUrl" alt="" />
            <ProviderLogo v-else :provider="identity.provider" :size="40" />
            <div class="am-identity-meta">
              <strong>{{ identity.name }}</strong>
              <span class="muted">{{ identity.email || identity.provider }}</span>
            </div>
            <span class="am-status is-ok"><ProviderLogo :provider="identity.provider" :size="18" /> {{ identity.provider.toUpperCase() }}</span>
            <button class="am-btn sm" type="button" :disabled="signingOut" @click="signOut">{{ signingOut ? '…' : 'Sign out' }}</button>
          </div>
          <p class="am-hint">Signed in through the Supabase broker — this app stores no password anywhere.</p>
        </div>

        <div v-if="connectedAccounts.length" class="am-card">
          <h3 class="am-card-title">Connected accounts ({{ connectedAccounts.length }})</h3>
          <p class="am-hint">Supabase holds one active session — the rest stay remembered here, so you can switch back in one click, including a second account on the same provider.</p>
          <div v-for="acc in connectedAccounts" :key="acc.id" class="am-identity-row">
            <img v-if="acc.avatarUrl" class="am-avatar" :src="acc.avatarUrl" alt="" />
            <ProviderLogo v-else :provider="acc.provider" :size="32" />
            <div class="am-identity-meta">
              <strong>{{ acc.name }}</strong>
              <span class="muted">{{ acc.email || acc.provider }}</span>
            </div>
            <span class="am-status sm" :class="acc.id === identity?.id ? 'is-ok' : ''">{{ acc.id === identity?.id ? 'ACTIVE' : acc.provider.toUpperCase() }}</span>
            <button v-if="acc.id !== identity?.id" class="am-btn xs primary" type="button" :disabled="!!signInBusy" @click="switchAccount(acc)">Switch</button>
            <button class="am-btn xs" type="button" :title="`Forget ${acc.name}`" @click="forgetAccount(acc.id)">Forget</button>
          </div>
        </div>

        <div class="am-card">
          <h3 class="am-card-title">{{ identity ? 'Add another account' : 'Sign in with a provider' }}</h3>
          <p class="am-hint">Approve at the provider — nothing is typed here. OAuth is the only sign-in; there is no password form. Every login is fresh, so pick any account at the provider — even a second one on the same provider.</p>
          <div class="am-login-grid">
            <button
              v-for="p in LOGIN_CARDS"
              :key="p.id"
              class="am-login"
              type="button"
              :disabled="signInBusy === p.id || !sbConfigured"
              :title="sbConfigured ? `Continue with ${p.label}` : 'Set Supabase URL + key first'"
              @click="signIn(p.id)"
            >
              <ProviderLogo :provider="p.logo" :size="36" />
              <span class="am-login-label">{{ signInBusy === p.id ? 'Opening…' : `Continue with ${p.label}` }}</span>
              <span class="am-login-sub">{{ p.sub }}</span>
            </button>
          </div>
          <p v-if="signInMsg" class="am-note">{{ signInMsg }}</p>
          <div v-if="!sbConfigured" class="am-banner warn">
            <AppIcon name="solar:key-bold" :size="15" />
            <span>Broker not configured — set the Supabase URL + key, and enable the provider under Supabase → Authentication → Sign-in.</span>
            <button class="am-btn sm primary" type="button" @click="openSettings">Configure</button>
          </div>
        </div>
      </section>

      <!-- ══ VAULT FILE ══ -->
      <section v-if="activeTab === 'vault'" id="am-panel-vault" class="am-section" role="tabpanel" aria-labelledby="am-tab-vault" tabindex="0">
        <div class="am-card" :class="{ 'is-attached': disk.attached }">
          <div class="am-card-head">
            <div class="am-card-head-left">
              <ProviderLogo provider="local" :size="34" />
              <div>
                <h3 class="am-card-title">{{ disk.attached ? disk.name : 'No vault file attached' }}</h3>
                <p class="am-hint">
                  <template v-if="disk.attached">
                    <span class="am-status sm" :class="disk.dirty ? 'is-warn' : 'is-ok'">{{ disk.dirty ? 'Unsaved changes' : `Saved ${timeOf(disk.savedAt)}` }}</span>
                    <span class="muted"> · {{ humanBytes(disk.savedBytes) }}</span>
                  </template>
                  <template v-else>The vault lives in this browser session only. Create or open a <code class="am-code">.cybermanju</code> file to keep it on your disk.</template>
                </p>
              </div>
            </div>
            <span class="am-status sm" :class="disk.bound ? 'is-ok' : ''">{{ disk.bound ? 'BOUND' : 'SESSION ONLY' }}</span>
          </div>

          <div class="am-btn-grid">
            <button class="am-btn primary" type="button" :disabled="disk.busy" @click="openDiskFile"><AppIcon name="solar:folder-open-bold" :size="13" /> {{ disk.busy ? '…' : 'Open' }}</button>
            <button class="am-btn primary" type="button" :disabled="disk.busy" @click="createDiskFile"><AppIcon name="solar:add-bold" :size="13" /> Create</button>
            <button class="am-btn" type="button" :disabled="disk.busy || !disk.bound" @click="saveDiskFile"><AppIcon name="solar:diskette-bold" :size="13" /> Save now</button>
            <button class="am-btn" type="button" :disabled="disk.busy" @click="exportDiskFile"><AppIcon name="solar:download-bold" :size="13" /> Export</button>
            <button class="am-btn" type="button" :disabled="disk.busy" @click="pickImport"><AppIcon name="solar:upload-bold" :size="13" /> Import</button>
            <button v-if="disk.bound" class="am-btn danger" type="button" :disabled="disk.busy" @click="detachDiskFile">Detach</button>
          </div>
          <input ref="importInput" type="file" accept=".cybermanju,application/octet-stream" class="am-hidden" @change="onImportFile" />

          <label class="am-field">
            <span class="am-field-label">Passphrase <span class="muted">(optional — encrypts the file, never stored)</span></span>
            <span class="am-input-wrap">
              <input
                v-model="diskPassphrase"
                class="am-input"
                :type="showDiskPass ? 'text' : 'password'"
                placeholder="Passphrase for create / unlock"
                autocomplete="new-password"
                aria-label="File passphrase"
              />
              <button class="am-icon-btn" type="button" :title="showDiskPass ? 'Hide' : 'Show'" @click="showDiskPass = !showDiskPass">
                <AppIcon :name="showDiskPass ? 'solar:eye-closed-bold' : 'solar:eye-bold'" :size="14" />
              </button>
            </span>
          </label>
          <p class="am-hint">{{ disk.supported ? 'File System Access API available — saves go straight to your disk.' : 'No File System Access API in this browser — use Export / Import instead.' }}</p>

          <div v-if="disk.needsPassphrase" class="am-banner warn">
            <AppIcon name="solar:lock-bold" :size="15" />
            <span><strong>{{ disk.name }}</strong> is encrypted — enter its passphrase to open it.</span>
            <button class="am-btn sm primary" type="button" :disabled="disk.busy" @click="unlockDisk">Unlock &amp; open</button>
          </div>
          <div v-else-if="disk.needsPermission" class="am-banner info">
            <AppIcon name="solar:cursor-bold" :size="15" />
            <span><strong>{{ disk.name }}</strong> is remembered — the browser wants one click to re-open it.</span>
            <button class="am-btn sm primary" type="button" :disabled="disk.busy" @click="unlockDisk">Allow &amp; open</button>
          </div>

          <p v-if="disk.lastMessage" class="am-note">{{ disk.lastMessage }}</p>
          <p v-if="disk.lastError" class="am-note err">{{ disk.lastError }}</p>
          <p v-if="disk.bound && disk.dirty" class="am-note warn">Changes write back automatically — Save now forces it immediately.</p>
        </div>
      </section>

      <!-- ══ PROVIDERS ══ -->
      <section v-if="activeTab === 'providers'" id="am-panel-providers" class="am-section" role="tabpanel" aria-labelledby="am-tab-providers" tabindex="0">
        <div class="am-providers">
          <!-- list -->
          <div class="am-list-col">
            <div class="am-list-head">
              <span class="muted small">{{ filteredConfigs.length }} of {{ store.syncConfigs.length }}</span>
              <button class="am-btn sm primary" type="button" @click="wizOpen = !wizOpen">
                <AppIcon name="solar:add-bold" :size="12" /> {{ wizOpen ? 'Close' : 'Add' }}
              </button>
            </div>
            <label v-if="store.syncConfigs.length > 3" class="am-search">
              <AppIcon name="solar:magnifier-bold" :size="13" />
              <input v-model="provFilter" class="am-search-input" type="search" placeholder="Filter providers…" aria-label="Filter providers" />
            </label>
            <button
              v-for="cfg in filteredConfigs"
              :key="cfg.id"
              type="button"
              class="am-prov"
              :class="{ active: selectedId === cfg.id }"
              @click="selectedId = cfg.id"
            >
              <ProviderLogo :provider="logoKindFor(cfg.backendType)" :size="34" />
              <span class="am-prov-meta">
                <strong class="am-prov-name">{{ cfg.name || backendLabel(cfg.backendType) }}<span v-if="isDraftDirty(cfg)" class="am-unsaved" title="Unsaved edits" aria-label="Unsaved edits">●</span></strong>
                <span class="muted small">{{ backendLabel(cfg.backendType) }} · {{ disksFor(cfg.id).length }} disks</span>
              </span>
              <span class="am-status sm" :class="statusTone(cfg.id)">{{ authLabel(cfg.id) }}</span>
              <span class="am-switch" :class="{ on: cfg.enabled }" :title="cfg.enabled ? 'Enabled' : 'Disabled'"></span>
            </button>
            <p v-if="store.syncConfigs.length && !filteredConfigs.length" class="am-hint">No providers match “{{ provFilter }}”. <button class="am-link" type="button" @click="provFilter = ''">Clear filter</button></p>
            <div v-if="!store.syncConfigs.length && !wizOpen" class="am-card">
              <UiEmpty
                icon="solar:cloud-bold"
                title="No providers yet"
                description="Connect GitHub, GitLab, Google Drive or a local folder to start syncing."
              >
                <template #actions>
                  <button class="am-btn sm primary" type="button" @click="wizOpen = true"><AppIcon name="solar:add-bold" :size="12" /> Add provider</button>
                </template>
              </UiEmpty>
            </div>

            <!-- add-provider wizard -->
            <div v-if="wizOpen" class="am-card am-wiz">
              <h3 class="am-card-title">Add provider</h3>
              <div class="am-logo-picker" role="radiogroup" aria-label="Provider type">
                <button
                  v-for="b in BACKEND_ORDER"
                  :key="b"
                  type="button"
                  role="radio"
                  :aria-checked="wiz.backendType === b"
                  class="am-logo-pick"
                  :class="{ active: wiz.backendType === b }"
                  :title="backendLabel(b)"
                  @click="wiz.backendType = b"
                >
                  <ProviderLogo :provider="logoKindFor(b)" :size="30" />
                  <span>{{ shortName(b) }}</span>
                </button>
              </div>
              <p class="am-hint">{{ backendBlurb(wiz.backendType) }}</p>
              <label class="am-field">
                <span class="am-field-label">Display name</span>
                <input v-model="wiz.name" class="am-input" placeholder="e.g. Work GitHub" aria-label="Display name" />
              </label>
              <div class="am-fields">
                <label v-for="f in fieldsFor(wiz.backendType)" :key="f.key" class="am-field" :class="{ grow: f.grow }">
                  <span class="am-field-label">{{ f.label }}</span>
                  <span class="am-input-wrap" v-if="f.secret">
                    <input v-model="(wiz as any)[f.key]" class="am-input" :type="showWizToken ? 'text' : 'password'" :placeholder="f.placeholder" autocomplete="off" />
                    <button class="am-icon-btn" type="button" @click="showWizToken = !showWizToken" :title="showWizToken ? 'Hide' : 'Show'"><AppIcon :name="showWizToken ? 'solar:eye-closed-bold' : 'solar:eye-bold'" :size="14" /></button>
                  </span>
                  <input v-else v-model="(wiz as any)[f.key]" class="am-input" :placeholder="f.placeholder" autocomplete="off" />
                  <span v-if="f.hint" class="am-field-hint">{{ f.hint }}</span>
                </label>
              </div>
              <p class="am-hint">{{ authGuidance(wiz.backendType) }}</p>
              <p v-if="wiz.backendType === 'github' || wiz.backendType === 'gitlab'" class="am-hint">No repo yet? Save with just a token (skip the repo field), then use <strong>New private vault repo</strong> in the provider detail to create + sync one.</p>
              <div class="am-row">
                <button class="am-btn sm primary" type="button" :disabled="wizBusy" @click="addProvider(true)">{{ wizBusy ? 'Verifying…' : 'Save & verify' }}</button>
                <button class="am-btn sm" type="button" :disabled="wizBusy" @click="addProvider(false)">Save</button>
                <button class="am-btn sm" type="button" :disabled="wizBusy" @click="resetWizard()">Reset</button>
                <span v-if="wizMsg" class="am-note" :class="wizOk === false ? 'err' : wizOk === true ? 'ok' : ''" style="margin:0;" role="status">{{ wizMsg }}</span>
              </div>
            </div>
          </div>

          <!-- detail -->
          <div v-if="selectedCfg" class="am-detail-col">
            <article class="am-card am-detail">
              <header class="am-card-head">
                <div class="am-card-head-left">
                  <ProviderLogo :provider="logoKindFor(selectedCfg.backendType)" :size="40" />
                  <div>
                    <h3 class="am-card-title">{{ selectedCfg.name || backendLabel(selectedCfg.backendType) }}</h3>
                    <p class="am-hint">{{ backendLabel(selectedCfg.backendType) }} · {{ backendBlurb(selectedCfg.backendType) }}</p>
                  </div>
                </div>
                <span class="am-status" :class="statusTone(selectedCfg.id)">{{ authLabel(selectedCfg.id) }}</span>
              </header>

              <div class="am-row wrap">
                <button class="am-btn sm" :class="{ on: selectedCfg.enabled }" type="button" @click="toggleEnabled(selectedCfg!)">{{ selectedCfg.enabled ? 'Enabled' : 'Disabled' }}</button>
                <button class="am-btn sm" type="button" :disabled="probing.has(selectedCfg.id)" @click="probe(selectedCfg!)">{{ probing.has(selectedCfg.id) ? 'Testing…' : 'Test connection' }}</button>
                <button class="am-btn sm" type="button" @click="quota(selectedCfg!)">Quota</button>
                <button class="am-btn sm danger" type="button" @click="removeProvider(selectedCfg!.id)">Delete</button>
                <span v-if="quotaMsg[selectedCfg.id]" class="muted small">{{ quotaMsg[selectedCfg.id] }}</span>
              </div>
              <p v-if="authDetail(selectedCfg.id)" class="am-note" :class="authState[selectedCfg.id]?.ok === false ? 'err' : ''" :title="authHint(selectedCfg.id)">{{ authDetail(selectedCfg.id) }}</p>

              <!-- step 1: connect -->
              <div v-if="isOauthCapable(selectedCfg.backendType) && !staticHost" class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">1</span> Connect with OAuth</h4>
                <div class="am-row">
                  <ProviderLogo :provider="logoKindFor(selectedCfg.backendType)" :size="24" />
                  <span class="small">Browser approval — no password typed here.</span>
                  <button class="am-btn sm primary" type="button" :disabled="oauthBusy === selectedCfg.id" @click="oauthConnect(selectedCfg!)">{{ oauthBusy === selectedCfg.id ? 'Waiting…' : 'Connect with OAuth' }}</button>
                </div>
                <p v-if="oauthMsg[selectedCfg.id]" class="am-note">{{ oauthMsg[selectedCfg.id] }}</p>
                <p v-if="oauthBusy === selectedCfg.id" class="am-note">Approve in the opened browser tab — this panel polls until credentials land. <button class="am-link" type="button" @click="cancelOauth">cancel</button></p>
                <p v-if="oauthUrl[selectedCfg.id]" class="am-note">Popup blocked? Open manually: <span class="am-code">{{ oauthUrl[selectedCfg.id] }}</span></p>
              </div>
              <div v-if="isOauthCapable(selectedCfg.backendType) && staticHost" class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">1</span> Connect with OAuth <span class="muted">via Supabase</span></h4>
                <div class="am-row">
                  <ProviderLogo :provider="logoKindFor(selectedCfg.backendType)" :size="24" />
                  <span class="small">Approve at the provider, token lands here.</span>
                  <button class="am-btn sm primary" type="button" :disabled="sbBusy === selectedCfg.id" @click="supabaseConnect(selectedCfg!)">{{ sbBusy === selectedCfg.id ? 'Waiting…' : 'Connect with OAuth' }}</button>
                </div>
                <p v-if="sbMsg[selectedCfg.id]" class="am-note">{{ sbMsg[selectedCfg.id] }}</p>
                <p v-if="sbBusy === selectedCfg.id" class="am-note">Approve in the popup — polling for the provider token… <button class="am-link" type="button" @click="cancelSupabase">cancel</button></p>
                <div v-if="!sbConfigured" class="am-banner warn">
                  <AppIcon name="solar:key-bold" :size="15" />
                  <span>Broker not configured — enable {{ selectedCfg.backendType }} under Supabase → Authentication → Sign-in first.</span>
                  <button class="am-btn sm primary" type="button" @click="openSettings">Configure</button>
                </div>
              </div>

              <!-- step 2: configure -->
              <div class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">2</span> Configure</h4>
                <div class="am-fields">
                  <label class="am-field">
                    <span class="am-field-label">Display name</span>
                    <input v-model="draft(selectedCfg!).name" class="am-input" placeholder="Display name" autocomplete="off" />
                  </label>
                  <label v-for="f in fieldsFor(selectedCfg.backendType)" :key="f.key" class="am-field" :class="{ grow: f.grow }">
                    <span class="am-field-label">{{ f.label }}</span>
                    <span class="am-input-wrap" v-if="f.secret">
                      <input v-model="(draft(selectedCfg!) as any)[f.key]" class="am-input" :type="showTokens[selectedCfg.id] ? 'text' : 'password'" :placeholder="f.placeholder" autocomplete="off" />
                      <button class="am-icon-btn" type="button" @click="showTokens[selectedCfg.id] = !showTokens[selectedCfg.id]" :title="showTokens[selectedCfg.id] ? 'Hide' : 'Show'"><AppIcon :name="showTokens[selectedCfg.id] ? 'solar:eye-closed-bold' : 'solar:eye-bold'" :size="14" /></button>
                    </span>
                    <input v-else v-model="(draft(selectedCfg!) as any)[f.key]" class="am-input" :placeholder="f.placeholder" autocomplete="off" />
                    <span v-if="f.hint" class="am-field-hint">{{ f.hint }}</span>
                  </label>
                </div>
                <p class="am-hint">{{ authGuidance(selectedCfg.backendType) }}</p>
              </div>

              <!-- step 3: verify -->
              <div class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">3</span> Verify &amp; save</h4>
                <div class="am-row">
                  <button class="am-btn sm primary" type="button" :disabled="saving === selectedCfg.id" @click="saveCreds(selectedCfg!)">{{ saving === selectedCfg.id ? 'Saving…' : 'Save & verify' }}</button>
                  <span class="muted small">Uses saved credentials — save first if you just pasted a token.</span>
                </div>
              </div>

              <!-- step 3b: new private vault repo (github/gitlab only) -->
              <div v-if="selectedCfg.backendType === 'github' || selectedCfg.backendType === 'gitlab'" class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">3½</span> New private vault repo</h4>
                <p class="am-hint">No repo yet? Create a private <code class="am-code">{{ selectedCfg.backendType }}</code> repo, seed it with README + manifest + your <code class="am-code">vault.cybermanju</code>, and attach a system disk — one click, fully synced.</p>
                <div class="am-fields">
                  <label class="am-field grow">
                    <span class="am-field-label">New repo name (private)</span>
                    <input v-model="vaultRepoName" class="am-input" placeholder="cybermanju-vault" autocomplete="off" :aria-label="`New private repo name on ${selectedCfg.backendType}`" />
                  </label>
                  <label class="am-field">
                    <span class="am-field-label">System disk</span>
                    <input v-model.number="vaultDiskMb" class="am-input xs-num" type="number" min="64" max="8192" step="64" aria-label="System disk size MB" />
                  </label>
                </div>
                <label class="am-field">
                  <span class="am-field-label">Token for repo creation <span class="muted">(uses the pasted token above, or the saved one)</span></span>
                  <input v-model="vaultRepoToken" class="am-input" type="password" placeholder="paste PAT — or leave empty to reuse the saved token" autocomplete="off" aria-label="Token for repo creation" />
                </label>
                <label class="small muted"><input v-model="vaultIncludeFile" type="checkbox" /> Include current vault file bytes (<code class="am-code">vault.cybermanju</code>) in the seed commit</label>
                <div class="am-row">
                  <button class="am-btn sm primary" type="button" :disabled="vaultBusy" @click="createVaultRepo(selectedCfg!)">{{ vaultBusy ? 'Creating…' : 'Create private repo + sync vault' }}</button>
                  <span v-if="vaultMsg" class="am-note" :class="vaultOk === false ? 'err' : vaultOk === true ? 'ok' : ''" style="margin:0;" role="status">{{ vaultMsg }}</span>
                </div>
                <p v-if="vaultUrl" class="am-note">Repo live: <span class="am-code">{{ vaultUrl }}</span></p>
              </div>

              <!-- disks -->
              <div class="am-step">
                <h4 class="am-step-title"><span class="am-step-n">4</span> System disks on this provider ({{ disksFor(selectedCfg.id).length }})</h4>
                <p v-if="disksFor(selectedCfg.id).length === 0" class="am-hint">No system disk yet — provision one below and this provider contributes space + compute to the merged volume.</p>
                <div v-for="d in disksFor(selectedCfg.id)" :key="d.id" class="am-disk">
                  <div class="am-row between">
                    <strong class="small">{{ d.name || d.id.slice(0, 8) }} · <span class="muted">{{ d.state }} / {{ d.health }}</span></strong>
                    <span class="am-row">
                      <button v-if="d.state !== 'attached'" class="am-btn xs primary" type="button" :disabled="diskBusy === d.id" @click="attachDisk(d.id, selectedCfg!.id)">Attach</button>
                      <button v-else class="am-btn xs" type="button" :disabled="diskBusy === d.id" @click="store.detachDisk(d.id)">Detach</button>
                      <button class="am-btn xs" type="button" :disabled="diskBusy === d.id" @click="store.checkDisk(d.id)">Check</button>
                    </span>
                  </div>
                  <div class="muted small truncate" :title="d.containerPath">FILE {{ d.containerPath }}</div>
                  <div class="am-mini"><div class="am-mini-fill" :style="{ width: `${diskPct(d.usedBytes, d.capacityBytes)}%` }"></div></div>
                  <div class="am-row between small">
                    <span>{{ humanBytes(d.usedBytes) }} / {{ humanBytes(d.capacityBytes) }}</span>
                    <span class="am-row">
                      <input v-model.number="resizeMb[d.id]" class="am-input xs-num" type="number" min="64" max="8192" step="64" :placeholder="String(Math.max(64, Math.round(d.capacityBytes / 1048576)))" :aria-label="`New size MB for ${d.name}`" />
                      <span class="muted">MB</span>
                      <button class="am-btn xs" type="button" :disabled="diskBusy === d.id" @click="applyResize(d.id)">Apply size</button>
                    </span>
                  </div>
                </div>
                <div class="am-newdisk">
                  <label class="small muted">{{ disksFor(selectedCfg.id).length === 0 ? 'Provision system disk' : 'New disk' }} — {{ newDiskMb[selectedCfg.id] ?? 512 }} MB</label>
                  <input v-model.number="newDiskMb[selectedCfg.id]" class="am-slider" type="range" min="64" max="8192" step="64" :aria-label="`New disk size for ${selectedCfg.name || selectedCfg.backendType}`" />
                  <input v-model="newDiskPass[selectedCfg.id]" class="am-input" type="password" placeholder="Passphrase (also unlocks)" autocomplete="off" :aria-label="`Passphrase for new disk on ${selectedCfg.name || selectedCfg.backendType}`" />
                  <button class="am-btn sm primary" type="button" :disabled="diskBusy === selectedCfg.id" @click="createDisk(selectedCfg!.id)">{{ diskBusy === selectedCfg.id ? 'Creating…' : disksFor(selectedCfg.id).length === 0 ? 'Provision system disk' : 'Create & attach' }}</button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>

    <!-- ── warnings footer ────────────────────────────────── -->
    <footer class="am-warnings" aria-live="polite">
      <div class="am-warnings-head">
        <AppIcon :name="warnings.some(w => w.level === 'error') ? 'solar:danger-triangle-bold' : warnings.length ? 'solar:info-circle-bold' : 'solar:check-circle-bold'" :size="14" />
        <strong>Warnings</strong>
        <span class="am-tab-count" :class="{ 'is-err': warnings.some(w => w.level === 'error') }">{{ warnings.length }}</span>
        <button v-if="!sbConfigured" class="am-btn xs" type="button" title="Open Settings → OAuth broker" @click="openSettings">Configure broker</button>
      </div>
      <ul v-if="warnings.length" class="am-warnings-list">
        <li v-for="(w, i) in warnings" :key="i" class="am-warning" :class="`is-${w.level}`">
          <AppIcon :name="w.level === 'error' ? 'solar:danger-triangle-bold' : 'solar:info-circle-bold'" :size="13" />
          <span>{{ w.text }}</span>
        </li>
      </ul>
      <p v-else class="am-warnings-empty">All clear — vault file bound, providers verified, session healthy.</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import ProviderLogo from '@/components/ProviderLogo.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { isStaticHost } from '@/composables/useTauri'
import { wasmDbBackend } from '@/composables/useWasmBackend'
import {
  connectedAccounts,
  forgetConnectedAccount,
  getPendingOAuthConfig,
  identity,
  refreshIdentity,
  setPendingOAuthConfig,
  signInWithPopup,
  signOutIdentity,
  startSupabaseOAuth,
  supabaseConfigured,
  supabaseProviderFor,
  supabaseSession,
  supabaseSessionProvider,
  takeProviderTokenStash,
  type ConnectedAccount,
  type OAuthBackend,
} from '@/composables/useSupabase'
import {
  createCyberManjuFile,
  detachCyberManjuFile,
  disk,
  diskSupported,
  exportCyberManjuFile,
  importCyberManjuFile,
  openCyberManjuFile,
  reattachCyberManjuDisk,
  saveCyberManjuFile,
} from '@/composables/useCyberManjuFile'
import { SYNC_BACKEND_INFO, describeSyncError, isOauthCapable } from '@/types'
import type { DiskRow, SyncBackendType, SyncConfig } from '@/types'
import { humanBytes, diskPct } from '@/utils/format'
import {
  authGuidance,
  backendLabel,
  blankCredentialDraft,
  draftToSave,
  overlayDraft,
  refreshDraftFromSaved,
  syncConfigDefaults,
  tokenLabel,
} from '@/utils/providers'
import type { CredentialDraft } from '@/utils/providers'
import { pollUntilTrue } from '@/utils/poll'

const store = useAppStore()
const wm = useWindowManager()

/**
 * "Configure" on the broker banners: open Settings *on* the OAuth broker card
 * instead of dumping the user at Appearance — and wait one tick so a freshly
 * opened Settings window has registered its listener before the event fires.
 */
async function openSettings() {
  wm.open('settings')
  await nextTick()
  window.dispatchEvent(new CustomEvent('cybermanju:settings-focus', { detail: 'oauth-broker' }))
}

/** Roving-tabindex arrow-key navigation for the tab bar. */
function onTabsKey(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const order = TABS.map(t => t.id)
  let i = order.indexOf(activeTab.value)
  if (e.key === 'ArrowRight') i = (i + 1) % order.length
  else if (e.key === 'ArrowLeft') i = (i - 1 + order.length) % order.length
  else if (e.key === 'Home') i = 0
  else i = order.length - 1
  e.preventDefault()
  activeTab.value = order[i]
  const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`#am-tab-${order[i]}`)
  el?.focus()
}

/**
 * Static WASM pack (GitHub Pages): no dashboard behind the page. Accounts,
 * providers, disks, users and files run offline against a real redb
 * `cybermanju.db` in this browser (OPFS-durable, in-memory fallback) via
 * the DB worker. Only provider *network* calls need the server.
 */
const staticHost = isStaticHost()
const dbBackend = ref<string | null>(null)

const refreshing = ref(false)
const saving = ref<string | null>(null)
const probing = ref<Set<string>>(new Set())
const diskBusy = ref<string | null>(null)
const wizBusy = ref(false)
const wizMsg = ref('')
const wizOk = ref<boolean | null>(null)
const provFilter = ref('')
const oauthBusy = ref<string | null>(null)
const oauthAbort = ref<AbortController | null>(null)

const oauthMsg = ref<Record<string, string>>({})
const oauthUrl = ref<Record<string, string>>({})
const quotaMsg = ref<Record<string, string>>({})
const authState = ref<Record<string, { ok: boolean | null; detail: string }>>({})
const sbBusy = ref<string | null>(null)
const sbAbort = ref<AbortController | null>(null)
const sbMsg = ref<Record<string, string>>({})
const sbConfigured = computed(() => supabaseConfigured())

// ── new interactive UI state ──────────────────────────────────
type TabId = 'signin' | 'vault' | 'providers'
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'signin', label: 'Sign in', icon: 'solar:login-bold' },
  { id: 'vault', label: 'Vault file', icon: 'solar:diskette-bold' },
  { id: 'providers', label: 'Connections', icon: 'solar:cloud-bold' },
]
const activeTab = ref<TabId>('signin')
const selectedId = ref<string | null>(null)
const showTokens = ref<Record<string, boolean>>({})
const showDiskPass = ref(false)
const showWizToken = ref(false)
const wizOpen = ref(false)

const BACKEND_ORDER: SyncBackendType[] = ['local', 'github', 'gitlab', 'googleDrive']

function logoKindFor(b: SyncBackendType | string): string {
  return b === 'local' ? 'local' : String(b)
}

function shortName(b: SyncBackendType): string {
  const n = backendLabel(b)
  return n.replace('Google ', '').replace('Local Storage', 'Local')
}

function backendBlurb(b: SyncBackendType): string {
  return SYNC_BACKEND_INFO[b]?.description ?? ''
}

const LOGIN_CARDS: Array<{ id: OAuthBackend; label: string; logo: string; sub: string }> = [
  { id: 'google', label: 'Google', logo: 'google', sub: 'Drive OAuth' },
  { id: 'github', label: 'GitHub', logo: 'github', sub: 'Repo Contents API' },
  { id: 'gitlab', label: 'GitLab', logo: 'gitlab', sub: 'Projects API v4' },
]
const signInBusy = ref<OAuthBackend | null>(null)
const signInMsg = ref('')
const signingOut = ref(false)
const diskPassphrase = ref('')
const importInput = ref<HTMLInputElement | null>(null)

const newDiskMb = ref<Record<string, number>>({})
const newDiskPass = ref<Record<string, string>>({})
const resizeMb = ref<Record<string, number>>({})

// ── private vault repo provisioning (github/gitlab) ──────────────
const vaultRepoName = ref('cybermanju-vault')
const vaultRepoToken = ref('')
const vaultDiskMb = ref(512)
const vaultIncludeFile = ref(true)
const vaultBusy = ref(false)
const vaultMsg = ref('')
const vaultOk = ref<boolean | null>(null)
const vaultUrl = ref('')

const drafts = reactive<Record<string, CredentialDraft>>({})

const wiz = reactive({
  backendType: 'local' as SyncBackendType,
  name: '',
  repoName: '',
  branch: 'main',
  token: '',
  folderId: '',
  basePath: '',
})

/** Restore the add-provider wizard to pristine defaults. */
function resetWizard() {
  wiz.backendType = 'local'
  wiz.name = ''
  wiz.repoName = ''
  wiz.branch = 'main'
  wiz.token = ''
  wiz.folderId = ''
  wiz.basePath = ''
  wizMsg.value = ''
  wizOk.value = null
  showWizToken.value = false
}

const filteredConfigs = computed(() => {
  const q = provFilter.value.trim().toLowerCase()
  if (!q) return store.syncConfigs
  return store.syncConfigs.filter(c => {
    const hay = `${c.name ?? ''} ${backendLabel(c.backendType)} ${c.backendType}`.toLowerCase()
    return hay.includes(q)
  })
})

/** True when the in-memory draft differs from the saved row (or holds an unsaved token). */
function isDraftDirty(cfg: SyncConfig): boolean {
  const d = drafts[cfg.id]
  if (!d) return false
  if (d.token.trim() !== '') return true
  const norm = (v: string | undefined) => (v ?? '').trim()
  return (
    norm(d.name) !== norm(cfg.name) ||
    norm(d.repoName) !== norm(cfg.repoName) ||
    norm(d.branch || 'main') !== norm(cfg.branch || 'main') ||
    norm(d.folderId) !== norm(cfg.folderId) ||
    norm(d.basePath) !== norm(cfg.basePath)
  )
}

const df = computed(() => store.osDf)

// In the static build the OS `df` covers the terminal's virtual volume, so
// the strip instead sums the real attached `.cybermanju` disks — the same
// merge the server reports, computed client-side from the same rows.
const diskVolume = computed(() => {
  const attached = store.disks.filter(d => d.state === 'attached')
  const total = attached.reduce((s, d) => s + (d.capacityBytes || 0), 0)
  const used = attached.reduce((s, d) => s + (d.usedBytes || 0), 0)
  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: Math.max(0, total - used),
    diskCount: attached.length,
    attachedBytes: total,
    scratchBytes: 0,
    root: '/',
  }
})
const volumeView = computed(() => (staticHost ? diskVolume.value : df.value))
const volumePct = computed(() => {
  const d = volumeView.value
  if (!d || d.totalBytes === 0) return 0
  return Math.min(100, (d.usedBytes / d.totalBytes) * 100)
})

const attachedDisks = computed(() => store.disks.filter(d => d.state === 'attached').length)
const selectedCfg = computed<SyncConfig | null>(() => {
  if (selectedId.value) {
    const found = store.syncConfigs.find(c => c.id === selectedId.value)
    if (found) return found
  }
  return store.syncConfigs[0] ?? null
})

watch(
  () => store.syncConfigs.map(c => c.id).join(','),
  () => {
    if (!selectedId.value || !store.syncConfigs.some(c => c.id === selectedId.value)) {
      selectedId.value = store.syncConfigs[0]?.id ?? null
    }
  },
)

// ── dynamic per-backend setup/config schema ───────────────────
interface FieldDef {
  key: 'repoName' | 'branch' | 'folderId' | 'basePath' | 'token'
  label: string
  placeholder: string
  hint?: string
  secret?: boolean
  grow?: boolean
}

function fieldsFor(backend: SyncBackendType): FieldDef[] {
  switch (backend) {
    case 'github':
      return [
        { key: 'repoName', label: 'Repo (owner/repo)', placeholder: 'owner/repo', hint: 'The repository that stores this vault. Needs the repo scope.' },
        { key: 'branch', label: 'Branch', placeholder: 'main' },
        { key: 'token', label: tokenLabel(backend), placeholder: 'paste — optional when using OAuth', secret: true, grow: true },
      ]
    case 'gitlab':
      return [
        { key: 'repoName', label: 'Project ID', placeholder: '12345678', hint: 'Numeric project id (Settings → General in GitLab).' },
        { key: 'branch', label: 'Branch', placeholder: 'main' },
        { key: 'basePath', label: 'Instance URL (self-hosted — empty = gitlab.com)', placeholder: 'https://gitlab.example.com', grow: true },
        { key: 'token', label: tokenLabel(backend), placeholder: 'paste — optional when using OAuth', secret: true, grow: true },
      ]
    case 'googleDrive':
      return [
        { key: 'folderId', label: 'Drive folder ID', placeholder: 'folder id (optional)', hint: 'Empty = app root folder.' },
        { key: 'token', label: tokenLabel(backend), placeholder: 'paste — optional when using OAuth', secret: true, grow: true },
      ]
    default:
      return [
        { key: 'basePath', label: 'Local path', placeholder: '/DATA/SYNC', hint: 'Directory on this machine. No login needed.', grow: true },
      ]
  }
}

// ── sticky warnings footer ────────────────────────────────────
interface Warning {
  level: 'error' | 'warn' | 'info'
  text: string
}

const warnings = computed<Warning[]>(() => {
  const out: Warning[] = []
  if (disk.lastError) out.push({ level: 'error', text: `Vault file: ${disk.lastError}` })
  if (disk.needsPassphrase) out.push({ level: 'warn', text: `${disk.name || 'Vault file'} is encrypted — enter its passphrase in the Vault file tab.` })
  if (disk.needsPermission) out.push({ level: 'warn', text: `${disk.name || 'Vault file'} is remembered — the browser needs one click to re-open it (Vault file tab).` })
  if (!disk.bound) out.push({ level: 'warn', text: 'No vault file bound — the vault lives in this browser session only. Create or open a .cybermanju file.' })
  if (disk.bound && disk.dirty) out.push({ level: 'warn', text: 'Unsaved vault changes — they write back automatically, or press Save now.' })
  if (dbBackend.value === 'memory') out.push({ level: 'warn', text: 'Database is in-memory (OPFS unavailable here) — bind a .cybermanju file and export regularly so nothing is lost on reload.' })
  if (!disk.supported) out.push({ level: 'info', text: 'This browser has no File System Access API — use Export / Import for the vault file.' })
  for (const cfg of store.syncConfigs) {
    const s = authState.value[cfg.id]
    if (!s || s.ok === null) {
      out.push({ level: 'warn', text: `${cfg.name || backendLabel(cfg.backendType)}: connection untested — press Test connection.` })
    } else if (!s.ok) {
      out.push({
        level: isUnreachable(s.detail) ? 'warn' : 'error',
        text: `${cfg.name || backendLabel(cfg.backendType)}: ${isUnreachable(s.detail) ? 'unreachable (network/CORS — token may still be fine)' : `auth failed — ${s.detail}`}`,
      })
    }
  }
  const needsBroker = store.syncConfigs.some(c => isOauthCapable(c.backendType))
  if ((needsBroker || !identity.value) && !sbConfigured.value) {
    out.push({ level: 'warn', text: 'Supabase broker not configured — set the URL + key in Settings → OAuth to sign in and connect providers with OAuth.' })
  }
  if (staticHost) out.push({ level: 'info', text: 'Offline demo vault — provider network calls need the server; everything else runs locally.' })
  if (!identity.value) out.push({ level: 'info', text: 'Not signed in — pick a provider in the Sign in tab.' })
  return out
})

function draft(cfg: SyncConfig): CredentialDraft {
  let d = drafts[cfg.id]
  if (!d) {
    d = blankCredentialDraft({
      repoName: cfg.repoName ?? '',
      branch: cfg.branch ?? 'main',
      folderId: cfg.folderId ?? '',
      basePath: cfg.basePath ?? '',
      name: cfg.name ?? '',
    })
    drafts[cfg.id] = d
  }
  return d
}

function disksFor(configId: string): DiskRow[] {
  return store.disks.filter(d => d.configId === configId)
}

function authLabel(id: string): string {
  const s = authState.value[id]
  if (!s || s.ok === null) return 'UNTESTED'
  if (s.ok) return 'CONNECTED'
  return isUnreachable(s.detail) ? 'UNREACHABLE' : 'AUTH FAILED'
}

function statusTone(id: string): string {
  const s = authState.value[id]
  if (!s || s.ok === null) return ''
  if (s.ok) return 'is-ok'
  return isUnreachable(s.detail) ? 'is-warn' : 'is-err'
}

/** Transport failure (offline / CORS-blocked / timeout) is not a verdict
 * on the token — label it so users don't rotate good credentials. */
function isUnreachable(detail: string): boolean {
  return /(^network:|\bCORS\b|blocked|abort|timed? ?out|Failed to fetch|Load failed)/i.test(detail)
}

function authDetail(id: string): string {
  return authState.value[id]?.detail ?? ''
}

function authHint(id: string): string {
  const d = authDetail(id)
  if (!d) return ''
  const { prefix, hint } = describeSyncError(d)
  return `${prefix}: ${hint}`
}

async function refresh() {
  refreshing.value = true
  await Promise.allSettled([
    store.fetchAccounts(),
    store.fetchSyncConfigs(),
    store.fetchDisks(),
    store.fetchOsDf(),
  ])
  refreshing.value = false
}

async function signIn(provider: OAuthBackend) {
  if (signInBusy.value) return
  signInBusy.value = provider
  signInMsg.value = ''
  try {
    const who = await signInWithPopup(provider)
    store.notifySuccess(`Signed in as ${who.name}`)
  } catch (e) {
    signInMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    signInBusy.value = null
  }
}

async function signOut() {
  signingOut.value = true
  try {
    await signOutIdentity()
    store.notifySuccess('Signed out')
  } finally {
    signingOut.value = false
  }
}

/** Switch to a remembered account: fresh login with its provider — the
 * provider's own chooser picks the account, so a second login on the SAME
 * provider works too. */
async function switchAccount(acc: ConnectedAccount) {
  if (signInBusy.value) return
  await signOutIdentity().catch(() => {})
  await signIn(acc.provider as OAuthBackend)
}

function forgetAccount(id: string) {
  forgetConnectedAccount(id)
}

function timeOf(ts: number): string {
  return ts ? new Date(ts).toLocaleTimeString() : ''
}

async function openDiskFile() {
  await openCyberManjuFile()
}

async function createDiskFile() {
  await createCyberManjuFile(diskPassphrase.value)
}

async function saveDiskFile() {
  const ok = await saveCyberManjuFile()
  if (ok) store.notifySuccess(disk.lastMessage || 'Saved')
}

async function exportDiskFile() {
  await exportCyberManjuFile(diskPassphrase.value || undefined)
}

function pickImport() {
  importInput.value?.click()
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  await importCyberManjuFile(file)
  if (disk.attached) store.notifySuccess(`${disk.name} imported`)
}

async function unlockDisk() {
  await reattachCyberManjuDisk(diskPassphrase.value)
}

async function detachDiskFile() {
  if (!window.confirm('Detach this file? The vault keeps living in this browser session until the file is opened again.')) return
  await detachCyberManjuFile()
}

async function toggleEnabled(cfg: SyncConfig) {
  if (saving.value) return
  saving.value = cfg.id
  try {
    await store.saveSyncConfig({ ...cfg, enabled: !cfg.enabled })
  } finally {
    saving.value = null
  }
}

async function probe(cfg: SyncConfig) {
  if (probing.value.has(cfg.id)) return
  probing.value.add(cfg.id)
  authState.value[cfg.id] = { ok: null, detail: 'probing…' }
  try {
    const r = await store.probeSyncConnection(overlayDraft(cfg, drafts[cfg.id]))
    authState.value[cfg.id] = { ok: r.ok, detail: r.detail }
  } finally {
    probing.value.delete(cfg.id)
  }
}

async function removeProvider(id: string) {
  if (!window.confirm('Delete this provider connection? Its disks stay in the catalog.')) return
  delete drafts[id]
  delete authState.value[id]
  if (selectedId.value === id) selectedId.value = null
  await store.deleteSyncConfig(id)
}

async function saveCreds(cfg: SyncConfig) {
  if (saving.value) return
  const d = draft(cfg)
  saving.value = cfg.id
  try {
    const saved = await store.saveSyncConfig(draftToSave(cfg, d))
    if (!saved) return
    refreshDraftFromSaved(d, saved)
    const r = await store.probeSyncConnection(overlayDraft(saved, d))
    authState.value[cfg.id] = { ok: r.ok, detail: r.detail }
    if (r.ok) store.notifySuccess('Provider verified — credentials work')
  } finally {
    saving.value = null
  }
}

async function quota(cfg: SyncConfig) {
  const u = await store.fetchSyncUsage(cfg.id)
  quotaMsg.value[cfg.id] = u
    ? `quota: ${[u.totalBytes != null ? `total ${humanBytes(u.totalBytes)}` : null, u.usedBytes != null ? `used ${humanBytes(u.usedBytes)}` : null, u.remainingRequests != null ? `${u.remainingRequests} req left` : null].filter(Boolean).join(' · ') || u.detail}`
    : 'quota unavailable'
}

/** PKCE OAuth: open the provider approval, then poll until credentials land. */
async function oauthConnect(cfg: SyncConfig) {
  // No dashboard behind the static build means no server-side callback to
  // land credentials in — say so immediately instead of polling for 2 min.
  // (If Settings → Remote Dashboard points at a server, this build is a
  // REST client and this branch never runs.)
  if (staticHost) {
    oauthMsg.value[cfg.id] =
      'OAuth needs a dashboard for the server callback — set REMOTE DASHBOARD in Settings to your server for full OAuth here, or paste a token below for the offline vault.'
    return
  }
  cancelOauth()
  oauthBusy.value = cfg.id
  oauthMsg.value[cfg.id] = 'Opening provider approval…'
  const res = await store.oauthStart(cfg.backendType, cfg.id)
  if (!res?.authorizeUrl) {
    oauthMsg.value[cfg.id] = 'OAuth did not start — paste a token below instead.'
    oauthBusy.value = null
    return
  }
  const popup = window.open(res.authorizeUrl, 'cyb_oauth', 'width=620,height=720')
  if (!popup) oauthUrl.value[cfg.id] = res.authorizeUrl
  oauthMsg.value[cfg.id] = 'Approve in the browser tab — waiting for the callback…'
  const abort = new AbortController()
  oauthAbort.value = abort
  try {
    const ok = await pollUntilTrue(
      async () => (await store.probeSyncConnection(cfg)).ok,
      {
        intervalMs: 3000,
        maxAttempts: 40,
        signal: abort.signal,
        onAttempt: (n) => {
          oauthMsg.value[cfg.id] = `Approve in the browser tab — waiting… (${n * 3}s)`
        },
      },
    )
    if (ok) {
      authState.value[cfg.id] = { ok: true, detail: 'OAuth credentials verified' }
      oauthMsg.value[cfg.id] = 'Connected — OAuth credentials verified.'
      store.notifySuccess(`${cfg.name || cfg.backendType}: OAuth connected`)
    } else {
      oauthMsg.value[cfg.id] = 'Timed out waiting for approval (2 min). Retry, or paste a token below.'
    }
  } catch {
    oauthMsg.value[cfg.id] = 'Cancelled.'
  } finally {
    oauthAbort.value = null
    oauthBusy.value = null
  }
}

function cancelOauth() {
  oauthAbort.value?.abort()
  oauthAbort.value = null
  oauthBusy.value = null
}

/**
 * Supabase-brokered OAuth (static builds): Supabase's server does the
 * secret-holding exchange; the provider token lands in our session, we save
 * it into the provider config and probe — CONNECTED.
 */
async function supabaseConnect(cfg: SyncConfig) {
  cancelSupabase()
  if (!supabaseConfigured()) {
    sbMsg.value[cfg.id] =
      'Broker not configured — set the Supabase URL + key (Settings → OAuth broker, or bake VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY into the Pages build and redeploy), and enable this provider under Supabase → Authentication → Sign-in.'
    return
  }
  setPendingOAuthConfig(cfg.id)
  const expected = supabaseProviderFor(cfg.backendType)
  let url = ''
  try {
    ;({ url } = await startSupabaseOAuth(cfg.backendType))
  } catch (e) {
    sbMsg.value[cfg.id] = e instanceof Error ? e.message : String(e)
    return
  }
  const popup = window.open(url, 'cyb_sb_oauth', 'width=620,height=720')
  sbBusy.value = cfg.id
  if (!popup) {
    sbMsg.value[cfg.id] = 'Popup blocked — approving in this tab…'
    window.location.href = url
    return
  }
  sbMsg.value[cfg.id] = 'Approve at the provider in the popup — waiting for the token…'
  const abort = new AbortController()
  sbAbort.value = abort
  // Wake up early when the popup reports completion; the shared session
  // stays the source of truth.
  let msgDone = false
  const onMsg = (e: MessageEvent) => {
    try {
      if (e?.data?.type === 'cybermanju:oauth-done') msgDone = true
    } catch {
      // Ignore malformed messages.
    }
  }
  window.addEventListener('message', onMsg)
  try {
    const ok = await pollUntilTrue(
      async () => {
        if (popup.closed && !msgDone) throw new Error('popup-closed')
        let token = ''
        try {
          const session = await supabaseSession()
          const prov = session ? supabaseSessionProvider(session) : null
          // Only accept the token minted for THIS provider — a stale session
          // from an earlier login with another provider must not close the
          // flow early with the wrong credentials.
          if (prov && prov === expected) token = session?.provider_token ?? ''
        } catch {
          token = ''
        }
        if (!token) return false
        try { popup.close() } catch { /* already gone */ }
        await finalizeSupabaseToken(cfg, token)
        return true
      },
      {
        intervalMs: 2000,
        maxAttempts: 90,
        signal: abort.signal,
        onAttempt: (n) => {
          if (n % 10 === 0) sbMsg.value[cfg.id] = `Approve at the provider in the popup — waiting… (${n * 2}s)`
        },
      },
    )
    if (!ok) sbMsg.value[cfg.id] = 'Timed out waiting for approval (3 min). Retry, or paste a token below.'
  } catch (e) {
    sbMsg.value[cfg.id] =
      e instanceof Error && e.message === 'popup-closed'
        ? 'Popup closed before approval — retry, or paste a token below.'
        : 'Cancelled.'
  } finally {
    window.removeEventListener('message', onMsg)
    sbAbort.value = null
    sbBusy.value = null
  }
}

function cancelSupabase() {
  sbAbort.value?.abort()
  sbAbort.value = null
  sbBusy.value = null
}

async function finalizeSupabaseToken(cfg: SyncConfig, token: string) {
  const saved = await store.saveSyncConfig({ ...cfg, token })
  if (!saved) {
    sbMsg.value[cfg.id] = 'Token received, but saving it failed — retry.'
    setPendingOAuthConfig(null)
    return
  }
  const r = await store.probeSyncConnection({ ...saved, token })
  authState.value[cfg.id] = { ok: r.ok, detail: r.detail }
  if (r.ok) {
    sbMsg.value[cfg.id] = 'Connected — provider token verified.'
    store.notifySuccess(`${cfg.name || cfg.backendType}: OAuth connected via Supabase`)
  } else {
    sbMsg.value[cfg.id] = `Token saved, but verification failed: ${r.detail}`
  }
  setPendingOAuthConfig(null)
}

async function attachDisk(diskId: string, configId: string) {
  if (diskBusy.value) return
  diskBusy.value = diskId
  try {
    // The per-provider passphrase field doubles as the unlock secret —
    // no popup prompts. Empty means "no passphrase".
    await store.attachDisk(diskId, newDiskPass.value[configId] ?? '')
  } finally {
    diskBusy.value = null
  }
}

function clampDiskMb(mb: number | undefined, fallback: number): number {
  if (!mb || !Number.isFinite(mb)) return fallback
  return Math.min(8192, Math.max(64, Math.round(mb)))
}

async function applyResize(diskId: string) {
  const disk = store.disks.find(x => x.id === diskId)
  const currentMb = disk ? Math.max(64, Math.round(disk.capacityBytes / (1024 * 1024))) : 512
  const mb = clampDiskMb(resizeMb.value[diskId], currentMb)
  if (diskBusy.value) return
  diskBusy.value = diskId
  try {
    await store.resizeDisk(diskId, mb * 1024 * 1024)
  } finally {
    diskBusy.value = null
  }
}

async function createDisk(configId: string) {
  if (diskBusy.value) return
  diskBusy.value = configId
  try {
    const mb = clampDiskMb(newDiskMb.value[configId], 512)
    await store.createDisk(configId, mb * 1024 * 1024, newDiskPass.value[configId] ?? '')
    newDiskPass.value[configId] = ''
  } finally {
    diskBusy.value = null
  }
}

/**
 * One-click private vault repo: create the repo → save provider config →
 * seed README/manifest (+ vault bytes) → probe → provision + attach a
 * system disk. Token precedence: the repo-creation field, then the
 * configure-step draft, then the saved secret (OAuth).
 */
async function createVaultRepo(cfg: SyncConfig) {
  if (vaultBusy.value) return
  const { validateRepoName, provisionSyncedSystem } = await import('@/utils/gitProvision')
  const { isStaticHost: checkStatic } = await import('@/composables/useTauri')
  vaultBusy.value = true
  vaultMsg.value = ''
  vaultOk.value = null
  vaultUrl.value = ''
  try {
    const problem = validateRepoName(vaultRepoName.value)
    if (problem) {
      vaultMsg.value = problem
      vaultOk.value = false
      return
    }
    const d = drafts[cfg.id]
    const token = vaultRepoToken.value.trim() || d?.token.trim() || ''
    if (cfg.backendType !== 'github' && cfg.backendType !== 'gitlab') {
      vaultMsg.value = 'Vault repos need GitHub or GitLab.'
      vaultOk.value = false
      return
    }
    vaultMsg.value = 'Creating private repo…'
    const repo = await store.createProviderRepo({
      backendType: cfg.backendType,
      configId: token ? undefined : cfg.id,
      token: token || undefined,
      name: vaultRepoName.value.trim(),
      private: true,
      description: 'Private CyberManju OS vault (.cybermanju)',
      branch: (d?.branch.trim() || cfg.branch || 'main'),
      basePath: (d?.basePath.trim() || cfg.basePath || undefined),
    })
    if (!repo) {
      vaultMsg.value = 'Repo creation failed — see the toast for the error prefix.'
      vaultOk.value = false
      return
    }
    vaultUrl.value = repo.url
    vaultMsg.value = `Repo ${repo.fullName} created — seeding vault + attaching disk…`
    // Current vault container bytes for the seed commit (best effort:
    // an unbound session vault still seeds README + manifest).
    let vaultBytes: Uint8Array | null = null
    if (vaultIncludeFile.value) {
      try {
        const { wasmExportDisk } = await import('@/composables/useWasmBackend')
        const out = await wasmExportDisk().catch(() => null) as { bytes?: Uint8Array } | null
        if (out?.bytes && out.bytes.length > 0) vaultBytes = out.bytes
      } catch {
        vaultBytes = null
      }
    }
    const staticHostNow = checkStatic()
    const { config: saved, diskId } = await provisionSyncedSystem({
      backendType: cfg.backendType as 'github' | 'gitlab',
      repo,
      token,
      displayName: `${repo.fullName} vault`,
      instanceUrl: d?.basePath.trim() || cfg.basePath || undefined,
      diskSizeMb: clampDiskMb(vaultDiskMb.value, 512),
      diskPassphrase: newDiskPass.value[cfg.id] ?? '',
      vaultBytes,
      saveConfig: (c) => store.saveSyncConfig({ ...c, id: '' } as SyncConfig),
      seedViaBackend: (c, files) => store.seedRepoFiles(c, files).then((r) => r ?? []),
      probe: (c) => store.probeSyncConnection(c),
      createDisk: async (configId, sizeBytes, passphrase) => {
        const row = await store.createDisk(configId, sizeBytes, passphrase)
        return row ? { id: (row as { id: string }).id } : null
      },
      attachDisk: (diskId, passphrase) => store.attachDisk(diskId, passphrase),
      useDirectSeed: staticHostNow,
    })
    await Promise.allSettled([store.fetchSyncConfigs(), store.fetchDisks()])
    selectedId.value = saved.id
    authState.value[saved.id] = { ok: true, detail: `vault repo ${repo.fullName} verified` }
    vaultRepoToken.value = ''
    vaultMsg.value = diskId
      ? `Synced — ${repo.fullName} holds vault.cybermanju and a ${vaultDiskMb.value} MB system disk is attached.`
      : `Synced — ${repo.fullName} holds the vault (system disk step was skipped, add one in step 4).`
    vaultOk.value = true
    store.notifySuccess(`Private vault repo ${repo.fullName} synced`)
  } catch (e) {
    vaultMsg.value = e instanceof Error ? e.message : String(e)
    vaultOk.value = false
  } finally {
    vaultBusy.value = false
  }
}


function wizToConfig(): Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    ...syncConfigDefaults(),
    backendType: wiz.backendType,
    name: wiz.name.trim() || undefined,
    basePath: wiz.basePath.trim() || undefined,
    repoName: wiz.repoName.trim() || undefined,
    branch: wiz.branch.trim() || undefined,
    token: wiz.token.trim() || undefined,
    folderId: wiz.folderId.trim() || undefined,
  }
}

async function addProvider(verify: boolean) {
  if (wizBusy.value) return
  wizBusy.value = true
  wizMsg.value = ''
  wizOk.value = null
  try {
    const token = wiz.token.trim()
    const saved = await store.saveSyncConfig({ ...(wizToConfig() as SyncConfig), id: '' })
    if (!saved) {
      wizMsg.value = 'Could not save — check the connection and retry.'
      wizOk.value = false
      return
    }
    selectedId.value = saved.id
    activeTab.value = 'providers'
    if (verify) {
      wizMsg.value = 'Verifying…'
      const r = await store.probeSyncConnection(token ? { ...saved, token } : saved)
      authState.value[saved.id] = { ok: r.ok, detail: r.detail }
      if (r.ok) {
        wizMsg.value = 'Verified — provider connected.'
        wizOk.value = true
        store.notifySuccess('Provider verified — credentials work')
        wizOpen.value = false
        resetWizard()
      } else {
        // Keep the wizard open so the failure stays visible and editable.
        wizOpen.value = true
        wizMsg.value = `Saved, but verification failed: ${r.detail}`
        wizOk.value = false
      }
    } else {
      authState.value[saved.id] = { ok: null, detail: '' }
      wizMsg.value = 'Saved.'
      wizOk.value = true
      store.notifySuccess('Provider saved')
      wizOpen.value = false
      resetWizard()
    }
  } finally {
    wizBusy.value = false
  }
}

onMounted(() => {
  disk.supported = diskSupported()
  void refreshIdentity()
  void (async () => {
    await refresh()
    if (!staticHost) return
    void wasmDbBackend().then((b) => {
      dbBackend.value = b
    })
    // Full-redirect resume: the return already stashed the provider token
    // (App boot exchanges ?code=) — finish the link now configs are loaded.
    const stash = takeProviderTokenStash()
    const pending = getPendingOAuthConfig()
    if (stash && pending) {
      const cfg = store.syncConfigs.find(c => c.id === pending)
      if (cfg && supabaseProviderFor(cfg.backendType) === stash.backend) {
        sbMsg.value[cfg.id] = 'Approval received — verifying…'
        await finalizeSupabaseToken(cfg, stash.providerToken)
      } else {
        setPendingOAuthConfig(null)
      }
    }
  })()
})

onBeforeUnmount(() => {
  cancelOauth()
  cancelSupabase()
})
</script>

<style scoped>
.am {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: 13px;
}

/* header */
.am-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.am-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.am-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
  color: var(--ui-accent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent);
}
.am-title { margin: 0; font-size: 15px; letter-spacing: 0.4px; }
.am-subtitle { margin: 1px 0 0; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.am-top-actions { display: flex; align-items: center; gap: 8px; }
.am-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  letter-spacing: 0.6px;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  padding: 3px 9px;
  color: color-mix(in srgb, var(--ui-text) 65%, transparent);
}
.am-chip.is-ok { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.am-chip.is-warn { color: var(--ui-warning); border-color: color-mix(in srgb, var(--ui-warning) 60%, transparent); }

/* hero */
.am-hero {
  margin: 12px 14px 0;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--ui-text) 3%, transparent);
}
.am-hero-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.am-hero-stat { display: flex; flex-direction: column; gap: 2px; }
.am-hero-stat.right { text-align: right; }
.am-hero-label { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.am-hero-value { font-size: 18px; }
.am-hero-value span { font-size: 12px; font-weight: 400; color: color-mix(in srgb, var(--ui-text) 60%, transparent); }
.am-bar { height: 10px; border-radius: 6px; margin-top: 10px; background: color-mix(in srgb, var(--ui-text) 10%, transparent); overflow: hidden; }
.am-bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--ui-accent), var(--ui-info)); transition: width 0.3s ease; }
.am-hero-legend { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 60%, transparent); }

/* tabs */
.am-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 14px 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.am-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 12px;
  cursor: pointer;
  transition:
    color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out),
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    box-shadow var(--ui-dur-fast) var(--ui-ease-out);
  flex-shrink: 0;
}
.am-tab:hover { color: var(--ui-text); border-color: var(--ui-border-strong); }
.am-tab.active { color: var(--ui-text); background: color-mix(in srgb, var(--ui-accent) 14%, transparent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.am-tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.am-tab-count {
  font-size: 10px;
  min-width: 18px;
  text-align: center;
  border-radius: 10px;
  padding: 1px 5px;
  background: color-mix(in srgb, var(--ui-text) 12%, transparent);
}
.am-tab-count.is-err { background: color-mix(in srgb, var(--ui-danger) 25%, transparent); color: var(--ui-danger); }
.am-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ui-accent); flex-shrink: 0; }
.am-dot.warn { background: var(--ui-warning); }
.am-unsaved {
  display: inline-block;
  margin-left: 6px;
  font-size: 9px;
  line-height: 1;
  color: var(--ui-warning);
  vertical-align: super;
}

/* body */
.am-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.am-section { display: flex; flex-direction: column; gap: 10px; }
.am-section:focus { outline: none; }
.am-section:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 60%, transparent);
  outline-offset: -2px;
  border-radius: 8px;
}
.am-card {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  padding: 14px;
  background: color-mix(in srgb, var(--ui-text) 2%, transparent);
}
.am-card.is-attached { border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.am-card-title { margin: 0; font-size: 13px; }
.am-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.am-card-head-left { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.am-hint { margin: 6px 0 0; font-size: 11.5px; line-height: 1.5; color: color-mix(in srgb, var(--ui-text) 60%, transparent); }
.am-code { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ui-info); }
.muted { color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.small { font-size: 11px; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* login grid */
.am-login-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 12px; }
.am-login {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: transform 0.08s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.am-login:hover:not(:disabled) { border-color: var(--ui-accent); box-shadow: 0 4px 18px rgb(0 0 0 / 0.25); transform: translateY(-1px); }
.am-login:disabled { opacity: 0.55; cursor: not-allowed; }
.am-login-label { font-size: 13px; font-weight: 700; }
.am-login-sub { font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.am-identity-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.am-identity-meta { display: flex; flex-direction: column; flex: 1; min-width: 120px; }
.am-avatar { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--ui-border); }

/* status pills */
.am-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  padding: 3px 9px;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
  white-space: nowrap;
}
.am-status.sm { font-size: 9.5px; padding: 2px 8px; }
.am-status.is-ok { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.am-status.is-warn { color: var(--ui-warning); border-color: color-mix(in srgb, var(--ui-warning) 65%, transparent); }
.am-status.is-err { color: var(--ui-danger); border-color: color-mix(in srgb, var(--ui-danger) 60%, transparent); }

/* buttons */
.am-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: color-mix(in srgb, var(--ui-text) 75%, transparent);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.am-btn:hover:not(:disabled) { color: var(--ui-text); border-color: var(--ui-border-strong); }
.am-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.am-btn.primary { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.am-btn.primary:hover:not(:disabled) { background: var(--ui-accent); color: var(--ui-text); }
.am-btn.danger { color: var(--ui-danger); border-color: color-mix(in srgb, var(--ui-danger) 50%, transparent); }
.am-btn.danger:hover:not(:disabled) { background: var(--ui-danger); color: #fff; }
.am-btn.sm { font-size: 11px; padding: 5px 10px; }
.am-btn.xs { font-size: 10px; padding: 3px 8px; border-radius: 6px; }
.am-btn.on { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.am-icon-btn { background: none; border: none; color: color-mix(in srgb, var(--ui-text) 55%, transparent); cursor: pointer; padding: 4px; display: inline-flex; border-radius: 6px; }
.am-icon-btn:hover { color: var(--ui-text); }
.am-icon-btn:focus-visible, .am-link:focus-visible, .am-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.am-link { background: none; border: none; color: var(--ui-info); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; border-radius: 4px; }
.am-btn-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.am-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.am-row.between { justify-content: space-between; }
.am-row.wrap { flex-wrap: wrap; }

/* fields */
.am-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
.am-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; min-width: 0; }
.am-field.grow { grid-column: 1 / -1; }
.am-field-label { font-size: 10px; letter-spacing: 0.8px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.am-field-hint { font-size: 10.5px; color: color-mix(in srgb, var(--ui-text) 50%, transparent); line-height: 1.4; }
.am-input {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 12px;
  padding: 8px 10px;
  outline: none;
  min-width: 0;
  width: 100%;
}
.am-input:focus { border-color: var(--ui-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 15%, transparent); }
.am-input.xs-num { width: 76px; }
.am-input-wrap { display: flex; align-items: center; gap: 4px; }
.am-input-wrap .am-input { flex: 1; }
.am-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  min-height: 32px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: color-mix(in srgb, var(--ui-text) 55%, transparent);
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out), box-shadow var(--ui-dur-fast) var(--ui-ease-out);
}
.am-search:focus-within {
  border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 14%, transparent);
  color: var(--ui-text);
}
.am-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 12px;
  padding: 7px 0;
}
.am-search-input::placeholder { color: color-mix(in srgb, var(--ui-text) 40%, transparent); }
.am-search-input::-webkit-search-cancel-button { cursor: pointer; }
.am-slider { flex: 1; min-width: 140px; accent-color: var(--ui-accent); }
.am-hidden { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* banners + notes */
.am-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 10px 12px;
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid;
}
/* text owns the free space so icon + message + action can never collide */
.am-banner > span:not(.am-btn):not(.app-icon) { flex: 1 1 auto; min-width: 0; }
.am-banner.warn { border-color: color-mix(in srgb, var(--ui-warning) 55%, transparent); background: color-mix(in srgb, var(--ui-warning) 10%, transparent); }
.am-banner.info { border-color: color-mix(in srgb, var(--ui-info) 50%, transparent); background: color-mix(in srgb, var(--ui-info) 8%, transparent); }
.am-banner .am-btn { margin-left: auto; flex-shrink: 0; }
.am-note { margin: 8px 0 0; font-size: 11.5px; color: var(--ui-info); white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.am-note.warn { color: var(--ui-warning); }
.am-note.err { color: var(--ui-danger); }
.am-note.ok { color: var(--ui-accent); }

/* providers split */
.am-providers { display: grid; grid-template-columns: 250px 1fr; gap: 10px; align-items: start; }
@media (max-width: 720px) { .am-providers { grid-template-columns: 1fr; } }
.am-list-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.am-list-head { display: flex; align-items: center; justify-content: space-between; }
.am-prov {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-text);
  font-family: inherit;
  cursor: pointer;
}
.am-prov:hover { border-color: var(--ui-border-strong); }
.am-prov:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.am-prov.active { border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent); background: color-mix(in srgb, var(--ui-accent) 8%, transparent); }
.am-prov-meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.am-prov-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-switch { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--ui-border-strong); flex-shrink: 0; }
.am-switch.on { background: var(--ui-accent); border-color: var(--ui-accent); }
.am-detail-col { min-width: 0; }
.am-step { border-top: 1px dashed var(--ui-border); padding-top: 12px; margin-top: 12px; }
.am-step-title { margin: 0 0 8px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 60%, transparent); display: flex; align-items: center; gap: 8px; }
.am-step-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  background: color-mix(in srgb, var(--ui-accent) 18%, transparent);
  color: var(--ui-accent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 50%, transparent);
}

/* logo picker */
.am-logo-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
.am-logo-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  font-size: 10px;
  font-family: inherit;
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  cursor: pointer;
}
.am-logo-pick:hover { border-color: var(--ui-border-strong); color: var(--ui-text); }
.am-logo-pick:focus-visible, .am-login:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 75%, transparent);
  outline-offset: 2px;
}
.am-logo-pick.active { border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent); color: var(--ui-text); background: color-mix(in srgb, var(--ui-accent) 8%, transparent); }
.am-wiz { margin-top: 4px; }

/* disks */
.am-disk { border: 1px solid var(--ui-border); border-radius: 10px; padding: 10px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.am-mini { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--ui-text) 8%, transparent); overflow: hidden; }
.am-mini-fill { height: 100%; background: var(--ui-accent); border-radius: 4px; }
.am-newdisk { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; border: 1px dashed var(--ui-border); border-radius: 10px; padding: 10px; }

/* warnings footer */
.am-warnings {
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-warning) 5%, transparent);
  padding: 10px 14px;
  max-height: 168px;
  overflow-y: auto;
}
.am-warnings-head { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.am-warnings-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.am-warning { display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; line-height: 1.45; }
.am-warning.is-error { color: var(--ui-danger); }
.am-warning.is-warn { color: var(--ui-warning); }
.am-warning.is-info { color: color-mix(in srgb, var(--ui-text) 65%, transparent); }
.am-warnings-empty { margin: 8px 0 0; font-size: 11.5px; color: var(--ui-accent); }

/* motion + density polish: respect reduced motion, keep narrow windows usable */
@media (prefers-reduced-motion: reduce) {
  .am-bar-fill, .am-tab, .am-login, .am-prov, .am-btn, .am-logo-pick { transition: none; }
}
@media (max-width: 560px) {
  .am-top { flex-wrap: wrap; }
  .am-hero-legend { flex-direction: column; gap: 4px; }
  .am-btn-grid { gap: 6px; }
  .am-login-grid { grid-template-columns: 1fr; }
  .am-logo-picker { grid-template-columns: repeat(2, 1fr); }
}
</style>
