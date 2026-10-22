// CyberManju OS — Empty-space Home personalization gesture.
// Role: open the real picker only after an unmoved primary hold on empty canvas.
// Exports: useHomeEmptyPress. Integrates: Vue lifecycle and pointer events.
// Contracts: controls/widgets never arm; movement, multitouch, blur and teardown cancel.
import { onMounted, onUnmounted } from 'vue'

const occupied = 'button,input,textarea,select,a,[contenteditable],[role="button"],.workspace-app,.workspace-widget,.eagle-card'
export function useHomeEmptyPress(open: () => void, enabled: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number; pointerId: number } | undefined
  let suppressUntil = 0
  let consumedPointer: number | undefined
  function cancel() { if (timer) clearTimeout(timer); timer = undefined; start = undefined }
  function empty(event: { target: EventTarget | null }) { return !(event.target as HTMLElement | null)?.closest?.(occupied) }
  function fire() { const pointer = start?.pointerId; cancel(); if (!enabled()) return; consumedPointer = pointer; suppressUntil = Date.now() + 700; open() }
  function newPointer(event: PointerEvent) { if (event.isPrimary) { suppressUntil = 0; consumedPointer = undefined } else cancel() }
  function release(event?: PointerEvent) { if (consumedPointer !== undefined && (!event || event.pointerId === consumedPointer)) { suppressUntil = Date.now() + 700; consumedPointer = undefined } cancel() }
  function down(event: PointerEvent) {
    cancel()
    if (!enabled() || !event.isPrimary || event.button !== 0 || !empty(event)) return
    start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    timer = setTimeout(fire, 550)
  }
  function move(event: PointerEvent) {
    if (start && (event.pointerId !== start.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)) cancel()
  }
  function context(event: MouseEvent) {
    if (!enabled() || !empty(event)) return
    event.preventDefault()
    // Android may send contextmenu just before or after the timer.
    if (Date.now() >= suppressUntil) fire()
  }
  function click(event: MouseEvent) {
    if (event.detail === 0 || Date.now() >= suppressUntil) return
    event.preventDefault(); event.stopImmediatePropagation()
  }
  function touch(event: TouchEvent) { if (event.touches.length !== 1) cancel() }
  onMounted(() => { window.addEventListener('pointerup', release); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', cancel) })
  onUnmounted(() => { cancel(); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel) })
  return { down, move, cancel, context, click, touch, newPointer }
}
