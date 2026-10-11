// iOS-aesthetic mobile contract, derived from the iOS4Android reference
// (cloned to /tmp, never into the repo): paged springboard with dots,
// three-zone status bar, squircle icons, dock + home indicator, and an
// iOS-style tab bar with haptics. Pins structure, not pixels.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const launcher = fs.readFileSync('src/components/MobileLauncher.vue', 'utf8')
const nav = fs.readFileSync('src/components/MobileNav.vue', 'utf8')
const topbar = fs.readFileSync('src/components/TopMenuBar.vue', 'utf8')

describe('iOS springboard pager (PageView + IconGrid homage)', () => {
  it('chunks apps into pages of 8 (2 rows x 4)', () => {
    expect(launcher).toContain('MLA_PAGE_SIZE = 8')
    expect(launcher).toMatch(/filtered\.value\.slice\(i, i \+ MLA_PAGE_SIZE\)/)
  })

  it('renders a horizontal snap pager with dots', () => {
    expect(launcher).toContain('mla-pages')
    expect(launcher).toContain('mla-grid')
    expect(launcher).toMatch(/scroll-snap-type:\s*x mandatory/)
    expect(launcher).toContain('mla-dots')
    expect(launcher).toContain('mla-page-dot')
    expect(launcher).toContain('goToPage')
  })

  it('resets to the first page on a new search', () => {
    expect(launcher).toMatch(/watch\(filtered/)
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

  it('respects the notch/safe-area at the top', () => {
    expect(topbar).toContain('env(safe-area-inset-top')
  })

  it('uses squircle icon corners with a top-light gloss', () => {
    expect(launcher).toMatch(/\.mla-tile\s*\{[\s\S]*?border-radius:\s*16px/)
    expect(launcher).toContain('.mla-tile::before')
    expect(launcher).toMatch(/\.mla-dock-icon\s*\{[\s\S]*?border-radius:\s*15px/)
  })

  it('keeps springboard density tight (page 1 + dock fit a phone viewport)', () => {
    expect(launcher).toMatch(/\.mla\s*\{[\s\S]*?gap:\s*16px/)
    expect(launcher).toMatch(/\.mla-title\s*\{[^}]*clamp\(24px/)
    expect(launcher).toMatch(/\.mla-grid\s*\{[\s\S]*?gap:\s*16px 7px/)
  })

  it('uses native press-dim feedback and iOS Spotlight wording', () => {
    expect(launcher).toMatch(/\.mla-app:active\s*\{[^}]*brightness\(0\.92\)/)
    expect(launcher).toContain('placeholder="Search"')
    expect(launcher).toMatch(/\.mla-dock-icon\s*\{[\s\S]*?width:\s*52px/)
  })

  it('shows a dock and a home-indicator pill', () => {
    expect(launcher).toContain('mla-dock')
    expect(launcher).toContain('mla-home')
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
