// CyberManju OS — provider links (src/utils/providerLinks.ts).
// Role: derive safe canonical browser URLs for configured external provider roots.
// Exports: providerExternalUrl.
// Integrates: SyncConfig-like provider metadata; no credentials are read or used.
// Contracts: only known HTTPS provider origins and validated identifiers are returned.

export interface ProviderLinkConfig {
  backendType: string
  folderId?: string
  repoName?: string
}

/** Return a canonical provider root URL only when its config identifies a safe target. */
export function providerExternalUrl(config: ProviderLinkConfig | null | undefined): string | null {
  if (!config) return null
  if (config.backendType === 'googleDrive') {
    const folderId = String(config.folderId ?? '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(folderId)) return null
    return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
  }
  if (config.backendType === 'github') {
    const repoName = String(config.repoName ?? '').trim()
    const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repoName)
    if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') return null
    return `https://github.com/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`
  }
  return null
}
