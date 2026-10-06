import { ref } from 'vue'
import { useWebNotification } from '@vueuse/core'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  duration: number
  createdAt: number
}

const notifications = ref<Notification[]>([])
let counter = 0

export function useNotifications() {
  // OS-level mirror: if the user already granted notification permission,
  // errors/warnings also surface outside the window (Web Notification API
  // via VueUse). Never prompts on its own — permission is requested from
  // the Devices panel.
  let showWeb: ((opts: object) => void) | null = null
  try {
    const web = useWebNotification({ title: 'CyberManju OS' })
    if (web.isSupported.value && web.permissionGranted.value) showWeb = web.show as (opts: object) => void
  } catch { showWeb = null }

  function notify(type: NotificationType, message: string, duration = 4000) {
    const id = `notify-${++counter}`
    const n: Notification = { id, type, message, duration, createdAt: Date.now() }
    notifications.value.push(n)
    if (type === 'error' || type === 'warning') {
      try { showWeb?.({ body: message, tag: id }) } catch { /* in-app toast is enough */ }
    }
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function success(message: string) { return notify('success', message) }
  function error(message: string) { return notify('error', message) }
  function warning(message: string) { return notify('warning', message) }
  function info(message: string) { return notify('info', message) }

  function dismiss(id: string) {
    const idx = notifications.value.findIndex((n: Notification) => n.id === id)
    if (idx !== -1) notifications.value.splice(idx, 1)
  }

  function clearAll() {
    notifications.value.splice(0)
  }

  return { notifications, notify, success, error, warning, info, dismiss, clearAll }
}
