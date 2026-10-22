// CyberManju OS — Default Home frontend contract tests.
// Role: exercise exact Audio/Sys role semantics without claiming an Android integration test.
// Exports: Vitest suite. Integrates: UI controller with deterministic contract-response test doubles.
// Contracts: native bridge remains authoritative; no startup request, invented refusal or pending success.
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => false, isTauri: () => false }))
import { createHomeRoleAction, type HomeRoleRequestOutcome } from '@/composables/useHomeRoleAction'
function fixture(supported = true) {
  let now = 1000, visible = true, receive!: (value: unknown) => void
  const status = vi.fn(async () => ({ state: 'not_held', apiLevel: 34 }))
  const request = vi.fn(async (_id: string): Promise<unknown> => ({ state: 'pending', requestId: 'attempt-1' }))
  const stop = vi.fn(), beforeRequest = vi.fn(async () => true)
  const subscribe = vi.fn(async (handler: (value: unknown) => void) => { receive = handler; return stop })
  const role = createHomeRoleAction({ supported, status, request, beforeRequest, subscribe, now: () => now, visible: () => visible, requestId: () => 'attempt-1' })
  const click = (properties = {}) => ({ isTrusted: true, timeStamp: 1000, ...properties }) as MouseEvent
  return { role, status, request, stop, subscribe, beforeRequest, click, elapsed: (ms: number) => { now += ms }, hide: () => { visible = false }, deliver: (value: unknown) => receive(value) }
}
afterEach(() => vi.useRealTimers())
describe('Android default Home UI contract', () => {
  it('performs only passive status/listener setup and stays off-device fail-closed', async () => {
    const f = fixture(); await f.role.start()
    expect(f.status).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); expect(f.role.canRequest.value).toBe(true)
    const off = fixture(false); await off.role.start(); await off.role.request(off.click())
    expect(off.status).not.toHaveBeenCalled(); expect(off.subscribe).not.toHaveBeenCalled(); expect(off.request).not.toHaveBeenCalled()
  })
  it('disables the CTA for missing commands and invalid status responses', async () => {
    for (const value of [null, { state: 'pending', apiLevel: 34 }, { state: 'not_held', apiLevel: 23 }]) {
      const f = fixture(); f.status.mockResolvedValue(value as any); await f.role.start(); await f.role.request(f.click())
      expect(f.role.state.value).toBe('unavailable'); expect(f.request).not.toHaveBeenCalled()
    }
    const f = fixture(); f.status.mockRejectedValue(new Error('command not found')); await f.role.start()
    expect(f.role.canRequest.value).toBe(false); expect(f.role.notice.value).toContain('unavailable')
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
  it('rechecks the <=5s monotonic boundary after all awaited preflight work', async () => {
    const f = fixture(); await f.role.start(); f.beforeRequest.mockImplementation(async () => { f.elapsed(5001); return true })
    await f.role.request(f.click()); expect(f.request).not.toHaveBeenCalled(); expect(f.role.pendingId.value).toBeNull()
  })
  it('passes the exact correlation ID once and does not treat pending as success', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click()); await f.role.request(f.click())
    expect(f.request).toHaveBeenCalledExactlyOnceWith('attempt-1'); expect(f.role.pendingId.value).toBe('attempt-1')
    expect(f.role.state.value).toBe('not_held'); expect(f.role.notice.value).not.toContain('is your default')
  })
  it('ignores unrelated outcomes and emits no attempt state with no matching pending request', async () => {
    const f = fixture(); await f.role.start(); f.deliver({ requestId: 'old', state: 'declined' })
    expect(f.role.attempt.value).toBeNull(); expect(f.status).toHaveBeenCalledOnce()
    await f.role.request(f.click()); const calls = f.status.mock.calls.length
    f.deliver({ requestId: 'other', state: 'held' }); expect(f.status).toHaveBeenCalledTimes(calls)
    expect(f.role.pendingId.value).toBe('attempt-1')
  })
  it('requeries on return, clears correlation, and reports only the observed state', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click()); await f.role.returned()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.attempt.value).toBeNull(); expect(f.role.state.value).toBe('not_held')
    const calls = f.status.mock.calls.length; await f.role.returned(); expect(f.status).toHaveBeenCalledTimes(calls)
  })
  it.each([24, 28, 29, 34])('does not invent Settings refusal on API %s', async apiLevel => {
    const f = fixture(); f.status.mockResolvedValue({ state: 'not_held', apiLevel }); await f.role.start(); await f.role.request(f.click())
    f.deliver({ requestId: 'attempt-1', state: 'declined' } satisfies HomeRoleRequestOutcome); await f.role.check()
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.state.value).toBe('not_held')
    expect(f.role.attempt.value).toBe(apiLevel >= 29 ? 'declined' : null)
    expect(f.role.notice.value.includes('declined')).toBe(apiLevel >= 29)
  })
  it('shows success only when the authoritative status query returns held', async () => {
    const f = fixture(); await f.role.start(); f.request.mockResolvedValue({ state: 'held' }); await f.role.request(f.click())
    expect(f.role.state.value).toBe('not_held'); expect(f.role.notice.value).not.toContain('is your default')
    const held = fixture(); await held.role.start(); await held.role.request(held.click()); held.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
    held.deliver({ requestId: 'attempt-1', state: 'held' }); await held.role.check()
    expect(held.role.state.value).toBe('held'); expect(held.role.notice.value).toBe('CyberManju is your default Home.')
  })
  it('handles Activity return before the request-start reply finishes', async () => {
    const f = fixture(); await f.role.start(); let finish!: (v: unknown) => void
    f.request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const operation = f.role.request(f.click())
    for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(f.request).toHaveBeenCalledOnce(); await f.role.returned(); finish({ state: 'pending' }); await operation
    expect(f.role.pendingId.value).toBeNull(); expect(f.role.state.value).toBe('not_held')
  })
  it('never repeats an ambiguous request or trusts a mismatched start reply', async () => {
    const f = fixture(); await f.role.start(); f.request.mockResolvedValue({ state: 'pending', requestId: 'other' }); await f.role.request(f.click())
    expect(f.role.state.value).toBe('unavailable'); expect(f.role.pendingId.value).toBe('attempt-1')
    await f.role.check(); expect(f.role.pendingId.value).toBeNull(); expect(f.request).toHaveBeenCalledOnce()
  })
  it('cleans up its event subscription and ignores outcomes after unmount', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click()); f.role.dispose()
    f.deliver({ requestId: 'attempt-1', state: 'held' }); expect(f.stop).toHaveBeenCalledOnce(); expect(f.status).toHaveBeenCalledTimes(2)
  })
  it('retains a matching result emitted inside request before its start reply resolves', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async () => {
      f.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
      f.deliver({ requestId: 'attempt-1', state: 'held' })
      return { state: 'pending' }
    })
    await f.role.request(f.click()); await f.role.check()
    expect(f.role.state.value).toBe('held'); expect(f.role.pendingId.value).toBeNull(); expect(f.request).toHaveBeenCalledOnce()
  })
  it('performs a new read when an outcome arrives during an older return reconciliation', async () => {
    const f = fixture(); await f.role.start(); await f.role.request(f.click())
    let stale!: (value: any) => void
    f.status.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
    const returning = f.role.returned()
    f.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
    f.deliver({ requestId: 'attempt-1', state: 'held' })
    stale({ state: 'not_held', apiLevel: 34 }); await returning
    expect(f.status).toHaveBeenCalledTimes(4); expect(f.role.state.value).toBe('held'); expect(f.role.pendingId.value).toBeNull()
  })
  it('keeps a timed-out invocation correlated and never automatically retries it', async () => {
    vi.useFakeTimers()
    const f = fixture(); await f.role.start(); f.request.mockImplementation(() => new Promise(() => {}))
    const operation = f.role.request(f.click()); await vi.advanceTimersByTimeAsync(5001); await operation
    expect(f.role.state.value).toBe('unavailable'); expect(f.role.pendingId.value).toBe('attempt-1')
    f.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
    f.deliver({ requestId: 'attempt-1', state: 'held' }); await f.role.check()
    expect(f.role.state.value).toBe('held'); expect(f.request).toHaveBeenCalledOnce(); expect(f.role.pendingId.value).toBeNull()
  })
  it('preserves an already-observed result if the start reply subsequently fails', async () => {
    const f = fixture(); await f.role.start()
    f.request.mockImplementation(async () => {
      f.status.mockResolvedValue({ state: 'held', apiLevel: 34 })
      f.deliver({ requestId: 'attempt-1', state: 'held' }); await f.role.check()
      throw new Error('late transport error')
    })
    await f.role.request(f.click()); expect(f.role.state.value).toBe('held')
  })
  it('rechecks finite/nonnegative freshness at the final invoke boundary', async () => {
    const f = fixture(); await f.role.start(); f.beforeRequest.mockImplementation(async () => { f.elapsed(-1); return true })
    await f.role.request(f.click()); expect(f.request).not.toHaveBeenCalled()
  })

})
