// CyberManju OS — Persistent Home workspace model.
// Role: validate bounded local state, move tiles, and classify app-local gestures.
// Exports: state types, storage key, limits, normalization and mutation helpers.
export interface HomeItem {
  id: string
  kind: 'app' | 'widget'
  ref: string
  data?: Record<string, string | number | boolean>
}

export interface HomeWorkspace {
  id: string
  title: string
  items: HomeItem[]
  columns?: number
  rows?: number
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

/** One-finger orb/home drag step: horizontal pages linearly, vertical pages by grid row. */
export type HomeGridDelta = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }

/**
 * The orb navigator reads the linear page list as a square-ish row-major grid so
 * drags can also step up/down between rows. Both the orb and the studio call
 * this, so both sides always agree on the same layout.
 */
export function homeGridCols(count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 1
  return Math.min(MAX_WORKSPACES, Math.ceil(Math.sqrt(count)))
}

/** Neighbor page indexes (-1 = wall) in the row-major grid; up/down jump ±cols. */
export function homeGridNeighbors(index: number, count: number): { left: number; right: number; up: number; down: number } {
  const cols = homeGridCols(count)
  return {
    left: index > 0 ? index - 1 : -1,
    right: index >= 0 && index + 1 < count ? index + 1 : -1,
    up: index - cols >= 0 ? index - cols : -1,
    down: index + cols < count ? index + cols : -1,
  }
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
function makePage(title: string): HomeWorkspace {
  return { id: uniqueId(), title, items: [], columns: 4, rows: 4 }
}

export function createHomeState(appIds: string[]): HomeWorkspaceState {
  const seen = new Set<string>()
  const items: HomeItem[] = []
  for (const ref of appIds) {
    if (typeof ref !== 'string' || seen.has(ref) || items.length >= MAX_ITEMS_PER_WORKSPACE) continue
    seen.add(ref)
    items.push({ id: uniqueId(), kind: 'app', ref })
  }
  const first = makePage('Home')
  first.items = items
  const trailing = makePage('Screen 2')
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
    pages.push({ id: raw.id, title: typeof raw.title === 'string' ? raw.title.slice(0, 40) : 'Screen', items, columns: boundedGrid(raw.columns, 4), rows: boundedGrid(raw.rows, 4) })
  }
  if (pages.length === 0) return createHomeState(appIds)
  const theme = input.theme === 'pixel' || input.theme === 'mono' ? input.theme : 'aurora'
  const activeId = typeof input.activeId === 'string' && pages.some(page => page.id === input.activeId) ? input.activeId : pages[0].id
  const state: HomeWorkspaceState = { version: 1, activeId, pages, theme }
  ensureTrailingWorkspace(state)
  return state
}

export function createHomeWorkspace(state: HomeWorkspaceState): string | null {
  const trailing = state.pages[state.pages.length - 1]
  if (trailing?.items.length === 0) {
    state.activeId = trailing.id
    return trailing.id
  }
  if (state.pages.length >= MAX_WORKSPACES) return null
  const page = makePage(`Screen ${state.pages.length + 1}`)
  state.pages.push(page)
  state.activeId = page.id
  return page.id
}

export function ensureTrailingWorkspace(state: HomeWorkspaceState): void {
  if (state.pages.length >= MAX_WORKSPACES) return
  if (state.pages.length === 0 || state.pages[state.pages.length - 1].items.length !== 0) state.pages.push(makePage(`Screen ${state.pages.length + 1}`))
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
    // Every cardinal or diagonal one-finger swipe can page Home; choose its
    // nearest axis after the distance threshold instead of dropping diagonals.
    if (Math.max(absX, absY) < 64) return null
    if (absX > absY) return dx > 0 ? 'previous' : 'next'
    return dy > 0 ? 'previous' : 'next'
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
