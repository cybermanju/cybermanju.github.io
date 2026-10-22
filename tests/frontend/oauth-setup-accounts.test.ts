// CyberManju OS — OAuth setup regression coverage: backend equality must never select a
// connection or its token when provisioning a second login for that provider.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SyncConfig } from '@/types'
import { canUseOAuthSession, configsForOAuthAccount } from '@/utils/oauthAccounts'

const cfg = (overrides: Partial<SyncConfig> = {}): SyncConfig => ({
  id: 'sync-1', backendType: 'github', name: 'GitHub', token: 'token-for-row',
  ...overrides,
} as SyncConfig)

describe('OAuth setup account isolation', () => {
  it('selects only the exact provider-qualified identity, not another same-provider account', () => {
    const personal = cfg({ id: 'personal', accountId: 'github:user-a' })
    const work = cfg({ id: 'work', accountId: 'github:user-b', token: 'work-token' })
    const rows = [personal, work]
    expect(configsForOAuthAccount(rows, { id: 'github:user-a', provider: 'github' })).toEqual([personal])
    expect(configsForOAuthAccount(rows, { id: 'github:user-b', provider: 'github' })).toEqual([work])
  })

  it('does not allow legacy unbound rows or a different provider account to supply an OAuth token', () => {
    const legacy = cfg({ accountId: undefined })
    const other = cfg({ accountId: 'github:user-a' })
    expect(configsForOAuthAccount([legacy], { id: 'github:user-b', provider: 'github' })).toEqual([])
    expect(canUseOAuthSession(legacy, { id: 'github:user-b', provider: 'github' })).toBe(false)
    expect(canUseOAuthSession(other, { id: 'github:user-b', provider: 'github' })).toBe(false)
    expect(canUseOAuthSession(cfg({ backendType: 'gitlab', accountId: 'github:user-b' }), { id: 'github:user-b', provider: 'github' })).toBe(false)
  })

  it('keeps OAuth creation/reuse in both wizards bound to identity.id and backend', () => {
    const desktop = readFileSync('src/components/SetupWizard.vue', 'utf8')
    const mobile = readFileSync('src/components/MobileSetupWizard.vue', 'utf8')
    expect(desktop).toContain('c.backendType === backend && c.accountId === accountId')
    expect(desktop).toContain('accountId,')
    expect(desktop).toContain('sessionTokenFor(backend, who.id)')
    expect(desktop).toContain('current.id === cfg.accountId')
    expect(mobile).toContain('c.backendType === backend && c.accountId === who.id')
    expect(mobile).toContain('accountId: who.id')
    expect(mobile).toContain('current?.id === who.id')
    expect(mobile).toContain('oauthAccountId ? { accountId: oauthAccountId } : {}')
  })
})
