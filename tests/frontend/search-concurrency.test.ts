// CyberManju OS — Search concurrency regression tests (tests/frontend/search-concurrency.test.ts).
// Role: Ensure shared search never publishes superseded local responses.
// Exports: Vitest suite for request epochs, clearing, fallbacks, and pagination.
// Integrates: Pinia app store, mocked transport and notification adapters.
// Contracts: Only the latest local request may update results, errors or loading.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app'
const { invokeMock, notifyMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), notifyMock: vi.fn() }))
vi.mock('@/composables/useTauri', () => ({ invoke: invokeMock, getAuthToken: () => '', isStaticHost: () => false, isWebMode: () => false, setAuthToken: vi.fn() }))
vi.mock('@/composables/useNotifications', () => ({ useNotifications: () => ({ notify: notifyMock }) }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: vi.fn() }) }))
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const row = (id: string) => ({ fileId: id, fileName: id, snippet: 'Matched text', score: 1, matchType: 'content' })
beforeEach(() => { vi.clearAllMocks(); setActivePinia(createPinia()) })
describe('shared local search request ownership', () => {
  it('ignores a slow old response after the newest query has completed', async () => {
    const old = deferred<unknown>()
    invokeMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ results: [row('new')], total: 1 })
    const store = useAppStore(); const pending = store.searchFiles('old')
    await store.searchFiles('new'); old.resolve({ results: [row('old')], total: 1 }); await pending
    expect(store.searchResults.map(x => x.fileId)).toEqual(['new'])
    expect(store.isSearching).toBe(false)
  })
  it('does not clear the latest loading indicator when an older request finishes', async () => {
    const old = deferred<unknown>(), latest = deferred<unknown>()
    invokeMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const store = useAppStore(); const first = store.searchFiles('old'), second = store.searchFiles('latest')
    old.resolve({ results: [row('old')], total: 1 }); await first
    expect(store.isSearching).toBe(true); expect(store.searchResults).toEqual([])
    latest.resolve({ results: [row('latest')], total: 1 }); await second
    expect(store.isSearching).toBe(false)
  })
  it('clears immediately and prevents a previous response from returning', async () => {
    const old = deferred<unknown>(); invokeMock.mockReturnValueOnce(old.promise)
    const store = useAppStore(); const pending = store.searchFiles('old'); await store.searchFiles('')
    expect(store.isSearching).toBe(false)
    old.resolve({ results: [row('old')], total: 1 }); await pending
    expect(store.searchResults).toEqual([]); expect(store.searchTotalResults).toBe(0)
  })
  it('never retries a superseded failed primary request through the fallback', async () => {
    const old = deferred<unknown>()
    invokeMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ results: [row('new')], total: 1 })
    const store = useAppStore(); const pending = store.searchFiles('old'); await store.searchFiles('new')
    old.reject(new Error('old request failed')); await pending
    expect(invokeMock).toHaveBeenCalledTimes(2); expect(notifyMock).not.toHaveBeenCalled()
  })
  it('retains the legacy transport fallback and pagination for the current query', async () => {
    invokeMock.mockRejectedValueOnce(new Error('pagination unsupported')).mockResolvedValueOnce([row('first')]).mockResolvedValueOnce({ results: [row('second')], total: 2 })
    const store = useAppStore(); await store.searchFiles('term'); await store.searchFiles('term', 1)
    expect(store.searchResults.map(x => x.fileId)).toEqual(['first', 'second'])
    expect(store.searchTotalResults).toBe(2)
  })
})
