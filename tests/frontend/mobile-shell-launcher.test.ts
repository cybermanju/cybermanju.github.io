// CyberManju OS — mobile shell launcher regressions.
// Role: protects touch-first shell, favorites dock, and task navigation contracts.
// Exports/Integrates: Vitest coverage for DesktopShell, MobileLauncher, HomeWorkspaceStudio, MobileNav, OrbNavigator, and AppWindow.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isTouchFirstViewport, MOBILE_SHELL_MEDIA_QUERY } from '../../src/utils/mobileShell'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const shell = read('../../src/components/DesktopShell.vue')
const launcher = read('../../src/components/MobileLauncher.vue')
const orb = read('../../src/components/OrbNavigator.vue')
const nav = read('../../src/components/MobileNav.vue')
const windowShell = read('../../src/components/AppWindow.vue')
const globalCss = read('../../src/assets/ui.css')

describe('mobile launcher shell', () => {
  it('keeps short touch landscape in the same touch-first shell as portrait', () => {
    expect(isTouchFirstViewport(390, 844, false)).toBe(true)
    expect(isTouchFirstViewport(844, 390, true)).toBe(true)
    expect(isTouchFirstViewport(1440, 900, true)).toBe(false)
    expect(isTouchFirstViewport(Number.NaN, 390, true)).toBe(false)
    expect(MOBILE_SHELL_MEDIA_QUERY).toContain('(pointer: coarse) and (max-height: 600px)')
    expect(shell).toContain(MOBILE_SHELL_MEDIA_QUERY)
    expect(globalCss).toContain('@media (max-width: 768px), (pointer: coarse) and (max-height: 600px)')
  })

  it('pins an always-visible, theme-aware favorites dock and compact Orb above its safe area', () => {
    expect(launcher).toContain('class="mobile-favorites-dock"')
    expect(launcher).toContain('!launcher.drawerOpen && !launcher.messagesOpen && !customHome')
    expect(launcher).toContain('position: fixed; z-index: 10001; left: var(--mobile-safe-inline-start, 3vw); right: var(--mobile-safe-inline-end, 3vw)')
    expect(launcher).toContain('margin-inline: auto;')
    expect(launcher).toContain('bottom: calc(env(safe-area-inset-bottom, 0px) + 1vh)')
    expect(launcher).toContain(':class="`theme-${themeId}`"')
    expect(globalCss).toContain('padding-bottom: calc(var(--mobile-favorites-dock-h) + env(safe-area-inset-bottom, 0px) + 2vh)')
    expect(orb).toContain('width: clamp(44px, 5.5vh, 56px)')
    expect(orb).toContain('var(--ui-accent, #78aaff)')
    expect(read('../../src/components/AppWindow.vue')).toContain('pinned.value ? 9999')
  })

  it('returns Home by minimizing tasks and supports selecting an open task', () => {
    expect(nav).toContain('wm.minimizeAll()')
    expect(nav).not.toContain('wm.closeAll()')
    expect(nav).toContain('wm.restore(id)')
    expect(nav).toContain('wm.focus(id)')
  })

  it('keeps one mobile window header contract and controls available on touch landscape', () => {
    expect(windowShell).toContain('titlebar-mobile-menu')
    expect(windowShell).toContain('titlebar-mobile-close')
    expect(windowShell).toContain('@media (max-width: 768px), (pointer: coarse) and (max-height: 600px)')
  })
})
