// CyberManju OS — Mobile ios.test (tests/frontend/mobile-ios.test.ts).
// Role: preserve mobile chrome and iOS native scaffold around the canonical Orbit Home.
// Exports: Vitest suite. Integrates: shell, launcher, workspace and iOS configuration.
// Contracts: user pages replace the retired springboard; native iOS contracts stay unchanged.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const launcher = fs.readFileSync('src/components/MobileLauncher.vue', 'utf8')
const nav = fs.readFileSync('src/components/MobileNav.vue', 'utf8')
const topbar = fs.readFileSync('src/components/TopMenuBar.vue', 'utf8')
const studio = fs.readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')

describe('canonical HomeWorkspaceStudio navigation', () => {
  it('mounts one workspace surface and avoids the retired launcher grid', () => {
    expect(launcher).toContain('<HomeWorkspaceStudio')
    expect(launcher).not.toContain('mla-grid')
    expect(launcher).not.toContain('workspaceMode')
    expect(studio).toContain('aria-label="Personal home workspaces"')
  })

  it('provides accessible screen navigation and keyboard shortcuts', () => {
    expect(studio).toContain('Home screen navigation')
    expect(studio).toContain(':aria-current="index === activeIndex ?')
    expect(studio).toContain('ArrowLeft')
    expect(studio).toContain('ArrowRight')
    expect(studio).toContain("event.key === 'Home'")
    expect(studio).toContain("event.key === 'End'")
    expect(studio).toContain("event.altKey && event.key.toLowerCase() === 'o'")
    expect(studio).toContain("event.shiftKey && event.key === 'F10'")
  })

  it('uses responsive flex workspace and keeps motion preferences', () => {
    expect(studio).toContain('display: flex')
    expect(studio).toContain('min-height: 0')
    expect(studio).toContain('prefers-reduced-motion:reduce')
    expect(studio).toContain('useMotion()')
    expect(studio).toContain('editing')
  })
})

describe('iOS status bar + icons + dock', () => {
  it('uses one unified mobile header (no duplicated status row or clock)', () => {
    // The single TopMenuBar header owns connectivity + vaults + the clock.
    expect(topbar).toContain('tmb-mobile-meta')
    expect(topbar).toContain('tmb-net')
    expect(topbar).toContain('tmb-vaults')
    expect(topbar).toMatch(/\.tmb-mobile-meta\s*\{[\s\S]*?display:\s*inline-flex/)
    // The launcher must not render its own status row / second clock.
    expect(launcher).not.toContain('mla-status')
    expect(launcher).not.toContain('mla-clock')
    expect(launcher).not.toContain('mla-vault-count')
  })

  it('respects the notch/safe-area at the top (shell owns the inset)', () => {
    // The bar is the slim `--mobile-header-h` status strip; the notch itself
    // is `.cybermanju-shell`'s safe-area padding, so the bar never grows
    // around it — and every fixed sheet top lands exactly on its bottom edge.
    expect(topbar).toContain('var(--mobile-header-h)')
    expect(topbar).not.toMatch(/height:\s*calc\(\d+px \+ env\(safe-area-inset-top/)
    const shell = fs.readFileSync('src/App.vue', 'utf8')
    expect(shell).toContain('class="cybermanju-shell"')
    const ui = fs.readFileSync('src/assets/ui.css', 'utf8')
    expect(ui).toMatch(/\.cybermanju-shell\s*\{[\s\S]*?padding-top:\s*env\(safe-area-inset-top/)
    expect(ui).toMatch(
      /top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ var\(--mobile-header-h\)\)/,
    )
  })

  it('keeps one unified home search and workspace entry point', () => {
    expect(launcher).toContain('<HomeCommandBar')
    expect(launcher.match(/<OmniSearchPanel\b/g)).toHaveLength(1)
    expect(launcher).toContain('<section id="home-search-tools"')
    expect(launcher).not.toContain('v-if="searchToolsOpen"')
    expect(studio).toContain('openPicker')
    expect(studio).toContain('aria-label="Add apps or widgets to home"')
  })

  it('uses native press-dim feedback and clear app-search wording', () => {
    expect(launcher).toContain('if (longPressedHome)')
    expect(launcher).toContain('if (contextMenuFired)')
    expect(studio).toContain('emptyPress.newPointer')
    expect(launcher).toContain('<OmniSearchPanel ref="searchRef" home')
    expect(launcher).toContain('HomeWorkspaceStudio')
  })

  it('shows a flex-pinned favorites dock without fixed positioning', () => {
    expect(launcher).toContain('class="mla-dock"')
    expect(launcher).toMatch(/\.mla-dock\s*\{[^}]*flex-shrink:\s*0/)
    expect(launcher).not.toMatch(/\.mla-dock\s*\{[^}]*position:\s*fixed/)
  })
})

describe('iOS tab bar', () => {
  it('adds a home indicator and haptics on every tab', () => {
    expect(nav).toContain('mn-home')
    // Both goHome and go vibrate.
    const vibrateCount = (nav.match(/vibrate\?\.?\(/g) ?? []).length
    expect(vibrateCount).toBeGreaterThanOrEqual(2)
    expect(nav).toMatch(/blur\(28px\)/)
  })
})

describe('iOS native scaffold (P2-16)', () => {
  const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  const runbook = fs.readFileSync('docs/IOS.md', 'utf8')

  it('sets the iOS deployment floor', () => {
    expect(conf.bundle.iOS.minimumSystemVersion).toBe('17.0')
  })

  it('keeps the mobile IPC set transport-complete (no dashboard on iOS)', () => {
    const tauri = fs.readFileSync('src/composables/useTauri.ts', 'utf8')
    for (const cmd of ['list_devices', 'list_todos', 'list_lan_peers']) {
      expect(tauri).toContain(`'${cmd}'`)
    }
  })

  it('documents the ATS exception + backup parity + signing gap honestly', () => {
    expect(runbook).toContain('NSAllowsLocalNetworking')
    expect(runbook).toContain('NSURLIsExcludedFromBackupKey')
    expect(runbook).toContain('ios-build')
  })

  it('ships the iOS native configure + unsigned device build path', () => {
    const configure = fs.readFileSync('scripts/ios-configure.sh', 'utf8')
    expect(configure).toContain('minimumSystemVersion')
    expect(configure).toContain('NSAllowsLocalNetworking')
    const signing = fs.readFileSync('scripts/ios-signing.sh', 'utf8')
    for (const verb of ['prepare)', 'verify)', 'cleanup)']) {
      expect(signing).toContain(verb)
    }
    expect(signing).toContain('REQUIRE_SIGNING')
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
    const iosJob = ci.slice(
      ci.indexOf('  ios-build:'),
      ci.indexOf('  macos-build:'),
    )
    expect(iosJob).toContain('ios-build:')
    expect(iosJob).toContain('macos-latest')
    expect(iosJob).toContain('tauri ios init')
    expect(iosJob).toContain(
      'npx tauri ios build --ci --target aarch64 --no-sign',
    )
    expect(iosJob).toContain('xcrun otool -l')
  })

  it('always uploads an unsigned device IPA without App Store export', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
    const iosJob = ci.slice(
      ci.indexOf('  ios-build:'),
      ci.indexOf('  macos-build:'),
    )
    expect(iosJob).toContain('dist-ios-device-unsigned/*.ipa')
    expect(iosJob).toContain('Payload/')
    expect(iosJob).toContain('--target aarch64 --no-sign')
    expect(iosJob).toContain('embedded.mobileprovision')
    expect(iosJob).toContain('codesign -dv --verbose=4')
    expect(iosJob).not.toMatch(/^\s*run:\s*.*--export-method/m)
    expect(iosJob).not.toMatch(/^\s*run:\s*.*--archive-only/m)
  })
})
