// CyberManju OS — Native widget geometry (src/utils/nativeWidgetGeometry.ts).
// Role: convert visible CSS viewport rectangles into native provider dp bounds.
// Exports: nativeWidgetBounds.

export interface NativeWidgetRect {
  left: number
  top: number
  width: number
  height: number
}

export interface NativeWidgetMetrics {
  cssWidth: number
  cssHeight: number
  widthDp: number
  heightDp: number
  scale?: number
  offsetLeft?: number
  offsetTop?: number
}

export interface NativeWidgetMinimum {
  widthDp: number
  heightDp: number
}

export interface NativeWidgetBounds {
  xDp: number
  yDp: number
  widthDp: number
  heightDp: number
}

/** Convert a fully visible CSS viewport rect to integer native dp bounds. */
export function nativeWidgetBounds(
  rect: NativeWidgetRect,
  metrics: NativeWidgetMetrics,
  minimum?: NativeWidgetMinimum,
): NativeWidgetBounds | null {
  const values = [
    rect?.left, rect?.top, rect?.width, rect?.height,
    metrics?.cssWidth, metrics?.cssHeight, metrics?.widthDp, metrics?.heightDp,
    metrics?.scale ?? 1, metrics?.offsetLeft ?? 0, metrics?.offsetTop ?? 0,
    ...(minimum ? [minimum.widthDp, minimum.heightDp] : []),
  ]
  if (!values.every(Number.isFinite)) return null
  if (rect.width <= 0 || rect.height <= 0 || metrics.cssWidth <= 0 || metrics.cssHeight <= 0 || metrics.widthDp <= 0 || metrics.heightDp <= 0) return null
  if (minimum && (minimum.widthDp <= 0 || minimum.heightDp <= 0)) return null

  // A visual viewport zoom or pan makes CSS-to-native mapping ambiguous; fail closed.
  if ((metrics.scale ?? 1) !== 1 || (metrics.offsetLeft ?? 0) !== 0 || (metrics.offsetTop ?? 0) !== 0) return null
  const ratioX = metrics.widthDp / metrics.cssWidth
  const ratioY = metrics.heightDp / metrics.cssHeight
  if (!Number.isFinite(ratioX) || !Number.isFinite(ratioY) || ratioX <= 0 || ratioY <= 0) return null
  if (Math.abs(ratioX - ratioY) / Math.max(ratioX, ratioY) > 0.005) return null

  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  if (!Number.isFinite(right) || !Number.isFinite(bottom) || rect.left < 0 || rect.top < 0 || right > metrics.cssWidth || bottom > metrics.cssHeight) return null

  // Use the per-axis viewport ratios; ratios are required to agree within 0.5% (rounding tolerance only; reject likely inset mismatches).
  const x = rect.left * ratioX
  const y = rect.top * ratioY
  const r = right * ratioX
  const b = bottom * ratioY
  // Outward rounding preserves coverage and ensures the returned box stays in bounds.
  const xDp = Math.floor(x)
  const yDp = Math.floor(y)
  const rightDp = Math.ceil(r)
  const bottomDp = Math.ceil(b)
  const viewportWidthDp = Math.floor(metrics.widthDp)
  const viewportHeightDp = Math.floor(metrics.heightDp)
  const boundedRight = Math.min(rightDp, viewportWidthDp)
  const boundedBottom = Math.min(bottomDp, viewportHeightDp)
  const widthDp = boundedRight - xDp
  const heightDp = boundedBottom - yDp
  if (xDp < 0 || yDp < 0 || boundedRight > metrics.widthDp || boundedBottom > metrics.heightDp || widthDp <= 0 || heightDp <= 0) return null
  if (minimum && (widthDp < minimum.widthDp || heightDp < minimum.heightDp)) return null
  return { xDp, yDp, widthDp, heightDp }
}
