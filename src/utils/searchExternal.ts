// CyberManju OS — external destination handling for search answers and result links.
// Search links are credential-free HTTP(S) only; generic OAuth/deep-link behavior stays in openExternal.

import { isAndroidApp, isTauri } from '@/composables/useTauri'
import { externalOpenRoute, openExternalUrl } from '@/utils/openExternal'
import { safeHttpUrl } from '@/utils/duckDuckGoSearch'

export type SearchLinkBehavior = 'browser-tab' | 'external-browser'

function currentBehavior(): SearchLinkBehavior {
  const route = externalOpenRoute({ android: isAndroidApp(), tauri: isTauri() })
  return route === 'browser-tab' ? 'browser-tab' : 'external-browser'
}

/** Browser anchors remain native links; native app shells must hand the URL to the system browser. */
export function searchLinkBehavior(): SearchLinkBehavior {
  return currentBehavior()
}

function validatedSearchUrl(url: string): string {
  const safeUrl = safeHttpUrl(url)
  if (!safeUrl) throw new Error('unsupported: search links must be credential-free HTTP(S) URLs')
  return safeUrl
}

/** Open a validated search link from a non-anchor surface (for example, answer text). */
export async function openSearchLink(url: string): Promise<void> {
  const safeUrl = validatedSearchUrl(url)
  if (currentBehavior() === 'external-browser') {
    // Native opener failures intentionally propagate; never fall back into the app WebView.
    await openExternalUrl(safeUrl)
    return
  }

  // Keep this call synchronous with the originating user gesture so browsers do not
  // classify it as a delayed popup. A null return is not a reliable block signal
  // when noopener is used, so do not report it as failure.
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    throw new Error('unsupported: no browser window is available to open this search link')
  }
  window.open(safeUrl, '_blank', 'noopener,noreferrer')
}

/**
 * Handle an anchor click. In a normal browser, leave all click variants to the
 * browser's native target=_blank handling. In an app shell, route every click
 * variant through the external opener so modifiers cannot navigate the WebView.
 */
export async function handleSearchLink(event: MouseEvent, url: string): Promise<void> {
  let safeUrl: string
  try {
    safeUrl = validatedSearchUrl(url)
  } catch (error) {
    event.preventDefault()
    throw error
  }
  if (currentBehavior() === 'browser-tab') return

  event.preventDefault()
  await openSearchLink(safeUrl)
}
