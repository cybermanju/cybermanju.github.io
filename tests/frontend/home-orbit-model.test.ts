// CyberManju OS — Home workspace model behavior (tests/frontend/home-orbit-model.test.ts).
// Role: lock down normalization, mutation, persistence-shape, and gesture invariants.
// Exports: none.
// Integrates: Vitest, src/utils/homeWorkspaces.ts.
// Contracts: empty pages and active selection persist; mutations stay bounded and safe.
import { describe, expect, it } from 'vitest'
import {
  MAX_WORKSPACES,
  addHomeItem,
  classifyHomeGesture,
  createHomeState,
  createHomeWorkspace,
  homeGridCols,
  homeGridNeighbors,
  homeHueForScreen,
  moveHomeItem,
  normalizeHomeState,
  removeHomeItem,
  type HomeItem,
  type HomeWorkspaceState,
} from '../../src/utils/homeWorkspaces'

const app = (id: string, ref: string): HomeItem => ({ id, kind: 'app', ref })
const stateWith = (...pages: HomeWorkspaceState['pages']): HomeWorkspaceState => ({
  version: 1,
  activeId: pages[0]?.id ?? '',
  pages,
  theme: 'aurora',
})

describe('home workspace model', () => {
  it('retains deliberately empty pages and activeId across normalization/reload', () => {
    const stored = stateWith(
      { id: 'first', title: 'Home', items: [app('item-a', 'calendar')] },
      { id: 'empty-middle', title: 'Ideas', items: [] },
      { id: 'active-empty', title: 'Focus', items: [] },
    )
    stored.activeId = 'active-empty'

    const normalized = normalizeHomeState(JSON.parse(JSON.stringify(stored)), ['calendar'])
    const reloaded = normalizeHomeState(JSON.parse(JSON.stringify(normalized)), ['calendar'])

    expect(normalized.pages.map(page => page.id)).toEqual(['first', 'empty-middle', 'active-empty'])
    expect(reloaded.pages.map(page => page.id)).toEqual(['first', 'empty-middle', 'active-empty'])
    expect(normalized.activeId).toBe('active-empty')
    expect(reloaded.activeId).toBe('active-empty')
  })

  it('keeps the source page when moving its last item or removing its last item', () => {
    const moved = stateWith(
      { id: 'source', title: 'Source', items: [app('move-me', 'mail')] },
      { id: 'target', title: 'Target', items: [] },
    )
    expect(moveHomeItem(moved, 'move-me', 'source', 'target')).toBe(true)
    expect(moved.pages.map(page => page.id)).toContain('source')
    expect(moved.pages.find(page => page.id === 'source')?.items).toEqual([])
    expect(moved.pages.find(page => page.id === 'target')?.items.map(item => item.id)).toEqual(['move-me'])

    const removed = stateWith({ id: 'remove-source', title: 'Source', items: [app('remove-me', 'notes')] })
    removeHomeItem(removed, 'remove-source', 'remove-me')
    expect(removed.pages.map(page => page.id)).toContain('remove-source')
    expect(removed.pages.find(page => page.id === 'remove-source')?.items).toEqual([])
  })

  it('reuses one trailing empty page, fills to the cap and never exceeds MAX_WORKSPACES', () => {
    const state = createHomeState([])
    expect(state.pages).toHaveLength(2)
    expect(state.pages.at(-1)?.items).toEqual([])
    // The isolated trailing empty page is reused, not extended.
    const reused = createHomeWorkspace(state)
    expect(reused).not.toBeNull()
    expect(state.pages).toHaveLength(2)
    expect(state.pages.at(-1)?.id).toBe(reused)
    // Content on the trailing page grows the trunk: create → fill in lockstep.
    let page: string | null = createHomeWorkspace(state)
    while (page) {
      expect(addHomeItem(state, page, app(`app-${page}`, 'browser'))).toBe(true)
      if (state.pages.length >= MAX_WORKSPACES) break
      page = createHomeWorkspace(state)
    }
    expect(state.pages).toHaveLength(MAX_WORKSPACES)
    // Even at the cap, a trailing empty page is reusable — null only means
    // the trunk is full with every page populated.
    expect(createHomeWorkspace(state)).toBe(state.pages.at(-1)?.id)
    expect(state.pages).toHaveLength(MAX_WORKSPACES)

    const fullWithPopulatedTail = stateWith(...Array.from({ length: MAX_WORKSPACES }, (_, index) => ({
      id: `page-${index}`,
      title: `Page ${index}`,
      items: index === MAX_WORKSPACES - 1 ? [app('tail-item', 'tail')] : [],
    })))
    expect(createHomeWorkspace(fullWithPopulatedTail)).toBeNull()
    expect(addHomeItem(fullWithPopulatedTail, `page-${MAX_WORKSPACES - 1}`, app('another', 'another'))).toBe(true)
    expect(fullWithPopulatedTail.pages).toHaveLength(MAX_WORKSPACES)
  })

  it('rejects moving an app into a page that already contains that app without mutating either page', () => {
    const state = stateWith(
      { id: 'from', title: 'From', items: [app('original', 'browser')] },
      { id: 'to', title: 'To', items: [app('existing', 'browser')] },
    )
    expect(moveHomeItem(state, 'original', 'from', 'to')).toBe(false)
    expect(state.pages[0].items).toEqual([app('original', 'browser')])
    expect(state.pages[1].items).toEqual([app('existing', 'browser')])
  })

  it('falls back safely for corrupted state and discards malformed items', () => {
    const fallback = normalizeHomeState({ version: 9, pages: null }, ['mail'])
    expect(fallback.version).toBe(1)
    expect(fallback.pages.length).toBeGreaterThan(0)
    expect(fallback.pages[0].items.map(item => item.ref)).toContain('mail')

    const recovered = normalizeHomeState({
      version: 1,
      activeId: 'valid',
      theme: 'not-a-theme',
      pages: [
        { id: 'valid', title: 'Valid', items: [app('good', 'mail'), { id: '', kind: 'app', ref: 'bad' }, { id: 'bad-kind', kind: 'unknown', ref: 'bad' }] },
        { id: 'broken', title: 'Broken', items: 'not-an-array' },
      ],
    }, [])
    expect(recovered.pages[0].id).toBe('valid')
    expect(recovered.pages[0].items).toEqual([app('good', 'mail')])
    expect(recovered.theme).toBe('aurora')
    expect(recovered.pages.some(page => page.id === 'broken')).toBe(false)
  })

  it('classifies only threshold-crossing, dominant-axis gestures with the matching finger count', () => {
    expect(classifyHomeGesture(0, -72, 3)).toBe('overview-open')
    expect(classifyHomeGesture(0, 72, 3)).toBe('overview-close')
    expect(classifyHomeGesture(64, 0, 1)).toBe('previous')
    expect(classifyHomeGesture(-64, 0, 1)).toBe('next')
    // Diagonal one-finger swipes also page: the sweep is classified on the nearest axis.
    expect(classifyHomeGesture(100, 100, 1)).toBe('previous')
    expect(classifyHomeGesture(-100, -100, 1)).toBe('next')
    expect(classifyHomeGesture(-64, 0, 2)).toBe('next')
    expect(classifyHomeGesture(64, 0, 2)).toBe('previous')
    expect(classifyHomeGesture(0, -64, 2)).toBe('next')
    expect(classifyHomeGesture(0, 64, 2)).toBe('previous')
    expect(classifyHomeGesture(80, 64, 2)).toBe('previous')
    expect(classifyHomeGesture(64, 80, 2)).toBe('previous')
    expect(classifyHomeGesture(79, 64, 2)).toBeNull()
    expect(classifyHomeGesture(64, 64, 2)).toBeNull()
    expect(classifyHomeGesture(63, 0, 2)).toBeNull()
    expect(classifyHomeGesture(0, -71, 3)).toBeNull()
    expect(classifyHomeGesture(63, 0, 1)).toBeNull()
    expect(classifyHomeGesture(100, 0, 3)).toBeNull()
    expect(classifyHomeGesture(Number.NaN, 100, 1)).toBeNull()
    expect(classifyHomeGesture(Number.POSITIVE_INFINITY, 0, 2)).toBeNull()
    expect(classifyHomeGesture(0, Number.NEGATIVE_INFINITY, 2)).toBeNull()
    expect(classifyHomeGesture(-100, 0, 0)).toBeNull()
    expect(classifyHomeGesture(-100, 0, 4)).toBeNull()
  })

  describe('orb grid map (homeGridCols / homeGridNeighbors / homeHueForScreen)', () => {
    it('builds a square-ish row-major grid both the orb and the studio can agree on', () => {
      expect(homeGridCols(0)).toBe(1)
      expect(homeGridCols(1)).toBe(1)
      expect(homeGridCols(2)).toBe(2)
      expect(homeGridCols(5)).toBe(3)
      expect(homeGridCols(9)).toBe(3)
      expect(homeGridCols(24)).toBe(5) // capped at MAX_WORKSPACES
      expect(homeGridCols(Number.NaN)).toBe(1)
    })

    it('gives linear left/right neighbors and row-jump up/down neighbors', () => {
      // 7 pages → cols 3 → rows of 3, 3, 1
      const neighborsOf = (index: number) => {
        const n = homeGridNeighbors(index, 7)
        return [n.left, n.right, n.up, n.down]
      }
      expect(neighborsOf(0)).toEqual([-1, 1, -1, 3])
      expect(neighborsOf(2)).toEqual([1, 3, -1, 5]) // right crosses into the next row (linear paging)
      expect(neighborsOf(3)).toEqual([2, 4, 0, 6])
      expect(neighborsOf(6)).toEqual([5, -1, 3, -1]) // last page: left wall and floor
      expect(homeGridNeighbors(-1, 3).left).toBe(-1) // out-of-range reads as all walls
    })

    it('assigns stable per-screen hues on the color wheel', () => {
      expect(homeHueForScreen(0)).toBe(homeHueForScreen(0))
      expect(homeHueForScreen(0)).not.toBe(homeHueForScreen(1))
      for (let i = 0; i < 24; i++) {
        const hue = homeHueForScreen(i)
        expect(hue).toBeGreaterThanOrEqual(0)
        expect(hue).toBeLessThan(360)
      }
    })
  })
})
