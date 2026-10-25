// CyberManju OS — Peer connections (src/utils/peerConnections.ts).
// Role: validated peer endpoint records, device-key pins, and durable cursors.
// Exports: PeerConnectionConfig, peerCredentialId, normalizePeerBaseUrl,
//   fingerprintDeviceKey, loadPeerConnections, savePeerConnection,
//   advancePeerCursor, removePeerConnection.
// Integrates: DevicesPanel direct peer sync; credentials live in the sealed
//   secrets vault while non-secret connection metadata stays profile-local.
// Contracts: HTTP is accepted only for loopback/private/LAN names; public
//   peers require HTTPS; cursors are monotonic and only advanced by the sync
//   exchange after verified page merge.

export interface PeerConnectionConfig {
  peerDeviceId: string
  baseUrl: string
  localDeviceId: string
  keyFingerprint: string
  credentialId: string
  cursor: number
  updatedAt: string
  lastSuccessfulSyncAt?: string
}

const STORAGE_KEY = 'cybermanju.peerConnections.v1'

function localStorageOrNull(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 ||
    parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 169 && parts[1] === 254
}

function isPrivateOrLanHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (isPrivateIpv4(host)) return true
  // IPv6 loopback, unique-local (fc00::/7), and link-local (fe80::/10).
  return host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)
}

/** Normalize one peer base URL and enforce HTTPS outside trusted local networks. */
export function normalizePeerBaseUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('invalid: peer URL must be an absolute http(s) URL') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid: peer URL scheme must be http or https')
  if (url.username || url.password) throw new Error('invalid: peer URL must not contain embedded credentials')
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('invalid: peer URL must be an origin without path, query, or fragment')
  }
  if (url.protocol === 'http:' && !isPrivateOrLanHost(url.hostname)) {
    throw new Error('unsupported: public peer URLs require HTTPS; HTTP is limited to loopback and trusted LAN addresses')
  }
  return url.origin.replace(/\/$/, '')
}

/** Stable local secret id; the token itself is stored only in sealed secrets. */
export function peerCredentialId(peerDeviceId: string): string {
  const id = peerDeviceId.trim()
  if (!id || id.length > 128 || /[\u0000-\u001f]/.test(id)) throw new Error('invalid: peer device id is required')
  return `peer-sync-${encodeURIComponent(id)}`
}

/** SHA-256 display pin for a registered ML-DSA public key (never a secret). */
export async function fingerprintDeviceKey(publicKey: string): Promise<string> {
  if (!publicKey.trim()) throw new Error('auth: peer has no registered public key')
  if (!globalThis.crypto?.subtle) throw new Error('unsupported: WebCrypto is required to verify a peer key fingerprint')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(publicKey.trim())))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function loadPeerConnections(storage = localStorageOrNull()): PeerConnectionConfig[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is PeerConnectionConfig =>
      row && typeof row.peerDeviceId === 'string' && typeof row.baseUrl === 'string' &&
      typeof row.localDeviceId === 'string' && typeof row.keyFingerprint === 'string' &&
      typeof row.credentialId === 'string' && Number.isSafeInteger(row.cursor) && row.cursor >= 0,
    )
  } catch { return [] }
}

export function savePeerConnection(
  config: PeerConnectionConfig,
  storage = localStorageOrNull(),
): PeerConnectionConfig {
  if (!storage) throw new Error('unsupported: this browser profile cannot persist peer configuration')
  const normalized = {
    ...config,
    peerDeviceId: config.peerDeviceId.trim(),
    baseUrl: normalizePeerBaseUrl(config.baseUrl),
    localDeviceId: config.localDeviceId.trim(),
    keyFingerprint: config.keyFingerprint.trim().toLowerCase(),
    credentialId: config.credentialId.trim(),
    cursor: Math.max(0, Math.floor(config.cursor)),
    updatedAt: new Date().toISOString(),
  }
  if (!normalized.peerDeviceId || !normalized.localDeviceId || !normalized.credentialId || !/^[a-f0-9]{64}$/.test(normalized.keyFingerprint)) {
    throw new Error('invalid: peer id, local device, sealed credential, and SHA-256 key pin are required')
  }
  const existing = loadPeerConnections(storage).filter((row) => row.peerDeviceId !== normalized.peerDeviceId)
  storage.setItem(STORAGE_KEY, JSON.stringify([...existing, normalized]))
  return normalized
}

/** Advance after a complete verified/merged page; stale retry cursors refuse. */
export function advancePeerCursor(
  peerDeviceId: string,
  cursor: number,
  storage = localStorageOrNull(),
): PeerConnectionConfig {
  const current = loadPeerConnections(storage).find((row) => row.peerDeviceId === peerDeviceId)
  if (!current) throw new Error('not_found: peer connection is not configured')
  if (!Number.isSafeInteger(cursor) || cursor < current.cursor) throw new Error('integrity: peer cursor cannot move backwards')
  return savePeerConnection({ ...current, cursor }, storage)
}

export function removePeerConnection(peerDeviceId: string, storage = localStorageOrNull()): void {
  if (!storage) return
  const remaining = loadPeerConnections(storage).filter((row) => row.peerDeviceId !== peerDeviceId)
  storage.setItem(STORAGE_KEY, JSON.stringify(remaining))
}
