// CyberManju OS — Progress value regressions (tests/frontend/ui-progress-values.test.ts).
// Role: render the real shared progress component with normal and invalid telemetry.
// Exports: none.
// Integrates: Vue SSR, SFC compiler, TypeScript, Vitest.
// Contracts: finite bounded percentages, progressbar semantics, caller naming precedence and unique label ids.
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

function visibleLabelId(html: string) {
  const span = html.match(/<span\b[^>]*class="ui-progress__label"[^>]*>/)?.[0] ?? ''
  return span.match(/\bid="([^"]+)"/)?.[1]
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
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).toContain(`aria-valuenow="${expected}"`)
    expect(html).not.toMatch(/NaN|Infinity|width:-/)
  })

  it('keeps missing values at zero without referencing an empty label', async () => {
    const html = await render()
    expect(html).toContain('width:0%;')
    expect(html).toContain('>0%</span>')
    expect(html).toContain('aria-valuenow="0"')
    expect(html).not.toContain('aria-labelledby=')
  })

  it('keeps indeterminate mode independent of the numeric reading', async () => {
    const html = await render({ value: NaN, indeterminate: true, label: 'Working' })
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('ui-progress--indeterminate')
    expect(html).toContain('Working')
    expect(html).not.toContain('aria-valuenow=')
    expect(html).not.toContain('width:')
    expect(html).not.toContain('ui-progress__value')
    expect(html).not.toMatch(/NaN|Infinity/)
  })
})

describe('UiProgress accessible labels', () => {
  it('references the visible label by default', async () => {
    const html = await render({ label: 'Battery remaining', value: 72 })
    const id = visibleLabelId(html)
    expect(id).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${id}"`)
    expect(html).toContain('Battery remaining')
  })

  it('references a rich label slot without requiring the label prop', async () => {
    const html = await renderToString(Vue.createSSRApp({
      render: () => Vue.h(UiProgress, { value: 42 }, {
        label: () => Vue.h('strong', 'Upload progress'),
      }),
    }))
    const id = visibleLabelId(html)
    expect(id).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${id}"`)
    expect(html).toContain('<strong>Upload progress</strong>')
  })

  it('does not let the generated label override explicit aria-label', async () => {
    const html = await render({ label: 'Visible label', 'aria-label': 'Custom progress name' })
    expect(html).toContain('aria-label="Custom progress name"')
    expect(html).not.toContain('aria-labelledby=')
    expect(html).toContain('Visible label')
  })

  it('preserves an explicit external aria-labelledby reference', async () => {
    const html = await render({ label: 'Visible label', 'aria-labelledby': 'external-heading' })
    expect(html).toContain('aria-labelledby="external-heading"')
    expect(html).not.toContain(`aria-labelledby="${visibleLabelId(html)}"`)
  })

  it('uses unique ids when battery and storage bars share a render', async () => {
    const html = await renderToString(Vue.createSSRApp({
      render: () => Vue.h('section', [
        Vue.h(UiProgress, { label: 'Battery' }),
        Vue.h(UiProgress, { label: 'Storage' }),
      ]),
    }))
    const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(match => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(html).toContain(`id="${id}"`)
  })
})
