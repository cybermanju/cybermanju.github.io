// CyberManju OS — UseFocusTrap (src/composables/useFocusTrap.ts).
// Role: contain keyboard focus in visible dialogs without competing with higher overlays.
// Exports: useFocusTrap.
// Integrates: Vue scope lifecycle and teleported modal components.
// Contracts: hidden/disabled controls are never tab stops; only the top overlay owns Escape/restoration.
import { ref, watch, onScopeDispose, type Ref } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
type Trap = { container: Ref<HTMLElement | null>; active: Ref<boolean>; focus: (retiring?: HTMLElement | null) => void }
const traps: Trap[] = []

function visible(element: HTMLElement): boolean {
  if (element.isConnected === false || element.closest('[hidden], [inert]')) return false
  if (element.getAttribute('type')?.toLowerCase() === 'hidden') return false
  if (typeof getComputedStyle === 'function') {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    }
  }
  return true
}

/** Teleport roots are siblings: their overlay ancestors, not activation order,
 * decide ownership (e.g. Messages 9400 stays above Upload 200). */
function layer(element: HTMLElement | null): number {
  let value = 0
  if (typeof getComputedStyle !== 'function') return value
  for (let node = element; node; node = node.parentElement) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10)
    if (Number.isFinite(z)) value = Math.max(value, z)
  }
  return value
}

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  isActive: Ref<boolean>,
  options: { onEscape?: () => void } = {},
) {
  const previouslyFocused = ref<HTMLElement | null>(null)
  let activationTimer: ReturnType<typeof setTimeout> | undefined
  const trap: Trap = { container: containerRef, active: isActive, focus: focusFirst }
  // Existing consumers keep their bubbling-keyboard contract. These modal
  // consumers must intercept Escape before the shell's global close shortcuts.
  const capture = !!options.onEscape

  function getFocusableElements(): HTMLElement[] {
    if (!containerRef.value) return []
    return (Array.from(containerRef.value.querySelectorAll(FOCUSABLE)) as HTMLElement[])
      .filter(element => visible(element) && !element.matches?.(':disabled')
        && (element.tabIndex === undefined || element.tabIndex >= 0))
      .sort((a, b) => {
        const rank = (element: HTMLElement) => element.tabIndex > 0 ? element.tabIndex : Number.MAX_SAFE_INTEGER
        return rank(a) - rank(b)
      })
  }

  function topTrap(): Trap | undefined {
    return traps.filter(item => item.active.value && item.container.value && visible(item.container.value))
      .reduce<Trap | undefined>((top, item) => !top || layer(item.container.value) >= layer(top.container.value) ? item : top, undefined)
  }

  function ownsFocus(retiring?: HTMLElement | null): boolean {
    if (!isActive.value || !containerRef.value || topTrap() !== trap) return false
    const active = document.activeElement as HTMLElement | null
    // Non-hook teleported child dialogs (text options, native-style sheets)
    // retain their own keyboard architecture. A lower dialog cannot take over.
    // A semantic dialog wrapping this container belongs to this trap, not a
    // competing overlay (ConfirmDialog and AppDrawer place the role on the veil).
    const dialog = active?.closest?.('[role="dialog"], [aria-modal="true"]') as HTMLElement | null
    if (dialog && !retiring?.contains(dialog) && !containerRef.value.contains(dialog)
      && !(retiring && dialog.contains(retiring))
      && !dialog.contains(containerRef.value) && layer(dialog) >= layer(containerRef.value)) return false
    return true
  }

  function focusFirst(retiring?: HTMLElement | null) {
    if (!ownsFocus(retiring)) return
    const target = getFocusableElements()[0] ?? containerRef.value
    target?.focus()
  }

  function handleFocusin(event: FocusEvent) {
    if (ownsFocus() && !containerRef.value?.contains(event.target as Node)) focusFirst()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || !ownsFocus()) return
    if (e.key === 'Escape' && options.onEscape) {
      e.preventDefault()
      e.stopImmediatePropagation()
      options.onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const elements = getFocusableElements()
    if (elements.length === 0) {
      e.preventDefault()
      containerRef.value?.focus()
      return
    }
    const active = document.activeElement as HTMLElement | null
    const first = elements[0]
    const last = elements[elements.length - 1]
    const outside = !active || !containerRef.value?.contains(active) || !elements.includes(active)
    if (e.shiftKey ? active === first || outside : active === last || outside) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    }
  }

  function deactivate() {
    if (activationTimer !== undefined) clearTimeout(activationTimer)
    activationTimer = undefined
    if (typeof document === 'undefined') return
    document.removeEventListener('keydown', handleKeydown, capture)
    if (capture) document.removeEventListener('focusin', handleFocusin, true)
    const index = traps.indexOf(trap)
    if (index >= 0) traps.splice(index, 1)
    const opener = previouslyFocused.value
    previouslyFocused.value = null
    if (!opener || !visible(opener) || opener.matches?.(':disabled')) return
    const next = topTrap()
    // Never restore behind another active modal. Closing a lower overlay must
    // also never move focus away from the overlay that is still on top.
    if (next && !next.container.value?.contains(opener)) {
      if (containerRef.value?.contains(document.activeElement)) next.focus(containerRef.value)
      return
    }
    const current = document.activeElement as HTMLElement | null
    const foreign = current?.closest?.('[role="dialog"], [aria-modal="true"]')
    // The retiring container's semantic ancestor must not block its own
    // opener restoration, just as it must not block keyboard ownership.
    if (foreign && !containerRef.value?.contains(foreign)
      && !foreign.contains(containerRef.value) && !foreign.contains(opener)) return
    opener.focus()
  }

  watch(isActive, (active) => {
    if (typeof document === 'undefined') return
    if (active) {
      previouslyFocused.value = document.activeElement as HTMLElement
      traps.push(trap)
      document.addEventListener('keydown', handleKeydown, capture)
      if (capture) document.addEventListener('focusin', handleFocusin, true)
      // Allow v-if/Teleport content to mount. Close/unmount invalidates this
      // callback so it cannot steal focus after the opener has been restored.
      activationTimer = setTimeout(() => {
        activationTimer = undefined
        if (isActive.value) focusFirst()
      }, 50)
    } else {
      deactivate()
    }
  }, { immediate: true })

  onScopeDispose(deactivate)
  return { focusFirst }
}
