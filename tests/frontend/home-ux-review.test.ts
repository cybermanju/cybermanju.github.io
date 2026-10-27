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
const studio = read('HomeWorkspaceStudio')
const settings = read('SettingsPage')
const bar = read('HomeCommandBar')

function commandBar() {
  const source = parse(bar).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const handoff = vi.fn()
  const open = vi.fn()
  const handlers = new Function('ref', 'useWindowManager', 'stageHomeCommand', 'defineProps', `${compiled}\nreturn { input, status, onEnter, stage }`)(
    (value: string) => ({ value }), () => ({ open }), handoff, () => ({}),
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

  it('uses the full Home viewport with a separately reserved app navigation inset', () => {
    expect(home).toMatch(/\.mla \{[^}]*inset: 0;[^}]*min-height: 0;[^}]*overflow: hidden;/)
    expect(home).toContain('padding-bottom: calc(66px + env(safe-area-inset-bottom, 0px))')
    expect(home).not.toContain('mla-layout-free')
    expect(studio).toContain('.is-editing .workspace-content { flex: 1 0 180px; }')
    // The surface clips; the canvas inside is what scrolls.
    expect(studio).toMatch(/\.studio-surface \{[^}]*overflow: hidden;/)
    expect(studio).toMatch(/\.workspace-content \{[^}]*flex: 1 1 0;[^}]*overflow-y: auto/)
  })

  it('uses a responsive canonical grid and centers the independently pinned dock', () => {
    expect(studio).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(studio).toMatch(/@media\(min-width:600px\)[\s\S]*grid-template-columns: repeat\(5,minmax\(0,1fr\)\)/)
    expect(home).toMatch(/\.mla-dock \{[^}]*flex-shrink: 0;[^}]*align-self: center;[^}]*max-width: 100%/)
    // The orb navigator owns the active-screen surface the old screen-dots
    // row represented; the overview's eagle cards still carry aria-current.
    // It is a touch-first control: `orbHiddenOnDesktop` unmounts it in the desktop shell.
    expect(studio).toContain('<OrbNavigator :screen-index="activeIndex"')
    expect(studio).toContain('v-if="!orbHiddenOnDesktop"')
    expect(studio).toContain('aria-current')
    expect(studio).toContain(':focus-visible')
  })

  it('describes app-local screens and explicit move controls without promising OS gestures', () => {
    expect(studio).toContain('Home screens only, not Android Recents.')
    expect(studio).toContain('Move tiles using the screen selector or Eagle view.')
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
    for (const [name, source] of Object.entries({ MobileLauncher: home, HomeWorkspaceStudio: studio, SettingsPage: settings, HomeCommandBar: bar })) {
      const { descriptor, errors } = parse(source)
      expect(errors).toEqual([])
      for (const style of descriptor.styles) {
        expect(compileStyle({ source: style.content, filename: name, id: 'ux-review', scoped: style.scoped }).errors).toEqual([])
      }
    }
  })
})
