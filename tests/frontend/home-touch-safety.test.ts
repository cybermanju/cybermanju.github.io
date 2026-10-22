// CyberManju OS — Home touch release-click safety regressions.
// Role: ordinary taps retain click activation; canceled, moving and multitouch sequences cannot activate.
// Exports: Vitest suite. Integrates: production useHomeTouchSafety.
// Contracts: keyboard/button activation remains available after touch cancellation.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHomeTouchSafety } from '@/composables/useHomeTouchSafety'
const touch = (count: number, x = 160, y = 300) => ({ touches: Array.from({ length: count }, (_, i) => ({ clientX: x + i * 60, clientY: y })) }) as unknown as TouchEvent
const click = (detail = 1) => ({ detail, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }) as unknown as MouseEvent
afterEach(() => vi.useRealTimers())
describe('Home touch release-click safety', () => {
  it('allows ordinary single-contact taps and fresh taps after rejected gestures', () => {
    const safety = useHomeTouchSafety()
    safety.start(touch(1)); safety.end(touch(0)); const normal = click(); safety.click(normal)
    expect(normal.preventDefault).not.toHaveBeenCalled()
    safety.start(touch(2)); safety.cancel(touch(0)); safety.start(touch(1)); safety.end(touch(0))
    const fresh = click(); safety.click(fresh); expect(fresh.preventDefault).not.toHaveBeenCalled()
  })
  it.each(['drag', 'two', 'cancel', 'blur', 'count-return'])('consumes compatibility clicks after %s but keeps keyboard activation', reason => {
    const safety = useHomeTouchSafety(); safety.start(touch(1))
    if (reason === 'drag') safety.move(touch(1, 180))
    if (reason === 'two') safety.start(touch(2))
    if (reason === 'cancel') safety.cancel(touch(0))
    if (reason === 'blur') safety.cancel()
    if (reason === 'count-return') { safety.start(touch(2)); safety.end(touch(1)); safety.start(touch(2)) }
    safety.end(touch(0)); const release = click(); safety.click(release)
    expect(release.preventDefault).toHaveBeenCalledOnce(); expect(release.stopImmediatePropagation).toHaveBeenCalledOnce()
    const keyboard = click(0); safety.click(keyboard); expect(keyboard.preventDefault).not.toHaveBeenCalled()
  })
  it('expires release suppression without a timer or permanent click lock', () => {
    vi.useFakeTimers(); const safety = useHomeTouchSafety(); safety.cancel(touch(0)); vi.advanceTimersByTime(801)
    const later = click(); safety.click(later); expect(later.preventDefault).not.toHaveBeenCalled()
  })
  it('rejects a drag coalesced into touchend without any touchmove', () => {
    const safety = useHomeTouchSafety(); safety.start(touch(1))
    safety.end({ ...touch(0), changedTouches: [{ clientX: 200, clientY: 300 }] } as unknown as TouchEvent)
    const release = click(); safety.click(release); expect(release.preventDefault).toHaveBeenCalledOnce()
  })

})
