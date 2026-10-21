// CyberManju OS — Search viewport tests (tests/frontend/search-viewport.test.ts).
// Role: Guard full-height mobile results above keyboards and viewport panning.
// Exports: none (Vitest suite).
// Integrates: useSearchViewport, mocked browser geometry and Vue lifecycle.
// Contracts: No percent-height cap, double keyboard subtraction, or leaked listeners.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const lifecycle = vi.hoisted(() => ({ mounted: undefined as (() => void) | undefined, unmounted: undefined as (() => void) | undefined }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => { lifecycle.mounted = callback },
  onUnmounted: (callback: () => void) => { lifecycle.unmounted = callback },
}))
import { searchResultsHeight, useSearchViewport } from '@/composables/useSearchViewport'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('search viewport geometry', () => {
  it('fills all available space, not a fixed percentage of the screen', () => {
    expect(searchResultsHeight(150, 844)).toBe(674)
    expect(searchResultsHeight(150, 844, 480)).toBe(310)
    expect(searchResultsHeight(150, 480, 480)).toBe(310)
  })
  it('accounts for visual viewport panning once and clamps to the layout viewport', () => {
    expect(searchResultsHeight(150, 844, 480, 30)).toBe(340)
    expect(searchResultsHeight(150, 844, 844, 30)).toBe(674)
    expect(searchResultsHeight(500, 844, 480)).toBe(0)
  })
  it('rejects hidden or invalid startup sizes rather than retaining a zero-height layout', () => {
    expect(searchResultsHeight(150, 0, 0)).toBeNull()
    expect(searchResultsHeight(150, 844, Number.NaN)).toBeNull()
    expect(searchResultsHeight(Number.NaN, 844)).toBeNull()
  })
})

it('updates on keyboard resize and pan, preserves valid measurements, and removes listeners', () => {
  vi.useFakeTimers()
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
  const win = Object.assign(new EventTarget(), {
    innerHeight: 844, visualViewport: viewport,
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 1) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  })
  const removeWindow = vi.spyOn(win, 'removeEventListener')
  const removeViewport = vi.spyOn(viewport, 'removeEventListener')
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect })
  vi.stubGlobal('window', win)
  const bar = ref({ getBoundingClientRect: () => ({ bottom: 150 }) } as HTMLElement)
  const results = ref({} as HTMLElement)
  const style = useSearchViewport(bar, results)
  lifecycle.mounted?.()
  vi.runAllTimers()
  expect(style.value).toEqual({ '--omni-mobile-results-height': '674px' })
  viewport.height = 480
  viewport.dispatchEvent(new Event('resize'))
  vi.runAllTimers()
  expect(style.value).toEqual({ '--omni-mobile-results-height': '310px' })
  viewport.offsetTop = 30
  viewport.dispatchEvent(new Event('scroll'))
  vi.runAllTimers()
  expect(style.value).toEqual({ '--omni-mobile-results-height': '340px' })
  viewport.height = 0
  viewport.dispatchEvent(new Event('resize'))
  vi.runAllTimers()
  expect(style.value).toEqual({ '--omni-mobile-results-height': '340px' })
  lifecycle.unmounted?.()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(removeWindow.mock.calls.map(([event]) => event)).toEqual(['resize', 'scroll'])
  expect(removeViewport.mock.calls.map(([event]) => event)).toEqual(['resize', 'scroll'])
})

it('uses the measured height for both mobile home and window search without shrinking result cards', () => {
  const source = readFileSync(new URL('../../src/components/OmniSearchPanel.vue', import.meta.url), 'utf8')
  expect(source).toContain(':style="resultsViewportStyle"')
  expect(source).toContain('.omni-drop, .omni--home .omni-drop {')
  expect(source).toContain('var(--omni-mobile-results-height, 50dvh)')
  expect(source).toContain('.omni-drop > * { flex-shrink: 0; }')
  expect(source).not.toContain('min(62dvh, 560px)')
})
