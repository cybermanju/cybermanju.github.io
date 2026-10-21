// CyberManju OS — Tokens (src/ui/tokens.ts).
/**
 * Single source of truth for the CyberManju OS design language.
 *
 * System appearance presets, the Plasma pair, Modern Glass and Flat AMOLED.
 * Glass belongs to navigation/chrome; body text always has a solid surface.
 * `auto` is resolved in `useTheme()` from the OS `prefers-color-scheme`
 * media query, not a theme id.
 *
 * There is ONE geometry, ONE typeface and NO elevation axis:
 * - radius: window 12 · menu/popover 10 · control 6 · chip/badge 4
 * - type: SF system stack, 13px body / 11px caption, 400/500/600,
 *   sentence case. Mono is reserved for paths, hashes and the terminal.
 * - depth: flat, no glow. One soft window shadow + a 0.5px outline.
 *
 * Glass is allowed ONLY on chrome (menu bar, dock, sidebar, titlebar,
 * menus, popovers, sheets) — never behind body text. Content surfaces are
 * flat solids (#000 / #fff).
 *
 * Contrast (documented, enforced by tests/frontend/ui-theme.test.ts):
 * - os-dark: text #F5F5F7 on #000000 ≈ 19.3:1 · text-2 .62 alpha ≈ 7.5:1
 * - os-light: text #1D1D1F on #FFFFFF ≈ 16.0:1 · text-2 .80 alpha ≈ 5.0:1
 * - plasma-dark: text #eff0f1 on #232629 ≈ 13.3:1 · text-2 #bdc3c7 ≈ 8.5:1 ·
 *   accent #3daee9 ≈ 6.1:1 · on-accent #232629 ≈ 6.1:1
 * - plasma-light: text #232629 on #fcfcfc ≈ 14.8:1 · text-2 #4d5559 ≈ 7.4:1 ·
 *   accent #178dc2 ≈ 3.6:1 (surface) · on-accent #ffffff ≈ 3.7:1
 * - accent on bg ≥ 3:1 every theme (large/bold + graphical objects)
 * - text-3 is decorative/disabled ONLY and is exempt by design.
 *
 * Back-compat: the old 17-theme ids, the `design.*` axes and the glow /
 * aurora / neon variables are kept as DEPRECATED aliases that resolve to
 * the new system, so existing markup and tests keep compiling while the
 * visuals collapse to the single design language.
 */

export type ThemeId =
  | 'os-dark'
  | 'os-light'
  | 'os-graphite'
  | 'plasma-dark'
  | 'plasma-light'
  | 'modern-glass'
  | 'flat-amoled'

/**
 * Shell style — orthogonal to the theme. `macos` is the menu-bar + floating
 * Dock look; `plasma` is the bottom-panel + Kickoff look (Kubuntu/Breeze).
 * Structure switches via `[data-ui-shell]`; tokens switch via the theme.
 */
export type ShellStyle = 'macos' | 'plasma'
export type Density = 'compact' | 'comfortable'
export type MotionPref = 'auto' | 'full' | 'reduced'
/** 0 = solid (no blur) · 2 = translucent (blur 40). Levels 1/3 map to 2. */
export type GlassLevel = 0 | 1 | 2 | 3
/**
 * @deprecated Single geometry now — every theme resolves to `soft`.
 * Kept so `def.design.shape` type-checks in existing code.
 */
export type ThemeShape = 'soft' | 'round' | 'sharp'
/**
 * @deprecated Single typeface now — every theme resolves to `system`.
 * `mono` survives only as `--ui-font-mono` for paths/hashes/terminal.
 */
export type ThemeFont = 'system' | 'rounded' | 'mono'
/**
 * @deprecated No elevation axis — depth is one flat shadow + 0.5px outline.
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
  /** Solid content surface (file grid, panels). */
  surface: string
  /** Solid inputs / cards. */
  surface2: string
  /** Raised / hovered card base. */
  surface3: string
  /** Translucent chrome: titlebar + window body (glass). */
  window: string
  /** Translucent chrome at rest (non-focused windows). */
  windowIdle: string
  /** Translucent chrome: sidebar / menu bar. */
  sidebar: string
  /** Bottom panel surface (plasma shell; macOS themes reuse window). */
  panel: string
  /** Hover wash (accent 15%) for rows, tabs and task buttons. */
  hover: string
  /** Solid terminal surface (Konsole black in dark modes, paper in light). */
  terminal: string
  border: string
  borderStrong: string
  borderHover: string
  hairline: string
  /** 0.5px separator line colour (titlebar bottom, section dividers). */
  separator: string
  text: string
  text2: string
  /** Decorative / disabled ONLY — not for readable body text. */
  text3: string
  textFaint: string
  accent: string
  /** Text/icon colour that always contrasts with `accent`. */
  onAccent: string
  success: string
  warning: string
  danger: string
  info: string
  /** Base RGB (no alpha) used for vibrancy tints. */
  glassBase: string
}

export interface ThemeDefinition {
  id: ThemeId
  label: string
  /** One-line personality shown in the Settings picker tooltip. */
  blurb: string
  mode: 'dark' | 'light'
  palette: ThemePalette
  /** @deprecated Always the single fixed geometry — kept for compat. */
  design: ThemeDesign
}

export interface ThemeSettings {
  theme: ThemeId
  /**
   * Shell style override consumed by `buildCssVars()` for geometry tokens
   * (titlebar/panel heights, radius, motion). The live source of truth is
   * `useTheme().shellStyle` (own storage key); it mirrors here for CSS.
   */
  shell?: ShellStyle
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
  /**
   * Follow the OS colour scheme (`prefers-color-scheme`). When true the
   * stored `theme` is only a fallback — the effective theme tracks the OS.
   */
  followSystem: boolean
  /** Static wallpaper id (`slopes-dark` | `slopes-light` | `dunes`). */
  wallpaper: string
  /** Wallpaper ambience — legacy flag, no aurora is rendered anymore. */
  glow: boolean
}

/**
 * Every pre-remake theme id maps onto its closest successor by mode.
 * Old installs keep resolving exactly as before (dark → os-dark,
 * light → os-light).
 */
export const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  midnight: 'os-dark',
  nebula: 'os-dark',
  ember: 'os-dark',
  daylight: 'os-light',
  ghostline: 'os-dark',
  'mac-light': 'os-light',
  'mac-dark': 'os-dark',
  'mac-graphite-light': 'os-light',
  'mac-graphite-dark': 'os-graphite',
  'mac-midnight': 'os-dark',
  'ocean-light': 'os-light',
  'sunset-light': 'os-light',
  'forest-light': 'os-light',
  'lavender-light': 'os-light',
  'rose-light': 'os-light',
  'ocean-night': 'os-dark',
  'forest-night': 'os-dark',
  'ember-night': 'os-dark',
  'nebula-night': 'os-dark',
  'cyber-night': 'os-dark',
  'matrix-night': 'os-dark',
  'cyberpunk-night': 'os-dark',
}

/** Picker grouping — flat macOS set plus the Breeze-like Plasma set. */
export const THEME_GROUPS: { id: string; label: string; ids: ThemeId[] }[] = [
  { id: 'appearance', label: 'Appearance', ids: ['os-dark', 'os-light', 'os-graphite'] },
  { id: 'personal', label: 'Personal', ids: ['modern-glass', 'flat-amoled'] },
  { id: 'plasma', label: 'Plasma', ids: ['plasma-dark', 'plasma-light'] },
]

export const THEME_IDS: ThemeId[] = [
  'os-dark',
  'os-light',
  'os-graphite',
  'plasma-dark',
  'plasma-light',
  'modern-glass',
  'flat-amoled',
]

/**
 * Single corner-radius scale for the whole OS. Window 12 · menu/popover 10
 * · control 6 · chip/badge 4. `full` stays pill-shaped for dots/toggles.
 */
export const SHAPE_RADII: Record<ThemeShape, { xs: string; sm: string; md: string; lg: string; xl: string; x2: string; full: string }> = {
  soft: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '12px', x2: '14px', full: '999px' },
  round: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '12px', x2: '14px', full: '999px' },
  sharp: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '12px', x2: '14px', full: '999px' },
}

/** Single UI typeface stack (SF-first, system fonts only — no webfont dependency). */
const SYSTEM_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** @deprecated All personalities resolve to the system stack. */
export const FONT_STACKS: Record<ThemeFont, string> = {
  system: SYSTEM_STACK,
  rounded: SYSTEM_STACK,
  mono: SYSTEM_STACK,
}

/** Sentence case everywhere — no wide tracked labels. */
export const FONT_TRACKING_WIDE: Record<ThemeFont, string> = {
  system: '0.01em',
  rounded: '0.01em',
  mono: '0.01em',
}

const SINGLE_DESIGN: ThemeDesign = { shape: 'soft', font: 'system', elevation: 'soft' }

const SYSTEM_THEMES: Record<Exclude<ThemeId, 'modern-glass' | 'flat-amoled'>, ThemeDefinition> = {
  'os-dark': {
    id: 'os-dark',
    label: 'Dark',
    blurb: 'True AMOLED black · flat glass chrome · system blue',
    mode: 'dark',
    design: SINGLE_DESIGN,
    palette: {
      bg: '#000000',
      bgDeep: '#000000',
      surface: '#0B0B0D',
      surface2: '#161618',
      surface3: '#1C1C1E',
      window: 'rgba(28, 28, 30, 0.78)',
      windowIdle: 'rgba(22, 22, 24, 0.70)',
      sidebar: 'rgba(30, 30, 32, 0.55)',
      panel: 'rgba(28, 28, 30, 0.78)',
      hover: 'rgba(10, 132, 255, 0.15)',
      border: 'rgba(255, 255, 255, 0.10)',
      borderStrong: 'rgba(255, 255, 255, 0.16)',
      borderHover: 'rgba(255, 255, 255, 0.24)',
      hairline: 'rgba(255, 255, 255, 0.08)',
      separator: 'rgba(255, 255, 255, 0.08)',
      text: '#F5F5F7',
      text2: 'rgba(235, 235, 245, 0.62)',
      text3: 'rgba(235, 235, 245, 0.38)',
      textFaint: 'rgba(235, 235, 245, 0.28)',
      accent: '#0A84FF',
      onAccent: '#ffffff',
      success: '#32D74B',
      warning: '#FF9F0A',
      danger: '#FF453A',
      info: '#64D2FF',
      terminal: '#000000',
      glassBase: '28, 28, 30',
    },
  },
  'os-light': {
    id: 'os-light',
    label: 'Light',
    blurb: 'Paper white · flat glass chrome · system blue',
    mode: 'light',
    design: SINGLE_DESIGN,
    palette: {
      bg: '#ECECEC',
      bgDeep: '#E2E2E4',
      surface: '#FFFFFF',
      surface2: '#F5F5F7',
      surface3: '#E8E8EA',
      window: 'rgba(246, 246, 246, 0.80)',
      windowIdle: 'rgba(240, 240, 242, 0.72)',
      sidebar: 'rgba(236, 236, 236, 0.70)',
      panel: 'rgba(246, 246, 246, 0.80)',
      hover: 'rgba(0, 122, 255, 0.15)',
      border: 'rgba(0, 0, 0, 0.12)',
      borderStrong: 'rgba(0, 0, 0, 0.18)',
      borderHover: 'rgba(0, 0, 0, 0.26)',
      hairline: 'rgba(0, 0, 0, 0.08)',
      separator: 'rgba(0, 0, 0, 0.08)',
      text: '#1D1D1F',
      text2: 'rgba(60, 60, 67, 0.80)',
      text3: 'rgba(60, 60, 67, 0.45)',
      textFaint: 'rgba(60, 60, 67, 0.30)',
      accent: '#007AFF',
      onAccent: '#ffffff',
      success: '#248A3D',
      warning: '#B25000',
      danger: '#D70015',
      info: '#0071E3',
      terminal: '#FFFFFF',
      glassBase: '246, 246, 246',
    },
  },
  'os-graphite': {
    id: 'os-graphite',
    label: 'Graphite',
    blurb: 'Monochrome dark · flat chrome · grey accent',
    mode: 'dark',
    design: SINGLE_DESIGN,
    palette: {
      bg: '#000000',
      bgDeep: '#0A0A0C',
      surface: '#101012',
      surface2: '#17171A',
      surface3: '#202024',
      window: 'rgba(24, 24, 26, 0.78)',
      windowIdle: 'rgba(18, 18, 20, 0.70)',
      sidebar: 'rgba(26, 26, 28, 0.60)',
      panel: 'rgba(24, 24, 26, 0.78)',
      hover: 'rgba(142, 142, 147, 0.15)',
      border: 'rgba(255, 255, 255, 0.10)',
      borderStrong: 'rgba(255, 255, 255, 0.16)',
      borderHover: 'rgba(255, 255, 255, 0.24)',
      hairline: 'rgba(255, 255, 255, 0.08)',
      separator: 'rgba(255, 255, 255, 0.08)',
      text: '#F5F5F7',
      text2: 'rgba(235, 235, 245, 0.62)',
      text3: 'rgba(235, 235, 245, 0.38)',
      textFaint: 'rgba(235, 235, 245, 0.28)',
      accent: '#8E8E93',
      onAccent: '#000000',
      success: '#32D74B',
      warning: '#FF9F0A',
      danger: '#FF453A',
      info: '#8E8E93',
      terminal: '#000000',
      glassBase: '24, 24, 26',
    },
  },
  'plasma-dark': {
    id: 'plasma-dark',
    label: 'Plasma Dark',
    blurb: 'Breeze dark · flat panel chrome · breeze blue',
    mode: 'dark',
    design: SINGLE_DESIGN,
    palette: {
      bg: '#1b1e20',
      bgDeep: '#14171a',
      surface: '#232629',
      surface2: '#2a2e32',
      surface3: '#31363b',
      window: '#31363b',
      windowIdle: '#2a2e32',
      sidebar: '#2a2e32',
      panel: 'rgba(35, 38, 41, 0.88)',
      hover: 'rgba(61, 174, 233, 0.15)',
      border: '#4d4d4d',
      borderStrong: '#636363',
      borderHover: '#7a7a7a',
      hairline: 'rgba(255, 255, 255, 0.06)',
      separator: 'rgba(255, 255, 255, 0.08)',
      text: '#eff0f1',
      text2: '#bdc3c7',
      text3: '#7f8c8d',
      textFaint: '#5c6666',
      accent: '#3daee9',
      onAccent: '#232629',
      success: '#27ae60',
      warning: '#f67400',
      danger: '#da4453',
      info: '#3daee9',
      terminal: '#000000',
      glassBase: '49, 54, 59',
    },
  },
  'plasma-light': {
    id: 'plasma-light',
    label: 'Plasma Light',
    blurb: 'Breeze light · flat panel chrome · breeze blue',
    mode: 'light',
    design: SINGLE_DESIGN,
    palette: {
      bg: '#dcdfe3',
      bgDeep: '#c9ced4',
      surface: '#fcfcfc',
      surface2: '#f4f5f6',
      surface3: '#e6e8ea',
      window: '#eff0f1',
      windowIdle: '#e6e8ea',
      sidebar: '#e6e8ea',
      panel: 'rgba(239, 240, 241, 0.90)',
      hover: 'rgba(23, 141, 194, 0.15)',
      border: '#bdc3c7',
      borderStrong: '#a9b2b8',
      borderHover: '#8d979e',
      hairline: 'rgba(0, 0, 0, 0.08)',
      separator: 'rgba(0, 0, 0, 0.08)',
      text: '#232629',
      text2: '#4d5559',
      text3: '#7f8c8d',
      textFaint: '#a7b1b5',
      accent: '#178dc2',
      onAccent: '#ffffff',
      success: '#1e9e5a',
      warning: '#c25700',
      danger: '#b93a46',
      info: '#1893cc',
      terminal: '#fcfcfc',
      glassBase: '239, 240, 241',
    },
  },
}

// Keep independent presets without duplicating the unchanged semantic colours.
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  ...SYSTEM_THEMES,
  'modern-glass': {
    id: 'modern-glass',
    label: 'Modern Glass',
    blurb: 'Soft frosted chrome · cool blue light · clear, solid content',
    mode: 'dark',
    design: SINGLE_DESIGN,
    palette: {
      ...SYSTEM_THEMES['os-dark'].palette,
      bg: '#080D18', bgDeep: '#050810',
      surface: '#101722', surface2: '#172131', surface3: '#223044',
      window: 'rgba(23, 33, 49, 0.76)', windowIdle: 'rgba(18, 26, 39, 0.86)',
      sidebar: 'rgba(19, 29, 44, 0.82)', panel: 'rgba(19, 29, 44, 0.82)',
      border: 'rgba(212, 232, 255, 0.16)', borderStrong: 'rgba(212, 232, 255, 0.24)',
      borderHover: 'rgba(212, 232, 255, 0.36)', hairline: 'rgba(255, 255, 255, 0.16)',
      text: '#F5F8FF', text2: '#BAC8DC', accent: '#A8CFFF', onAccent: '#081321',
      hover: 'rgba(168, 207, 255, 0.12)', info: '#A8CFFF', glassBase: '23, 33, 49',
    },
  },
  'flat-amoled': {
    id: 'flat-amoled',
    label: 'Flat AMOLED',
    blurb: 'Slim, distraction-free launcher · white icons and names · pure black',
    mode: 'dark',
    design: SINGLE_DESIGN,
    palette: {
      ...SYSTEM_THEMES['os-dark'].palette,
      bg: '#000000', bgDeep: '#000000', surface: '#000000',
      surface2: '#0A0A0A', surface3: '#161616',
      window: '#000000', windowIdle: '#000000', sidebar: '#000000', panel: '#000000',
      text: '#FFFFFF', text2: '#B8B8B8', accent: '#FFFFFF', onAccent: '#000000',
      border: '#252525', borderStrong: '#404040', borderHover: '#707070',
      hover: 'rgba(255, 255, 255, 0.08)', info: '#FFFFFF', glassBase: '0, 0, 0',
    },
  },
}

export const ACCENT_CHOICES: { id: string; label: string; value: string }[] = [
  { id: 'default', label: 'System blue', value: '' },
  { id: 'blue', label: 'Blue', value: '#0A84FF' },
  { id: 'purple', label: 'Purple', value: '#AF52DE' },
  { id: 'pink', label: 'Pink', value: '#FF2D55' },
  { id: 'red', label: 'Red', value: '#FF3B30' },
  { id: 'orange', label: 'Orange', value: '#FF9F0A' },
  { id: 'yellow', label: 'Yellow', value: '#FFCC00' },
  { id: 'green', label: 'Green', value: '#32D74B' },
  { id: 'teal', label: 'Teal', value: '#5AC8FA' },
  { id: 'graphite', label: 'Graphite', value: '#8E8E93' },
]

export const DENSITY_SCALE: Record<Density, { unit: number; control: number; fs: number }> = {
  compact: { unit: 0.9, control: 24, fs: 0.96 },
  comfortable: { unit: 1, control: 28, fs: 1 },
}

export const DEFAULT_SETTINGS: ThemeSettings = {
  theme: 'os-dark',
  accent: null,
  accents: {},
  density: 'comfortable',
  glass: 2,
  motion: 'auto',
  followSystem: true,
  glow: false,
  wallpaper: 'slopes-dark',
}

/** Static wallpaper catalogue — original gradient artwork, no third-party assets. */
export const WALLPAPERS: { id: string; label: string }[] = [
  { id: 'slopes-dark', label: 'Dark slopes' },
  { id: 'slopes-light', label: 'Light slopes' },
  { id: 'dunes', label: 'Night dunes' },
]

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

/** Parse `#hex` or `rgba()/rgb()` into channels for contrast math. */
export function parseColor(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const [r, g, b] = hexToRgb(hex[1].length === 3 ? `#${hex[1]}` : `#${hex[1]}`)
    return [r, g, b, 1]
  }
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(color)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  return [0, 0, 0, 1]
}

/** Composite a translucent foreground over an opaque background. */
export function compositeOver(fg: string, bg: string): [number, number, number] {
  const [fr, fb, fbb, fa] = parseColor(fg)
  const [br, bgc, bb] = parseColor(bg)
  return [
    Math.round(fr * fa + br * (1 - fa)),
    Math.round(fb * fa + bgc * (1 - fa)),
    Math.round(fbb * fa + bb * (1 - fa)),
  ]
}

function channelLuma(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of an opaque rgb triple. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuma(r) + 0.7152 * channelLuma(g) + 0.0722 * channelLuma(b)
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Keep the saved hue; adjust only its readable text/focus rendering. */
function readableColor(color: string, surfaces: string[], target: string, minimum: number): string {
  const backgrounds = surfaces.map(hexToRgb)
  if (backgrounds.every(bg => contrastRatio(hexToRgb(color), bg) >= minimum)) return color
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(color, target, step / 100)
    if (backgrounds.every(bg => contrastRatio(hexToRgb(candidate), bg) >= minimum)) return candidate
  }
  return target
}

/** Actual fill, not the preset, determines readable button text. */
function textOnFill(fill: string): string {
  const bg = hexToRgb(fill)
  return contrastRatio([0, 0, 0], bg) >= contrastRatio([255, 255, 255], bg) ? '#000000' : '#ffffff'
}

/**
 * Build the full `--ui-*` custom property map for the active settings.
 * Flat single-language output: fixed radius scale, SF stack, one flat
 * shadow + 0.5px outline, glass ONLY on chrome surfaces.
 */
export function buildCssVars(s: ThemeSettings): Record<string, string> {
  const theme = THEMES[s.theme] ?? THEMES['os-dark']
  const p = theme.palette
  const flat = theme.id === 'flat-amoled'
  const modernGlass = theme.id === 'modern-glass'
  const hexOk = (v: unknown): v is string =>
    typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
  // General accent wins, then the active theme's per-theme entry, then the
  // theme's built-in accent.
  const generalAccent = hexOk(s.accent) ? s.accent : null
  const themeAccent = hexOk(s.accents?.[s.theme]) ? (s.accents[s.theme] as string) : null
  // Flat AMOLED stays monochrome without destroying the user's saved accents.
  const accent = flat ? p.accent : generalAccent ?? themeAccent ?? p.accent
  const [ar, ag, ab] = hexToRgb(accent)
  const accentRgb = `${ar}, ${ag}, ${ab}`
  const density = DENSITY_SCALE[s.density]
  const shell: ShellStyle = s.shell ?? 'macos'
  const plasma = shell === 'plasma'

  // Glass: solid (0) or translucent chrome. macOS blurs heavy (40px);
  // plasma keeps it moderate (20px, panel/popups only).
  const solid = flat || s.glass === 0
  const blur = solid ? 0 : plasma ? 20 : 40
  const saturate = solid ? '100%' : plasma ? '140%' : '180%'
  const contentSurfaces = [p.surface, p.surface2, p.surface3]
  const accentStrong = mix(accent, theme.mode === 'light' ? '#ffffff' : '#000000', 0.12)
  const accentText = readableColor(accent, contentSurfaces, p.text, 4.5)
  const focusColor = readableColor(accent, contentSurfaces, p.text, 3)

  // Flat depth: soft window shadow + outline. No glow, no neon.
  const shadowColor = '0, 0, 0'
  const shadowAlpha = theme.mode === 'light' ? [0.28, 0.18, 0.22] : [0.55, 0.35, 0.45]
  const shadowOutline = plasma ? `0 0 0 1px ${p.border}` : `0 0 0 0.5px ${p.border}`
  const shadowWindow = plasma
    ? `0 8px 28px rgba(${shadowColor}, 0.45), ${shadowOutline}`
    : `0 22px 70px rgba(${shadowColor}, ${shadowAlpha[0]}), ${shadowOutline}`
  const shadowWindowIdle = plasma
    ? `0 4px 14px rgba(${shadowColor}, 0.30), ${shadowOutline}`
    : `0 10px 30px rgba(${shadowColor}, ${shadowAlpha[1]}), ${shadowOutline}`
  const shadowMenu = plasma
    ? `0 6px 20px rgba(${shadowColor}, 0.40), ${shadowOutline}`
    : `0 8px 30px rgba(${shadowColor}, ${shadowAlpha[2]}), ${shadowOutline}`
  const focusRing = `0 0 0 ${plasma ? 2 : 3}px ${focusColor}`
  // Radius: macOS window 12 / menu 10 / control 6 / chip 4;
  // plasma window 6 / popup 6 / control 4 / chip 3.
  const radii = plasma
    ? { xs: '3px', sm: '4px', md: '6px', lg: '6px', xl: '6px', x2: '8px', full: '999px' }
    : SHAPE_RADII.soft

  const chromeBg = (v: string) => (solid ? p.surface : v)

  return {
    // surfaces — content is FLAT SOLID, chrome is translucent glass
    '--ui-bg': p.bg,
    '--ui-bg-deep': p.bgDeep,
    '--ui-surface': p.surface,
    '--ui-surface-2': p.surface2,
    '--ui-surface-3': p.surface3,
    '--ui-window': chromeBg(p.window),
    '--ui-window-idle': chromeBg(p.windowIdle),
    '--ui-sidebar': chromeBg(p.sidebar),
    '--ui-panel': solid ? p.surface : p.panel,
    '--ui-hover': p.hover,
    '--ui-terminal': p.terminal,
    '--ui-content': p.surface,
    // glass — single class system, chrome only
    '--ui-glass': chromeBg(p.window),
    '--ui-glass-2': chromeBg(p.window),
    '--ui-glass-border': p.border,
    '--ui-glass-highlight': p.hairline,
    '--ui-glass-sheen': modernGlass && !solid ? 'linear-gradient(135deg, rgba(255,255,255,.10), transparent 55%)' : 'none',
    // Static ambient light is shared by home and Search; never animate large
    // blurred layers or wash out reading surfaces with a second nested blur.
    '--ui-ambient-background': modernGlass
      ? `radial-gradient(ellipse 85% 72% at 8% 8%, rgba(${accentRgb}, .23), transparent 68%), radial-gradient(ellipse 75% 85% at 96% 40%, rgba(146, 118, 224, .16), transparent 70%), radial-gradient(ellipse 95% 65% at 48% 108%, rgba(44, 151, 164, .17), transparent 72%), linear-gradient(150deg, #101b2d, #070b15 70%)`
      : 'none',
    '--ui-glass-reading': modernGlass && !solid ? 'rgba(16, 23, 34, 0.88)' : p.surface,
    '--ui-glass-edge': modernGlass && !solid ? 'inset 0 1px 0 rgba(238, 246, 255, .16)' : 'inset 0 0 0 transparent',
    '--ui-glass-shadow': modernGlass && !solid ? '0 18px 52px rgba(0, 7, 18, .28), 0 3px 12px rgba(0, 7, 18, .14)' : '0 0 0 transparent',
    '--ui-blur': `${blur}px`,
    '--ui-blur-strong': `${blur}px`,
    '--ui-saturate': saturate,
    // borders
    '--ui-border': p.border,
    '--ui-border-strong': p.borderStrong,
    '--ui-border-hover': p.borderHover,
    '--ui-hairline': p.hairline,
    '--ui-separator': p.separator,
    // text — sentence case, solid, contrast-checked
    '--ui-text': p.text,
    '--ui-text-2': p.text2,
    '--ui-text-3': p.text3,
    '--ui-text-faint': p.textFaint,
    // accent + status — single system blue
    '--ui-accent': accent,
    '--ui-accent-rgb': accentRgb,
    '--ui-accent-soft': `rgba(${accentRgb}, 0.14)`,
    '--ui-accent-softer': `rgba(${accentRgb}, 0.08)`,
    '--ui-accent-strong': accentStrong,
    '--ui-accent-text': accentText,
    '--ui-focus-color': focusColor,
    '--ui-on-accent': textOnFill(accent),
    '--ui-on-accent-strong': textOnFill(accentStrong),
    '--ui-on-danger': textOnFill(p.danger),
    '--ui-danger-text': readableColor(p.danger, contentSurfaces, p.text, 4.5),
    '--ui-success-text': readableColor(p.success, contentSurfaces, p.text, 4.5),
    '--ui-warning-text': readableColor(p.warning, contentSurfaces, p.text, 4.5),
    '--ui-success': p.success,
    '--ui-success-rgb': hexToRgb(p.success).join(', '),
    '--ui-warning': p.warning,
    '--ui-warning-rgb': hexToRgb(p.warning).join(', '),
    '--ui-danger': p.danger,
    '--ui-danger-rgb': hexToRgb(p.danger).join(', '),
    '--ui-info': p.info,
    '--ui-info-rgb': hexToRgb(p.info).join(', '),
    // radius — one fixed scale
    '--ui-radius-xs': radii.xs,
    '--ui-radius-sm': radii.sm,
    '--ui-radius-md': radii.md,
    '--ui-radius-lg': radii.lg,
    '--ui-radius-xl': radii.xl,
    '--ui-radius-2xl': radii.x2,
    '--ui-radius-full': radii.full,
    // depth — flat shadows + focus ring (no glow)
    '--ui-shadow-window': flat ? 'none' : shadowWindow,
    '--ui-shadow-window-idle': flat ? 'none' : shadowWindowIdle,
    '--ui-shadow-menu': flat ? 'none' : shadowMenu,
    '--ui-shadow-popup': flat ? 'none' : shadowMenu,
    '--ui-focus-ring': focusRing,
    '--ui-shadow-1': flat ? 'none' : shadowWindowIdle,
    '--ui-shadow-2': flat ? 'none' : shadowMenu,
    '--ui-shadow-3': flat ? 'none' : shadowWindow,
    // deprecated glow/aurora — mapped to flat equivalents so old markup
    // renders without neon; do not use in new code.
    '--ui-glow': focusRing,
    '--ui-glow-soft': focusRing,
    '--ui-aurora-a': 'transparent',
    '--ui-aurora-b': 'transparent',
    // typography — SF stack, sentence case
    '--ui-font': SYSTEM_STACK,
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
    '--ui-tracking-wide': '0.01em',
    // spacing / sizing — titlebar 28 (macOS) / 30 (plasma); the bottom
    // panel owns 44px in plasma, the menu bar owns 24px in macOS.
    '--ui-unit': `${density.unit}`,
    '--ui-space': `${(8 * density.unit).toFixed(2)}px`,
    '--ui-space-2': `${(16 * density.unit).toFixed(2)}px`,
    '--ui-space-3': `${(24 * density.unit).toFixed(2)}px`,
    '--ui-control-h': `${density.control}px`,
    '--ui-titlebar-h': plasma ? '30px' : '28px',
    '--ui-panel-h': plasma ? '44px' : '0px',
    '--ui-menubar-h': plasma ? '0px' : '24px',
    // motion — macOS 120/200, plasma 100/150, ease-out, no spring
    '--ui-dur-fast': plasma ? '100ms' : '120ms',
    '--ui-dur': plasma ? '150ms' : '200ms',
    '--ui-dur-slow': plasma ? '220ms' : '280ms',
    '--ui-ease': 'ease-out',
    '--ui-ease-out': 'ease-out',
    '--ui-ease-spring': 'ease-out',
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
    '--accent-dim': `rgba(${accentRgb}, 0.14)`,
    '--danger': p.danger,
    '--warning': p.warning,
    '--success': p.success,
    '--radius-sm': radii.sm,
    '--radius-md': radii.md,
    '--radius-lg': radii.lg,
    '--radius-xl': radii.xl,
    '--shadow-window': flat ? 'none' : shadowWindow,
    '--shadow-dropdown': flat ? 'none' : shadowMenu,
    '--shadow-card': 'none',
    '--scrollbar-track': 'transparent',
    '--scrollbar-thumb': p.borderStrong,
    '--scrollbar-thumb-hover': p.borderHover,
    // metadata for component logic
    '--ui-mode': theme.mode,
  }
}
