// CyberManju OS — Technosutra Ren’Py integration tests (tests/frontend/technosutra-renpy.test.ts).
// Role: protect source fidelity, rights gating, coordinate validation and app-panel separation.
// Exports: none (Vitest suite).
// Integrates: @/integrations/renpy-technosutra/model, @/types, @/utils/panels.
// Contracts: no synthetic story content or Street View media; PDF and voice stay unavailable without real rights/adapters.
import { describe, expect, it } from 'vitest'
import { MODULE_METADATA } from '@/types'
import { resolvePanel } from '@/utils/panels'
import {
  createEmptyProject,
  exportManifest,
  googleStreetViewUrl,
  markdownBlocks,
  parseProject,
  renderRenpyScript,
  validateRoutePoint,
  type SourceMaterial,
} from '@/integrations/renpy-technosutra/model'

function markdownSource(markdownText: string, adaptationRights: SourceMaterial['adaptationRights'] = 'authorized-for-adaptation'): SourceMaterial {
  return { id: 'source-1', name: 'supplied.md', format: 'markdown', sizeBytes: markdownText.length, addedAt: '2026-11-01T12:00:00.000Z', adaptationRights, markdownText }
}

describe('Technosutra Ren’Py bridge', () => {
  it('starts with empty story/art/route slots and has a distinct OS panel from the upstream AR app', () => {
    expect(createEmptyProject()).toMatchObject({ title: 'Technosutra', sourceMaterials: [], routePoints: [], artworkAssets: [] })
    expect(MODULE_METADATA.technosutra.label).toBe('TECHNO SUTRA')
    expect(MODULE_METADATA['technosutra-novel']).toMatchObject({ id: 'technosutra-novel', label: 'THE STEM ARRAY', requiresAuth: false })
    expect(MODULE_METADATA['technosutra-novel'].description).toContain('visual novel')
    expect(resolvePanel('technosutra')).toBe('technosutra')
    expect(resolvePanel('technosutra-novel')).toBe('technosutra-novel')
  })

  it('accepts only in-range, labeled route points and constructs official pano URLs', () => {
    const point = validateRoutePoint({ id: 'p-1', title: 'Owner supplied point', latitude: -23.55, longitude: -46.63, heading: 90 })
    expect(point).toMatchObject({ title: 'Owner supplied point', latitude: -23.55, longitude: -46.63, heading: 90 })
    const url = new URL(googleStreetViewUrl(point!))
    expect(url.origin).toBe('https://www.google.com')
    expect(url.pathname).toBe('/maps/@')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('map_action')).toBe('pano')
    expect(url.searchParams.get('viewpoint')).toBe('-23.55,-46.63')
    expect(url.searchParams.get('heading')).toBe('90')
    expect(validateRoutePoint({ title: 'outside', latitude: 91, longitude: 0 })).toBeNull()
    expect(validateRoutePoint({ title: '', latitude: 0, longitude: 0 })).toBeNull()
  })

  it('uses only authorized source-derived Markdown text and escapes Ren’Py syntax', () => {
    const project = createEmptyProject()
    project.sourceMaterials.push(markdownSource('# Owner heading\n\nSupplied text with "quotes" and {literal braces}, plus [RenPy] token.'))
    project.routePoints.push({ id: 'p-1', title: 'Owner waypoint', latitude: 1, longitude: 2 })
    expect(markdownBlocks(project).map(block => block.text)).toEqual(['Owner heading', 'Supplied text with "quotes" and {literal braces}, plus [RenPy] token.'])
    const script = renderRenpyScript(project)
    expect(script).toContain('"Owner heading"')
    expect(script).toContain(String.raw`Supplied text with \"quotes\" and {{literal braces}}, plus [[RenPy] token.`)
    expect(script).toContain('$ renpy.open_url("https://www.google.com/maps/@?')
    expect(script).not.toContain('scene bg')
    expect(script).not.toContain('image ')
    expect(script).not.toContain('play music')
  })

  it('blocks a source without explicit adaptation rights and rejects a PDF-only story export', () => {
    const project = createEmptyProject()
    project.sourceMaterials.push(markdownSource('Supplied prose, not authorized for adaptation.', 'unverified'))
    expect(() => renderRenpyScript(project)).toThrow(/verified permission/)
    project.sourceMaterials = [{ id: 'pdf-1', name: 'toh44-45.pdf', format: 'pdf', sizeBytes: 1234, addedAt: '2026-11-01T12:00:00.000Z', adaptationRights: 'unverified' }]
    expect(() => renderRenpyScript(project)).toThrow(/non-empty Markdown source/)
    expect(markdownBlocks(project)).toEqual([])
  })

  it('exports source rights and empty art references as metadata, never Markdown text or image bytes', () => {
    const project = createEmptyProject()
    project.sourceMaterials.push(markdownSource('A supplied paragraph.'))
    const manifest = exportManifest(project)
    expect(manifest.sourceMaterials[0]).toMatchObject({ adaptationRights: 'authorized-for-adaptation' })
    expect(manifest.artworkAssets).toEqual([])
    expect(JSON.stringify(manifest)).not.toContain('markdownText')
  })

  it('round-trips supported local state and drops malformed waypoints rather than guessing', () => {
    const project = createEmptyProject()
    project.sourceMaterials.push(markdownSource('A supplied paragraph.', 'unverified'))
    project.routePoints.push({ id: 'p-1', title: 'A route point', latitude: 0, longitude: 0 })
    const loaded = parseProject(JSON.stringify(project))
    expect(loaded.sourceMaterials[0]?.markdownText).toBe('A supplied paragraph.')
    expect(loaded.sourceMaterials[0]?.adaptationRights).toBe('unverified')
    expect(loaded.routePoints).toHaveLength(1)
    const malformed = parseProject(JSON.stringify({ ...project, routePoints: [{ title: 'bad', latitude: 1000, longitude: 0 }] }))
    expect(malformed.routePoints).toEqual([])
    expect(parseProject('{broken')).toMatchObject({ sourceMaterials: [], routePoints: [], artworkAssets: [] })
  })
})
