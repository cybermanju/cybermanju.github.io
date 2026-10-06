// CyberManju OS — pure shell-layout math (niri-style strip, tiling, gestures).
//
// No DOM, no Vue, no window access: every helper here is a pure function so
// the strip/tiling/gesture behaviour is unit-testable in the node env.
// The composables (`useWindowManager`, `useSwipe`, `DesktopShell`) delegate
// their geometry to these helpers — tests below prove the numbers.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SwipeDir = 'left' | 'right' | 'up' | 'down'

/** Dominant-axis direction for a displacement. Ties prefer horizontal. */
export function swipeDirection(dx: number, dy: number): SwipeDir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

/**
 * Grid-tile `count` windows into a view (classic autotile).
 * Rows fill left→right, top→bottom with a uniform `gap` margin.
 */
export function computeTileRects(
  count: number,
  viewW: number,
  viewH: number,
  gap = 10,
): Rect[] {
  if (count <= 0) return []
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const cw = Math.floor((viewW - gap * (cols + 1)) / cols)
  const ch = Math.floor((viewH - gap * (rows + 1)) / rows)
  const rects: Rect[] = []
  for (let i = 0; i < count; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    rects.push({
      x: gap + c * (cw + gap),
      y: gap + r * (ch + gap),
      width: Math.max(320, cw),
      height: Math.max(240, ch),
    })
  }
  return rects
}

/** Niri column width: ~55% of the viewport, clamped so tiles stay usable. */
export function stripColumnWidth(viewW: number): number {
  return Math.max(380, Math.min(760, Math.floor(viewW * 0.55)))
}

/**
 * Niri-style strip rects: columns append along the scroll axis and NEVER
 * shrink to fit — every column keeps full size, the viewport scrolls.
 * - horizontal: columns run left→right (`x` grows), full viewport height.
 * - vertical: columns run top→bottom (`y` grows), full viewport width.
 */
export function computeStripRects(
  count: number,
  viewW: number,
  viewH: number,
  gap = 12,
  vertical = false,
  colWidth?: number,
): Rect[] {
  if (count <= 0) return []
  const rects: Rect[] = []
  if (vertical) {
    const colH = Math.max(320, viewH - 2 * gap)
    const w = Math.max(320, viewW - 2 * gap)
    for (let i = 0; i < count; i++) {
      rects.push({ x: gap, y: gap + i * (colH + gap), width: w, height: colH })
    }
    return rects
  }
  const cw = colWidth ?? stripColumnWidth(viewW)
  const ch = Math.max(320, viewH - 2 * gap)
  for (let i = 0; i < count; i++) {
    rects.push({ x: gap + i * (cw + gap), y: gap, width: cw, height: ch })
  }
  return rects
}

/** Clamp a strip viewport offset to the live column range. */
export function clampStripOffset(offset: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, offset))
}

/**
 * Niri dynamic workspaces: lines are created on demand and there is always
 * room for exactly one empty line below the lowest occupied one. Moving
 * past the bottom lands on that empty line (open a window there to keep
 * it); moving past it stays. The top is clamped at 0.
 */
export function resolveStripLine(
  existingLines: number[],
  current: number,
  delta: number,
): number {
  const maxExisting = existingLines.length === 0 ? -1 : Math.max(...existingLines)
  const hi = maxExisting + 1
  return Math.min(hi, Math.max(0, current + delta))
}

export type TwoFingerClass =
  | 'pinch'
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down'
  | 'tap'
  | 'none'

export interface TwoFingerSample {
  /** Finger spread at gesture start (px). */
  startDist: number
  /** Finger spread at gesture end (px). */
  endDist: number
  /** Centroid displacement (px). */
  dx: number
  dy: number
  /** Minimum centroid travel that counts as a swipe (px). */
  swipeThreshold: number
  /** Spread change that counts as a pinch (px). Defaults to 20. */
  pinchThreshold?: number
  /** Max displacement that still counts as a tap (px). Defaults to 10. */
  tapSlop?: number
}

/**
 * Decide what a two-finger gesture was: a pinch (spread changed) wins over
 * a swipe (fingers travelled together), otherwise a tap or nothing.
 * This is the classifier `useSwipe` runs — the old code treated EVERY
 * two-finger touch as a pinch, so two-finger swipes could never fire.
 */
export function classifyTwoFingerGesture(s: TwoFingerSample): TwoFingerClass {
  const pinchThreshold = s.pinchThreshold ?? 20
  const tapSlop = s.tapSlop ?? 10
  if (Math.abs(s.endDist - s.startDist) >= pinchThreshold) return 'pinch'
  const travel = Math.max(Math.abs(s.dx), Math.abs(s.dy))
  if (travel >= s.swipeThreshold) return `swipe-${swipeDirection(s.dx, s.dy)}` as TwoFingerClass
  if (Math.abs(s.dx) <= tapSlop && Math.abs(s.dy) <= tapSlop) return 'tap'
  return 'none'
}
