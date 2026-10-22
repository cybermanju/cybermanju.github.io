// CyberManju OS — User-triggered default Home UI controller.
// Role: consume Audio's frozen role contract; never changes native eligibility or intent filters.
// Exports: createHomeRoleAction (testable UI state), useHomeRoleAction, frozen result types.
// Integrates: native-only Tauri invoke, window CustomEvent, Vue and native-widget suspension.
// Contracts: passive recovery never opens a picker; only a fresh trusted visible CTA can request. Missing commands fail closed.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isAndroidApp, isTauri } from '@/composables/useTauri'

export type HomeRoleState = 'held' | 'not_held' | 'unavailable'
export type HomeRoleRequestStartState = 'held' | 'pending' | 'unavailable' | 'failed'
export type HomeRoleRequestOutcomeState = HomeRoleState | 'failed'
export interface HomeRoleStatus { state: HomeRoleState; apiLevel: number; pendingRequestId?: string }
export interface HomeRoleRequestStart { state: HomeRoleRequestStartState; requestId?: string }
export interface HomeRoleRequestOutcome { requestId: string; state: HomeRoleRequestOutcomeState }
declare global {
  interface Window {
    __CYBERMANJU_HOME_ROLE_READY__?: boolean
    __CYBERMANJU_HOME_ROLE_ACKED__?: string | null
  }
}
interface RolePorts {
  supported: boolean
  status: () => Promise<unknown>
  request: (requestId: string) => Promise<unknown>
  subscribe: (handler: (value: unknown) => void) => Promise<() => void>
  setReady: (ready: boolean) => void
  acknowledge: (requestId: string) => void
  beforeRequest: () => Promise<boolean>
  now: () => number
  visible: () => boolean
  requestId: () => string
}
const states = ['held', 'not_held', 'unavailable']
const outcomeStates = [...states, 'failed']
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
function observed(value: unknown): HomeRoleStatus | null {
  if (!value || typeof value !== 'object') return null
  const row = value as HomeRoleStatus
  return states.includes(row.state) && Number.isInteger(row.apiLevel) && row.apiLevel >= 24
    && (row.pendingRequestId === undefined || validId(row.pendingRequestId)) ? row : null
}
function rejectedBeforePersistence(error: unknown): boolean {
  // Native auth guards reject before storing/launching the request. Unknown errors,
  // timeouts and malformed replies do not prove that the native operation stopped.
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  return [
    'auth: Home role request requires the foreground CyberManju window',
    'auth: unlock the device before choosing CyberManju as Home',
    'auth: Home role request requires a resumed Activity',
  ].includes(message)
}
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Home role response unavailable')), ms) })]).finally(() => clearTimeout(timer))
}
export function createHomeRoleAction(ports: RolePorts) {
  const state = ref<HomeRoleState>('unavailable')
  const apiLevel = ref<number | null>(null)
  const pendingId = ref<string | null>(null)
  const attempt = ref<HomeRoleRequestOutcomeState | null>(null)
  const checking = ref(false), requesting = ref(false), connected = ref(false)
  const notice = ref('Checking native default Home support…')
  let returnedDuringRequest = false
  let disposed = false, starting = false, stop: (() => void) | undefined, generation = 0
  let refreshPromise: Promise<HomeRoleStatus | null> | null = null
  let reconcilePromise: Promise<void> | null = null
  let reconcileRevision = 0
  let pendingOutcome: HomeRoleRequestOutcome | undefined
  let rejectedId: string | null = null
  const settled = new Set<string>()
  const waitingNotice = 'Finish choosing a Home in Android. Waiting to check the actual default when you return…'
  const canRequest = computed(() => ports.supported && connected.value && state.value === 'not_held' && !checking.value && !requesting.value && !pendingId.value)
  async function refresh() {
    if (disposed || !ports.supported) return null
    if (refreshPromise) return refreshPromise
    checking.value = true
    const run = (async () => {
      try {
        const status = observed(await bounded(ports.status(), 2000))
        if (disposed) return null
        if (!status) throw new Error('Unknown Home role status')
        state.value = status.state; apiLevel.value = status.apiLevel
        // Native persistence is the only recovery source; neither focus nor an ID opens a picker.
        const recoveredId = status.pendingRequestId
        if (!pendingId.value && recoveredId && !settled.has(recoveredId)) pendingId.value = recoveredId
        notice.value = status.state === 'held' ? 'CyberManju is your default Home.' : pendingId.value ? waitingNotice : status.state === 'not_held' ? 'Choose CyberManju in Android. Opening system settings is not permission granted.' : 'Default Home setup is unavailable in this native build.'
        return status
      } catch {
        if (!disposed) { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build. No change was confirmed.' }
        return null
      } finally { if (!disposed) checking.value = false; refreshPromise = null }
    })()
    refreshPromise = run
    return run
  }
  async function reconcile(outcome?: HomeRoleRequestOutcome) {
    if (disposed || outcome && (outcome.requestId !== pendingId.value || settled.has(outcome.requestId))) return
    if (outcome && pendingOutcome?.requestId === outcome.requestId) return reconcilePromise
    const revision = ++reconcileRevision
    if (outcome) pendingOutcome ??= outcome
    if (reconcilePromise) return reconcilePromise
    const run = (async () => {
      let readRevision = revision
      let status: HomeRoleStatus | null
      do {
        readRevision = reconcileRevision
        // A status read started before a native result cannot settle that result.
        if (refreshPromise) await refreshPromise
        status = await refresh()
        if (disposed) return
      } while (readRevision !== reconcileRevision)
      const id = pendingId.value
      // Absence of persistence alone cannot settle an ambiguous invoke or a pending
      // picker. Only a definitive rejection AND a fresh valid no-pending read can.
      const rejected = id !== null && rejectedId === id && !!status && !status.pendingRequestId
      const result = pendingOutcome ?? (rejected ? { requestId: id, state: 'failed' as const } : undefined)
      if (!id || !result || result.requestId !== id) return
      settled.add(id); pendingId.value = null; pendingOutcome = undefined; rejectedId = null
      attempt.value = result.state
      if (state.value === 'held') notice.value = 'CyberManju is your default Home.'
      else if (result.state === 'failed') notice.value = 'Android could not finish the Home request. No default Home change was confirmed.'
      else if (state.value === 'unavailable' || result.state === 'unavailable') { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build.' }
      else notice.value = 'CyberManju is not the default Home. You can choose it in Android.'
    })()
    reconcilePromise = run
    try { await run } finally { reconcilePromise = null }
  }
  function receive(value: unknown) {
    if (disposed || !value || typeof value !== 'object') return
    const outcome = value as HomeRoleRequestOutcome
    if (!validId(outcome.requestId) || outcome.requestId !== pendingId.value || !outcomeStates.includes(outcome.state) || settled.has(outcome.requestId)) return
    // Synchronous global ACK precedes every await/status read. Native retries until
    // the passive startup query restores pendingId; uncorrelated events are never ACKed.
    ports.acknowledge(outcome.requestId)
    void reconcile(outcome)
  }
  async function start() {
    if (disposed || starting || connected.value || !ports.supported) return
    starting = true
    let acceptingSubscription = true
    try {
      const unlisten = await bounded(ports.subscribe(receive).then(unlisten => { if (!acceptingSubscription || disposed) { unlisten(); return () => {} } return unlisten }), 2000)
      if (disposed) { unlisten(); return }
      stop = unlisten; connected.value = true
      // Native retries onResume delivery until this listener can ACK a restored pending ID.
      ports.setReady(true)
      await refresh() // Listener first; this query is passive, including after process recreation.
    } catch {
      if (!disposed) { state.value = 'unavailable'; notice.value = 'Default Home setup is unavailable in this native build.' }
    } finally { acceptingSubscription = false; starting = false }
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
      if (disposed || current !== generation || state.value !== 'not_held' || pendingId.value) return
      // Monotonic freshness is rechecked immediately before invoke; requestId is correlation, never consent.
      const age = ports.now() - gestureStamp
      if (!Number.isFinite(age) || age < 0 || age > 5000 || !ports.visible()) { notice.value = 'Tap Set as default Home again to open Android settings.'; return }
      const id = ports.requestId()
      if (!validId(id) || settled.has(id)) throw new Error('Invalid Home request ID')
      requestId = id; pendingOutcome = undefined; rejectedId = null; pendingId.value = id
      const value = await bounded(ports.request(id), 5000)
      if (disposed || current !== generation || pendingId.value !== id) return
      if (!value || typeof value !== 'object') throw new Error('Invalid Home role response')
      const reply = value as HomeRoleRequestStart
      if (!['held', 'pending', 'unavailable', 'failed'].includes(reply.state) || reply.requestId !== undefined && reply.requestId !== id || reply.state === 'pending' && reply.requestId !== id) throw new Error('Mismatched Home role response')
      if (reply.state === 'pending') notice.value = waitingNotice
      else await reconcile({ requestId: id, state: reply.state })
    } catch (error) {
      if (reconcilePromise) await reconcilePromise
      if (disposed || current !== generation || requestId && pendingId.value !== requestId) return
      if (requestId && rejectedBeforePersistence(error)) {
        // Keep the rejection marker if status is unavailable: Check status can
        // safely release this local-only ID later without remounting or invoking.
        rejectedId = requestId
        await reconcile()
        return
      }
      // Ambiguous invokes retain correlation and are never automatically repeated.
      state.value = 'unavailable'; notice.value = 'Default Home request could not be confirmed. Return to the app or use Check status; no request was retried.'
    } finally { if (!disposed) { requesting.value = false; if (returnedDuringRequest && pendingId.value) await reconcile() } }
  }
  async function returned() { if (requesting.value) { returnedDuringRequest = true; return } if (connected.value) await reconcile() }
  async function check() { if (requesting.value) return; if (!connected.value) { await start(); return } await reconcile() }
  function dispose() {
    disposed = true; generation++
    if (connected.value) ports.setReady(false)
    connected.value = false; stop?.(); stop = undefined
  }
  return { supported: ports.supported, state, apiLevel, pendingId, attempt, checking, requesting, notice, canRequest, start, request, returned, check, dispose }
}
export function useHomeRoleAction(beforeRequest: () => Promise<boolean>) {
  const role = createHomeRoleAction({
    supported: isTauri() && isAndroidApp(),
    status: () => invoke('android_home_role_status'),
    request: requestId => invoke('android_home_role_request', { requestId }),
    subscribe: async handler => {
      const listener = (event: Event) => handler((event as CustomEvent<HomeRoleRequestOutcome>).detail)
      window.addEventListener('cybermanju:home-role-result', listener)
      return () => window.removeEventListener('cybermanju:home-role-result', listener)
    },
    setReady: ready => { window.__CYBERMANJU_HOME_ROLE_READY__ = ready },
    acknowledge: requestId => { window.__CYBERMANJU_HOME_ROLE_ACKED__ = requestId },
    beforeRequest, now: () => performance.now(), visible: () => document.visibilityState === 'visible' && document.hasFocus(),
    requestId: () => crypto.randomUUID(),
  })
  const visible = () => { if (document.visibilityState === 'visible') void role.returned() }
  const focused = () => { void role.returned() }
  onMounted(() => { void role.start(); document.addEventListener('visibilitychange', visible); window.addEventListener('focus', focused) })
  onUnmounted(() => { role.dispose(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', focused) })
  return role
}
