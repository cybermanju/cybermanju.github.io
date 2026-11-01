// CyberManju OS — Desktop personalization entry guard.
// Role: accept only explicit right-clicks on the desktop surface.
// Exports: shouldOpenDesktopPersonalizationMenu.
// Integrates: DesktopShell context menu and focused interaction tests.
// Contracts: touch entry remains owned by the separate two-finger gesture.
import { enterUiLayout } from './uiLayout'

type ContextTarget = { closest: (selector: string) => Element | null }

/** True only for a mouse right-click on the desktop canvas, not an app/control. */
export function shouldOpenDesktopPersonalizationMenu(
  event: Pick<MouseEvent, 'button' | 'target'>,
  isMobileViewport: boolean,
): boolean {
  if (isMobileViewport || event.button !== 2) return false
  const target = event.target as ContextTarget | null
  if (!target || typeof target.closest !== 'function' || !target.closest('.desktop-area')) return false
  return !target.closest(
    '.app-window, .desktop-overview, .dock, .plasma-panel, .kickoff-menu, .desktop-home-controls, .dock-context-overlay, .desktop-personalization-context-overlay, [data-ui-layout-ignore], input, textarea, select, [contenteditable]:not([contenteditable="false"]), button:not(.desktop-shortcut), a',
  )
}

/** Entry action used only after the desktop context-menu item is selected. */
export function enterDesktopPersonalizationFromContextMenu(): void {
  enterUiLayout()
}
