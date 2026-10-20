// CyberManju OS — Button pressed semantics (tests/frontend/ui-button-pressed.test.ts).
// Role: render the real button SFC to distinguish actions from explicit toggles.
// Exports: none.
// Integrates: Vue SSR, SFC compiler, TypeScript, Vitest; unrelated icon rendering is stubbed.
// Contracts: omitted active never creates a toggle; explicit false/true and caller ARIA attributes are preserved.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const { descriptor } = parse(readFileSync('src/components/ui/UiButton.vue', 'utf8'))
const compiled = compileScript(descriptor, { id: 'ui-button-pressed', inlineTemplate: true })
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
const UiButton = loaded.exports.default as Vue.Component

async function render(props: Record<string, unknown> = {}) {
  return renderToString(Vue.createSSRApp({
    render: () => Vue.h(UiButton, props, { default: () => 'Run task' }),
  }))
}

describe('UiButton pressed semantics', () => {
  it.each([
    ['ordinary', {}],
    ['disabled', { disabled: true }],
    ['loading', { loading: true }],
  ])('does not turn an %s action into a toggle', async (_name, props) => {
    const html = await render(props)
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('type="button"')
    expect(html).toContain('Run task')
    expect(html).not.toContain('aria-pressed=')
    expect(html).not.toContain('ui-btn--active')
    if ('disabled' in props || 'loading' in props) expect(html).toMatch(/\bdisabled(?:\s|=|>)/)
    if ('loading' in props) expect(html).toContain('aria-busy="true"')
  })

  it.each([false, true])('keeps an explicit active=%s toggle state', async (active) => {
    const html = await render({ active })
    expect(html).toContain(`aria-pressed="${active}"`)
    expect(html.includes('ui-btn--active')).toBe(active)
    expect(html).toContain('Run task')
  })

  it('does not infer a toggle when active is explicitly undefined', async () => {
    expect(await render({ active: undefined })).not.toContain('aria-pressed=')
  })

  it('preserves an explicit caller-provided pressed state', async () => {
    const html = await render({ 'aria-pressed': 'mixed', 'aria-label': 'Select items' })
    expect(html).toContain('aria-pressed="mixed"')
    expect(html).toContain('aria-label="Select items"')
  })
})
