// CyberManju OS — Mobile viewport tests (tests/frontend/mobile-viewport.test.ts).
// Role: Guard keyboard fitting, visible chrome, pinned dock and drawer affordances.
// Exports: Vitest regression suite.
// Integrates: useMobileViewport, mobile shell components and CSS.
// Contracts: Software keyboard cannot push mobile inputs below the visible screen.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { mobileViewportGeometry } from '../../src/composables/useMobileViewport'

const read = (path: string) => fs.readFileSync(path, 'utf8')
describe('mobile viewport geometry', () => {
  it('uses the full screen with the keyboard closed', () => {
    expect(mobileViewportGeometry(844, 844)).toEqual({ height: 844, keyboardInset: 0, keyboardOpen: false })
  })
  it('reserves the software keyboard area', () => {
    expect(mobileViewportGeometry(844, 480)).toEqual({ height: 480, keyboardInset: 364, keyboardOpen: true })
  })
  it('accounts for a panned visual viewport and ignores browser toolbar changes', () => {
    expect(mobileViewportGeometry(844, 480, 30).keyboardInset).toBe(334)
    expect(mobileViewportGeometry(844, 780).keyboardOpen).toBe(false)
  })
  it('does not report negative sizes or insets', () => {
    expect(mobileViewportGeometry(568, 600)).toEqual({ height: 568, keyboardInset: 0, keyboardOpen: false })
    expect(mobileViewportGeometry(568, -1).height).toBe(0)
  })
})
describe('mobile shell interaction contracts', () => {
  it('pins the favorite dock in the flex viewport without fixed positioning', () => {
    const launcher = read('src/components/MobileLauncher.vue')
    expect(launcher).toContain('<HomeWorkspaceStudio')
    expect(launcher).toContain('class="mla-dock"')
    expect(launcher).toMatch(/\.mla-dock\s*\{[^}]*flex-shrink:\s*0/)
    expect(launcher).not.toMatch(/\.mla-dock\s*\{[^}]*position:\s*fixed/)
    expect(launcher).toContain('min-height: 0')
  })
  it('provides a real app grid on non-Android builds and reduced-motion support', () => {
    const drawer = read('src/components/AppDrawer.vue')
    expect(drawer).toContain('visibleBuiltIns')
    expect(drawer).toContain('openBuiltIn(app.panel)')
    expect(drawer).toContain('prefers-reduced-motion: reduce')
    expect(drawer).toContain(':inert="!launcher.drawerOpen"')
  })
  it('exempts terminal gestures from global shell actions', () => {
    expect(read('src/composables/useSwipe.ts')).toContain('[data-shell-gesture-exclude], .terminal-gesture-exclude')
  })
  it('uses visible theme choices rather than an unexplained cycle action', () => {
    const header = read('src/components/TopMenuBar.vue')
    expect(header).toContain('aria-label="Personalize appearance"')
    expect(header).toContain('useFocusTrap(appearanceRef, appearanceOpen)')
    expect(header).toContain('theme.setAppearance(\'auto\')')
    expect(header).toContain('theme.setTheme(id)')
    expect(header).toContain('theme.setAccent(')
  })
})
