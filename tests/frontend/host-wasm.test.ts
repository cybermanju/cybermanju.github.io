// CyberManju OS — Host wasm.test (tests/frontend/host-wasm.test.ts).
// WASM host leg: honest errors with no picker (node), unknown shell verbs
// refuse with `unsupported:`, and the native namespace math stays intact
// where no browser window exists (no behavior change for Tauri/desktop).
import { describe, expect, it } from 'vitest'
import {
  destFromVmPath,
  isHostId,
  isHostPath,
} from '../../src/utils/hostBrowse'
import {
  HOST_WASM_DIR_KEY,
  hostWasmSupported,
  listHostWasmDir,
  pickHostWasmDir,
  runWasmHostLine,
} from '../../src/utils/hostWasm'

describe('wasm host support probe', () => {
  it('exposes a stable IndexedDB key and reports unsupported in node', () => {
    expect(HOST_WASM_DIR_KEY).toBe('cybermanju.hostDir')
    expect(hostWasmSupported()).toBe(false)
  })

  it('refuses the picker honestly with no File System Access API', async () => {
    await expect(pickHostWasmDir()).rejects.toThrow(/^unsupported:/)
  })

  it('refuses listings honestly with no remembered home folder', async () => {
    await expect(listHostWasmDir('/host')).rejects.toThrow(/^(unsupported|not_found|auth):/)
  })

  it('refuses unknown shell verbs with unsupported:', async () => {
    await expect(runWasmHostLine('frobnicate -os /x')).rejects.toThrow(/^unsupported:/)
  })
})

describe('native host namespace untouched in node (no window)', () => {
  it('still detects host paths and ids', () => {
    expect(isHostPath('/host')).toBe(true)
    expect(isHostPath('/host/Photos/a.jpg')).toBe(true)
    expect(isHostId('host:/Photos/a.jpg')).toBe(true)
    expect(isHostId('vault-1')).toBe(false)
  })

  it('keeps /host unresolvable without a pwd -os round-trip', () => {
    // Node has no window, so the WASM leg stays off and the native rule
    // (`/host` needs `pwd -os`) is preserved for desktop callers.
    expect(destFromVmPath('/host')).toBeNull()
    expect(destFromVmPath('/host/sdcard/Download')).toEqual({
      kind: 'host',
      absDir: '/sdcard/Download',
    })
  })
})
