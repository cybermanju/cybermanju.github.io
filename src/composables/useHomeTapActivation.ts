// CyberManju OS — Home button touch activation.
// Role: activate a settled single-finger tap without depending on WebView compatibility clicks.
// Exports: useHomeTapActivation. Integrates: MobileLauncher capture handlers.
// Contracts: no app APIs; preserve keyboard/mouse, native controls, scrolling and gesture ownership.
export function useHomeTapActivation() {
  let tap: { button: HTMLButtonElement; id: number; x: number; y: number; time: number } | null = null
  let contacts = 0
  let suppressUntil = 0
  function buttonAt(target: EventTarget | null): HTMLButtonElement | null {
    const element = target as Element | null
    if (element?.closest?.('input,textarea,select,[contenteditable],[data-native-placement]')) return null
    return element?.closest?.('button') ?? null
  }
  function reject() { tap = null; suppressUntil = Date.now() + 800 }
  function start(event: TouchEvent) {
    const fresh = contacts === 0
    contacts = event.touches.length
    if (fresh) suppressUntil = 0
    if (!fresh || contacts !== 1) { reject(); return }
    const first = event.touches[0], button = buttonAt(event.target)
    tap = first && button && !button.disabled && !button.closest('[inert]')
      ? { button, id: first.identifier, x: first.clientX, y: first.clientY, time: Date.now() } : null
  }
  function move(event: TouchEvent) {
    contacts = event.touches.length
    if (!tap) return
    const point = event.touches[0]
    if (contacts !== 1 || !point || point.identifier !== tap.id || Math.hypot(point.clientX - tap.x, point.clientY - tap.y) > 10) reject()
  }
  function end(event: TouchEvent) {
    const current = tap, previousContacts = contacts
    contacts = event.touches.length
    tap = null
    if (!current) return
    const point = event.changedTouches[0]
    if (contacts || previousContacts !== 1 || !point || point.identifier !== current.id || Date.now() - current.time >= 500 || Math.hypot(point.clientX - current.x, point.clientY - current.y) > 10) { reject(); return }
    const button = current.button
    if (!button.isConnected || button.disabled || button.closest('[inert]') || buttonAt(document.elementFromPoint(point.clientX, point.clientY)) !== button) { reject(); return }
    // Prevent the default compatibility click where supported. The capture guard
    // below also consumes late WebView clicks; .click() and keyboard have detail=0.
    if (event.cancelable) event.preventDefault()
    suppressUntil = Date.now() + 800
    button.click()
  }
  function cancel(event?: TouchEvent) { contacts = event?.touches.length ?? 0; reject() }
  function context() { reject() }
  function pointer(event: PointerEvent) {
    if (event.isPrimary && event.pointerType !== 'touch') { contacts = 0; tap = null; suppressUntil = 0 }
  }
  function click(event: MouseEvent) {
    if (event.detail === 0 || Date.now() >= suppressUntil) return
    event.preventDefault(); event.stopImmediatePropagation()
  }
  return { start, move, end, cancel, context, pointer, click }
}
