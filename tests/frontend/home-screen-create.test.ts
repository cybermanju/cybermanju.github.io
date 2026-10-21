// CyberManju OS — Home screen creation and native instance tests.
// Role: exercise explicit bounded creation and multiple independent widget placements.
import { describe, expect, it } from 'vitest'
import { addHomeItem, createHomeState, createHomeWorkspace, MAX_WORKSPACES, moveHomeItem, normalizeHomeState } from '../../src/utils/homeWorkspaces'
describe('explicit Home screen creation', () => {
  it('creates stable empty screens and preserves them on reload', () => {
    const state = createHomeState(['files'])
    const id = createHomeWorkspace(state)
    expect(id).toBeTruthy()
    expect(state.activeId).toBe(id)
    expect(state.pages.at(-1)?.items).toEqual([])
    expect(normalizeHomeState(JSON.parse(JSON.stringify(state)), ['files'])).toEqual(state)
  })
  it('stops at the explicit screen cap without changing selection', () => {
    const state = createHomeState([])
    while (state.pages.length < MAX_WORKSPACES) expect(createHomeWorkspace(state)).toBeTruthy()
    const previous = JSON.stringify(state)
    expect(createHomeWorkspace(state)).toBeNull()
    expect(JSON.stringify(state)).toBe(previous)
  })
  it('moves independent widget placements even when they share a catalog reference', () => {
    const state = createHomeState([])
    const [from, to] = state.pages
    expect(addHomeItem(state, from.id, { id: 'placement-a', kind: 'widget', ref: 'native:provider', data: { provider: 'opaque/component' } })).toBe(true)
    expect(addHomeItem(state, to.id, { id: 'placement-b', kind: 'widget', ref: 'native:provider', data: { provider: 'opaque/component' } })).toBe(true)
    expect(moveHomeItem(state, 'placement-a', from.id, to.id)).toBe(true)
    expect(to.items.map(i => i.id)).toEqual(['placement-b', 'placement-a'])
  })
})
