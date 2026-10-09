<template>
  <div class="dv">
    <header class="dv-top">
      <div class="dv-brand">
        <span class="dv-brand-mark"><AppIcon name="solar:cpu-bold" :size="20" /></span>
        <div>
          <h2 class="dv-title">Devices</h2>
          <p class="dv-subtitle">{{ hw.pluggedDevices.value.length }} plugged · {{ netLine }} · {{ powerLine }}</p>
        </div>
      </div>
      <div class="dv-top-actions">
        <UiButton size="sm" icon="solar:refresh-bold" :loading="hw.refreshing.value" @click="hw.refreshDevices()">Scan</UiButton>
      </div>
    </header>

    <div v-if="hw.lastError.value" class="dv-error">{{ hw.lastError.value }}</div>

    <!-- ── plugged devices ── -->
    <section class="dv-card" aria-label="Plugged devices">
      <div class="dv-card-head">
        <strong>PLUGGED IN</strong>
        <span class="dv-counts">
          <span v-for="(n, bus) in hw.deviceCountByBus.value" :key="bus" class="dv-chip">{{ bus }}:{{ n }}</span>
        </span>
      </div>
      <UiEmpty
        v-if="hw.pluggedDevices.value.length === 0"
        size="sm"
        icon="solar:plug-circle-bold"
        title="No devices visible"
        description="Grant camera/mic once, or pair USB / HID / Serial / Bluetooth below. Gamepads appear automatically."
      />
      <div v-else class="dv-list">
        <div v-for="d in hw.pluggedDevices.value" :key="d.id" class="dv-row">
          <span class="dv-bus" :data-bus="d.bus">{{ d.bus.toUpperCase() }}</span>
          <div class="dv-info">
            <span class="dv-label">{{ d.label }}</span>
            <span class="dv-kind">{{ d.kind }}</span>
          </div>
          <span class="dv-dot" :class="{ on: d.connected }" />
        </div>
      </div>
      <div class="dv-pair">
        <UiButton v-if="hw.support.value.usb" size="sm" icon="solar:usb-bold" @click="hw.requestUsb()">Pair USB</UiButton>
        <UiButton v-if="hw.support.value.hid" size="sm" icon="solar:gamepad-bold" @click="hw.requestHid()">Pair HID</UiButton>
        <UiButton v-if="hw.support.value.serial" size="sm" icon="solar:plug-circle-bold" @click="hw.requestSerial()">Pair Serial</UiButton>
        <UiButton v-if="hw.support.value.bluetooth" size="sm" icon="solar:bluetooth-bold" @click="hw.requestBluetooth()">Pair BLE</UiButton>
      </div>
      <p class="dv-hint">USB / HID / Serial / Bluetooth need a user gesture + HTTPS or localhost. Media labels stay generic until camera/mic permission is granted. Plugs refresh live via devicechange listeners.</p>
    </section>

    <!-- ── media capture ── -->
    <section class="dv-card" aria-label="Media capture">
      <div class="dv-card-head"><strong>CAPTURE</strong><span class="dv-muted">face input · screen share · voice</span></div>
      <div class="dv-pair">
        <UiButton size="sm" :disabled="!hw.support.value.camera" @click="toggleCam">{{ camOn ? 'Stop camera' : 'Start camera' }}</UiButton>
        <UiButton size="sm" :disabled="!hw.support.value.screenShare" @click="toggleShare">{{ shareOn ? 'Stop share' : 'Share screen' }}</UiButton>
        <UiButton size="sm" :disabled="!hw.support.value.speechSynthesis" @click="hw.speak('CyberManju OS ready')">Speak</UiButton>
        <select v-if="hw.support.value.speechRecognition" class="dv-select" :value="hw.speechLang.value" aria-label="Voice language" title="Voice language: English (EN) or Portuguese (PT-BR)" @change="hw.setSpeechLang(($event.target as HTMLSelectElement).value as 'en-US' | 'pt-BR')">
          <option value="en-US">EN</option>
          <option value="pt-BR">PT</option>
        </select>
        <UiButton v-if="hw.support.value.speechRecognition" size="sm" @click="toggleListen">{{ listening ? 'Stop listening' : 'Voice command' }}</UiButton>
      </div>
      <div v-if="camOn || shareOn" class="dv-vids">
        <video v-show="camOn" ref="camVideoRef" autoplay playsinline muted class="dv-vid" />
        <video v-show="shareOn" ref="shareVideoRef" autoplay playsinline muted class="dv-vid" />
      </div>
      <p v-if="transcript" class="dv-line">heard: “{{ transcript }}”</p>
      <p v-else class="dv-muted">camera feeds face grouping · screen share demos the vault · voice fills cybsh.</p>
    </section>

    <!-- ── local files & clipboard ── -->
    <section class="dv-card" aria-label="Local files">
      <div class="dv-card-head"><strong>LOCAL FILES</strong><span class="dv-muted">File System Access · no Tauri needed</span></div>
      <div class="dv-pair">
        <UiButton size="sm" :disabled="!hw.support.value.fileSystemAccess" @click="openLocal">Open file</UiButton>
        <UiButton size="sm" :disabled="!hw.support.value.fileSystemAccess" @click="saveLocal">Save note</UiButton>
        <UiButton size="sm" @click="hw.pickFiles()">Picker ({{ pickedCount }})</UiButton>
        <UiButton size="sm" @click="copyRich">Rich copy</UiButton>
      </div>
      <p v-if="localName" class="dv-line">{{ localName }} — {{ localPreview }}</p>
      <p v-else class="dv-muted">Open reads text into the OS · Save writes back to disk · Picker uses a classic dialog fallback.</p>
    </section>

    <!-- ── presence / multi-tab ── -->
    <section class="dv-grid">
      <div class="dv-card">
        <strong>PRESENCE</strong>
        <p>idle: {{ hw.idle.idle.value ? 'away (5min)' : 'active' }} · tab: {{ hw.visibility.value }} · focused: {{ hw.focused.value ? 'yes' : 'no' }}</p>
        <div class="dv-pair">
          <UiButton size="sm" :disabled="!hw.support.value.broadcast" @click="hw.pingTabs(`ping ${Date.now()}`)">Ping tabs</UiButton>
        </div>
        <p class="dv-muted">last bus: {{ busMsg || '—' }} · FileManager refreshes on broadcast.</p>
      </div>
      <div class="dv-card">
        <strong>SYSTEM</strong>
        <p>{{ memLine }}</p>
        <p class="dv-muted">{{ motionLine }}</p>
        <p class="dv-muted">{{ localeLine }} · {{ hw.windowSize.width.value }}×{{ hw.windowSize.height.value }} · {{ hw.preferredScheme.value }}</p>
      </div>
      <div class="dv-card">
        <strong>SCREENS {{ hw.screens.value.length ? `(${hw.screens.value.length})` : '' }}</strong>
        <p v-if="hw.screens.value.length">{{ screenLine }}</p>
        <p v-else class="dv-muted">{{ hw.support.value.multiScreen ? 'No extended screens reported.' : 'Multi-screen API not exposed here.' }}</p>
        <div class="dv-pair">
          <UiButton v-if="hw.support.value.multiScreen" size="sm" @click="hw.refreshScreens()">Detect</UiButton>
          <UiButton v-if="hw.support.value.appBadge" size="sm" @click="badgeDemo">Badge ①</UiButton>
          <UiButton v-if="hw.support.value.appBadge" size="sm" variant="ghost" @click="hw.clearBadge()">Clear</UiButton>
        </div>
      </div>
    </section>

    <!-- ── sensors & system ── -->
    <section class="dv-grid">
      <div class="dv-card">
        <strong>BATTERY</strong>
        <p v-if="hw.battery.isSupported.value">{{ batteryLine }}</p>
        <p v-else class="dv-muted">Not exposed by this browser.</p>
      </div>
      <div class="dv-card">
        <strong>NETWORK</strong>
        <p>{{ netDetail }}</p>
        <p class="dv-muted">online: {{ hw.online.value ? 'yes' : 'no' }}</p>
      </div>
      <div class="dv-card">
        <strong>LOCATION</strong>
        <p v-if="hasGeo">lat {{ geoLat }}, lon {{ geoLon }} (±{{ geoAcc }}m)</p>
        <p v-else class="dv-muted">Permission: {{ hw.geoPermission.value ?? 'unknown' }}</p>
        <div class="dv-pair">
          <UiButton size="sm" @click="locate">Locate</UiButton>
          <UiButton size="sm" variant="ghost" @click="copyGeo" :disabled="!hasGeo">Copy</UiButton>
        </div>
      </div>
      <div class="dv-card">
        <strong>SCREEN</strong>
        <p>{{ orientationLine }}</p>
        <div class="dv-pair">
          <UiButton size="sm" @click="hw.fullscreen.toggle()">{{ hw.fullscreen.isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen' }}</UiButton>
          <UiButton v-if="hw.support.value.wakeLock" size="sm" :variant="hw.wakeLock.isActive.value ? 'primary' : 'ghost'" @click="toggleWake">
            Wake {{ hw.wakeLock.isActive.value ? 'ON' : 'OFF' }}
          </UiButton>
        </div>
      </div>
      <div class="dv-card">
        <strong>STORAGE QUOTA</strong>
        <p v-if="storageMsg">{{ storageMsg }}</p>
        <p v-else class="dv-muted">Loading…</p>
        <div class="dv-pair">
          <UiButton size="sm" @click="loadStorage">Refresh</UiButton>
          <UiButton size="sm" variant="ghost" @click="persist">Persist</UiButton>
        </div>
      </div>
      <div class="dv-card">
        <strong>SHARE / HAPTICS</strong>
        <div class="dv-pair">
          <UiButton size="sm" :disabled="!hw.support.value.share" @click="shareNow">Share OS</UiButton>
          <UiButton size="sm" :disabled="!hw.support.value.vibrate" @click="buzz">Vibrate</UiButton>
          <UiButton v-if="hw.support.value.eyeDropper" size="sm" @click="pick">Pick color{{ picked ? `: ${picked}` : '' }}</UiButton>
        </div>
        <p class="dv-muted">share: {{ hw.support.value.share ? 'yes' : 'no' }} · vibrate: {{ hw.support.value.vibrate ? 'yes' : 'no' }}</p>
      </div>
    </section>

    <!-- ── identity & progressive ── -->
    <section class="dv-card" aria-label="Identity and progressive APIs">
      <div class="dv-card-head"><strong>IDENTITY & SCAN</strong><span class="dv-muted">passkeys · NFC · contacts · codes</span></div>
      <div class="dv-pair">
        <UiButton size="sm" :disabled="!hw.support.value.webAuthn" @click="passkeyInfo">Passkeys</UiButton>
        <UiButton v-if="hw.support.value.nfc" size="sm" @click="hw.requestNfcScan()">NFC scan</UiButton>
        <UiButton v-if="hw.support.value.contacts" size="sm" @click="pickContacts">Contacts</UiButton>
      </div>
      <p v-if="identityMsg" class="dv-line">{{ identityMsg }}</p>
      <p v-else-if="hw.nfcMessage.value" class="dv-line">{{ hw.nfcMessage.value }}</p>
      <p v-else class="dv-muted">WebAuthn: {{ hw.support.value.webAuthn ? 'ready' : 'n/a' }} · NFC: {{ hw.support.value.nfc ? 'ready' : 'n/a' }} · contacts: {{ hw.support.value.contacts ? 'ready' : 'n/a' }} · barcode: {{ hw.support.value.barcode ? 'ready' : 'n/a' }} · face: {{ hw.support.value.faceDetector ? 'ready' : 'n/a' }}</p>
    </section>

    <!-- ── notifications ── -->
    <section class="dv-card" aria-label="Notifications">
      <div class="dv-card-head"><strong>NOTIFICATIONS</strong><span class="dv-muted">permission: {{ hw.notifyPermission.value ?? 'unknown' }}</span></div>
      <div class="dv-pair">
        <UiButton size="sm" :disabled="!hw.support.value.notifications" @click="askNotify">Enable</UiButton>
        <UiButton size="sm" :disabled="!canNotify" @click="testNotify">Test</UiButton>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useSystemHardware, getStorageEstimate, persistStorage } from '@/composables/useSystemHardware'

const hw = useSystemHardware()
const storageMsg = ref('')
const picked = ref('')
const identityMsg = ref('')
const camVideoRef = ref<HTMLVideoElement | null>(null)
const shareVideoRef = ref<HTMLVideoElement | null>(null)

const netLine = computed(() => hw.online.value ? `online${hw.network.effectiveType.value ? ` · ${hw.network.effectiveType.value}` : ''}` : 'offline')
const netDetail = computed(() => {
  const parts = [`type: ${hw.network.type.value}`, `effective: ${hw.network.effectiveType.value || '—'}`]
  if (hw.network.downlink.value != null) parts.push(`${hw.network.downlink.value} Mbps`)
  if (hw.network.rtt.value != null) parts.push(`${hw.network.rtt.value}ms rtt`)
  if (hw.network.saveData.value) parts.push('save-data')
  return parts.join(' · ')
})
const powerLine = computed(() => {
  if (!hw.battery.isSupported.value) return 'power: n/a'
  return hw.battery.charging.value ? `charging ${Math.round((hw.battery.level.value ?? 0) * 100)}%` : `${Math.round((hw.battery.level.value ?? 0) * 100)}%${hw.battery.dischargingTime.value ? ` · ${Math.round(hw.battery.dischargingTime.value / 60)}min left` : ''}`
})
const batteryLine = computed(() => `${Math.round((hw.battery.level.value ?? 0) * 100)}% · ${hw.battery.charging.value ? 'charging' : 'on battery'}`)
const orientationLine = computed(() => {
  const raw = hw.orientation.orientation.value as unknown as string | { type?: string } | null | undefined
  const oType = typeof raw === 'string' ? raw : (raw?.type ?? (screen.orientation as ScreenOrientation | undefined)?.type ?? 'unknown')
  return `${oType} · ${window.innerWidth}×${window.innerHeight}`
})
const hasGeo = computed(() => hw.geo.coords.value.latitude !== Infinity && isFinite(hw.geo.coords.value.latitude))
const geoLat = computed(() => hw.geo.coords.value.latitude.toFixed(5))
const geoLon = computed(() => hw.geo.coords.value.longitude.toFixed(5))
const geoAcc = computed(() => Math.round(hw.geo.coords.value.accuracy ?? 0))

// capture state
const camOn = computed(() => !!hw.userMedia.stream.value)
const shareOn = computed(() => !!hw.displayMedia.stream.value)
const listening = computed(() => hw.speechRecognition.isListening.value)
const transcript = computed(() => hw.speechRecognition.result.value)
const busMsg = computed(() => String(hw.bus.data.value ?? ''))
const pickedCount = computed(() => hw.fileDialog.files.value?.length ?? 0)
const localName = computed(() => hw.fsAccess.fileName.value ?? '')
const localPreview = computed(() => {
  const d = hw.fsAccess.data.value
  if (typeof d !== 'string') return ''
  return d.length > 90 ? `${d.slice(0, 90)}… (${d.length} chars)` : d || '(empty)'
})
const memLine = computed(() => {
  const m = hw.memory.memory.value as unknown as { usedJSHeapSize?: number; jsHeapSizeLimit?: number } | undefined
  if (!m?.usedJSHeapSize) return hw.support.value.memory ? 'memory: reading…' : 'memory API not exposed here.'
  const used = (m.usedJSHeapSize / 1048576).toFixed(0)
  const lim = m.jsHeapSizeLimit ? ` / ${(m.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : ''
  return `JS heap ${used} MB${lim}`
})
const motionLine = computed(() => {
  if (!hw.support.value.motion && !hw.support.value.deviceOrientation) return 'motion sensors not exposed here.'
  const o = hw.deviceOrientation
  const parts: string[] = []
  if (o.alpha.value != null) parts.push(`α ${o.alpha.value.toFixed(0)}°`)
  if (o.beta.value != null) parts.push(`β ${o.beta.value.toFixed(0)}°`)
  if (o.gamma.value != null) parts.push(`γ ${o.gamma.value.toFixed(0)}°`)
  return parts.length ? `orientation ${parts.join(' ')}` : 'motion: no reading yet (needs gesture on iOS).'
})
const localeLine = computed(() => {
  const lang = hw.navigatorLanguage.language.value ?? 'unknown'
  const prefs = hw.preferredLanguages.value.slice(0, 2).join(', ')
  return `${lang}${prefs ? ` · pref ${prefs}` : ''}`
})
const screenLine = computed(() => hw.screens.value.map(s => `${s.label || 'screen'} ${s.width}×${s.height}${s.primary ? ' ★' : ''}`).join(' · '))
const canNotify = computed(() => hw.support.value.notifications && hw.notifyPermission.value === 'granted')

async function toggleCam() {
  if (camOn.value) hw.stopCamera()
  else await hw.startCamera()
}
async function toggleShare() {
  if (shareOn.value) hw.stopScreenShare()
  else await hw.startScreenShare()
}
function toggleListen() {
  try {
    if (listening.value) hw.speechRecognition.stop()
    else hw.speechRecognition.start()
  } catch { /* denied */ }
}
async function openLocal() { await hw.openLocalFile() }
async function saveLocal() { await hw.saveLocalFile(`CyberManju OS note — ${new Date().toISOString()}\n`, 'cybermanju-note.txt') }
async function copyRich() {
  await hw.copyRichHtml('<b>CyberManju OS</b> — web OS inside an OS', 'CyberManju OS — web OS inside an OS')
}
async function badgeDemo() { await hw.setBadge(1); setTimeout(() => void hw.clearBadge(), 4000) }
async function pickContacts() {
  const list = await hw.pickContacts()
  identityMsg.value = list.length ? `${list.length} contact(s) picked (kept in memory, never stored).` : 'No contacts picked.'
}
function passkeyInfo() {
  identityMsg.value = hw.webAuthnSupported()
    ? 'Passkeys ready — bind WebAuthn in the Tauri/desktop auth settings; this browser can create platform credentials.'
    : 'WebAuthn not available here.'
}
async function askNotify() {
  try { await hw.webNotification.ensurePermissions() } catch { /* denied */ }
}
function testNotify() {
  try { hw.webNotification.show({ body: 'CyberManju OS notifications work.', tag: 'cybermanju-test' }) } catch { /* noop */ }
}

async function locate() { try { await hw.geo.resume() } catch { /* denied */ } }
async function copyGeo() { if (hasGeo.value) await hw.copy(`${geoLat.value},${geoLon.value}`) }
async function toggleWake() {
  try {
    if (hw.wakeLock.isActive.value) await hw.wakeLock.release()
    else await hw.wakeLock.request('screen')
  } catch { /* not allowed */ }
}
async function loadStorage() {
  const est = await getStorageEstimate()
  storageMsg.value = est.quota
    ? `${fmt(est.usage ?? 0)} / ${fmt(est.quota)} (${est.percent ?? 0}%) · persisted: ${est.persisted ? 'yes' : 'no'}`
    : `persisted: ${est.persisted ? 'yes' : 'no'} (quota hidden by browser)`
}
async function persist() { await persistStorage(); await loadStorage() }
function fmt(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${Math.round(n / 1e3)} KB`
}
async function shareNow() {
  try { await hw.share({ title: 'CyberManju OS', text: 'Web OS inside an OS', url: location.href }) } catch { /* dismissed */ }
}
function buzz() { try { hw.vibrate(40) } catch { /* noop */ } }
async function pick() {
  try { const r = await hw.eyeDropper.open(); if (r?.sRGBHex) picked.value = r.sRGBHex } catch { /* dismissed */ }
}

watch(() => hw.userMedia.stream.value, (s) => {
  if (camVideoRef.value) {
    try { (camVideoRef.value as HTMLVideoElement).srcObject = s ?? null } catch { /* noop */ }
  }
}, { immediate: true })
watch(() => hw.displayMedia.stream.value, (s) => {
  if (shareVideoRef.value) {
    try { (shareVideoRef.value as HTMLVideoElement).srcObject = s ?? null } catch { /* noop */ }
  }
}, { immediate: true })

onMounted(() => { void hw.refreshDevices(); void loadStorage() })
</script>

<style scoped>
.dv { height: 100%; min-width: 0; overflow-x: hidden; overflow-y: auto; padding: 12px 14px; padding-bottom: max(12px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; background: var(--ui-surface); color: var(--ui-text); font-family: var(--ui-font); font-size: 13px; }
.dv-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 10px; border-bottom: 1px solid var(--ui-border); }
.dv-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dv-brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; background: color-mix(in srgb, var(--ui-accent) 16%, transparent); color: var(--ui-accent); border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent); flex-shrink: 0; }
.dv-title { margin: 0; font-size: 15px; letter-spacing: 0.4px; }
.dv-subtitle { margin: 1px 0 0; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.dv-top-actions { display: flex; gap: 8px; flex-shrink: 0; }
.dv-error { border: 1px solid color-mix(in srgb, var(--ui-danger) 55%, transparent); background: color-mix(in srgb, var(--ui-danger) 10%, transparent); border-radius: 10px; padding: 8px 12px; font-size: 12px; }
.dv-card { min-width: 0; border: 1px solid var(--ui-border); border-radius: 12px; padding: 12px 14px; background: color-mix(in srgb, var(--ui-text) 3%, transparent); display: flex; flex-direction: column; gap: 8px; }
.dv-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; letter-spacing: 1px; }
.dv-counts { display: flex; gap: 4px; flex-wrap: wrap; }
.dv-chip { font-family: var(--ui-font-mono); font-size: 9.5px; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--ui-border); background: var(--ui-glass); }
.dv-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; min-width: 0; overflow-y: auto; }
.dv-row { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 7px 8px; border: 1px solid var(--ui-hairline); border-radius: 8px; background: var(--ui-glass); }
.dv-bus { font-family: var(--ui-font-mono); font-size: 8.5px; font-weight: 700; padding: 2px 7px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent); color: var(--ui-accent); min-width: 64px; text-align: center; }
.dv-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dv-label { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-kind { font-size: 10px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); }
.dv-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ui-border-strong); flex-shrink: 0; }
.dv-dot.on { background: var(--ui-success, #22c55e); box-shadow: 0 0 8px color-mix(in srgb, var(--ui-success, #22c55e) 70%, transparent); }
.dv-pair { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dv-select {
  font-size: 11px; font-weight: 700; padding: 5px 6px; border-radius: 8px;
  border: 1px solid var(--ui-border); background: var(--ui-glass); color: var(--ui-text);
  cursor: pointer;
}
.dv-hint, .dv-muted { min-width: 0; overflow-wrap: anywhere; font-size: 11px; color: color-mix(in srgb, var(--ui-text) 55%, transparent); margin: 0; }
.dv-line { min-width: 0; font-size: 12px; margin: 0; overflow: hidden; overflow-wrap: anywhere; text-overflow: ellipsis; }
.dv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.dv-grid p { margin: 0; font-size: 12px; }
.dv-vids { display: flex; gap: 8px; flex-wrap: wrap; }
.dv-vid { width: 220px; max-width: 100%; aspect-ratio: 16/10; border-radius: 10px; border: 1px solid var(--ui-border); background: #000; }

@media (max-width: 600px) {
  .dv { padding: max(10px, env(safe-area-inset-top)) 10px max(14px, env(safe-area-inset-bottom)); gap: 8px; font-size: 14px; }
  .dv-top { align-items: flex-start; padding: 10px 4px 12px; }
  .dv-title { font-size: 17px; }
  .dv-subtitle { font-size: 12px; line-height: 1.35; }
  .dv-top-actions { margin-top: -2px; }
  .dv-card { border-radius: 16px; padding: 14px 12px; gap: 10px; }
  .dv-card-head { align-items: flex-start; flex-wrap: wrap; line-height: 1.35; }
  .dv-list { max-height: none; gap: 8px; }
  .dv-row { border-radius: 12px; padding: 8px 10px; }
  .dv-bus { min-width: 58px; }
  .dv-pair { gap: 8px; }
  .dv-pair :deep(button), .dv-pair :deep(select), .dv-top-actions :deep(button) { min-height: 44px; }
  .dv-pair :deep(button) { flex: 1 1 auto; }
  .dv-select { min-width: 54px; }
  .dv-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .dv-grid p { overflow-wrap: anywhere; line-height: 1.45; }
  .dv-hint, .dv-muted { line-height: 1.45; }
}

@media (prefers-reduced-motion: reduce) {
  .dv *, .dv *::before, .dv *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
</style>
