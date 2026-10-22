// @vitest-environment happy-dom
// CyberManju OS — Home tap activation contract: synthesize exactly one native button click for an eligible touch tap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHomeTapActivation } from '@/composables/useHomeTapActivation'

function touchEvent(type: string, touches: Array<{ identifier: number; clientX: number; clientY: number }>, changedTouches = touches, target: EventTarget | null = document.querySelector('button')) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
    target: { value: target, configurable: true },
  })
  return event
}
function point(x: number, y: number) {
  return { identifier: 1, clientX: x, clientY: y }
}
function button() {
  const el = document.createElement('button')
  document.body.append(el)
  return el
}
function tap(api: ReturnType<typeof useHomeTapActivation>, target: HTMLElement, x = 10, y = 20, elapsed = 0) {
  vi.setSystemTime(new Date(1000))
  const start = touchEvent('touchstart', [point(x, y)])
  Object.defineProperty(start, 'target', { value: target })
  api.start(start as TouchEvent)
  vi.advanceTimersByTime(elapsed)
  const end = touchEvent('touchend', [], [point(x, y)])
  Object.defineProperty(end, 'target', { value: target })
  api.end(end as TouchEvent)
  return end
}

let api: ReturnType<typeof useHomeTapActivation>
beforeEach(() => {
  vi.useFakeTimers()
  api = useHomeTapActivation()
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => document.querySelector('button'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useHomeTapActivation', () => {
  it('activates once on a qualifying touchend even when no compatibility click arrives', () => {
    const el = button(), onClick = vi.fn()
    el.addEventListener('click', onClick)
    const end = tap(api, el)
    expect(end.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('suppresses a delayed compatibility click after the synthesized activation', () => {
    const el = button(), onClick = vi.fn()
    el.addEventListener('click', onClick)
    tap(api, el)
    const compat = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    api.click(compat)
    expect(onClick).toHaveBeenCalledOnce()
    expect(compat.defaultPrevented).toBe(true)
  })

  it('allows keyboard-generated click (detail 0)', () => {
    const el = button(), onClick = vi.fn()
    el.addEventListener('click', onClick)
    tap(api, el)
    const keyboard = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
    api.click(keyboard)
    el.dispatchEvent(keyboard)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(keyboard.defaultPrevented).toBe(false)
  })

  it('clears compatibility suppression for a new mouse pointer sequence', () => {
    const el = button(), onClick = vi.fn()
    el.addEventListener('click', onClick)
    tap(api, el)
    api.pointer(new PointerEvent('pointerdown', { pointerType: 'mouse', isPrimary: true, bubbles: true }))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    api.click(click)
    el.dispatchEvent(click)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(click.defaultPrevented).toBe(false)
  })

  it('activates when release hit target is an SVG/icon descendant of the original button', () => {
    const el = button(), icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    el.append(icon)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(icon as unknown as Element)
    const onClick = vi.fn(); el.addEventListener('click', onClick)
    tap(api, el)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('rejects movement beyond 10px and allows movement at or below the threshold', () => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(0, 0)]) as TouchEvent)
    api.move(touchEvent('touchmove', [point(11, 0)]) as TouchEvent)
    api.end(touchEvent('touchend', [], [point(11, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
    tap(api, el, 0, 0)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('rejects movement away and back after exceeding the threshold', () => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(0, 0)]) as TouchEvent)
    api.move(touchEvent('touchmove', [point(11, 0)]) as TouchEvent)
    api.move(touchEvent('touchmove', [point(0, 0)]) as TouchEvent)
    api.end(touchEvent('touchend', [], [point(0, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('rejects a multitouch sequence', () => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(0, 0), { identifier: 2, clientX: 1, clientY: 1 }]) as TouchEvent)
    api.end(touchEvent('touchend', [], [point(0, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('rejects a second finger added after the initial touchstart', () => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(0, 0)]) as TouchEvent)
    api.start(touchEvent('touchstart', [point(0, 0), { identifier: 2, clientX: 1, clientY: 1 }]) as TouchEvent)
    api.end(touchEvent('touchend', [], [point(0, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'long hold', 'contextmenu'] as const)('does not activate after %s', (reason) => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(0, 0)]) as TouchEvent)
    if (reason === 'cancel') api.cancel(touchEvent('touchcancel', [], [point(0, 0)]) as TouchEvent)
    if (reason === 'long hold') vi.advanceTimersByTime(501)
    if (reason === 'contextmenu') api.context(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    api.end(touchEvent('touchend', [], [point(0, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'inert', 'disconnected'] as const)('does not activate a %s button', (state) => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    if (state === 'disabled') el.disabled = true
    if (state === 'inert') el.setAttribute('inert', '')
    if (state === 'disconnected') {
      api.start(touchEvent('touchstart', [point(10, 20)]) as TouchEvent)
      el.remove()
      api.end(touchEvent('touchend', [], [point(10, 20)]) as TouchEvent)
    } else tap(api, el)
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'inert'] as const)('rejects when %s is added after touchstart', (state) => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(10, 20)]) as TouchEvent)
    if (state === 'disabled') el.disabled = true
    else el.setAttribute('inert', '')
    api.end(touchEvent('touchend', [], [point(10, 20)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels an active tap on blur via the cancel handler', () => {
    const el = button(), onClick = vi.fn(); el.addEventListener('click', onClick)
    api.start(touchEvent('touchstart', [point(10, 20)]) as TouchEvent)
    api.cancel()
    api.end(touchEvent('touchend', [], [point(10, 20)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('rejects release on a different hit target', () => {
    const first = button(), second = button(), onClick = vi.fn(); first.addEventListener('click', onClick)
    const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(first)
    api.start(touchEvent('touchstart', [point(0, 0)]) as TouchEvent)
    hit.mockReturnValue(second)
    api.end(touchEvent('touchend', [], [point(0, 0)]) as TouchEvent)
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['input', 'select', 'textarea', 'contenteditable', 'native placement'] as const)('does not take over %s controls', (kind) => {
    const el = kind === 'input' || kind === 'textarea' || kind === 'select'
      ? document.createElement(kind)
      : button()
    if (kind === 'contenteditable') el.setAttribute('contenteditable', 'true')
    if (kind === 'native placement') el.setAttribute('data-native-placement', '')
    document.body.append(el)
    const onClick = vi.fn(); el.addEventListener('click', onClick)
    tap(api, el)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('uses root capture handlers ahead of nested child touch.stop, suppresses compatibility click, and allows keyboard click', () => {
    const root = document.createElement('div'), child = document.createElement('div'), el = document.createElement('button')
    child.append(el); root.append(child); document.body.append(root)
    const onClick = vi.fn(); el.addEventListener('click', onClick)
    root.addEventListener('touchstart', event => api.start(event as TouchEvent), true)
    root.addEventListener('touchend', event => api.end(event as TouchEvent), true)
    root.addEventListener('click', event => api.click(event as MouseEvent), true)
    child.addEventListener('touchstart', event => event.stopPropagation())
    child.addEventListener('touchend', event => event.stopPropagation())
    el.dispatchEvent(touchEvent('touchstart', [point(10, 20)], undefined, el))
    const end = touchEvent('touchend', [], [point(10, 20)], el)
    el.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenCalledOnce()
    const compatibility = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    el.dispatchEvent(compatibility)
    expect(compatibility.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenCalledOnce()
    const keyboard = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
    el.dispatchEvent(keyboard)
    expect(keyboard.defaultPrevented).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})
