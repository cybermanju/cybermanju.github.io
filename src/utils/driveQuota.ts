// CyberManju OS — Drive storage quota (src/utils/driveQuota.ts).
// Role: Read real Google Drive v3 storage space for app provider cards.
// Exports: parseDriveQuota, fetchDriveQuota.
// Integrates: browser app transport, Google Drive about/storageQuota API.
// Contracts: Usage already includes trash; missing limits stay unknown, never zero.
import type { QuotaUsage } from '@/types'

export function parseDriveQuota(body: unknown): QuotaUsage {
  const json = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const quota = json.storageQuota && typeof json.storageQuota === 'object' ? json.storageQuota as Record<string, unknown> : {}
  const bytes = (value: unknown): number | null => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
    const n = Number(value)
    return Number.isSafeInteger(n) && n >= 0 ? n : null
  }
  return {
    backendType: 'googleDrive', totalBytes: bytes(quota.limit), usedBytes: bytes(quota.usage),
    detail: Object.keys(quota).length ? 'Google account storage across all services (Drive v3 storageQuota)' : 'Drive returned no storageQuota for this account',
  }
}

export async function fetchDriveQuota(token: string): Promise<QuotaUsage> {
  if (!token.trim()) throw new Error('auth: Connect Google Drive before checking storage space')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${response.status === 401 || response.status === 403 ? 'auth' : 'network'}: Google Drive quota request failed (HTTP ${response.status})`)
    return parseDriveQuota(await response.json())
  } catch (error) {
    if (error instanceof Error && /^(auth|network):/.test(error.message)) throw error
    throw new Error('network: Google Drive storage space is unavailable; check your connection and retry')
  } finally {
    clearTimeout(timeout)
  }
}
