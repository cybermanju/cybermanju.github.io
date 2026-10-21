import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundedReaderRequest,
  emptyScreenReaderStatus,
  parseScreenReaderStatus,
  screenReaderActive,
  SCREEN_READER_TIMEOUT_MS,
  type ReaderStatus,
} from '../../src/utils/appScreenReader'

const snap = (over: Partial<ReaderStatus> = {}): ReaderStatus => ({
  sessionId: null, state: 'idle', packageName: null, index: 0, total: 0,
  overlayGranted: false, packages: [], mode: null, captures: [], engine: '', limitation: '', ...over,
})

afterEach(() => vi.useRealTimers())

describe('appScreenReader', () => {
  it('expõe status vazio válido e valida o formato/invariantes nativos', () => {
    expect(emptyScreenReaderStatus()).toEqual(snap())
    expect(parseScreenReaderStatus(snap({ state: 'reading', sessionId: 's1', packages: ['pkg.a'], packageName: 'pkg.a', mode: 'single', total: 1 })).state).toBe('reading')
    for (const invalid of [null, {}, { ...snap(), state: 'unknown' }, { ...snap(), overlayGranted: 'yes' },
      { ...snap(), packages: [' '] }, { ...snap(), total: 1 },
      { ...snap({ state: 'reading', packages: ['pkg.a'], total: 1, mode: 'single' }), sessionId: null },
      { ...snap(), captures: [{ packageName: 'missing', selectedAt: 1 }] }]) {
      expect(() => parseScreenReaderStatus(invalid)).toThrow(/Invalid Android reader status/)
    }
  })

  it('separa erro do envelope IPC de lastError da sessão', () => {
    expect(parseScreenReaderStatus(snap({ state: 'error', lastError: 'session failure' })).lastError).toBe('session failure')
    expect(() => parseScreenReaderStatus({ ...snap(), error: 'IPC failure' })).toThrow('IPC failure')
  })

  it('considera somente awaiting_permission, selecting e reading estados ativos', () => {
    for (const state of ['awaiting_permission', 'selecting', 'reading'] as const) expect(screenReaderActive(snap({ state })).valueOf()).toBe(true)
    for (const state of ['idle', 'stopped', 'cancelled', 'error'] as const) expect(screenReaderActive(snap({ state }))).toBe(false)
  })

  it('limita requisições a 10 segundos sem retry implícito', async () => {
    vi.useFakeTimers()
    const request = vi.fn(() => new Promise<ReaderStatus>(() => {}))
    const result = boundedReaderRequest(request())
    const rejected = expect(result).rejects.toThrow(/refresh status before trying again/)
    await vi.advanceTimersByTimeAsync(SCREEN_READER_TIMEOUT_MS)
    await rejected
    expect(SCREEN_READER_TIMEOUT_MS).toBe(10_000)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
