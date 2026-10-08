/**
 * Single source of truth for the CyberManju OS design language.
 *
 * macOS-inspired system theme: quiet neutral surfaces, one restrained blue
 * accent, SF-first typography, subtle elevation. Components never hardcode
 * colours — they reference the `--ui-*` variables published by
 * `useTheme()`, so switching a theme restyles the whole virtual OS at once.
 */

export type ThemeId =
  | 'mac-light'
  | 'mac-dark'
  | 'mac-graphite-light'
  | 'mac-graphite-dark'
  | 'mac-midnight'
  | 'ocean-light'
  | 'sunset-light'
  | 'forest-light'
  | 'lavender-light'
  | 'rose-light'
  | 'ocean-night'
  | 'forest-night'
  | 'ember-night'
  | 'nebula-night'
  | 'cyber-night'
export type Density = 'compact' | 'comfortable'
export type MotionPref = 'auto' | 'full' | 'reduced'
/** 0 = solid (no blur) · 1 = light vibrancy · 2 = default vibrancy · 3 = rich vibrancy */
export type GlassLevel = 0 | 1 | 2 | 3

export interface ThemePalette {
  /** App background behind everything. */
  bg: string
  /** Deeper wells (gradients, wallpaper base). */
  bgDeep: string
  /** Translucent panel base (toolbars, sidebars). */
  surface: string
  /** Card / row base. */
  surface2: string
  /** Raised / hovered card base. */
  surface3: string
  /** Window body background (rgba, lets wallpaper bleed through). */
  window: string
  /** Window body background at rest (non-focused windows). */
  windowIdle: string
  border: string
  borderStrong: string
  borderHover: string
  hairline: string
  text: string
  text2: string
  text3: string
  textFaint: string
  accent: string
  /** Text/icon colour that always contrasts with `accent`. */
  onAccent: string
  success: string
  warning: string
  danger: string
  info: string
  /** Base RGB (no alpha) used for vibrancy tints — typically the surface colour. */
  glassBase: string
}

export interface ThemeDefinition {
  id: ThemeId
  label: string
  mode: 'dark' | 'light'
  palette: ThemePalette
}

export interface ThemeSettings {
  theme: ThemeId
  /** Accent override — any hex colour, defaults to the theme accent. */
  accent: string | null
  density: Density
  glass: GlassLevel
  motion: MotionPref
  /** Wallpaper ambience: soft neutral depth behind the desktop. */
  glow: boolean
}

/** Stored pre-macOS theme ids map onto their closest macOS successor.
 *  Kept for backward compat — the new `*-night`/`*-light` ids never collide
 *  with these keys, so old installs keep resolving exactly as before. */
export const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  midnight: 'mac-midnight',
  nebula: 'mac-dark',
  ember: 'mac-dark',
  daylight: 'mac-light',
  ghostline: 'mac-dark',
}

/** Picker grouping — system neutrals first, then the colorful families. */
export const THEME_GROUPS: { id: string; label: string; ids: ThemeId[] }[] = [
  { id: 'system', label: 'System', ids: ['mac-light', 'mac-dark', 'mac-graphite-light', 'mac-graphite-dark', 'mac-midnight'] },
  { id: 'color-light', label: 'Color · Light', ids: ['ocean-light', 'sunset-light', 'forest-light', 'lavender-light', 'rose-light'] },
  { id: 'color-night', label: 'Color · Night', ids: ['ocean-night', 'forest-night', 'ember-night', 'nebula-night', 'cyber-night'] },
]

export const THEME_IDS: ThemeId[] = [
  'mac-light',
  'mac-dark',
  'mac-graphite-light',
  'mac-graphite-dark',
  'mac-midnight',
  'ocean-light',
  'sunset-light',
  'forest-light',
  'lavender-light',
  'rose-light',
  'ocean-night',
  'forest-night',
  'ember-night',
  'nebula-night',
  'cyber-night',
]

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'mac-light': {
    id: 'mac-light',
    label: 'Light',
    mode: 'light',
    palette: {
      bg: '#e9ebef',
      bgDeep: '#dfe3e9',
      surface: 'rgba(246, 246, 248, 0.72)',
      surface2: 'rgba(255, 255, 255, 0.82)',
      surface3: 'rgba(255, 255, 255, 0.96)',
      window: 'rgba(242, 243, 246, 0.78)',
      windowIdle: 'rgba(242, 243, 246, 0.66)',
      border: 'rgba(0, 0, 0, 0.08)',
      borderStrong: 'rgba(0, 0, 0, 0.14)',
      borderHover: 'rgba(0, 0, 0, 0.22)',
      hairline: 'rgba(0, 0, 0, 0.06)',
      text: '#1d1d1f',
      text2: '#515154',
      text3: '#6e6e73',
      textFaint: '#aeaeb2',
      accent: '#007aff',
      onAccent: '#ffffff',
      success: '#248a3d',
      warning: '#b25000',
      danger: '#d70015',
      info: '#0071e3',
      glassBase: '255, 255, 255',
    },
  },
  'mac-dark': {
    id: 'mac-dark',
    label: 'Dark',
    mode: 'dark',
    palette: {
      bg: '#1e1e21',
      bgDeep: '#17171a',
      surface: 'rgba(44, 44, 46, 0.72)',
      surface2: 'rgba(54, 54, 58, 0.78)',
      surface3: 'rgba(66, 66, 70, 0.86)',
      window: 'rgba(30, 30, 33, 0.74)',
      windowIdle: 'rgba(30, 30, 33, 0.62)',
      border: 'rgba(255, 255, 255, 0.09)',
      borderStrong: 'rgba(255, 255, 255, 0.15)',
      borderHover: 'rgba(255, 255, 255, 0.24)',
      hairline: 'rgba(255, 255, 255, 0.06)',
      text: '#f5f5f7',
      text2: '#c7c7cc',
      text3: '#98989f',
      textFaint: '#636366',
      accent: '#0a84ff',
      onAccent: '#ffffff',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a',
      info: '#64d2ff',
      glassBase: '48, 48, 52',
    },
  },
  'mac-graphite-light': {
    id: 'mac-graphite-light',
    label: 'Graphite Light',
    mode: 'light',
    palette: {
      bg: '#e8e8ea',
      bgDeep: '#dcdce0',
      surface: 'rgba(244, 244, 246, 0.72)',
      surface2: 'rgba(255, 255, 255, 0.82)',
      surface3: 'rgba(255, 255, 255, 0.96)',
      window: 'rgba(240, 240, 243, 0.78)',
      windowIdle: 'rgba(240, 240, 243, 0.66)',
      border: 'rgba(0, 0, 0, 0.08)',
      borderStrong: 'rgba(0, 0, 0, 0.14)',
      borderHover: 'rgba(0, 0, 0, 0.22)',
      hairline: 'rgba(0, 0, 0, 0.06)',
      text: '#1d1d1f',
      text2: '#515154',
      text3: '#6e6e73',
      textFaint: '#aeaeb2',
      accent: '#636366',
      onAccent: '#ffffff',
      success: '#248a3d',
      warning: '#b25000',
      danger: '#d70015',
      info: '#515154',
      glassBase: '250, 250, 252',
    },
  },
  'mac-graphite-dark': {
    id: 'mac-graphite-dark',
    label: 'Graphite Dark',
    mode: 'dark',
    palette: {
      bg: '#1d1d1f',
      bgDeep: '#161617',
      surface: 'rgba(42, 42, 44, 0.72)',
      surface2: 'rgba(52, 52, 54, 0.78)',
      surface3: 'rgba(62, 62, 64, 0.86)',
      window: 'rgba(29, 29, 31, 0.74)',
      windowIdle: 'rgba(29, 29, 31, 0.62)',
      border: 'rgba(255, 255, 255, 0.09)',
      borderStrong: 'rgba(255, 255, 255, 0.15)',
      borderHover: 'rgba(255, 255, 255, 0.24)',
      hairline: 'rgba(255, 255, 255, 0.06)',
      text: '#f5f5f7',
      text2: '#c7c7cc',
      text3: '#98989f',
      textFaint: '#636366',
      accent: '#98989f',
      onAccent: '#1d1d1f',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a',
      info: '#98989f',
      glassBase: '46, 46, 48',
    },
  },
  'mac-midnight': {
    id: 'mac-midnight',
    label: 'Midnight',
    mode: 'dark',
    palette: {
      bg: '#000000',
      bgDeep: '#0a0a0c',
      surface: 'rgba(28, 28, 30, 0.72)',
      surface2: 'rgba(38, 38, 41, 0.80)',
      surface3: 'rgba(50, 50, 54, 0.88)',
      window: 'rgba(16, 16, 18, 0.76)',
      windowIdle: 'rgba(16, 16, 18, 0.64)',
      border: 'rgba(255, 255, 255, 0.10)',
      borderStrong: 'rgba(255, 255, 255, 0.16)',
      borderHover: 'rgba(255, 255, 255, 0.26)',
      hairline: 'rgba(255, 255, 255, 0.07)',
      text: '#f5f5f7',
      text2: '#c7c7cc',
      text3: '#98989f',
      textFaint: '#636366',
      accent: '#0a84ff',
      onAccent: '#ffffff',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a',
      info: '#64d2ff',
      glassBase: '28, 28, 30',
    },
  },
  'ocean-light': {
    id: 'ocean-light',
    label: 'Ocean Light',
    mode: 'light',
    palette: {
      bg: '#d7e9f7',
      bgDeep: '#bcd8f0',
      surface: 'rgba(232, 244, 253, 0.74)',
      surface2: 'rgba(255, 255, 255, 0.86)',
      surface3: 'rgba(255, 255, 255, 0.97)',
      window: 'rgba(226, 240, 251, 0.80)',
      windowIdle: 'rgba(226, 240, 251, 0.68)',
      border: 'rgba(2, 132, 199, 0.16)',
      borderStrong: 'rgba(2, 132, 199, 0.28)',
      borderHover: 'rgba(2, 132, 199, 0.42)',
      hairline: 'rgba(2, 132, 199, 0.10)',
      text: '#0c1f33',
      text2: '#33566f',
      text3: '#5b7d99',
      textFaint: '#93aec4',
      accent: '#0284c7',
      onAccent: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      danger: '#dc2626',
      info: '#0284c7',
      glassBase: '214, 235, 250',
    },
  },
  'sunset-light': {
    id: 'sunset-light',
    label: 'Sunset Light',
    mode: 'light',
    palette: {
      bg: '#fde3cf',
      bgDeep: '#f7cba6',
      surface: 'rgba(253, 238, 224, 0.74)',
      surface2: 'rgba(255, 251, 246, 0.86)',
      surface3: 'rgba(255, 255, 255, 0.97)',
      window: 'rgba(250, 230, 210, 0.80)',
      windowIdle: 'rgba(250, 230, 210, 0.68)',
      border: 'rgba(234, 88, 12, 0.16)',
      borderStrong: 'rgba(234, 88, 12, 0.28)',
      borderHover: 'rgba(234, 88, 12, 0.42)',
      hairline: 'rgba(234, 88, 12, 0.10)',
      text: '#331505',
      text2: '#6b3a1e',
      text3: '#8f5f3d',
      textFaint: '#b99a80',
      accent: '#ea580c',
      onAccent: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      danger: '#dc2626',
      info: '#db2777',
      glassBase: '252, 228, 205',
    },
  },
  'forest-light': {
    id: 'forest-light',
    label: 'Forest Light',
    mode: 'light',
    palette: {
      bg: '#d3eddb',
      bgDeep: '#b3dfc0',
      surface: 'rgba(230, 246, 234, 0.74)',
      surface2: 'rgba(248, 255, 249, 0.86)',
      surface3: 'rgba(255, 255, 255, 0.97)',
      window: 'rgba(221, 240, 227, 0.80)',
      windowIdle: 'rgba(221, 240, 227, 0.68)',
      border: 'rgba(21, 128, 61, 0.16)',
      borderStrong: 'rgba(21, 128, 61, 0.28)',
      borderHover: 'rgba(21, 128, 61, 0.42)',
      hairline: 'rgba(21, 128, 61, 0.10)',
      text: '#0b2b17',
      text2: '#2e5940',
      text3: '#54806a',
      textFaint: '#8fb3a0',
      accent: '#15803d',
      onAccent: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      danger: '#dc2626',
      info: '#0d9488',
      glassBase: '211, 237, 219',
    },
  },
  'lavender-light': {
    id: 'lavender-light',
    label: 'Lavender Light',
    mode: 'light',
    palette: {
      bg: '#e1dcfa',
      bgDeep: '#c9c1f2',
      surface: 'rgba(238, 235, 253, 0.74)',
      surface2: 'rgba(250, 249, 255, 0.86)',
      surface3: 'rgba(255, 255, 255, 0.97)',
      window: 'rgba(230, 226, 250, 0.80)',
      windowIdle: 'rgba(230, 226, 250, 0.68)',
      border: 'rgba(124, 58, 237, 0.16)',
      borderStrong: 'rgba(124, 58, 237, 0.28)',
      borderHover: 'rgba(124, 58, 237, 0.42)',
      hairline: 'rgba(124, 58, 237, 0.10)',
      text: '#221243',
      text2: '#4c3a72',
      text3: '#6e5d94',
      textFaint: '#a193c4',
      accent: '#7c3aed',
      onAccent: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      danger: '#dc2626',
      info: '#7c3aed',
      glassBase: '225, 220, 250',
    },
  },
  'rose-light': {
    id: 'rose-light',
    label: 'Rose Light',
    mode: 'light',
    palette: {
      bg: '#fad8e0',
      bgDeep: '#f2b7c5',
      surface: 'rgba(253, 234, 239, 0.74)',
      surface2: 'rgba(255, 248, 250, 0.86)',
      surface3: 'rgba(255, 255, 255, 0.97)',
      window: 'rgba(248, 222, 230, 0.80)',
      windowIdle: 'rgba(248, 222, 230, 0.68)',
      border: 'rgba(225, 29, 72, 0.16)',
      borderStrong: 'rgba(225, 29, 72, 0.28)',
      borderHover: 'rgba(225, 29, 72, 0.42)',
      hairline: 'rgba(225, 29, 72, 0.10)',
      text: '#3b0a16',
      text2: '#6e2f3f',
      text3: '#91586a',
      textFaint: '#bd93a1',
      accent: '#e11d48',
      onAccent: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      danger: '#dc2626',
      info: '#e11d48',
      glassBase: '250, 216, 224',
    },
  },
  'ocean-night': {
    id: 'ocean-night',
    label: 'Ocean Night',
    mode: 'dark',
    palette: {
      bg: '#081a30',
      bgDeep: '#040e1c',
      surface: 'rgba(18, 52, 84, 0.72)',
      surface2: 'rgba(26, 66, 104, 0.80)',
      surface3: 'rgba(36, 84, 128, 0.88)',
      window: 'rgba(10, 26, 46, 0.78)',
      windowIdle: 'rgba(10, 26, 46, 0.66)',
      border: 'rgba(56, 189, 248, 0.18)',
      borderStrong: 'rgba(56, 189, 248, 0.30)',
      borderHover: 'rgba(56, 189, 248, 0.46)',
      hairline: 'rgba(56, 189, 248, 0.12)',
      text: '#e6f3fd',
      text2: '#a9c6de',
      text3: '#7396b3',
      textFaint: '#47657f',
      accent: '#38bdf8',
      onAccent: '#04121f',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#38bdf8',
      glassBase: '18, 52, 84',
    },
  },
  'forest-night': {
    id: 'forest-night',
    label: 'Forest Night',
    mode: 'dark',
    palette: {
      bg: '#07231a',
      bgDeep: '#04120d',
      surface: 'rgba(18, 62, 45, 0.72)',
      surface2: 'rgba(26, 78, 58, 0.80)',
      surface3: 'rgba(36, 98, 74, 0.88)',
      window: 'rgba(9, 33, 25, 0.78)',
      windowIdle: 'rgba(9, 33, 25, 0.66)',
      border: 'rgba(74, 222, 128, 0.18)',
      borderStrong: 'rgba(74, 222, 128, 0.30)',
      borderHover: 'rgba(74, 222, 128, 0.46)',
      hairline: 'rgba(74, 222, 128, 0.12)',
      text: '#e2f5e9',
      text2: '#a9d3bb',
      text3: '#76a48d',
      textFaint: '#4a7261',
      accent: '#4ade80',
      onAccent: '#052012',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#2dd4bf',
      glassBase: '18, 62, 45',
    },
  },
  'ember-night': {
    id: 'ember-night',
    label: 'Ember Night',
    mode: 'dark',
    palette: {
      bg: '#28100a',
      bgDeep: '#150803',
      surface: 'rgba(74, 36, 20, 0.72)',
      surface2: 'rgba(92, 46, 26, 0.80)',
      surface3: 'rgba(114, 60, 35, 0.88)',
      window: 'rgba(38, 17, 10, 0.78)',
      windowIdle: 'rgba(38, 17, 10, 0.66)',
      border: 'rgba(251, 146, 60, 0.20)',
      borderStrong: 'rgba(251, 146, 60, 0.32)',
      borderHover: 'rgba(251, 146, 60, 0.48)',
      hairline: 'rgba(251, 146, 60, 0.12)',
      text: '#fdeee1',
      text2: '#d9b896',
      text3: '#a87f5f',
      textFaint: '#6f5340',
      accent: '#fb923c',
      onAccent: '#241005',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#f472b6',
      glassBase: '74, 36, 20',
    },
  },
  'nebula-night': {
    id: 'nebula-night',
    label: 'Nebula Night',
    mode: 'dark',
    palette: {
      bg: '#160d2e',
      bgDeep: '#0d0719',
      surface: 'rgba(55, 36, 108, 0.72)',
      surface2: 'rgba(68, 46, 130, 0.80)',
      surface3: 'rgba(84, 60, 154, 0.88)',
      window: 'rgba(24, 14, 48, 0.78)',
      windowIdle: 'rgba(24, 14, 48, 0.66)',
      border: 'rgba(168, 85, 247, 0.22)',
      borderStrong: 'rgba(168, 85, 247, 0.34)',
      borderHover: 'rgba(168, 85, 247, 0.50)',
      hairline: 'rgba(168, 85, 247, 0.12)',
      text: '#efe7fd',
      text2: '#c0aee3',
      text3: '#8f7cb8',
      textFaint: '#5e5382',
      accent: '#a855f7',
      onAccent: '#ffffff',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#c084fc',
      glassBase: '55, 36, 108',
    },
  },
  'cyber-night': {
    id: 'cyber-night',
    label: 'Cyber Night',
    mode: 'dark',
    palette: {
      bg: '#12041f',
      bgDeep: '#08020f',
      surface: 'rgba(58, 18, 84, 0.72)',
      surface2: 'rgba(72, 24, 104, 0.80)',
      surface3: 'rgba(90, 32, 128, 0.88)',
      window: 'rgba(20, 6, 32, 0.80)',
      windowIdle: 'rgba(20, 6, 32, 0.68)',
      border: 'rgba(232, 121, 249, 0.22)',
      borderStrong: 'rgba(232, 121, 249, 0.34)',
      borderHover: 'rgba(232, 121, 249, 0.50)',
      hairline: 'rgba(34, 211, 238, 0.14)',
      text: '#fbe7ff',
      text2: '#d3aee0',
      text3: '#9d7bb0',
      textFaint: '#624a73',
      accent: '#e879f9',
      onAccent: '#24052e',
      success: '#4ade80',
      warning: '#fde047',
      danger: '#fb7185',
      info: '#22d3ee',
      glassBase: '58, 18, 84',
    },
  },
}

export const ACCENT_CHOICES: { id: string; label: string; value: string }[] = [
  { id: 'default', label: 'System', value: '' },
  { id: 'blue', label: 'Blue', value: '#007aff' },
  { id: 'purple', label: 'Purple', value: '#af52de' },
  { id: 'pink', label: 'Pink', value: '#ff2d55' },
  { id: 'red', label: 'Red', value: '#ff3b30' },
  { id: 'orange', label: 'Orange', value: '#ff9500' },
  { id: 'yellow', label: 'Yellow', value: '#ffcc00' },
  { id: 'green', label: 'Green', value: '#34c759' },
  { id: 'teal', label: 'Teal', value: '#5ac8fa' },
  { id: 'graphite', label: 'Graphite', value: '#8e8e93' },
]

export const DENSITY_SCALE: Record<Density, { unit: number; control: number; fs: number }> = {
  compact: { unit: 0.9, control: 24, fs: 0.96 },
  comfortable: { unit: 1, control: 28, fs: 1 },
}

export const DEFAULT_SETTINGS: ThemeSettings = {
  theme: 'mac-light',
  accent: null,
  density: 'comfortable',
  glass: 2,
  motion: 'auto',
  glow: true,
}

// ── colour helpers ────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const num = parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

export function rgba(rgb: string | [number, number, number], alpha: number): string {
  const [r, g, b] = typeof rgb === 'string' ? rgb.split(',').map((n) => parseInt(n.trim(), 10)) : rgb
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mix(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount)) as [number, number, number]
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Build the full `--ui-*` custom property map for the active settings.
 * Everything the design system consumes is computed here — components and
 * panels only ever read the variables.
 */
export function buildCssVars(s: ThemeSettings): Record<string, string> {
  const theme = THEMES[s.theme] ?? THEMES['mac-light']
  const p = theme.palette
  const accent = s.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.accent) ? s.accent : p.accent
  const [ar, ag, ab] = hexToRgb(accent)
  const accentRgb = `${ar}, ${ag}, ${ab}`
  const density = DENSITY_SCALE[s.density]

  // Vibrancy strength: 0 disables blur (solid fills), higher levels trade
  // contrast for depth the way macOS materials do.
  const glassAlpha = [1, 0.82, 0.66, 0.54][s.glass] ?? 0.66
  const blur = [0, 12, 20, 30][s.glass] ?? 20
  const onAccentLuma = (() => {
    const [r, g, b] = hexToRgb(accent)
    return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#1d1d1f' : '#ffffff'
  })()

  const surfaceGlass = (base: string, a: number) => {
    if (theme.mode === 'light') return `rgba(255, 255, 255, ${a})`
    const [r, g, b] = base.split(',').map((n) => parseInt(n.trim(), 10))
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  const shadowColor = theme.mode === 'light' ? '0, 0, 0' : '0, 0, 0'

  return {
    // surfaces
    '--ui-bg': p.bg,
    '--ui-bg-deep': p.bgDeep,
    '--ui-surface': p.surface,
    '--ui-surface-2': p.surface2,
    '--ui-surface-3': p.surface3,
    '--ui-window': s.glass === 0 ? (theme.mode === 'light' ? '#f2f3f6' : '#1e1e21') : p.window,
    '--ui-window-idle': p.windowIdle,
    '--ui-content': surfaceGlass(p.glassBase, Math.min(0.96, glassAlpha + 0.16)),
    // glass (macOS vibrancy: modest saturation, strong blur)
    '--ui-glass': surfaceGlass(p.glassBase, glassAlpha * 0.92),
    '--ui-glass-2': surfaceGlass(p.glassBase, Math.min(1, glassAlpha + 0.1)),
    '--ui-glass-border': theme.mode === 'light' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.1)',
    '--ui-glass-highlight': theme.mode === 'light' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.06)',
    '--ui-blur': `${blur}px`,
    '--ui-blur-strong': `${Math.round(blur * 1.5)}px`,
    '--ui-saturate': s.glass === 0 ? '100%' : '120%',
    // borders
    '--ui-border': p.border,
    '--ui-border-strong': p.borderStrong,
    '--ui-border-hover': p.borderHover,
    '--ui-hairline': p.hairline,
    // text
    '--ui-text': p.text,
    '--ui-text-2': p.text2,
    '--ui-text-3': p.text3,
    '--ui-text-faint': p.textFaint,
    // accent + status (single restrained accent; quiet focus ring)
    '--ui-accent': accent,
    '--ui-accent-rgb': accentRgb,
    '--ui-accent-soft': `rgba(${accentRgb}, 0.12)`,
    '--ui-accent-softer': `rgba(${accentRgb}, 0.08)`,
    '--ui-accent-strong': mix(accent, theme.mode === 'light' ? '#ffffff' : '#000000', 0.12),
    '--ui-on-accent': s.accent ? onAccentLuma : p.onAccent,
    '--ui-success': p.success,
    '--ui-success-rgb': hexToRgb(p.success).join(', '),
    '--ui-warning': p.warning,
    '--ui-warning-rgb': hexToRgb(p.warning).join(', '),
    '--ui-danger': p.danger,
    '--ui-danger-rgb': hexToRgb(p.danger).join(', '),
    '--ui-info': p.info,
    '--ui-info-rgb': hexToRgb(p.info).join(', '),
    // radius (macOS: small, consistent, never pill-everything)
    '--ui-radius-xs': '4px',
    '--ui-radius-sm': '6px',
    '--ui-radius-md': '8px',
    '--ui-radius-lg': '10px',
    '--ui-radius-xl': '14px',
    '--ui-radius-2xl': '20px',
    '--ui-radius-full': '999px',
    // elevation (soft, neutral — no coloured glows)
    '--ui-shadow-1': `0 1px 2px rgba(${shadowColor}, 0.08), 0 2px 6px rgba(${shadowColor}, 0.06)`,
    '--ui-shadow-2': `0 4px 12px rgba(${shadowColor}, 0.10), 0 1px 3px rgba(${shadowColor}, 0.08)`,
    '--ui-shadow-3': `0 12px 32px rgba(${shadowColor}, 0.16), 0 4px 12px rgba(${shadowColor}, 0.10)`,
    '--ui-glow': `0 0 0 3px rgba(${accentRgb}, 0.25)`,
    '--ui-glow-soft': `0 0 0 3px rgba(${accentRgb}, 0.12)`,
    // typography (SF first, system fallbacks)
    '--ui-font':
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    '--ui-font-mono':
      "'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
    '--ui-fs-xs': `${(11 * density.fs).toFixed(1)}px`,
    '--ui-fs-sm': `${(12.5 * density.fs).toFixed(1)}px`,
    '--ui-fs-md': `${(13 * density.fs).toFixed(1)}px`,
    '--ui-fs-lg': `${(15 * density.fs).toFixed(1)}px`,
    '--ui-fs-xl': `${(17 * density.fs).toFixed(1)}px`,
    '--ui-fs-2xl': `${(21 * density.fs).toFixed(1)}px`,
    '--ui-fs-3xl': `${(28 * density.fs).toFixed(1)}px`,
    '--ui-tracking': '0',
    '--ui-tracking-wide': '0.02em',
    // spacing / sizing
    '--ui-unit': `${density.unit}`,
    '--ui-space': `${(8 * density.unit).toFixed(2)}px`,
    '--ui-space-2': `${(16 * density.unit).toFixed(2)}px`,
    '--ui-space-3': `${(24 * density.unit).toFixed(2)}px`,
    '--ui-control-h': `${density.control}px`,
    '--ui-titlebar-h': `${Math.round(density.control * 1.14)}px`,
    // motion (calm, macOS-like)
    '--ui-dur-fast': '100ms',
    '--ui-dur': '160ms',
    '--ui-dur-slow': '260ms',
    '--ui-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
    '--ui-ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
    '--ui-ease-spring': 'cubic-bezier(0.3, 1.2, 0.4, 1)',
    // legacy aliases (older markup still reads these)
    '--bg-deep': p.bg,
    '--bg-surface': p.surface,
    '--bg-elevated': p.surface2,
    '--bg-overlay': p.surface3,
    '--border-subtle': p.border,
    '--border-medium': p.borderStrong,
    '--border-strong': p.borderHover,
    '--text-primary': p.text,
    '--text-secondary': p.text2,
    '--text-muted': p.text3,
    '--accent': accent,
    '--accent-dim': `rgba(${accentRgb}, 0.12)`,
    '--danger': p.danger,
    '--warning': p.warning,
    '--success': p.success,
    '--radius-sm': '6px',
    '--radius-md': '8px',
    '--radius-lg': '10px',
    '--radius-xl': '14px',
    '--shadow-window': `0 12px 32px rgba(${shadowColor}, 0.16), 0 4px 12px rgba(${shadowColor}, 0.10)`,
    '--shadow-dropdown': `0 12px 32px rgba(${shadowColor}, 0.16)`,
    '--shadow-card': `0 4px 12px rgba(${shadowColor}, 0.10)`,
    '--scrollbar-track': 'transparent',
    '--scrollbar-thumb': p.borderStrong,
    '--scrollbar-thumb-hover': p.borderHover,
    // metadata for component logic
    '--ui-mode': theme.mode,
  }
}
