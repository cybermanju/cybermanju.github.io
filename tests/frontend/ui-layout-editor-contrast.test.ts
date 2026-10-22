// CyberManju OS — Layout editor contrast regression tests.
// Role: Keep accent buttons readable across themes and customized colors.
// Integrates: UiLayoutEditor and UI token generation.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, THEME_IDS, buildCssVars, contrastRatio, parseColor } from '@/ui/tokens'

const editor = readFileSync('src/components/UiLayoutEditor.vue', 'utf8')

function ratio(foreground: string, background: string) {
  return contrastRatio(parseColor(foreground).slice(0, 3) as [number, number, number], parseColor(background).slice(0, 3) as [number, number, number])
}

describe('UiLayoutEditor button contrast', () => {
  it('uses the theme-provided on-accent foreground instead of hard-coded white', () => {
    expect(editor).toContain('color: var(--ui-on-accent, #000000) !important')
    expect(editor).not.toContain('color: #fff !important')
  })

  it('keeps selected and Done buttons at WCAG AA for every theme and custom accent', () => {
    const accents = ['#007AFF', '#0A84FF', '#FFFFFF', '#000000', '#8b7bff', '#808080', '#FF453A', '#00FF00', '#FFFF00', '#0000FF']
    for (const theme of THEME_IDS) {
      const defaults = buildCssVars({ ...DEFAULT_SETTINGS, theme, accents: {} })
      expect(ratio(defaults['--ui-on-accent'], defaults['--ui-accent']), theme).toBeGreaterThanOrEqual(4.5)
      for (const accent of accents) {
        const vars = buildCssVars({ ...DEFAULT_SETTINGS, theme, accent, accents: {} })
        expect(ratio(vars['--ui-on-accent'], vars['--ui-accent']), `${theme} ${accent}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
