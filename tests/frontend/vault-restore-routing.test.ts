// CyberManju OS — restore must replace the database actually serving the session.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { restore, replay } = vi.hoisted(() => ({ restore: vi.fn(), replay: vi.fn() }))
vi.mock('@/composables/useVolumeMirror', () => ({ replayVolumeFromVault: replay }))
vi.mock('cybermanju-os-wasm', () => ({
  default: vi.fn(),
  db_open: async () => JSON.stringify({ ok: true }),
  db_restore: restore,
  db_dispatch: vi.fn(),
}), { virtual: true })
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restore.mockReturnValue(JSON.stringify({ ok: true }))
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => vi.unstubAllGlobals())
it('sends the supplied image to the active worker, not a second main-thread database', async () => {
  const requests: Array<{ op: string; args: { image: Uint8Array } }> = []
  class WorkerMock {
    onmessage?: (ev: { data: unknown }) => void
    postMessage(request: { id: number; op: string; args: { image: Uint8Array } }) {
      requests.push(request)
      this.onmessage?.({ data: { id: request.id, ok: true, data: null } })
    }
  }
  vi.stubGlobal('Worker', WorkerMock)
  const { wasmDatabaseRestore } = await import('@/composables/useWasmBackend')
  const image = new Uint8Array([1, 2, 3])
  await wasmDatabaseRestore(image)
  expect(requests).toEqual([expect.objectContaining({ op: '_restore_image', args: { image } })])
  expect(restore).not.toHaveBeenCalled()
  expect(replay).toHaveBeenCalledExactlyOnceWith(true)
})
it('restores the same image in the in-memory fallback when workers are unavailable', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('no worker support') } })
  const { wasmDatabaseRestore } = await import('@/composables/useWasmBackend')
  const image = new Uint8Array([1, 2, 3])
  await wasmDatabaseRestore(image)
  expect(restore).toHaveBeenCalledExactlyOnceWith(image)
  expect(replay).toHaveBeenCalledExactlyOnceWith(true)
})
it('does not replay the shell after the active backend rejects a restore', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('no worker support') } })
  restore.mockReturnValue(JSON.stringify({ ok: false, error: 'integrity: invalid image' }))
  const { wasmDatabaseRestore } = await import('@/composables/useWasmBackend')
  await expect(wasmDatabaseRestore(new Uint8Array([1]))).rejects.toThrow('integrity:')
  expect(replay).not.toHaveBeenCalled()
})
