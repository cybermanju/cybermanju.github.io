// CyberManju OS — Responsive home pagination (src/utils/homePageCapacity.ts).
// Role: derive complete app rows from the measured pager, not a fixed icon count.
// Exports: homePageCapacity. Integrates: MobileLauncher and frontend regressions.
// Contracts: at least one full row; CSS owns cell dimensions and safe-area bounds.
export function homePageCapacity(height: number, rowHeight: number, rowGap: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns) || 1)
  if (!Number.isFinite(height) || !Number.isFinite(rowHeight) || rowHeight <= 0) return cols
  const gap = Number.isFinite(rowGap) ? Math.max(0, rowGap) : 0
  const rows = Math.max(1, Math.floor((Math.max(0, height) + gap) / (rowHeight + gap)))
  return rows * cols
}
