// CyberManju OS — Drawer gesture (src/utils/drawerGesture.ts).
// Role: deterministic distance/velocity policy for finger-following app drawer gestures.
// Exports: drawerGestureProgress, shouldCommitDrawerGesture.
// Integrates: MobileLauncher and AppDrawer; no native lifecycle or persistence.
// Contracts: horizontal travel, reverse motion and invalid samples never commit.
export function drawerGestureProgress(distance: number, extent = 240): number {
  if (!Number.isFinite(distance) || !Number.isFinite(extent) || extent <= 0) return 0
  return Math.max(0, Math.min(1, distance / extent))
}

/** A deliberate pull or a short, quick flick commits; a tap/jitter does not. */
export function shouldCommitDrawerGesture(distance: number, sideways: number, elapsedMs: number): boolean {
  if (![distance, sideways, elapsedMs].every(Number.isFinite)) return false
  if (distance <= 0 || Math.abs(sideways) >= 60 || Math.abs(sideways) >= distance) return false
  return distance >= 96 || (distance >= 40 && elapsedMs > 0 && elapsedMs <= 180 && distance / elapsedMs >= 0.55)
}
