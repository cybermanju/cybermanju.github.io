// Provider canal orchestration — path mapping, cache TTL, mount validation.
import { describe, expect, it, vi } from 'vitest'
import {
  cacheKey,
  isCacheFresh,
  mountKey,
  parseProviderPath,
  providerPathFor,
  VFS_CACHE_TTL_MS,
} from '../../src/composables/useProviderCanal'

describe('parseProviderPath', () => {
  it('splits mount id from the remote path', () => {
    expect(parseProviderPath('/providers/mnt-1/a/b')).toEqual({ mountId: 'mnt-1', remotePath: 'a/b' })
  })

  it('accepts a bare mount root', () => {
    expect(parseProviderPath('/providers/mnt-1')).toEqual({ mountId: 'mnt-1', remotePath: '' })
  })

  it('rejects paths outside the namespace', () => {
    expect(parseProviderPath('/files/x')).toBeNull()
    expect(parseProviderPath('/providers')).toBeNull()
    expect(parseProviderPath('')).toBeNull()
  })

  it('normalizes backslashes and leading slashes', () => {
    expect(parseProviderPath('\\providers\\m\\a')).toEqual({ mountId: 'm', remotePath: 'a' })
  })
})

describe('providerPathFor', () => {
  it('round-trips through parseProviderPath', () => {
    const p = providerPathFor('mnt-9', 'docs/a.md')
    expect(parseProviderPath(p)).toEqual({ mountId: 'mnt-9', remotePath: 'docs/a.md' })
  })

  it('handles the mount root', () => {
    expect(providerPathFor('mnt-9', '')).toBe('/providers/mnt-9')
  })
})

describe('cache keys and TTL', () => {
  it('namespaces cache rows per mount + path', () => {
    expect(cacheKey('m', 'a/b')).toBe('vfs:cache:m:a/b')
    expect(cacheKey('m', '/a/b')).toBe('vfs:cache:m:a/b')
    expect(mountKey('m')).toBe('vfs:mount:m')
  })

  it('treats fresh rows as hits and old rows as misses', () => {
    const now = 1_000_000
    expect(isCacheFresh(now - 1_000, now)).toBe(true)
    expect(isCacheFresh(now - VFS_CACHE_TTL_MS - 1, now)).toBe(false)
    expect(isCacheFresh(NaN, now)).toBe(false)
  })
})

describe('saveVfsMount validation', () => {
  it('refuses mounts without a config', async () => {
    const mod = await import('../../src/composables/useProviderCanal')
    await expect(
      mod.saveVfsMount({ configId: '  ', name: 'x', backendType: 'github' }),
    ).rejects.toThrow('invalid: configId is required')
    void vi
  })
})
