// CyberManju OS — UI layout registration tests (tests/frontend/ui-layout-registration.test.ts).
// Role: guard deterministic Vue target identities and plugin registration.
// Exports: none.
// Integrates: src/ui/layout.ts, vitest.
// Contracts: does not mount the application or invoke runtime gestures/transports.
import { describe, expect, it } from 'vitest'
import { componentLayoutId, installUiLayoutTargets } from '@/ui/layout'

type MockInstance = {
  $options: { name?: string; __name?: string }
  $?: { vnode?: { key?: unknown } }
  $parent: MockInstance | null
}

function instance(name: string, key?: unknown, parent: MockInstance | null = null): MockInstance {
  return { $options: { name }, $: { vnode: { key } }, $parent: parent }
}

describe('UI layout target registration', () => {
  it('builds identity from component ancestry and vnode keys, not content', () => {
    const app = instance('App')
    const panel = instance('FileManager', 'window-7', app)
    const first = componentLayoutId(instance('UiButton', 'save', panel))
    const same = componentLayoutId(instance('UiButton', 'save', panel))
    const distinct = componentLayoutId(instance('UiButton', 'cancel', panel))

    expect(first).toBe(same)
    expect(first).not.toBe(distinct)
    expect(first).toContain('filemanager-key-window-7')
    expect(first).toContain('uibutton-key-')
    expect(first).not.toMatch(/save file|cancel|text/i)
  })

  it('uses deterministic component names when vnode keys are absent', () => {
    expect(componentLayoutId(instance('Toolbar')).endsWith('toolbar')).toBe(true)
    expect(componentLayoutId(instance('Toolbar'))).toBe(componentLayoutId(instance('Toolbar')))
  })

  it('distinguishes unkeyed component siblings nested below native elements and cloned fragments', () => {
    const type = { name: 'UiButton' }
    const firstComponent = {}, secondComponent = {}
    const first = { type, key: null, component: firstComponent }
    const second = { type, key: null, component: secondComponent }
    const owner = { subTree: { type: 'section', children: [{ type: 'div', children: [first] }, { type: Symbol('fragment'), children: [second] }] } }
    const parent = instance('Panel')
    const a = { ...instance('UiButton', undefined, parent), $: { vnode: { ...first }, parent: owner } }
    const b = { ...instance('UiButton', undefined, parent), $: { vnode: { ...second }, parent: owner } }
    first.component = a.$; second.component = b.$; a.$.vnode.component = a.$; b.$.vnode.component = b.$
    expect(componentLayoutId(a as never)).toContain('uibutton-sibling-0')
    expect(componentLayoutId(b as never)).toContain('uibutton-sibling-1')
    expect(componentLayoutId(a as never)).not.toBe(componentLayoutId(b as never))
  })

  it('keeps distinct keys distinct even when their old normalized forms collided', () => {
    const panel = instance('Panel')
    const slash = componentLayoutId(instance('UiButton', 'a/b', panel))
    const dash = componentLayoutId(instance('UiButton', 'a-b', panel))
    const upper = componentLayoutId(instance('UiButton', 'Save', panel))
    const lower = componentLayoutId(instance('UiButton', 'save', panel))
    expect(new Set([slash, dash, upper, lower]).size).toBe(4)
  })

  it('preserves legacy IDs for safe string keys and encodes lossy keys and non-strings', () => {
    const parent = instance('Panel')
    const safe = componentLayoutId(instance('UiButton', 'save_now-2', parent))
    expect(safe).toContain('uibutton-key-save_now-2')
    expect(safe).not.toContain('~')
    const ids = ['Save', 'a/b', 1, '1', false, 'false'].map(key => componentLayoutId(instance('UiButton', key, parent)))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(0, 2).every(id => id.includes('~'))).toBe(true)
  })

  it('distinguishes equal keyed vnodes rendered in separate branches and cloned slots', () => {
    const type = { name: 'UiButton' }
    const firstComponent = {}, secondComponent = {}
    const first = { type, key: 'action', component: firstComponent }
    const second = { type, key: 'action', component: secondComponent }
    const owner = { subTree: { type: 'section', children: [
      { type: 'div', children: [first] },
      { type: Symbol('fragment'), children: [{ type: 'aside', children: [second] }] },
    ] } }
    const parent = { ...instance('Panel'), $: { vnode: {}, parent: owner } }
    const a = { ...instance('UiButton', 'action', parent), $: { vnode: { ...first }, parent: owner } }
    const b = { ...instance('UiButton', 'action', parent), $: { vnode: { ...second }, parent: owner } }
    first.component = a.$; second.component = b.$; a.$.vnode.component = a.$; b.$.vnode.component = b.$
    expect(componentLayoutId(a as never)).not.toBe(componentLayoutId(b as never))
    expect(componentLayoutId(a as never)).not.toContain('duplicate-')
    expect(componentLayoutId(b as never)).toContain('duplicate-1')
  })

  it('keeps the same panel entities after a window is closed and reopened', () => {
    const windowA = { ...instance('AppWindow', 'win-1'), $props: { win: { panelType: 'files' } } }
    const windowB = { ...instance('AppWindow', 'win-97'), $props: { win: { panelType: 'files' } } }
    const panelA = instance('FileManager', 1, instance('AsyncComponentWrapper', 1, windowA))
    const panelB = instance('FileManager', 99, instance('AsyncComponentWrapper', 99, windowB))
    expect(componentLayoutId(panelA as never)).toBe(componentLayoutId(panelB as never))
    expect(componentLayoutId(panelA as never)).toContain('panel-files')
  })

  it('shares chrome identities between landing and desktop shells', () => {
    expect(componentLayoutId(instance('Dock', 1, instance('LandingPage')))).toBe(componentLayoutId(instance('Dock', 19, instance('DesktopShell'))))
  })

  it('assigns deterministic layout identities to textual component tags and ordinary descendants', () => {
    class HtmlMock {
      dataset: Record<string, string> = {}
      tagName: string
      parentElement: HtmlMock | null
      classList = { contains: () => false }
      isConnected = true
      constructor(tagName: string, parentElement: HtmlMock | null = null) { this.tagName = tagName; this.parentElement = parentElement }
      matches(selector: string) { return selector === '*' || selector.split(',').some(s => s.trim().toLowerCase() === this.tagName.toLowerCase()) }
      closest() { return null }
      setAttribute() {}
      querySelectorAll() { return [] }
    }
    const previous = globalThis.HTMLElement
    Object.assign(globalThis, { HTMLElement: HtmlMock })
    try {
      let mixin: Record<string, (this: unknown) => void> | undefined
      installUiLayoutTargets({ mixin(value: Record<string, (this: unknown) => void>) { mixin = value } } as never)
      const p = new HtmlMock('P'), label = new HtmlMock('LABEL')
      const root = new HtmlMock('SECTION') as HtmlMock & { querySelectorAll: (selector: string) => HtmlMock[] }
      root.querySelectorAll = selector => selector === '*' ? [p, label] : []
      p.parentElement = root; label.parentElement = root
      const vm = { ...instance('TextPanel'), $el: root }
      mixin?.mounted?.call(vm)
      expect(p.dataset.uiLayoutId).toContain('p-0')
      expect(label.dataset.uiLayoutId).toContain('label-0')
      expect(p.dataset.uiLayoutId).not.toBe(label.dataset.uiLayoutId)
    } finally { Object.assign(globalThis, { HTMLElement: previous }) }
  })

  it('retains the first child identity on a shared root after parent update', () => {
    class HtmlMock {
      dataset: Record<string, string> = {}; tagName = 'SECTION'; isConnected = true
      classList = { contains: () => false }; matches() { return false }; closest() { return null }
      setAttribute() {}; querySelectorAll() { return [] }
    }
    const previous = globalThis.HTMLElement
    Object.assign(globalThis, { HTMLElement: HtmlMock })
    try {
      let mixin: Record<string, (this: unknown) => void> | undefined
      installUiLayoutTargets({ mixin(value: Record<string, (this: unknown) => void>) { mixin = value } } as never)
      const root = new HtmlMock()
      const parent = { ...instance('Parent'), $el: root }
      const child = { ...instance('Child', undefined, parent), $el: root }
      mixin?.mounted?.call(child)
      const childIdentity = root.dataset.uiLayoutId
      mixin?.updated?.call(parent)
      expect(root.dataset.uiLayoutId).toBe(childIdentity)
    } finally { Object.assign(globalThis, { HTMLElement: previous }) }
  })

  it('installs mounted and updated hooks without taking over runtime behavior', () => {
    let mixin: Record<string, unknown> | undefined
    installUiLayoutTargets({ mixin(value: Record<string, unknown>) { mixin = value } } as never)

    expect(typeof mixin?.mounted).toBe('function')
    expect(typeof mixin?.updated).toBe('function')
    expect(Object.keys(mixin ?? {})).toEqual(['mounted', 'updated'])
  })
})
