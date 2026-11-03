// CyberManju OS — UpdateChecker (src/composables/useUpdateChecker.ts).
// Role: reactive update-availability state + apply action.
// Exports: useUpdateChecker, UPDATE_CHECK_INTERVAL_MS.
// Integrates: @/utils/versionCheck, @/composables/useNotifications,
//   @/composables/useTauri (isStaticHost, isTauri),
//   @/utils/installLinks (releasePageUrl).
// Contracts: checks once on creation + every UPDATE_CHECK_INTERVAL_MS;
//   one info toast per newly-detected outdated version (deduped by version
//   in sessionStorage); applyUpdate() reloads the page on static
//   hosts (the new WASM build lands on refresh) and opens the release page
//   on desktop/native builds.

import { ref, computed, watch } from 'vue'
import {
  currentVersion,
  checkForUpdate,
  type UpdateStatus,
} from '@/utils/versionCheck'
import { useNotifications } from './useNotifications'
import { isStaticHost, isTauri } from './useTauri'
import { releasePageUrl } from '@/utils/installLinks'

export const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 30 // every 30 min
const NOTIFIED_VERSION_KEY = 'cybermanju.update.notified.v1'

interface UpdateState extends UpdateStatus {
  checking: boolean
}

export function useUpdateChecker() {
  const { notify } = useNotifications()
  const state = ref<UpdateState>({
    current: currentVersion,
    latest: null,
    outdated: false,
    updateUrl: releasePageUrl(),
    checkedAt: null,
    error: null,
    checking: false,
  })
  let timer: ReturnType<typeof setInterval> | null = null

  /** The version we already surfaced a toast for this session (dedup). */
  function readNotifiedVersion(): string | null {
    try {
      const raw = typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(NOTIFIED_VERSION_KEY)
        : null
      return typeof raw === 'string' && raw ? raw : null
    } catch {
      return null
    }
  }
  function writeNotifiedVersion(version: string | null): void {
    try {
      if (typeof sessionStorage === 'undefined') return
      if (version) sessionStorage.setItem(NOTIFIED_VERSION_KEY, version)
      else sessionStorage.removeItem(NOTIFIED_VERSION_KEY)
    } catch {
      // Session storage unavailable — dedup just won't persist across tabs.
    }
  }

  async function runCheck(): Promise<UpdateStatus> {
    state.value = { ...state.value, checking: true, error: null }
    try {
      const status = await checkForUpdate()
      state.value = { ...state.value, ...status, checking: false }
      if (status.latest && status.outdated) {
        const notified = readNotifiedVersion()
        if (notified !== status.latest) {
          notify(
            'info',
            `Nova versão disponível: ${status.latest} (atual: ${status.current})`,
            0,
            'Atualização do CyberManju OS',
          )
          writeNotifiedVersion(status.latest)
        }
      } else if (!status.latest && status.error) {
        // Surface the probe failure quietly in the console only.
        console.warn('[UpdateChecker] version probe failed:', status.error)
      }
      return status
    } catch (e) {
      state.value = {
        ...state.value,
        checking: false,
        error: e instanceof Error ? e.message : String(e),
      }
      return state.value
    }
  }

  /** Exposed for UI triggers / tests. Same as the boot check. */
  async function checkForUpdateNow(): Promise<UpdateStatus> {
    return runCheck()
  }

  /** Apply the update: reload (static/WASM) or open the release page (desktop). */
  function applyUpdate(): void {
    const latest = state.value.latest
    if (!latest) {
      console.warn('[UpdateChecker] applyUpdate: no latest version known yet')
      return
    }
    if (isStaticHost()) {
      // The WASM / Pages pack is updated by redeploying main. A hard reload
      // fetches the fresh bundle from GitHub Pages — that IS the update.
      window.location.reload()
      return
    }
    if (isTauri()) {
      // Desktop / Android native: there is no silent self-update; open the
      // release page so the user grabs the new installer for their platform.
      window.open(releasePageUrl(), '_blank', 'noopener,noreferrer')
      return
    }
    // Web / REST mode: point at the release page.
    window.open(releasePageUrl(), '_blank', 'noopener,noreferrer')
  }

  function startPolling(): void {
    stopPolling()
    timer = setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS)
  }
  function stopPolling(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // Boot check + recurring poll.
  void runCheck()
  startPolling()

  // Cleanup on unmount is best-effort (composables are usually long-lived);
  // expose stopPolling so callers can tear down when needed.
  watch(
    () => state.value.latest,
    () => {
      // Re-dedup gate runs inside runCheck; nothing extra here.
    },
  )

  return {
    ...computed(() => state.value),
    checkForUpdate: checkForUpdateNow,
    applyUpdate,
    startPolling,
    stopPolling,
  }
}

export default useUpdateChecker
