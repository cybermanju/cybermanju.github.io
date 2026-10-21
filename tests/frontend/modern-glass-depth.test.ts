// CyberManju OS — Modern Glass depth (tests/frontend/modern-glass-depth.test.ts).
// Role: Validate shared ambient backgrounds and accessible reading surfaces.
// Exports: Vitest suite for glass tokens and shell/background integration.
// Integrates: appearance tokens, shared CSS, Vue SFC compiler.
// Contracts: No forced transparency, custom wallpaper loss, or AMOLED effects.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileStyle, parse } from '@vue/compiler-sfc'
import { DEFAULT_SETTINGS, THEMES, buildCssVars, compositeOver, contrastRatio, parseColor } from '@/ui/tokens'
const vars = (glass: 0 | 2) => buildCssVars({ ...DEFAULT_SETTINGS, theme: 'modern-glass', glass })
describe('coherent Modern Glass depth', () => {
  it('shares static ambient light while keeping all app content opaque', () => {
    const glass = vars(2)
    expect(glass['--ui-ambient-background']).toContain('radial-gradient')
    expect(glass['--ui-ambient-background']).toContain('linear-gradient')
    expect(glass['--ui-ambient-background']).not.toContain('animation')
    expect(glass['--ui-content']).toBe(glass['--ui-surface'])
    expect(glass['--ui-glass-reading']).toContain('0.88')
    const customized = buildCssVars({ ...DEFAULT_SETTINGS, theme: 'modern-glass', glass: 2, accent: '#AF52DE' })
    expect(customized['--ui-ambient-background']).toContain('175, 82, 222')
  })
  it('keeps secondary text readable even over the brightest possible backdrop', () => {
    const glass = vars(2)
    const reading = compositeOver(glass['--ui-glass-reading'], '#ffffff')
    const foreground = parseColor(THEMES['modern-glass'].palette.text2).slice(0, 3) as [number, number, number]
    expect(contrastRatio(foreground, reading)).toBeGreaterThanOrEqual(4.5)
  })
  it('makes reading surfaces solid when requested and uses valid composable zero shadows', () => {
    const solid = vars(0)
    expect(solid['--ui-glass-reading']).toBe(solid['--ui-surface'])
    expect(solid['--ui-blur']).toBe('0px')
    expect(solid['--ui-glass-sheen']).toBe('none')
    expect(solid['--ui-glass-shadow']).toBe('0 0 0 transparent')
    expect(solid['--ui-glass-edge']).toBe('inset 0 0 0 transparent')
    for (const theme of ['flat-amoled', 'os-dark', 'os-light'] as const) {
      expect(buildCssVars({ ...DEFAULT_SETTINGS, theme, glass: 2 })['--ui-ambient-background']).toBe('none')
    }
  })
  it('uses shared ambient light without hiding custom desktop wallpaper', () => {
    for (const filename of ['src/components/DesktopShell.vue', 'src/components/MobileLauncher.vue', 'src/components/AppWindow.vue']) {
      const source = readFileSync(filename, 'utf8')
      expect(source).toMatch(/--ui-(?:ambient-background|glass-sheen)/)
      const { descriptor } = parse(source, { filename })
      for (const style of descriptor.styles) expect(compileStyle({ source: style.content, filename, id: 'glass-depth', scoped: style.scoped }).errors).toEqual([])
    }
    const desktop = readFileSync('src/components/DesktopShell.vue', 'utf8')
    expect(desktop).toContain('v-if="customWallpaper.source.value"')
    expect(desktop).toContain(':src="customWallpaper.source.value"')
  })
  it('flattens ambient effects for reduced transparency and higher contrast', () => {
    const css = readFileSync('src/assets/ui.css', 'utf8')
    expect(css).toContain('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
    expect(css).toContain('--ui-ambient-background: var(--ui-bg) !important')
    expect(css).toContain('--ui-glass-reading: var(--ui-surface) !important')
    expect(css).toContain('--ui-glass-shadow: 0 0 0 transparent !important')
  })
})
