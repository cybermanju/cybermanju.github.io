// CyberManju OS — Launcher workspace gestures (src/composables/useLauncherWorkspaceGestures.ts).
// Role: single-finger workspace routing observed before Home stops bubbling.
// Exports: useLauncherWorkspaceGestures; Integrates: MobileLauncher capture handlers.
// Contracts: no lifecycle listeners or app APIs; preserve controls, scrolling and multitouch ownership.
import { drawerGestureProgress, shouldCommitDrawerGesture } from '@/utils/drawerGesture'

type Options = {
  blocked: () => boolean
  openDrawer: () => void
  openSearch: () => void
  progress: (value: number) => void
  suppressClick: () => void
}
type Gesture = {
  id: number; x: number; y: number; startedAt: number
  target: Element; scroller: HTMLElement | null; scrollTop: number
  direction: 'drawer' | 'search'; claimed: boolean
}
const EXCLUDED = 'button,a,input,select,textarea,[contenteditable],[role="button"],.workspace-app,.workspace-widget,[data-native-placement],.studio-picker,.orb-navigator,.is-editing,.is-overview,.app-drawer-veil,.msg-veil,.mla-custom-veil,details,summary,[inert]'
const clock = () => performance.now()

export function useLauncherWorkspaceGestures(options: Options) {
  let gesture: Gesture | null = null
  let contacts = 0
  function reset() { if (gesture) options.progress(0); gesture = null }
  function cancel(event?: TouchEvent) { reset(); contacts = event?.touches.length ?? 0 }
  function invalid(target: EventTarget | null): target is null {
    return !(target instanceof Element) || !target.isConnected || !!target.closest(EXCLUDED) || !target.closest('.home-studio')
  }
  function stillValid(current: Gesture) {
    return !options.blocked() && !invalid(current.target) && (!current.scroller || (current.scroller.isConnected && !current.scroller.closest('[inert]') && current.scroller.scrollTop === current.scrollTop))
  }
  function find(touches: TouchList, id: number) {
    for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) return touches[i]
    return null
  }
  function start(event: TouchEvent) {
    const fresh = contacts === 0
    contacts = event.touches.length
    if (!fresh || contacts !== 1) { reset(); return }
    reset()
    if (options.blocked() || invalid(event.target)) return
    const target = event.target as Element, point = event.touches[0]
    if (!point) return
    const studio = target.closest('.home-studio')!
    const scroller = (target.closest('.workspace-content') ?? studio.querySelector('.workspace-content:not([inert])')) as HTMLElement | null
    const scrollTop = scroller?.scrollTop ?? 0
    const maxScroll = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0
    const height = window.visualViewport?.height ?? window.innerHeight
    // Reserve only the outer fifths for the launcher shortcuts. The broad
    // center remains available for all four Home page directions.
    const rect = studio.getBoundingClientRect()
    const top = Math.max(0, rect.top), bottom = Math.min(height, rect.bottom)
    const zoneTop = bottom > top ? top : 0, zoneHeight = bottom > top ? bottom - top : height
    const direction = point.clientY > zoneTop + zoneHeight * .8 ? 'drawer' : point.clientY < zoneTop + zoneHeight * .2 ? 'search' : null
    if (!direction || (direction === 'drawer' ? scrollTop < maxScroll - 1 : scrollTop > 0)) return
    gesture = { id: point.identifier, x: point.clientX, y: point.clientY, startedAt: clock(), target, scroller, scrollTop, direction, claimed: false }
  }
  function sample(event: TouchEvent, point: Touch) {
    const current = gesture
    if (!current || !stillValid(current)) { reset(); return }
    const dx = Math.abs(point.clientX - current.x), dy = point.clientY - current.y
    // At the top/bottom edge, the shell owns vertical shortcut swipes. Swipes
    // begun through the broad center never enroll here and reach the workspace.
    const distance = current.direction === 'drawer' ? -dy : dy
    if (dx >= 60 || (dx > 10 && dx >= Math.abs(dy)) || distance < -10 || (current.claimed && distance <= 10)) { reset(); return }
    if (distance <= 10) return
    if (!event.cancelable) { reset(); return }
    current.claimed = true
    event.preventDefault()
    // The shell owns a recognized top/bottom shortcut drag; keep the same move
    // from also advancing the nested workspace. Let touchend reach both owners
    // so the workspace can retire its pending sequence cleanly.
    if (event.type === 'touchmove') event.stopPropagation()
    options.suppressClick()
    if (current.direction === 'drawer') options.progress(drawerGestureProgress(distance, Math.min(window.visualViewport?.height ?? window.innerHeight, 800)))
  }
  function move(event: TouchEvent) {
    contacts = event.touches.length
    if (!gesture) return
    const point = find(event.touches, gesture.id)
    if (contacts !== 1 || !point) { reset(); return }
    sample(event, point)
  }
  function end(event: TouchEvent) {
    const previousContacts = contacts
    contacts = event.touches.length
    if (!gesture) return
    const point = find(event.changedTouches, gesture.id)
    if (previousContacts !== 1 || contacts || !point) { reset(); return }
    sample(event, point)
    const current = gesture
    if (!current) return
    const dy = point.clientY - current.y, dx = point.clientX - current.x
    const commit = current.claimed && (current.direction === 'drawer'
      ? shouldCommitDrawerGesture(-dy, dx, clock() - current.startedAt)
      : dy >= 72 && Math.abs(dx) < dy)
    reset() // Retire ownership before invoking async UI callbacks or reentrant events.
    if (!commit) return
    options.suppressClick()
    if (current.direction === 'drawer') options.openDrawer()
    else options.openSearch()
  }
  return { start, move, end, cancel }
}
