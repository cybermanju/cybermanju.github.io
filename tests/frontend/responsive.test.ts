// Responsive contract: every panel must stay usable in a narrow window and
// on phones. Viewport `@media` queries never fire for a small floating
// window on a wide monitor, so `AppWindow` mirrors the breakpoint as
// `.app-window--narrow` and `src/assets/ui.css` carries the per-window
// collapse rules next to the viewport ones. This test pins that pairing:
// every collapse behavior must exist in BOTH forms.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const css = fs.readFileSync('src/assets/ui.css', 'utf8')

function viewportBlock(): string {
  const start = css.indexOf('@media (max-width: 768px)')
  const narrow = css.indexOf('── narrow windows')
  expect(start, 'missing @media (max-width: 768px) sheet block').toBeGreaterThanOrEqual(0)
  expect(narrow, 'missing narrow-window section').toBeGreaterThan(start)
  return css.slice(start, narrow)
}

function narrowBlock(): string {
  const narrow = css.indexOf('── narrow windows')
  expect(narrow, 'missing narrow-window section').toBeGreaterThanOrEqual(0)
  return css.slice(narrow)
}

describe('mobile sheets (viewport)', () => {
  it('pins windows to fullscreen sheets with no drag/resize', () => {
    const v = viewportBlock()
    expect(v).toMatch(/\.app-window\s*\{[^}]*position:\s*fixed/)
    expect(v).toMatch(/\.resize-handle\s*\{[^}]*display:\s*none/)
    expect(v).toMatch(/\.dock-container[\s\S]*?display:\s*none/)
  })

  it('keeps tab strips swipeable and controls at touch sizes', () => {
    const v = viewportBlock()
    for (const tabs of ['\\.am-tabs', '\\.dm-tabs', '\\.org-tabs', '\\.sh-tabs']) {
      expect(v, `${tabs} must scroll horizontally`).toMatch(new RegExp(`${tabs}[\\s\\S]*?overflow-x:\\s*auto`))
    }
    expect(v).toMatch(/min-height:\s*44px/)
    expect(v).toMatch(/font-size:\s*16px/)
  })

  it('scrolls wide surfaces inside the sheet instead of widening it', () => {
    const v = viewportBlock()
    expect(v).toMatch(/\.task-table[\s\S]*?overflow-x:\s*auto/)
    expect(v).toMatch(/\.tf-canvas[\s\S]*?min-width:\s*440px/)
  })
})

describe('narrow windows (container)', () => {
  // Every collapse behavior needs a window-width twin: viewport queries
  // cannot see floating-window geometry.
  const twins: Array<[string, RegExp]> = [
    ['file manager single column', /\.app-window--narrow\s+\.fm-main[\s\S]*?grid-template-columns:\s*1fr/],
    ['file manager rails hidden', /\.app-window--narrow\s+\.fm-side/],
    ['code studio rails hidden', /\.app-window--narrow\s+\.cs-ai/],
    ['tab strips scroll', /\.app-window--narrow\s+\.org-tabs/],
    ['stats grid halves', /\.app-window--narrow\s+\.stats-grid/],
    ['disk cards stack', /\.app-window--narrow\s+\.disk-panel\s+\.cards/],
    ['process table scrolls', /\.app-window--narrow\s+\.task-table/],
    ['transfer canvas shrinks', /\.app-window--narrow\s+\.tf-canvas/],
    ['api locators wrap', /\.app-window--narrow\s+\.api-path/],
  ]

  for (const [label, re] of twins) {
    it(`covers narrow windows: ${label}`, () => {
      expect(narrowBlock(), label).toMatch(re)
    })
  }

  it('hides the same code-studio rails as the 860px viewport rule', () => {
    const studio = fs.readFileSync('src/components/CodeStudio.vue', 'utf8')
    expect(studio).toMatch(/@media\s*\(max-width:\s*860px\)[^{]*\{[^}]*\.cs-ai/)
    expect(narrowBlock()).toMatch(/\.app-window--narrow\s+\.cs-side/)
  })
})

describe('mobile home + nav wiring', () => {
  it('renders the launcher under the sheets and the bottom nav above them', () => {
    const shell = fs.readFileSync('src/components/DesktopShell.vue', 'utf8')
    expect(shell).toMatch(/<MobileLauncher/)
    const app = fs.readFileSync('src/App.vue', 'utf8')
    expect(app).toMatch(/<MobileNav\s*\/>/)
    const nav = fs.readFileSync('src/components/MobileNav.vue', 'utf8')
    for (const tab of ['Home', 'Files', 'Search', 'Agent', 'Vaults', 'Settings']) {
      expect(nav, `missing ${tab} tab`).toContain(tab)
    }
    expect(nav).toMatch(/env\(safe-area-inset-bottom/)
  })
})
