// CyberManju OS — UiTextContextMenu runtime behavior tests.
// Role: exercise the real script-setup functions without rendering the template.
// Exports: none.
// Integrates: Vue refs/computed, SFC compiler, TypeScript transpilation, Vitest.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { copyToClipboard } from '@/utils/clipboard'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const source = readFileSync('src/components/UiTextContextMenu.vue', 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'ui-text-menu-runtime' })
const { outputText } = transpileModule(compiled.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
})
const mounted: Function[] = []
const unmounted: Function[] = []
const runtimeVue = {
  ...Vue,
  onMounted: (callback: Function) => mounted.push(callback),
  onUnmounted: (callback: Function) => unmounted.push(callback),
}
const loaded = { exports: {} as Record<string, any> }
new Function('require', 'module', 'exports', outputText)((id: string) => {
  if (id === 'vue') return runtimeVue
  if (id === '@/utils/uiLayout') return { enterUiLayout: vi.fn(), UI_LAYOUT_TEXT_EVENT: 'ui-layout-text' }
  if (id === '@/utils/uiAppearance') return { UI_APPEARANCE_SELECTION_EVENT: 'ui-appearance-selection' }
  if (id === '@/utils/clipboard') return { copyToClipboard }
  if (id === '@/utils/uiTextMenuKeyboard') return { focusTextMenuKey: vi.fn() }
  throw new Error('Unexpected UiTextContextMenu dependency: ' + id)
}, loaded, loaded.exports)
const component = loaded.exports.default

class FakeElement extends EventTarget {
  constructor() { super(); Vue.markRaw(this) }
  isConnected = true
  isContentEditable = false
  dataset: Record<string, string | undefined> = {}
  attributes = new Map<string, string>()
  textContent: string | null = ''
  focus = vi.fn()
  dispatchEvent = vi.fn(() => true)
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  hasAttribute(name: string) { return this.attributes.has(name) }
  getAttributeNames() { return [...this.attributes.keys()] }
  contains(node: any) { return node === this }
}
class FakeInput extends FakeElement {
  value = ''
  type = 'text'
  name = ''
  id = ''
  disabled = false
  readOnly = false
  maxLength = -1
  selectionStart: number | null = 0
  selectionEnd: number | null = 0
  setRangeText = vi.fn((text: string, start: number, end: number) => {
    this.value = this.value.slice(0, start) + text + this.value.slice(end)
    this.selectionStart = this.selectionEnd = start + text.length
  })
  select = vi.fn(() => { this.selectionStart = 0; this.selectionEnd = this.value.length })
  setSelectionRange = vi.fn()
}
class FakeTextarea extends FakeInput {}
class FakeInputEvent extends Event {
  inputType: string
  data: string | null
  constructor(type: string, init: any) { super(type, init); this.inputType = init.inputType; this.data = init.data }
}
const selection = { rangeCount: 0, anchorNode: null as any, focusNode: null as any, toString: () => '', removeAllRanges: vi.fn(), addRange: vi.fn() }
const clipboard = { readText: vi.fn(), writeText: vi.fn() }
const fakeDocument: any = { activeElement: null, createElement: vi.fn(() => ({})), createTextNode: vi.fn((text: string) => ({ text })), body: { appendChild: vi.fn() }, createRange: vi.fn(() => ({ selectNodeContents: vi.fn() })) }
const fakeWindow: any = new EventTarget()
fakeWindow.innerWidth = 800
fakeWindow.innerHeight = 600
fakeWindow.visualViewport = undefined
fakeWindow.getSelection = () => selection

beforeEach(() => {
  mounted.length = 0; unmounted.length = 0
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('HTMLInputElement', FakeInput)
  vi.stubGlobal('HTMLTextAreaElement', FakeTextarea)
  vi.stubGlobal('InputEvent', FakeInputEvent)
  vi.stubGlobal('Node', FakeElement)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('navigator', { clipboard })
  clipboard.readText.mockReset(); clipboard.writeText.mockReset()
  selection.rangeCount = 0; selection.anchorNode = null; selection.focusNode = null
  selection.toString = () => ''; selection.removeAllRanges.mockClear(); selection.addRange.mockClear()
  fakeDocument.createElement.mockReset(); fakeDocument.execCommand = vi.fn(() => false)
  fakeDocument.activeElement = null
})
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const bindings = component.setup({}, { expose: () => {} })
  return bindings as any
}
function formMenu(target: FakeInput, form = true) {
  return { id: 'test', target, form, x: 10, y: 20 }
}

describe('UiTextContextMenu real setup runtime', () => {
  it('does not steal editable focus when opened and copies the saved selection after blur', async () => {
    const vm = setup(); const field = new FakeInput(); const focus = vi.fn()
    field.value = 'abcdef'; field.selectionStart = 2; field.selectionEnd = 5
    vm.panel.value = Vue.markRaw({ querySelector: () => ({ focus }), getBoundingClientRect: () => ({ width: 240, height: 240 }) })
    await vm.open({ detail: formMenu(field) })
    expect(focus).not.toHaveBeenCalled()
    field.selectionStart = 0; field.selectionEnd = 0
    clipboard.writeText.mockResolvedValue(undefined)
    await vm.copy()
    expect(clipboard.writeText).toHaveBeenCalledWith('cde')
  })
  it('leaves existing native text selection alone when a label menu is requested', async () => {
    const vm = setup(); const target = new FakeElement()
    selection.toString = () => 'selected text'
    await vm.open({ detail: { ...formMenu(target as any, false), text: 'label' } })
    expect(vm.menu.value).toBeNull()
    expect(selection.removeAllRanges).not.toHaveBeenCalled()
  })
  it('uses legacy copy for form selections when the async API is denied', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'
    field.selectionStart = 1; field.selectionEnd = 3
    const textarea = { value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() }
    fakeDocument.createElement.mockReturnValue(textarea)
    fakeDocument.execCommand.mockReturnValue(true)
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    vm.menu.value = formMenu(field)
    await vm.copy()
    expect(textarea.value).toBe('bc')
    expect(fakeDocument.execCommand).toHaveBeenCalledWith('copy')
    expect(textarea.remove).toHaveBeenCalled()
    expect(vm.menu.value).toBeNull()
  })
  it('offers manual copying for form fields when both copy methods fail', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'plain text'
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    fakeDocument.createElement.mockImplementation(() => { throw new Error('unavailable') })
    vm.menu.value = formMenu(field)
    await vm.copy()
    expect(vm.manualCopyText.value).toBe('plain text')
    expect(vm.message.value).toContain('device copy action')
  })
  it('keeps denied paste non-destructive and restores the saved range on native handoff', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'keep'
    field.selectionStart = 1; field.selectionEnd = 3
    await vm.open({ detail: formMenu(field) })
    clipboard.readText.mockRejectedValue(new Error('denied'))
    await vm.paste()
    expect(field.value).toBe('keep')
    expect(field.setRangeText).not.toHaveBeenCalled()
    expect(vm.message.value).toContain('device paste action')
    vm.close()
    expect(field.setSelectionRange).toHaveBeenCalledWith(1, 3)
  })
  it('does not intercept keyboard selection or navigation outside the panel', () => {
    const vm = setup(); const field = new FakeInput()
    vm.menu.value = formMenu(field)
    vm.panel.value = Vue.markRaw({ contains: () => false, getBoundingClientRect: () => ({ width: 240, height: 240 }) })
    const event = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    vm.key(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(vm.menu.value).not.toBeNull()
  })

  it('keeps keyboard focus for label menus and ignores superseded nextTick focus', async () => {
    const vm = setup(); const target = new FakeElement(); const focus = vi.fn()
    vm.panel.value = Vue.markRaw({ querySelector: () => ({ focus }), getBoundingClientRect: () => ({ width: 240, height: 240 }) })
    await vm.open({ detail: { ...formMenu(target as any, false), text: 'label' } })
    expect(focus).toHaveBeenCalledTimes(1)
    const pending = vm.open({ detail: { ...formMenu(target as any, false), text: 'other' } })
    vm.close(false); await pending
    expect(focus).toHaveBeenCalledTimes(1)
  })
  it('creates a paste caret at the end of an editor without a DOM selection', async () => {
    const vm = setup(); const editor = new FakeElement(); editor.isContentEditable = true
    const range: any = { commonAncestorContainer: editor, selectNodeContents: vi.fn(), collapse: vi.fn(), toString: () => '', deleteContents: vi.fn(), insertNode: vi.fn(), setStartAfter: vi.fn() }
    fakeDocument.createRange.mockReturnValue(range)
    await vm.open({ detail: formMenu(editor as any) })
    expect(range.selectNodeContents).toHaveBeenCalledWith(editor)
    expect(range.collapse).toHaveBeenCalledWith(false)
    clipboard.readText.mockResolvedValue('pasted')
    await vm.paste()
    expect(range.insertNode).toHaveBeenCalledWith({ text: 'pasted' })
  })
  it('restores a saved contenteditable selection when returning to the device', async () => {
    const vm = setup(); const editor = new FakeElement(); editor.isContentEditable = true
    const saved = { commonAncestorContainer: editor }
    const range = { cloneRange: () => saved }
    selection.rangeCount = 1; selection.anchorNode = editor; selection.focusNode = editor; selection.getRangeAt = () => range
    await vm.open({ detail: formMenu(editor as any) })
    vm.close()
    expect(selection.addRange).toHaveBeenCalledWith(saved)
    expect(editor.focus).toHaveBeenCalled()
  })
  it('does not cover a native contenteditable selection with a form menu', async () => {
    const vm = setup(); const editor = new FakeElement(); editor.isContentEditable = true
    selection.toString = () => 'native selection'
    await vm.open({ detail: formMenu(editor as any) })
    expect(vm.menu.value).toBeNull()
  })
  it('cuts only selected text after successful clipboard write and emits deleteByCut', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'; field.selectionStart = 1; field.selectionEnd = 4
    await vm.open({ detail: formMenu(field) })
    clipboard.writeText.mockResolvedValue(undefined)
    await vm.cut()
    expect(clipboard.writeText).toHaveBeenCalledWith('bcd')
    expect(field.value).toBe('aef')
    expect(field.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'deleteByCut', data: null }))
    expect(vm.menu.value).toBeNull()
  })
  it('never deletes text if copy fails or the field changes during Cut', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'; field.selectionStart = 1; field.selectionEnd = 4
    vm.menu.value = formMenu(field)
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    fakeDocument.createElement.mockImplementation(() => { throw new Error('denied') })
    await vm.cut()
    expect(field.value).toBe('abcdef'); expect(field.setRangeText).not.toHaveBeenCalled()
    let resolve!: () => void
    clipboard.writeText.mockReturnValue(new Promise<void>(r => { resolve = r }))
    const pending = vm.cut(); field.value = 'changed'; resolve(); await pending
    expect(field.value).toBe('changed'); expect(field.setRangeText).not.toHaveBeenCalled()
  })
  it('disables Cut without selection and for readonly or secret fields', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'
    expect(vm.canCut(formMenu(field))).toBe(false)
    field.selectionEnd = 3; field.readOnly = true
    expect(vm.canCut(formMenu(field))).toBe(false)
    field.readOnly = false; field.attributes.set('data-secret', '')
    vm.menu.value = formMenu(field); await vm.cut()
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(field.setRangeText).not.toHaveBeenCalled()
  })
  it('ignores Cut completion after dismissal', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'; field.selectionEnd = 3
    vm.menu.value = formMenu(field)
    let resolve!: () => void
    clipboard.writeText.mockReturnValue(new Promise<void>(r => { resolve = r }))
    const pending = vm.cut(); vm.close(false); resolve(); await pending
    expect(field.value).toBe('abcdef'); expect(field.setRangeText).not.toHaveBeenCalled()
  })
  it('cuts a contained contenteditable range as plaintext', async () => {
    const vm = setup(); const editor = new FakeElement(); editor.isContentEditable = true; editor.textContent = 'selected text'
    const range: any = { commonAncestorContainer: editor, collapsed: false, toString: () => 'selected', deleteContents: vi.fn(), collapse: vi.fn() }
    selection.rangeCount = 1; selection.anchorNode = editor; selection.focusNode = editor; selection.getRangeAt = () => range
    vm.menu.value = formMenu(editor as any)
    clipboard.writeText.mockResolvedValue(undefined)
    await vm.cut()
    expect(clipboard.writeText).toHaveBeenCalledWith('selected')
    expect(range.deleteContents).toHaveBeenCalled()
    expect(editor.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'deleteByCut' }))
  })
  it('never accesses clipboard on mount, opening, selecting all or dismissal', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'text'
    for (const callback of mounted) callback()
    await vm.open({ detail: formMenu(field) })
    vm.selectAll(); vm.close(false)
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(clipboard.writeText).not.toHaveBeenCalled()
    for (const callback of unmounted) callback()
  })
  it('pastes over the saved selection, respects maxLength and dispatches input', async () => {
    const vm = setup(); const field = new FakeInput()
    field.value = 'hello'; field.maxLength = 6; field.selectionStart = 1; field.selectionEnd = 4
    vm.menu.value = formMenu(field); field.dataset.uiMenuSelectionStart = '1'; field.dataset.uiMenuSelectionEnd = '4'
    clipboard.readText.mockResolvedValue('WORLD!')
    await vm.paste()
    expect(field.value).toBe('hWORLo')
    expect(field.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'input', inputType: 'insertFromPaste', data: 'WORL' }))
    expect(vm.menu.value).toBeNull()
  })
  it('never reads clipboard for readonly controls or a secret textarea', async () => {
    const vm = setup(); const readonly = new FakeInput(); readonly.readOnly = true
    vm.menu.value = formMenu(readonly); await vm.paste()
    const secret = new FakeTextarea(); secret.attributes.set('data-secret', 'true')
    vm.menu.value = formMenu(secret); await vm.paste()
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(vm.canPaste(formMenu(secret))).toBe(false)
  })
  it('ignores an asynchronous clipboard result after the menu closes', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'keep'; field.selectionStart = 4; field.selectionEnd = 4
    vm.menu.value = formMenu(field)
    let resolve!: (value: string) => void
    clipboard.readText.mockReturnValue(new Promise<string>(r => { resolve = r }))
    const pending = vm.paste(); vm.close(false); resolve('overwrite'); await pending
    expect(field.value).toBe('keep')
    expect(field.setRangeText).not.toHaveBeenCalled()
  })
  it('copies only the current input selection', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'; field.selectionStart = 2; field.selectionEnd = 5
    vm.menu.value = formMenu(field)
    clipboard.writeText.mockResolvedValue(undefined)
    await vm.copy()
    expect(clipboard.writeText).toHaveBeenCalledWith('cde')
    expect(vm.menu.value).toBeNull()
  })
  it('closes Select all to return selection to native device actions', async () => {
    const vm = setup(); const field = new FakeInput(); field.value = 'abcdef'; field.selectionStart = 2; field.selectionEnd = 5
    field.dataset.uiMenuSelectionStart = '2'; field.dataset.uiMenuSelectionEnd = '5'
    vm.menu.value = formMenu(field); vm.selectAll()
    expect(field.select).toHaveBeenCalled()
    expect(vm.menu.value).toBeNull()
    expect(field.value).toBe('abcdef')
    expect(field.dataset.uiMenuSelectionStart).toBeUndefined()
  })
  it('pastes plaintext into contenteditable without maxlength and emits input', async () => {
    const vm = setup(); const editor = new FakeElement(); editor.isContentEditable = true; editor.textContent = 'old'
    const range: any = { commonAncestorContainer: editor, toString: () => '', deleteContents: vi.fn(), insertNode: vi.fn(), setStartAfter: vi.fn(), collapse: vi.fn() }
    selection.rangeCount = 1; selection.anchorNode = editor; selection.focusNode = editor; selection.getRangeAt = () => range
    clipboard.readText.mockResolvedValue('<b>plain</b>')
    vm.menu.value = formMenu(editor as any)
    await vm.paste()
    expect(fakeDocument.createTextNode).toHaveBeenCalledWith('<b>plain</b>')
    expect(range.insertNode).toHaveBeenCalledWith({ text: '<b>plain</b>' })
    expect(editor.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'input', inputType: 'insertFromPaste', data: '<b>plain</b>' }))
  })
})
