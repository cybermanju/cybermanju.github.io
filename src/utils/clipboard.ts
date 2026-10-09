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
