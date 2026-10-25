// CyberManju OS — Peer connection tests (tests/frontend/peer-connections.test.ts).
// Role: Regression coverage for peer URL policy, key pins, and monotonic cursors.
// Exports: Vitest suite.
// Integrates: src/utils/peerConnections.ts.
// Contracts: peer tokens never enter this profile-local metadata record.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advancePeerCursor,
  fingerprintDeviceKey,
  loadPeerConnections,
  normalizePeerBaseUrl,
  peerCredentialId,
  savePeerConnection,
} from '../../src/utils/peerConnections'
import { fetchPeerJson } from '../../src/utils/peerSearch'

function memoryStorage(): Storage {
  const rows = new Map<string, string>()
  return {
    get length() { return rows.size },
    clear: () => rows.clear(),
    getItem: (key) => rows.get(key) ?? null,
    key: (index) => [...rows.keys()][index] ?? null,
    removeItem: (key) => { rows.delete(key) },
    setItem: (key, value) => { rows.set(key, String(value)) },
  }
}

const originalCrypto = globalThis.crypto
const originalFetch = globalThis.fetch
afterEach(() => {
  vi.stubGlobal('crypto', originalCrypto)
  vi.stubGlobal('fetch', originalFetch)
})

describe('peer connection persistence', () => {
  it('allows HTTP only for local/LAN hosts and normalizes origin URLs', () => {
    expect(normalizePeerBaseUrl('http://192.168.1.20:3456/')).toBe('http://192.168.1.20:3456')
    expect(normalizePeerBaseUrl('https://peer.example.test/path')).toThrow(/without path/)
    expect(normalizePeerBaseUrl('http://peer.example.test:3456')).toThrow(/require HTTPS/)
    expect(normalizePeerBaseUrl('https://peer.example.test:3456')).toBe('https://peer.example.test:3456')
  })

  it('stores only credential references and advances cursors monotonically', () => {
    const storage = memoryStorage()
    savePeerConnection({
      peerDeviceId: 'peer-a', baseUrl: 'https://peer.example.test', localDeviceId: 'local-a',
      keyFingerprint: 'a'.repeat(64), credentialId: 'peer-sync-peer-a', cursor: 0, updatedAt: 'old',
    }, storage)
    expect(storage.getItem('cybermanju.peerConnections.v1')).not.toContain('token')
    expect(advancePeerCursor('peer-a', 12, storage).cursor).toBe(12)
    expect(() => advancePeerCursor('peer-a', 11, storage)).toThrow(/cannot move backwards/)
    expect(loadPeerConnections(storage)[0]?.cursor).toBe(12)
  })

  it('derives stable ids and SHA-256 fingerprints', async () => {
    expect(peerCredentialId('peer/a')).toBe('peer-sync-peer%2Fa')
    const digest = new Uint8Array(32).fill(0xab)
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => digest) } })
    expect(await fingerprintDeviceKey('public-key')).toBe('ab'.repeat(32))
  })

  it('uses only the peer credential and redacts it from rejected responses', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer peer-secret')
      return new Response(JSON.stringify({ error: 'auth: rejected peer-secret' }), { status: 403 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPeerJson('GET', 'https://peer.example.test/api/readyz', undefined, 'peer-secret'))
      .rejects.toThrow('auth: peer rejected its configured credential (auth: rejected [credential])')
  })
})
