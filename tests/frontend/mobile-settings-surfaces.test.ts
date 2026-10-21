// CyberManju OS — Mobile settings surfaces (tests/frontend/mobile-settings-surfaces.test.ts).
// Responsive contract for settings-adjacent surfaces: phones from 320–768px keep
// content in-bounds, controls reachable, text readable, and dialogs scrollable.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const read = (name: string) => fs.readFileSync(`src/components/${name}.vue`, 'utf8')
const settings = read('SettingsPage')
const accounts = read('AccountManagerPanel')
const shield = read('ShieldPanel')
const install = read('InstallPanel')
const serverAuth = read('ServerAuthPanel')
const setup = read('SetupWizard')
const mobileSetup = read('MobileSetupWizard')
const upload = read('FileUploadDialog')
const shortcuts = read('KeyboardShortcutsHelp')
const confirm = read('ConfirmDialog')

describe('mobile settings and supporting surfaces', () => {
  it('keeps Settings stack rows and controls wrapping through 768px', () => {
    expect(settings).toContain("matchMedia?.('(max-width: 768px)')")
    expect(settings).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.st--mobile \.st-row > :first-child\s*\{\s*flex:\s*1 1 100%/)
    expect(settings).toMatch(/\.st--mobile \.st-actions > \*\s*\{\s*flex:\s*1 1 auto/)
    expect(settings).toMatch(/\.st--mobile \.st-mono, \.st--mobile \.st-strip-url\s*\{\s*overflow-wrap:\s*anywhere/)
  })

  it('keeps Account Manager controls reachable in its narrow container layout', () => {
    expect(accounts).toContain('@container account-manager (max-width: 700px)')
    expect(accounts).toMatch(/\.am-btn, \.am-icon-btn, \.am-prov-del, \.am-login, \.am-logo-pick\s*\{\s*min-height:\s*44px/)
    expect(accounts).toMatch(/\.am-flyout-scroll\s*\{[^}]*overscroll-behavior:\s*contain/)
    expect(accounts).toContain('am-flyout-backdrop')
  })

  it('makes Shield controls and long key/recovery data fit phone widths', () => {
    expect(shield).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.sh-tabs button\s*\{[^}]*min-height:\s*44px/)
    expect(shield).toMatch(/\.meta-value, \.stat-value\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(shield).toMatch(/\.rot-label\s*\{[^}]*min-height:\s*44px/)
  })

  it('fits install cards and exposes touch-sized download and copy actions', () => {
    expect(install).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.ip-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(install).toMatch(/\.ip-link, \.ip-copy\s*\{\s*min-height:\s*44px/)
    expect(install).toMatch(/\.ip-cmd\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })

  it('keeps server authentication forms usable without changing login semantics', () => {
    expect(serverAuth).toContain('store.login(user, password.value)')
    expect(serverAuth).toContain('store.register(user, password.value, displayName.value.trim() || undefined)')
    expect(serverAuth).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.auth-input\s*\{\s*min-height:\s*48px;\s*font-size:\s*16px/)
    expect(serverAuth).toMatch(/\.auth-submit\s*\{\s*width:\s*100%;\s*min-height:\s*48px/)
    expect(serverAuth).toContain('env(safe-area-inset-bottom)')
  })

  it('turns the desktop onboarding wizard into a scrollable phone sheet', () => {
    expect(setup).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.sw-card\s*\{[^}]*max-height:\s*100%/)
    expect(setup).toMatch(/\.sw-input\s*\{\s*min-height:\s*44px;\s*font-size:\s*16px/)
    expect(setup).toMatch(/\.sw-actions \.sw-btn\s*\{[^}]*min-height:\s*44px/)
    expect(setup).toContain("@click=\"go('vault')\"")
  })

  it('retains touch-first Mobile Setup while stacking narrow paired fields', () => {
    expect(mobileSetup).toContain('min-height: 44px')
    expect(mobileSetup).toMatch(/@media\s*\(max-width:\s*420px\)[\s\S]*?\.msw-grid2\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(mobileSetup).toMatch(/\.msw-nav \.msw-link\s*\{[^}]*margin-left:\s*0/)
    expect(mobileSetup).toContain('env(safe-area-inset-bottom')
  })

  it('keeps uploads and file status readable in a bounded mobile dialog', () => {
    expect(upload).toContain('class="file-picker-button"')
    expect(upload).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.upload-modal\s*\{[^}]*max-height:\s*100%/)
    expect(upload).toMatch(/\.upload-file-row\s*\{\s*font-size:\s*12px/)
    expect(upload).toContain('overscroll-behavior: contain')
  })

  it('wraps shortcut descriptions and enlarges the close target on phones', () => {
    expect(shortcuts).toContain('aria-label="Close shortcuts help"')
    expect(shortcuts).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.close-btn\s*\{\s*width:\s*44px;\s*height:\s*44px/)
    expect(shortcuts).toMatch(/\.ks-desc\s*\{\s*flex:\s*1 1 100%;\s*font-size:\s*13px/)
    expect(shortcuts).toMatch(/\.ks-row\s*\{\s*align-items:\s*flex-start;\s*flex-wrap:\s*wrap/)
  })

  it('keeps confirmation actions large and long confirmation text wrapped', () => {
    expect(confirm).toContain("function handleConfirm() { emit('confirm'); emit('update:visible', false) }")
    expect(confirm).toContain("function handleCancel() { emit('cancel'); emit('update:visible', false) }")
    expect(confirm).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.confirm-btn\s*\{\s*min-height:\s*48px/)
    expect(confirm).toMatch(/\.confirm-body\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
