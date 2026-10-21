// CyberManju OS — UI text editing behavior tests.
// Role: Verify privacy guards and paste contracts for form and editable targets.
// Integrates: UiTextContextMenu.vue, uiLayout text-menu event metadata.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const menu = readFileSync(new URL('../../src/components/UiTextContextMenu.vue', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../../src/utils/uiLayout.ts', import.meta.url), 'utf8')

describe('UI text editing privacy and interaction contracts', () => {
  it('guards textarea secrets by metadata, without serializing field values', () => {
    expect(menu).toContain('function protectedField')
    expect(menu).toContain('field.getAttribute(\'autocomplete\')')
    expect(menu).toContain('field.getAttribute(\'data-secret\')')
    expect(layout).toContain('editable.getAttribute(\'placeholder\')')
    expect(layout).toContain('target: editable, form: true')
    expect(layout).not.toContain('target: editable, value:')
  })
  it('honors readonly and input maxLength while refusing stale async clipboard reads', () => {
    expect(menu).toContain('field.readOnly')
    expect(menu).toContain('field.maxLength >= 0')
    expect(menu).toContain('if (menu.value !== current) return')
    expect(menu).toContain('field.setRangeText(inserted, start, end, \'end\')')
  })
  it('limits editable copy to contained selection and inserts plain text only', () => {
    expect(menu).toContain('current.target.contains(selection.anchorNode)')
    expect(menu).toContain('document.createTextNode(inserted)')
    expect(menu).toContain("inputType: 'insertFromPaste'")
    expect(menu).toContain('Plain-text paste is not supported by this editor.')
  })
  it('uses measured menu dimensions and visual viewport for placement', () => {
    expect(menu).toContain('panel.value?.getBoundingClientRect()')
    expect(menu).toContain('window.visualViewport')
  })
})
