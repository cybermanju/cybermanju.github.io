// CyberManju OS — Agent event visibility (src/utils/agentEventVisibility.ts).
// Role: Keep raw/internal A2A protocol payloads out of human chat and context pickers.
// Exports: userVisibleAgentEvents.
// Integrates: Actual HubEvent v1; explicit presentation allowlist supplied only by the real projection adapter.
// Contracts: No visibility inferred from legacy kind/sender; unknown/null events fail closed even if allowlisted.
import type { HubEvent } from '@/types/agentWorkspace'

export function userVisibleAgentEvents(events: readonly (HubEvent | null | undefined)[], conversationId: string, userVisibleEventIds: readonly string[] = []): HubEvent[] {
  const allowed = new Set(userVisibleEventIds)
  const kinds = new Set(['message', 'delegation', 'assistant', 'runFailed'])
  const seen = new Set<string>()
  return events.filter((event): event is HubEvent => {
    if (!event || typeof event.id !== 'string' || !event.id || !kinds.has(event.kind)) return false
    if (!('visibility' in event) || event.visibility !== 'user') return false
    if (event.conversationId !== conversationId || !allowed.has(event.id) || seen.has(event.id)) return false
    if (typeof event.text !== 'string' || !Number.isSafeInteger(event.seq) || event.seq < 1) return false
    seen.add(event.id)
    return true
  }).sort((a, b) => a.seq - b.seq)
}
