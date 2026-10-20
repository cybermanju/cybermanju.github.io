// CyberManju OS — Spinner layout regressions (tests/frontend/ui-spinner-layout.test.ts).
// Role: render the shared spinner and pin the positioned graphic/label separation.
// Exports: none.
// Integrates: Vue SSR, SFC compiler, TypeScript, Vitest.
// Contracts: sibling orbit rings share an unanimated non-shrinking box; accessible status names and size classes remain intact.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const { descriptor } = parse(readFileSync('src/components/ui/UiSpinner.vue', 'utf8'))
const compiled = compileScript(descriptor, { id: 'ui-spinner-layout', inlineTemplate: true })
const { outputText } = transpileModule(compiled.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
})
const loaded = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', outputText)(
  (name: string) => {
    if (name === 'vue') return Vue
    throw new Error(`Unexpected component dependency: ${name}`)
  }, loaded, loaded.exports,
)
const UiSpinner = loaded.exports.default as Vue.Component

async function render(props: Record<string, unknown> = {}) {
  return (await renderToString(Vue.createSSRApp(UiSpinner, props))).replace(/<!--[\s\S]*?-->/g, '')
}

describe('UiSpinner graphic layout contracts', () => {
  it('keeps the default status named and the decorative graphic hidden from assistive technology', async () => {
    const html = await render()
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
    expect(html).toContain('class="ui-spinner__graphic" aria-hidden="true"')
    expect(html.match(/class="ui-spinner__ring"/g)).toHaveLength(1)
    expect(html).not.toContain('ui-spinner__ring--inner')
    expect(html).not.toContain('ui-spinner__label')
  })

  it('contains both orbit rings in the same graphic box with the visible label outside', async () => {
    const html = await render({ variant: 'orbit', showLabel: true, label: 'Searching' })
    expect(html).toContain('aria-label="Searching"')
    expect(html).toMatch(/<span class="ui-spinner__graphic" aria-hidden="true">\s*<span class="ui-spinner__ring"><\/span>\s*<span class="ui-spinner__ring ui-spinner__ring--inner"><\/span>\s*<\/span>\s*<span class="ui-spinner__label">Searching<\/span>/)
  })

  it('keeps visible ring-mode labels outside the graphic box too', async () => {
    const html = await render({ showLabel: true, label: 'Loading files' })
    expect(html).toMatch(/<span class="ui-spinner__graphic" aria-hidden="true">\s*<span class="ui-spinner__ring"><\/span>\s*<\/span>\s*<span class="ui-spinner__label">Loading files<\/span>/)
  })

  it.each(['xs', 'sm', 'md', 'lg'])('retains the %s size class and graphic box', async (size) => {
    const html = await render({ size, variant: 'orbit' })
    expect(html).toContain(`ui-spinner--${size}`)
    expect(html).toContain('ui-spinner--orbit')
    expect(html).toContain('ui-spinner__graphic')
    expect(html).toContain('ui-spinner__ring--inner')
  })

  it('compiles a stable containing block without rotating the graphic parent', () => {
    const style = compileStyle({
      source: descriptor.styles[0].content,
      filename: 'UiSpinner.vue',
      id: 'data-v-ui-spinner-layout',
      scoped: true,
    })
    expect(style.errors).toEqual([])
    const graphic = style.code.match(/\.ui-spinner__graphic[^\{]*\{([^}]+)\}/)?.[1] ?? ''
    expect(graphic).toMatch(/position:\s*relative/)
    expect(graphic).toMatch(/display:\s*inline-flex/)
    expect(graphic).toMatch(/flex-shrink:\s*0/)
    expect(graphic).not.toMatch(/animation\s*:/)
    const inner = style.code.match(/\.ui-spinner__ring--inner[^\{]*\{([^}]+)\}/)?.[1] ?? ''
    expect(inner).toMatch(/position:\s*absolute/)
    expect(inner).toMatch(/top:\s*50%/)
    expect(inner).toMatch(/left:\s*50%/)
  })
})
