// CyberManju OS — Drive storage regressions (tests/frontend/drive-storage.test.ts).
// Role: Guard real app quota display and private native upload staging.
// Exports: none (Vitest suite).
// Integrates: Drive quota helper, app transport, account UI and native source contracts.
// Contracts: Correct v3 fields; no double-counted trash, fabricated space, or system temp staging.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDriveQuota, parseDriveQuota } from '@/utils/driveQuota'
const read = (path: string) => readFileSync(path, 'utf8')
afterEach(() => vi.unstubAllGlobals())

describe('Google Drive app storage space', () => {
  it('reads v3 string counters without adding trash to total usage twice', () => {
    expect(parseDriveQuota({ storageQuota: { usage: '100', limit: '1000', usageInDriveTrash: '5' } })).toMatchObject({ totalBytes: 1000, usedBytes: 100 })
  })
  it('keeps unlimited, missing and invalid counters unknown', () => {
    expect(parseDriveQuota({ storageQuota: { usage: 50 } })).toMatchObject({ totalBytes: null, usedBytes: 50 })
    expect(parseDriveQuota({ storageQuota: { usage: '', limit: 'invalid' } })).toMatchObject({ totalBytes: null, usedBytes: null })
    expect(parseDriveQuota(null)).toMatchObject({ totalBytes: null, usedBytes: null })
    expect(parseDriveQuota({ storageQuota: { usage: -1, limit: Infinity } })).toMatchObject({ totalBytes: null, usedBytes: null })
  })
  it('requests the correct v3 projection with authorization', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageQuota: { usage: '100', limit: '1000' } }) })
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchDriveQuota('test-token')).toMatchObject({ totalBytes: 1000, usedBytes: 100 })
    expect(fetcher).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/about?fields=storageQuota', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' }, signal: expect.any(AbortSignal) }))
  })
  it('refuses missing credentials and classifies rejected authorization', async () => {
    await expect(fetchDriveQuota('')).rejects.toThrow(/^auth:/)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(fetchDriveQuota('invalid')).rejects.toThrow(/^auth:/)
  })
  it('reports network errors without exposing the supplied token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sensitive-value')))
    await expect(fetchDriveQuota('sensitive-value')).rejects.toThrow(/^network:/)
    await expect(fetchDriveQuota('sensitive-value')).rejects.not.toThrow('sensitive-value')
  })
  it('automatically loads selected Drive quota and displays free space without assuming unknown means zero', () => {
    const panel = read('src/components/AccountManagerPanel.vue')
    expect(panel).toContain("if (cfg?.backendType === 'googleDrive') void quota(cfg)")
    expect(panel).toContain('immediate: true')
    expect(panel).toContain('Math.max(0, u.totalBytes - u.usedBytes)')
    expect(panel).toContain('${humanBytes(freeBytes)} free')
    expect(panel).toContain('Free space unavailable (no storage limit reported)')
    expect(read('src/composables/useTauri.ts')).toContain("if (cfg.backendType === 'googleDrive') return fetchDriveQuota(secret)")
  })
})

it('stages seeds and uploads under the Android-aware private app data directory with automatic cleanup', () => {
  const native = read('crates/web/src/api/sync_api.rs')
  expect(native).toContain('cybermanju_crypto::keystore::data_dir()')
  expect(native.match(/let dir = seed_staging_dir\(\)\?;/g)).toHaveLength(2)
  expect(native).toContain('tempdir_in(cache)')
  expect(native).not.toContain('temp_dir().join(format!("cyb-upload-')
  const manifest = read('crates/web/Cargo.toml').split('[dev-dependencies]')[0]
  expect(manifest).toContain('tempfile = "3"')
  const quota = read('crates/sync/src/quota.rs')
  expect(quota).toContain('about?fields=storageQuota')
  expect(quota).not.toContain('quotaInfo')
  expect(quota).toContain('usage.used_bytes = used;')
})
