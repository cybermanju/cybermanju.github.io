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
    expect(first).toContain('uibutton-key-save')
    expect(first).not.toMatch(/save file|cancel|text/i)
  })

  it('uses deterministic component names when vnode keys are absent', () => {
    expect(componentLayoutId(instance('Toolbar')).endsWith('toolbar')).toBe(true)
    expect(componentLayoutId(instance('Toolbar'))).toBe(componentLayoutId(instance('Toolbar')))
  })

  it('distinguishes unkeyed component siblings nested below native elements and fragments', () => {
    const type = { name: 'UiButton' }
    const first = { type, key: null }
    const second = { type, key: null }
    const owner = { subTree: { type: 'section', children: [{ type: 'div', children: [first] }, { type: Symbol('fragment'), children: [second] }] } }
    const parent = instance('Panel')
    const a = { ...instance('UiButton', undefined, parent), $: { vnode: first, parent: owner } }
    const b = { ...instance('UiButton', undefined, parent), $: { vnode: second, parent: owner } }
    expect(componentLayoutId(a as never)).toContain('uibutton-sibling-0')
    expect(componentLayoutId(b as never)).toContain('uibutton-sibling-1')
    expect(componentLayoutId(a as never)).not.toBe(componentLayoutId(b as never))
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

  it('installs mounted and updated hooks without taking over runtime behavior', () => {
    let mixin: Record<string, unknown> | undefined
    installUiLayoutTargets({ mixin(value: Record<string, unknown>) { mixin = value } } as never)

    expect(typeof mixin?.mounted).toBe('function')
    expect(typeof mixin?.updated).toBe('function')
    expect(Object.keys(mixin ?? {})).toEqual(['mounted', 'updated'])
  })
})
