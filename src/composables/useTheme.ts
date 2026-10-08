import { computed, reactive, watch, type ComputedRef } from 'vue'
import {
  DEFAULT_SETTINGS,
  LEGACY_THEME_ALIASES,
  THEMES,
  buildCssVars,
  type GlassLevel,
  type Density,
  type MotionPref,
  type ThemeId,
  type ThemeSettings,
} from '@/ui/tokens'

const STORAGE_KEY = 'cybermanju_theme_v1'

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // First run: honour the host OS preference (mirrors VueUse
      // usePreferredDark/usePreferredColorScheme without a setup scope).
      try {
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
          const light = (Object.keys(THEMES) as ThemeId[]).find((id) => THEMES[id].mode === 'light')
          if (light) return { ...DEFAULT_SETTINGS, theme: light }
        }
      } catch { /* default theme stands */ }
      return { ...DEFAULT_SETTINGS }
    }
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>
    const rawTheme = parsed.theme as string | undefined
    const aliased = rawTheme && !THEMES[rawTheme as ThemeId] ? LEGACY_THEME_ALIASES[rawTheme] : undefined
    const theme =
      rawTheme && rawTheme in THEMES
        ? (rawTheme as ThemeId)
        : aliased ?? DEFAULT_SETTINGS.theme
    return { ...DEFAULT_SETTINGS, ...parsed, theme }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Module-level singleton: every caller of `useTheme()` shares this reactive
 * state, so theme/accent/density/glass/motion really are a single source of
 * truth for the whole operating system.
 */
const state = reactive<ThemeSettings>(loadSettings())

let applyScheduled = false

function applyNow() {
  if (typeof document === 'undefined') return
  const vars = buildCssVars({ ...state })
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
  root.dataset.uiTheme = state.theme
  root.dataset.uiMode = THEMES[state.theme].mode
  root.dataset.uiDensity = state.density
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state }))
  } catch {
    /* private mode / quota — the theme still applies for this session */
  }
}

function scheduleApply() {
  if (applyScheduled) return
  applyScheduled = true
  queueMicrotask(() => {
    applyScheduled = false
    applyNow()
    persist()
  })
}

watch(
  () => [state.theme, state.accent, state.density, state.glass, state.motion, state.glow],
  () => scheduleApply(),
  { deep: true }
)

// First paint: write the variables synchronously so there is no flash of the
// default theme before Vue mounts.
if (typeof document !== 'undefined') applyNow()

export function useTheme() {
  const themeId = computed(() => state.theme)
  const mode = computed(() => THEMES[state.theme].mode)
  const density = computed(() => state.density)
  const glass = computed(() => state.glass)
  const accent = computed(() => state.accent)
  const motion = computed(() => state.motion)
  const cssVars: ComputedRef<Record<string, string>> = computed(() => buildCssVars({ ...state }))

  function setTheme(id: ThemeId) {
    state.theme = id
  }
  function setAccent(value: string | null) {
    state.accent = value || null
  }
  function setDensity(value: Density) {
    state.density = value
  }
  function setGlass(value: GlassLevel) {
    state.glass = value
  }
  function setMotion(value: MotionPref) {
    state.motion = value
  }
  function setGlow(value: boolean) {
    state.glow = value
  }
  function cycleTheme() {
    const ids = Object.keys(THEMES) as ThemeId[]
    state.theme = ids[(ids.indexOf(state.theme) + 1) % ids.length]
  }
  function reset() {
    Object.assign(state, DEFAULT_SETTINGS)
  }

  /** Inline style carrying the glass treatment — for teleported overlay layers. */
  const glassStyle = computed(() => ({
    background: 'var(--ui-glass-2)',
    backdropFilter: 'blur(var(--ui-blur-strong)) saturate(var(--ui-saturate))',
    WebkitBackdropFilter: 'blur(var(--ui-blur-strong)) saturate(var(--ui-saturate))',
    border: '1px solid var(--ui-border)',
    boxShadow: 'var(--ui-shadow-3)',
  }))

  return {
    settings: state,
    themeId,
    mode,
    density,
    glass,
    accent,
    motion,
    cssVars,
    glassStyle,
    setTheme,
    setAccent,
    setDensity,
    setGlass,
    setMotion,
    setGlow,
    cycleTheme,
    reset,
    themes: THEMES,
  }
}

export type ThemeApi = ReturnType<typeof useTheme>
