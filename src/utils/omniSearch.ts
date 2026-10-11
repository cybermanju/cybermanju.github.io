// CyberManju OS — Omni search grouping (src/utils/omniSearch.ts).
// Role: pure section ordering for the merged Search window (apps → collections → people → providers → folders → files → content).
// Exports: OmniSectionId, OMNI_SECTION_ORDER, OmniSectionInput, buildOmniSections.
// Integrates: standalone (no imports); rendered by OmniSearchPanel.
// Contracts: order is fixed — apps first, file content last; matching is case-insensitive substring.
export type OmniSectionId =
  | 'apps'
  | 'collections'
  | 'people'
  | 'providers'
  | 'folders'
  | 'files'
  | 'content'

/** Fixed render order: app name > collection/album > person | provider > folder > file name > file content. */
export const OMNI_SECTION_ORDER: OmniSectionId[] = [
  'apps',
  'collections',
  'people',
  'providers',
  'folders',
  'files',
  'content',
]

export const OMNI_SECTION_TAG: Record<OmniSectionId, string> = {
  apps: 'APP',
  collections: 'COLLECTION',
  people: 'PERSON',
  providers: 'PROVIDER',
  folders: 'FOLDER',
  files: 'FILE',
  content: 'CONTENT',
}

export interface OmniRowInput {
  key: string
  name: string
  sub?: string
}

export interface OmniSectionInput {
  id: OmniSectionId
  rows: OmniRowInput[]
}

function matches(query: string, ...texts: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return texts.some((t) => (t ?? '').toLowerCase().includes(q))
}

/**
 * Build the merged dropdown sections in canonical order, already filtered by
 * `query` (empty query returns the top rows of every section). File-content
 * rows arrive pre-ranked from Tantivy BM25 and keep their order.
 */
export function buildOmniSections(
  query: string,
  input: Record<OmniSectionId, OmniRowInput[]>,
  limitPerSection = 6,
): OmniSectionInput[] {
  const take = (id: OmniSectionId, match: (row: OmniRowInput) => boolean): OmniSectionInput => ({
    id,
    rows: input[id].filter(match).slice(0, limitPerSection),
  })
  return [
    take('apps', (r) => matches(query, r.name, r.sub)),
    take('collections', (r) => matches(query, r.name, r.sub)),
    take('people', (r) => matches(query, r.name, r.sub)),
    take('providers', (r) => matches(query, r.name, r.sub)),
    take('folders', (r) => matches(query, r.name, r.sub)),
    take('files', (r) => matches(query, r.name, r.sub)),
    // Content rows are backend-ranked snippets — substring-filter on both
    // the file name and the snippet text so stale rows never leak in.
    take('content', (r) => matches(query, r.name, r.sub)),
  ].filter((s) => s.rows.length > 0)
}
