/**
 * Single source of truth for the CyberManju OS design language.
 *
 * Fifteen themes in three families — System neutrals, Pastel brights,
 * Neon nights — and each theme is a FULL design language, not a palette
 * swap: `design.shape` drives the whole corner-radius scale, `design.font`
 * drives the OS typeface + label tracking, `design.elevation` drives the
 * shadow/glow character and wallpaper ambience. Components never hardcode
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
  | 'matrix-night'
  | 'cyberpunk-night'
export type Density = 'compact' | 'comfortable'
export type MotionPref = 'auto' | 'full' | 'reduced'
/** 0 = solid (no blur) · 1 = light vibrancy · 2 = default vibrancy · 3 = rich vibrancy */
export type GlassLevel = 0 | 1 | 2 | 3
/**
 * Shape language — the corner-radius scale of the whole OS. `soft` is the
 * macOS look (small, consistent), `round` is friendly/pill-forward,
 * `sharp` is the terminal/brutalist look (near-square).
 */
export type ThemeShape = 'soft' | 'round' | 'sharp'
/** Typographic personality of the whole OS chrome. */
export type ThemeFont = 'system' | 'rounded' | 'mono'
/**
 * Elevation character — how windows lift off the wallpaper. `soft` is the
 * neutral macOS drop shadow, `flat` is near-shadowless (graphite/minimal),
 * `neon` tints the ambient shadow + focus rings with the accent colour.
 */
export type ThemeElevation = 'soft' | 'flat' | 'neon'

export interface ThemeDesign {
  shape: ThemeShape
  font: ThemeFont
  elevation: ThemeElevation
}

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
  /** One-line personality shown in the Settings picker tooltip. */
  blurb: string
  mode: 'dark' | 'light'
  palette: ThemePalette
  design: ThemeDesign
}

export interface ThemeSettings {
  theme: ThemeId
  /** Accent override — any hex colour, defaults to the theme accent. */
  accent: string | null
  /**
   * Per-theme accent overrides (`{ [themeId]: '#hex' }`) — set from cybsh
   * via `ui accent <#hex> --for <theme>`. The general `accent` above wins
   * when set; otherwise the active theme's entry wins; otherwise the
   * theme's built-in accent.
   */
  accents: Record<string, string>
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

/** Picker grouping — system neutrals first, then the pastel brights, then the neon nights. */
export const THEME_GROUPS: { id: string; label: string; ids: ThemeId[] }[] = [
  { id: 'system', label: 'System', ids: ['mac-light', 'mac-dark', 'mac-graphite-light', 'mac-graphite-dark', 'mac-midnight'] },
  { id: 'pastel-light', label: 'Pastel · Light', ids: ['ocean-light', 'sunset-light', 'forest-light', 'lavender-light', 'rose-light'] },
  { id: 'neon-night', label: 'Neon · Night', ids: ['ocean-night', 'forest-night', 'ember-night', 'nebula-night', 'cyber-night', 'matrix-night', 'cyberpunk-night'] },
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
  'matrix-night',
  'cyberpunk-night',
]

/**
 * Corner-radius scales per shape language. Every component reads the
 * `--ui-radius-*` variables, so switching shape restyles all windows,
 * cards, buttons, inputs and badges at once.
 */
export const SHAPE_RADII: Record<ThemeShape, { xs: string; sm: string; md: string; lg: string; xl: string; x2: string; full: string }> = {
  soft: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '14px', x2: '20px', full: '999px' },
  round: { xs: '6px', sm: '10px', md: '14px', lg: '18px', xl: '24px', x2: '30px', full: '999px' },
  sharp: { xs: '1px', sm: '2px', md: '3px', lg: '4px', xl: '6px', x2: '8px', full: '4px' },
}

/** UI typeface stacks per typographic personality (system fonts only — no webfont dependency). */
export const FONT_STACKS: Record<ThemeFont, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  rounded:
    "'ui-rounded', 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono:
    "'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
}

/** Label/title letter-spacing per personality — mono chrome tracks wide. */
export const FONT_TRACKING_WIDE: Record<ThemeFont, string> = {
  system: '0.02em',
  rounded: '0.03em',
  mono: '0.09em',
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'mac-light': {
    id: 'mac-light',
    label: 'Light',
    blurb: 'macOS light · soft shapes · quiet depth',
    mode: 'light',
    design: { shape: 'soft', font: 'system', elevation: 'soft' },
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
    blurb: 'macOS dark · soft shapes · quiet depth',
    mode: 'dark',
    design: { shape: 'soft', font: 'system', elevation: 'soft' },
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
    blurb: 'Monochrome light · flat, shadowless chrome',
    mode: 'light',
    design: { shape: 'soft', font: 'system', elevation: 'flat' },
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
    blurb: 'Monochrome dark · flat, shadowless chrome',
    mode: 'dark',
    design: { shape: 'soft', font: 'system', elevation: 'flat' },
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
    blurb: 'True-black OLED · round shapes · deep float',
    mode: 'dark',
    design: { shape: 'round', font: 'system', elevation: 'soft' },
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
    blurb: 'Pastel blue · round shapes · rounded type',
    mode: 'light',
    design: { shape: 'round', font: 'rounded', elevation: 'soft' },
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
    blurb: 'Pastel ember · round shapes · rounded type',
    mode: 'light',
    design: { shape: 'round', font: 'rounded', elevation: 'soft' },
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
    blurb: 'Pastel green · round shapes · rounded type',
    mode: 'light',
    design: { shape: 'round', font: 'rounded', elevation: 'soft' },
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
    blurb: 'Pastel violet · round shapes · rounded type',
    mode: 'light',
    design: { shape: 'round', font: 'rounded', elevation: 'soft' },
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
    blurb: 'Pastel rose · round shapes · rounded type',
    mode: 'light',
    design: { shape: 'round', font: 'rounded', elevation: 'soft' },
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
    blurb: 'Abyssal blue · neon glow · deep float',
    mode: 'dark',
    design: { shape: 'round', font: 'system', elevation: 'neon' },
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
    blurb: 'Phosphor green · neon glow · soft shapes',
    mode: 'dark',
    design: { shape: 'soft', font: 'system', elevation: 'neon' },
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
    blurb: 'Furnace orange · neon glow · round shapes',
    mode: 'dark',
    design: { shape: 'round', font: 'system', elevation: 'neon' },
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
    blurb: 'Ultraviolet · neon glow · round shapes',
    mode: 'dark',
    design: { shape: 'round', font: 'system', elevation: 'neon' },
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
    blurb: 'Terminal deck · sharp chrome · mono type · neon',
    mode: 'dark',
    design: { shape: 'sharp', font: 'mono', elevation: 'neon' },
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
  'matrix-night': {
    id: 'matrix-night',
    label: 'Matrix',
    blurb: 'Phosphor terminal · sharp chrome · mono · neon',
    mode: 'dark',
    design: { shape: 'sharp', font: 'mono', elevation: 'neon' },
    palette: {
      bg: '#04140a',
      bgDeep: '#020b05',
      surface: 'rgba(10, 46, 26, 0.72)',
      surface2: 'rgba(14, 60, 34, 0.80)',
      surface3: 'rgba(20, 78, 44, 0.88)',
      window: 'rgba(4, 18, 10, 0.80)',
      windowIdle: 'rgba(4, 18, 10, 0.68)',
      border: 'rgba(0, 255, 128, 0.16)',
      borderStrong: 'rgba(0, 255, 128, 0.28)',
      borderHover: 'rgba(0, 255, 128, 0.44)',
      hairline: 'rgba(0, 255, 128, 0.10)',
      text: '#d8ffe6',
      text2: '#93cfa8',
      text3: '#5d9070',
      textFaint: '#33573f',
      accent: '#00ff80',
      onAccent: '#02120a',
      success: '#00ff80',
      warning: '#ffd60a',
      danger: '#ff5d5d',
      info: '#4ade80',
      glassBase: '10, 46, 26',
    },
  },
  'cyberpunk-night': {
    id: 'cyberpunk-night',
    label: 'Cyberpunk',
    blurb: 'AMOLED black · purple-red neon glass · high contrast',
    mode: 'dark',
    design: { shape: 'sharp', font: 'mono', elevation: 'neon' },
    palette: {
      bg: '#000000',
      bgDeep: '#0d0209',
      surface: 'rgba(52, 8, 60, 0.66)',
      surface2: 'rgba(66, 10, 76, 0.74)',
      surface3: 'rgba(84, 14, 96, 0.82)',
      window: 'rgba(0, 0, 0, 0.82)',
      windowIdle: 'rgba(0, 0, 0, 0.72)',
      border: 'rgba(255, 45, 120, 0.26)',
      borderStrong: 'rgba(255, 45, 120, 0.40)',
      borderHover: 'rgba(191, 90, 242, 0.60)',
      hairline: 'rgba(255, 45, 120, 0.14)',
      text: '#ffffff',
      text2: '#f3dcff',
      text3: '#c49ad9',
      textFaint: '#7d5c8c',
      accent: '#ff2d78',
      onAccent: '#1c020c',
      success: '#00ffa3',
      warning: '#ffd60a',
      danger: '#ff3b30',
      info: '#bf5af2',
      glassBase: '52, 8, 60',
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
  accents: {},
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
  const hexOk = (v: unknown): v is string =>
    typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
  // General accent wins, then the active theme's per-theme entry, then the
  // theme's built-in accent — so cybsh can recolor one theme or everything.
  const generalAccent = hexOk(s.accent) ? s.accent : null
  const themeAccent = hexOk(s.accents?.[s.theme]) ? (s.accents[s.theme] as string) : null
  const accent = generalAccent ?? themeAccent ?? p.accent
  const customAccent = generalAccent ?? themeAccent
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
  const radii = SHAPE_RADII[theme.design.shape]

  // Elevation character: flat themes barely lift, neon themes bleed accent
  // light into the ambient shadow + focus rings, soft themes stay neutral.
  const elevation = theme.design.elevation
  const shadow = {
    soft: {
      s1: `0 1px 2px rgba(${shadowColor}, 0.08), 0 2px 6px rgba(${shadowColor}, 0.06)`,
      s2: `0 4px 12px rgba(${shadowColor}, 0.10), 0 1px 3px rgba(${shadowColor}, 0.08)`,
      s3: `0 12px 32px rgba(${shadowColor}, 0.16), 0 4px 12px rgba(${shadowColor}, 0.10)`,
      glow: `0 0 0 3px rgba(${accentRgb}, 0.25)`,
      glowSoft: `0 0 0 3px rgba(${accentRgb}, 0.12)`,
    },
    flat: {
      s1: `0 1px 2px rgba(${shadowColor}, 0.06)`,
      s2: `0 2px 6px rgba(${shadowColor}, 0.07)`,
      s3: `0 6px 16px rgba(${shadowColor}, 0.10)`,
      glow: `0 0 0 3px rgba(${accentRgb}, 0.25)`,
      glowSoft: `0 0 0 3px rgba(${accentRgb}, 0.12)`,
    },
    neon: {
      s1: `0 1px 2px rgba(${shadowColor}, 0.10), 0 2px 14px rgba(${accentRgb}, 0.14)`,
      s2: `0 4px 12px rgba(${shadowColor}, 0.14), 0 2px 26px rgba(${accentRgb}, 0.18)`,
      s3: `0 12px 32px rgba(${shadowColor}, 0.20), 0 0 36px rgba(${accentRgb}, 0.24)`,
      glow: `0 0 0 3px rgba(${accentRgb}, 0.38), 0 0 18px rgba(${accentRgb}, 0.25)`,
      glowSoft: `0 0 0 3px rgba(${accentRgb}, 0.22), 0 0 12px rgba(${accentRgb}, 0.14)`,
    },
  }[elevation]

  // Wallpaper ambience follows the theme: neon nights tint the aurora with
  // accent light, flat themes stay pure, soft themes get a whisper of tint.
  const auroraAlpha: [number, number] =
    elevation === 'neon' ? [0.20, 0.12] : elevation === 'flat' ? [0, 0] : [0.07, 0.05]

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
    '--ui-on-accent': customAccent ? onAccentLuma : p.onAccent,
    '--ui-success': p.success,
    '--ui-success-rgb': hexToRgb(p.success).join(', '),
    '--ui-warning': p.warning,
    '--ui-warning-rgb': hexToRgb(p.warning).join(', '),
    '--ui-danger': p.danger,
    '--ui-danger-rgb': hexToRgb(p.danger).join(', '),
    '--ui-info': p.info,
    '--ui-info-rgb': hexToRgb(p.info).join(', '),
    // radius (shape language per theme — soft macOS, round pastel, sharp terminal)
    '--ui-radius-xs': radii.xs,
    '--ui-radius-sm': radii.sm,
    '--ui-radius-md': radii.md,
    '--ui-radius-lg': radii.lg,
    '--ui-radius-xl': radii.xl,
    '--ui-radius-2xl': radii.x2,
    '--ui-radius-full': radii.full,
    // elevation (shadow + glow character per theme)
    '--ui-shadow-1': shadow.s1,
    '--ui-shadow-2': shadow.s2,
    '--ui-shadow-3': shadow.s3,
    '--ui-glow': shadow.glow,
    '--ui-glow-soft': shadow.glowSoft,
    // wallpaper ambience (accent-tinted aurora washes)
    '--ui-aurora-a': `rgba(${accentRgb}, ${auroraAlpha[0]})`,
    '--ui-aurora-b': `rgba(${accentRgb}, ${auroraAlpha[1]})`,
    // typography (typeface personality per theme + density-scaled sizes)
    '--ui-font': FONT_STACKS[theme.design.font],
    '--ui-font-mono':
      "'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
    '--ui-fs-xs': `${(11 * density.fs).toFixed(1)}px`,
    '--ui-fs-sm': `${(12.5 * density.fs).toFixed(1)}px`,
    '--ui-fs-md': `${(13 * density.fs).toFixed(1)}px`,
    '--ui-fs-lg': `${(15 * density.fs).toFixed(1)}px`,
    '--ui-fs-xl': `${(17 * density.fs).toFixed(1)}px`,
    '--ui-fs-2xl': `${(21 * density.fs).toFixed(1)}px`,
    '--ui-fs-3xl': `${(28 * density.fs).toFixed(1)}px`,
    '--ui-tracking': theme.design.font === 'mono' ? '0.02em' : '0',
    '--ui-tracking-wide': FONT_TRACKING_WIDE[theme.design.font],
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
    '--radius-sm': radii.sm,
    '--radius-md': radii.md,
    '--radius-lg': radii.lg,
    '--radius-xl': radii.xl,
    '--shadow-window': shadow.s3,
    '--shadow-dropdown': shadow.s2,
    '--shadow-card': shadow.s1,
    '--scrollbar-track': 'transparent',
    '--scrollbar-thumb': p.borderStrong,
    '--scrollbar-thumb-hover': p.borderHover,
    // metadata for component logic
    '--ui-mode': theme.mode,
  }
}
