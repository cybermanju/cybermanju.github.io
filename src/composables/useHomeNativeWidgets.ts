// CyberManju OS — Home-native widget placement coordinator.
// Role: hide native hit regions before motion/overlays; attach only settled, fully visible active-page slots.
// Exports: useHomeNativeWidgets. Integrates: AppWidgetHost bridge and fail-closed CSS-to-dp conversion.
// Contracts: never stream animation frames into layout; native views are not DOM previews.
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useAndroidWidgets } from '@/composables/useAndroidWidgets'
import { nativeWidgetBounds } from '@/utils/nativeWidgetGeometry'
import type { HomeWorkspaceState } from '@/utils/homeWorkspaces'
// The host starts hidden and only this coordinator issues visible layouts.
// Keep visibility debt and command ordering across Home remounts: a timed-out
// layout or failed unmount hide can leave a native view owned by the Activity.
// The session marker also survives a WebView reload without Activity recreation.
const visibilityKey = 'cybermanju.home.native-widget-visible.v1'
function savedVisibilityDebt() { try { return sessionStorage.getItem(visibilityKey) !== null } catch { return true } }
let chain = Promise.resolve(), hideInFlight: Promise<boolean> | null = null, mayBeVisible = savedVisibilityDebt()
function enqueue<T>(action: () => Promise<T>): Promise<T> { const job = chain.then(action); chain = job.then(() => {}, () => {}); return job }
export function useHomeNativeWidgets(root: Ref<HTMLElement | undefined>, state: Ref<HomeWorkspaceState>, blocked: () => boolean) {
  const bridge = useAndroidWidgets()
  const placementMessages = ref<Record<string, string>>({})
  const activeNative = computed(() => state.value.pages.find(p => p.id === state.value.activeId)?.items.filter(i => i.kind === 'widget' && i.ref.startsWith('native:')) || [])
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  function requestHide(force = false): Promise<boolean> {
    if (!bridge.supported) return Promise.resolve(true)
    // A best-effort lifecycle hide must not gate apps when no layout was sent.
    // suspend invalidates queued layouts before taking this fast path.
    if (!force && !mayBeVisible) return Promise.resolve(true)
    if (hideInFlight) return hideInFlight
    hideInFlight = enqueue(async () => {
      try {
        // The bridge treats unsupported hide as a no-op success, not a host
        // acknowledgment. That is insufficient once a view may be attached.
        if (mayBeVisible && bridge.status.value === 'unsupported') return false
        if (await bridge.hide()) {
          mayBeVisible = false
          try { sessionStorage.removeItem(visibilityKey) } catch { /* A stale marker stays conservative on reload. */ }
        }
      } catch { /* Unknown hide outcome cannot discharge existing visibility debt. */ }
      return !mayBeVisible
    }).finally(() => { hideInFlight = null })
    return hideInFlight
  }
  function suspend(force = false): Promise<boolean> { generation++; clearTimeout(timer); return requestHide(force) }
  function visibleOverlay() {
    if (typeof document === 'undefined') return false
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [aria-modal="true"], .notification-item')).some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
  }
  function canRender() {
    const vv = window.visualViewport
    const fieldFocused = (document.activeElement as HTMLElement | null)?.matches('input,textarea,[contenteditable="true"]')
    return bridge.status.value === 'ready' && !destroyed && !blocked() && !document.hidden && document.hasFocus() && window.matchMedia('(max-width: 768px)').matches && !visibleOverlay() && !fieldFocused && (!vv || vv.height >= innerHeight - 2 && vv.width >= innerWidth - 2)
  }
  function fullyVisible(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (rect.top < bounds.top || rect.bottom > bounds.bottom)) return false
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (rect.left < bounds.left || rect.right > bounds.right)) return false
    }
    return true
  }
  async function settle() {
    const token = generation
    if (!canRender() || !await requestHide() || token !== generation) return
    const viewport = bridge.viewport.value
    if (!viewport) return
    const messages: Record<string, string> = {}
    for (const item of activeNative.value) {
      if (token !== generation || !canRender()) break
      const record = bridge.records.value.find(r => r.placementId === item.id)
      if (!record || record.state !== 'ready' || !record.providerAvailable) continue
      const element = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-native-placement]') || []).find(e => e.dataset.nativePlacement === item.id)
      if (!element || !fullyVisible(element)) { messages[item.id] = 'Scroll until the entire widget is visible; it stays hidden while moving.'; continue }
      const provider = bridge.providers.value.find(p => p.provider === record.provider)
      const vv = window.visualViewport
      const bounds = nativeWidgetBounds(element.getBoundingClientRect(), { cssWidth: innerWidth, cssHeight: innerHeight, widthDp: viewport.widthDp, heightDp: viewport.heightDp, scale: vv?.scale || 1, offsetLeft: vv?.offsetLeft || 0, offsetTop: vv?.offsetTop || 0 }, { widthDp: provider?.minWidthDp || 1, heightDp: provider?.minHeightDp || 1 })
      if (!bounds) { messages[item.id] = 'Native bounds are not aligned or the provider minimum does not fit. Reset page zoom, resize or rotate; no widget was overlaid.'; continue }
      await enqueue(async () => {
        if (token !== generation || !canRender()) return
        // No await between the stale-generation check, debt and dispatch. A
        // queued layout is canceled by suspend; a sent one needs confirmed hide,
        // even if its response fails or times out after the host attached it.
        try { sessionStorage.setItem(visibilityKey, '1') } catch {
          messages[item.id] = 'Native widget stays hidden because safe visibility recovery could not be saved. Restore session storage and check status.'
          return
        }
        mayBeVisible = true
        const ok = await bridge.layout({ appWidgetId: record.appWidgetId, visible: true, workspaceId: state.value.activeId, ...bounds })
        if (!ok) messages[item.id] = 'The provider refused this placement. Edit the widget size and check status.'
      })
    }
    placementMessages.value = messages
  }
  function schedule(force = false) { void suspend(force); if (!destroyed) timer = setTimeout(() => { void settle() }, 420) }
  function activity() { schedule() }
  function resize() { schedule(true) }
  async function resume() { if (document.hidden) { void suspend(true); return } await requestHide(true); await bridge.refresh(); schedule(true) }
  function pointer(event: Event) { if ((event.target as HTMLElement | null)?.closest?.('[data-native-placement]')) return; schedule() }
  let observer: MutationObserver | undefined, overlayBlocked = false
  watch(() => [state.value.activeId, blocked(), activeNative.value.map(i => [i.id, i.data?.heightDp, i.data?.widthDp]), bridge.records.value.map(r => [r.placementId, r.state, r.providerAvailable]), bridge.status.value], () => schedule(), { deep: true, flush: 'sync' })
  onMounted(async () => {
    if (!bridge.supported) return
    document.addEventListener('scroll', activity, true)
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('focusin', activity, true)
    document.addEventListener('focusout', activity, true)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('resize', resize)
    window.addEventListener('focus', resume)
    window.addEventListener('blur', activity)
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', activity)
    overlayBlocked = visibleOverlay()
    observer = new MutationObserver(() => { const next = visibleOverlay(); if (next !== overlayBlocked) { overlayBlocked = next; schedule() } })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'open'] })
    await requestHide(true)
    await bridge.refresh(true)
    schedule(true)
  })
  onUnmounted(() => {
    destroyed = true; void suspend(true); observer?.disconnect()
    document.removeEventListener('scroll', activity, true); document.removeEventListener('pointerdown', pointer, true)
    document.removeEventListener('focusin', activity, true); document.removeEventListener('focusout', activity, true)
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('resize', resize); window.removeEventListener('focus', resume); window.removeEventListener('blur', activity)
    window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', activity)
  })
  return { bridge, placementMessages, suspend, schedule, activeNative }
}
