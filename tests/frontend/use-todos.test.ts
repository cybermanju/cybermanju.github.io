// CyberManju OS — Shared todo composable tests.
// Role: verify the legacy localStorage contract remains intact for Home and Archive.
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('shared local todo state', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the legacy key and supports add, toggle, remove and clear-done', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    })
    const { useTodos } = await import('../../src/composables/useTodos')
    const state = useTodos()

    expect(state.todos.value).toEqual([])
    expect(state.add('  Draft release notes  ')?.title).toBe('Draft release notes')
    expect(state.add('   ')).toBeNull()
    const first = state.todos.value[0]!
    expect(data.get('cybermanju.todos.v1')).toContain('Draft release notes')

    state.toggle(first.id)
    expect(state.todos.value[0]?.done).toBe(true)
    expect(state.clearDone()).toBe(1)
    expect(state.todos.value).toEqual([])

    state.add('Keep this')
    const id = state.todos.value[0]!.id
    state.remove(id)
    expect(state.todos.value).toEqual([])
  })
})
