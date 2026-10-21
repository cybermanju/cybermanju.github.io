// CyberManju OS — Edit-menu action handoff regressions.
// Role: verify trusted original events, transient selections and stale-target refusal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureUiTextActionSnapshot, dispatchUiTextAction, UI_TEXT_ACTION_EVENT } from '@/utils/uiTextActions'

class Element {
  isConnected = true
  isContentEditable = false
  innerHTML = 'plain'
  parentElement = null
  ownerDocument: any = doc
  attrs: Record<string, string> = {}
  getAttribute(name: string) { return this.attrs[name] ?? null }
  closest() { return null }
  contains(node: unknown) { return node === this }
}
class Input extends Element {
  value = 'abcdef'; type = 'text'; name = ''; id = ''; autocomplete = ''
  readOnly = false; disabled = false
  selectionStart = 1; selectionEnd = 4
}
class Textarea extends Input {}
const view = { dispatchEvent: vi.fn() }
const doc: any = { activeElement: null, getSelection: vi.fn(() => null), defaultView: view }
class DetailEvent { constructor(public type: string, public init: any) {} get detail() { return this.init.detail } }
const click = () => ({ isTrusted: true, type: 'click' } as Event)

beforeEach(() => {
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('HTMLInputElement', Input); vi.stubGlobal('HTMLTextAreaElement', Textarea)
  vi.stubGlobal('CustomEvent', DetailEvent); vi.stubGlobal('document', doc)
  doc.activeElement = null; doc.getSelection.mockReset().mockReturnValue(null); doc.defaultView = view
  view.dispatchEvent.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('Edit submenu text handoff', () => {
  it.each(['copy', 'cut', 'paste'] as const)('forwards original %s click with selected target/offsets', action => {
    const field = new Input(); doc.activeElement = field
    const snapshot = captureUiTextActionSnapshot()
    const event = click()
    expect(view.dispatchEvent).not.toHaveBeenCalled()
    expect(dispatchUiTextAction(action, event, snapshot)).toBe(true)
    const sent = view.dispatchEvent.mock.calls[0][0]
    expect(sent.type).toBe(UI_TEXT_ACTION_EVENT)
    expect(sent.detail).toEqual({ action, event, target: field, start: 1, end: 4 })
  })
  it.each(['value', 'selection', 'detached', 'disabled', 'readonly', 'secret'] as const)('refuses %s changed before click', change => {
    const field = new Input(); doc.activeElement = field
    const snapshot = captureUiTextActionSnapshot()
    if (change === 'value') field.value = 'new'
    if (change === 'selection') field.selectionStart = 2
    if (change === 'detached') field.isConnected = false
    if (change === 'disabled') field.disabled = true
    if (change === 'readonly') field.readOnly = true
    if (change === 'secret') field.type = 'password'
    expect(dispatchUiTextAction('cut', click(), snapshot)).toBe(false)
    expect(view.dispatchEvent).not.toHaveBeenCalled()
  })
  it('does not capture password/token/disabled fields or unsupported selections', () => {
    const field = new Input(); doc.activeElement = field
    field.type = 'password'; expect(captureUiTextActionSnapshot()).toBeNull()
    field.type = 'text'; field.name = 'api_key'; expect(captureUiTextActionSnapshot()).toBeNull()
    field.name = ''; field.disabled = true; expect(captureUiTextActionSnapshot()).toBeNull()
    doc.activeElement = null; expect(captureUiTextActionSnapshot()).toBeNull()
  })
  it('requires a trusted click and available destination window', () => {
    const field = new Input(); doc.activeElement = field
    const snapshot = captureUiTextActionSnapshot()
    expect(dispatchUiTextAction('copy', { isTrusted: false, type: 'click' } as Event, snapshot)).toBe(false)
    expect(dispatchUiTextAction('copy', { isTrusted: true, type: 'focus' } as Event, snapshot)).toBe(false)
    doc.defaultView = null
    expect(dispatchUiTextAction('copy', click(), snapshot)).toBe(false)
    expect(view.dispatchEvent).not.toHaveBeenCalled()
  })
  it('revalidates contenteditable boundaries and markup before dispatch', () => {
    const target = new Element(); target.isContentEditable = true; doc.activeElement = target
    const range: any = { commonAncestorContainer: target, startContainer: target, startOffset: 0, endContainer: target, endOffset: 2, cloneRange() { return { ...this } } }
    doc.getSelection.mockReturnValue({ rangeCount: 1, getRangeAt: () => range, toString: () => 'pl' })
    const snapshot = captureUiTextActionSnapshot()
    expect(dispatchUiTextAction('cut', click(), snapshot)).toBe(true)
    view.dispatchEvent.mockClear(); range.endOffset = 3
    expect(dispatchUiTextAction('cut', click(), snapshot)).toBe(false)
    range.endOffset = 2; target.innerHTML = '<b>plain</b>'
    expect(dispatchUiTextAction('cut', click(), snapshot)).toBe(false)
    expect(view.dispatchEvent).not.toHaveBeenCalled()
  })
})
