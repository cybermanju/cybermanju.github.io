// CyberManju OS — CodeStudio mobile UX (tests/frontend/code-studio-mobile.test.ts).
// Role: pin mobile navigation, creation actions, touch targets, and editor containment.
// Exports: none.
// Integrates: CodeStudio Vue SFC source, Vitest.
// Contracts: keep the mobile surface usable without changing editor transport semantics.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/CodeStudio.vue', 'utf8')
const scopedCss = source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''

describe('CodeStudio mobile controls', () => {
  it('exposes a named hamburger menu with editor navigation and common actions', () => {
    expect(source).toContain(":aria-label=\"mobileMenuOpen ? 'Close Code Studio menu' : 'Open Code Studio menu'\"")
    expect(source).toContain('aria-expanded="mobileMenuOpen"')
    expect(source).toContain('role="dialog" aria-modal="true" aria-label="Code Studio menu"')
    expect(source).toContain('v-for="a in activities"')
    expect(source).toContain('openMobileCreate(\'file\')')
    expect(source).toContain('openMobileCreate(\'folder\')')
    expect(source).toContain('Save current file')
    expect(source).toContain('Split editor')
  })

  it('offers labeled file and folder creation through the active transport', () => {
    expect(source).toContain('aria-label="Create files and folders"')
    expect(source).toContain('New file name')
    expect(source).toContain('New folder name')
    expect(source).toContain("store.saveWasmFile(path, '')")
    expect(source).toContain("'upload_file', { fileName: name, fileData: [], parentPath: '/' }")
    expect(source).toContain("store.createFolder(name, '/')")
  })

  it('keeps primary mobile controls at touch size', () => {
    expect(scopedCss).toMatch(/\.cs-top \.cs-btn\s*\{[^}]*min-height:\s*44px/)
    expect(scopedCss).toMatch(/\.cs-mobilebar button\s*\{[^}]*min-height:\s*48px/)
    expect(scopedCss).toMatch(/\.cs-mobile-menu-group button\s*\{[^}]*min-height:\s*48px/)
    expect(scopedCss).toMatch(/\.cs-drawer-close, \.cs-side \.cs-ibtn\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px/)
    expect(scopedCss).toMatch(/\.cs-explorer-actions \.cs-btn\s*\{[^}]*min-height:\s*48px/)
  })

  it('contains editor width while preserving native text editing and local scrolling', () => {
    expect(scopedCss).toMatch(/\.cs-mid\s*\{[^}]*overflow:\s*hidden/)
    expect(scopedCss).toMatch(/\.cs-groups, \.cs-group, \.cs-edcol, \.cs-pane, \.cs-code\s*\{[^}]*min-width:\s*0/)
    expect(scopedCss).toMatch(/\.cs-input2, \.cs-hl\s*\{[^}]*box-sizing:\s*border-box;\s*max-width:\s*100%/)
    expect(source).toContain("class: 'cs-input2'")
    expect(source).toContain('onInput,')
  })
})
