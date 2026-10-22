// CyberManju OS — Home touch release-click ownership.
// Role: let ordinary taps reach existing buttons, but consume clicks after movement or cancellation.
// Exports: useHomeTouchSafety. Integrates: HomeWorkspaceStudio touch and click capture.
// Contracts: no launch APIs; keyboard clicks survive; rejected sequences stay rejected until release.
export function useHomeTouchSafety() {
  let count = 0, rejected = false, suppressUntil = 0
  let origin: { x: number; y: number } | null = null
  function reject() { rejected = true; suppressUntil = Date.now() + 800 }
  function start(event: TouchEvent) {
    if (!count) { rejected = false; suppressUntil = 0; const first = event.touches[0]; origin = first ? { x: first.clientX, y: first.clientY } : null }
    if (event.touches.length !== 1 || count > 0) reject()
    count = event.touches.length
  }
  function move(event: TouchEvent) {
    const first = event.touches[0]
    if (event.touches.length !== count || first && origin && Math.hypot(first.clientX - origin.x, first.clientY - origin.y) > 10) reject()
    count = event.touches.length
  }
  function end(event: TouchEvent) {
    const last = event.changedTouches?.[0]
    if (last && origin && Math.hypot(last.clientX - origin.x, last.clientY - origin.y) > 10) reject()
    if (event.touches.length || count !== 1) reject()
    if (rejected) suppressUntil = Date.now() + 800
    count = event.touches.length
    if (!count) origin = null
  }
  function cancel(event?: TouchEvent) { reject(); count = event?.touches.length ?? 0; origin = null }
  function click(event: MouseEvent) {
    if (event.detail === 0 || !(count && rejected || Date.now() < suppressUntil)) return
    event.preventDefault(); event.stopImmediatePropagation()
  }
  return { start, move, end, cancel, click }
}
