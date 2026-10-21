// CyberManju OS — provider links.test (tests/frontend/provider-links.test.ts).
// Role: pin safe direct-link targets for supported provider folder/repository configs.
// Exports: test suite.
// Integrates: src/utils/providerLinks.ts.
// Contracts: credentials and untrusted URL schemes never influence the destination.
import { describe, expect, it } from 'vitest'
import { providerExternalUrl } from '../../src/utils/providerLinks'

describe('providerExternalUrl', () => {
  it('builds a canonical Google Drive folder URL from the configured folder id', () => {
    expect(providerExternalUrl({ backendType: 'googleDrive', folderId: 'folder_123-abc' }))
      .toBe('https://drive.google.com/drive/folders/folder_123-abc')
  })

  it('builds a canonical GitHub repository URL from owner/repository config', () => {
    expect(providerExternalUrl({ backendType: 'github', repoName: 'cybermanju/os' }))
      .toBe('https://github.com/cybermanju/os')
  })

  it('does not invent a Drive folder target when no folder id is configured', () => {
    expect(providerExternalUrl({ backendType: 'googleDrive' })).toBeNull()
  })

  it('rejects URL injection and malformed repo identifiers', () => {
    expect(providerExternalUrl({ backendType: 'github', repoName: 'https://evil.example/o/r' })).toBeNull()
    expect(providerExternalUrl({ backendType: 'github', repoName: '../repo' })).toBeNull()
    expect(providerExternalUrl({ backendType: 'googleDrive', folderId: 'id/path?url=evil' })).toBeNull()
  })

  it('does not expose links for unsupported provider types', () => {
    expect(providerExternalUrl({ backendType: 'gitLab', repoName: 'owner/repo' })).toBeNull()
  })
})
