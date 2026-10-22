// CyberManju OS — Text menu keyboard regressions.
// Role: Exercise reachable manual-copy text and native selection shortcuts.
// Integrates: UiTextContextMenu and uiTextMenuKeyboard.
import { describe, expect, it, vi } from 'vitest'
import { focusTextMenuKey } from '../../src/utils/uiTextMenuKeyboard'

function fixture() {
  const controls = ['BUTTON', 'BUTTON', 'BUTTON', 'TEXTAREA'].map(tagName => ({ tagName, focus: vi.fn() }))
  const panel = { querySelectorAll: vi.fn(() => controls) } as unknown as HTMLElement
  const key = (key: string, extra = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra })
  const press = (event: ReturnType<typeof key>, index: number) => focusTextMenuKey(event as unknown as KeyboardEvent, panel, controls[index] as unknown as Element)
  return { controls, panel, key, press }
}
describe('text menu keyboard', () => {
  it('includes the readonly copy field in forward and reverse Tab cycles', () => {
    const { controls, key, press } = fixture()
    const tab = key('Tab'); press(tab, 2)
    expect(controls[3].focus).toHaveBeenCalled(); expect(tab.preventDefault).toHaveBeenCalled()
    press(key('Tab'), 3); expect(controls[0].focus).toHaveBeenCalled()
    press(key('Tab', { shiftKey: true }), 0); expect(controls[3].focus).toHaveBeenCalledTimes(2)
    press(key('Tab', { shiftKey: true }), 3); expect(controls[2].focus).toHaveBeenCalled()
  })
  it('leaves text selection, select-all, and copy shortcuts native in the manual field', () => {
    const { controls, key, press } = fixture()
    for (const name of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'a', 'c']) {
      const event = key(name, { shiftKey: true, ctrlKey: name === 'a' || name === 'c' })
      press(event, 3)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    }
    expect(controls.every(control => !control.focus.mock.calls.length)).toBe(true)
  })
  it('preserves menu arrow/Home/End navigation and handles lost focus', () => {
    const { controls, panel, key, press } = fixture()
    press(key('ArrowDown'), 0); expect(controls[1].focus).toHaveBeenCalled()
    press(key('ArrowUp'), 1); expect(controls[0].focus).toHaveBeenCalled()
    press(key('End'), 0); expect(controls[3].focus).toHaveBeenCalled()
    press(key('Home'), 2); expect(controls[0].focus).toHaveBeenCalledTimes(2)
    focusTextMenuKey(key('Tab') as unknown as KeyboardEvent, panel, null)
    expect(controls[0].focus).toHaveBeenCalledTimes(3)
  })
})
