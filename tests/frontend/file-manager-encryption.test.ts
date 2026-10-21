// CyberManju OS — File-manager encryption tests (tests/frontend/file-manager-encryption.test.ts).
// Role: Verify explicit encryption provisions missing keys without downgrading algorithms.
// Exports: Vitest regressions for key reuse, generation failure and concurrency.
// Integrates: Pinia app store with mocked transport boundaries.
// Contracts: no encryption after failed key discovery or provisioning.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useTauri', () => ({
  invoke: invokeMock,
  getAuthToken: () => '', setAuthToken: () => {}, isWebMode: () => false, isStaticHost: () => false,
}))
vi.mock('@/composables/useNotifications', () => ({
  useNotifications: () => ({ notify: vi.fn() }),
}))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({}) }))

import { useAppStore } from '@/stores/app'

const hybridKey = { id: 'k1', algorithm: 'Hybrid ML-KEM-768 (L3) + X25519', algorithmDisplay: '', nistLevel: 3, color: '', publicKeyPreview: '', hasPrivateKey: true, createdAt: '' }

describe('FileManager encryption key preflight', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
  })

  it('reuses a fresh matching alias key without generating another', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_keys') return [hybridKey]
      if (cmd === 'encrypt_file') return undefined
      if (cmd === 'list_files') return []
      if (cmd === 'get_encryption_status') return { isEncrypted: false }
      return undefined
    })
    const result = await useAppStore().encryptFile('f1', 'hybrid')
    expect(result).toBe(true)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).not.toContain('generate_keypair')
  })

  it('generates a missing key before encrypting and re-lists after generation', async () => {
    let hasKey = false
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_keys') return hasKey ? [hybridKey] : []
      if (cmd === 'generate_keypair') { hasKey = true; return undefined }
      if (cmd === 'encrypt_file') return undefined
      if (cmd === 'list_files') return []
      if (cmd === 'get_encryption_status') return { isEncrypted: false }
      return undefined
    })
    expect(await useAppStore().encryptFile('f1', 'hybrid')).toBe(true)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd).filter(cmd => cmd !== 'list_files'))
      .toEqual(['list_keys', 'generate_keypair', 'list_keys', 'encrypt_file', 'get_encryption_status'])
    expect(invokeMock).toHaveBeenCalledWith('encrypt_file', { fileId: 'f1', algorithm: 'hybrid' })
  })

  it('aborts encryption when key generation fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_keys') return []
      if (cmd === 'generate_keypair') throw new Error('key store unavailable')
      return undefined
    })
    expect(await useAppStore().encryptFile('f1', 'hybrid')).toBe(false)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).not.toContain('encrypt_file')
  })

  it('does not provision or encrypt when fresh key discovery fails', async () => {
    invokeMock.mockRejectedValue(new Error('key listing unavailable'))
    expect(await useAppStore().encryptFile('f1', 'hybrid')).toBe(false)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual(['list_keys'])
  })

  it('refuses encryption if generation did not persist a matching key', async () => {
    invokeMock.mockImplementation(async (cmd: string) => cmd === 'list_keys' ? [] : undefined)
    expect(await useAppStore().encryptFile('f1', 'hybrid')).toBe(false)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual(['list_keys', 'generate_keypair', 'list_keys'])
  })

  it('reports failed compression as false for bulk outcome accounting', async () => {
    invokeMock.mockRejectedValue(new Error('source bytes unavailable'))
    expect(await useAppStore().compressFile('f1', 'zstd')).toBe(false)
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual(['compress_file'])
  })

  it('deduplicates concurrent generation for equivalent algorithms', async () => {
    let resolveGeneration!: () => void
    const gate = new Promise<void>(resolve => { resolveGeneration = resolve })
    let generated = false
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_keys') return generated ? [hybridKey] : []
      if (cmd === 'generate_keypair') { await gate; generated = true; return undefined }
      if (cmd === 'encrypt_file') return undefined
      if (cmd === 'list_files') return []
      if (cmd === 'get_encryption_status') return { isEncrypted: false }
      return undefined
    })
    const store = useAppStore()
    const first = store.encryptFile('f1', 'hybrid')
    const second = store.encryptFile('f2', 'kyber768')
    await vi.waitFor(() => expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'generate_keypair')).toHaveLength(1))
    resolveGeneration()
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'generate_keypair')).toHaveLength(1)
  })
})
