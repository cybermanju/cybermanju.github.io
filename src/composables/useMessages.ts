// CyberManju messages hub — social quick-launch + stored notifications.
// Device-local IPC, never REST. Off-device the Rust layer refuses with
// `unsupported:` (no mock messages).

import { computed, ref } from 'vue'
import { invoke, isAndroidApp, isTauri } from '@/composables/useTauri'
import { useLauncherStore } from '@/stores/launcher'
import { countUnread } from '@/utils/launcher'
import type { AndroidApp, NotificationState, StoredMessage } from '@/types'

export type MessagesStatus = 'idle' | 'loading' | 'ready' | 'error'

const socialApps = ref<AndroidApp[]>([])
const messages = ref<StoredMessage[]>([])
const notifState = ref<NotificationState | null>(null)
const status = ref<MessagesStatus>('idle')
const lastError = ref<string | null>(null)
let inFlight: Promise<StoredMessage[]> | null = null

export function useMessages() {
  const launcher = useLauncherStore()
  const supported = isTauri() && isAndroidApp()

  const unread = computed(() =>
    countUnread(messages.value.map((m) => m.timestamp), launcher.messagesSeenAt),
  )

  async function refreshSocial(): Promise<AndroidApp[]> {
    try {
      const rows = await invoke<AndroidApp[]>('launcher_list_social_apps')
      socialApps.value = Array.isArray(rows) ? rows : []
    } catch {
      socialApps.value = []
    }
    return socialApps.value
  }

  async function refreshState(): Promise<NotificationState | null> {
    try {
      notifState.value = await invoke<NotificationState>('launcher_notification_state')
    } catch {
      notifState.value = null
    }
    return notifState.value
  }

  async function refresh(force = false): Promise<StoredMessage[]> {
    if (inFlight) return inFlight
    if (!force && status.value === 'ready') return messages.value
    status.value = 'loading'
    lastError.value = null
    const run = (async () => {
      try {
        const [rows] = await Promise.all([
          invoke<StoredMessage[]>('launcher_list_messages', { limit: 100 }),
          refreshState(),
        ])
        messages.value = Array.isArray(rows) ? rows : []
        status.value = 'ready'
        return messages.value
      } catch (e) {
        status.value = 'error'
        lastError.value = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        inFlight = null
      }
    })()
    inFlight = run
    return run
  }

  async function clear(): Promise<void> {
    await invoke('launcher_clear_messages')
    messages.value = []
    status.value = 'ready'
  }

  async function openSettings(): Promise<void> {
    await invoke('launcher_open_notification_settings')
  }

  function markSeen() {
    const newest = messages.value.reduce((m, x) => Math.max(m, x.timestamp), launcher.messagesSeenAt)
    launcher.markMessagesSeen(Math.max(newest, Date.now()))
  }

  return {
    socialApps,
    messages,
    notifState,
    status,
    lastError,
    unread,
    supported,
    refresh,
    refreshSocial,
    refreshState,
    clear,
    openSettings,
    markSeen,
  }
}
