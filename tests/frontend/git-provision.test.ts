// Private vault repo provisioning — validation, naming, seed layout.
import { describe, expect, it, vi } from 'vitest'
import {
  VAULT_FILE_PATH,
  VAULT_MANIFEST_PATH,
  VAULT_README_PATH,
  buildSeedFiles,
  defaultVaultRepoName,
  encodeUtf8Base64,
  lastSegment,
  provisionSyncedSystem,
  suggestRepoName,
  validateRepoName,
  vaultManifest,
  vaultReadme,
} from '@/utils/gitProvision'

describe('validateRepoName', () => {
  it('accepts plain and owner/repo forms', () => {
    expect(validateRepoName('cybermanju-vault')).toBe('')
    expect(validateRepoName('owner/cybermanju-vault')).toBe('')
  })

  it('rejects empties, reserved names and bad characters', () => {
    expect(validateRepoName('')).not.toBe('')
    expect(validateRepoName('///')).not.toBe('')
    expect(validateRepoName('bad name!')).not.toBe('')
    expect(validateRepoName('.')).not.toBe('')
    // A trailing slash still resolves to the last segment.
    expect(validateRepoName('owner/my-vault/')).toBe('')
  })
})

describe('lastSegment / suggestRepoName', () => {
  it('takes the last path segment', () => {
    expect(lastSegment('owner/my-vault/')).toBe('my-vault')
  })

  it('bumps taken names', () => {
    expect(suggestRepoName('vault', ['vault'])).toBe('vault-2')
    expect(suggestRepoName('vault', [])).toBe('vault')
    expect(suggestRepoName('', [])).toBe(defaultVaultRepoName())
  })
})

describe('seed layout', () => {
  it('builds README + manifest with the vault file named', () => {
    const files = buildSeedFiles('owner/vault', 'main')
    const paths = files.map((f) => f.path)
    expect(paths).toContain(VAULT_README_PATH)
    expect(paths).toContain(VAULT_MANIFEST_PATH)
    expect(vaultReadme('owner/vault', 'main')).toContain('vault.cybermanju')
    expect(vaultReadme('owner/vault', 'main')).toContain(VAULT_FILE_PATH)
    const manifest = JSON.parse(vaultManifest('owner/vault', 'main')) as Record<string, unknown>
    expect(manifest.vaultFile).toBe(VAULT_FILE_PATH)
    // README + manifest decode from base64 cleanly.
    for (const f of files) {
      expect(() => atob(f.contentBase64)).not.toThrow()
    }
    expect(encodeUtf8Base64('hi')).toBe(btoa('hi'))
  })
})

describe('provisionSyncedSystem', () => {
  it('saves config, seeds, probes, then creates + attaches a disk', async () => {
    const calls: string[] = []
    const saved = { id: 'cfg-1', backendType: 'github', repoName: 'o/v', branch: 'main' }
    const out = await provisionSyncedSystem({
      backendType: 'github',
      repo: { backend: 'github', repoName: 'o/v', fullName: 'o/v', branch: 'main', url: 'https://x', projectId: null },
      token: 'tok',
      displayName: 'o/v vault',
      diskSizeMb: 128,
      diskPassphrase: '',
      vaultBytes: new Uint8Array([1, 2, 3]),
      saveConfig: async (c) => {
        calls.push('save')
        expect(c.repoName).toBe('o/v')
        return saved as never
      },
      seedViaBackend: async (_c, files) => {
        calls.push(`seed:${files.length}`)
        expect(files.some((f) => f.path === 'vault.cybermanju')).toBe(true)
        return []
      },
      probe: async () => {
        calls.push('probe')
        return { ok: true, detail: 'ok' }
      },
      createDisk: async () => {
        calls.push('disk')
        return { id: 'disk-1' }
      },
      attachDisk: async () => {
        calls.push('attach')
      },
      useDirectSeed: false,
    })
    expect(out.config.id).toBe('cfg-1')
    expect(out.diskId).toBe('disk-1')
    expect(calls).toEqual(['save', 'seed:3', 'probe', 'disk', 'attach'])
  })

  it('fails loudly when the probe fails (repo still exists remotely)', async () => {
    const saveConfig = vi.fn(async () => ({ id: 'cfg-9' }) as never)
    const seedViaBackend = vi.fn(async () => [])
    await expect(
      provisionSyncedSystem({
        backendType: 'gitlab',
        repo: { backend: 'gitlab', repoName: '42', fullName: 'g/v', branch: 'main', url: 'https://x', projectId: '42' },
        token: 'tok',
        displayName: 'g/v vault',
        saveConfig,
        seedViaBackend,
        probe: async () => ({ ok: false, detail: 'auth: bad token' }),
        createDisk: async () => ({ id: 'd' }),
        attachDisk: async () => undefined,
        useDirectSeed: false,
      }),
    ).rejects.toThrow(/probe failed/)
    expect(seedViaBackend).toHaveBeenCalledOnce()
  })
})
