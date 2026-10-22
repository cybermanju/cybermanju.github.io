// CyberManju OS — Account Manager OAuth integration tests.
// Role: Run actual panel setup actions without browser or external OAuth traffic.
// Exports: none.
// Integrates: Vue SFC compiler, mocked broker, and in-memory sync persistence.
// Contracts: Provisioning and destructive account actions remain account-scoped.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as providers from '@/utils/providers'
import * as accountHelpers from '@/utils/oauthAccounts'
import type { SyncConfig } from '@/types'

const require = createRequire(import.meta.url)
const source = readFileSync('src/components/AccountManagerPanel.vue', 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'oauth-panel-test' })
const output = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
let rows: SyncConfig[]
let session: any
let panel: any
let store: any
let scope: Vue.EffectScope
const brokerIdentity = (value: any) => value?.user ? { id: `${value.user.app_metadata.provider}:${value.user.id}`, provider: value.user.app_metadata.provider, name: value.user.id } : null

beforeEach(() => {
  rows = []
  session = null
  store = Vue.reactive({
    syncConfigs: rows,
    disks: [], users: [], accounts: [],
    saveSyncConfig: vi.fn(async (config: SyncConfig) => {
      const saved = { ...config, id: config.id || `connection-${rows.length + 1}` }
      const index = rows.findIndex(row => row.id === saved.id)
      if (index >= 0) rows[index] = saved
      else rows.push(saved)
      return saved
    }),
    probeSyncConnection: vi.fn(async () => ({ ok: true, detail: 'mock verified' })),
    fetchSyncConfigs: vi.fn(async () => {}),
    fetchSyncUsage: vi.fn(async () => null),
    deleteSyncConfig: vi.fn(async (id: string) => { rows.splice(rows.findIndex(row => row.id === id), 1) }),
    notifySuccess: vi.fn(),
  })
  const mocks: Record<string, any> = {
    vue: { ...Vue, onMounted: () => {}, onBeforeUnmount: () => {} },
    '@/stores/app': { useAppStore: () => store },
    '@/composables/useWindowManager': { useWindowManager: () => ({}) },
    '@/composables/useTauri': { isStaticHost: () => true, isTauri: () => false },
    '@/composables/useWasmBackend': {},
    '@/composables/useSupabase': {
      identity: Vue.ref(null), connectedAccounts: Vue.ref([]), supabaseConfigured: () => true,
      supabaseSession: async () => session, identityFromSession: brokerIdentity,
      supabaseProviderFor: (backend: string) => backend === 'googleDrive' ? 'google' : backend,
      setPendingOAuthConfig: vi.fn(), forgetConnectedAccount: vi.fn(),
    },
    '@/composables/useCyberManjuFile': { disk: Vue.reactive({}) },
    '@/utils/providers': providers,
    '@/utils/oauthAccounts': accountHelpers,
    '@/utils/installLinks': {},
  }
  const loaded = { exports: {} as any }
  new Function('require', 'module', 'exports', output)((id: string) => {
    if (id in mocks) return mocks[id]
    if (id.endsWith('.vue')) return { default: {} }
    if (id.startsWith('@/')) return {}
    return require(id)
  }, loaded, loaded.exports)
  scope = Vue.effectScope()
  panel = scope.run(() => loaded.exports.default.setup({}, { expose: () => {} }))
  vi.stubGlobal('window', { confirm: () => true })
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('Account Manager multiple OAuth accounts', () => {
  it.each(['google', 'github', 'gitlab'])('creates and selects separate %s connections without overwriting the first token', async provider => {
    const backend = accountHelpers.oauthBackend(provider)!
    for (const user of ['work', 'personal']) {
      session = { provider_token: `${user}-token`, user: { id: user, app_metadata: { provider } } }
      await panel.ensureFromSignIn(provider, brokerIdentity(session))
    }
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.accountId)).toEqual([`${provider}:work`, `${provider}:personal`])
    expect(rows.map(row => row.token)).toEqual(['work-token', 'personal-token'])
    expect(panel.needsProviderFor({ id: `${provider}:third`, provider })).toBe(true)
    await panel.ensureProviderForBackend(backend, { accountId: `${provider}:work`, token: 'work-token' })
    expect(rows).toHaveLength(2)
    expect(panel.selectedId.value).toBe(rows[0].id)
    await panel.disconnectAccountProvider({ id: `${provider}:work`, provider, name: 'Work' })
    expect(rows.map(row => row.accountId)).toEqual([`${provider}:personal`])
    expect(rows[0].token).toBe('personal-token')
  })

  it('does not put the active account token into a different remembered account or an unbound PAT row', async () => {
    session = { provider_token: 'work-token', user: { id: 'work', app_metadata: { provider: 'github' } } }
    rows.push({ ...providers.syncConfigDefaults(), id: 'legacy', backendType: 'github', token: 'saved-pat' })
    await panel.connectAccountToProvider({ id: 'github:personal', provider: 'github', name: 'Personal' })
    expect(rows[0].token).toBe('saved-pat')
    expect(rows[1].accountId).toBe('github:personal')
    expect(rows[1].token).toBeUndefined()
    expect(await panel.sessionTokenFor('github', 'github:personal')).toBe('')
    expect(await panel.sessionTokenFor('github')).toBe('')
    expect(await panel.sessionTokenFor('googleDrive', 'github:work')).toBe('')
  })

  it('rejects a reconnect approved with a different same-provider account', async () => {
    session = { provider_token: 'personal-token', user: { id: 'personal', app_metadata: { provider: 'github' } } }
    const existing = { ...providers.syncConfigDefaults(), id: 'work-row', backendType: 'github', accountId: 'github:work', token: 'work-token' }
    await expect(panel.finalizeSupabaseToken(existing, 'personal-token')).rejects.toThrow('does not match')
    expect(store.saveSyncConfig).not.toHaveBeenCalled()
  })
})
