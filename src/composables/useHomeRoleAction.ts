// CyberManju OS — User-triggered default Home UI controller.
// Role: consume Audio's frozen role contract; never changes native eligibility or intent filters.
// Exports: createHomeRoleAction (testable UI state), useHomeRoleAction, frozen result types.
// Integrates: native-only Tauri invoke/listen, Vue and app-local native-widget suspension.
// Contracts: status reads are passive; request requires a fresh trusted visible CTA click. Missing commands fail closed.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isAndroidApp, isTauri } from '@/composables/useTauri'

export type HomeRoleState = 'held' | 'not_held' | 'unavailable'
export interface HomeRoleStatus { state: HomeRoleState; apiLevel: number }
export interface HomeRoleRequestStart { state: 'held' | 'pending' | 'unavailable' | 'failed'; requestId?: string }
export interface HomeRoleRequestOutcome { requestId: string; state: 'held' | 'declined' | 'unavailable' | 'failed' }
interface RolePorts {
  supported: boolean
  status: () => Promise<unknown>
  request: (requestId: string) => Promise<unknown>
  subscribe: (handler: (value: unknown) => void) => Promise<() => void>
  beforeRequest: () => Promise<boolean>
  now: () => number
  visible: () => boolean
  requestId: () => string
}
const states = ['held', 'not_held', 'unavailable']
function observed(value: unknown): HomeRoleStatus | null {
  if (!value || typeof value !== 'object') return null
  const row = value as HomeRoleStatus
  return states.includes(row.state) && Number.isInteger(row.apiLevel) && row.apiLevel >= 24 ? row : null
}
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Home role response unavailable')), ms) })]).finally(() => clearTimeout(timer))
}
export function createHomeRoleAction(ports: RolePorts) {
  const state = ref<HomeRoleState>('unavailable')
  const apiLevel = ref<number | null>(null)
  const pendingId = ref<string | null>(null)
  const attempt = ref<HomeRoleRequestOutcome['state'] | null>(null)
  const checking = ref(false), requesting = ref(false), connected = ref(false)
  const notice = ref('Checking native default Home support…')
  let returnedDuringRequest = false
  let disposed = false, stop: (() => void) | undefined, generation = 0
  let refreshPromise: Promise<void> | null = null
  let reconcilePromise: Promise<void> | null = null
  let reconcileRevision = 0
  let pendingOutcome: HomeRoleRequestOutcome | undefined
  const canRequest = computed(() => ports.supported && connected.value && state.value === 'not_held' && !checking.value && !requesting.value && !pendingId.value)
  async function refresh() {
    if (disposed || !ports.supported) return
    if (refreshPromise) return refreshPromise
    checking.value = true
    const run = (async () => {
      try {
        const status = observed(await bounded(ports.status(), 2000))
        if (disposed) return
        if (!status) throw new Error('Unknown Home role status')
        state.value = status.state; apiLevel.value = status.apiLevel
        notice.value = status.state === 'held' ? 'CyberManju is your default Home.' : status.state === 'not_held' ? 'Choose CyberManju in Android. Opening system settings is not permission granted.' : 'Default Home setup is unavailable in this native build.'
      } catch {
        if (!disposed) { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build. No change was confirmed.' }
      } finally { if (!disposed) checking.value = false; refreshPromise = null }
    })()
    refreshPromise = run
    return run
  }
  async function reconcile(outcome?: HomeRoleRequestOutcome) {
    const id = pendingId.value
    if (!id || disposed || outcome && outcome.requestId !== id) return
    const revision = ++reconcileRevision
    if (outcome) pendingOutcome = outcome
    if (reconcilePromise) return reconcilePromise
    const run = (async () => {
      let readRevision = revision
      do {
        readRevision = reconcileRevision
        // A passive read started before return/result cannot settle this attempt.
        if (refreshPromise) await refreshPromise
        await refresh()
        if (disposed || pendingId.value !== id) return
      } while (readRevision !== reconcileRevision)
      pendingId.value = null
      const result = pendingOutcome
      pendingOutcome = undefined
      // Settings on API24–28 does not report refusal; retain only the observed role.
      attempt.value = result && (result.state !== 'declined' || (apiLevel.value ?? 0) >= 29) ? result.state : null
      if (state.value === 'not_held' && attempt.value === 'declined') notice.value = 'Android reported that the Home request was declined. CyberManju is not the default Home.'
      else if (state.value !== 'held' && attempt.value === 'failed') notice.value = 'Android could not finish the Home request. No default Home change was confirmed.'
      else if (state.value !== 'held' && attempt.value === 'unavailable') { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build.' }
    })()
    reconcilePromise = run
    try { await run } finally { reconcilePromise = null }
  }
  async function start() {
    if (disposed || connected.value || !ports.supported) return
    let acceptingSubscription = true
    try {
      const unlisten = await bounded(ports.subscribe(value => {
        if (!value || typeof value !== 'object') return
        const outcome = value as HomeRoleRequestOutcome
        if (typeof outcome.requestId !== 'string' || !['held', 'declined', 'unavailable', 'failed'].includes(outcome.state)) return
        void reconcile(outcome)
      }).then(unlisten => { if (!acceptingSubscription || disposed) { unlisten(); return () => {} } return unlisten }), 2000)
      if (disposed) { unlisten(); return }
      stop = unlisten; connected.value = true
      await refresh() // Passive capability/status query only. Never requests a role.
    } catch {
      if (!disposed) { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build.' }
    } finally { acceptingSubscription = false }
  }
  async function request(event: MouseEvent) {
    const startedAt = ports.now(), eventAge = startedAt - event.timeStamp
    if (!event.isTrusted || !Number.isFinite(eventAge) || eventAge < 0 || eventAge > 5000 || !ports.visible() || !canRequest.value) return
    const current = ++generation
    const gestureStamp = event.timeStamp
    let requestId: string | null = null
    requesting.value = true; attempt.value = null; returnedDuringRequest = false
    try {
      if (!await ports.beforeRequest() || disposed || !ports.visible()) return
      await refresh()
      if (disposed || current !== generation || state.value !== 'not_held') return
      // Monotonic freshness is rechecked immediately before invoke; requestId is correlation, never consent.
      const age = ports.now() - gestureStamp
      if (!Number.isFinite(age) || age < 0 || age > 5000 || !ports.visible()) { notice.value = 'Tap Set as default Home again to open Android settings.'; return }
      const id = ports.requestId(); requestId = id; pendingOutcome = undefined; pendingId.value = id
      const value = await bounded(ports.request(id), 5000)
      if (disposed || current !== generation || pendingId.value !== id) return
      if (!value || typeof value !== 'object') throw new Error('Invalid Home role response')
      const reply = value as HomeRoleRequestStart
      if (!['held', 'pending', 'unavailable', 'failed'].includes(reply.state) || reply.requestId !== undefined && reply.requestId !== id) throw new Error('Mismatched Home role response')
      if (reply.state === 'pending') notice.value = 'Finish choosing a Home in Android. Waiting to check the actual default when you return…'
      else await reconcile({ requestId: id, state: reply.state })
    } catch {
      if (reconcilePromise) await reconcilePromise
      if (disposed || current !== generation || requestId && pendingId.value !== requestId) return
      // An ambiguous invoke is never repeated automatically; only a passive status check resolves it.
      state.value = 'unavailable'; notice.value = 'Default Home request could not be confirmed. Return to the app or use Check status; no request was retried.'
    } finally { if (!disposed) { requesting.value = false; if (returnedDuringRequest && pendingId.value) await reconcile() } }
  }
  async function returned() { if (!pendingId.value) return; if (requesting.value) { returnedDuringRequest = true; return } await reconcile() }
  async function check() { if (requesting.value) return; if (!connected.value) { await start(); return } if (pendingId.value) await reconcile(); else await refresh() }
  function dispose() { disposed = true; generation++; stop?.(); stop = undefined }
  return { supported: ports.supported, state, apiLevel, pendingId, attempt, checking, requesting, notice, canRequest, start, request, returned, check, dispose }
}
export function useHomeRoleAction(beforeRequest: () => Promise<boolean>) {
  const role = createHomeRoleAction({
    supported: isTauri() && isAndroidApp(),
    status: () => invoke('android_home_role_status'),
    request: requestId => invoke('android_home_role_request', { requestId }),
    subscribe: handler => listen<unknown>('cybermanju:home-role-result', event => handler(event.payload)),
    beforeRequest, now: () => performance.now(), visible: () => document.visibilityState === 'visible' && document.hasFocus(),
    requestId: () => crypto.randomUUID(),
  })
  const visible = () => { if (document.visibilityState === 'visible') void role.returned() }
  const focused = () => { void role.returned() }
  onMounted(() => { void role.start(); document.addEventListener('visibilitychange', visible); window.addEventListener('focus', focused) })
  onUnmounted(() => { role.dispose(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', focused) })
  return role
}
