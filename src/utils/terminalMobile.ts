// CyberManju OS — TerminalMobile (src/utils/terminalMobile.ts).
// Role: Pure responsive interaction helpers used by the cybsh terminal.
// Exports: fontSizeAfterPinch.
// Integrates: src/components/TerminalPanel.vue.
// Contracts: zoom is one point per intentional pinch step and stays within 10–22 px.

/** Convert a pinch scale into one readable font-size step, ignoring tiny motion. */
export function fontSizeAfterPinch(current: number, scale: number): number {
  const delta = scale >= 1.12 ? 1 : scale <= 0.89 ? -1 : 0
  return Math.max(10, Math.min(22, current + delta))
}
