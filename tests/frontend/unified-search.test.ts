// CyberManju OS — Unified search tests (tests/frontend/unified-search.test.ts).
// Role: verify shared local-first scheduling, stale-result protection, and public-web fallback state.
// Exports: none (Vitest suite).
// Integrates: Vue refs/watchers, useUnifiedSearch controller.
// Contracts: no web call before local completion; subscriptions deduplicate; clearing and races never publish stale web results.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, computed, nextTick } from 'vue'
vi.mock('@/stores/app', () => ({ useAppStore: vi.fn() }))
import { createUnifiedSearchController } from '../../src/composables/useUnifiedSearch'
import type { DuckDuckGoResponse } from '../../src/utils/duckDuckGoSearch'

const emptyResponse = (): DuckDuckGoResponse => ({ answer: '', answerSource: '', results: [] })
const flush = async (): Promise<void> => { await Promise.resolve(); await nextTick(); await Promise.resolve() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('unified search controller', () => {
  it('keeps computed query state synchronized in both directions', () => {
    const source = ref('first')
    const model = computed({ get: () => source.value, set: (value: string) => { source.value = value } })
    expect(model.value).toBe('first')
    source.value = 'from store'
    expect(model.value).toBe('from store')
    model.value = 'from input'
    expect(source.value).toBe('from input')
  })

  it('deduplicates two mounted consumers and waits for completed local search before web fallback', async () => {
    vi.useFakeTimers()
    const query = ref('existing query')
    const local = deferred<void>()
    const searchLocal = vi.fn((value: string) => value ? local.promise : Promise.resolve())
    const fetchWeb = vi.fn(async () => emptyResponse())
    const controller = createUnifiedSearchController({ query, searchLocal, fetchWeb, debounceMs: 250 })
    const count = vi.fn(() => 0)
    const offA = controller.subscribe(count)
    const offB = controller.subscribe(count)
    await vi.advanceTimersByTimeAsync(250)
    expect(searchLocal).toHaveBeenCalledTimes(2) // immediate empty-page invalidation + one actual query
    expect(searchLocal).toHaveBeenLastCalledWith('existing query')
    expect(fetchWeb).not.toHaveBeenCalled()
    local.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchWeb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(fetchWeb).toHaveBeenCalledTimes(1)
    expect(controller.localReadyQuery.value).toBe('existing query')
    offA()
    expect(controller.webQuery.value).toBe('existing query')
    offB()
  })

  it('does not fall back when local rows exist, but permits explicit web intent', async () => {
    vi.useFakeTimers()
    const query = ref('local match')
    const searchLocal = vi.fn(async () => undefined)
    const fetchWeb = vi.fn(async () => emptyResponse())
    const controller = createUnifiedSearchController({ query, searchLocal, fetchWeb, debounceMs: 100 })
    const stop = controller.subscribe(() => 3)
    await vi.advanceTimersByTimeAsync(100)
    await flush()
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchWeb).not.toHaveBeenCalled()
    controller.searchWeb(query.value)
    await flush()
    expect(fetchWeb).toHaveBeenCalledTimes(1)
    expect(controller.webResponse.value).toEqual(emptyResponse())
    stop()
  })

  it('clearing or changing query aborts and ignores a late response', async () => {
    vi.useFakeTimers()
    const query = ref('older search')
    const oldResponse = deferred<DuckDuckGoResponse>()
    const signals: AbortSignal[] = []
    const fetchWeb = vi.fn((_value: string, signal: AbortSignal) => { signals.push(signal); return oldResponse.promise })
    const controller = createUnifiedSearchController({
      query, searchLocal: async () => undefined, fetchWeb, debounceMs: 10,
    })
    const stop = controller.subscribe(() => 0)
    await vi.advanceTimersByTimeAsync(20)
    await flush()
    await vi.advanceTimersByTimeAsync(10)
    expect(fetchWeb).toHaveBeenCalledTimes(1)
    query.value = ''
    await flush()
    expect(signals[0].aborted).toBe(true)
    oldResponse.resolve({ answer: 'stale', answerSource: '', results: [] })
    await flush()
    expect(controller.webResponse.value).toBeNull()
    expect(controller.webLoading.value).toBe(false)
    stop()
  })

  it('surfaces fallback errors and honest empty responses without stale state', async () => {
    vi.useFakeTimers()
    const query = ref('query error')
    const fetchWeb = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(emptyResponse())
    const controller = createUnifiedSearchController({ query, searchLocal: async () => undefined, fetchWeb, debounceMs: 5 })
    const stop = controller.subscribe(() => 0)
    await vi.advanceTimersByTimeAsync(10)
    await flush()
    await vi.advanceTimersByTimeAsync(5)
    await flush()
    expect(controller.webError.value).toBe('network unavailable')
    controller.searchWeb(query.value)
    await flush()
    expect(controller.webResponse.value).toEqual(emptyResponse())
    expect(controller.webError.value).toBe('')
    expect(controller.webLoading.value).toBe(false)
    stop()
  })

  it('does not run a stale local result into the current query after edits', async () => {
    vi.useFakeTimers()
    const query = ref('initial query')
    const first = deferred<void>()
    const searchLocal = vi.fn((value: string) => value === 'initial query' ? first.promise : Promise.resolve())
    const controller = createUnifiedSearchController({ query, searchLocal, fetchWeb: async () => emptyResponse(), debounceMs: 20 })
    const stop = controller.subscribe(() => 1)
    await vi.advanceTimersByTimeAsync(20)
    query.value = 'new query'
    first.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(20)
    await flush()
    expect(searchLocal).toHaveBeenLastCalledWith('new query')
    expect(controller.localReadyQuery.value).toBe('new query')
    stop()
  })
})
