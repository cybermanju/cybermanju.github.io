// CyberManju OS — UI appearance tests.
// Role: Guard validation and persistence boundaries for per-item customization.
// Integrates: Vitest and uiAppearance.
import { describe, expect, it } from 'vitest'
import { UI_APPEARANCE_STORAGE_KEY, validateUiAppearance } from '../../src/utils/uiAppearance'

describe('UI appearance persistence contract', () => {
  it('uses its own versioned storage namespace', () => {
    expect(UI_APPEARANCE_STORAGE_KEY).toBe('cybermanju.ui.appearance.v1')
    expect(UI_APPEARANCE_STORAGE_KEY).not.toContain('cyb.json')
  })
  it('accepts bounded icon and local raster data images', () => {
    expect(validateUiAppearance({ button: { kind: 'icon', value: 'solar:home-bold' }, 'home:app': { kind: 'image', value: 'data:image/png;base64,YWJj' } })).toEqual({ button: { kind: 'icon', value: 'solar:home-bold' }, 'home:app': { kind: 'image', value: 'data:image/png;base64,YWJj' } })
  })
  it('rejects remote, SVG, malformed values and prototype-sensitive keys', () => {
    const value = JSON.parse('{"constructor":{"kind":"icon","value":"solar:home"},"__proto__":{"kind":"icon","value":"solar:home"},"remote":{"kind":"image","value":"https://example.test/a.png"},"svg":{"kind":"image","value":"data:image/svg+xml;base64,PHN2Zz4="},"bad":{"kind":"icon","value":"no-prefix"},"invalid":null}')
    const result = validateUiAppearance(value)
    expect(Object.keys(result)).toEqual([])
    expect(Object.getPrototypeOf(result)).toBeNull()
  })
  it('bounds IDs, image payloads and entry count', () => {
    expect(Object.keys(validateUiAppearance({ ['x'.repeat(513)]: { kind: 'icon', value: 'solar:home' } }))).toHaveLength(0)
    expect(Object.keys(validateUiAppearance(Object.fromEntries(Array.from({ length: 320 }, (_, i) => [`id-${i}`, { kind: 'icon', value: 'solar:home' }]))))).toHaveLength(300)
    expect(Object.keys(validateUiAppearance({ huge: { kind: 'image', value: `data:image/png;base64,${'a'.repeat(256 * 1024)}` } }))).toHaveLength(0)
  })
})
