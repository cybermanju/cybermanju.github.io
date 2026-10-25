// CyberManju OS — Android window session (src/utils/windowSession.ts).
// Role: Validate the small UI checkpoint used after Android reclaims the WebView process.
// Exports: WindowSessionSnapshot, StoredWindow, parseWindowSession, serializeWindowSession.
// Integrates: localStorage persistence owned by useWindowManager.
// Contracts: Versioned, bounded layout/routing state; never persists editor text or credentials.

export interface StoredWindow {
  id: string
  panelType: string
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  zIndex: number
  column?: number
  line?: number
  props?: Record<string, string | boolean>
}

export interface WindowSessionSnapshot {
  windows: StoredWindow[]
  focusHistory: string[]
  stripOffset: number
  stripLine: number
}

const MAX_WINDOWS = 8
const MAX_COORDINATE = 1_000_000
const MAX_SIZE = 10_000
const PERSISTED_PROP_KEYS = new Set(['tab', 'diskId', 'highlightId', 'fileId', 'inspector', 'inspTab', 'reason'])

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

function safeProps(value: unknown): Record<string, string | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const props: Record<string, string | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!PERSISTED_PROP_KEYS.has(key)) continue
    if (typeof item === 'boolean') props[key] = item
    else if (typeof item === 'string' && item.length <= 256) props[key] = item
  }
  return Object.keys(props).length ? props : undefined
}

function normalizeWindow(value: unknown): StoredWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !/^win-[1-9]\d{0,8}$/.test(row.id)) return null
  if (typeof row.panelType !== 'string' || row.panelType.length > 48) return null
  const idNumber = Number(row.id.slice(4))
  const stored: StoredWindow = {
    id: row.id,
    panelType: row.panelType,
    x: finite(row.x, 0, 0, MAX_COORDINATE),
    y: finite(row.y, 0, 0, MAX_COORDINATE),
    width: finite(row.width, 520, 320, MAX_SIZE),
    height: finite(row.height, 440, 240, MAX_SIZE),
    minimized: row.minimized === true,
    zIndex: finite(row.zIndex, 10 + idNumber, 0, MAX_COORDINATE),
  }
  if (typeof row.column === 'number' && Number.isSafeInteger(row.column)) stored.column = finite(row.column, 0, -MAX_COORDINATE, MAX_COORDINATE)
  if (typeof row.line === 'number' && Number.isSafeInteger(row.line)) stored.line = finite(row.line, 0, -MAX_COORDINATE, MAX_COORDINATE)
  const props = safeProps(row.props)
  if (props) stored.props = props
  return stored
}

export function parseWindowSession(raw: string | null | undefined): WindowSessionSnapshot | null {
  if (!raw || raw.length > 64_000) return null
  try {
    const root = JSON.parse(raw) as Record<string, unknown>
    if (!root || root.version !== 1 || !Array.isArray(root.windows)) return null
    const ids = new Set<string>()
    const windows: StoredWindow[] = []
    for (const candidate of root.windows.slice(0, MAX_WINDOWS)) {
      const row = normalizeWindow(candidate)
      if (!row || ids.has(row.id)) continue
      ids.add(row.id)
      windows.push(row)
    }
    const focusHistory = Array.isArray(root.focusHistory)
      ? root.focusHistory.filter((id): id is string => typeof id === 'string' && ids.has(id)).slice(-MAX_WINDOWS)
      : []
    return {
      windows,
      focusHistory,
      stripOffset: finite(root.stripOffset, 0, 0, MAX_WINDOWS),
      stripLine: finite(root.stripLine, 0, 0, MAX_COORDINATE),
    }
  } catch {
    return null
  }
}

export function serializeWindowSession(snapshot: WindowSessionSnapshot): string {
  const byId = new Map(snapshot.windows.map(row => [row.id, row]))
  const orderedIds = [...snapshot.focusHistory].reverse().concat([...snapshot.windows].reverse().map(row => row.id))
  const prioritized: StoredWindow[] = []
  const seen = new Set<string>()
  for (const id of orderedIds) {
    const row = byId.get(id)
    if (!row || seen.has(id)) continue
    seen.add(id)
    prioritized.push(row)
  }
  const windows = prioritized.slice(0, MAX_WINDOWS)
    .map(normalizeWindow)
    .filter((row): row is StoredWindow => row !== null)
  const ids = new Set(windows.map(row => row.id))
  const clean: WindowSessionSnapshot = {
    windows,
    focusHistory: snapshot.focusHistory.filter(id => ids.has(id)).slice(-MAX_WINDOWS),
    stripOffset: finite(snapshot.stripOffset, 0, 0, MAX_WINDOWS),
    stripLine: finite(snapshot.stripLine, 0, 0, MAX_COORDINATE),
  }
  return JSON.stringify({ version: 1, ...clean })
}
