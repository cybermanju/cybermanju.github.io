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
  connectedAccounts,
  recordConnectedAccount,
  identityFromSession,
  setSupabaseConfig,
  startSupabaseOAuth,
  startSupabaseSignIn,
  signInWithPopup,
  supabaseSessionProvider,
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
  connectedAccounts.value = []
  await clearSupabaseConfig()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Supabase broker OAuth', () => {
  it('shares one client across sequential login and connection starts for every provider', async () => {
    // Supabase has one PKCE verifier per client, so independent starts must not overlap.
    const starts = []
    starts.push(await startSupabaseSignIn('google'))
    starts.push(await startSupabaseSignIn('github'))
    starts.push(await startSupabaseSignIn('gitlab'))
    starts.push(await startSupabaseOAuth('googleDrive'))
    starts.push(await startSupabaseOAuth('github'))
    starts.push(await startSupabaseOAuth('gitlab'))

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

  it('requests provider account pickers only with documented parameters', async () => {
    expect(setSupabaseConfig('https://broker.example.test', 'broker-public-anon-key')).toBeNull()
    await startSupabaseSignIn('github')
    await startSupabaseSignIn('gitlab')
    await startSupabaseSignIn('google')
    const calls = sdk.signInWithOAuth.mock.calls.map(([request]) => request as any)
    expect(calls[0].options.queryParams).toEqual({ prompt: 'select_account' })
    expect(calls[1].options.queryParams).toBeUndefined()
    expect(calls[2].options.queryParams).toEqual({ access_type: 'offline', prompt: 'select_account' })
  })

  it('fails closed when local sign-out fails before starting either OAuth flow', async () => {
    expect(setSupabaseConfig('https://broker.example.test', 'broker-public-anon-key')).toBeNull()
    const signOutError = new Error('local sign-out failed')
    sdk.signOut.mockResolvedValueOnce({ error: signOutError } as any)
    await expect(startSupabaseOAuth('github')).rejects.toBe(signOutError)
    expect(sdk.signOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(sdk.signInWithOAuth).not.toHaveBeenCalled()
    sdk.signOut.mockResolvedValueOnce({ error: signOutError } as any)
    await expect(startSupabaseSignIn('google')).rejects.toBe(signOutError)
    expect(sdk.signInWithOAuth).not.toHaveBeenCalled()
  })

  it('does not mislabel an unknown provider callback token as GitHub', async () => {
    sdk.state.session = {
      provider_token: 'unknown-provider-token',
      user: { id: 'unknown-user', app_metadata: { provider: 'unsupported' } },
    }
    ;(window as any).location.search = '?code=unknown-provider-code'
    await expect(finishSupabaseReturn()).resolves.toBe(true)
    expect(takeProviderTokenStash()).toBeNull()
    expect(identity.value).toBeNull()
    expect(connectedAccounts.value).toHaveLength(0)
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

  it('keeps two accounts per provider distinct and resolves a linked broker user by the requested provider', () => {
    const session = (provider: string, userId: string, email: string, identities: any[]) => ({
      provider_token: `${provider}-${email}-token`, user: {
        id: userId, email, user_metadata: { full_name: email },
        app_metadata: { provider: 'google' }, identities,
      },
    }) as any
    const identities = [
      { provider: 'google', identity_data: { email: 'work@example.test' } },
      { provider: 'github', identity_data: { email: 'work-gh@example.test' } },
      { provider: 'gitlab', identity_data: { email: 'work-gl@example.test' } },
    ]
    localStorage.setItem('cybermanju.oauthProvider', 'github')
    const linked = session('github', 'shared-broker-user', 'work@example.test', identities)
    expect(identityFromSession(linked)).toMatchObject({ id: 'github:shared-broker-user', userId: 'shared-broker-user', provider: 'github' })
    expect(supabaseSessionProvider(linked)).toBe('github')
    connectedAccounts.value = [{ id: 'shared-broker-user', email: 'work@example.test', name: 'legacy', avatarUrl: '', provider: 'github', lastUsed: 1 }]
    recordConnectedAccount(linked)
    expect(connectedAccounts.value).toHaveLength(1)
    expect(connectedAccounts.value[0].id).toBe('github:shared-broker-user')
    for (const [provider, userId, email] of [
      ['google', 'google-work', 'work@gmail.test'], ['google', 'google-home', 'home@gmail.test'],
      ['github', 'github-work', 'work-gh@test.test'], ['github', 'github-home', 'home-gh@test.test'],
      ['gitlab', 'gitlab-work', 'work-gl@test.test'], ['gitlab', 'gitlab-home', 'home-gl@test.test'],
    ]) {
      localStorage.setItem('cybermanju.oauthProvider', provider)
      recordConnectedAccount(session(provider, userId, email, [{ provider }]))
    }
    expect(connectedAccounts.value.filter(a => a.provider === 'google')).toHaveLength(2)
    expect(connectedAccounts.value.filter(a => a.provider === 'github')).toHaveLength(3)
    expect(connectedAccounts.value.filter(a => a.provider === 'gitlab')).toHaveLength(2)
    expect(new Set(connectedAccounts.value.map(a => a.id)).size).toBe(connectedAccounts.value.length)
  })

  it('does not accept an old session from another provider after sign-out', async () => {
    expect(setSupabaseConfig('https://broker.example.test', 'broker-public-anon-key')).toBeNull()
    sdk.state.session = {
      provider_token: 'stale-google-token',
      user: { id: 'stale-google-user', email: 'stale@example.test', app_metadata: { provider: 'google' } },
    }
    const popup = { closed: true, location: { href: '' }, close: vi.fn() }
    ;(window as any).open = vi.fn(() => popup)
    ;(window as any).addEventListener = vi.fn()
    ;(window as any).removeEventListener = vi.fn()
    await expect(signInWithPopup('github')).rejects.toThrow('sign-in did not complete')
    expect(identity.value).toBeNull()
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
        queryParams: { access_type: 'offline', prompt: 'consent select_account' },
      }),
    }))
    await expect((await import('@/composables/useSupabase')).activateMobileOAuthDeepLinks()).resolves.toBe(true)
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledWith('native-auth-code')
    expect(identity.value?.provider).toBe('google')
    expect(takeProviderTokenStash()?.providerToken).toBe('google-native-access-token')
  })
})
