/**
 * Single source of truth for the CyberManju OS design language.
 *
 * Every colour, radius, shadow, blur and motion value used by the OS shell,
 * its windows and every panel is derived from the theme definitions below
 * and published to the document as `--ui-*` custom properties by
 * `useTheme().apply()`. Components never hardcode colours — they reference
 * the variables, so switching a theme restyles the whole virtual OS at once.
 */

export type ThemeId = 'midnight' | 'nebula' | 'ember' | 'daylight' | 'ghostline'
export type Density = 'compact' | 'comfortable'
export type MotionPref = 'auto' | 'full' | 'reduced'
/** 0 = solid (no blur) · 1 = light glass · 2 = default glass · 3 = heavy glass */
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
  /** Base RGB (no alpha) used for glass tints — typically the surface colour. */
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
  /** Wallpaper ambience: soft accent glow behind the desktop. */
  glow: boolean
}

export const THEME_IDS: ThemeId[] = ['midnight', 'nebula', 'ember', 'daylight', 'ghostline']

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    mode: 'dark',
    palette: {
      bg: '#07090a',
      bgDeep: '#040506',
      surface: 'rgba(16, 20, 22, 0.72)',
      surface2: 'rgba(23, 28, 30, 0.78)',
      surface3: 'rgba(32, 39, 42, 0.86)',
      window: 'rgba(11, 14, 16, 0.74)',
      windowIdle: 'rgba(11, 14, 16, 0.62)',
      border: 'rgba(255, 255, 255, 0.09)',
      borderStrong: 'rgba(255, 255, 255, 0.16)',
      borderHover: 'rgba(255, 255, 255, 0.26)',
      hairline: 'rgba(255, 255, 255, 0.06)',
      text: '#e9eef0',
      text2: '#a9b4b8',
      text3: '#78858a',
      textFaint: '#556066',
      accent: '#00ff88',
      onAccent: '#04120c',
      success: '#2ee66b',
      warning: '#ffc048',
      danger: '#ff5f6d',
      info: '#4cc9f0',
      glassBase: '14, 18, 20',
    },
  },
  nebula: {
    id: 'nebula',
    label: 'Nebula',
    mode: 'dark',
    palette: {
      bg: '#08070f',
      bgDeep: '#050409',
      surface: 'rgba(20, 17, 34, 0.72)',
      surface2: 'rgba(28, 24, 46, 0.78)',
      surface3: 'rgba(38, 33, 60, 0.86)',
      window: 'rgba(13, 11, 22, 0.74)',
      windowIdle: 'rgba(13, 11, 22, 0.62)',
      border: 'rgba(255, 255, 255, 0.10)',
      borderStrong: 'rgba(255, 255, 255, 0.18)',
      borderHover: 'rgba(255, 255, 255, 0.28)',
      hairline: 'rgba(255, 255, 255, 0.07)',
      text: '#efeaff',
      text2: '#b3aacb',
      text3: '#837b9e',
      textFaint: '#5e5777',
      accent: '#8b7bff',
      onAccent: '#0a0716',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#22d3ee',
      glassBase: '22, 18, 38',
    },
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    mode: 'dark',
    palette: {
      bg: '#0c0806',
      bgDeep: '#070403',
      surface: 'rgba(28, 20, 15, 0.72)',
      surface2: 'rgba(38, 27, 20, 0.78)',
      surface3: 'rgba(50, 36, 26, 0.86)',
      window: 'rgba(17, 12, 9, 0.74)',
      windowIdle: 'rgba(17, 12, 9, 0.62)',
      border: 'rgba(255, 236, 220, 0.10)',
      borderStrong: 'rgba(255, 236, 220, 0.18)',
      borderHover: 'rgba(255, 236, 220, 0.30)',
      hairline: 'rgba(255, 236, 220, 0.07)',
      text: '#f6ede6',
      text2: '#c3b3a7',
      text3: '#94837a',
      textFaint: '#6d5f58',
      accent: '#ffa63d',
      onAccent: '#1a0e02',
      success: '#5ad07a',
      warning: '#ffd166',
      danger: '#ff6b57',
      info: '#63c7ff',
      glassBase: '34, 24, 18',
    },
  },
  ghostline: {
    id: 'ghostline',
    label: 'Ghostline',
    mode: 'dark',
    palette: {
      bg: '#000000',
      bgDeep: '#020604',
      surface: 'rgba(4, 12, 7, 0.92)',
      surface2: 'rgba(6, 18, 10, 0.94)',
      surface3: 'rgba(8, 26, 14, 0.96)',
      window: 'rgba(2, 8, 5, 0.96)',
      windowIdle: 'rgba(2, 8, 5, 0.92)',
      border: 'rgba(0, 255, 65, 0.16)',
      borderStrong: 'rgba(0, 255, 65, 0.34)',
      borderHover: 'rgba(0, 255, 65, 0.55)',
      hairline: 'rgba(0, 255, 65, 0.10)',
      text: '#d6ffe2',
      text2: '#8fdba5',
      text3: '#4d8a60',
      textFaint: '#2c5238',
      accent: '#00ff41',
      onAccent: '#001505',
      success: '#00ff41',
      warning: '#ffb000',
      danger: '#ff1f3d',
      info: '#00e5a0',
      glassBase: '3, 10, 6',
    },
  },
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    mode: 'light',
    palette: {
      bg: '#eef1f5',
      bgDeep: '#e2e7ee',
      surface: 'rgba(255, 255, 255, 0.72)',
      surface2: 'rgba(255, 255, 255, 0.84)',
      surface3: 'rgba(255, 255, 255, 0.96)',
      window: 'rgba(250, 252, 255, 0.78)',
      windowIdle: 'rgba(250, 252, 255, 0.66)',
      border: 'rgba(15, 23, 42, 0.10)',
      borderStrong: 'rgba(15, 23, 42, 0.18)',
      borderHover: 'rgba(15, 23, 42, 0.30)',
      hairline: 'rgba(15, 23, 42, 0.07)',
      text: '#0f172a',
      text2: '#475569',
      text3: '#64748b',
      textFaint: '#94a3b8',
      accent: '#2563eb',
      onAccent: '#ffffff',
      success: '#16a34a',
      warning: '#d97706',
      danger: '#dc2626',
      info: '#0891b2',
      glassBase: '255, 255, 255',
    },
  },
}

export const ACCENT_CHOICES: { id: string; label: string; value: string }[] = [
  { id: 'default', label: 'Theme', value: '' },
  { id: 'matrix', label: 'Matrix', value: '#00ff41' },
  { id: 'bloodred', label: 'Bloodred', value: '#ff1f3d' },
  { id: 'jade', label: 'Jade', value: '#00ff88' },
  { id: 'mint', label: 'Mint', value: '#00e5a0' },
  { id: 'cyan', label: 'Cyan', value: '#22d3ee' },
  { id: 'azure', label: 'Azure', value: '#3b82f6' },
  { id: 'violet', label: 'Violet', value: '#8b7bff' },
  { id: 'orchid', label: 'Orchid', value: '#d946ef' },
  { id: 'amber', label: 'Amber', value: '#ffa63d' },
  { id: 'rose', label: 'Rose', value: '#fb7185' },
]

export const DENSITY_SCALE: Record<Density, { unit: number; control: number; fs: number }> = {
  compact: { unit: 0.86, control: 26, fs: 0.94 },
  comfortable: { unit: 1, control: 32, fs: 1 },
}

export const DEFAULT_SETTINGS: ThemeSettings = {
  theme: 'ghostline',
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
  const theme = THEMES[s.theme] ?? THEMES.midnight
  const p = theme.palette
  const accent = s.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.accent) ? s.accent : p.accent
  const [ar, ag, ab] = hexToRgb(accent)
  const accentRgb = `${ar}, ${ag}, ${ab}`
  const density = DENSITY_SCALE[s.density]

  // Glass strength: 0 disables blur entirely (backdrop-filter falls back to
  // a plain translucent tint), higher levels trade contrast for depth.
  const glassAlpha = [1, 0.86, 0.7, 0.56][s.glass] ?? 0.7
  const blur = [0, 8, 16, 26][s.glass] ?? 16
  const onAccentLuma = (() => {
    const [r, g, b] = hexToRgb(accent)
    return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#0b0d0e' : '#ffffff'
  })()

  const surfaceGlass = (base: string, a: number) => {
    if (theme.mode === 'light') return `rgba(255, 255, 255, ${a})`
    const [r, g, b] = base.split(',').map((n) => parseInt(n.trim(), 10))
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  const shadowColor = theme.mode === 'light' ? '15, 23, 42' : '0, 0, 0'

  return {
    // surfaces
    '--ui-bg': p.bg,
    '--ui-bg-deep': p.bgDeep,
    '--ui-surface': p.surface,
    '--ui-surface-2': p.surface2,
    '--ui-surface-3': p.surface3,
    '--ui-window': s.glass === 0 ? (theme.mode === 'light' ? '#f8fafc' : '#0d1114') : p.window,
    '--ui-window-idle': p.windowIdle,
    '--ui-content': surfaceGlass(p.glassBase, Math.min(0.94, glassAlpha + 0.14)),
    // glass
    '--ui-glass': surfaceGlass(p.glassBase, glassAlpha * 0.92),
    '--ui-glass-2': surfaceGlass(p.glassBase, Math.min(1, glassAlpha + 0.1)),
    '--ui-glass-border': theme.mode === 'light' ? 'rgba(255, 255, 255, 0.75)' : 'rgba(255, 255, 255, 0.12)',
    '--ui-glass-highlight': theme.mode === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.08)',
    '--ui-blur': `${blur}px`,
    '--ui-blur-strong': `${Math.round(blur * 1.75)}px`,
    '--ui-saturate': s.glass === 0 ? '100%' : '150%',
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
    // accent + status
    '--ui-accent': accent,
    '--ui-accent-rgb': accentRgb,
    '--ui-accent-soft': `rgba(${accentRgb}, 0.14)`,
    '--ui-accent-softer': `rgba(${accentRgb}, 0.07)`,
    '--ui-accent-strong': mix(accent, theme.mode === 'light' ? '#ffffff' : '#000000', 0.18),
    '--ui-on-accent': s.accent ? onAccentLuma : p.onAccent,
    '--ui-success': p.success,
    '--ui-success-rgb': hexToRgb(p.success).join(', '),
    '--ui-warning': p.warning,
    '--ui-warning-rgb': hexToRgb(p.warning).join(', '),
    '--ui-danger': p.danger,
    '--ui-danger-rgb': hexToRgb(p.danger).join(', '),
    '--ui-info': p.info,
    '--ui-info-rgb': hexToRgb(p.info).join(', '),
    // radius
    '--ui-radius-xs': '3px',
    '--ui-radius-sm': '6px',
    '--ui-radius-md': '10px',
    '--ui-radius-lg': '14px',
    '--ui-radius-xl': '20px',
    '--ui-radius-2xl': '28px',
    '--ui-radius-full': '999px',
    // elevation
    '--ui-shadow-1': `0 1px 2px rgba(${shadowColor}, 0.16), 0 2px 8px rgba(${shadowColor}, 0.14)`,
    '--ui-shadow-2': `0 6px 18px rgba(${shadowColor}, 0.22), 0 2px 6px rgba(${shadowColor}, 0.16)`,
    '--ui-shadow-3': `0 18px 48px rgba(${shadowColor}, 0.34), 0 6px 18px rgba(${shadowColor}, 0.22)`,
    '--ui-glow': `0 0 0 1px rgba(${accentRgb}, 0.35), 0 0 24px rgba(${accentRgb}, 0.18)`,
    '--ui-glow-soft': `0 0 20px rgba(${accentRgb}, 0.12)`,
    // typography
    '--ui-font':
      "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    '--ui-font-mono':
      "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
    '--ui-fs-xs': `${(10 * density.fs).toFixed(1)}px`,
    '--ui-fs-sm': `${(11.5 * density.fs).toFixed(1)}px`,
    '--ui-fs-md': `${(13 * density.fs).toFixed(1)}px`,
    '--ui-fs-lg': `${(15 * density.fs).toFixed(1)}px`,
    '--ui-fs-xl': `${(19 * density.fs).toFixed(1)}px`,
    '--ui-fs-2xl': `${(24 * density.fs).toFixed(1)}px`,
    '--ui-fs-3xl': `${(32 * density.fs).toFixed(1)}px`,
    '--ui-tracking': '0.01em',
    '--ui-tracking-wide': '0.12em',
    // spacing / sizing
    '--ui-unit': `${density.unit}`,
    '--ui-space': `${(8 * density.unit).toFixed(2)}px`,
    '--ui-space-2': `${(16 * density.unit).toFixed(2)}px`,
    '--ui-space-3': `${(24 * density.unit).toFixed(2)}px`,
    '--ui-control-h': `${density.control}px`,
    '--ui-titlebar-h': `${Math.round(density.control * 1.06)}px`,
    // motion
    '--ui-dur-fast': '120ms',
    '--ui-dur': '200ms',
    '--ui-dur-slow': '360ms',
    '--ui-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
    '--ui-ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
    '--ui-ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
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
    '--accent-dim': `rgba(${accentRgb}, 0.15)`,
    '--danger': p.danger,
    '--warning': p.warning,
    '--success': p.success,
    '--radius-sm': '6px',
    '--radius-md': '10px',
    '--radius-lg': '14px',
    '--radius-xl': '20px',
    '--shadow-window': `0 18px 48px rgba(${shadowColor}, 0.34), 0 6px 18px rgba(${shadowColor}, 0.22)`,
    '--shadow-dropdown': `0 18px 48px rgba(${shadowColor}, 0.34)`,
    '--shadow-card': `0 6px 18px rgba(${shadowColor}, 0.22)`,
    '--scrollbar-track': 'transparent',
    '--scrollbar-thumb': p.borderStrong,
    '--scrollbar-thumb-hover': p.borderHover,
    // metadata for component logic
    '--ui-mode': theme.mode,
  }
}
