// CyberManju OS — Mobile scoped storage.test (tests/frontend/mobile-scoped-storage.test.ts).
// Role: Vitest frontend suite.
// Exports: module root (see items below).
// Integrates: vitest, ../….
// Contracts: none special (pure logic; errors bubble to caller).
import { describe, expect, it } from 'vitest'
import { isRemovableAndroidStorageFolder, normalizeMobileVaultFileName } from '../../src/utils/mobileScopedStorage'

describe('mobile .cybermanju mirror filenames', () => {
  it('adds the extension exactly once and preserves user-friendly Unicode names', () => {
    expect(normalizeMobileVaultFileName('cybermanju-vault')).toBe('cybermanju-vault.cybermanju')
    expect(normalizeMobileVaultFileName('meu vault.CYBERMANJU')).toBe('meu vault.cybermanju')
    expect(normalizeMobileVaultFileName('cofre café')).toBe('cofre café.cybermanju')
  })

  it('rejects empty names, path separators, and names longer than 80 characters', () => {
    expect(() => normalizeMobileVaultFileName('')).toThrow(/file name/i)
    expect(() => normalizeMobileVaultFileName('../shared')).toThrow(/file name/i)
    expect(() => normalizeMobileVaultFileName('a\\b')).toThrow(/file name/i)
    expect(() => normalizeMobileVaultFileName('a'.repeat(81))).toThrow(/file name/i)
  })
})

describe('Android SAF external-storage roots', () => {
  it('recognizes secondary ExternalStorageProvider volumes such as an SD card', () => {
    expect(isRemovableAndroidStorageFolder({
      uri: 'content://com.android.externalstorage.documents/tree/4A1B-2C3D%3A',
    })).toBe(true)
    expect(isRemovableAndroidStorageFolder({
      uri: 'content://com.android.externalstorage.documents/tree/4A1B-2C3D%3ADocuments',
    })).toBe(true)
  })

  it('does not mislabel internal storage, another document provider, or malformed URIs', () => {
    expect(isRemovableAndroidStorageFolder({
      uri: 'content://com.android.externalstorage.documents/tree/primary%3ADocuments',
    })).toBe(false)
    expect(isRemovableAndroidStorageFolder({
      uri: 'content://com.android.providers.downloads.documents/tree/4A1B-2C3D%3A',
    })).toBe(false)
    expect(isRemovableAndroidStorageFolder({ uri: 'not a uri' })).toBe(false)
    expect(isRemovableAndroidStorageFolder({})).toBe(false)
  })
})
