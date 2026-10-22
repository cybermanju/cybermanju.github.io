// CyberManju OS — Shortcuts local identity tests (tests/frontend/shortcuts-local-identity.test.ts).
// Role: Verify secure UUID creation, persistence, reuse and fail-closed browser storage behavior.
// Exports: Vitest coverage for shortcutsLocalIdentity.
// Integrates: src/utils/shortcutsLocalIdentity.ts and stubbed Web Crypto/localStorage globals.
// Contracts: Isolate global state with stubGlobal and restore all stubs after each test.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shortcutsLocalIdentity } from '../../src/utils/shortcutsLocalIdentity'

const KEY = 'cybermanju:shortcuts:local-identity:v1'
const UUID = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_UUID = '987e6543-e21b-42d3-a456-426614174000'

afterEach(() => {
  vi.unstubAllGlobals()
})

function storageStub(options: { initial?: string | null; write?: (value: string) => void } = {}) {
  let value = options.initial ?? null
  const getItem = vi.fn(() => value)
  const setItem = vi.fn((_key: string, next: string) => {
    options.write ? options.write(next) : (value = next)
  })
  vi.stubGlobal('localStorage', { getItem, setItem })
  return { getItem, setItem }
}

function cryptoStub(randomUUID: () => string = () => UUID) {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(randomUUID) })
}

describe('shortcutsLocalIdentity', () => {
  it('creates a secure UUID, persists it, and reuses it on later calls', () => {
    const storage = storageStub()
    const randomUUID = vi.fn(() => UUID)
    cryptoStub(randomUUID)

    expect(shortcutsLocalIdentity()).toBe(UUID)
    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(storage.setItem).toHaveBeenCalledWith(KEY, UUID)
    expect(shortcutsLocalIdentity()).toBe(UUID)
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('rejects a corrupted persisted identity without replacing it', () => {
    const storage = storageStub({ initial: 'not-a-uuid' })
    cryptoStub()

    expect(() => shortcutsLocalIdentity()).toThrow('invalid_local_identity')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('throws when localStorage is unavailable', () => {
    cryptoStub()
    vi.stubGlobal('localStorage', undefined)
    expect(() => shortcutsLocalIdentity()).toThrow()
  })

  it('propagates localStorage read and write failures', () => {
    cryptoStub()
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('read failed') },
      setItem: vi.fn(),
    })
    expect(() => shortcutsLocalIdentity()).toThrow('read failed')

    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('write failed') },
    })
    expect(() => shortcutsLocalIdentity()).toThrow('write failed')
  })

  it('rejects a no-op storage write when persistence verification fails', () => {
    const storage = storageStub({ write: () => undefined })
    cryptoStub()

    expect(() => shortcutsLocalIdentity()).toThrow('persistent_local_identity_required')
    expect(storage.setItem).toHaveBeenCalledWith(KEY, UUID)
  })

  it('requires Web Crypto secure randomness', () => {
    storageStub()
    vi.stubGlobal('crypto', undefined)
    expect(() => shortcutsLocalIdentity()).toThrow('secure_local_identity_unavailable')
  })

  it('rejects an invalid randomUUID result', () => {
    const storage = storageStub()
    cryptoStub(() => 'not-a-uuid')

    expect(() => shortcutsLocalIdentity()).toThrow('invalid_local_identity')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('requires randomUUID to be callable', () => {
    storageStub()
    vi.stubGlobal('crypto', {})
    expect(() => shortcutsLocalIdentity()).toThrow('secure_local_identity_unavailable')
  })

  it('returns a valid identity already stored without generating a new one', () => {
    const storage = storageStub({ initial: OTHER_UUID })
    const randomUUID = vi.fn(() => UUID)
    cryptoStub(randomUUID)

    expect(shortcutsLocalIdentity()).toBe(OTHER_UUID)
    expect(randomUUID).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
