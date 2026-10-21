<script setup lang="ts">
// CyberManju OS — explicit Other App screen selection. No voice coupling.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAndroidApps } from '@/composables/useAndroidApps'
import { useAppScreenReader } from '@/composables/useAppScreenReader'
import type { AndroidApp } from '@/types'
import UiButton from '@/components/ui/UiButton.vue'

const installed = useAndroidApps()
const reader = useAppScreenReader()
const mode = ref<'one' | 'batch' | null>(null)
const query = ref('')
const selected = ref<string[]>([])
const consent = ref(false)
const appsError = ref('')
const failedIcons = ref(new Set<string>())
const filteredApps = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return [...installed.apps.value]
    .filter(app => !search || `${app.label} ${app.packageName}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => a.label.localeCompare(b.label) || a.packageName.localeCompare(b.packageName))
})
const canStart = computed(() => installed.supported && reader.checked.value && reader.status.value.overlayGranted
  && !reader.busy.value && !reader.active.value && !reader.uncertain.value && consent.value)
const sessionApps = computed(() => reader.status.value.packages.map(packageName => ({
  packageName, label: installed.apps.value.find(app => app.packageName === packageName)?.label || packageName,
  locked: reader.status.value.captures.some(capture => capture.packageName === packageName),
  current: reader.status.value.packageName === packageName,
})))
const phaseText = computed(() => ({
  idle: 'Ready to choose apps', awaiting_permission: 'Waiting for Android permission', selecting: 'Place the app on the target screen, then tap Select screen in the overlay',
  reading: 'Screen selected · sharing session active', stopped: 'Session stopped', cancelled: 'Permission cancelled · session not running', error: 'Screen session needs attention',
}[reader.status.value.state]))
async function chooseMode(value: 'one' | 'batch') {
  mode.value = value
  selected.value = []
  query.value = ''
  appsError.value = ''
  try { await installed.refresh() }
  catch (cause) { appsError.value = cause instanceof Error ? cause.message : String(cause) }
}
async function reloadApps() {
  appsError.value = ''
  try { await installed.refresh(true) }
  catch (cause) { appsError.value = cause instanceof Error ? cause.message : String(cause) }
}
function toggleApp(packageName: string) {
  if (!selected.value.includes(packageName) && selected.value.length >= 20) return
  selected.value = selected.value.includes(packageName) ? selected.value.filter(pkg => pkg !== packageName) : [...selected.value, packageName]
}
function validIcon(app: AndroidApp) {
  return !failedIcons.value.has(app.packageName) && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(app.iconBase64)
}
function failIcon(packageName: string) { failedIcons.value = new Set([...failedIcons.value, packageName]) }
async function start(packages: string[]) {
  if (!canStart.value) return
  await reader.start(packages, mode.value === 'batch' ? 'batch' : 'single')
  // Every new session requires another explicit acknowledgement.
  consent.value = false
}
let timer: ReturnType<typeof setTimeout> | undefined
let alive = true
function schedule() {
  clearTimeout(timer)
  if (!alive || document.hidden) return
  timer = setTimeout(async () => {
    if (reader.active.value || reader.uncertain.value) await reader.refresh(true)
    schedule()
  }, 1500)
}
async function refreshStatus() { await reader.refresh(); if (alive) schedule() }
function onVisibility() {
  clearTimeout(timer)
  if (!document.hidden) void refreshStatus()
}
onMounted(() => {
  if (installed.supported) void refreshStatus()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onVisibility)
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onVisibility)
  // Closing this window does not silently stop or restart the native service.
})
</script>

<template>
  <section class="phone-reader" aria-label="Other App screen reader">
    <h3>Other App</h3>
    <p v-if="!installed.supported" class="reader-disclosure" role="status">Installed apps and the screen-selection overlay are available only in the Android app. This browser cannot list or open your installed apps.</p>
    <template v-else>
      <div class="reader-disclosure">
        <strong>Visible, permission-based screen sharing</strong>
        <p>Screen reading may expose sensitive content. Only choose apps and screens you want to read. Android asks for screen-capture permission for each session. The shared visible screen may include other apps you show during the session. A visible overlay and persistent notification let you stop at any time.</p>
        <p>“Lock” selects a local snapshot; it does not freeze the other app. Hidden apps cannot be monitored. Secure screens may be blank. Every new session requires fresh Android permission.</p>
        <p><strong>Text recognition (OCR) is still being integrated and has not been validated for release. Selecting a screen does not confirm that its text has been read.</strong></p>
      </div>
      <div class="reader-actions">
        <UiButton :active="mode === 'one'" :disabled="reader.busy.value || reader.active.value || reader.uncertain.value" @click="chooseMode('one')">1 app</UiButton>
        <UiButton :active="mode === 'batch'" :disabled="reader.busy.value || reader.active.value || reader.uncertain.value" @click="chooseMode('batch')">2+ apps</UiButton>
        <UiButton size="sm" :loading="reader.busy.value" @click="refreshStatus">Refresh status</UiButton>
      </div>
      <div v-if="reader.checked.value && !reader.status.value.overlayGranted" class="reader-disclosure">
        <p>Allow CyberManju to display its screen-selection controls over other apps, then return here and refresh status.</p>
        <UiButton :disabled="reader.busy.value || reader.active.value" @click="reader.overlaySettings">Allow selection overlay</UiButton>
      </div>
      <div v-if="reader.active.value || reader.uncertain.value || ['error', 'cancelled', 'stopped'].includes(reader.status.value.state)" class="reader-session" aria-label="Screen-reading session">
        <strong role="status">{{ phaseText }}</strong>
        <p v-if="reader.status.value.limitation">{{ reader.status.value.limitation }}</p>
        <p v-if="reader.status.value.lastError" role="alert" class="reader-error">{{ reader.status.value.lastError }}</p>
        <p v-if="reader.uncertain.value">The last request is not confirmed. Check the Android notification and refresh status; do not start another session yet.</p>
        <ol v-if="sessionApps.length" class="reader-progress" aria-label="Batch progress">
          <li v-for="app in sessionApps" :key="app.packageName"><strong>{{ app.label }}</strong> · {{ app.locked ? 'Screen selected' : app.current ? 'Choose screen in overlay' : 'Waiting' }}</li>
        </ol>
        <p v-if="reader.active.value">Use Select screen in the Android overlay to lock the current screen. In a batch, use Next app in the overlay to continue to the next target. Closing this dialog does not stop the service; use Stop here or in its notification.</p>
        <UiButton v-if="reader.active.value || reader.uncertain.value" variant="danger" :disabled="reader.busy.value" @click="reader.stop">Stop screen reading</UiButton>
      </div>
      <p v-if="reader.error.value" role="alert" class="reader-error">{{ reader.error.value }}</p>
      <template v-if="mode && !reader.active.value && !reader.uncertain.value">
        <p>{{ mode === 'one' ? 'Tap an app once to open it with the screen-selection overlay.' : 'Select 2–20 apps, then tap Batch. Each app opens in the order you select it.' }}</p>
        <label class="reader-consent"><input v-model="consent" type="checkbox" :disabled="reader.busy.value" /> I want to start a visible screen-reading session for the apps I choose.</label>
        <label class="reader-search"><span>Search installed apps</span><input v-model="query" type="search" placeholder="App name or package" aria-label="Search installed apps" /></label>
        <div class="reader-actions">
          <span role="status">{{ installed.apps.value.length }} installed apps{{ mode === 'batch' ? ` · ${selected.length} selected` : '' }}</span>
          <UiButton size="sm" :loading="installed.status.value === 'loading'" @click="reloadApps">Refresh apps</UiButton>
          <UiButton v-if="mode === 'batch'" :disabled="!canStart || selected.length < 2 || selected.length > 20" :loading="reader.busy.value" @click="start(selected)">Batch ({{ selected.length }})</UiButton>
        </div>
        <p v-if="mode === 'batch' && selected.length >= 20" role="status">This session supports up to 20 apps. Deselect one to choose another.</p>
        <p v-if="installed.status.value === 'loading'" role="status">Loading installed apps…</p>
        <p v-else-if="!filteredApps.length" role="status">{{ installed.apps.value.length ? 'No apps match your search.' : 'Android returned no launchable apps. Refresh the list to try again.' }}</p>
        <p v-if="appsError" role="alert" class="reader-error">{{ appsError }}</p>
        <div class="reader-apps" :aria-busy="installed.status.value === 'loading'" aria-label="Installed apps">
          <template v-for="app in filteredApps" :key="app.packageName">
            <button v-if="mode === 'one'" type="button" class="reader-app" :disabled="!canStart" :aria-label="`Open ${app.label} for screen selection`" @click="start([app.packageName])">
              <img v-if="validIcon(app)" :src="app.iconBase64" alt="" width="36" height="36" @error="failIcon(app.packageName)" />
              <span v-else class="reader-app-fallback" aria-hidden="true">{{ app.label.slice(0, 1).toLocaleUpperCase() }}</span>
              <span class="reader-app-name"><strong>{{ app.label }}</strong><small>{{ app.packageName }}</small></span>
            </button>
            <label v-else class="reader-app" :class="{ 'is-selected': selected.includes(app.packageName) }">
              <input type="checkbox" :checked="selected.includes(app.packageName)" :disabled="reader.busy.value || (selected.length >= 20 && !selected.includes(app.packageName))" :aria-label="`Select ${app.label}`" @change="toggleApp(app.packageName)" />
              <img v-if="validIcon(app)" :src="app.iconBase64" alt="" width="36" height="36" @error="failIcon(app.packageName)" />
              <span v-else class="reader-app-fallback" aria-hidden="true">{{ app.label.slice(0, 1).toLocaleUpperCase() }}</span>
              <span class="reader-app-name"><strong>{{ app.label }}</strong><small>{{ app.packageName }}</small></span>
            </label>
          </template>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.phone-reader { min-width: 0; }
.phone-reader h3 { margin: 0 0 10px; }
.phone-reader p { line-height: 1.5; margin: 8px 0; }
.reader-disclosure, .reader-session { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); padding: 12px; margin: 10px 0; overflow-wrap: anywhere; }
.reader-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
.reader-search { display: grid; gap: 6px; margin: 12px 0; }
.reader-search input { width: 100%; min-width: 0; box-sizing: border-box; min-height: 44px; padding: 8px; background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); }
.reader-consent { display: flex; align-items: flex-start; gap: 9px; line-height: 1.5; }
.reader-consent input, .reader-app input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--ui-accent); }
.reader-apps { display: grid; gap: 6px; max-height: 40vh; overflow-y: auto; overscroll-behavior: contain; }
.reader-app { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; box-sizing: border-box; padding: 9px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); text-align: left; font: inherit; cursor: pointer; }
.reader-app:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.reader-app:disabled { opacity: .55; cursor: not-allowed; }
.reader-app.is-selected { border-color: var(--ui-accent); background: var(--ui-accent-softer); }
.reader-app img, .reader-app-fallback { flex-shrink: 0; object-fit: contain; width: 36px; height: 36px; }
.reader-app-fallback { display: grid; place-items: center; border-radius: 8px; background: var(--ui-accent-softer); color: var(--ui-accent); }
.reader-app-name { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.reader-app-name small { color: var(--ui-text-muted); }
.reader-progress { padding-left: 22px; overflow-wrap: anywhere; }
.reader-error { color: var(--ui-danger); overflow-wrap: anywhere; }
</style>
