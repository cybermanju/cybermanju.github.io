// CyberManju OS — Home layout (src/utils/homeLayout.ts).
// Role: Validate per-device free-layout offsets and bound movable home surfaces.
// Exports: HomeLayoutState, readHomeLayout, clampHomeOffset, moveHomeOrder.
// Integrates: useHomeLayout and launcher customization.
// Contracts: No commands or credentials; malformed storage falls back safely.
export interface HomeOffset { x: number; y: number }
export interface HomeLayoutState { free: boolean; offsets: Record<string, HomeOffset> }
export interface HomeRect { left: number; top: number; width: number; height: number }
export const HOME_LAYOUT_KEY = 'cybermanju.home.layout.v1'
export const DESKTOP_HOME_LAYOUT_KEY = 'cybermanju.desktop.home.layout.v1'

export function readHomeLayout(raw: string | null): HomeLayoutState {
  const empty = (): HomeLayoutState => ({ free: false, offsets: {} })
  try {
    const value = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty()
    const offsets: Record<string, HomeOffset> = {}
    for (const [key, point] of Object.entries(value.offsets ?? {}).slice(0, 100)) {
      if (!/^(app:[a-z-]+|widget:(vault|sync)|greeting|widgets|search|commands|dock|drawer)$/.test(key)) continue
      const p = point as HomeOffset
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        offsets[key] = { x: Math.max(-2, Math.min(2, p.x)), y: Math.max(-2, Math.min(2, p.y)) }
      }
    }
    return { free: value.free === true, offsets }
  } catch { return empty() }
}

/** Offsets are relative to the untransformed rectangle; oversized items anchor at the near edge. */
export function clampHomeOffset(point: HomeOffset, base: HomeRect, bounds: HomeRect): HomeOffset {
  const minX = bounds.left - base.left
  const minY = bounds.top - base.top
  return {
    x: Math.max(minX, Math.min(Math.max(minX, minX + bounds.width - base.width), point.x)),
    y: Math.max(minY, Math.min(Math.max(minY, minY + bounds.height - base.height), point.y)),
  }
}

/** Assign every visible tile a unique slot instead of bumping into tied/default orders. */
export function moveHomeOrder(keys: string[], key: string, direction: -1 | 1): string[] {
  const result = [...keys]
  const index = result.indexOf(key)
  if (index < 0) return result
  const target = Math.max(0, Math.min(result.length - 1, index + direction))
  ;[result[index], result[target]] = [result[target], result[index]]
  return result
}
