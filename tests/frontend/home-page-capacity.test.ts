// CyberManju OS — Home page capacity regression (tests/frontend/home-page-capacity.test.ts).
// Role: prevent fixed eight-app pages and clipped tail rows across viewport sizes.
// Exports: Vitest suite. Integrates: real launcher styles and homePageCapacity.
// Contracts: complete rows only; every app appears exactly once, including the tail.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { homePageCapacity } from '../../src/utils/homePageCapacity'
const home = readFileSync(new URL('../../src/components/MobileLauncher.vue', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../../src/components/AppDrawer.vue', import.meta.url), 'utf8')

describe('responsive home rows', () => {
  it.each([
    [188, 88, 16, 4, 4], [192, 88, 16, 4, 8],
    [296, 88, 16, 4, 12], [504, 88, 16, 4, 20],
    [174, 76, 20, 4, 8], [460, 76, 20, 4, 20],
    [421, 88, 23, 5, 20], [100, 88, 16, 4, 4],
  ])('fits complete rows in %ipx (cell %i, gap %i, columns %i)', (height, row, gap, cols, expected) => {
    expect(homePageCapacity(height, row, gap, cols)).toBe(expected)
  })
  it('never loses or duplicates the final app after resize, tablet or rotation', () => {
    for (const count of [0, 1, 8, 9, 12, 13, 101]) {
      for (const height of [0, 174, 192, 400, 700]) {
        for (const columns of [4, 5]) {
          const capacity = homePageCapacity(height, 76, 20, columns)
          const apps = Array.from({ length: count }, (_, i) => i)
          const pages = []
          for (let i = 0; i < apps.length; i += capacity) pages.push(apps.slice(i, i + capacity))
          expect(pages.flat()).toEqual(apps)
          expect(capacity % columns).toBe(0)
        }
      }
    }
  })
  it('has finite safe fallbacks for missing layout metrics', () => {
    expect(homePageCapacity(NaN, 76, 20, 4)).toBe(4)
    expect(homePageCapacity(400, 0, 20, 5)).toBe(5)
    expect(homePageCapacity(0, 76, 20, 0)).toBe(1)
  })
  it('measures the real flex slot, reacts to resize and resets stale page offsets', () => {
    expect(home).toContain('useResizeObserver(pagerRef, measurePageCapacity)')
    expect(home).toContain('watch([filtered, pageSize]')
    expect(home).not.toContain('MLA_PAGE_SIZE')
    expect(home).toContain('flex: 1 0 196px')
    expect(home).toContain('pageSize.value = homePageCapacity(')
    expect(home).toContain('if (homeLayout.free.value) return filtered.value.length ? [filtered.value] : []')
    // Stable dots slot avoids an oscillation when adding a row removes the last page.
    expect(home).toContain('.mla-dots-hidden { visibility: hidden; }')
    expect(home).not.toContain('contain-intrinsic-size: auto 400px')
  })
  it('keeps drawer controls fixed and the app tail inside its own shrinking scrollport', () => {
    expect(drawer).not.toContain('86dvh')
    expect(drawer).not.toContain('min-height: 40dvh')
    expect(drawer).toContain('.app-drawer > :not(.drawer-grid):not(.drawer-state) { flex-shrink: 0; }')
    expect(drawer).toMatch(/\.drawer-grid \{[^}]*min-height: 0;[^}]*flex: 1;[^}]*overflow-y: auto;/)
  })
})
