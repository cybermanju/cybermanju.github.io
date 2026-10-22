// CyberManju OS — Default Home frontend contract tests.
// Role: exercise exact Audio/Sys role semantics without claiming an Android integration test.
// Exports: Vitest suite. Integrates: UI controller with deterministic contract-response test doubles.
// Contracts: native bridge remains authoritative; no startup request, invented refusal or pending success.
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => false, isTauri: () => false }))
import { createHomeRoleAction, type HomeRoleStatus, type HomeRoleRequestOutcome } from '@/composables/useHomeRoleAction'
function fixture(supported = true) {
  let now = 1000, visible = true, receive!: (value: unknown) => void, sequence = 0
  const status = vi.fn(async (): Promise<HomeRoleStatus> => ({ state: 'not_held', apiLevel: 34 }))
  const request = vi.fn(async (id: string): Promise<unknown> => ({ state: 'pending', requestId: id }))
  const setReady = vi.fn()
  const acknowledge = vi.fn()
  const stop = vi.fn(), beforeRequest = vi.fn(async () => true)
  const subscribe = vi.fn(async (handler: (value: unknown) => void) => { receive = handler; return stop })
  const role = createHomeRoleAction({ supported, status, request, beforeRequest, subscribe, setReady, acknowledge, now: () => now, visible: () => visible, requestId: () => `attempt-${++sequence}` })
  const click = (properties = {}) => ({ isTrusted: true, timeStamp: 1000, ...properties }) as MouseEvent
  return { role, status, request, stop, subscribe, setReady, acknowledge, beforeRequest, click, elapsed: (ms: number) => { now += ms }, hide: () => { visible = false }, deliver: (value: unknown) => receive(value) }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
afterEach(() => vi.useRealTimers())
describe('Android default Home UI contract', () => {
  it('subscribes before querying passive status and stays off-device fail-closed', async () => {
    const f = fixture(); await f.role.start()
    expect(f.subscribe.mock.invocationCallOrder[0]).toBeLessThan(f.status.mock.invocationCallOrder[0])
    expect(f.setReady).toHaveBeenCalledExactlyOnceWith(true)
    expect(f.subscribe.mock.invocationCallOrder[0]).toBeLessThan(f.setReady.mock.invocationCallOrder[0])
    expect(f.setReady.mock.invocationCallOrder[0]).toBeLessThan(f.status.mock.invocationCallOrder[0])
    expect(f.status).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); expect(f.role.canRequest.value).toBe(true)
    const off = fixture(false); await off.role.start(); await off.role.request(off.click())
    expect(off.status).not.toHaveBeenCalled(); expect(off.subscribe).not.toHaveBeenCalled(); expect(off.request).not.toHaveBeenCalled()
  })
  it('disables the CTA for missing commands and invalid status responses', async () => {
    for (const value of [null, { state: 'pending', apiLevel: 34 }, { state: 'not_held', apiLevel: 23 }, { state: 'not_held', apiLevel: 34, pendingRequestId: '' }]) {
      const f = fixture(); f.status.mockResolvedValue(value as any); await f.role.start(); await f.role.request(f.click())
      expect(f.role.state.value).toBe('unavailable'); expect(f.request).not.toHaveBeenCalled()
    }
    const f = fixture(); f.status.mockRejectedValue(new Error('command not found')); await f.role.start()
    expect(f.role.canRequest.value).toBe(false); expect(f.role.notice.value).toContain('unavailable')
  })
  it('fails closed if subscribing fails', async () => {
    const f = fixture(); f.subscribe.mockRejectedValue(new Error('no listener')); await f.role.start()
    expect(f.role.canRequest.value).toBe(false); expect(f.status).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.setReady).not.toHaveBeenCalledWith(true)
  })
  it('requires a fresh trusted CTA and visible focused Activity context', async () => {
    const f = fixture(); await f.role.start()
    for (const event of [f.click({ isTrusted: false }), f.click({ timeStamp: -5000 }), f.click({ timeStamp: NaN }), f.click({ timeStamp: 2000 })]) await f.role.request(event)
    f.hide(); await f.role.request(f.click()); expect(f.request).not.toHaveBeenCalled()
  })
  it('requires native widget suspension before opening Android choice', async () => {
    const f = fixture(); await f.role.start(); f.beforeRequest.mockResolvedValue(false)
    await f.role.request(f.click()); expect(f.request).not.toHaveBeenCalled()
  })
  it.each([0, 5000, 5001])('enforces the monotonic final-invoke boundary at %s ms', async age => {
    const f = fixture(); await f.role.start(); f.beforeRequest.mockImplementation(async () => { f.elapsed(age); return true })
    await f.role.request(f.click()); expect(f.request).toHaveBeenCalledTimes(age <= 5000 ? 1 : 0)
  })
  it('passes the exact correlation ID once even for concurrent clicks; pending is not success', async () => {
    const f = fixture(); await f.role.start(); await Promise.all([f.role.request(f.click()), f.role.request(f.click())]); await f.role.request(f.click())
    expect(f.request).toHaveBeenCalledExactlyOnceWith('attempt-1'); expect(f.role.pendingId.value).toBe('attempt-1')
    expect(f.role.state.value).toBe('not_held'); expect(f.role.notice.value).not.toContain('is your default')
  })
  it('ignores unrelated and malformed outcomes', async () => {
    const f = fixture(); await f.role.start(); f.deliver({ requestId: 'old', state: 'not_held' })
    expect(f.role.attempt.value).toBeNull(); expect(f.status).toHaveBeenCalledOnce()
    await f.role.request(f.click()); const calls = f.status.mock.calls.length
    for (const value of [{ requestId: 'other', state: 'held' }, { requestId: 'attempt-1', state: 'pending' }, null, { state: 'held' }]) f.deliver(value)
    expect(f.status).toHaveBeenCalledTimes(calls); expect(f.role.pendingId.value).toBe('attempt-1')
    expect(f.acknowledge).not.toHaveBeenCalled()
  })
  it.each(['held', 'not_held', 'unavailable', 'failed'] as const)('ACKs a matching %s synchronously before status reconciliation', async state => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    f.status.mockImplementation(async () => {
      expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith('attempt-1')
      return { state: 'not_held', apiLevel: 34 }
    })
    f.deliver({ requestId: 'attempt-1', state })
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith('attempt-1')
    expect(f.role.pendingId.value).toBe('attempt-1')
    await flush()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe(state)
  })
  it('does not infer completion from focus, visibility or a passive check', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click()); await f.role.returned(); await f.role.check()
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.attempt.value).toBeNull(); expect(f.role.canRequest.value).toBe(false)
    expect(f.request).toHaveBeenCalledOnce()
  })
  it.each([24, 28, 29, 34])('reports observed not_held without inventing refusal on API %s', async apiLevel => {
    const f = fixture(); f.status.mockResolvedValue({ state: 'not_held', apiLevel }); await f.role.start(); await f.role.request(f.click())
    f.deliver({ requestId: 'attempt-1', state: 'not_held' } satisfies HomeRoleRequestOutcome); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.state.value).toBe('not_held')
    expect(f.role.attempt.value).toBe('not_held'); expect(f.role.notice.value).toContain('not the default Home')
  })
  it('shows success only when the authoritative status query returns held', async () => {
    const f = fixture(); await f.role.start(); f.request.mockResolvedValue({ state: 'held' }); await f.role.request(f.click())
    expect(f.role.state.value).toBe('not_held'); expect(f.role.notice.value).not.toContain('is your default')
    const held = fixture(); await held.role.start(); await held.role.request(held.click()); held.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
    held.deliver({ requestId: 'attempt-1', state: 'held' }); await held.role.check()
    expect(held.role.state.value).toBe('held'); expect(held.role.notice.value).toBe('CyberManju is your default Home.')
  })
  it('does not request an already-held role', async () => {
    const f = fixture(); f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); await f.role.start(); await f.role.request(f.click())
    expect(f.request).not.toHaveBeenCalled(); expect(f.role.notice.value).toContain('is your default')
  })
  it.each(['unavailable', 'failed'] as const)('handles terminal request-start %s without reporting success', async state => {
    const f = fixture(); await f.role.start(); f.request.mockResolvedValue({ state }); await f.role.request(f.click())
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe(state); expect(f.role.notice.value).not.toContain('is your default')
  })
  it('retains pending correlation if Activity return precedes the start reply', async () => {
    const f = fixture(); await f.role.start(); let finish!: (v: unknown) => void
    f.request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const operation = f.role.request(f.click()); await flush()
    await f.role.returned(); finish({ state: 'pending', requestId: 'attempt-1' }); await operation
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.state.value).toBe('not_held')
  })
  it.each([{ state: 'pending', requestId: 'other' }, { state: 'pending' }, { state: 'not_held' }])('rejects invalid start reply %j without retrying', async reply => {
    const f = fixture(); await f.role.start(); f.request.mockResolvedValue(reply); await f.role.request(f.click())
    expect(f.role.state.value).toBe('unavailable'); expect(f.role.pendingId.value).toBe('attempt-1')
    await f.role.check(); expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.request).toHaveBeenCalledOnce()
  })
  it('cleans up its subscription and ignores outcomes after unmount', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click()); f.role.dispose()
    f.deliver({ requestId: 'attempt-1', state: 'held' }); expect(f.setReady.mock.calls).toEqual([[true], [false]]); expect(f.stop).toHaveBeenCalledOnce(); expect(f.status).toHaveBeenCalledTimes(2)
  })
  it('retains a result emitted inside request before its start reply resolves', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async id => {
      f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); f.deliver({ requestId: id, state: 'held' })
      return { state: 'pending', requestId: id }
    })
    await f.role.request(f.click()); await f.role.check()
    expect(f.role.state.value).toBe('held'); expect(f.role.pendingId.value).toBeNull(); expect(f.request).toHaveBeenCalledOnce()
  })
  it('performs a new read if an outcome arrives during an older passive read', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    let stale!: (value: HomeRoleStatus) => void
    f.status.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
    const returning = f.role.returned()
    f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); f.deliver({ requestId: 'attempt-1', state: 'held' })
    stale({ state: 'not_held', apiLevel: 34 }); await returning
    expect(f.status).toHaveBeenCalledTimes(4); expect(f.role.state.value).toBe('held'); expect(f.role.pendingId.value).toBeNull()
  })
  it('keeps a timed-out invocation correlated and never automatically retries', async () => {
    vi.useFakeTimers()
    const f = fixture(); await f.role.start(); f.request.mockImplementation(() => new Promise(() => {}))
    const operation = f.role.request(f.click()); await vi.advanceTimersByTimeAsync(5001); await operation
    expect(f.role.state.value).toBe('unavailable'); expect(f.role.pendingId.value).toBe('attempt-1')
    await f.role.returned(); await f.role.check(); await f.role.request(f.click())
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.canRequest.value).toBe(false)
    expect(f.request).toHaveBeenCalledOnce()
    f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); f.deliver({ requestId: 'attempt-1', state: 'held' }); await f.role.check()
    expect(f.role.state.value).toBe('held'); expect(f.request).toHaveBeenCalledOnce(); expect(f.role.pendingId.value).toBeNull()
  })
  it.each(['auth: Home role request requires the foreground CyberManju window', new Error('auth: Home role request requires the foreground CyberManju window'), 'auth: unlock the device before choosing CyberManju as Home', new Error('auth: Home role request requires a resumed Activity')])('reconciles a definitive pre-persistence rejection without retrying: %s', async error => {
    const f = fixture(); await f.role.start(); f.request.mockRejectedValue(error)
    await f.role.request(f.click())
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('failed')
    expect(f.role.canRequest.value).toBe(true); expect(f.role.notice.value).not.toContain('is your default')
    await f.role.returned(); await f.role.check()
    expect(f.request).toHaveBeenCalledOnce(); expect(f.acknowledge).not.toHaveBeenCalled()
    // Only another explicit trusted click may launch a new request.
    f.request.mockImplementation(async id => ({ state: 'pending', requestId: id }))
    await f.role.request(f.click()); expect(f.request).toHaveBeenLastCalledWith('attempt-2')
  })
  it('recovers a rejected pre-persistence ID via Check status after the first reconciliation fails, without remounting', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async () => {
      f.status.mockRejectedValueOnce(new Error('network: status unavailable'))
      throw new Error('auth: Home role request requires the foreground CyberManju window')
    })
    await f.role.request(f.click())
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.canRequest.value).toBe(false)
    await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.canRequest.value).toBe(true)
    expect(f.role.attempt.value).toBe('failed'); expect(f.request).toHaveBeenCalledOnce()
    expect(f.subscribe).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled()
  })
  it('does not clear a rejected ID when native status still reports persisted pending work', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async id => {
      f.status.mockResolvedValue({ state: 'not_held', apiLevel: 34, pendingRequestId: id })
      throw new Error('auth: Home role request requires the foreground CyberManju window')
    })
    await f.role.request(f.click()); await f.role.check()
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.canRequest.value).toBe(false)
    f.deliver({ requestId: 'attempt-1', state: 'not_held' }); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('not_held')
    expect(f.request).toHaveBeenCalledOnce()
  })
  it.each(['network: response lost', 'unknown failure containing auth: text', 'auth: unknown guard'])('keeps ambiguous rejection %s correlated across checks and recovers by event, never retrying', async error => {
    const f = fixture(); await f.role.start(); f.request.mockRejectedValue(new Error(error))
    await f.role.request(f.click()); await f.role.returned(); await f.role.check(); await f.role.request(f.click())
    expect(f.role.pendingId.value).toBe('attempt-1'); expect(f.role.attempt.value).toBeNull()
    expect(f.role.canRequest.value).toBe(false); expect(f.request).toHaveBeenCalledOnce()
    f.deliver({ requestId: 'attempt-1', state: 'not_held' }); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.canRequest.value).toBe(true)
    expect(f.request).toHaveBeenCalledOnce()
  })
  it('preserves an observed result if the start reply subsequently fails', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async () => {
      f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); f.deliver({ requestId: 'attempt-1', state: 'held' }); await flush()
      throw new Error('late transport error')
    })
    await f.role.request(f.click()); expect(f.role.state.value).toBe('held')
  })
  it('rechecks finite/nonnegative freshness at the final invoke boundary', async () => {
    const f = fixture(); await f.role.start(); f.beforeRequest.mockImplementation(async () => { f.elapsed(-1); return true })
    await f.role.request(f.click()); expect(f.request).not.toHaveBeenCalled()
  })
  it('recovers persisted pending ID after process recreation without opening the picker', async () => {
    const f = fixture(); f.status.mockResolvedValue({ state: 'not_held', apiLevel: 28, pendingRequestId: 'persisted-1' })
    await f.role.start(); await f.role.returned(); await f.role.request(f.click())
    expect(f.role.pendingId.value).toBe('persisted-1'); expect(f.role.canRequest.value).toBe(false); expect(f.request).not.toHaveBeenCalled()
    f.status.mockResolvedValue({ state: 'not_held', apiLevel: 28 }); f.deliver({ requestId: 'persisted-1', state: 'not_held' }); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('not_held'); expect(f.request).not.toHaveBeenCalled()
  })
  it('does not ACK an early result until a retry matches the restored persisted ID', async () => {
    const f = fixture(); let resolve!: (value: HomeRoleStatus) => void
    f.status.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const starting = f.role.start(); await flush()
    f.deliver({ requestId: 'persisted-1', state: 'held' }); f.deliver({ requestId: 'foreign', state: 'failed' })
    expect(f.acknowledge).not.toHaveBeenCalled()
    f.status.mockResolvedValue({ state: 'held', apiLevel: 34 }); resolve({ state: 'not_held', apiLevel: 34, pendingRequestId: 'persisted-1' })
    await starting
    expect(f.role.pendingId.value).toBe('persisted-1'); expect(f.role.attempt.value).toBeNull()
    f.deliver({ requestId: 'persisted-1', state: 'held' })
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith('persisted-1')
    expect(f.acknowledge.mock.invocationCallOrder[0]).toBeLessThan(f.status.mock.invocationCallOrder[1])
    await flush()
    expect(f.role.state.value).toBe('held'); expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('held'); expect(f.request).not.toHaveBeenCalled()
  })
  it('deduplicates completed IDs and never restores an already-settled persisted ID', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    f.deliver({ requestId: 'attempt-1', state: 'not_held' }); await f.role.check()
    const calls = f.status.mock.calls.length
    f.deliver({ requestId: 'attempt-1', state: 'held' }); await flush(); expect(f.status).toHaveBeenCalledTimes(calls)
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith('attempt-1')
    f.status.mockResolvedValue({ state: 'not_held', apiLevel: 34, pendingRequestId: 'attempt-1' }); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('not_held')
  })
  it('cleans up a subscription that resolves after its startup timeout', async () => {
    vi.useFakeTimers(); const f = fixture(); let finish!: (stop: () => void) => void
    f.subscribe.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const starting = f.role.start(); await vi.advanceTimersByTimeAsync(2001); await starting
    expect(f.setReady).not.toHaveBeenCalledWith(true)
    finish(f.stop); await flush(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); expect(f.setReady).not.toHaveBeenCalledWith(true)
  })
  it('does not publish ready when disposed before subscribe resolves and cleans up the late listener', async () => {
    const f = fixture(); let finish!: (stop: () => void) => void
    f.subscribe.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const starting = f.role.start(); await flush(); f.role.dispose(); finish(f.stop); await flush(); await starting
    expect(f.setReady).not.toHaveBeenCalledWith(true); expect(f.stop).toHaveBeenCalledOnce(); expect(f.status).not.toHaveBeenCalled()
  })
  it('clears ready on dispose during a pending status read without reactivating afterward', async () => {
    const f = fixture(); let finish!: (value: HomeRoleStatus) => void
    f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const starting = f.role.start(); await flush()
    expect(f.setReady.mock.calls).toEqual([[true]])
    f.role.dispose(); expect(f.setReady.mock.calls).toEqual([[true], [false]])
    finish({ state: 'not_held', apiLevel: 34 }); await starting
    expect(f.setReady.mock.calls).toEqual([[true], [false]])
  })
  it('deduplicates repeated outcomes while the authoritative read is still pending', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    let finish!: (value: HomeRoleStatus) => void
    f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.deliver({ requestId: 'attempt-1', state: 'not_held' }); await flush()
    const calls = f.status.mock.calls.length
    f.deliver({ requestId: 'attempt-1', state: 'not_held' }); f.deliver({ requestId: 'attempt-1', state: 'held' })
    expect(f.acknowledge).toHaveBeenCalledTimes(3)
    finish({ state: 'not_held', apiLevel: 34 }); await flush()
    expect(f.status).toHaveBeenCalledTimes(calls); expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBe('not_held')
  })
  it('never converts an event into success when its authoritative status query fails', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    f.status.mockRejectedValue(new Error('command missing')); f.deliver({ requestId: 'attempt-1', state: 'held' }); await f.role.check()
    expect(f.role.state.value).toBe('unavailable'); expect(f.role.canRequest.value).toBe(false); expect(f.role.notice.value).not.toContain('is your default')
  })
})
