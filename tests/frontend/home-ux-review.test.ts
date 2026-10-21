// CyberManju OS — Home UX review (tests/frontend/home-ux-review.test.ts).
// Role: Guard Settings icon contrast, mobile home geometry and safe command-bar keyboard input.
// Exports: Vitest regression suite.
// Integrates: Vue SFC parser, TypeScript transpiler and source-level component contracts.
// Contracts: Presentation-only fixes must not alter personalization persistence or execute commands.
import { readFileSync } from 'node:fs'
import { parse, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const read = (name: string) => readFileSync(`src/components/${name}.vue`, 'utf8')
const home = read('MobileLauncher')
const settings = read('SettingsPage')
const bar = read('HomeCommandBar')

function commandBar() {
  const source = parse(bar).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const handoff = vi.fn()
  const open = vi.fn()
  const handlers = new Function('ref', 'useWindowManager', 'stageHomeCommand', `${compiled}\nreturn { input, status, onEnter, stage }`)(
    (value: string) => ({ value }), () => ({ open }), handoff,
  )
  return { ...handlers, handoff, open }
}

describe('home and Settings UX regressions', () => {
  it('uses the contrasting on-accent token for both Settings icon tile types', () => {
    for (const selector of ['.st-list-icon', '.st-body :deep(.ui-card__icon)']) {
      const rule = settings.slice(settings.indexOf(`${selector} {`)).split('}')[0]
      expect(rule).toContain('var(--ui-accent)')
      expect(rule).toContain('color: var(--ui-on-accent)')
      expect(rule).not.toContain('color: #fff;')
    }
  })

  it('keeps the same AMOLED drawer reservation before, during and after editing', () => {
    expect(home).toContain('.mla.theme-flat-amoled,\n.mla.theme-flat-amoled.mla-layout-free {')
    expect(home).toContain('bottom: calc(76px + env(safe-area-inset-bottom, 0px));')
    expect(home).toContain('.mla.theme-flat-amoled.mla-layout-free.with-app-nav {')
    expect(home).not.toContain('.mla.theme-flat-amoled:not(.mla-layout-free)')
    expect(home).toMatch(/\.mla-layout-toolbar \{[^}]*position: absolute;/)
    expect(home).toContain('.mla:has(.omni--home .omni-drop) { bottom: 0; padding-bottom: 0; }')
  })

  it('keeps tablet pages full-width with unchanged column count and centers the dock in both modes', () => {
    const tablet = home.slice(home.indexOf('@media (min-width: 600px) and (max-width: 768px)'))
      .split('/* A calm')[0]
    expect(tablet).toContain('.mla-pages { margin: 0 -32px; flex-basis: 203px; min-height: 203px; }')
    expect(tablet).toContain('.mla-grid { padding-inline: 32px; grid-template-columns: repeat(5, minmax(0, 1fr))')
    expect(tablet).not.toContain(':not(.mla-layout-free)')
    expect(tablet).toContain('left: 50%; right: auto; transform: translateX(-50%)')
    expect(home).toMatch(/\.mla-dot-btn \{ width: 44px; height: 44px;/)
    expect(home).toContain('.mla-dot-btn:focus-visible')
  })

  it('describes exact placement rather than promising post-release gravity', () => {
    expect(home).toContain('Drag to place; items stay where you release them.')
    expect(home).not.toContain('gravity settles items')
    expect(read('DesktopShell')).not.toContain('gravity settles them')
  })

  it.each([{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }])(
    'does not open a panel while Enter confirms an IME candidate (%j)', event => {
      const state = commandBar()
      state.input.value = '日本語'
      const preventDefault = vi.fn()
      state.onEnter({ ...event, preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      expect(state.handoff).not.toHaveBeenCalled()
      expect(state.open).not.toHaveBeenCalled()
      expect(state.input.value).toBe('日本語')
    },
  )

  it('hands off one trimmed draft on normal Enter, never executing it', () => {
    const state = commandBar()
    state.input.value = '  explain my files  '
    const preventDefault = vi.fn()
    state.onEnter({ isComposing: false, keyCode: 13, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(state.handoff).toHaveBeenCalledExactlyOnceWith('agent', 'explain my files')
    expect(state.open).toHaveBeenCalledExactlyOnceWith('agent')
    expect(state.input.value).toBe('')
    expect(state.status.value).toBe('Added to Assistant draft')
    expect(bar).toContain('.home-command:focus-within')
    expect(bar).toContain('.home-command-actions button:focus-visible')
  })

  it('compiles every changed component style', () => {
    for (const [name, source] of Object.entries({ MobileLauncher: home, SettingsPage: settings, HomeCommandBar: bar })) {
      const { descriptor, errors } = parse(source)
      expect(errors).toEqual([])
      for (const style of descriptor.styles) {
        expect(compileStyle({ source: style.content, filename: name, id: 'ux-review', scoped: style.scoped }).errors).toEqual([])
      }
    }
  })
})
