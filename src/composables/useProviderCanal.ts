// CyberManju OS — provider canal orchestration (CONTROL Phase 5.5).
//
// TS half of canal B: mounts + directory cache live in the redb `kv`
// table (so `_save`/`_attach` of the `.cybermanju` container carries the
// whole provider namespace), the Rust half (`crates/os-wasm` canal.rs /
// artifact.rs) does transport + artifact unwrap. This module never fetches
// a provider directly — every network byte goes through `canal_dispatch` /
// `canal_fetch`, so CORS/honest-prefix behaviour stays in one place.
//
// Namespace: single virtual root `providers/<mountId>/<remotePath>`.
// Mounts are read-only lower layers (never merged into `/`).

import {
  wasmArtifactMagic,
  wasmArtifactOpen,
  wasmCanalDispatch,
  wasmCanalFetch,
  wasmDbDispatch,
} from './useWasmBackend'

export interface ProviderMount {
  id: string
  configId: string
  name: string
  backendType: string
  basePath?: string
  createdAt: string
  updatedAt: string
}

export interface VfsEntry {
  name: string
  path: string
  locator: string
  isDir: boolean
  sizeBytes: number
  modifiedAt: string
}

export interface VfsFile {
  bytes: Uint8Array
  magic: string
  text: string | null
}

export const VFS_MOUNT_INDEX_KEY = 'vfs:mount:index'
export const VFS_CACHE_TTL_MS = 60_000
export const VFS_CACHE_PREFIX = 'vfs:cache:'

export const mountKey = (id: string): string => `vfs:mount:${id}`
export const cacheKey = (mountId: string, remotePath: string): string =>
  `${VFS_CACHE_PREFIX}${mountId}:${remotePath.replace(/^\/+/, '')}`

/** `providers/<id>/a/b` → `{ mountId: <id>, remotePath: a/b }`. Null outside the namespace. */
export function parseProviderPath(path: string): { mountId: string; remotePath: string } | null {
  const norm = String(path ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const segs = norm.split('/').filter(Boolean)
  if (segs.length < 2 || segs[0] !== 'providers') return null
  return { mountId: segs[1], remotePath: segs.slice(2).join('/') }
}

export function providerPathFor(mountId: string, remotePath: string): string {
  const rel = String(remotePath ?? '').replace(/^\/+/, '')
  return rel ? `/providers/${mountId}/${rel}` : `/providers/${mountId}`
}

/** True when a cached listing envelope is still usable. */
export function isCacheFresh(cachedAt: number, now = Date.now()): boolean {
  return Number.isFinite(cachedAt) && now - cachedAt < VFS_CACHE_TTL_MS
}

function newMountId(): string {
  try {
    return `mnt-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `mnt-${Date.now().toString(36)}`
  }
}

const LS_FALLBACK_PREFIX = 'cybermanju.vfs.fallback.'

function lsGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(LS_FALLBACK_PREFIX + key) : null
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage?.setItem(LS_FALLBACK_PREFIX + key, value)
  } catch {
    // Quota or private mode — kv remains the store of record.
  }
}

function lsDelete(key: string): void {
  try {
    localStorage?.removeItem(LS_FALLBACK_PREFIX + key)
  } catch {
    // Ignore.
  }
}

async function kvGet(key: string): Promise<string | null> {
  try {
    const row = (await wasmDbDispatch('kv.get', { key })) as { value?: unknown } | null
    if (typeof row?.value === 'string') return row.value
  } catch {
    // Old bundles / non-static transports — fall through to localStorage.
  }
  return lsGet(key)
}

async function kvSet(key: string, value: string): Promise<void> {
  lsSet(key, value)
  try {
    await wasmDbDispatch('kv.set', { key, value })
  } catch {
    // Static-only op — the localStorage mirror keeps every transport working.
  }
}

async function kvDelete(key: string): Promise<void> {
  lsDelete(key)
  try {
    await wasmDbDispatch('kv.delete', { key })
  } catch {
    // Missing op on old bundles — index rewrite still converges.
  }
}

/** Mount registry CRUD — `vfs:mount:*` rows + `vfs:mount:index`. */
export async function listVfsMounts(): Promise<ProviderMount[]> {
  const raw = await kvGet(VFS_MOUNT_INDEX_KEY)
  let ids: string[] = []
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      ids = []
    }
  }
  const out: ProviderMount[] = []
  for (const id of ids) {
    const body = await kvGet(mountKey(id))
    if (!body) continue
    try {
      const m = JSON.parse(body) as Partial<ProviderMount>
      if (typeof m?.id === 'string' && typeof m?.configId === 'string') {
        out.push({
          id: m.id,
          configId: m.configId,
          name: typeof m.name === 'string' ? m.name : m.id,
          backendType: typeof m.backendType === 'string' ? m.backendType : 'github',
          basePath: typeof m.basePath === 'string' ? m.basePath : '',
          createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
          updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : new Date().toISOString(),
        })
      }
    } catch {
      // Skip corrupt rows, keep the rest.
    }
  }
  return out
}

export async function saveVfsMount(input: {
  id?: string
  configId: string
  name: string
  backendType: string
  basePath?: string
}): Promise<ProviderMount> {
  const configId = String(input.configId ?? '').trim()
  if (!configId) throw new Error('invalid: configId is required')
  const now = new Date().toISOString()
  const existing = input.id ? (await listVfsMounts()).find(m => m.id === input.id) : undefined
  const mount: ProviderMount = {
    id: input.id || newMountId(),
    configId,
    name: String(input.name || configId),
    backendType: String(input.backendType || 'github'),
    basePath: String(input.basePath || ''),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const raw = await kvGet(VFS_MOUNT_INDEX_KEY)
  let ids: string[] = []
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      ids = []
    }
  }
  if (!ids.includes(mount.id)) ids.push(mount.id)
  await kvSet(mountKey(mount.id), JSON.stringify(mount))
  await kvSet(VFS_MOUNT_INDEX_KEY, JSON.stringify(ids))
  return mount
}

export async function deleteVfsMount(id: string): Promise<void> {
  const raw = await kvGet(VFS_MOUNT_INDEX_KEY)
  let ids: string[] = []
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      ids = []
    }
  }
  await kvSet(VFS_MOUNT_INDEX_KEY, JSON.stringify(ids.filter(v => v !== id)))
  await kvDelete(mountKey(id))
}

/** Resolve a mount's live sync config (token comes from the vault, never the mount row). */
async function canalConfigFor(mount: ProviderMount): Promise<Record<string, unknown>> {
  const cfg = (await wasmDbDispatch('sync.get', { configId: mount.configId }).catch(() => null)) as Record<
    string,
    unknown
  > | null
  // Fallback: list + find (older bundles expose `sync.list` only).
  let row: Record<string, unknown> | null = cfg
  if (!row) {
    const all = (await wasmDbDispatch('sync.list', {}).catch(() => [])) as Array<Record<string, unknown>>
    row = (Array.isArray(all) ? all : []).find(c => c.id === mount.configId) ?? null
  }
  if (!row) throw new Error(`not_found: sync config ${mount.configId}`)
  let secret = ''
  try {
    const s = (await wasmDbDispatch('sync.secret', { configId: mount.configId }).catch(() => null)) as {
      token?: unknown
    } | null
    if (typeof s?.token === 'string') secret = s.token
  } catch {
    secret = ''
  }
  return { ...(row as object), token: secret || (row as { token?: string }).token || '' }
}

/** List one provider directory — cache first (`vfs:cache:*`, TTL), canal second. */
export async function listVfsDir(mountId: string, remotePath = ''): Promise<VfsEntry[]> {
  const mounts = await listVfsMounts()
  const mount = mounts.find(m => m.id === mountId)
  if (!mount) throw new Error(`not_found: provider mount ${mountId}`)
  const rel = String(remotePath ?? '').replace(/^\/+/, '')
  const key = cacheKey(mountId, rel)
  const cachedRaw = await kvGet(key)
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as { at?: number; entries?: VfsEntry[] }
      if (isCacheFresh(Number(cached?.at ?? 0)) && Array.isArray(cached.entries)) {
        return cached.entries as VfsEntry[]
      }
    } catch {
      // Fall through to a live listing.
    }
  }
  const config = await canalConfigFor(mount)
  const entries = await wasmCanalDispatch<VfsEntry[]>('list', { config, prefix: rel })
  const rows = (Array.isArray(entries) ? entries : []).map(e => ({
    name: String(e.name ?? ''),
    path: String(e.path ?? e.name ?? ''),
    locator: String(e.locator ?? e.path ?? e.name ?? ''),
    isDir: !!e.isDir,
    sizeBytes: Number(e.sizeBytes ?? 0),
    modifiedAt: String(e.modifiedAt ?? ''),
  }))
  await kvSet(key, JSON.stringify({ at: Date.now(), entries: rows })).catch(() => undefined)
  return rows
}

/**
 * Read one provider file: fetch raw bytes, sniff the header, unwrap `CYBE1`
 * artifacts with the mount passphrase, hand `CYBMJ01` to the caller (the TS
 * container codec owns it), decode the rest as UTF-8 text when possible.
 */
export async function readVfsFile(
  mountId: string,
  remotePath: string,
  opts: { locator?: string; passphrase?: string } = {},
): Promise<VfsFile> {
  const mounts = await listVfsMounts()
  const mount = mounts.find(m => m.id === mountId)
  if (!mount) throw new Error(`not_found: provider mount ${mountId}`)
  const rel = String(remotePath ?? '').replace(/^\/+/, '')
  if (!rel) throw new Error('invalid: remotePath is required')
  const config = await canalConfigFor(mount)
  const locator = opts.locator || rel
  const bytes = await wasmCanalFetch(config, locator)
  const magic = await wasmArtifactMagic(bytes).catch(() => 'raw')
  if (magic === 'CYBE1') {
    const passphrase = String(opts.passphrase ?? '')
    if (!passphrase) throw new Error('auth: artifact is encrypted — passphrase required')
    const open = await wasmArtifactOpen(bytes, passphrase)
    return { bytes: open, magic, text: decodeText(open) }
  }
  // CYBMJ01 / CYBMJU1 pass through untouched — their codecs live elsewhere.
  return { bytes, magic, text: magic === 'raw' ? decodeText(bytes) : null }
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}
