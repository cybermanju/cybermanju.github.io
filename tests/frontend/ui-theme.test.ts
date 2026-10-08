// Theme registries + per-theme accent resolution — drift-killer: the Rust
// shells, the static shell, and the token table must agree on ids, and
// every theme must carry a full design language (not just a palette).
import { describe, it, expect } from 'vitest'
import {
  THEMES,
  THEME_IDS,
  THEME_GROUPS,
  SHAPE_RADII,
  FONT_STACKS,
  FONT_TRACKING_WIDE,
  buildCssVars,
  DEFAULT_SETTINGS,
  type ThemeId,
} from '@/ui/tokens'

describe('theme registries', () => {
  it('every id has a definition with palette + design + blurb', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(17)
    for (const id of THEME_IDS) {
      const def = THEMES[id]
      expect(def, id).toBeDefined()
      expect(def.palette.accent, `${id} accent`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(def.blurb.length, `${id} blurb`).toBeGreaterThan(0)
      expect(SHAPE_RADII[def.design.shape], `${id} shape`).toBeDefined()
      expect(FONT_STACKS[def.design.font], `${id} font`).toBeDefined()
      expect(FONT_TRACKING_WIDE[def.design.font], `${id} tracking`).toBeDefined()
      expect(['soft', 'flat', 'neon'], `${id} elevation`).toContain(def.design.elevation)
      expect(['dark', 'light'], `${id} mode`).toContain(def.mode)
    }
  })

  it('every group id resolves and every theme is grouped', () => {
    const grouped = new Set(THEME_GROUPS.flatMap((g) => g.ids))
    for (const id of THEME_IDS) expect(grouped.has(id), id).toBe(true)
    for (const id of grouped) expect(THEMES[id as ThemeId], id).toBeDefined()
  })

  it('hacker themes exist with mono type + neon elevation', () => {
    for (const id of ['cyber-night', 'matrix-night', 'cyberpunk-night'] as ThemeId[]) {
      expect(THEMES[id].design.font).toBe('mono')
      expect(THEMES[id].design.elevation).toBe('neon')
      expect(THEMES[id].mode).toBe('dark')
    }
    expect(THEMES['cyberpunk-night'].palette.bg).toBe('#000000')
    expect(THEMES['cyberpunk-night'].palette.text).toBe('#ffffff')
  })
})

describe('effective accent resolution', () => {
  it('general accent wins, then per-theme, then built-in', () => {
    const base = { ...DEFAULT_SETTINGS, accents: {} }
    const vars = (s: typeof base) => buildCssVars(s)
    // Built-in.
    expect(vars({ ...base, theme: 'cyberpunk-night' })['--ui-accent']).toBe(
      THEMES['cyberpunk-night'].palette.accent,
    )
    // Per-theme override.
    expect(
      vars({ ...base, theme: 'cyberpunk-night', accents: { 'cyberpunk-night': '#123456' } })[
        '--ui-accent'
      ],
    ).toBe('#123456')
    // Per-theme entry for ANOTHER theme does not leak in.
    expect(
      vars({ ...base, theme: 'cyberpunk-night', accents: { 'matrix-night': '#123456' } })[
        '--ui-accent'
      ],
    ).toBe(THEMES['cyberpunk-night'].palette.accent)
    // General override wins over per-theme.
    expect(
      vars({
        ...base,
        theme: 'cyberpunk-night',
        accent: '#abcdef',
        accents: { 'cyberpunk-night': '#123456' },
      })['--ui-accent'],
    ).toBe('#abcdef')
    // Invalid values fall through to built-in.
    expect(
      vars({ ...base, theme: 'cyberpunk-night', accent: 'bogus', accents: { 'cyberpunk-night': 'xx' } })[
        '--ui-accent'
      ],
    ).toBe(THEMES['cyberpunk-night'].palette.accent)
  })

  it('shape and elevation change the shipped variables', () => {
    const base = { ...DEFAULT_SETTINGS, accents: {} }
    const sharp = buildCssVars({ ...base, theme: 'matrix-night' })
    const round = buildCssVars({ ...base, theme: 'ocean-light' })
    expect(sharp['--ui-radius-md']).not.toBe(round['--ui-radius-md'])
    expect(sharp['--ui-font']).not.toBe(round['--ui-font'])
    expect(sharp['--ui-shadow-3']).not.toBe(round['--ui-shadow-3'])
    expect(sharp['--ui-radius-md']).toBe(SHAPE_RADII.sharp.md)
  })
})
