// CyberManju OS — Mobile shared surfaces (tests/frontend/mobile-shared-surfaces.test.ts).
// Role: Guard phone-sized controls, keyboard-safe dialogs, and transfer board panning.
// Exports: Vitest regression suite.
// Integrates: Shared UI primitives, mobile viewport variables, and TransferGraph.
// Contracts: Desktop styles remain separate; narrow phones retain all actions.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, compileStyle } from '@vue/compiler-sfc'

const read = (name: string) => readFileSync(`src/components/${name}.vue`, 'utf8')
const mobile = (name: string) => read(name).slice(read(name).lastIndexOf('@media (max-width: 768px)'))

describe('shared mobile interaction surfaces', () => {
  for (const name of ['UiButton', 'UiInput', 'UiSelect', 'UiSegmented', 'UiCheckbox', 'UiToggle', 'UiSidebarItem']) {
    it(`${name} retains phone-sized touch targets independently of theme density`, () => {
      expect(mobile(`ui/${name}`)).toMatch(/(?:min-height|height): 44px/)
    })
  }
  it('allows toolbar groups and long button labels to wrap', () => {
    expect(mobile('ui/UiToolbar')).toContain('flex-wrap: wrap')
    expect(mobile('ui/UiButton')).toContain('white-space: normal')
    expect(mobile('ui/UiButton')).toContain('overflow-wrap: anywhere')
  })
  it('fits dialogs above the keyboard, including sheet and Plasma variants', () => {
    const modal = mobile('ui/UiModal')
    expect(modal).toContain('bottom: var(--mobile-keyboard-inset, 0px)')
    expect(modal).toContain('var(--mobile-viewport-height, 100dvh)')
    expect(modal).toContain("[data-ui-shell='plasma']")
    expect(modal).toContain('.ui-modal__header, .ui-modal__footer { flex-shrink: 0; }')
    expect(modal).toContain('overscroll-behavior: contain')
    expect(modal).toContain('flex-wrap: wrap')
    const { descriptor } = parse(read('ui/UiModal'))
    const compiled = compileStyle({ source: descriptor.styles[0].content, filename: 'UiModal.vue', id: 'data-v-mobile-check', scoped: true }).code
    expect(compiled).toMatch(/\[data-ui-shell='plasma'\]\s+\.ui-modal-layer[^\{]+\{/)
    expect(compiled).not.toMatch(/\[data-ui-shell='plasma'\]\s*\{/)
  })
  it('keeps notifications within safe areas and gives dismiss a full hit target', () => {
    const notifications = mobile('NotificationStack')
    expect(notifications).toContain('safe-area-inset-left')
    expect(notifications).toContain('safe-area-inset-right')
    expect(notifications).toContain('.notif-close { width: 44px; height: 44px; }')
  })
  it('allows native canvas panning without losing node dragging', () => {
    const transfer = mobile('TransferGraph')
    expect(transfer).toContain('.tf-canvas { touch-action: pan-x pan-y; }')
    expect(transfer).toContain('.tf-node { touch-action: none; }')
    expect(transfer).toContain('.tf { height: auto; min-height: 100%; overflow: visible; }')
    expect(transfer).toContain('.tf-plan { max-height: none;')
    expect(transfer).toContain('.tf-field.inline, .tf-field.grow')
  })
  for (const name of ['ui/UiButton', 'ui/UiInput', 'ui/UiSelect', 'ui/UiSegmented', 'ui/UiToolbar', 'ui/UiCheckbox', 'ui/UiToggle', 'ui/UiSidebarItem', 'ui/UiModal', 'NotificationStack', 'TransferGraph']) {
    it(`${name} has compilable scoped styles`, () => {
      const source = read(name)
      const { descriptor, errors } = parse(source)
      expect(errors).toEqual([])
      for (const style of descriptor.styles) {
        const result = compileStyle({ source: style.content, filename: `${name}.vue`, id: 'data-v-mobile-check', scoped: style.scoped })
        expect(result.errors).toEqual([])
      }
    })
  }
})
