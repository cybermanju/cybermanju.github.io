// CyberManju OS — Mobile home rendering regressions (tests/frontend/mobile-home-rendering.test.ts).
// Role: protect mobile workspace sizing, icon list mode, orb visibility, and user motion settings.
// Exports: none.
// Integrates: MobileLauncher, HomeLauncher, OmniSearchPanel and Vitest.
// Contracts: home canvas scrolls independently; navigation stays visible; reduced motion follows app preference.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const studio = readFileSync('src/components/HomeLauncher.vue', 'utf8')
const launcher = readFileSync('src/components/MobileLauncher.vue', 'utf8')
const search = readFileSync('src/components/OmniSearchPanel.vue', 'utf8')

describe('mobile home rendering', () => {
  it('keeps the app canvas scrollable while pinning the orb navigation below it', () => {
    expect(studio).toContain('.workspace-content { flex: 1 1 0; min-width: 0; min-height: 0;')
    expect(studio).toContain('overflow-y: auto;')
    expect(studio).toContain('overscroll-behavior: contain;')
    expect(studio).toContain('.screen-nav { position: fixed; left: env(safe-area-inset-left, 0px); right: env(safe-area-inset-right, 0px);')
    expect(studio).toContain('.workspace-grid { display: grid;')
    expect(studio).toContain('<OrbNavigator :screen-index="activeIndex" :screen-count="state.pages.length"')
    expect(studio).toContain('v-if="!orbHiddenOnDesktop && !props.blocked"')
    expect(studio.indexOf('<slot v-if="!editing && !overview" name="home-tools" />')).toBeLessThan(studio.indexOf('<div class="workspace-grid"'))
    expect(studio).not.toContain('feTurbulence')
  })

  it('shows home app icons and uses the application motion preference for animations', () => {
    expect(launcher).toContain("'motion-reduced': motion.reduced.value")
    expect(launcher).not.toContain('@media (prefers-reduced-motion: reduce)')
    expect(search).toContain("'motion-reduced': motion.reduced.value")
    expect(search).toContain('.omni-drop-enter-active { animation: omni-in')
    expect(search).toContain('.omni.motion-reduced .omni-drop-enter-active')
    expect(search).not.toContain('@media (prefers-reduced-motion: reduce)')
  })
})
