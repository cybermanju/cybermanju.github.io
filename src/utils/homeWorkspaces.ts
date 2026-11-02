// CyberManju OS — Persistent Home workspace model.
// Role: validate bounded local state, move tiles, and classify app-local gestures.
// Exports: state types, storage key, limits, normalization and mutation helpers.
import { homeWidgetCatalog } from '@/data/homeWidgetCatalog'

export interface HomeItem {
  id: string
  kind: 'app' | 'widget'
  ref: string
  data?: Record<string, string | number | boolean>
}

export interface HomeGridPlacement {
  itemId: string
  column: number
  row: number
  columnSpan: number
  rowSpan: number
}

/** Resolve stable widget spans while keeping old version-1 items valid. */
export function homeItemSpan(item: HomeItem, columns = 4): { columns: number; rows: number } {
  const widget = item.kind === 'widget' ? homeWidgetCatalog.find(entry => entry.id === item.ref) : undefined
  const limit = Math.max(1, Math.min(8, Math.trunc(columns) || 4))
  const bounded = (value: unknown, fallback: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(max, value)) : fallback
  const fallbackColumns = item.kind === 'widget' ? widget?.gridSpan?.columns ?? (item.ref.startsWith('native:') ? 2 : 1) : 1
  const fallbackRows = item.kind === 'widget' ? widget?.gridSpan?.rows ?? (item.ref.startsWith('native:') ? 2 : 1) : 1
  return {
    columns: bounded(item.data?.gridColumns, fallbackColumns, limit),
    rows: bounded(item.data?.gridRows, fallbackRows, 8),
  }
}

/** Deterministic row-major packing shared by Home, overflow checks and previews. */
export function placeHomeItems(items: HomeItem[], columns = 4, rows = 4): { placements: HomeGridPlacement[]; overflow: string[] } {
  const cols = Math.max(1, Math.min(8, Math.trunc(columns) || 4))
  const rowCount = Math.max(1, Math.min(8, Math.trunc(rows) || 4))
  const occupied = Array.from({ length: rowCount }, () => Array<boolean>(cols).fill(false))
  const placements: HomeGridPlacement[] = []
  const overflow: string[] = []
  // Apps take the first cells so the launcher remains useful before widgets.
  const orderedItems = [...items].sort((a, b) => Number(a.kind !== 'app') - Number(b.kind !== 'app'))
  for (const item of orderedItems) {
    const requested = homeItemSpan(item, cols)
    const span = { columns: Math.min(cols, requested.columns), rows: Math.min(rowCount, requested.rows) }
    let location: { column: number; row: number } | null = null
    for (let row = 0; row <= rowCount - span.rows && !location; row++) {
      for (let column = 0; column <= cols - span.columns; column++) {
        let free = true
        for (let y = row; y < row + span.rows && free; y++) {
          for (let x = column; x < column + span.columns; x++) if (occupied[y]?.[x]) { free = false; break }
        }
        if (free) { location = { column, row }; break }
      }
    }
    if (!location) { overflow.push(item.id); continue }
    for (let y = location.row; y < location.row + span.rows; y++) {
      for (let x = location.column; x < location.column + span.columns; x++) occupied[y]![x] = true
    }
    placements.push({ itemId: item.id, ...location, columnSpan: span.columns, rowSpan: span.rows })
  }
  return { placements, overflow }
}

export function homeItemPlacement(item: HomeItem, items: HomeItem[], columns = 4, rows = 4): HomeGridPlacement | undefined {
  return placeHomeItems(items, columns, rows).placements.find(placement => placement.itemId === item.id)
}

export interface HomeWorkspace {
  id: string
  title: string
  items: HomeItem[]
  columns?: number
  rows?: number
  x?: number
  y?: number
}

export interface HomeWorkspaceState {
  version: 1
  activeId: string
  pages: HomeWorkspace[]
  theme: 'aurora' | 'pixel' | 'mono'
}

export const HOME_WORKSPACE_KEY = 'cybermanju.home.workspaces.v1'
export const MAX_WORKSPACES = 24
export const MAX_ITEMS_PER_WORKSPACE = 32

/** Orb drags target adjacent screens in the full eight-way neighborhood. */
export type HomeGridDelta = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
export type HomeGridPoint = { x: number; y: number }
export type HomeGridDirection = 'right' | 'downRight' | 'down' | 'downLeft' | 'left' | 'upLeft' | 'up' | 'upRight'
export type HomeGridNeighborMap = Record<HomeGridDirection, number>
export const HOME_GRID_DIRECTIONS: readonly HomeGridDirection[] = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight']
const HOME_GRID_OFFSETS: Record<HomeGridDirection, HomeGridDelta> = {
  right: { dx: 1, dy: 0 }, downRight: { dx: 1, dy: 1 }, down: { dx: 0, dy: 1 }, downLeft: { dx: -1, dy: 1 },
  left: { dx: -1, dy: 0 }, upLeft: { dx: -1, dy: -1 }, up: { dx: 0, dy: -1 }, upRight: { dx: 1, dy: -1 },
}

/** Legacy row-major fallback for saved screens that do not have persisted coordinates. */
export function homeGridCols(count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 1
  return Math.min(MAX_WORKSPACES, Math.ceil(Math.sqrt(count)))
}

/** Stable legacy placement for saved screens that predate persisted coordinates. */
export function homeGridPosition(index: number, count: number): HomeGridPoint {
  const cols = homeGridCols(count)
  if (!Number.isInteger(index) || index < 0) return { x: 0, y: 0 }
  return { x: index % cols, y: Math.floor(index / cols) }
}

export function isHomeGridPosition(point: HomeGridPoint): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y) && Math.abs(point.x) <= MAX_WORKSPACES && Math.abs(point.y) <= MAX_WORKSPACES
}

export function homeWorkspacePosition(page: HomeWorkspace, index: number, count: number): HomeGridPoint {
  const point = { x: page.x, y: page.y }
  return Number.isInteger(point.x) && Number.isInteger(point.y) && isHomeGridPosition(point as HomeGridPoint)
    ? point as HomeGridPoint
    : homeGridPosition(index, count)
}

export function homeGridTarget(point: HomeGridPoint, delta: HomeGridDelta): HomeGridPoint {
  return { x: point.x + delta.dx, y: point.y + delta.dy }
}

/** Map a drag to one of eight neighboring cells; horizontal drags retain page-swipe direction. */
export function classifyOrbDragDirection(dx: number, dy: number): HomeGridDelta | null {
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < 16) return null
  const absX = Math.abs(dx), absY = Math.abs(dy)
  const useX = absX >= absY * 0.55
  const useY = absY >= absX * 0.55
  return { dx: useX ? (dx < 0 ? 1 : -1) : 0, dy: useY ? (dy < 0 ? -1 : 1) : 0 }
}

function pointKey(point: HomeGridPoint) { return `${point.x},${point.y}` }

function findFreeGridPosition(occupied: Set<string>, anchor: HomeGridPoint = { x: 0, y: 0 }): HomeGridPoint {
  const origin = isHomeGridPosition(anchor) ? anchor : { x: 0, y: 0 }
  for (let radius = 0; radius <= MAX_WORKSPACES; radius++) {
    const ring: HomeGridPoint[] = radius === 0 ? [origin] : [
      ...Array.from({ length: radius + 1 }, (_, i) => ({ x: origin.x + radius, y: origin.y + i })),
      ...Array.from({ length: radius * 2 }, (_, i) => ({ x: origin.x + radius - 1 - i, y: origin.y + radius })),
      ...Array.from({ length: radius * 2 }, (_, i) => ({ x: origin.x - radius, y: origin.y + radius - 1 - i })),
      ...Array.from({ length: radius * 2 }, (_, i) => ({ x: origin.x - radius + 1 + i, y: origin.y - radius })),
      ...Array.from({ length: radius - 1 }, (_, i) => ({ x: origin.x + radius, y: origin.y - radius + 1 + i })),
    ]
    for (const point of ring) if (isHomeGridPosition(point) && !occupied.has(pointKey(point))) return point
  }
  return { x: 0, y: 0 }
}

/** Neighbor indexes by exact screen coordinates; missing directions are -1. */
export function homeGridNeighbors(index: number, count: number, positions?: readonly HomeGridPoint[]): HomeGridNeighborMap {
  const result = Object.fromEntries(HOME_GRID_DIRECTIONS.map(direction => [direction, -1])) as HomeGridNeighborMap
  if (!Number.isInteger(index) || index < 0 || index >= count) return result
  const points = positions?.length === count
    ? positions
    : Array.from({ length: Math.max(0, count) }, (_, i) => homeGridPosition(i, count))
  const current = points[index]
  if (!current || !isHomeGridPosition(current)) return result
  const byPosition = new Map<string, number>()
  points.forEach((point, i) => { if (isHomeGridPosition(point) && !byPosition.has(pointKey(point))) byPosition.set(pointKey(point), i) })
  for (const direction of HOME_GRID_DIRECTIONS) {
    const offset = HOME_GRID_OFFSETS[direction]
    result[direction] = byPosition.get(pointKey(homeGridTarget(current, offset))) ?? -1
  }
  return result
}

/** Deterministic tint hue per screen index (0-359), stable across sessions. */
export function homeHueForScreen(index: number): number {
  let x = Math.imul(Math.max(0, index) ^ 0x9e3779b9, 2654435761)
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return (((x ^ (x >>> 16)) % 360) + 360) % 360
}


let fallbackCounter = 0
function uniqueId(): string {
  try {
    const candidate = globalThis.crypto?.randomUUID?.()
    if (candidate) return candidate
  } catch { /* unavailable in some runtimes */ }
  fallbackCounter += 1
  return `home-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
function makePage(title: string, position: HomeGridPoint): HomeWorkspace {
  return { id: uniqueId(), title, items: [], columns: 4, rows: 4, x: position.x, y: position.y }
}

export function createHomeState(appIds: string[]): HomeWorkspaceState {
  const seen = new Set<string>()
  const items: HomeItem[] = []
  for (const ref of appIds) {
    if (typeof ref !== 'string' || seen.has(ref) || items.length >= MAX_ITEMS_PER_WORKSPACE) continue
    seen.add(ref)
    items.push({ id: uniqueId(), kind: 'app', ref })
  }
  const first = makePage('Home', { x: 0, y: 0 })
  first.items = items
  const trailing = makePage('Screen 2', { x: 1, y: 0 })
  return { version: 1, activeId: first.id, pages: [first, trailing], theme: 'aurora' }
}

function parseItem(value: unknown): HomeItem | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.ref) || value.id.length > 256 || value.ref.length > 256 || (value.kind !== 'app' && value.kind !== 'widget')) return null
  let data: HomeItem['data']
  if (value.data !== undefined) {
    if (!isRecord(value.data) || Object.keys(value.data).length > 32) return null
    data = {}
    for (const [key, val] of Object.entries(value.data)) {
      if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') return null
      if (typeof val === 'number' && !Number.isFinite(val)) return null
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      data[key.slice(0, 80)] = typeof val === 'string' ? val.slice(0, 2000) : val
    }
  }
  return { id: value.id, kind: value.kind, ref: value.ref, ...(data ? { data } : {}) }
}

export function normalizeHomeState(input: unknown, appIds: string[]): HomeWorkspaceState {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.pages)) return createHomeState(appIds)
  const pageIds = new Set<string>()
  const itemIds = new Set<string>()
  const pages: HomeWorkspace[] = []
  for (const raw of input.pages) {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || raw.id.length > 256 || !Array.isArray(raw.items) || pageIds.has(raw.id) || pages.length >= MAX_WORKSPACES) continue
    pageIds.add(raw.id)
    const items: HomeItem[] = []
    for (const rawItem of raw.items) {
      const item = parseItem(rawItem)
      if (!item || itemIds.has(item.id) || items.length >= MAX_ITEMS_PER_WORKSPACE) continue
      itemIds.add(item.id)
      items.push(item)
    }
    const boundedGrid = (value: unknown, fallback: number) => Number.isInteger(value) ? Math.max(2, Math.min(8, value as number)) : fallback
    pages.push({ id: raw.id, title: typeof raw.title === 'string' ? raw.title.slice(0, 40) : 'Screen', items, columns: boundedGrid(raw.columns, 4), rows: boundedGrid(raw.rows, 4), x: raw.x as number | undefined, y: raw.y as number | undefined })
  }
  if (pages.length === 0) return createHomeState(appIds)
  const occupied = new Set<string>()
  pages.forEach((page, index) => {
    let point = isHomeGridPosition({ x: page.x as number, y: page.y as number })
      ? { x: page.x as number, y: page.y as number }
      : homeGridPosition(index, pages.length)
    if (occupied.has(pointKey(point))) point = findFreeGridPosition(occupied, homeGridPosition(index, pages.length))
    page.x = point.x
    page.y = point.y
    occupied.add(pointKey(point))
  })
  const theme = input.theme === 'pixel' || input.theme === 'mono' ? input.theme : 'aurora'
  const activeId = typeof input.activeId === 'string' && pages.some(page => page.id === input.activeId) ? input.activeId : pages[0].id
  const state: HomeWorkspaceState = { version: 1, activeId, pages, theme }
  ensureTrailingWorkspace(state)
  return state
}

export function createHomeWorkspace(state: HomeWorkspaceState, position?: HomeGridPoint): string | null {
  if (position) {
    if (!isHomeGridPosition(position)) return null
    const existing = state.pages.find((page, index) => {
      const point = homeWorkspacePosition(page, index, state.pages.length)
      return point.x === position.x && point.y === position.y
    })
    if (existing) { state.activeId = existing.id; return existing.id }
    if (state.pages.length >= MAX_WORKSPACES) return null
    const page = makePage(`Screen ${state.pages.length + 1}`, position)
    state.pages.push(page)
    state.activeId = page.id
    return page.id
  }
  const trailing = state.pages[state.pages.length - 1]
  if (trailing?.items.length === 0) {
    state.activeId = trailing.id
    return trailing.id
  }
  if (state.pages.length >= MAX_WORKSPACES) return null
  const occupied = new Set(state.pages.map((page, index) => pointKey(homeWorkspacePosition(page, index, state.pages.length))))
  const anchor = trailing ? homeWorkspacePosition(trailing, state.pages.length - 1, state.pages.length) : { x: 0, y: 0 }
  const page = makePage(`Screen ${state.pages.length + 1}`, findFreeGridPosition(occupied, anchor))
  state.pages.push(page)
  state.activeId = page.id
  return page.id
}

export function ensureTrailingWorkspace(state: HomeWorkspaceState): void {
  if (state.pages.length >= MAX_WORKSPACES) return
  if (state.pages.length === 0) {
    const page = makePage('Home', { x: 0, y: 0 })
    state.pages.push(page)
    state.activeId = page.id
    return
  }
  if (state.pages[state.pages.length - 1].items.length !== 0) {
    const occupied = new Set(state.pages.map((page, index) => pointKey(homeWorkspacePosition(page, index, state.pages.length))))
    const last = state.pages[state.pages.length - 1]
    const anchor = homeWorkspacePosition(last, state.pages.length - 1, state.pages.length)
    state.pages.push(makePage(`Screen ${state.pages.length + 1}`, findFreeGridPosition(occupied, anchor)))
  }
}

export function addHomeItem(state: HomeWorkspaceState, pageId: string, item: HomeItem): boolean {
  const page = state.pages.find(candidate => candidate.id === pageId)
  if (!page || !parseItem(item) || state.pages.some(p => p.items.some(existing => existing.id === item.id)) || page.items.length >= MAX_ITEMS_PER_WORKSPACE) return false
  page.items.push({ ...item, ...(item.data ? { data: { ...item.data } } : {}) })
  ensureTrailingWorkspace(state)
  return true
}

export function moveHomeItem(state: HomeWorkspaceState, itemId: string, fromId: string, toId: string): boolean {
  const from = state.pages.find(page => page.id === fromId)
  const to = state.pages.find(page => page.id === toId)
  if (!from || !to || from === to || to.items.length >= MAX_ITEMS_PER_WORKSPACE) return false
  const index = from.items.findIndex(item => item.id === itemId)
  if (index < 0) return false
  const candidate = from.items[index]
  if (candidate.kind === 'app' && to.items.some(item => item.kind === candidate.kind && item.ref === candidate.ref)) return false
  const [item] = from.items.splice(index, 1)
  to.items.push(item)
  ensureTrailingWorkspace(state)
  return true
}

export function removeHomeItem(state: HomeWorkspaceState, pageId: string, itemId: string): void {
  const page = state.pages.find(candidate => candidate.id === pageId)
  if (!page) return
  const index = page.items.findIndex(item => item.id === itemId)
  if (index >= 0) page.items.splice(index, 1)
  ensureTrailingWorkspace(state)
}

export function classifyHomeGesture(dx: number, dy: number, fingers: number): 'overview-open' | 'overview-close' | 'previous' | 'next' | null {
  if (![dx, dy].every(Number.isFinite)) return null
  if (fingers === 3 && Math.abs(dy) >= 72 && Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 'overview-open' : 'overview-close'
  if (fingers === 1) {
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    // A vertical one-finger movement belongs to the scrollable Home canvas;
    // page only when horizontal intent is clear, including horizontal-led diagonals.
    if (absX < 64 || absX < absY * 1.25) return null
    return dx > 0 ? 'previous' : 'next'
  }
  if (fingers === 2) {
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    const dominant = Math.max(absX, absY)
    const minor = Math.min(absX, absY)
    if (dominant < 64 || dominant < minor * 1.25) return null
    if (absX > absY) return dx < 0 ? 'next' : 'previous'
    return dy < 0 ? 'next' : 'previous'
  }
  return null
}
