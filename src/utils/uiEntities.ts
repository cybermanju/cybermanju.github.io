// CyberManju OS — local UI entity registry (src/utils/uiEntities.ts).
// Role: reactive, per-ID component state for UI layout controllers.
// Integrates: Vue reactivity; persistence remains owned by uiLayout/uiAppearance.
// Contracts: IDs identify stable reactive entity objects; snapshots are detached.
import { reactive, toRaw } from 'vue'

export interface UiEntityPosition { x: number; y: number }
export interface UiEntitySize { width: number; height: number }
export interface UiEntityComponents {
  position?: UiEntityPosition
  size?: UiEntitySize
  [component: string]: unknown
}
export interface UiEntity {
  readonly id: string
  component: string
  components: UiEntityComponents
}
export interface UiEntitySnapshot {
  id: string
  component: string
  components: UiEntityComponents
}
export interface UiEntityRegistration {
  id: string
  component: string
  components?: UiEntityComponents
}

const entities = reactive(new Map<string, UiEntity>())
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512 && !['__proto__', 'prototype', 'constructor'].includes(id)
const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function cloneJsonSafe(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return undefined
  const raw = toRaw(value)
  if (typeof Node !== 'undefined' && raw instanceof Node) return undefined
  if (ancestors.has(raw)) return undefined
  if (Array.isArray(raw)) {
    ancestors.add(raw)
    const result = raw.map(item => {
      const cloned = cloneJsonSafe(item, ancestors)
      return cloned === undefined ? null : cloned
    })
    ancestors.delete(raw)
    return result
  }
  const prototype = Object.getPrototypeOf(raw)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  ancestors.add(raw)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(raw)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    const cloned = cloneJsonSafe(item, ancestors)
    if (cloned !== undefined) result[key] = cloned
  }
  ancestors.delete(raw)
  return result
}
function copyComponents(input: UiEntityComponents = {}): UiEntityComponents {
  const output: UiEntityComponents = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'position' && value && typeof value === 'object') {
      const p = value as Partial<UiEntityPosition>
      if (finite(p.x) && finite(p.y)) output.position = { x: p.x, y: p.y }
    } else if (key === 'size' && value && typeof value === 'object') {
      const s = value as Partial<UiEntitySize>
      if (finitePositive(s.width) && finitePositive(s.height)) output.size = { width: s.width, height: s.height }
    } else if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      const cloned = cloneJsonSafe(value)
      if (cloned !== undefined) output[key] = cloned
    }
  }
  return output
}

/** Register a UI entity, preserving its reactive object identity across re-registration. */
export function registerUiEntity(registration: UiEntityRegistration): UiEntity | null {
  if (!registration || !validId(registration.id) || typeof registration.component !== 'string' || !registration.component) return null
  let entity = entities.get(registration.id)
  const incoming = copyComponents(registration.components)
  if (!entity) {
    entity = reactive({ id: registration.id, component: registration.component, components: incoming }) as UiEntity
    entities.set(registration.id, entity)
  } else {
    entity.component = registration.component
    Object.assign(entity.components, incoming)
  }
  return entity
}

/** Update one component without replacing the persistent entity object. */
export function updateUiEntityPosition(id: string, position: UiEntityPosition): boolean {
  if (!validId(id) || !finite(position?.x) || !finite(position?.y)) return false
  const entity = entities.get(id)
  if (!entity) return false
  entity.components.position = { x: position.x, y: position.y }
  return true
}
export function updateUiEntitySize(id: string, size: UiEntitySize): boolean {
  if (!validId(id) || !finitePositive(size?.width) || !finitePositive(size?.height)) return false
  const entity = entities.get(id)
  if (!entity) return false
  entity.components.size = { width: size.width, height: size.height }
  return true
}
/** Set/remove a named local component (e.g. appearance) without owning its persistence. */
export function updateUiEntityComponent(id: string, name: string, value: unknown | null): boolean {
  if (!validId(id) || !name || ['position', 'size', '__proto__', 'prototype', 'constructor'].includes(name)) return false
  const entity = entities.get(id)
  if (!entity) return false
  if (value === null) delete entity.components[name]
  else entity.components[name] = value
  return true
}
export function unregisterUiEntity(id: string): boolean { return validId(id) && entities.delete(id) }

/** Prune IDs not present in the supplied live-ID set; returns removed IDs. */
export function pruneUiEntities(liveIds: Iterable<string>): string[] {
  const live = new Set([...liveIds].filter(validId))
  const removed: string[] = []
  for (const id of entities.keys()) if (!live.has(id)) { entities.delete(id); removed.push(id) }
  return removed
}

/** Detached, JSON-safe controller view. Does not read/write storage or serialize arbitrary entity values. */
export function getUiEntitiesSnapshot(): UiEntitySnapshot[] {
  return [...entities.values()].map(entity => {
    const components: UiEntityComponents = {}
    if (entity.components.position) components.position = { ...entity.components.position }
    if (entity.components.size) components.size = { ...entity.components.size }
    for (const [key, value] of Object.entries(toRaw(entity.components))) {
      if (key === 'position' || key === 'size') continue
      const cloned = cloneJsonSafe(value)
      if (cloned !== undefined) components[key] = cloned
    }
    return { id: entity.id, component: entity.component, components }
  })
}

/** Clear registry (primarily for isolated app/test lifecycles). */
export function clearUiEntities(): void { entities.clear() }
/** Reactive registry for controllers that need reactive iteration; prefer snapshot for transport/views. */
export function getUiEntityRegistry(): ReadonlyMap<string, UiEntity> { return entities }
