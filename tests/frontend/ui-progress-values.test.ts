// CyberManju OS — Progress value regressions (tests/frontend/ui-progress-values.test.ts).
// Role: render the real shared progress component with normal and invalid telemetry.
// Exports: none.
// Integrates: Vue SSR, SFC compiler, TypeScript, Vitest.
// Contracts: finite bounded percentages; unchanged rounding and indeterminate rendering.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const { descriptor } = parse(readFileSync('src/components/ui/UiProgress.vue', 'utf8'))
const compiled = compileScript(descriptor, { id: 'ui-progress-values', inlineTemplate: true })
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
const UiProgress = loaded.exports.default as Vue.Component

async function render(props: Record<string, unknown> = {}) {
  return renderToString(Vue.createSSRApp(UiProgress, { showValue: true, ...props }))
}

describe('UiProgress finite values', () => {
  it.each([
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [-20, 0],
    [0, 0],
    [33.4, 33],
    [33.6, 34],
    [100, 100],
    [125, 100],
    [Number.MAX_VALUE, 100],
  ])('renders %s as a bounded %s percent', async (value, expected) => {
    const html = await render({ value })
    expect(html).toContain(`width:${expected}%;`)
    expect(html).toContain(`>${expected}%</span>`)
    expect(html).not.toMatch(/NaN|Infinity|width:-/)
  })

  it('keeps missing values at the existing zero default', async () => {
    const html = await render()
    expect(html).toContain('width:0%;')
    expect(html).toContain('>0%</span>')
  })

  it('keeps indeterminate mode independent of the numeric reading', async () => {
    const html = await render({ value: NaN, indeterminate: true, label: 'Working' })
    expect(html).toContain('ui-progress--indeterminate')
    expect(html).toContain('Working')
    expect(html).not.toContain('width:')
    expect(html).not.toContain('ui-progress__value')
    expect(html).not.toMatch(/NaN|Infinity/)
  })
})
