// CyberManju OS — Text-menu keyboard navigation.
// Role: Keep all dialog controls reachable without intercepting manual text selection/copy.
// Integrates: UiTextContextMenu focus trap and keyboard regression tests.
export function focusTextMenuKey(event: KeyboardEvent, panel: HTMLElement, active: Element | null): void {
  if (!['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  // Textarea arrows/Home/End and modifier shortcuts belong to native text selection.
  if (event.key !== 'Tab' && (active?.tagName === 'TEXTAREA' || event.ctrlKey || event.metaKey || event.altKey)) return
  const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea[readonly]'))
  if (!controls.length) return
  const index = controls.indexOf(active as HTMLElement)
  const backwards = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
    : index < 0 ? (backwards ? controls.length - 1 : 0)
    : (index + (backwards ? -1 : 1) + controls.length) % controls.length
  event.preventDefault()
  event.stopImmediatePropagation()
  controls[next]?.focus({ preventScroll: true })
}
