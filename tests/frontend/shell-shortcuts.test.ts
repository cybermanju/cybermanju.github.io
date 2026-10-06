import { describe, expect, it } from 'vitest'
import {
  isReservedInBrowser,
  fallbackFor,
  BROWSER_FALLBACKS,
} from '../../src/composables/useShortcuts'

describe('browser-reserved shortcuts', () => {
  it('marks tab-chrome keys as reserved', () => {
    expect(isReservedInBrowser('Ctrl+T')).toBe(true)
    expect(isReservedInBrowser('Ctrl+W')).toBe(true)
    expect(isReservedInBrowser('Ctrl+N')).toBe(true)
    expect(isReservedInBrowser('Ctrl+Tab')).toBe(true)
    expect(isReservedInBrowser('Ctrl+Shift+Tab')).toBe(true)
  })

  it('leaves app keys interceptable', () => {
    expect(isReservedInBrowser('Ctrl+K')).toBe(false)
    expect(isReservedInBrowser('Alt+W')).toBe(false)
    expect(isReservedInBrowser('Ctrl+Shift+A')).toBe(false)
    expect(isReservedInBrowser('Escape')).toBe(false)
  })

  it('provides an Alt+ fallback for every reserved primary', () => {
    for (const [action, fb] of Object.entries(BROWSER_FALLBACKS)) {
      expect(fb.startsWith('Alt')).toBe(true)
      expect(isReservedInBrowser(fb)).toBe(false)
      expect(action.length).toBeGreaterThan(0)
    }
    expect(fallbackFor('open_trash', 'Ctrl+T')).toBe('Alt+T')
    expect(fallbackFor('close_window', 'Ctrl+W')).toBe('Alt+W')
  })

  it('auto-derives Alt+ fallbacks for unlisted reserved bindings', () => {
    expect(fallbackFor('custom_thing', 'Ctrl+T')).toBe('Alt+T')
    expect(fallbackFor('custom_other', 'Ctrl+Shift+Tab')).toBe('Alt+Shift+Tab')
  })

  it('returns no fallback for safe bindings', () => {
    expect(fallbackFor('toggle_palette', 'Ctrl+P')).toBe('')
    expect(fallbackFor('escape', 'Escape')).toBe('')
  })
})

describe('window/layout shortcut coverage', () => {
  it('covers every layout mode with an Alt+number binding', async () => {
    const fs = await import('node:fs')
    const kpl = fs.readFileSync('keymaps/default.kpl', 'utf8')
    for (const action of [
      'close_window',
      'minimize_window',
      'maximize_toggle',
      'focus_next',
      'focus_prev',
      'move_window_left',
      'move_window_right',
      'move_window_up',
      'move_window_down',
      'autotile_toggle',
      'overview_toggle',
      'layout_floating',
      'layout_tiled',
      'layout_strip',
      'layout_overview',
      'strip_left',
      'strip_right',
      'strip_direction',
      'close_all_windows',
    ]) {
      expect(kpl).toContain(`${action}=`)
    }
    // No window-management primary may rely on a browser-owned chord.
    for (const line of kpl.split('\n')) {
      const m = line.match(/^(close_window|focus_next|focus_prev|autotile_toggle)\s*=\s*(.+)$/)
      if (m) expect(isReservedInBrowser(m[2].trim())).toBe(false)
    }
  })
})
