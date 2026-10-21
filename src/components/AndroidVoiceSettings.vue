<script setup lang="ts">
// CyberManju OS — Android voice settings (src/components/AndroidVoiceSettings.vue).
// Role: Explicit, user-driven Android notification and assisted reply controls.
// Exports: AndroidVoiceSettings component.
// Integrates: ../utils/androidVoice.ts, Vue.
// Contracts: Notifications are never polled or sent to the assistant; native confirmation gates every external action.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { androidVoiceCommand, isNativeAndroid, type AndroidVoiceNotification, type AndroidVoiceStatus } from '@/utils/androidVoice'
import { useAndroidApps } from '@/composables/useAndroidApps'
import UiButton from '@/components/ui/UiButton.vue'

const android = ref(false)
const status = ref<AndroidVoiceStatus | null>(null)
const packagesText = ref('')
const items = ref<AndroidVoiceNotification[]>([])
const error = ref('')
const busy = ref(false)
const replyDrafts = ref<Record<string, string>>({})
const fillPackage = ref('')
const fillText = ref('')
let generation = 0
let alive = true
const selectedPackages = computed(() => [...new Set(packagesText.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean))])
const selectedPackage = computed(() => selectedPackages.value.includes(fillPackage.value) ? fillPackage.value : '')
const dirty = computed(() => JSON.stringify([...selectedPackages.value].sort()) !== JSON.stringify([...(status.value?.selectedPackages || [])].sort()))
const installed = useAndroidApps()
const showApps = ref(false)
let initialized = false

async function chooseApps() {
  error.value = ''
  try { await installed.refresh(); showApps.value = true }
  catch (cause) { if (alive) error.value = message(cause) }
}
function toggleApp(pkg: string, checked: boolean) {
  packagesText.value = (checked ? [...new Set([...selectedPackages.value, pkg])] : selectedPackages.value.filter(p => p !== pkg)).join('\n')
  items.value = []; replyDrafts.value = {}
}

async function refreshStatus() {
  if (!android.value) return
  const version = generation
  busy.value = true
  error.value = ''
  try {
    const result = await androidVoiceCommand<AndroidVoiceStatus>('status')
    if (!alive || version !== generation) return
    status.value = result
    if (!initialized) { packagesText.value = result.selectedPackages.join('\n'); initialized = true }
    if (!result.notificationAccess) { items.value = []; replyDrafts.value = {} }
  } catch (cause) { if (alive && version === generation) error.value = message(cause) }
  finally { if (alive && version === generation) busy.value = false }
}
async function saveSelection() {
  generation++
  const version = generation
  items.value = []
  replyDrafts.value = {}
  error.value = ''
  busy.value = true
  try {
    await androidVoiceCommand<{ ok: true }>('configure', { packages: selectedPackages.value })
    if (!alive || version !== generation) return
    await refreshStatus()
  } catch (cause) { if (alive && version === generation) error.value = message(cause) }
  finally { if (alive && version === generation) busy.value = false }
}
async function refreshNotifications() {
  generation++
  const version = generation
  items.value = []
  replyDrafts.value = {}
  error.value = ''
  if (dirty.value) { error.value = 'Save the app selection before reading notifications.'; return }
  if (!selectedPackages.value.length) { error.value = 'Select at least one app package first.'; return }
  busy.value = true
  try {
    const result = await androidVoiceCommand<{ items: AndroidVoiceNotification[] }>('notifications')
    if (!alive || version !== generation) return
    // Display only results belonging to the explicit selection.
    items.value = result.items.filter(item => selectedPackages.value.includes(item.packageName))
  } catch (cause) { if (alive && version === generation) error.value = message(cause) }
  finally { if (alive && version === generation) busy.value = false }
}
async function openSettings(action: 'notificationSettings' | 'accessibilitySettings' | 'microphoneSettings') {
  error.value = ''
  try { await androidVoiceCommand<{ ok: true }>(action); await refreshStatus() }
  catch (cause) { error.value = message(cause) }
}
async function reviewReply(item: AndroidVoiceNotification) {
  const text = (replyDrafts.value[item.key] || '').trim()
  if (dirty.value || !item.canReply || !text) return
  error.value = ''
  try { await androidVoiceCommand<{ pendingConfirmation: true }>('reply', { key: item.key, text }) }
  catch (cause) { error.value = message(cause) }
}
async function reviewFill() {
  const packageName = selectedPackage.value
  const text = fillText.value.trim()
  if (dirty.value || !packageName || !text) return
  error.value = ''
  try { await androidVoiceCommand<{ pendingConfirmation: true }>('fill', { packageName, text }) }
  catch (cause) { error.value = message(cause) }
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
onMounted(() => { android.value = isNativeAndroid(); if (android.value) void refreshStatus() })
onBeforeUnmount(() => { alive = false; generation++ })
</script>

<template>
  <section v-if="android" class="android-voice" aria-label="Android notification and voice settings">
    <h3>Android app notifications</h3>
    <p class="agent-note">Choose apps explicitly. Notifications are shown only when you request a refresh and are never sent to the assistant or voice call.</p>
    <UiButton size="sm" @click="chooseApps">Choose installed apps</UiButton>
    <div v-if="showApps" class="android-installed-apps">
      <label v-for="app in installed.apps.value" :key="app.packageName">
        <input type="checkbox" :checked="selectedPackages.includes(app.packageName)" :disabled="busy" @change="toggleApp(app.packageName, ($event.target as HTMLInputElement).checked)" />
        {{ app.label }} <small>{{ app.packageName }}</small>
      </label>
    </div>
    <label class="w-field">
      <span class="w-label">Selected app package names (one per line)</span>
      <textarea v-model="packagesText" rows="3" :disabled="busy" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="com.example.messaging" aria-label="Selected app package names" />
    </label>
    <div class="android-voice-actions">
      <UiButton size="sm" :disabled="busy || !dirty" @click="saveSelection">Save app selection</UiButton>
      <UiButton size="sm" :disabled="busy || dirty" :loading="busy" @click="refreshNotifications">Refresh notifications</UiButton>
      <UiButton size="sm" :disabled="busy" @click="refreshStatus">Refresh permission status</UiButton>
    </div>
    <p v-if="status" class="agent-note" role="status">Notification access: {{ status.notificationAccess ? 'Granted' : 'Not granted' }} · Accessibility: {{ status.accessibilityEnabled ? 'Enabled' : 'Not enabled' }} · Speech provider: {{ status.recognitionAvailable ? 'Available' : 'Unavailable' }}</p>
    <div class="android-voice-actions">
      <UiButton size="sm" @click="openSettings('notificationSettings')">Notification access settings</UiButton>
      <UiButton size="sm" @click="openSettings('accessibilitySettings')">Accessibility settings</UiButton>
      <UiButton size="sm" @click="openSettings('microphoneSettings')">Microphone settings</UiButton>
    </div>
    <p class="agent-note">Accessibility is used only for assisted text filling; it never sends messages. Android asks you to review the exact app, recipient (for a reply), and text before any action.</p>
    <ul v-if="items.length && !dirty" class="android-voice-notifications" aria-label="Notifications">
      <li v-for="item in items" :key="item.key">
        <strong>{{ item.appLabel }}</strong><span v-if="item.title"> · {{ item.title }}</span>
        <p>{{ item.text }}</p>
        <label v-if="item.canReply" class="w-field"><span class="w-label">Reply text</span><input v-model="replyDrafts[item.key]" type="text" autocomplete="off" :aria-label="`Reply to ${item.appLabel}`" /></label>
        <UiButton v-if="item.canReply" size="sm" :disabled="!replyDrafts[item.key]?.trim()" @click="reviewReply(item)">Review reply on Android</UiButton>
      </li>
    </ul>
    <div class="android-voice-fill">
      <h4>Fill text in an app</h4>
      <label class="w-field"><span class="w-label">Selected target app</span><select v-model="fillPackage" aria-label="Target app package"><option value="">Choose an app</option><option v-for="pkg in selectedPackages" :key="pkg" :value="pkg">{{ pkg }}</option></select></label>
      <label class="w-field"><span class="w-label">Text to fill</span><textarea v-model="fillText" rows="2" aria-label="Text to fill" autocomplete="off" /></label>
      <UiButton size="sm" :disabled="busy || dirty || !selectedPackage || !fillText.trim()" @click="reviewFill">Review fill on Android</UiButton>
      <p class="agent-note">Fills only a focused, non-password editable field. It will not send the text.</p>
    </div>
    <p v-if="error" role="alert" class="w-msg">{{ error }}</p>
  </section>
</template>

<style scoped>
.android-voice { padding: 12px 14px; border-top: 1px solid var(--ui-border); }
.android-voice h3, .android-voice h4 { margin: 0 0 7px; }
.android-voice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.android-voice .w-field { display: grid; gap: 5px; margin: 8px 0; }
.android-voice textarea, .android-voice input, .android-voice select { width: 100%; box-sizing: border-box; padding: 8px; color: var(--ui-text); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 6px; }
.android-voice-notifications { display: grid; gap: 10px; padding: 0; list-style: none; }
.android-voice-notifications li { padding: 10px; border: 1px solid var(--ui-border); border-radius: 8px; overflow-wrap: anywhere; }
.android-voice-notifications p { margin: 6px 0; }
.android-voice-fill { margin-top: 12px; }
.android-installed-apps { max-height: 220px; overflow-y: auto; display: grid; gap: 8px; margin-top: 8px; }
.android-installed-apps label { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.android-installed-apps input { width: auto; }
.android-installed-apps small { opacity: .7; overflow-wrap: anywhere; }
</style>
