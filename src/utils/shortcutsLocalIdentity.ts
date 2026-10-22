// CyberManju OS — Shortcuts local identity (src/utils/shortcutsLocalIdentity.ts).
// Role: Persist a cryptographically random namespace for native/static local workflow data.
// Exports: shortcutsLocalIdentity.
// Integrates: Browser/WebView localStorage and Web Crypto; no Rust enrollment or device IDs.
// Contracts: Data isolation only, NOT authentication; throw on missing crypto, corrupt ID or storage failure.
const KEY = 'cybermanju:shortcuts:local-identity:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function shortcutsLocalIdentity(): string {
  // This ID is public metadata, not a secret. Require secure randomness even on reload;
  // never substitute Math.random, an in-memory ID, a device DB row or enrollment.
  if (typeof crypto?.randomUUID !== 'function') throw new Error('secure_local_identity_unavailable')
  const storage = globalThis.localStorage
  const stored = storage.getItem(KEY)
  if (stored !== null) {
    if (!UUID.test(stored)) throw new Error('invalid_local_identity')
    return stored
  }
  const id = crypto.randomUUID()
  if (!UUID.test(id)) throw new Error('invalid_local_identity')
  storage.setItem(KEY, id)
  // Verify persistence instead of silently accepting private/blocked/no-op storage.
  if (storage.getItem(KEY) !== id) throw new Error('persistent_local_identity_required')
  return id
}
