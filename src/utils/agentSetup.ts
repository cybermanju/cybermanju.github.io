// CyberManju OS — Agent setup (src/utils/agentSetup.ts).
// Role: bind model settings and optional credentials to one assistant identity.
// Exports: sameAgentConnection, mergeAgentDraft, persistAgentSetup.
// Integrates: AgentPanel and AgentConfig persistence adapters.
// Contracts: blank keys mean unchanged; connection changes never inherit credentials.
import type { AgentConfig } from '@/types'

const endpoint = (value?: string | null) => (value ?? '').trim().replace(/\/+$/, '')

/** Never send a saved provider credential to a different connection. */
export function sameAgentConnection(a: AgentConfig, b: AgentConfig): boolean {
  return a.providerId === b.providerId &&
    endpoint(a.baseUrlOverride) === endpoint(b.baseUrlOverride) &&
    (a.dialectOverride ?? '') === (b.dialectOverride ?? '') &&
    (a.authSchemeOverride ?? '') === (b.authSchemeOverride ?? '') &&
    (a.authNameOverride ?? '') === (b.authNameOverride ?? '')
}

/** Keep routing, tool attachments and credential metadata on ordinary edits. */
export function mergeAgentDraft(draft: AgentConfig, previous?: AgentConfig): AgentConfig {
  if (!previous || !sameAgentConnection(previous, draft)) return { ...draft, hasKey: false }
  return {
    ...previous,
    ...draft,
    id: previous.id,
    hasKey: previous.hasKey,
    createdAt: previous.createdAt,
    fallbackIds: previous.fallbackIds ?? [],
    mcpServers: previous.mcpServers,
  }
}

export interface AgentSetupPersistence {
  saveConfig(config: AgentConfig): Promise<AgentConfig | null>
  saveKey(id: string, key: string): Promise<boolean>
  /** Called before saving a key, so retries update rather than duplicate the row. */
  onConfigSaved(config: AgentConfig): void
}

/** Save settings first, then a nonblank replacement key against that exact id. */
export async function persistAgentSetup(
  config: AgentConfig,
  keyInput: string,
  persistence: AgentSetupPersistence,
): Promise<{ config: AgentConfig; keySaved: boolean } | null> {
  const saved = await persistence.saveConfig(config)
  if (!saved) return null
  persistence.onConfigSaved(saved)
  const key = keyInput.trim()
  if (!key) return { config: saved, keySaved: false }
  if (!await persistence.saveKey(saved.id, key)) return { config: saved, keySaved: false }
  return { config: { ...saved, hasKey: true }, keySaved: true }
}
