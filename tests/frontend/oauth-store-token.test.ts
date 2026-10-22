// CyberManju OS — OAuth store credential-routing tests.
// Role: Verify the actual Pinia probe path never injects another account's token.
// Exports: none.
// Integrates: App store, mocked transport and broker sessions.
// Contracts: Provider and account must both match; manual credentials remain untouched.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app'
import { syncConfigDefaults } from '@/utils/providers'
import { oauthBackend } from '@/utils/oauthAccounts'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => true), session: null as any }))
vi.mock('@/composables/useTauri', () => ({
  invoke: mocks.invoke, getAuthToken: () => '', setAuthToken: vi.fn(),
  isStaticHost: () => false, isWebMode: () => false,
}))
vi.mock('@/composables/useNotifications', () => ({ useNotifications: () => ({ notify: vi.fn() }) }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: vi.fn() }) }))
vi.mock('@/composables/useSupabase', () => ({
  supabaseSession: async () => mocks.session,
  identityFromSession: (session: any) => session?.identity ?? null,
}))
beforeEach(() => {
  setActivePinia(createPinia())
  mocks.invoke.mockClear()
  mocks.session = { identity: { id: 'github:work', provider: 'github' }, provider_token: 'work-token' }
})

describe('store OAuth live-token isolation', () => {
  it.each(['google', 'github', 'gitlab'])('only injects the active %s account token into its matching connection', async provider => {
    mocks.session = { identity: { id: `${provider}:work`, provider }, provider_token: `${provider}-work-token` }
    const store = useAppStore()
    for (const accountId of [`${provider}:work`, `${provider}:personal`, undefined]) {
      const config = { ...syncConfigDefaults(), id: 'row', backendType: oauthBackend(provider)!, accountId }
      await store.probeSyncConnection(config)
      const sent = (mocks.invoke.mock.calls.at(-1) as any)[1].config
      expect(sent.token).toBe(accountId === `${provider}:work` ? `${provider}-work-token` : undefined)
    }
  })

  it('preserves an explicit PAT and rejects a provider mismatch', async () => {
    const store = useAppStore()
    const config = { ...syncConfigDefaults(), id: 'row', backendType: 'github' as const, accountId: 'github:work', token: 'manual-pat' }
    await store.probeSyncConnection(config)
    expect((mocks.invoke.mock.calls.at(-1) as any)[1].config.token).toBe('manual-pat')
    await store.probeSyncConnection({ ...config, backendType: 'gitlab', token: undefined })
    expect((mocks.invoke.mock.calls.at(-1) as any)[1].config.token).toBeUndefined()
  })
})
