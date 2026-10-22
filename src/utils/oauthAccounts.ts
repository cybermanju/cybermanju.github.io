// CyberManju OS — OAuth account isolation (src/utils/oauthAccounts.ts).
// Role: Match provider connections to a specific remembered OAuth login.
// Exports: oauthBackend, configsForOAuthAccount, canUseOAuthSession.
// Integrates: SyncConfig and the broker identity bridge.
// Contracts: Never infer ownership of legacy unbound connections from backend alone.
import type { SyncBackendType, SyncConfig } from '@/types'

type Account = { id: string; provider: string }

export function oauthBackend(provider: string): SyncBackendType | null {
  if (provider === 'google' || provider === 'googleDrive') return 'googleDrive'
  if (provider === 'github' || provider === 'gitlab') return provider
  return null
}

export function configsForOAuthAccount(configs: SyncConfig[], account: Account): SyncConfig[] {
  const backend = oauthBackend(account.provider)
  if (!backend || !account.id) return []
  return configs.filter(config => config.backendType === backend && config.accountId === account.id)
}

export function canUseOAuthSession(config: Pick<SyncConfig, 'backendType' | 'accountId'>, account: Account | null): boolean {
  return !!account && !!config.accountId && config.accountId === account.id && oauthBackend(account.provider) === config.backendType
}
