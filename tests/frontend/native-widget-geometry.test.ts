// CyberManju OS — Native widget geometry tests (tests/frontend/native-widget-geometry.test.ts).
// Role: regression tests for CSS viewport to native provider dp conversion.
// Exports: none.
import { describe, expect, it } from 'vitest'
import { nativeWidgetBounds } from '../../src/utils/nativeWidgetGeometry'

const metrics = { cssWidth: 400, cssHeight: 800, widthDp: 200, heightDp: 400 }

describe('nativeWidgetBounds', () => {
  it('converts CSS coordinates using viewport density ratios (not DPR)', () => {
    expect(nativeWidgetBounds({ left: 20, top: 40, width: 100, height: 80 }, metrics))
      .toEqual({ xDp: 10, yDp: 20, widthDp: 50, heightDp: 40 })
  })

  it('rejects corrupt, non-finite, and non-positive inputs', () => {
    expect(nativeWidgetBounds({ left: NaN, top: 0, width: 10, height: 10 }, metrics)).toBeNull()
    expect(nativeWidgetBounds({ left: 0, top: 0, width: Infinity, height: 10 }, metrics)).toBeNull()
    expect(nativeWidgetBounds({ left: 0, top: 0, width: 0, height: 10 }, metrics)).toBeNull()
    expect(nativeWidgetBounds({ left: 0, top: 0, width: 10, height: 10 }, { ...metrics, cssWidth: 0 })).toBeNull()
    expect(nativeWidgetBounds({ left: 0, top: 0, width: 10, height: 10 }, { ...metrics, widthDp: NaN })).toBeNull()
  })

  it('rejects partial clipping on every viewport edge', () => {
    for (const rect of [
      { left: -1, top: 0, width: 10, height: 10 },
      { left: 0, top: -1, width: 10, height: 10 },
      { left: 395, top: 0, width: 10, height: 10 },
      { left: 0, top: 795, width: 10, height: 10 },
    ]) expect(nativeWidgetBounds(rect, metrics)).toBeNull()
  })

  it('fails closed for visual viewport zoom or pan', () => {
    const rect = { left: 1, top: 2, width: 30, height: 40 }
    expect(nativeWidgetBounds(rect, { ...metrics, scale: 1.25 })).toBeNull()
    expect(nativeWidgetBounds(rect, { ...metrics, offsetLeft: 1 })).toBeNull()
    expect(nativeWidgetBounds(rect, { ...metrics, offsetTop: -1 })).toBeNull()
  })

  it('rejects materially nonuniform width and height density ratios', () => {
    expect(nativeWidgetBounds({ left: 0, top: 0, width: 20, height: 20 }, { ...metrics, heightDp: 500 })).toBeNull()
    expect(nativeWidgetBounds({ left: 0, top: 0, width: 20, height: 20 }, { ...metrics, heightDp: 392 })).toBeNull()
  })

  it('requires provider minimum dimensions after outward integer rounding', () => {
    const rect = { left: 1, top: 1, width: 19, height: 20 }
    expect(nativeWidgetBounds(rect, metrics, { widthDp: 10, heightDp: 11 })).toEqual({ xDp: 0, yDp: 0, widthDp: 10, heightDp: 11 })
    expect(nativeWidgetBounds(rect, metrics, { widthDp: 11, heightDp: 10 })).toBeNull()
  })

  it('rounds outward while keeping integer edges inside the viewport', () => {
    expect(nativeWidgetBounds({ left: 399, top: 799, width: 1, height: 1 }, metrics))
      .toEqual({ xDp: 199, yDp: 399, widthDp: 1, heightDp: 1 })
  })
})
