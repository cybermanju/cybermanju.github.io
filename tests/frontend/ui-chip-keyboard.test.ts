// CyberManju OS — Chip keyboard isolation (tests/frontend/ui-chip-keyboard.test.ts).
// Role: exercise real compiled SFC handlers without a browser or DOM dependency.
// Exports: none.
// Integrates: Vue custom renderer, SFC compiler, TypeScript, Vitest.
// Contracts: chip keyboard shortcuts never cancel or activate a nested removal button.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const { descriptor } = parse(readFileSync('src/components/ui/UiChip.vue', 'utf8'))
const compiled = compileScript(descriptor, { id: 'ui-chip-keyboard', inlineTemplate: true })
const { outputText } = transpileModule(compiled.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
})
const loaded = { exports: {} as Record<string, unknown> }
const AppIcon = Vue.defineComponent({ render: () => Vue.h('span') })
new Function('require', 'module', 'exports', outputText)(
  (name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/components/AppIcon.vue') return { default: AppIcon }
    throw new Error(`Unexpected component dependency: ${name}`)
  }, loaded, loaded.exports,
)
const UiChip = loaded.exports.default as Vue.Component

type HostNode = { tag: string; props: Record<string, unknown> }
function mountChip() {
  const elements: HostNode[] = []
  const click = vi.fn()
  const remove = vi.fn()
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    createElement(tag) {
      const node = { tag, props: {} }
      elements.push(node)
      return node
    },
    createText: () => ({ tag: '#text', props: {} }),
    createComment: () => ({ tag: '#comment', props: {} }),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp(node, key, _previous, next) { node.props[key] = next },
  })
  const app = renderer.createApp(UiChip, {
    label: 'Files', removable: true, onClick: click, onRemove: remove,
  })
  app.mount({ tag: 'root', props: {} })
  const chip = elements.find(node => node.props.role === 'button')!
  const button = elements.find(node => node.tag === 'button')!
  return { app, chip, button, click, remove }
}
function dispatch(node: HostNode, name: string, event: Record<string, unknown>) {
  const handlers = node.props[name]
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) {
    (handler as (event: Record<string, unknown>) => void)(event)
  }
}
function keyboardEvent(key: string, target: HostNode, currentTarget: HostNode) {
  return { key, target, currentTarget, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}

describe('UiChip keyboard isolation', () => {
  it.each(['Enter', ' '])('activates the chip itself with %j', (key) => {
    const { app, chip, click, remove } = mountChip()
    try {
      const event = keyboardEvent(key, chip, chip)
      dispatch(chip, 'onKeydown', event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(click).toHaveBeenCalledExactlyOnceWith(event)
      expect(remove).not.toHaveBeenCalled()
    } finally { app.unmount() }
  })
  it.each(['Enter', ' '])('leaves nested removal button key %j to native behavior', (key) => {
    const { app, chip, button, click, remove } = mountChip()
    try {
      const event = keyboardEvent(key, button, chip)
      dispatch(chip, 'onKeydown', event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(click).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(button.props.type).toBe('button')
      expect(button.props['aria-label']).toBe('Remove Files')
      // Model the browser-generated click after an unprevented native activation.
      dispatch(button, 'onClick', event)
      expect(event.stopPropagation).toHaveBeenCalledOnce()
      expect(remove).toHaveBeenCalledExactlyOnceWith(event)
      expect(click).not.toHaveBeenCalled()
    } finally { app.unmount() }
  })
  it('ignores unrelated keys and preserves root button semantics', () => {
    const { app, chip, click } = mountChip()
    try {
      const event = keyboardEvent('Escape', chip, chip)
      dispatch(chip, 'onKeydown', event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(click).not.toHaveBeenCalled()
      expect(chip.props.tabindex).toBe('0')
      expect(chip.props['aria-pressed']).toBe(false)
      dispatch(chip, 'onClick', event)
      expect(click).toHaveBeenCalledExactlyOnceWith(event)
    } finally { app.unmount() }
  })
})
