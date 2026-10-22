// CyberManju OS — Upload Messages Modal Fixture Config (tests/fixtures/upload-messages-modal.vite.ts).
// Role: Serve the standalone modal fixture with narrowly scoped aliases for inert app dependencies.
// Exports: Vite config for port 5194 with test-only IO guards.
// Integrates: Vue SFC plugin and exact-source aliases for non-UI production dependencies.
// Contracts: Stubs perform no backend/native/message/upload IO; forbidden transport calls throw.
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const fixtureDir = fileURLToPath(new URL('.', import.meta.url))
const srcDir = fileURLToPath(new URL('../../src/', import.meta.url))
const wasmStub = fileURLToPath(new URL('../../src/wasm-stub.js', import.meta.url))
const virtualPrefix = '\0upload-messages-fixture:'
const path = (value: string) => `${srcDir}${value}`
const ids: Record<string, string> = {
  [path('stores/app.ts')]: 'app-store',
  [path('stores/launcher.ts')]: 'launcher-store',
  [path('composables/useMessages.ts')]: 'messages',
  [path('composables/useNotifications.ts')]: 'notifications',
  [path('composables/useAndroidApps.ts')]: 'android-apps',
  [path('composables/useTauri.ts')]: 'tauri',
  [path('utils/installLinks.ts')]: 'install-links',
}
const modules: Record<string, string> = {
  'app-store': `function blocked(label) { window.__modalFixture.ioAttempts++; throw new Error('Fixture blocked IO: ' + label) } export function useAppStore() { return { currentPath: '/', fetchFiles: async () => blocked('app.fetchFiles'), notifySuccess() {}, notifyError() {} } }`,
  'launcher-store': `export function useLauncherStore() { const state = window.__modalFixture.state; return Object.assign(state, { setMessagesOpen(value) { state.messagesOpen = value }, markMessagesSeen(value) { state.messagesSeenAt = value } }) }`,
  messages: `import { computed, ref } from 'vue'; const socialApps = ref([]), messages = ref([]), notifState = ref(null), status = ref('idle'), lastError = ref(null); export function useMessages() { return { socialApps, messages, notifState, status, lastError, unread: computed(() => 0), supported: false, async refresh() { return [] }, async refreshSocial() { return [] }, async refreshState() { return null }, async clear() {}, async openSettings() {}, markSeen() {} } }`,
  notifications: `import { ref, computed } from 'vue'; const history = ref([]); export function useNotifications() { return { history, unreadCount: computed(() => 0), markRead() {}, markAllRead() {}, clearHistory() {} } }`,
  'android-apps': `export function useAndroidApps() { return { async openApp() { window.__modalFixture.ioAttempts++; throw new Error('Fixture blocked IO: android.openApp') } } }`,
  tauri: `export function invoke(command) { window.__modalFixture.ioAttempts++; throw new Error('Fixture blocked IO: invoke ' + command) } export function send(command) { window.__modalFixture.ioAttempts++; throw new Error('Fixture blocked IO: send ' + command) } export function isTauri() { return false } export function isAndroidApp() { return false } export function isStaticHost() { return true }`,
  'install-links': `export function requestInstallWindow(reason) { window.__modalFixture.ioAttempts++; throw new Error('Fixture blocked IO: requestInstallWindow ' + reason) }`,
}

const stubs: Plugin = {
  name: 'upload-messages-modal-fixture-stubs',
  enforce: 'pre',
  resolveId(id) {
    const normalized = id.replace(/\/{2,}/g, '/')
    const stub = ids[normalized] ?? ids[`${normalized}.ts`]
    if (stub) return `${virtualPrefix}${stub}`
    return null
  },
  load(id) {
    return id.startsWith(virtualPrefix) ? modules[id.slice(virtualPrefix.length)] : null
  },
}

export default defineConfig({
  configFile: false,
  root: fixtureDir,
  plugins: [stubs, vue()],
  resolve: { alias: { '@': srcDir, 'cybermanju-os-wasm': wasmStub } },
  server: { host: '0.0.0.0', port: 5194, strictPort: true },
  css: { preprocessorOptions: {} },
})
