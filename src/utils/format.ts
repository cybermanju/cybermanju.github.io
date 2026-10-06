// Shared byte/percentage formatting — one implementation for every panel.

/** `1536` → `"1.5 KB"`, `0`/null → `"0 B"`. Binary (1024) units. */
export function humanBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

/** Used/capacity as a 0–100 percentage; zero capacity is 0, never NaN. */
export function diskPct(
  used: number | null | undefined,
  capacity: number | null | undefined,
): number {
  if (!capacity) return 0
  return Math.min(100, ((used || 0) / capacity) * 100)
}
