// CyberManju OS — Terminal mobile.test (tests/frontend/terminal-mobile.test.ts).
// Role: Regression tests for bounded mobile terminal pinch zoom.
// Exports: none (Vitest suite).
// Integrates: vitest, ../../src/utils/terminalMobile.
// Contracts: insignificant pinch motion never changes font size; zoom stays accessible.
import { describe, expect, it } from 'vitest'
import { fontSizeAfterPinch } from '../../src/utils/terminalMobile'

describe('terminal pinch font zoom', () => {
  it('zooms one step in or out only after a deliberate pinch', () => {
    expect(fontSizeAfterPinch(13, 1.12)).toBe(14)
    expect(fontSizeAfterPinch(13, 0.89)).toBe(12)
    expect(fontSizeAfterPinch(13, 1.05)).toBe(13)
  })

  it('clamps to the supported readable font-size range', () => {
    expect(fontSizeAfterPinch(22, 1.5)).toBe(22)
    expect(fontSizeAfterPinch(10, 0.5)).toBe(10)
  })
})
