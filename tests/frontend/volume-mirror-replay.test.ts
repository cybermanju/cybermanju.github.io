// CyberManju OS — Volume mirror replay tests (tests/frontend/volume-mirror-replay.test.ts).
// Role: Verify vault replacement replay removes stale shell-volume data.
// Integrates: Vitest, useVolumeMirror, WASM and OS dispatch.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatch, osDispatch } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  osDispatch: vi.fn(),
}))
vi.mock('@/composables/useWasmBackend', () => ({
  addOsDispatchHook: vi.fn(),
  wasmDbDispatch: dispatch,
  wasmOsDispatch: osDispatch,
}))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('vault shell-volume replacement replay', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { setTimeout, clearTimeout },
    })
  })

  it('removes stale local shell paths and restores the replacement vault without pushing old files into it', async () => {
    localStorage.setItem('cybermanju.os.volume', JSON.stringify({
      '/old.txt': 'old vault data',
      '/shared.txt': 'old version',
    }))
    const rows = [{ key: 'volume:/shared.txt' }, { key: 'volume:/new.txt' }]
    dispatch.mockImplementation(async (op: string, args: { key?: string }) => {
      if (op === 'kv.list') return rows
      if (op === 'kv.get') return { value: args.key === 'volume:/shared.txt' ? 'new shared' : 'new file' }
      if (op === 'kv.set') throw new Error('replacement replay must not push old local files')
      return null
    })
    osDispatch.mockImplementation(async (op: string, args: { paths?: string[]; path?: string; content?: string }) => {
      const volume = JSON.parse(localStorage.getItem('cybermanju.os.volume') ?? '{}') as Record<string, string>
      if (op === 'rm') for (const path of args.paths ?? []) delete volume[path]
      if (op === 'write' && args.path) volume[args.path] = args.content ?? ''
      localStorage.setItem('cybermanju.os.volume', JSON.stringify(volume))
      return null
    })

    const { replayVolumeFromVault } = await import('@/composables/useVolumeMirror')
    expect(await replayVolumeFromVault(true)).toBe(2)
    expect(JSON.parse(localStorage.getItem('cybermanju.os.volume') ?? '{}')).toEqual({
      '/shared.txt': 'new shared',
      '/new.txt': 'new file',
    })
    expect(osDispatch).toHaveBeenCalledWith('rm', { paths: ['/old.txt'] })
    expect(dispatch).not.toHaveBeenCalledWith('kv.set', expect.anything())
  })
  it('reports failed stale-file cleanup instead of silently keeping the old vault shell', async () => {
    localStorage.setItem('cybermanju.os.volume', JSON.stringify({ '/old.txt': 'private' }))
    dispatch.mockResolvedValue([])
    osDispatch.mockResolvedValue({ ok: false, output: 'storage failed' })
    const { replayVolumeFromVault } = await import('@/composables/useVolumeMirror')
    await expect(replayVolumeFromVault(true)).rejects.toThrow('stale shell files')
    expect(dispatch).not.toHaveBeenCalledWith('kv.set', expect.anything())
  })

  it('does not report a completed replacement when the new vault cannot be read', async () => {
    dispatch.mockRejectedValue(new Error('network: worker unavailable'))
    const { replayVolumeFromVault } = await import('@/composables/useVolumeMirror')
    await expect(replayVolumeFromVault(true)).rejects.toThrow('could not be read')
    expect(osDispatch).not.toHaveBeenCalled()
  })
})
