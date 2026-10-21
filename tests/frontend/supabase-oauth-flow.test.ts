// CyberManju OS — Supabase OAuth flow tests (tests/frontend/supabase-oauth-flow.test.ts).
// Role: Frontend regression coverage for the Supabase OAuth broker.
// Exports: none.
// Integrates: Vitest and mocked Supabase SDK.
// Contracts: provider login and callback remain brokered for Google, GitHub, and GitLab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const state: { session: any } = { session: null }
  const signInWithOAuth = vi.fn(async () => ({ data: { url: 'https://broker.example.test/authorize' }, error: null }))
  const getSession = vi.fn(async () => ({ data: { session: state.session }, error: null }))
  const exchangeCodeForSession = vi.fn(async () => ({ data: { session: state.session }, error: null }))
  const signOut = vi.fn(async () => ({ error: null }))
  const auth = { signInWithOAuth, getSession, exchangeCodeForSession, signOut }
  const createClient = vi.fn(() => ({ auth }))
  return { state, signInWithOAuth, getSession, exchangeCodeForSession, signOut, createClient }
})
const deepLink = vi.hoisted(() => ({
  getCurrent: vi.fn(async () => null as string[] | null),
  isRegistered: vi.fn(async () => true),
  onOpenUrl: vi.fn(async () => () => {}),
  register: vi.fn(async () => {}),
}))

vi.mock('@/composables/useVault', () => ({
  vaultGet: vi.fn(async () => null),
  vaultDelete: vi.fn(async () => {}),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))
vi.mock('@tauri-apps/plugin-deep-link', () => deepLink)

import {
  clearSupabaseConfig,
  finishSupabaseReturn,
  identity,
  setSupabaseConfig,
  startSupabaseOAuth,
  startSupabaseSignIn,
  takeProviderTokenStash,
} from '@/composables/useSupabase'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(String(key)) ?? null },
    key(index: number) { return [...values.keys()][index] ?? null },
    removeItem(key: string) { values.delete(String(key)) },
    setItem(key: string, value: string) { values.set(String(key), String(value)) },
  } as Storage
}

beforeEach(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://broker.example.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'broker-public-anon-key')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', {
    __TAURI__: false,
    location: { origin: 'https://app.example.test', pathname: '/index.html', search: '', hash: '' },
    history: { replaceState: vi.fn() },
    opener: null,
    closed: false,
    screen: { width: 1280, height: 800 },
    dispatchEvent: vi.fn(),
  })
  sdk.state.session = null
  sdk.createClient.mockClear()
  sdk.signInWithOAuth.mockClear()
  sdk.getSession.mockClear()
  sdk.exchangeCodeForSession.mockClear()
  sdk.signOut.mockClear()
  deepLink.getCurrent.mockReset().mockResolvedValue(null)
  deepLink.isRegistered.mockReset().mockResolvedValue(true)
  deepLink.onOpenUrl.mockReset().mockResolvedValue(() => {})
  deepLink.register.mockReset().mockResolvedValue(undefined)
  identity.value = null
  await clearSupabaseConfig()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Supabase broker OAuth', () => {
  it('shares a single client across concurrent login and connection starts for every provider', async () => {
    const starts = await Promise.all([
      startSupabaseSignIn('google'),
      startSupabaseSignIn('github'),
      startSupabaseSignIn('gitlab'),
      startSupabaseOAuth('googleDrive'),
      startSupabaseOAuth('github'),
      startSupabaseOAuth('gitlab'),
    ])

    expect(starts).toHaveLength(6)
    expect(sdk.createClient).toHaveBeenCalledOnce()
    const calls = sdk.signInWithOAuth.mock.calls.map(([request]) => request as any)
    expect(calls.map(({ provider }) => provider)).toEqual([
      'google', 'github', 'gitlab', 'google', 'github', 'gitlab',
    ])
    expect(calls[0].options.scopes).toContain('drive.file')
    expect(calls[1].options.scopes).toContain('repo')
    expect(calls[2].options.scopes).toBe('api')
    expect(calls[3].options.scopes).toContain('drive.file')
    expect(calls[4].options.scopes).toContain('repo')
    expect(calls[5].options.scopes).toBe('api')
    expect(calls.every(({ options }) => options.skipBrowserRedirect === true)).toBe(true)
  })

  it('processes an auth-code return and records the matching provider token for Google, GitHub, and GitLab', async () => {
    expect(setSupabaseConfig('https://broker.example.test', 'broker-public-anon-key')).toBeNull()
    const providers = ['google', 'github', 'gitlab'] as const

    for (const provider of providers) {
      sdk.state.session = {
        provider_token: `${provider}-access-token`,
        provider_refresh_token: null,
        user: {
          id: `${provider}-user`,
          email: `${provider}@example.test`,
          user_metadata: { full_name: `${provider} user` },
          app_metadata: { provider },
        },
      }
      const replaceState = vi.fn()
      ;(window as any).location.search = '?code=provider-auth-code&state=oauth-state'
      ;(window as any).history.replaceState = replaceState

      await expect(finishSupabaseReturn()).resolves.toBe(true)
      expect(identity.value?.provider).toBe(provider)
      expect(takeProviderTokenStash()?.backend).toBe(provider)
      expect(replaceState).toHaveBeenCalledWith(null, '', '/index.html')
    }
    expect(sdk.getSession).toHaveBeenCalledTimes(3)
  })

  it('starts native Google sign-in with the deep-link return and exchanges the returned code', async () => {
    expect(setSupabaseConfig('https://broker.example.test', 'broker-public-anon-key')).toBeNull()
    ;(window as any).__TAURI__ = true
    sdk.state.session = {
      provider_token: 'google-native-access-token',
      provider_refresh_token: 'google-native-refresh-token',
      user: {
        id: 'google-native-user',
        email: 'native@example.test',
        user_metadata: { full_name: 'Native Google user' },
        app_metadata: { provider: 'google' },
      },
    }
    deepLink.getCurrent.mockResolvedValue(['cybermanju://oauth/callback?code=native-auth-code'])

    await startSupabaseSignIn('google', false, true)
    expect(sdk.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      options: expect.objectContaining({
        redirectTo: 'cybermanju://oauth/callback',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      }),
    }))
    await expect((await import('@/composables/useSupabase')).activateMobileOAuthDeepLinks()).resolves.toBe(true)
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledWith('native-auth-code')
    expect(identity.value?.provider).toBe('google')
    expect(takeProviderTokenStash()?.providerToken).toBe('google-native-access-token')
  })
})
