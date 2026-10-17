// CyberManju OS — UiInput accessibility (tests/frontend/ui-input-a11y.test.ts).
// Role: render the real SFC in Node to verify native attribute placement.
// Exports: none.
// Integrates: Vue SSR, SFC compiler, TypeScript, Vitest.
// Contracts: native attrs target the input; caller class/style stay on the wrapper.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

// No DOM or Vitest config change is needed: compile the production SFC and stub
// only its decorative icon dependency, then render the actual component via SSR.
const source = readFileSync('src/components/ui/UiInput.vue', 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'ui-input-a11y', inlineTemplate: true })
const { outputText } = transpileModule(compiled.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
})
const loaded = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', outputText)((id: string) => {
  if (id === 'vue') return Vue
  if (id === '@/components/AppIcon.vue') return { default: { render: () => null } }
  throw new Error('Unexpected UiInput dependency: ' + id)
}, loaded, loaded.exports)
const UiInput = loaded.exports.default as Vue.Component

describe('UiInput native attributes', () => {
  it('puts accessible names, descriptions and ids on the native input', async () => {
    const html = await renderToString(Vue.createSSRApp(UiInput, {
      modelValue: 'example',
      'aria-label': 'API key',
      'aria-labelledby': 'key-label',
      'aria-describedby': 'key-help',
      id: 'api-key',
      name: 'apiKey',
    }))
    const wrapper = html.match(/^<label\b[^>]*>/)?.[0] ?? ''
    const input = html.match(/<input\b[^>]*>/)?.[0] ?? ''
    expect(input).toContain('aria-label="API key"')
    expect(input).toContain('aria-labelledby="key-label"')
    expect(input).toContain('aria-describedby="key-help"')
    expect(input).toContain('id="api-key"')
    expect(input).toContain('name="apiKey"')
    expect(input).toContain('value="example"')
    expect(wrapper).not.toContain('aria-label')
    expect(wrapper).not.toContain('id="api-key"')
  })

  it('keeps caller layout attributes on the wrapper and declared props on the input', async () => {
    const html = await renderToString(Vue.createSSRApp(UiInput, {
      class: 'sp-search',
      style: { width: '100%' },
      label: 'Search',
      placeholder: 'Search files',
      autocomplete: 'username',
    }))
    const wrapper = html.match(/^<label\b[^>]*>/)?.[0] ?? ''
    const input = html.match(/<input\b[^>]*>/)?.[0] ?? ''
    expect(wrapper).toContain('sp-search')
    expect(wrapper).toContain('width:100%')
    expect(input).not.toContain('sp-search')
    expect(input).not.toContain('style=')
    expect(input).toContain('placeholder="Search files"')
    expect(input).toContain('autocomplete="username"')
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).toContain('Search</span>')
  })
})
