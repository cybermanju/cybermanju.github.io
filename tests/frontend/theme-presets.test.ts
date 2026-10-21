// CyberManju OS — Personal theme presets (tests/frontend/theme-presets.test.ts).
// Role: Validate monochrome rendering, glass fallback, and saved theme preferences.
// Exports: Vitest theme regression suite.
// Integrates: tokens, useTheme, frontend/native theme command registries.
// Contracts: Flat appearance never destroys a user's accent or wallpaper settings.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, THEMES, buildCssVars, compositeOver, contrastRatio, parseColor } from '@/ui/tokens'

describe('personal appearance presets', () => {
  it('renders Flat AMOLED as true black, white-accented and non-translucent', () => {
    for (const shell of ['macos', 'plasma'] as const) {
      const vars = buildCssVars({ ...DEFAULT_SETTINGS, theme: 'flat-amoled', shell, accent: '#AF52DE', accents: { 'flat-amoled': '#FF453A' }, glass: 2 })
      for (const token of ['--ui-bg', '--ui-bg-deep', '--ui-surface', '--ui-window', '--ui-sidebar', '--ui-panel']) expect(vars[token], token).toBe('#000000')
      expect(vars['--ui-text']).toBe('#FFFFFF')
      expect(vars['--ui-accent']).toBe('#FFFFFF')
      expect(vars['--ui-on-accent']).toBe('#000000')
      expect(vars['--ui-blur']).toBe('0px')
      expect(vars['--ui-glass-sheen']).toBe('none')
      for (const token of ['--ui-shadow-window', '--ui-shadow-menu', '--ui-shadow-3', '--shadow-window']) expect(vars[token], token).toBe('none')
      expect(vars['--ui-focus-ring']).toContain('#FFFFFF')
    }
  })
  it('keeps Modern Glass content opaque and chrome optional', () => {
    const glass = buildCssVars({ ...DEFAULT_SETTINGS, theme: 'modern-glass', glass: 2 })
    const solid = buildCssVars({ ...DEFAULT_SETTINGS, theme: 'modern-glass', glass: 0 })
    expect(glass['--ui-content']).toMatch(/^#[0-9A-F]{6}$/i)
    expect(glass['--ui-window']).toMatch(/^rgba/)
    expect(glass['--ui-glass-sheen']).toContain('linear-gradient')
    expect(solid['--ui-window']).toBe(solid['--ui-surface'])
    expect(solid['--ui-blur']).toBe('0px')
    expect(solid['--ui-glass-sheen']).toBe('none')
  })
  it('keeps secondary glass labels readable even over the chrome base', () => {
    const p = THEMES['modern-glass'].palette
    const panel = compositeOver(p.panel, p.bg)
    const label = parseColor(p.text2).slice(0, 3) as [number, number, number]
    expect(contrastRatio(label, panel)).toBeGreaterThanOrEqual(4.5)
  })
  it('supports both ids in native and WASM terminal allowlists', () => {
    for (const path of ['crates/os/src/shell.rs', 'crates/os-wasm/src/os.rs']) {
      const source = readFileSync(path, 'utf8')
      for (const id of ['modern-glass', 'flat-amoled']) expect(source).toContain(`"${id}" => Some("${id}")`)
    }
    expect(readFileSync('src/utils/staticCybsh.ts', 'utf8')).toContain('const STATIC_THEME_IDS = THEME_IDS')
  })
  it('offers named previews in Settings and quick appearance selection', () => {
    const settings = readFileSync('src/components/SettingsPage.vue', 'utf8')
    const header = readFileSync('src/components/TopMenuBar.vue', 'utf8')
    expect(settings).toContain('Personal launcher themes')
    for (const id of ['modern-glass', 'flat-amoled']) expect(header).toContain(`.appearance-swatch--${id}`)
  })
  it('persists Flat AMOLED without overwriting the previous accent, wallpaper, or glass preference', async () => {
    vi.resetModules()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) })
    try {
      const { useTheme } = await import('@/composables/useTheme')
      const theme = useTheme()
      theme.setTheme('modern-glass')
      theme.setAccent('#AF52DE')
      theme.setWallpaper('dunes')
      theme.setGlass(2)
      theme.setTheme('flat-amoled')
      await new Promise(resolve => setTimeout(resolve, 0))
      const saved = JSON.parse(storage.get('cybermanju_theme_v1')!)
      expect(saved).toMatchObject({ theme: 'flat-amoled', followSystem: false, accent: '#AF52DE', wallpaper: 'dunes', glass: 2 })
      expect(theme.cssVars.value['--ui-accent']).toBe('#FFFFFF')
      vi.resetModules()
      const fresh = (await import('@/composables/useTheme')).useTheme()
      expect(fresh.themeId.value).toBe('flat-amoled')
      fresh.setTheme('modern-glass')
      expect(fresh.cssVars.value['--ui-accent']).toBe('#AF52DE')
      expect(fresh.settings.wallpaper).toBe('dunes')
    } finally { vi.unstubAllGlobals(); vi.resetModules() }
  })
})
