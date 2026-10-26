// CyberManju OS — Unified search pipeline (src/composables/useUnifiedSearch.ts).
// Role: coordinate one shared local-first query pipeline and optional DuckDuckGo fallback across search surfaces.
// Exports: UnifiedSearchController, createUnifiedSearchController, useUnifiedSearch.
// Integrates: Pinia app search, Vue reactivity, the public DuckDuckGo Instant Answer utility.
// Contracts: debounce local work; wait for local completion before fallback; abort and epoch-guard stale web results; never send local data.
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { searchDuckDuckGo, type DuckDuckGoResponse } from '@/utils/duckDuckGoSearch'

export interface UnifiedSearchState {
  localReadyQuery: Readonly<Ref<string>>
  webQuery: Readonly<Ref<string>>
  webResponse: Readonly<Ref<DuckDuckGoResponse | null>>
  webLoading: Readonly<Ref<boolean>>
  webError: Readonly<Ref<string>>
}

export interface UnifiedSearchController extends UnifiedSearchState {
  subscribe(localResultCount: () => number): () => void
  searchWeb(query: string): void
}

interface PipelineDependencies {
  query: Ref<string>
  searchLocal(query: string): Promise<unknown>
  fetchWeb(query: string, signal: AbortSignal): Promise<DuckDuckGoResponse>
  debounceMs?: number
}

/** A controller instance owns one watcher and one pipeline regardless of subscriber count. */
export function createUnifiedSearchController(deps: PipelineDependencies): UnifiedSearchController {
  const localReadyQuery = ref('')
  const webQuery = ref('')
  const webResponse = ref<DuckDuckGoResponse | null>(null)
  const webLoading = ref(false)
  const webError = ref('')
  const state = { localReadyQuery, webQuery, webResponse, webLoading, webError }
  const subscribers = new Map<symbol, () => number>()
  let stopWatch: (() => void) | null = null
  let localTimer: ReturnType<typeof setTimeout> | null = null
  let webTimer: ReturnType<typeof setTimeout> | null = null
  let epoch = 0
  let webRequestId = 0
  let webAbort: AbortController | null = null
  let disposed = false
  const debounceMs = deps.debounceMs ?? 250

  const cancelTimers = (): void => {
    if (localTimer) clearTimeout(localTimer)
    if (webTimer) clearTimeout(webTimer)
    localTimer = null
    webTimer = null
  }

  const invalidateWeb = (): void => {
    webRequestId++
    webAbort?.abort()
    webAbort = null
    webLoading.value = false
    webQuery.value = ''
    webResponse.value = null
    webError.value = ''
  }

  const performWeb = async (query: string, requestEpoch: number): Promise<void> => {
    if (disposed || !query || requestEpoch !== epoch || deps.query.value.trim() !== query) return
    webAbort?.abort()
    const controller = new AbortController()
    webAbort = controller
    const requestId = ++webRequestId
    webQuery.value = query
    webResponse.value = null
    webError.value = ''
    webLoading.value = true
    try {
      const result = await deps.fetchWeb(query, controller.signal)
      if (requestId !== webRequestId || requestEpoch !== epoch || deps.query.value.trim() !== query) return
      webResponse.value = result
    } catch (error) {
      if (requestId !== webRequestId || requestEpoch !== epoch || controller.signal.aborted) return
      webError.value = error instanceof Error ? error.message : 'DuckDuckGo search is unavailable.'
    } finally {
      if (requestId === webRequestId && requestEpoch === epoch) {
        webLoading.value = false
        webAbort = null
      }
    }
  }

  const scheduleWeb = (query: string, requestEpoch: number, delay = debounceMs): void => {
    if (webTimer) clearTimeout(webTimer)
    webTimer = setTimeout(() => {
      webTimer = null
      void performWeb(query, requestEpoch)
    }, delay)
  }

  const runLocal = async (query: string, requestEpoch: number): Promise<void> => {
    if (disposed || requestEpoch !== epoch || deps.query.value.trim() !== query) return
    try {
      await deps.searchLocal(query)
      if (!disposed && requestEpoch === epoch && deps.query.value.trim() === query) {
        localReadyQuery.value = query
        // Always pair local matches with web results. The home search is a
        // unified search surface, so a local hit must not suppress web context.
        scheduleWeb(query, requestEpoch)
      }
    } catch {
      // Local search owns its error reporting; failed local work still permits fallback.
      if (!disposed && requestEpoch === epoch && deps.query.value.trim() === query) {
        localReadyQuery.value = query
        scheduleWeb(query, requestEpoch)
      }
    }
  }

  const handleQuery = (value: string): void => {
    epoch++
    const requestEpoch = epoch
    const query = value.trim()
    cancelTimers()
    localReadyQuery.value = ''
    invalidateWeb()
    // The empty action is a cheap store-level invalidation: it clears any stale
    // BM25 page now, before the next debounced request can start.
    void deps.searchLocal('')

    if (query.length < 2) return
    localTimer = setTimeout(() => {
      localTimer = null
      void runLocal(query, requestEpoch)
    }, debounceMs)
  }

  const subscribe = (localResultCount: () => number): (() => void) => {
    if (disposed) return () => {}
    const subscription = Symbol('unified-search-view')
    subscribers.set(subscription, localResultCount)
    if (!stopWatch) stopWatch = watch(deps.query, handleQuery, { immediate: true, flush: 'sync' })
    let active = true
    return () => {
      if (!active) return
      active = false
      subscribers.delete(subscription)
      if (subscribers.size !== 0) return
      stopWatch?.()
      stopWatch = null
      epoch++
      cancelTimers()
      invalidateWeb()
      localReadyQuery.value = ''
    }
  }

  const searchWeb = (value: string): void => {
    const query = value.trim()
    if (query.length < 2 || query !== deps.query.value.trim()) return
    if (webTimer) clearTimeout(webTimer)
    webTimer = null
    void performWeb(query, epoch)
  }

  return {
    ...state,
    subscribe,
    searchWeb,
  }
}

let sharedController: UnifiedSearchController | null = null
let sharedUserCount = 0

/** Join the shared store-backed pipeline; only its first active view creates a watcher. */
export function useUnifiedSearch(localResultCount: () => number): UnifiedSearchController {
  const store = useAppStore()
  if (!sharedController) {
    sharedController = createUnifiedSearchController({
      query: computed({ get: () => store.searchQuery, set: (value) => { store.searchQuery = value } }),
      searchLocal: (query) => store.searchFiles(query),
      fetchWeb: (query, signal) => searchDuckDuckGo(query, { signal }),
    })
  }
  const controller = sharedController
  const unsubscribe = controller.subscribe(localResultCount)
  sharedUserCount++
  let active = true
  onUnmounted(() => {
    if (!active) return
    active = false
    unsubscribe()
    sharedUserCount = Math.max(0, sharedUserCount - 1)
    if (sharedUserCount === 0) sharedController = null
  })
  return controller
}
