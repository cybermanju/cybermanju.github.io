// CyberManju OS — clipboard helpers with auto-clear (Phase 3, secrets).
//
// `copySecret` writes to the clipboard and schedules a 30 s overwrite with
// an empty string so a copied password does not linger after the user
// walks away. The timer is per-call: a second copy cancels the first
// overwrite (only the latest value is cleared). Tests drive it through the
// injectable `now`/`schedule` seams — no real timers, no real clipboard.

export const CLIPBOARD_CLEAR_MS = 30_000

export interface ClipboardDeps {
  writeText: (text: string) => Promise<void> | void
  /** Milliseconds now — injectable for tests. */
  now?: () => number
  /** Schedule a one-shot callback; returns a cancel fn. Defaults to
   *  setTimeout/clearTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void
}

export interface CopyToClipboardDeps {
  writeText?: (text: string) => Promise<void> | void
  fallbackCopy?: (text: string) => boolean
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

/** Copy non-secret text via the Async Clipboard API, with a legacy browser fallback. */
export async function copyToClipboard(text: string, deps: CopyToClipboardDeps = {}): Promise<boolean> {
  const writeText = deps.writeText ?? (async (value: string) => {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('Clipboard API unavailable')
    }
    await navigator.clipboard.writeText(value)
  })
  try {
    await writeText(text)
    return true
  } catch {
    try {
      return (deps.fallbackCopy ?? copyWithExecCommand)(text)
    } catch {
      return false
    }
  }
}

let pendingClear: (() => void) | null = null

/** Copy a secret and auto-clear the clipboard after 30 s. Cancels any
 *  previous pending clear (only the latest copied value is overwritten). */
export async function copySecret(text: string, deps: ClipboardDeps): Promise<void> {
  await deps.writeText(text)
  if (pendingClear) {
    pendingClear()
    pendingClear = null
  }
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    })
  const cancel = schedule(() => {
    pendingClear = null
    void deps.writeText('')
  }, CLIPBOARD_CLEAR_MS)
  pendingClear = () => {
    cancel()
    pendingClear = null
  }
}

/** Cancel a pending auto-clear (e.g. the panel unmounts). Best-effort —
 *  leaves whatever is on the clipboard as-is. */
export function cancelClipboardClear(): void {
  if (pendingClear) {
    pendingClear()
    pendingClear = null
  }
}

/** Plain copy without auto-clear — for non-secret text. */
export async function copyText(text: string, deps: ClipboardDeps): Promise<void> {
  await deps.writeText(text)
}
