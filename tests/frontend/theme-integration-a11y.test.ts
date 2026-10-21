// CyberManju OS — cross-screen theme accessibility regressions.
// Role: guard readable semantic colors and live per-theme customization.
// Integrates: tokens, useTheme and the Other App permission UI.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, THEMES, buildCssVars, compositeOver, contrastRatio, parseColor, type ThemeId } from '@/ui/tokens'
const rgb = (value: string) => parseColor(value).slice(0, 3) as [number, number, number]
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
describe('theme integration accessibility', () => {
  for (const theme of Object.keys(THEMES) as ThemeId[]) {
    it(`${theme}: keeps custom accent fills, labels, status text and focus readable`, () => {
      for (const accent of [null, '#ffffff', '#000000', '#ffff00', '#123456', '#AF52DE', '#777777', '#00ff00']) {
        const vars = buildCssVars({ ...DEFAULT_SETTINGS, theme, accent })
        expect(contrastRatio(rgb(vars['--ui-on-accent']), rgb(vars['--ui-accent']))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(rgb(vars['--ui-on-accent-strong']), rgb(vars['--ui-accent-strong']))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(rgb(vars['--ui-on-danger']), rgb(vars['--ui-danger']))).toBeGreaterThanOrEqual(4.5)
        for (const surface of ['--ui-surface', '--ui-surface-2', '--ui-surface-3']) {
          for (const token of ['--ui-accent-text', '--ui-danger-text', '--ui-success-text', '--ui-warning-text']) {
            expect(contrastRatio(rgb(vars[token]), rgb(vars[surface])), `${theme} ${accent} ${token}/${surface}`).toBeGreaterThanOrEqual(4.5)
          }
          expect(contrastRatio(rgb(vars['--ui-focus-color']), rgb(vars[surface]))).toBeGreaterThanOrEqual(3)
        }
        const selected = compositeOver(vars['--ui-accent-softer'], vars['--ui-surface'])
        expect(contrastRatio(rgb(vars['--ui-accent-text']), selected), `${theme} selected ${accent}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
  it('updates per-theme accents live without resetting wallpaper or per-item appearance', async () => {
    await import('vue') // Initialize Vue before installing the minimal document mock.
    const storage = new Map<string, string>([['cybermanju.ui.appearance.v1', '{"home:app":{"kind":"image","value":"data:image/png;base64,YWJj"}}']])
    const rootVars = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) })
    vi.stubGlobal('document', { documentElement: { dataset: {}, style: { setProperty: (key: string, value: string) => rootVars.set(key, value) } } })
    const { useTheme } = await import('@/composables/useTheme')
    const theme = useTheme()
    theme.setAppearance('os-light')
    theme.setWallpaper('dunes')
    await new Promise(resolve => setTimeout(resolve, 0))
    theme.setAccentFor('os-light', '#123456')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rootVars.get('--ui-accent')).toBe('#123456')
    expect(JSON.parse(storage.get('cybermanju_theme_v1')!).accents['os-light']).toBe('#123456')
    expect(theme.settings.wallpaper).toBe('dunes')
    expect(storage.get('cybermanju.ui.appearance.v1')).toContain('data:image/png;base64,YWJj')
  })
  it('keeps Other App guidance and keyboard focus visible with original app artwork', () => {
    const picker = readFileSync('src/components/PhoneAppReader.vue', 'utf8')
    expect(picker).toContain('id="reader-start-guidance"')
    expect(picker).toContain('aria-describedby="reader-start-guidance"')
    expect(picker).toContain('.reader-search input:focus-visible')
    expect(picker).toContain('.reader-consent:focus-within')
    expect(picker).toContain('.reader-app-name small { color: var(--ui-text-2); }')
    expect(picker).not.toContain('var(--ui-text-muted)')
    expect(picker).toContain(':src="app.iconBase64"')
    expect(picker).not.toMatch(/filter:\s*(grayscale|brightness)/)
  })
})
