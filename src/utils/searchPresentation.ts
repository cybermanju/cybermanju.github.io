// CyberManju OS — Search presentation (src/utils/searchPresentation.ts).
// Role: keep category filtering, shared selection, counts, and bounded paging consistent across search surfaces.
// Exports: SearchCategory, SEARCH_CATEGORIES, countSearchCategories, filterSearchSections, sharedSearchCategory, sharedSearchVisibleRows, resetSearchVisibleRows.
// Integrates: Vue refs/watchers; Omni search section data.
// Contracts: category filtering never changes the all-local count used by fallback; counts include every matching local row.
import { ref, type Ref } from 'vue'
import type { OmniSectionId } from './omniSearch'

export type SearchCategory = 'all' | 'apps' | 'files' | 'people' | 'collections' | 'providers' | 'web'
export const SEARCH_CATEGORIES: ReadonlyArray<{ id: SearchCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'apps', label: 'Apps' },
  { id: 'files', label: 'Files' },
  { id: 'people', label: 'People' },
  { id: 'collections', label: 'Collections' },
  { id: 'providers', label: 'Providers' },
  { id: 'web', label: 'Web' },
]

export interface SearchPresentationRow { name: string; sub?: string }
export interface SearchPresentationSection<T extends SearchPresentationRow = SearchPresentationRow> {
  id: OmniSectionId
  rows: T[]
}
export type SearchCategoryCounts = Record<SearchCategory, number>

const SECTION_CATEGORIES: Record<OmniSectionId, Exclude<SearchCategory, 'all' | 'web'>> = {
  apps: 'apps', folders: 'files', files: 'files', content: 'files',
  people: 'people', collections: 'collections', providers: 'providers',
}

export function countSectionRows(query: string, rows: SearchPresentationRow[]): number {
  const needle = query.trim().toLowerCase()
  return rows.reduce((sum, row) => sum + (needle === '' || `${row.name}\n${row.sub ?? ''}`.toLowerCase().includes(needle) ? 1 : 0), 0)
}

export function countSearchCategories(
  query: string,
  input: Record<OmniSectionId, SearchPresentationRow[]>,
  webCount = 0,
): SearchCategoryCounts {
  const counts: SearchCategoryCounts = { all: 0, apps: 0, files: 0, people: 0, collections: 0, providers: 0, web: Math.max(0, webCount) }
  for (const [section, rows] of Object.entries(input) as Array<[OmniSectionId, SearchPresentationRow[]]>) {
    const count = countSectionRows(query, rows)
    counts[SECTION_CATEGORIES[section]] += count
    counts.all += count
  }
  counts.all += counts.web
  return counts
}

export function filterSearchSections<T extends SearchPresentationRow>(
  sections: SearchPresentationSection<T>[], category: SearchCategory,
): SearchPresentationSection<T>[] {
  if (category === 'all') return sections
  if (category === 'web') return []
  return sections.filter(({ id }) => SECTION_CATEGORIES[id] === category)
}

export const INITIAL_ROWS_PER_SECTION = 6
export const ROWS_PER_PAGE = 20
export const MAX_VISIBLE_ROWS_PER_SECTION = 100

// Both home and window instances join this module-scoped reactive state.
const selectedCategory = ref<SearchCategory>('all')
const sharedVisibleRows = ref<Record<OmniSectionId, number>>({ apps: INITIAL_ROWS_PER_SECTION, collections: INITIAL_ROWS_PER_SECTION, people: INITIAL_ROWS_PER_SECTION, providers: INITIAL_ROWS_PER_SECTION, folders: INITIAL_ROWS_PER_SECTION, files: INITIAL_ROWS_PER_SECTION, content: INITIAL_ROWS_PER_SECTION })
export function sharedSearchCategory(): Ref<SearchCategory> { return selectedCategory }
export function sharedSearchVisibleRows(): Ref<Record<OmniSectionId, number>> { return sharedVisibleRows }
export function resetSearchVisibleRows(target = sharedVisibleRows.value): void {
  Object.assign(target, { apps: INITIAL_ROWS_PER_SECTION, collections: INITIAL_ROWS_PER_SECTION, people: INITIAL_ROWS_PER_SECTION, providers: INITIAL_ROWS_PER_SECTION, folders: INITIAL_ROWS_PER_SECTION, files: INITIAL_ROWS_PER_SECTION, content: INITIAL_ROWS_PER_SECTION })
}

export function nextVisibleRowCount(current: number, total: number): number {
  return Math.min(Math.max(0, total), MAX_VISIBLE_ROWS_PER_SECTION, Math.max(INITIAL_ROWS_PER_SECTION, current) + ROWS_PER_PAGE)
}
