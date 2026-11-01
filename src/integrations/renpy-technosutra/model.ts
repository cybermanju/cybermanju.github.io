// CyberManju OS — Technosutra Ren'Py model (src/integrations/renpy-technosutra/model.ts).
// Role: validate local source/route data and render owner-provided Markdown as a Ren'Py export.
// Exports: project manifest types, storage codecs, Street View URL builder, Markdown blocks and Ren'Py renderer.
// Integrates: standalone TypeScript; no OS backend, network API, media or voice runtime.
// Contracts: never invent story text or image assets; PDF text is not parsed; export requires verified adaptation rights.

export const TECHNOSUTRA_STORAGE_KEY = 'cybermanju.technosutra.project.v1'
export const TECHNOSUTRA_SCHEMA_VERSION = 1 as const
export const MAX_MARKDOWN_BYTES = 512 * 1024

export type SourceFormat = 'markdown' | 'pdf'
export type AdaptationRightsStatus = 'unverified' | 'authorized-for-adaptation'
export type ArtworkRightsType = 'owner-original' | 'licensed'

export interface SourceMaterial {
  id: string
  name: string
  format: SourceFormat
  sizeBytes: number
  addedAt: string
  /** Only an explicit owner attestation or rights check can enable a narrative export. */
  adaptationRights: AdaptationRightsStatus
  /** Present only when the owner explicitly imports a Markdown text file. */
  markdownText?: string
}

/** Metadata-only slot for owner-original or licensed art; no Google Street View imagery is allowed. */
export interface ArtworkAssetReference {
  id: string
  fileName: string
  purpose: 'background' | 'character' | 'illustration' | 'other'
  rights: ArtworkRightsType
  license?: string
  attribution?: string
}

export interface RoutePoint {
  id: string
  title: string
  latitude: number
  longitude: number
  heading?: number
  panoramaId?: string
}

export interface TechnosutraProject {
  schemaVersion: typeof TECHNOSUTRA_SCHEMA_VERSION
  title: 'Technosutra'
  sourceMaterials: SourceMaterial[]
  routePoints: RoutePoint[]
  artworkAssets: ArtworkAssetReference[]
}

export interface MarkdownBlock {
  text: string
  sourceName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Create a genuinely empty project shell: no sample prose, scenes, routes or images. */
export function createEmptyProject(): TechnosutraProject {
  return { schemaVersion: TECHNOSUTRA_SCHEMA_VERSION, title: 'Technosutra', sourceMaterials: [], routePoints: [], artworkAssets: [] }
}

/** Parse saved local state conservatively; malformed records are ignored rather than guessed. */
export function parseProject(raw: string | null | undefined): TechnosutraProject {
  if (!raw) return createEmptyProject()
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.schemaVersion !== TECHNOSUTRA_SCHEMA_VERSION) return createEmptyProject()
    const sources = Array.isArray(value.sourceMaterials) ? value.sourceMaterials.flatMap((row): SourceMaterial[] => {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string' ||
          !['markdown', 'pdf'].includes(String(row.format)) || !Number.isFinite(row.sizeBytes) ||
          typeof row.addedAt !== 'string') return []
      const format = row.format as SourceFormat
      const source: SourceMaterial = {
        id: row.id.slice(0, 160),
        name: row.name.slice(0, 240),
        format,
        sizeBytes: Math.max(0, Math.min(Number(row.sizeBytes), Number.MAX_SAFE_INTEGER)),
        addedAt: row.addedAt.slice(0, 64),
        adaptationRights: row.adaptationRights === 'authorized-for-adaptation' ? 'authorized-for-adaptation' : 'unverified',
      }
      if (format === 'markdown' && typeof row.markdownText === 'string' &&
          new TextEncoder().encode(row.markdownText).byteLength <= MAX_MARKDOWN_BYTES) {
        source.markdownText = row.markdownText
      }
      return [source]
    }).slice(0, 64) : []
    const routes = Array.isArray(value.routePoints) ? value.routePoints.flatMap((row): RoutePoint[] => {
      if (!isRecord(row)) return []
      const point = validateRoutePoint(row)
      return point ? [point] : []
    }).slice(0, 200) : []
    const artworkAssets = Array.isArray(value.artworkAssets) ? value.artworkAssets.flatMap((row): ArtworkAssetReference[] => {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.fileName !== 'string' ||
          !['background', 'character', 'illustration', 'other'].includes(String(row.purpose)) ||
          !['owner-original', 'licensed'].includes(String(row.rights))) return []
      return [{
        id: row.id.slice(0, 160),
        fileName: row.fileName.slice(0, 240),
        purpose: row.purpose as ArtworkAssetReference['purpose'],
        rights: row.rights as ArtworkRightsType,
        ...(typeof row.license === 'string' ? { license: row.license.slice(0, 240) } : {}),
        ...(typeof row.attribution === 'string' ? { attribution: row.attribution.slice(0, 500) } : {}),
      }]
    }).slice(0, 200) : []
    return { schemaVersion: TECHNOSUTRA_SCHEMA_VERSION, title: 'Technosutra', sourceMaterials: sources, routePoints: routes, artworkAssets }
  } catch {
    return createEmptyProject()
  }
}

/** Load this app's isolated project state from browser-local storage only. */
export function loadProject(storage?: Pick<Storage, 'getItem'> | null): TechnosutraProject {
  const target = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage
  try { return parseProject(target?.getItem(TECHNOSUTRA_STORAGE_KEY)) } catch { return createEmptyProject() }
}

/** Save project state only under this app's namespaced localStorage key. */
export function saveProject(project: TechnosutraProject, storage?: Pick<Storage, 'setItem'> | null): boolean {
  const target = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage
  if (!target) return false
  try {
    target.setItem(TECHNOSUTRA_STORAGE_KEY, JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

/** Validate a manually entered Street View waypoint without rounding its coordinates. */
export function validateRoutePoint(value: unknown): RoutePoint | null {
  if (!isRecord(value)) return null
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 120) : ''
  const latitude = Number(value.latitude)
  const longitude = Number(value.longitude)
  if (!title || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  const point: RoutePoint = {
    id: typeof value.id === 'string' && value.id ? value.id.slice(0, 160) : '',
    title,
    latitude,
    longitude,
  }
  const heading = value.heading === '' || value.heading === undefined || value.heading === null ? undefined : Number(value.heading)
  if (heading !== undefined) {
    if (!Number.isFinite(heading) || heading < -180 || heading > 360) return null
    point.heading = heading
  }
  if (typeof value.panoramaId === 'string' && value.panoramaId.trim()) {
    point.panoramaId = value.panoramaId.trim().slice(0, 240)
  }
  return point
}

/** Construct the official Google Maps URL for a Street View panorama; no image is fetched or embedded. */
export function googleStreetViewUrl(point: RoutePoint): string {
  const params = new URLSearchParams({ api: '1', map_action: 'pano' })
  if (point.panoramaId) params.set('pano', point.panoramaId)
  params.set('viewpoint', `${point.latitude},${point.longitude}`)
  if (point.heading !== undefined) params.set('heading', String(point.heading))
  return `https://www.google.com/maps/@?${params.toString()}`
}

/** Read only explicit Markdown source text; headings and prose are source-derived, not generated. */
export function markdownBlocks(project: TechnosutraProject): MarkdownBlock[] {
  const result: MarkdownBlock[] = []
  for (const source of project.sourceMaterials) {
    if (source.format !== 'markdown' || !source.markdownText) continue
    let paragraph: string[] = []
    let inFence = false
    const flush = () => {
      const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
      if (text) result.push({ text, sourceName: source.name })
      paragraph = []
    }
    for (const rawLine of source.markdownText.replace(/\r\n?/g, '\n').split('\n')) {
      const line = rawLine.trim()
      if (/^\s*(```|~~~)/.test(rawLine)) {
        flush()
        inFence = !inFence
        continue
      }
      if (inFence) {
        if (line) paragraph.push(line)
        continue
      }
      if (!line) {
        flush()
        continue
      }
      const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
      if (heading) {
        flush()
        result.push({ text: heading[1], sourceName: source.name })
        continue
      }
      paragraph.push(line)
    }
    flush()
  }
  return result
}

function renpyString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\[/g, '[[')
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')
    .replace(/[\r\n\t]/g, (char) => char === '\t' ? '    ' : '\\n')
}

/** Generate an inert starter script from imported source text and verified owner-entered waypoints. */
export function renderRenpyScript(project: TechnosutraProject): string {
  const blocks = markdownBlocks(project)
  if (!blocks.length) throw new Error('Add a non-empty Markdown source before exporting a Ren’Py script.')
  const narrativeSources = project.sourceMaterials.filter(source => source.format === 'markdown' && source.markdownText?.trim())
  if (narrativeSources.some(source => source.adaptationRights !== 'authorized-for-adaptation')) {
    throw new Error('Story export is blocked until every Markdown source has verified permission or a license that allows adaptation.')
  }
  const lines = [
    '# Technosutra — generated from owner-supplied Markdown by the local OS integration.',
    '# No dialogue, imagery, music or voice content is generated by this adapter.',
    ...project.sourceMaterials.filter(source => source.format === 'markdown' && source.markdownText)
      .map(source => `# Source file: ${source.name.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 220)}`),
    '',
    'label start:',
  ]
  if (project.routePoints.length) {
    lines.push('    menu:')
    lines.push('        "Continue with the source text":')
    lines.push('            jump technosutra_read_source')
    for (const point of project.routePoints) {
      const label = renpyString(`Open Street View: ${point.title}`)
      const url = renpyString(googleStreetViewUrl(point))
      lines.push(`        "${label}":`)
      lines.push(`            $ renpy.open_url("${url}")`)
      lines.push('            jump technosutra_read_source')
    }
  } else {
    lines.push('    jump technosutra_read_source')
  }
  lines.push('', 'label technosutra_read_source:')
  for (const block of blocks) lines.push(`    "${renpyString(block.text)}"`)
  lines.push('    return', '')
  return lines.join('\n')
}

/** Export a portable metadata manifest without duplicating Markdown source text or image bytes. */
export function exportManifest(project: TechnosutraProject): Omit<TechnosutraProject, 'sourceMaterials'> & { sourceMaterials: Omit<SourceMaterial, 'markdownText'>[] } {
  return {
    schemaVersion: TECHNOSUTRA_SCHEMA_VERSION,
    title: 'Technosutra',
    sourceMaterials: project.sourceMaterials.map(({ id, name, format, sizeBytes, addedAt, adaptationRights }) => ({ id, name, format, sizeBytes, addedAt, adaptationRights })),
    routePoints: project.routePoints.map(point => ({ ...point })),
    artworkAssets: project.artworkAssets.map(asset => ({ ...asset })),
  }
}
