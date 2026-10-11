// CyberManju OS — LAN direct sync (src/utils/lanSync.ts).
// Role: device↔device sync protocol over the LAN (ANALYSIS.md §2B.2 follow-up)
// — peer-auth check against the device registry, peer base-URL builder, and an
// explicit pull→push→render step plan reusing the op-log exchange.
// Exports: PeerDevice, peerBaseUrl, isPeerSyncable, lanSyncSteps, describePeer.
// Integrates: DevicesPanel LAN peers card (SYNC button); `lan sync` cybsh verb;
// server half is `POST /api/peers/{id}/sync` (peer auth via devices registry).
// Contracts: pure, never throws; revoked or missing device rows never sync
// (fail-closed); loopback peers keep their port; hostnames are never guessed.
export interface PeerDevice {
  deviceId: string
  name: string
  host: string
  port: number
  revoked?: boolean
}

/** `http://<host>:<port>` for a discovered peer (port always explicit). */
export function peerBaseUrl(peer: PeerDevice): string {
  const host = (peer.host || '').trim() || '127.0.0.1'
  const port = peer.port > 0 ? peer.port : 3456
  return `http://${host}:${port}`
}

/** Fail-closed gate: a peer syncs only with a known, non-revoked device row. */
export function isPeerSyncable(peer: PeerDevice, knownDeviceIds: Set<string> | string[]): boolean {
  if (peer.revoked) return false
  if (!peer.deviceId.trim()) return false
  const known = Array.isArray(knownDeviceIds) ? new Set(knownDeviceIds) : knownDeviceIds
  return known.has(peer.deviceId)
}

/** Why a peer cannot sync (empty = syncable). */
export function peerBlockReason(peer: PeerDevice, knownDeviceIds: Set<string> | string[]): string {
  if (peer.revoked) return 'device revoked — re-enroll it first'
  if (!peer.deviceId.trim()) return 'peer has no device id'
  const known = Array.isArray(knownDeviceIds) ? new Set(knownDeviceIds) : knownDeviceIds
  if (!known.has(peer.deviceId)) return 'unknown device — enroll it via Devices → Identity first'
  return ''
}

/** Explicit direct-sync steps (pull peer ops, push ours, render conflicts). */
export function lanSyncSteps(peer: PeerDevice, since: number): string[] {
  const base = peerBaseUrl(peer)
  return [
    `pull: GET ${base}/api/oplog/since?since=${Math.max(0, since)}`,
    `push: POST ${base}/api/oplog/push { ops: ours }`,
    `merge: POST /api/oplog/push { ops: theirs }`,
    'render: GET /api/oplog/conflicts',
  ]
}

/** One-line peer label for buttons and the cybsh verb. */
export function describePeer(peer: PeerDevice): string {
  const name = peer.name.trim() || peer.deviceId
  return `${name} (${peer.host}:${peer.port})`
}
