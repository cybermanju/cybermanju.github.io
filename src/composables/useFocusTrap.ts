// CyberManju OS — UseFocusTrap (src/composables/useFocusTrap.ts).
// Role: Vue shared state: transports, wasm backend, vault.
// Exports: useFocusTrap.
// Integrates: vue.
// Contracts: none special (pure logic; errors bubble to caller).
import { ref, watch, onScopeDispose, type Ref } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(containerRef: Ref<HTMLElement | null>, isActive: Ref<boolean>) {
  const previouslyFocused = ref<HTMLElement | null>(null)
  let activationTimer: ReturnType<typeof setTimeout> | undefined

  function getFocusableElements(): HTMLElement[] {
    if (!containerRef.value) return []
    return (Array.from(containerRef.value.querySelectorAll(FOCUSABLE)) as HTMLElement[])
      .filter((element) => element.getAttribute('type')?.toLowerCase() !== 'hidden'
        && !element.closest('[hidden], [inert]'))
  }

  function focusFirst() {
    const elements = getFocusableElements()
    if (elements.length > 0) elements[0].focus()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return
    const elements = getFocusableElements()
    if (elements.length === 0) return
    const active = document.activeElement as HTMLElement | null
    // A teleported child dialog (such as text options) owns its own keyboard.
    if (active && !containerRef.value?.contains(active)) {
      const dialog = active.closest('[role="dialog"], [aria-modal="true"]')
      if (dialog && !containerRef.value?.contains(dialog)) return
    }
    const first = elements[0]
    const last = elements[elements.length - 1]
    const outside = !active || !containerRef.value?.contains(active)
    if (e.shiftKey) {
      if (active === first || outside) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || outside) {
      e.preventDefault()
      first.focus()
    }
  }

  watch(isActive, (active) => {
    if (activationTimer !== undefined) {
      clearTimeout(activationTimer)
      activationTimer = undefined
    }
    if (active) {
      previouslyFocused.value = document.activeElement as HTMLElement
      document.addEventListener('keydown', handleKeydown)
      // Deferred to allow v-if content to mount; the callback is invalidated on
      // close/unmount so it can never steal focus after restoration.
      activationTimer = setTimeout(() => {
        activationTimer = undefined
        if (isActive.value) focusFirst()
      }, 50)
    } else {
      document.removeEventListener('keydown', handleKeydown)
      if (previouslyFocused.value) {
        previouslyFocused.value.focus()
        previouslyFocused.value = null
      }
    }
  })

  onScopeDispose(() => {
    if (activationTimer !== undefined) clearTimeout(activationTimer)
    activationTimer = undefined
    document.removeEventListener('keydown', handleKeydown)
  })

  return { focusFirst }
}
