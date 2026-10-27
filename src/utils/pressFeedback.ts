// CyberManju OS — Press feedback (src/utils/pressFeedback.ts).
//
// Shared press/press-release micro-feedback, the small-craft layer of
// the design language: a 96% spring-scale on press plus a single 8 ms
// haptic tick (our reference press-language study) means every control
// Kept pure so buttons, rows and wizard nav taps all agree without a
// browser (tests assert the guard rails, not the hardware).
//
// Role: shared UI press feedback for controls (web + Tauri WebView).
// Exports: PRESS_SCALE, PRESS_MS, HAPTIC_MS, vibratePress, prefersReducedMotion.
// Integrates: navigator.vibrate (guarded), UiButton, wizard nav rows.
// Contracts: never throws — haptics are best-effort by design.

/** Press-press scale fraction applied while a control is held. */
export const PRESS_SCALE = 0.96

/** Shortest haptic tick the design language uses. */
export const HAPTIC_MS = 8

/** Compatibility alias — named after the CSS transform it feeds. */
export const PRESS_MS = HAPTIC_MS

/** True when the OS asks for reduced motion (animations, not haptics). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Fire the design-language haptic tick once. Silent no-op everywhere
 * `navigator.vibrate` is missing (iOS browsers, desktop Chrome, tests).
 */
export function vibratePress(pattern: number | number[] = HAPTIC_MS): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }
    // Explicit `false` check — a defined-but-broken vibrate must not crash.
    if (typeof nav.vibrate === 'function') nav.vibrate(pattern)
  } catch {
    // No haptics on this platform — feedback falls back to the scale press.
  }
}
