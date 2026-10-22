// CyberManju OS — Agent workspace focus helper (src/utils/agentWorkspaceFocus.ts).
// Role: Move keyboard focus to the active, visible detail screen after navigation.
// Exports: focusActiveWorkspaceHeading.
// Integrates: AgentsWorkspace detail host and browser layout visibility.

export function focusActiveWorkspaceHeading(root: ParentNode | null, isDetail: boolean): boolean {
  if (!root || !isDetail) return false
  const target = root.querySelector<HTMLElement>('.aw-content-host h1, .aw-content-host .aw-chat-title')
  if (!target || target.getClientRects().length === 0) return false
  target.focus()
  return true
}
