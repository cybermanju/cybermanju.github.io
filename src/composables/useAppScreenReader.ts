// CyberManju OS — UI cache only; Android remains the authoritative session owner.
import { computed, readonly, ref } from 'vue'
import { AndroidScreenReader, type ReaderMode, type ReaderStatus } from '@/utils/androidScreenReader'
import { boundedReaderRequest, emptyScreenReaderStatus, parseScreenReaderStatus, screenReaderActive, SCREEN_READER_TIMEOUT_MS } from '@/utils/appScreenReader'

const bridge = new AndroidScreenReader()
const status = ref(emptyScreenReaderStatus())
const busy = ref(false)
const error = ref('')
const uncertain = ref(false)
const checked = ref(false)
let pending: Promise<void> | null = null
let queuedRefresh = false
let queuedPoll = false
let refreshWaiters: Array<() => void> = []
const active = computed(() => screenReaderActive(status.value))
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
function adopt(raw: ReaderStatus) {
  status.value = parseScreenReaderStatus(raw)
  checked.value = true
  uncertain.value = false
}
export function useAppScreenReader() {
  function drainRefresh() {
    if (!queuedRefresh || busy.value) return
    const poll = queuedPoll
    const waiters = refreshWaiters
    queuedRefresh = false; queuedPoll = false; refreshWaiters = []
    void refresh(poll).finally(() => waiters.forEach(resolve => resolve()))
  }
  async function refresh(poll = false): Promise<void> {
    if (pending) return pending
    if (busy.value) {
      queuedRefresh = true
      queuedPoll = queuedPoll || poll
      return new Promise<void>(resolve => refreshWaiters.push(resolve))
    }
    const run = async () => {
      busy.value = true; error.value = ''
      try {
        // readerPoll has its own native event queue, never the speech `poll` action.
        if (poll) adopt((await boundedReaderRequest(bridge.poll())).status)
        else adopt(await boundedReaderRequest(bridge.status()))
      } catch (cause) { checked.value = false; error.value = message(cause) }
      finally { busy.value = false; pending = null; drainRefresh() }
    }
    pending = run()
    return pending
  }
  async function start(packages: string[], mode: ReaderMode = packages.length === 1 ? 'single' : 'batch'): Promise<void> {
    if (busy.value || active.value || uncertain.value || !checked.value || !status.value.overlayGranted
      || status.value.notificationGranted === false || status.value.notificationsEnabled === false) return
    const selected = [...new Set(packages.map(pkg => pkg.trim()).filter(Boolean))]
    if (!selected.length) return
    busy.value = true; error.value = ''; uncertain.value = true
    try {
      const request = { packages: selected, mode, consentDisclosure: true as const, expiresAt: Date.now() + SCREEN_READER_TIMEOUT_MS }
      adopt(await boundedReaderRequest(bridge.start(request)))
    } catch (cause) { error.value = message(cause) }
    finally { busy.value = false; drainRefresh() }
  }
  async function stop(): Promise<void> {
    if (busy.value) return
    busy.value = true; error.value = ''; uncertain.value = true
    try { adopt(await boundedReaderRequest(bridge.stop())) }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false; drainRefresh() }
  }
  async function overlaySettings(): Promise<void> {
    if (busy.value || active.value || uncertain.value) return
    busy.value = true; error.value = ''
    try { adopt(await boundedReaderRequest(bridge.overlaySettings())) }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false; drainRefresh() }
  }
  async function notificationSettings(): Promise<void> {
    if (busy.value || active.value || uncertain.value) return
    busy.value = true; error.value = ''
    try { adopt(await boundedReaderRequest(bridge.notificationSettings())) }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false; drainRefresh() }
  }
  return { status: readonly(status), busy: readonly(busy), error: readonly(error), uncertain: readonly(uncertain), checked: readonly(checked), active, refresh, start, stop, overlaySettings, notificationSettings }
}
