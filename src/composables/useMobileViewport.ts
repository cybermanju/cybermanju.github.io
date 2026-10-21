// CyberManju OS — Mobile viewport (src/composables/useMobileViewport.ts).
// Role: Keep mobile sheets inside the visible screen when the keyboard opens.
// Exports: mobileViewportGeometry, applyMobileViewport, useMobileViewport.
// Integrates: App root, VisualViewport, shared mobile CSS variables.
// Contracts: A hidden/startup WebView must never pin the shell to zero height.
import { onMounted, onBeforeUnmount } from 'vue'

export function mobileViewportGeometry(layoutHeight: number, visibleHeight: number, offsetTop = 0) {
  const height = Math.max(0, Math.min(layoutHeight, visibleHeight))
  const keyboardInset = Math.max(0, layoutHeight - height - offsetTop)
  return { height, keyboardInset, keyboardOpen: keyboardInset > 120 }
}

export function applyMobileViewport(root: HTMLElement, layoutHeight: number, visibleHeight: number, offsetTop = 0): boolean {
  // Android can create/resume HOME before the WebView has a measured viewport.
  // Keep the last usable size (or CSS's 100dvh fallback) until layout is ready.
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visibleHeight) || layoutHeight <= 0 || visibleHeight <= 0) return false
  const geometry = mobileViewportGeometry(layoutHeight, visibleHeight, offsetTop)
  root.style.setProperty('--mobile-viewport-height', `${geometry.height}px`)
  root.style.setProperty('--mobile-keyboard-inset', `${geometry.keyboardInset}px`)
  root.dataset.mobileKeyboard = String(geometry.keyboardOpen)
  return true
}

export function useMobileViewport() {
  let viewport: VisualViewport | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  function update() {
    clearTimeout(retry)
    retry = undefined
    const valid = applyMobileViewport(document.documentElement, window.innerHeight, viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0)
    if (!valid && attempts++ < 20) retry = setTimeout(update, 100)
    if (valid) attempts = 0
  }
  function resume() {
    if (document.visibilityState === 'hidden') return
    attempts = 0
    update()
  }
  onMounted(() => {
    viewport = window.visualViewport
    update()
    viewport?.addEventListener('resize', resume)
    viewport?.addEventListener('scroll', resume)
    window.addEventListener('resize', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    window.addEventListener('cybermanju:android-home', resume)
    document.addEventListener('visibilitychange', resume)
  })
  onBeforeUnmount(() => {
    clearTimeout(retry)
    viewport?.removeEventListener('resize', resume)
    viewport?.removeEventListener('scroll', resume)
    window.removeEventListener('resize', resume)
    window.removeEventListener('focus', resume)
    window.removeEventListener('pageshow', resume)
    window.removeEventListener('cybermanju:android-home', resume)
    document.removeEventListener('visibilitychange', resume)
    document.documentElement.style.removeProperty('--mobile-viewport-height')
    document.documentElement.style.removeProperty('--mobile-keyboard-inset')
    delete document.documentElement.dataset.mobileKeyboard
  })
}
