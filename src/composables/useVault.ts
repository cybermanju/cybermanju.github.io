// CyberManju OS — key/value vault
//
// Secrets, app config and small blobs belong inside `.cybermanju`, so they
// live in redb's `kv` table through the worker (`kv.get/set/delete/list`,
// crates/os-wasm/src/db.rs). Everything is namespaced by convention:
//
//   secret:<account>/<name>   provider PATs, Supabase service secrets
//   config:<name>             app + provider configuration
//   content:<fileId>          file bodies (text-ish payloads)
//   volume:<path>             shell file mirror (see useVolumeMirror)
//
// Graceful degradation is the whole design: the *shipped* `pkg/` bundle was
// built before `kv.*` existed, and CI rebuilds it on push. Until then — or
// whenever the worker/db is unavailable — every call falls back to
// localStorage under `cybermanju.vault.*`, so the app keeps working and
// silently upgrades to in-file storage the next time a new pkg lands.

import { wasmDbDispatch } from './useWasmBackend'

export type VaultBackend = 'kv' | 'localStorage' | 'unknown'

const LS_PREFIX = 'cybermanju.vault.'
const MAX_KEY = 512

/** `null` = not probed yet / transient failure (retry next call). */
let kvKnownBroken = false
let kvKnownWorking = false

function lsRead(key: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + key)
  } catch {
    return null
  }
}

function lsWrite(key: string, value: string | null) {
  try {
    if (value === null || value === '') localStorage.removeItem(LS_PREFIX + key)
    else localStorage.setItem(LS_PREFIX + key, value)
  } catch {
    // Private mode / quota — session-only storage is unavailable; the next
    // successful kv write still lands in the file.
  }
}

function lsKeys(prefix: string): Array<{ key: string; bytes: number }> {
  try {
    const out: Array<{ key: string; bytes: number }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LS_PREFIX)) continue
      const short = k.slice(LS_PREFIX.length)
      if (prefix && !short.startsWith(prefix)) continue
      out.push({ key: short, bytes: (localStorage.getItem(k) || '').length })
    }
    return out
  } catch {
    return []
  }
}

/** Which store the vault is using right now (UI copy + tests). */
export function vaultBackend(): VaultBackend {
  if (kvKnownWorking) return 'kv'
  if (kvKnownBroken) return 'localStorage'
  return 'unknown'
}

function isUnsupported(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e)
  return /unsupported: unknown demo-db op/i.test(text)
}

/**
 * One kv dispatch. `null` means "fall back to localStorage for this call";
 * only an explicit `unsupported:` reply flips the vault to localStorage for
 * the rest of the session (that is the old-pkg case, not a flaky worker).
 */
async function kvDispatch(
  op: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; unsupported: boolean }> {
  if (kvKnownBroken) return { ok: false, unsupported: true }
  try {
    const value = await wasmDbDispatch(op, args, 30000)
    kvKnownWorking = true
    return { ok: true, value }
  } catch (e) {
    if (isUnsupported(e)) kvKnownBroken = true
    return { ok: false, unsupported: isUnsupported(e) }
  }
}

export async function vaultGet(key: string): Promise<string | null> {
  const res = await kvDispatch('kv.get', { key })
  if (res.ok) {
    const row = res.value as { value?: unknown } | null
    if (!row || typeof row !== 'object') return null
    return typeof row.value === 'string' ? row.value : null
  }
  return lsRead(key)
}

export async function vaultSet(key: string, value: string): Promise<void> {
  if (key.length > MAX_KEY) throw new Error(`vault: key must be at most ${MAX_KEY} characters`)
  const res = await kvDispatch('kv.set', { key, value })
  // Drop any stale localStorage shadow once the file owns this key.
  if (res.ok) lsWrite(key, null)
  else lsWrite(key, value || null)
}

export async function vaultDelete(key: string): Promise<void> {
  const res = await kvDispatch('kv.delete', { key })
  if (!res.ok) lsWrite(key, null)
}

export async function vaultList(prefix = ''): Promise<Array<{ key: string; bytes: number }>> {
  const res = await kvDispatch('kv.list', { prefix })
  if (res.ok && Array.isArray(res.value)) {
    return (res.value as Array<{ key: string; bytes: number }>).filter((r) => !!r?.key)
  }
  return lsKeys(prefix)
}

export async function vaultGetJson<T>(key: string): Promise<T | null> {
  const raw = await vaultGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function vaultSetJson(key: string, value: unknown): Promise<void> {
  await vaultSet(key, JSON.stringify(value))
}

/**
 * Copy anything an older build left in localStorage into the file. Runs once
 * per origin (guarded by a `config:vault.migrated` marker) and is a no-op
 * while `kv.*` is unsupported, so the next launch after CI rebuilds the pkg
 * picks the data up automatically.
 */
export async function migrateVaultFromLocalStorage(): Promise<number> {
  if (!(await vaultGet('config:vault.migrated'))) {
    const rows = lsKeys('')
    let moved = 0
    for (const row of rows) {
      const current = await vaultGet(row.key)
      const value = lsRead(row.key)
      if (current === null && value !== null) {
        const res = await kvDispatch('kv.set', { key: row.key, value })
        if (res.ok) {
          moved++
          lsWrite(row.key, null)
        }
      }
    }
    if (moved > 0 || vaultBackend() === 'kv') await vaultSet('config:vault.migrated', String(Date.now()))
    return moved
  }
  return 0
}
