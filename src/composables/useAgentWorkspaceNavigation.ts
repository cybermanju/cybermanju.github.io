// CyberManju OS — Agent workspace navigation (src/composables/useAgentWorkspaceNavigation.ts).
// Role: Keep phone screen history and unsent drafts separate from persistent Agent/run state.
// Exports: useAgentWorkspaceNavigation, AgentWorkspaceRoute.
// Integrates: Vue refs and the existing cybermanju:mobile-back shell event.
// Contracts: No storage/API writes; draft ownership is explicit; only the active agent panel claims Back.
import { computed, ref } from 'vue'

export type AgentWorkspaceRoute =
  | { view: 'inbox' }
  | { view: 'conversation'; id: string }
  | { view: 'profile'; id: string }
  | { view: 'group'; id: string }
  | { view: 'advanced' }

export function useAgentWorkspaceNavigation() {
  const stack = ref<AgentWorkspaceRoute[]>([{ view: 'inbox' }])
  const drafts = ref<Record<string, string>>({})
  const route = computed(() => stack.value[stack.value.length - 1])
  const canGoBack = computed(() => stack.value.length > 1)

  function open(next: AgentWorkspaceRoute) {
    const current = route.value
    if (current.view === next.view && ('id' in current ? current.id : '') === ('id' in next ? next.id : '')) return
    stack.value = [...stack.value, next]
  }
  function back(): boolean {
    if (!canGoBack.value) return false
    stack.value = stack.value.slice(0, -1)
    return true
  }
  function home() { stack.value = [{ view: 'inbox' }] }
  function draftFor(conversationId: string): string { return drafts.value[conversationId] ?? '' }
  function setDraft(conversationId: string, text: string) {
    if (!conversationId) return
    drafts.value = { ...drafts.value, [conversationId]: text }
  }
  /** Async sends may clear only the submitted draft, never a newer edit. */
  function clearSubmittedDraft(conversationId: string, submitted: string) {
    if (draftFor(conversationId) !== submitted) return
    const next = { ...drafts.value }
    delete next[conversationId]
    drafts.value = next
  }
  /** Clear transient data when the owner/auth boundary changes. */
  function reset() { home(); drafts.value = {} }
  function handleMobileBack(event: Event) {
    if ((event as CustomEvent<{ panel?: string }>).detail?.panel !== 'agent' || event.defaultPrevented) return
    if (back()) event.preventDefault()
  }
  return { route, canGoBack, open, back, home, draftFor, setDraft, clearSubmittedDraft, reset, handleMobileBack }
}
