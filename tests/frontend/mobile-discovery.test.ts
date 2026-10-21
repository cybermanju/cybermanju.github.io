// CyberManju OS — mobile discovery layouts (tests/frontend/mobile-discovery.test.ts).
// Role: pin responsive layouts, touch targets, and access to search, messages, people, map, and organize surfaces.
// Exports: none.
// Integrates: Vue SFC source, Vitest.
// Contracts: keep the assigned discovery panels usable from 320–768px without changing desktop behavior.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const components = {
  messages: readFileSync('src/components/MessagesHub.vue', 'utf8'),
  omni: readFileSync('src/components/OmniSearchPanel.vue', 'utf8'),
  search: readFileSync('src/components/SearchPanel.vue', 'utf8'),
  faces: readFileSync('src/components/FaceGroupingPanel.vue', 'utf8'),
  organize: readFileSync('src/components/OrganizePanel.vue', 'utf8'),
  map: readFileSync('src/components/MapView.vue', 'utf8'),
  window: readFileSync('src/components/WindowContent.vue', 'utf8'),
}

function scopedCss(source: string): string {
  return source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
}

const css = Object.fromEntries(Object.entries(components).map(([key, source]) => [key, scopedCss(source)]))

describe('phone discovery and information panels', () => {
  it('keeps the message sheet, tabs, close action, list, and footer usable on touch screens', () => {
    expect(css.messages).toContain('@media (max-width: 768px)')
    expect(css.messages).toMatch(/\.msg-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px/)
    expect(css.messages).toMatch(/\.msg-tab\s*\{[^}]*min-height:\s*44px/)
    expect(css.messages).toMatch(/\.msg-foot\s*\{\s*flex-wrap:\s*wrap/)
    expect(css.messages).toContain('env(safe-area-inset-bottom')
  })

  it('keeps unified search results scrollable and its editing controls wrapped at phone widths', () => {
    expect(css.omni).toContain('@media (max-width: 768px)')
    expect(css.omni).toMatch(/\.omni-drop, \.omni--home \.omni-drop\s*\{[^}]*max-height:\s*max\(0px,\s*calc\(var\(--omni-mobile-results-height/)
    expect(css.omni).toMatch(/\.omni-inline\s*\{\s*flex-wrap:\s*wrap/)
    expect(css.omni).toMatch(/\.omni-row\s*\{\s*min-height:\s*60px/)
    expect(components.omni).toContain('aria-label="Search results"')
  })

  it('preserves searchable file results and makes the standard search filters touch-accessible', () => {
    expect(css.search).toContain('@media (max-width: 768px)')
    expect(css.search).toMatch(/\.search-toolbar :deep\(button\), \.search-toolbar :deep\(select\), \.search-toolbar :deep\(input\)\s*\{[^}]*min-height:\s*44px/)
    expect(css.search).toMatch(/\.search-filter-scroller\s*\{[^}]*width:\s*100%/)
    expect(css.search).toMatch(/\.search-result-item\s*\{\s*min-height:\s*48px/)
  })

  it('bounds long people lists in an independently touch-scrollable roster so selected-person detail remains reachable', () => {
    expect(css.faces).toContain('@media (max-width: 768px)')
    expect(css.faces).toMatch(/\.spot-list\s*\{[^}]*max-height:\s*min\(38dvh,\s*360px\)[^}]*overflow-y:\s*auto/)
    expect(css.faces).toMatch(/\.spot-people\s*\{[^}]*overflow-y:\s*auto/)
    expect(css.faces).toMatch(/\.spot-detail__actions :deep\(button\), \.spot-foot :deep\(button\)\s*\{[^}]*min-height:\s*48px/)
    expect(components.faces).toContain('class="spot-detail"')
  })

  it('wraps Organize forms and preserves finger-sized selectors and file chips on mobile', () => {
    expect(css.organize).toContain('@media (max-width: 768px)')
    expect(css.organize).toContain('flex-wrap: wrap')
    expect(css.organize).toMatch(/\.org-panel :deep\(input\), \.org-panel :deep\(select\)\s*\{[^}]*min-height:\s*44px/)
    expect(css.organize).toMatch(/\.lg-member\s*\{[^}]*min-height:\s*44px/)
  })

  it('wraps the geography controls and list on narrow phones while retaining interactive map and marker rows', () => {
    expect(css.map).toContain('@media (max-width: 768px)')
    expect(css.map).toContain('@media (max-width: 420px)')
    expect(css.map).toMatch(/\.panel-header\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css.map).toMatch(/\.refresh-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/)
    expect(components.map).toContain('class="maplibre-map"')
    expect(components.map).toContain('class="geo-list-item"')
  })

  it('gives WindowContent rows and their actions enough room without blocking panel scrolling', () => {
    expect(css.window).toContain('@media (max-width: 768px)')
    expect(css.window).toMatch(/\.window-content-panel\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/)
    expect(css.window).toMatch(/\.trash-item, \.recent-item\s*\{[^}]*min-height:\s*52px/)
    expect(css.window).toMatch(/\.trash-actions :deep\(button\), \.recent-item :deep\(button\)\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px/)
  })
})
