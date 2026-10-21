// CyberManju OS — Role: verify the local per-entity UI store.
// CyberManju OS — Integrates: stable IDs, snapshots, position, and size operations.
import { afterEach, describe, expect, it } from 'vitest'
import { isReactive } from 'vue'
import {
  clearUiEntities,
  getUiEntitiesSnapshot,
  getUiEntityRegistry,
  pruneUiEntities,
  registerUiEntity,
  unregisterUiEntity,
  updateUiEntityPosition,
  updateUiEntitySize,
} from '../../src/utils/uiEntities'

afterEach(() => clearUiEntities())

describe('local UI entity store', () => {
  it('keeps a reactive object identity for a stable ID across registrations', () => {
    const entity = registerUiEntity({ id: 'window:settings', component: 'app-window', components: { position: { x: 0.1, y: -0.2 } } })!
    expect(isReactive(entity)).toBe(true)
    const again = registerUiEntity({ id: 'window:settings', component: 'dialog', components: { size: { width: 0.5, height: 0.4 } } })
    expect(again).toBe(entity)
    expect(entity.component).toBe('dialog')
    expect(entity.components).toMatchObject({ position: { x: 0.1, y: -0.2 }, size: { width: 0.5, height: 0.4 } })
  })

  it('updates position and size independently and returns detached snapshots', () => {
    registerUiEntity({ id: 'dock', component: 'desktop-dock' })
    expect(updateUiEntityPosition('dock', { x: 0.25, y: -0.1 })).toBe(true)
    expect(updateUiEntitySize('dock', { width: 0.3, height: 0.12 })).toBe(true)
    const snapshot = getUiEntitiesSnapshot()
    expect(snapshot).toEqual([{ id: 'dock', component: 'desktop-dock', components: { position: { x: 0.25, y: -0.1 }, size: { width: 0.3, height: 0.12 } } }])
    snapshot[0].components.position!.x = 99
    expect(getUiEntitiesSnapshot()[0].components.position?.x).toBe(0.25)
    expect(updateUiEntityPosition('dock', { x: Infinity, y: 0 })).toBe(false)
    expect(updateUiEntitySize('dock', { width: 0, height: 1 })).toBe(false)
  })

  it('detaches arbitrary components and returns JSON-safe snapshots', () => {
    const nested: Record<string, unknown> = { label: 'before', callback: () => 'nope' }
    nested.self = nested
    const supplied = { nested, list: [1, undefined, () => 2] }
    registerUiEntity({ id: 'safe', component: 'card', components: { custom: supplied } })
    nested.label = 'after'
    const snapshot = getUiEntitiesSnapshot()[0]
    expect(snapshot.components.custom).toEqual({ nested: { label: 'before' }, list: [1, null, null] })
    expect(() => JSON.stringify(snapshot)).not.toThrow()
    ;(snapshot.components.custom as { nested: { label: string } }).nested.label = 'changed'
    expect((getUiEntitiesSnapshot()[0].components.custom as { nested: { label: string } }).nested.label).toBe('before')
  })
  it('prunes stale IDs and unregisters explicitly', () => {
    registerUiEntity({ id: 'a', component: 'button' })
    registerUiEntity({ id: 'b', component: 'window' })
    expect(pruneUiEntities(['b'])).toEqual(['a'])
    expect([...getUiEntityRegistry().keys()]).toEqual(['b'])
    expect(unregisterUiEntity('b')).toBe(true)
    expect(unregisterUiEntity('missing')).toBe(false)
    expect(getUiEntitiesSnapshot()).toEqual([])
  })

  it('rejects unsafe IDs and malformed registrations', () => {
    expect(registerUiEntity({ id: '__proto__', component: 'bad' })).toBeNull()
    expect(registerUiEntity({ id: '', component: 'bad' })).toBeNull()
    expect(registerUiEntity({ id: 'ok', component: '' })).toBeNull()
    expect(getUiEntitiesSnapshot()).toEqual([])
  })
})
