// CyberManju OS — Desktop personalization entry regressions.
// Role: verify the desktop context-menu gate rejects every other pointer target.
// Exports: Vitest suite for the DesktopShell entry policy.
// Integrates: desktopPersonalization.ts pure interaction guard.
// Contracts: the touch two-finger gesture is tested in ui-layout-gestures.test.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shouldOpenDesktopPersonalizationMenu } from '../../src/utils/desktopPersonalization'

const textMenuSource = readFileSync(new URL('../../src/components/UiTextContextMenu.vue', import.meta.url), 'utf8')

class Target {
  constructor(
    readonly tagName = 'div',
    readonly classes = new Set<string>(),
    readonly parent: Target | null = null,
    readonly attributes = new Set<string>(),
  ) {}

  closest(selector: string): Element | null {
    const selectors = selector.split(',').map(value => value.trim())
    let current: Target | null = this
    while (current) {
      if (selectors.some(value => current!.matches(value))) return current as unknown as Element
      current = current.parent
    }
    return null
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1))
    if (selector === 'button:not(.desktop-shortcut)') return this.tagName === 'button' && !this.classes.has('desktop-shortcut')
    if (['input', 'textarea', 'select', 'a'].includes(selector)) return this.tagName === selector
    if (selector === '[data-ui-layout-ignore]') return this.attributes.has('data-ui-layout-ignore')
    if (selector === '[contenteditable]:not([contenteditable="false"])') return this.attributes.has('contenteditable') && !this.attributes.has('contenteditable-false')
    return false
  }
}

const desktop = new Target('div', new Set(['desktop-area']))
const canvas = new Target('div', new Set(), desktop)
const event = (target: Target, button = 2) => ({ button, target: target as unknown as EventTarget }) as Pick<MouseEvent, 'button' | 'target'>

describe('Desktop personalization context-menu entry', () => {
  it('accepts a right-click on the desktop canvas and desktop shortcuts', () => {
    const shortcut = new Target('button', new Set(['desktop-shortcut']), desktop)
    expect(shouldOpenDesktopPersonalizationMenu(event(canvas), false)).toBe(true)
    expect(shouldOpenDesktopPersonalizationMenu(event(shortcut), false)).toBe(true)
  })

  it('rejects left-clicks and right-clicks outside the desktop surface', () => {
    expect(shouldOpenDesktopPersonalizationMenu(event(canvas, 0), false)).toBe(false)
    expect(shouldOpenDesktopPersonalizationMenu(event(new Target()), false)).toBe(false)
  })

  it('preserves app, form-control, editor and menu context actions', () => {
    const appWindow = new Target('article', new Set(['app-window']), desktop)
    const input = new Target('input', new Set(), desktop)
    const editor = new Target('div', new Set(), desktop, new Set(['data-ui-layout-ignore']))
    const dock = new Target('div', new Set(['dock']), desktop)
    expect(shouldOpenDesktopPersonalizationMenu(event(appWindow), false)).toBe(false)
    expect(shouldOpenDesktopPersonalizationMenu(event(input), false)).toBe(false)
    expect(shouldOpenDesktopPersonalizationMenu(event(editor), false)).toBe(false)
    expect(shouldOpenDesktopPersonalizationMenu(event(dock), false)).toBe(false)
  })

  it('never exposes the desktop menu on the mobile viewport', () => {
    expect(shouldOpenDesktopPersonalizationMenu(event(canvas), true)).toBe(false)
  })

  it('keeps the text-menu customization entry limited to the mobile layout', () => {
    expect(textMenuSource).toContain('v-if="mobileCustomizationEntry"')
    expect(textMenuSource).toContain("matchMedia?.('(max-width: 768px)')")
  })
})
