// CyberManju OS — Focus trap lifecycle (tests/frontend/focus-trap-lifecycle.test.ts).
// Role: verify delayed focus, cleanup, filtering and keyboard boundaries without a browser DOM.
// Exports: none.
// Integrates: Vue effect scopes, Vitest, useFocusTrap.
// Contracts: closing/unmounting invalidates deferred activation; interior Tab stays native.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue'
import { useFocusTrap } from '../../src/composables/useFocusTrap'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type FakeElement = {
  focus: ReturnType<typeof vi.fn>
  getAttribute: (name: string) => string | null
  closest: (selector: string) => FakeElement | null
  contains: (element: unknown) => boolean
  querySelectorAll: (selector: string) => FakeElement[]
}
function element(attrs: Record<string, string | null> = {}): FakeElement {
  return {
    focus: vi.fn(),
    getAttribute: name => attrs[name] ?? null,
    closest: selector => (selector.includes('[hidden]') && attrs.hidden != null) || (selector.includes('[inert]') && attrs.inert != null) ? {} as FakeElement : null,
    contains: () => false,
    querySelectorAll: () => [],
  }
}
function installDocument(initial: FakeElement) {
  let current = initial
  const listeners = new Map<string, EventListener>()
  vi.stubGlobal('document', {
    get activeElement() { return current },
    addEventListener: vi.fn((name: string, handler: EventListener) => listeners.set(name, handler)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  })
  return { listeners, focus: (target: FakeElement) => { current = target } }
}
function activate(container: FakeElement | null) {
  const containerRef = shallowRef(container)
  const active = ref(false)
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useFocusTrap(containerRef as never, active))
  active.value = true
  return { containerRef, active, scope }
}

describe('useFocusTrap lifecycle', () => {
  it('defers focus for v-if DOM, and cancels pending activation on close', async () => {
    vi.useFakeTimers()
    const prior = element()
    installDocument(prior)
    const { containerRef, active } = activate(null)
    await nextTick()
    const button = element()
    containerRef.value = { ...element(), querySelectorAll: () => [button] }
    active.value = false
    await nextTick()
    vi.advanceTimersByTime(50)
    expect(button.focus).not.toHaveBeenCalled()
    expect(prior.focus).toHaveBeenCalledOnce()
  })

  it('cancels deferred focus and keyboard listeners when the owner scope unmounts', async () => {
    vi.useFakeTimers()
    const { listeners } = installDocument(element())
    const button = element()
    const { scope } = activate({ ...element(), querySelectorAll: () => [button] })
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(100)
    expect(button.focus).not.toHaveBeenCalled()
    expect(listeners.has('keydown')).toBe(false)
  })

  it('focuses the first available button and excludes hidden/inert/type=hidden elements', async () => {
    vi.useFakeTimers()
    installDocument(element())
    const hidden = element({ hidden: '' })
    const inert = element({ inert: '' })
    const hiddenInput = element({ type: 'hidden' })
    const button = element()
    activate({ ...element(), querySelectorAll: () => [hidden, inert, hiddenInput, button] })
    await nextTick()
    vi.advanceTimersByTime(50)
    expect(button.focus).toHaveBeenCalledOnce()
    for (const item of [hidden, inert, hiddenInput]) expect(item.focus).not.toHaveBeenCalled()
  })

  it('wraps only boundaries or external focus and preserves interior Tab order', async () => {
    vi.useFakeTimers()
    const outside = element()
    const doc = installDocument(outside)
    const first = element(), middle = element(), last = element()
    const items = [first, middle, last]
    activate({ ...element(), contains: target => items.includes(target as FakeElement), querySelectorAll: () => items })
    await nextTick()
    const handler = doc.listeners.get('keydown') as (event: Record<string, unknown>) => void
    const tab = (shiftKey = false) => {
      const preventDefault = vi.fn()
      handler({ key: 'Tab', shiftKey, preventDefault })
      return preventDefault
    }
    expect(tab()).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
    doc.focus(middle)
    expect(tab()).not.toHaveBeenCalled()
    expect(tab(true)).not.toHaveBeenCalled()
    doc.focus(last)
    expect(tab()).toHaveBeenCalledOnce()
    doc.focus(first)
    expect(tab(true)).toHaveBeenCalledOnce()
    expect(last.focus).toHaveBeenCalledOnce()
  })

  it('lets a teleported text-options dialog handle its own keyboard', async () => {
    vi.useFakeTimers()
    const outside = element()
    outside.closest = () => element()
    const { listeners } = installDocument(outside)
    const first = element()
    activate({ ...element(), querySelectorAll: () => [first] })
    await nextTick()
    const handler = listeners.get('keydown') as (event: Record<string, unknown>) => void
    const preventDefault = vi.fn()
    handler({ key: 'Tab', shiftKey: false, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(first.focus).not.toHaveBeenCalled()
  })
})
