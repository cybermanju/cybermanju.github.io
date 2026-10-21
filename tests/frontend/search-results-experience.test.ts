// CyberManju OS — Search results experience tests (tests/frontend/search-results-experience.test.ts).
// Role: cover category counts/filtering, cross-surface presentation state, bounded paging, and rich-result accessibility contracts.
// Exports: none (Vitest suite).
// Integrates: searchPresentation pure helpers, Vue compiler, OmniSearchPanel SFC.
// Contracts: category selection never changes local fallback counts; web links and rich controls retain semantic/native behavior.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import {
  countSearchCategories,
  countSectionRows,
  filterSearchSections,
  INITIAL_ROWS_PER_SECTION,
  MAX_VISIBLE_ROWS_PER_SECTION,
  nextVisibleRowCount,
  resetSearchVisibleRows,
  sharedSearchCategory,
  sharedSearchVisibleRows,
  type SearchPresentationRow,
} from '../../src/utils/searchPresentation'
import type { OmniSectionId } from '../../src/utils/omniSearch'

const input: Record<OmniSectionId, SearchPresentationRow[]> = {
  apps: [{ name: 'Files app', sub: 'Browse documents' }, { name: 'Camera' }],
  collections: [{ name: 'Work collection' }],
  people: [{ name: 'Ari' }],
  providers: [{ name: 'Cloud drive' }],
  folders: [{ name: 'Work folder', sub: '/home/work' }],
  files: [{ name: 'Report.pdf', sub: '/home/work/report.pdf' }],
  content: [{ name: 'Report.pdf', sub: 'annual work results' }],
}
const sections = (Object.entries(input) as Array<[OmniSectionId, SearchPresentationRow[]]>).map(([id, rows]) => ({ id, rows }))

describe('search result presentation helpers', () => {
  it('keeps accurate category totals, groups folders/files/content, and counts web separately', () => {
    const counts = countSearchCategories('work', input, 3)
    expect(counts).toEqual({ all: 7, apps: 0, files: 3, people: 0, collections: 1, providers: 0, web: 3 })
    expect(countSectionRows(' REPORT ', input.content)).toBe(1)
    expect(countSearchCategories('work', input).all).toBe(4) // local-only count supplied to fallback
  })

  it('filters sections without mutating the all-results source and supports web-only intent', () => {
    expect(filterSearchSections(sections, 'files').map(({ id }) => id)).toEqual(['folders', 'files', 'content'])
    expect(filterSearchSections(sections, 'apps').map(({ id }) => id)).toEqual(['apps'])
    expect(filterSearchSections(sections, 'web')).toEqual([])
    expect(sections).toHaveLength(7)
  })

  it('shares selected category and expansion state between home and window and resets expansion on query changes', () => {
    const homeCategory = sharedSearchCategory()
    const windowCategory = sharedSearchCategory()
    const homeRows = sharedSearchVisibleRows()
    const windowRows = sharedSearchVisibleRows()
    expect(homeCategory).toBe(windowCategory)
    expect(homeRows).toBe(windowRows)
    homeCategory.value = 'files'
    homeRows.value.files = 46
    expect(windowCategory.value).toBe('files')
    expect(windowRows.value.files).toBe(46)
    resetSearchVisibleRows()
    expect(windowRows.value.files).toBe(INITIAL_ROWS_PER_SECTION)
    homeCategory.value = 'all'
  })

  it('pages in bounded increments and never reveals more than the configured cap', () => {
    expect(nextVisibleRowCount(INITIAL_ROWS_PER_SECTION, 90)).toBe(26)
    expect(nextVisibleRowCount(86, 200)).toBe(MAX_VISIBLE_ROWS_PER_SECTION)
    expect(nextVisibleRowCount(MAX_VISIBLE_ROWS_PER_SECTION, 200)).toBe(MAX_VISIBLE_ROWS_PER_SECTION)
    expect(nextVisibleRowCount(6, 2)).toBe(2)
  })
})

describe('OmniSearchPanel compiled template and behavior contracts', () => {
  const source = readFileSync(new URL('../../src/components/OmniSearchPanel.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source, { filename: 'OmniSearchPanel.vue' })
  const compiled = compileTemplate({ source: descriptor.template?.content ?? '', filename: 'OmniSearchPanel.vue', id: 'omni-search-test' })

  it('compiles one well-formed SFC template and exposes touch-friendly category controls without a rich listbox', () => {
    expect(errors).toEqual([])
    expect(compiled.errors).toEqual([])
    expect(source.match(/<template>/g)).toHaveLength(1)
    expect(source).toContain('aria-label="Filter search results"')
    expect(source).toContain(':aria-pressed="category === filter.id"')
    expect(source).not.toContain('role="listbox"')
    expect(source).not.toContain('role="option"')
  })

  it('keeps local navigation separate from native web anchors and presents actionable, honest result content', () => {
    expect(source).toContain('handleSearchLink(event, url)')
    expect(source).toContain('openSearchLink(url)')
    expect(source).toContain('target="_blank" rel="noopener noreferrer"')
    expect(source).toContain('@click="handleWebLink($event, result.url)"')
    expect(source).toContain('@keydown.enter.space.prevent="openAnswerLink')
    expect(source).toContain('Copy answer')
    expect(source).toContain('Copy link')
    expect(source).toContain('Open DuckDuckGo results for this query')
    expect(source).toContain('answerDestination')
    expect(source).toContain('Show in files')
    expect(source).toContain('openCtx($event, sec.id, row)')
    expect(source).toContain('category === \'web\'')
    expect(source).toContain('const localCount = computed(() => countSearchCategories(q.value, sectionInput.value).all)')
    expect(source).toContain('unified.webQuery.value !== q')
    expect(source).toContain('resetSearchVisibleRows(visibleBySection.value)')
  })
})

// Visual regressions: a shrinking horizontal scroller can hide every pill's
// label while remaining 'visible' to DOM tests; shadows are not CSS colors.
it('keeps category controls unshrunk and glass colors well typed', () => {
  const source = readFileSync(new URL('../../src/components/OmniSearchPanel.vue', import.meta.url), 'utf8')
  expect(source).toMatch(/\.omni-filters\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*52px/)
  expect(source).not.toMatch(/border-color:\s*var\(--ui-glass-edge/)
  expect(source).toContain('role="region" aria-label="Search results"')
  expect(source).toContain('.omni--glass.omni--solid .omni-drop')
  expect(source).not.toContain(':global(html[data-ui-glass=')
})
