// CyberManju OS — OAuth account isolation regression tests.
// Role: Exercise provider-qualified connection matching and credential routing.
// Exports: none.
// Integrates: Vitest and OAuth account helpers.
// Contracts: Each login owns only its own connection rows, including same-provider repeats.
import { describe, expect, it } from 'vitest'
import { canUseOAuthSession, configsForOAuthAccount, oauthBackend } from '@/utils/oauthAccounts'
import type { SyncConfig } from '@/types'
import { syncConfigDefaults } from '@/utils/providers'

const providers = ['google', 'github', 'gitlab'] as const
function config(provider: string, accountId?: string, id = 'connection'): SyncConfig {
  return { ...syncConfigDefaults(), id, backendType: oauthBackend(provider)!, accountId }
}

describe('OAuth connection ownership', () => {
  it.each(providers)('separates two %s accounts and leaves legacy/PAT connections unclaimed', provider => {
    const first = { id: `${provider}:work`, provider }
    const second = { id: `${provider}:personal`, provider }
    const rows = [config(provider, first.id, 'work'), config(provider, second.id, 'personal'), config(provider, undefined, 'legacy')]
    expect(configsForOAuthAccount(rows, first).map(c => c.id)).toEqual(['work'])
    expect(configsForOAuthAccount(rows, second).map(c => c.id)).toEqual(['personal'])
    expect(canUseOAuthSession(rows[0], first)).toBe(true)
    expect(canUseOAuthSession(rows[0], second)).toBe(false)
    expect(canUseOAuthSession(rows[1], first)).toBe(false)
    expect(canUseOAuthSession(rows[2], first)).toBe(false)
    // Disconnect/revoke of the work account must preserve the other token and legacy row.
    const targets = new Set(configsForOAuthAccount(rows, first).map(c => c.id))
    expect(rows.filter(c => !targets.has(c.id)).map(c => c.id)).toEqual(['personal', 'legacy'])
  })

  it('never shares credentials across providers even if their broker user ID matches', () => {
    const rows = providers.map(provider => config(provider, `${provider}:same-broker-user`, provider))
    for (const provider of providers) {
      const account = { id: `${provider}:same-broker-user`, provider }
      expect(configsForOAuthAccount(rows, account).map(c => c.id)).toEqual([provider])
      expect(rows.filter(c => canUseOAuthSession(c, account)).map(c => c.id)).toEqual([provider])
    }
    expect(canUseOAuthSession(config('github', 'shared'), { id: 'shared', provider: 'google' })).toBe(false)
  })

  it('fails closed for unknown providers, missing identity, and empty ownership', () => {
    expect(oauthBackend('unknown')).toBeNull()
    expect(canUseOAuthSession(config('github', 'github:user'), null)).toBe(false)
    expect(canUseOAuthSession(config('github', ''), { id: '', provider: 'github' })).toBe(false)
    expect(configsForOAuthAccount([config('github', 'user')], { id: 'user', provider: 'unknown' })).toEqual([])
  })
})
