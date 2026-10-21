// CyberManju OS — UI Layout Runtime Tests (tests/frontend/ui-layout.test.ts).
// Role: Verify untrusted persisted layout data is bounded and isolated to its versioned key.
// Exports: Vitest test suite.
// Integrates: src/utils/uiLayout.ts pure storage validation API.
// Contracts: Tests require no browser or DOM environment.
import { describe, expect, it } from 'vitest'
import { readUiLayout, UI_LAYOUT_STORAGE_KEY, validateUiLayout } from '../../src/utils/uiLayout'

describe('global UI layout persistence', () => {
  it('uses an independent versioned localStorage key', () => {
    expect(UI_LAYOUT_STORAGE_KEY).toBe('cybermanju.ui.layout.v1')
  })

  it('accepts finite offsets and bounds normalized values', () => {
    expect(validateUiLayout({ panel: { x: 2, y: -3 }, dock: { x: 0.25, y: -0.5 } })).toEqual({
      panel: { x: 1, y: -1 }, dock: { x: 0.25, y: -0.5 },
    })
  })

  it('drops malformed entries, nonfinite numbers, and prototype-sensitive IDs', () => {
    const value = JSON.parse('{"good":{"x":0,"y":1},"constructor":{"x":0,"y":0},"__proto__":{"x":0,"y":0},"bad":{"x":"1","y":0},"nan":{"x":null,"y":0},"array":[1,2]}')
    const result = validateUiLayout(value)
    expect(Object.keys(result)).toEqual(['good'])
    expect(Object.getPrototypeOf(result)).toBeNull()
  })

  it('limits entries and safely handles malformed or unavailable storage', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`id-${i}`, { x: 0, y: 0 }]))
    expect(Object.keys(validateUiLayout(tooMany))).toHaveLength(500)
    expect(readUiLayout({ getItem: () => '{broken' })).toEqual(Object.create(null))
    expect(readUiLayout(null)).toEqual(Object.create(null))
  })
})
