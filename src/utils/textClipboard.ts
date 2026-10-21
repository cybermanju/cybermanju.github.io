// CyberManju OS — Explicit text clipboard adapter (src/utils/textClipboard.ts).
// Role: route trusted Android menu actions directly to the device-local bridge.
// Exports: isAndroidClipboard, writeTextClipboard, readTextClipboard.
// Integrates: Tauri core IPC and existing browser clipboard fallback.
// Contracts: no probes/retries/background access; validate native ACK; never log text.
import { invoke, isTauri } from '@tauri-apps/api/core'
import { copyToClipboard } from '@/utils/clipboard'

export function isAndroidClipboard(): boolean {
  return isTauri() && typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

async function androidCommand(action: 'copy' | 'cut' | 'paste', event?: Event, text?: string): Promise<unknown> {
  // Validate synchronously, before any await: a caller cannot mint an attestation.
  const age = event ? performance.now() - event.timeStamp : Infinity
  if (!event?.isTrusted || event.type !== 'click' || !Number.isFinite(age) || age < 0 || age > 4000
    || document.visibilityState !== 'visible' || !document.hasFocus()) {
    throw new Error('auth: Clipboard requires an explicit focused user action')
  }
  const payload = { userInitiated: true, expiresAt: Date.now() + 4000, ...(action === 'paste' ? {} : { text }) }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      invoke('android_clipboard_command', { action, payload }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('conflict: Clipboard timed out')), 4000) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function writeTextClipboard(action: 'copy' | 'cut', text: string, event?: Event): Promise<boolean> {
  if (!isAndroidClipboard()) return copyToClipboard(text)
  try {
    const result = await androidCommand(action, event, text) as { ok?: boolean; action?: string; written?: boolean } | null
    return result?.ok === true && result.action === action && result.written === true
  } catch {
    // Ambiguous native failure must not trigger a second clipboard operation.
    return false
  }
}

export async function readTextClipboard(event?: Event): Promise<string> {
  if (!isAndroidClipboard()) {
    if (!navigator.clipboard?.readText) throw new Error('unsupported: Clipboard reading unavailable')
    return navigator.clipboard.readText()
  }
  const result = await androidCommand('paste', event) as { ok?: boolean; action?: string; text?: unknown } | null
  if (result?.ok !== true || result.action !== 'paste' || typeof result.text !== 'string') {
    throw new Error('integrity: Invalid clipboard acknowledgment')
  }
  return result.text
}
