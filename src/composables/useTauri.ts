// CyberManju OS — Tauri IPC Composable
// Supports both Tauri desktop (IPC) and Server/Web (REST) modes
//
// In Tauri mode: delegates to @tauri-apps/api/core invoke
// In Web mode: calls the Web Dashboard REST API (port 3456 by default)

import type { FileNode } from '@/types'
import {
  notifyOsDispatch,
  wasmDbDispatch,
  wasmDiskStatus,
  wasmModuleExports,
  wasmOsDispatch,
  wasmSearchFiles,
  wasmBackendActive,
} from './useWasmBackend'
import { vaultGet, vaultSet } from './useVault'
import {
  probeProviderQuotaViaFetch,
  runStaticCybshLine,
  staticConfigFromRow,
  type StaticChacha,
  type StaticCodecs,
  type StaticCybshDeps,
  type StaticSyncConfig,
} from '@/utils/staticCybsh'
import {
  compressFile,
  decryptFile,
  decompressFile,
  encryptFile,
  generateKeyPair,
  getEncryptionStatus,
  listKeys,
  readContentText,
  writeContentText,
} from './useWasmCrypto'
import type { EncryptionAlgo } from '@/types'

// ── Module-level connection state ─────────────────────────────

const AUTH_TOKEN_KEY = 'cybermanju.authToken'
const SERVER_URL_KEY = 'cybermanju.serverUrl'

let _serverUrl = ''

// Restore a previously configured dashboard URL so a static build keeps
// pointing at its server across reloads (this is what makes OAuth work
// from the Pages build: with a server set, this is a REST client, not a
// static host).
try {
  _serverUrl = (typeof localStorage !== 'undefined' && localStorage.getItem(SERVER_URL_KEY)) || ''
} catch {
  _serverUrl = ''
}

// Restore a previously issued JWT so a page reload stays authenticated.
let _authToken = ''
try {
  _authToken = (typeof localStorage !== 'undefined' && localStorage.getItem(AUTH_TOKEN_KEY)) || ''
} catch {
  _authToken = ''
}

/** Configure the Web Dashboard REST API base URL. */
export function setServerUrl(url: string): void {
  _serverUrl = url.replace(/\/+$/, '')
  try {
    if (_serverUrl) localStorage.setItem(SERVER_URL_KEY, _serverUrl)
    else localStorage.removeItem(SERVER_URL_KEY)
  } catch {
    // Storage unavailable — URL still works for this session
  }
}

/** Configure (and persist) the Bearer token for JWT auth. */
export function setAuthToken(token: string): void {
  _authToken = token
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    // Storage unavailable (private mode) — token still works for this session
  }
}

/** Read the current auth token (for diagnostics). */
export function getAuthToken(): string {
  return _authToken
}

/** Read the current server URL (for diagnostics). */
export function getServerUrl(): string {
  return _serverUrl
}

// ── Environment Detection ────────────────────────────────────

export function isTauri(): boolean {
  // Truthiness, not presence: vite.config.wasm.ts defines `__TAURI__` as
  // false for static builds, so `'__TAURI__' in window` misfires there.
  if (typeof window === 'undefined') return false
  return Boolean((window as unknown as Record<string, unknown>).__TAURI__)
}

export function isWebMode(): boolean {
  return !isTauri()
}

// ── REST helpers ─────────────────────────────────────────────

/**
 * True when the app is served from a static host (GitHub Pages / WASM pack)
 * with no dashboard behind it. On those origins every REST call would hit
 * `localhost:3456` and die with ERR_CONNECTION_REFUSED, so the OS layer is
 * routed through the `cybermanju-os-wasm` crate instead.
 */
export function isStaticHost(): boolean {
  if (typeof window === 'undefined') return false
  // Tauri (desktop + Android WebView over asset://localhost) always has the
  // native Rust backend — never treat it as the static Pages/WASM pack, or
  // disks/sync/agent would route to the browser worker instead of redb.
  if (isTauri()) return false
  if (window.location.port === '3456' || _serverUrl) return false
  return true
}

/** True inside the Android WebView (Tauri mobile build). */
export function isAndroidApp(): boolean {
  if (typeof navigator === 'undefined') return false
  try {
    return isTauri() && /android/i.test(navigator.userAgent)
  } catch {
    return false
  }
}

/** Resolve the base URL for REST calls. */
function getBaseUrl(): string {
  if (_serverUrl) return _serverUrl
  // If the app is served directly from the web dashboard, use same origin
  if (typeof window !== 'undefined' && window.location?.origin) {
    const port = window.location.port
    // Port 3456 is the web dashboard — use same origin
    if (port === '3456') return window.location.origin
  }
  return 'http://localhost:3456'
}

/** Build headers including optional auth. */
function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  if (_authToken) {
    h['Authorization'] = `Bearer ${_authToken}`
  }
  return h
}

/** Generic REST fetch with proper error handling. */
async function restFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const TIMEOUT_MS = 15000
  const MAX_ATTEMPTS = 2
  // AGENT-1 transient prefixes worth one backoff retry.
  const isRetriable = (msg: string) =>
    msg.startsWith('network:') || msg.startsWith('rate_limited:')
  const backoff = (attempt: number) =>
    new Promise<void>((r) => setTimeout(r, 300 * (attempt + 1)))
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const init: RequestInit = {
      method,
      headers: buildHeaders(),
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    init.signal = ctrl.signal

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      clearTimeout(timer)
      const reason = err instanceof Error ? err.message : String(err)
      const aborted =
        err instanceof Error && (err.name === 'AbortError' || reason.includes('abort'))
      const msg = aborted
        ? `network: request timed out after ${TIMEOUT_MS}ms calling ${method} ${path}: ${reason}`
        : `network: Network error calling ${method} ${path}: ${reason}`
      lastError = new Error(msg)
      if (attempt + 1 < MAX_ATTEMPTS && isRetriable(msg)) {
        await backoff(attempt)
        continue
      }
      throw lastError
    }
    clearTimeout(timer)

    if (!res.ok) {
      // Expired / missing JWT — tell the app to offer a login (F2)
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cybermanju:unauthorized'))
      }
      let message = `HTTP ${res.status} ${res.statusText}`
      try {
        const errBody = await res.json()
        if (errBody?.message) message = errBody.message
        else if (errBody?.error) message = `${res.status}: ${errBody.error}`
      } catch {
        // Server sent plain text (or empty) — preserve any AGENT-1 prefix it carries.
        try {
          const text = await res.text()
          if (text.trim()) message = text.trim()
        } catch {
          // ignore body read failure
        }
      }
      // Normalize bare HTTP failures to AGENT-1 prefixes so callers can hint.
      if (message.startsWith('HTTP 401') || res.status === 401) {
        if (!message.includes('auth:')) message = `auth: ${message}`
      } else if (res.status === 429 && !message.startsWith('rate_limited:')) {
        message = `rate_limited: ${message}`
      }
      if (attempt + 1 < MAX_ATTEMPTS && isRetriable(message)) {
        await backoff(attempt)
        continue
      }
      throw new Error(message)
    }

    // 204 No Content
    if (res.status === 204) return undefined as T

    return res.json() as Promise<T>
  }
  throw lastError instanceof Error ? lastError : new Error('network: request failed')
}

// ── Response key transformation ──────────────────────────────
// The REST API returns raw redb JSON. Field names may be snake_case
// (Rust default). The Tauri IPC layer uses serde camelCase renaming.
// We convert snake_case → camelCase so responses match TypeScript types.
// The `_key` and `_raw` fields added by list_all_json are stripped.

function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

function transformResponseKeys(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(transformResponseKeys)

  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(src)) {
    // Strip _raw field (unparseable fallback from list_all_json)
    if (key === '_raw') continue
    // Promote _key → id when the object lacks its own id
    if (key === '_key') {
      if (!('id' in src)) {
        out['id'] = val
      }
      continue
    }
    out[toCamelCase(key)] = transformResponseKeys(val)
  }
  return out
}

// ── REST command mapping ────────────────────────────────────
// Maps Tauri IPC command names → Web Dashboard REST endpoints.

interface RestMapping {
  method: string
  buildPath: (args: Record<string, unknown>) => string
  transformRequest?: (args: Record<string, unknown>) => unknown
  transformResponse?: (raw: unknown, args: Record<string, unknown>) => unknown
}

export const REST_ROUTES: Record<string, RestMapping> = {
  // ── Files ─────────────────────────────────────────────────
  list_files: {
    method: 'GET',
    buildPath: () => '/api/files',
    transformResponse: (raw, args) => {
      let files = transformResponseKeys(raw) as FileNode[]
      // The REST API returns ALL files — filter by parentPath if provided
      const parentPath = args.parentPath as string | undefined
      if (parentPath) {
        files = files.filter(f => {
          if (f.parentId) return f.parentId === parentPath
          if (f.path) {
            // Match files whose path starts with parentPath and have no deeper separator
            const prefix = parentPath === '/' ? '/' : `${parentPath}/`
            return f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/')
          }
          return false
        })
      }
      return files
    },
  },

  get_file: {
    method: 'GET',
    buildPath: (args) => `/api/files/${args.fileId}`,
  },

  delete_file: {
    method: 'DELETE',
    buildPath: (args) => `/api/files/${args.fileId}`,
  },

  get_preview: {
    method: 'GET',
    buildPath: (args) => `/api/files/${args.fileId}/preview`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  search_files: {
    method: 'GET',
    buildPath: (args) => `/api/search?q=${encodeURIComponent(String(args.query ?? ''))}`,
    transformResponse: (raw) => {
      // REST returns scored BM25 hits; map to SearchResult shape
      const items = transformResponseKeys(raw) as Array<Record<string, unknown>>
      return items.map(item => ({
        fileId: item.fileId ?? item.id ?? '',
        fileName: item.fileName ?? item.name ?? '',
        score: typeof item.score === 'number' ? item.score : 1.0,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
      }))
    },
  },

  suggest: {
    method: 'GET',
    buildPath: (args) => {
      const params = new URLSearchParams()
      params.set('q', String(args.prefix ?? args.query ?? ''))
      params.set('limit', String(args.limit ?? 10))
      return `/api/search/suggest?${params.toString()}`
    },
  },

  get_geo_files: {
    method: 'GET',
    buildPath: () => '/api/geo-files',
    transformResponse: (raw) => {
      const items = transformResponseKeys(raw) as Array<Record<string, unknown>>
      return items
        .filter(f => f.gpsLat != null && f.gpsLon != null)
        .map(f => ({
          id: f.id,
          name: f.name,
          gpsLat: f.gpsLat as number,
          gpsLon: f.gpsLon as number,
        }))
    },
  },

  // ── Accounts ──────────────────────────────────────────────
  list_accounts: {
    method: 'GET',
    buildPath: () => '/api/accounts',
  },

  // ── Collections ───────────────────────────────────────────
  list_collections: {
    method: 'GET',
    buildPath: () => '/api/collections',
  },

  get_collection_items: {
    method: 'GET',
    buildPath: () => '/api/collection-items',
  },

  // ── Face groups ───────────────────────────────────────────
  list_face_groups: {
    method: 'GET',
    buildPath: () => '/api/face-groups',
  },

  // ── Loose groups ──────────────────────────────────────────
  list_loose_groups: {
    method: 'GET',
    buildPath: () => '/api/loose-groups',
  },

  create_loose_group: {
    method: 'POST',
    buildPath: () => '/api/loose-groups',
    transformRequest: (args) => ({
      name: args.name,
      color: args.color ?? '#FFFFFF',
    }),
  },

  add_to_loose_group: {
    method: 'POST',
    buildPath: (args) => `/api/loose-groups/${encodeURIComponent(String(args.groupId ?? ''))}/files`,
    transformRequest: (args) => ({
      fileId: args.fileId,
    }),
  },

  // ── Encryption ────────────────────────────────────────────
  get_encryption_status: {
    method: 'GET',
    buildPath: (args) => {
      const fileId = String(args?.fileId ?? '')
      return fileId ? `/api/encryption/status?fileId=${encodeURIComponent(fileId)}` : '/api/encryption/status'
    },
    transformResponse: (raw) => {
      const data = transformResponseKeys(raw) as Record<string, unknown>
      return {
        isEncrypted: typeof data.isEncrypted === 'boolean' ? data.isEncrypted : false,
        algorithm: typeof data.algorithm === 'string' ? data.algorithm : undefined,
        nistLevel: typeof data.nistLevel === 'number' ? data.nistLevel : undefined,
        keyId: typeof data.keyId === 'string' ? data.keyId : undefined,
        encryptedAt: typeof data.encryptedAt === 'string' ? data.encryptedAt : undefined,
        // Include extra info from the REST response
        available: data.available ?? false,
        supportedAlgorithms: data.supportedAlgorithms ?? [],
        engine: data.engine ?? '',
      }
    },
  },

  list_keys: {
    method: 'GET',
    buildPath: () => '/api/encryption/keys',
  },

  // ── User management ───────────────────────────────────────
  list_users: {
    method: 'GET',
    buildPath: () => '/api/users',
  },

  // Public first-run probe (no token needed): tells every device whether
  // bootstrap registration is still open. Used by the Docker/web login gate
  // to pick "create the first account" vs "sign in".
  auth_status: {
    method: 'GET',
    buildPath: () => '/api/auth/status',
  },

  // Session revocation (best-effort on logout; expiry revokes the rest).
  logout_user: {
    method: 'POST',
    buildPath: () => '/api/auth/logout',
    transformRequest: () => ({}),
  },

  authenticate_user: {
    method: 'POST',
    buildPath: () => '/api/users/login',
    transformRequest: (args) => ({
      username: args.username,
      password: args.password,
    }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  register_user: {
    method: 'POST',
    buildPath: () => '/api/users/register',
    transformRequest: (args) => ({
      username: args.username,
      password: args.password,
      displayName: args.displayName,
      role: args.role,
    }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── Permissions ───────────────────────────────────────────
  get_file_permissions: {
    method: 'GET',
    buildPath: (args) => `/api/permissions/${args.fileId}`,
  },

  grant_file_permission: {
    method: 'POST',
    buildPath: () => '/api/permissions',
    transformRequest: (args) => ({
      userId: args.userId,
      fileId: args.fileId,
      access: args.access,
    }),
  },

  set_file_permission: {
    method: 'POST',
    buildPath: () => '/api/permissions',
    transformRequest: (args) => ({
      userId: args.userId,
      fileId: args.fileId,
      access: args.access,
    }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  get_shared_file: {
    method: 'GET',
    buildPath: (args) => `/api/shared/${encodeURIComponent(String(args.token ?? ''))}`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  verify_file_access: {
    method: 'POST',
    buildPath: () => '/api/permissions/verify',
    transformRequest: (args) => ({
      userId: args.userId,
      fileId: args.fileId,
      requiredAccess: args.requiredAccess,
    }),
  },

  // ── Locations ─────────────────────────────────────────────
  list_locations: {
    method: 'GET',
    buildPath: () => '/api/locations',
  },

  // ── Dashboard ─────────────────────────────────────────────
  dashboard_status: {
    method: 'GET',
    buildPath: () => '/api/dashboard/status',
  },

  // ── Files (write ops) ────────────────────────────────────
  create_folder: {
    method: 'POST',
    buildPath: () => '/api/files/folder',
    transformRequest: (args) => ({ name: args.name, parentId: args.parentId }),
  },

  rename_file: {
    method: 'POST',
    buildPath: (args) => `/api/files/${args.fileId}/rename`,
    transformRequest: (args) => ({ newName: args.newName }),
  },

  set_file_tags: {
    method: 'PUT',
    buildPath: (args) => `/api/files/${args.fileId}/tags`,
    transformRequest: (args) => ({ tags: args.tags ?? [] }),
  },

  move_file: {
    method: 'POST',
    buildPath: (args) => `/api/files/${args.fileId}/move`,
    transformRequest: (args) => ({ parentId: args.newParentId }),
  },

  duplicate_file_context: {
    method: 'POST',
    buildPath: (args) => `/api/files/${args.fileId}/duplicate`,
    transformRequest: () => ({}),
  },

  rebuild_parent_index: {
    method: 'POST',
    buildPath: () => '/api/files/rebuild-index',
    transformRequest: () => ({}),
  },

  // ── Trash ────────────────────────────────────────────────
  list_trash: {
    method: 'GET',
    buildPath: () => '/api/trash',
  },

  restore_from_trash: {
    method: 'POST',
    buildPath: (args) => `/api/trash/${args.fileId}/restore`,
    transformRequest: () => ({}),
  },

  delete_from_trash: {
    method: 'DELETE',
    buildPath: (args) => `/api/trash/${args.fileId}`,
  },

  empty_trash: {
    method: 'DELETE',
    buildPath: () => '/api/trash',
  },

  // ── File versions ────────────────────────────────────────
  list_file_versions: {
    method: 'GET',
    buildPath: (args) => `/api/files/${args.fileId}/versions`,
  },

  create_file_version: {
    method: 'POST',
    buildPath: (args) => `/api/files/${args.fileId}/versions`,
    transformRequest: () => ({}),
  },

  revert_file_version: {
    method: 'POST',
    buildPath: (args) => `/api/files/${args.fileId}/versions/${args.versionId}/revert`,
    transformRequest: () => ({}),
  },

  snapshot_all_versions: {
    method: 'POST',
    buildPath: () => '/api/versions/snapshot-all',
    transformRequest: () => ({}),
  },

  // ── Audit log ────────────────────────────────────────────
  get_audit_log: {
    method: 'GET',
    buildPath: (args) => {
      const params = new URLSearchParams()
      if (args.limit != null) params.set('limit', String(args.limit))
      if (args.entityType) params.set('entityType', String(args.entityType))
      const qs = params.toString()
      return qs ? `/api/audit?${qs}` : '/api/audit'
    },
  },

  // ── Share links ──────────────────────────────────────────
  generate_share_link: {
    method: 'POST',
    buildPath: () => '/api/share-links',
    transformRequest: (args) => ({
      fileId: args.fileId,
      expiresInHours: args.expiresInHours,
    }),
  },

  list_share_links: {
    method: 'GET',
    buildPath: () => '/api/share-links',
  },

  // ── Batch operations ─────────────────────────────────────
  batch_delete: {
    method: 'POST',
    buildPath: () => '/api/batch/delete',
    transformRequest: (args) => ({ fileIds: args.fileIds }),
  },

  batch_encrypt: {
    method: 'POST',
    buildPath: () => '/api/batch/encrypt',
    transformRequest: (args) => ({ fileIds: args.fileIds, algorithm: args.algorithm }),
  },

  batch_compress: {
    method: 'POST',
    buildPath: () => '/api/batch/compress',
    transformRequest: (args) => ({ fileIds: args.fileIds, layer: args.layer }),
  },

  // ── User management (admin) ──────────────────────────────
  create_user: {
    method: 'POST',
    buildPath: () => '/api/users',
    transformRequest: (args) => ({
      username: args.username,
      password: args.password,
      role: args.role,
    }),
  },

  delete_user: {
    method: 'DELETE',
    buildPath: (args) => `/api/users/${args.userId}`,
  },

  update_user_role: {
    method: 'POST',
    buildPath: (args) => `/api/users/${args.userId}/role`,
    transformRequest: (args) => ({ role: args.role }),
  },

  // ── Accounts (write) ─────────────────────────────────────
  create_account: {
    method: 'POST',
    buildPath: () => '/api/accounts',
    transformRequest: (args) => ({
      name: args.name,
      accountType: args.accountType,
      path: args.path,
      color: args.color,
    }),
  },

  switch_account: {
    method: 'POST',
    buildPath: (args) => `/api/accounts/${args.accountId}/switch`,
    transformRequest: () => ({}),
  },

  delete_account: {
    method: 'DELETE',
    buildPath: (args) => `/api/accounts/${args.accountId}`,
  },

  // ── Collections (write) ──────────────────────────────────
  create_collection: {
    method: 'POST',
    buildPath: () => '/api/collections',
    transformRequest: (args) => ({
      name: args.name,
      collectionType: args.collectionType,
      color: args.color,
      description: args.description,
    }),
  },

  add_to_collection: {
    method: 'POST',
    buildPath: (args) => `/api/collections/${args.collectionId}/items`,
    transformRequest: (args) => ({ fileId: args.fileId, note: args.note }),
  },

  remove_from_collection: {
    method: 'DELETE',
    buildPath: (args) => `/api/collections/${args.collectionId}/items/${args.fileId}`,
  },

  // ── Sync ─────────────────────────────────────────────────
  list_sync_configs: {
    method: 'GET',
    buildPath: () => '/api/sync/configs',
  },

  create_sync_config: {
    method: 'POST',
    buildPath: () => '/api/sync/configs',
    transformRequest: (args) => ({ config: args.config }),
  },

  delete_sync_config: {
    method: 'DELETE',
    buildPath: (args) => `/api/sync/configs/${args.configId}`,
  },

  start_sync: {
    method: 'POST',
    buildPath: () => '/api/sync/start',
    transformRequest: (args) => ({ configId: args.configId, fileIds: args.fileIds }),
  },

  cancel_sync: {
    method: 'POST',
    buildPath: () => '/api/sync/cancel',
    transformRequest: () => ({}),
  },

  get_sync_progress: {
    method: 'GET',
    buildPath: () => '/api/sync/progress',
  },

  test_sync_connection: {
    method: 'POST',
    buildPath: () => '/api/sync/test',
    transformRequest: (args) => ({ config: args.config }),
  },

  list_remote_files: {
    method: 'POST',
    buildPath: () => '/api/sync/remote-files',
    transformRequest: (args) => ({ config: args.config, prefix: args.prefix ?? '' }),
  },

  get_sync_job: {
    method: 'GET',
    buildPath: (args) => `/api/sync/jobs/${args.jobId}`,
  },

  list_sync_runs: {
    method: 'GET',
    buildPath: () => '/api/sync/runs',
  },

  get_sync_status: {
    method: 'GET',
    buildPath: () => '/api/sync/status',
  },

  restore_sync_file: {
    method: 'POST',
    buildPath: () => '/api/sync/restore',
    transformRequest: (args) => ({
      configId: args.configId,
      fileId: args.fileId,
      remotePath: args.remotePath,
      destPath: args.destPath,
    }),
  },

  delete_remote_file: {
    method: 'DELETE',
    buildPath: () => '/api/sync/remote',
    transformRequest: (args) => ({ configId: args.configId, remotePath: args.remotePath }),
  },

  create_provider_repo: {
    method: 'POST',
    buildPath: () => '/api/sync/create-repo',
    transformRequest: (args) => ({
      backendType: args.backendType,
      configId: args.configId,
      token: args.token,
      name: args.name,
      private: args.private ?? true,
      description: args.description,
      branch: args.branch,
      basePath: args.basePath,
    }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  seed_repo_files: {
    method: 'POST',
    buildPath: () => '/api/sync/seed-repo',
    transformRequest: (args) => ({ config: args.config, files: args.files }),
  },

  upload_remote_file: {
    method: 'POST',
    buildPath: () => '/api/sync/upload',
    transformRequest: (args) => ({
      config: args.config,
      remotePath: args.remotePath,
      contentBase64: args.contentBase64,
    }),
  },

  get_sync_usage: {
    method: 'GET',
    buildPath: (args) => `/api/sync/usage/${args.configId}`,
  },

  oauth_start: {
    method: 'GET',
    buildPath: (args) => `/api/sync/oauth/${args.provider}/start?configId=${encodeURIComponent(String(args.configId ?? ''))}`,
  },

  // ── Durability (AGENT-7): scrub / repair / gc / leases ──
  repair_status: {
    method: 'GET',
    buildPath: () => '/api/repair/status',
  },

  repair_tasks: {
    method: 'GET',
    buildPath: () => '/api/repair/tasks',
  },

  repair_health: {
    method: 'GET',
    buildPath: () => '/api/repair/health',
  },

  repair_run: {
    method: 'POST',
    buildPath: () => '/api/repair/run',
    transformRequest: (args) => ({ findings: args.findings ?? [] }),
  },

  repair_rebuild: {
    method: 'POST',
    buildPath: () => '/api/repair/rebuild',
    transformRequest: () => ({}),
  },

  repair_gc: {
    method: 'POST',
    buildPath: () => '/api/repair/gc',
    transformRequest: (args) => ({ dryRun: args.dryRun ?? false, graceSecs: args.graceSecs }),
  },

  scrub_run: {
    method: 'POST',
    buildPath: () => '/api/scrub/run',
    transformRequest: () => ({}),
  },

  scrub_runs: {
    method: 'GET',
    buildPath: () => '/api/scrub/runs',
  },

  lease_acquire: {
    method: 'POST',
    buildPath: () => '/api/lease/acquire',
    transformRequest: (args) => ({ holder: args.holder, scope: args.scope ?? 'volume', ttlSecs: args.ttlSecs ?? 60 }),
  },

  lease_release: {
    method: 'POST',
    buildPath: () => '/api/lease/release',
    transformRequest: (args) => ({ holder: args.holder, scope: args.scope ?? 'volume' }),
  },

  lease_status: {
    method: 'GET',
    buildPath: (args) => (args.scope ? `/api/lease/status/${encodeURIComponent(String(args.scope))}` : '/api/lease/status'),
  },

  // ── Search (paginated) ───────────────────────────────────
  search_files_paginated: {
    method: 'GET',
    buildPath: (args) => {
      const params = new URLSearchParams()
      params.set('q', String(args.query ?? ''))
      params.set('limit', String(args.limit ?? 20))
      params.set('offset', String(args.offset ?? 0))
      return `/api/search/paginated?${params.toString()}`
    },
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── Code intelligence (transport-agnostic: text in, symbols out) ──
  parse_text: {
    method: 'POST',
    buildPath: () => '/api/code/parse',
    transformRequest: (args) => ({ fileName: args.fileName, content: args.content }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── AI agent (native core; keys never come back, only hasKey) ──
  list_agent_providers: {
    method: 'GET',
    buildPath: () => '/api/agent/providers',
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  list_agent_configs: {
    method: 'GET',
    buildPath: () => '/api/agent/configs',
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  save_agent_config: {
    method: 'POST',
    buildPath: () => '/api/agent/configs',
    transformRequest: (args) => ({ config: args.config }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  delete_agent_config: {
    method: 'DELETE',
    buildPath: (args) => `/api/agent/configs/${args.configId}`,
  },

  save_agent_key: {
    method: 'PUT',
    buildPath: (args) => `/api/agent/configs/${args.configId}/key`,
    transformRequest: (args) => ({ apiKey: args.apiKey }),
  },

  list_agent_models: {
    method: 'GET',
    buildPath: (args) => `/api/agent/configs/${args.configId}/models`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  list_agent_sessions: {
    method: 'GET',
    buildPath: () => '/api/agent/sessions',
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  get_agent_session: {
    method: 'GET',
    buildPath: (args) => `/api/agent/sessions/${args.sessionId}`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  create_agent_session: {
    method: 'POST',
    buildPath: () => '/api/agent/sessions',
    transformRequest: (args) => ({ configId: args.configId, title: args.title }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  delete_agent_session: {
    method: 'DELETE',
    buildPath: (args) => `/api/agent/sessions/${args.sessionId}`,
  },

  import_agent_session: {
    method: 'POST',
    buildPath: () => '/api/agent/sessions/import',
    transformRequest: (args) => ({ session: args.session }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  start_agent_run: {
    method: 'POST',
    buildPath: () => '/api/agent/prompt',
    transformRequest: (args) => ({
      configId: args.configId,
      sessionId: args.sessionId,
      prompt: args.prompt,
    }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  agent_job_status: {
    method: 'GET',
    buildPath: (args) => `/api/agent/jobs/${args.jobId}`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  list_agent_jobs: {
    method: 'GET',
    buildPath: () => '/api/agent/jobs',
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  abort_agent_job: {
    method: 'POST',
    buildPath: (args) => `/api/agent/jobs/${args.jobId}/abort`,
    transformRequest: () => ({}),
  },

  approve_agent_job: {
    method: 'POST',
    buildPath: (args) => `/api/agent/jobs/${args.jobId}/approve`,
    transformRequest: (args) => ({ approved: args.approved, answer: args.answer, remember: args.remember ?? false }),
  },

  init_agent_run: {
    method: 'POST',
    buildPath: () => '/api/agent/init',
    transformRequest: (args) => ({ configId: args.configId }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  compact_agent_session: {
    method: 'POST',
    buildPath: (args) => `/api/agent/sessions/${args.sessionId}/compact`,
    transformRequest: (args) => ({ configId: args.configId }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  mcp_add_server: {
    method: 'POST',
    buildPath: (args) => `/api/agent/configs/${args.configId}/mcp`,
    transformRequest: (args) => ({ name: args.name, server: args.server }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  mcp_remove_server: {
    method: 'DELETE',
    buildPath: (args) => `/api/agent/configs/${args.configId}/mcp/${args.name}`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  mcp_list_tools: {
    method: 'GET',
    buildPath: (args) => `/api/agent/configs/${args.configId}/mcp/tools`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── Semantic memory (redb `agent_memories`) ──
  list_agent_memories: {
    method: 'GET',
    buildPath: (args) => {
      const q = args.configId ? `?configId=${encodeURIComponent(String(args.configId))}` : ''
      return `/api/agent/memories${q}`
    },
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  store_agent_memory: {
    method: 'POST',
    buildPath: () => '/api/agent/memories',
    transformRequest: (args) => ({ configId: args.configId, sessionId: args.sessionId, text: args.text }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  delete_agent_memory: {
    method: 'DELETE',
    buildPath: (args) => `/api/agent/memories/${args.memoryId}`,
  },

  recall_agent_memories: {
    method: 'POST',
    buildPath: () => '/api/agent/memories/recall',
    transformRequest: (args) => ({ configId: args.configId, query: args.query, topK: args.topK }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── Managed file text content (code editor) ──
  read_file_content: {
    method: 'GET',
    buildPath: (args) => `/api/files/${args.fileId}/content`,
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  write_file_content: {
    method: 'PUT',
    buildPath: (args) => `/api/files/${args.fileId}/content`,
    transformRequest: (args) => ({ content: args.content }),
    transformResponse: (raw) => transformResponseKeys(raw),
  },

  // ── OS layer — cybsh, task table, compute, merged volume ──
  os_exec: {
    method: 'POST',
    buildPath: () => '/api/os/exec',
    transformRequest: (args) => ({ line: args.line }),
  },
  os_complete: {
    method: 'GET',
    buildPath: (args) => `/api/os/complete/${encodeURIComponent(String(args.prefix ?? ''))}`,
  },
  os_stat: {
    method: 'GET',
    buildPath: (args) => `/api/os/stat?path=${encodeURIComponent(String(args.path ?? '/'))}`,
  },
  os_ls: {
    method: 'GET',
    buildPath: (args) => `/api/os/ls?path=${encodeURIComponent(String(args.path ?? '/'))}`,
  },
  os_du: {
    method: 'GET',
    buildPath: (args) => `/api/os/du?path=${encodeURIComponent(String(args.path ?? '/'))}`,
  },
  os_write: {
    method: 'PUT',
    buildPath: () => '/api/os/write',
    transformRequest: (args) => ({ path: args.path, content: args.content }),
  },
  os_df: { method: 'GET', buildPath: () => '/api/os/df' },
  os_ps: { method: 'GET', buildPath: () => '/api/os/ps' },
  os_top: { method: 'GET', buildPath: () => '/api/os/top' },
  os_workers: { method: 'GET', buildPath: () => '/api/os/workers' },
  os_jobs: { method: 'GET', buildPath: () => '/api/os/jobs' },

  // ── Disks & merged volume (AGENT-6 surface, disk manager) ─
  list_disks: { method: 'GET', buildPath: () => '/api/disk/list' },
  get_disk: { method: 'GET', buildPath: (args) => `/api/disk/${args.id}` },
  create_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/create',
    transformRequest: (args) => ({
      configId: args.configId,
      sizeBytes: args.sizeBytes,
      passphrase: args.passphrase ?? '',
    }),
  },
  attach_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/attach',
    transformRequest: (args) => ({ id: args.id, passphrase: args.passphrase ?? '' }),
  },
  detach_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/detach',
    transformRequest: (args) => ({ id: args.id }),
  },
  resize_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/resize',
    transformRequest: (args) => ({ id: args.id, sizeBytes: args.sizeBytes }),
  },
  destroy_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/destroy',
    transformRequest: (args) => ({ id: args.id }),
  },
  check_disk: {
    method: 'POST',
    buildPath: () => '/api/disk/check',
    transformRequest: (args) => ({ id: args.id }),
  },
  volume_df: { method: 'GET', buildPath: () => '/api/volume/df' },
}

// Commands that exist in Tauri but have NO REST equivalent yet
// (native dialogs, ONNX face models, local file system, desktop-only controls).
export const WRITE_ONLY_COMMANDS = new Set([
  // Face detection — ONNX runtime + model files stay desktop-only
  'detect_faces',
  'detect_faces_batch_cmd',
  'recluster_faces',
  'rename_face_group',
  'merge_face_groups',
  'delete_face_group',
  'find_similar_faces',
  // Local crypto / compression / parsing over on-disk file paths
  'generate_keypair',
  'encrypt_file',
  'decrypt_file',
  'compress_file',
  'decompress_file',
  'get_compression_stats',
  'parse_file',
  'get_symbols',
  'start_dashboard',
  'stop_dashboard',
  'revoke_file_permission',
  // Byte-level transfers that still need a dedicated REST upload endpoint
  'upload_file',
  'import_from_url',
])

/**
 * Commands served over HTTP in *every* transport. The OS layer has no Tauri
 * IPC twin — the desktop app runs the same web server on :3456 — so routing
 * these through `core.invoke` would fail on the very machine that has the
 * feature. Same for the disk/volume API.
 *
 * The whole sync domain is REST_FIRST too (P1-5): a job started over IPC is
 * invisible to the REST poller, so one side per domain — REST — with a
 * `core.invoke` fallback in the REST path when the dashboard is down.
 */
export const REST_FIRST = new Set([
  'os_exec', 'os_complete', 'os_stat', 'os_ls', 'os_du', 'os_df', 'os_ps',
  'os_top', 'os_workers', 'os_jobs', 'os_write',
  'list_disks', 'get_disk', 'create_disk', 'attach_disk', 'detach_disk',
  'resize_disk', 'destroy_disk', 'check_disk', 'volume_df',
  'list_sync_configs', 'create_sync_config', 'delete_sync_config',
  'start_sync', 'cancel_sync', 'get_sync_progress', 'test_sync_connection',
  'list_remote_files', 'get_sync_job', 'list_sync_runs', 'get_sync_status',
  'restore_sync_file', 'delete_remote_file', 'create_provider_repo',
  'seed_repo_files', 'upload_remote_file', 'get_sync_usage', 'oauth_start',
  'repair_status', 'repair_tasks', 'repair_health', 'repair_run',
  'repair_rebuild', 'repair_gc', 'scrub_run', 'scrub_runs',
  'lease_acquire', 'lease_release', 'lease_status',
  'parse_text', 'read_file_content', 'write_file_content',
  'list_agent_providers', 'list_agent_configs', 'save_agent_config',
  'delete_agent_config', 'save_agent_key', 'list_agent_models',
  'list_agent_sessions', 'get_agent_session', 'create_agent_session',
  'delete_agent_session', 'import_agent_session', 'start_agent_run',
  'agent_job_status', 'list_agent_jobs', 'abort_agent_job',
  'approve_agent_job', 'init_agent_run', 'compact_agent_session',
  'mcp_add_server', 'mcp_remove_server', 'mcp_list_tools',
])

// Commands the `cybermanju-os-wasm` crate serves on a static host.
const OS_WASM_COMMANDS = new Set([
  'os_exec', 'os_complete', 'os_stat', 'os_ls', 'os_du', 'os_df',
  'os_ps', 'os_top', 'os_workers', 'os_jobs', 'os_write',
])

/** Named frontend args → (dispatcher cmd, positional args) for the wasm backend. */
function wasmArgsForCommand(
  cmd: string,
  args: Record<string, unknown>
): { cmd: string; args: Record<string, unknown> } {
  switch (cmd) {
    case 'os_exec': return { cmd: 'exec', args: { line: args.line } }
    case 'os_complete': return { cmd: 'complete', args: { prefix: args.prefix } }
    case 'os_stat': return { cmd: 'stat', args: { path: args.path } }
    case 'os_ls': return { cmd: 'ls', args: { path: args.path } }
    case 'os_du': return { cmd: 'du', args: { path: args.path } }
    case 'os_df': return { cmd: 'df', args: {} }
    case 'os_ps': return { cmd: 'ps', args: {} }
    case 'os_top': return { cmd: 'top', args: {} }
    case 'os_workers': return { cmd: 'workers', args: {} }
    case 'os_jobs': return { cmd: 'jobs', args: {} }
    case 'os_write': return { cmd: 'write', args: { path: args.path, content: args.content } }
    default: return { cmd: cmd.replace(/^os_/, ''), args }
  }
}

interface DbWasmRoute {
  op: string
  args: (a: Record<string, unknown>) => Record<string, unknown>
  /** May be async — routes that need a second lookup (e.g. the file node). */
  map?: (raw: unknown, a: Record<string, unknown>) => unknown | Promise<unknown>
  probe?: boolean
}

// Invoke command → demo-database op. The worker stores the same table names
// and JSON row shapes as the server, so responses already match the
// TypeScript types (plus the usual snake_case→camelCase pass).
const DB_WASM_ROUTES: Record<string, DbWasmRoute> = {
  list_accounts: { op: 'accounts.list', args: () => ({}) },
  create_account: {
    op: 'accounts.create',
    args: (a) => ({ name: a.name, accountType: a.accountType, path: a.path, color: a.color }),
  },
  switch_account: { op: 'accounts.switch', args: (a) => ({ accountId: a.accountId }) },
  delete_account: { op: 'accounts.delete', args: (a) => ({ accountId: a.accountId }) },
  list_sync_configs: { op: 'sync.list', args: () => ({}) },
  create_sync_config: { op: 'sync.save', args: (a) => ({ config: a.config }) },
  delete_sync_config: { op: 'sync.delete', args: (a) => ({ configId: a.configId }) },
  test_sync_connection: { op: '', args: () => ({}), probe: true },
  list_users: { op: 'users.list', args: () => ({}) },
  register_user: {
    op: 'users.register',
    args: (a) => ({ username: a.username, password: a.password, displayName: a.displayName, role: a.role }),
  },
  authenticate_user: {
    op: 'users.authenticate',
    args: (a) => ({ username: a.username, password: a.password }),
  },
  delete_user: { op: 'users.delete', args: (a) => ({ userId: a.userId }) },
  update_user_role: { op: 'users.set_role', args: (a) => ({ userId: a.userId, role: a.role }) },
  list_disks: { op: 'disks.list', args: () => ({}) },
  create_disk: {
    op: 'disks.create',
    args: (a) => ({ configId: a.configId, sizeBytes: a.sizeBytes, passphrase: a.passphrase ?? '' }),
  },
  attach_disk: { op: 'disks.attach', args: (a) => ({ id: a.id ?? a.diskId }) },
  detach_disk: { op: 'disks.detach', args: (a) => ({ id: a.id ?? a.diskId }) },
  resize_disk: { op: 'disks.resize', args: (a) => ({ id: a.id ?? a.diskId, sizeBytes: a.sizeBytes }) },
  check_disk: { op: 'disks.check', args: (a) => ({ id: a.id ?? a.diskId }) },
  list_files: {
    op: 'files.list',
    args: () => ({}),
    map: (raw, a) => {
      // Same parentPath filtering as the REST route.
      let files = raw as FileNode[]
      const parentPath = a.parentPath as string | undefined
      if (parentPath) {
        files = files.filter(f => {
          if (f.parentId) return f.parentId === parentPath
          if (f.path) {
            const prefix = parentPath === '/' ? '/' : `${parentPath}/`
            return f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/')
          }
          return false
        })
      }
      return files
    },
  },
  get_file: { op: 'files.get', args: (a) => ({ fileId: a.fileId }) },
  create_folder: { op: 'files.create_folder', args: (a) => ({ name: a.name, parentId: a.parentId }) },
  rename_file: { op: 'files.rename', args: (a) => ({ fileId: a.fileId, newName: a.newName }) },
  delete_file: { op: 'files.delete', args: (a) => ({ fileId: a.fileId }) },
  set_file_tags: {
    op: 'files.patch',
    args: (a) => ({ fileId: a.fileId, patch: { tags: a.tags ?? [] } }),
  },
  // ── Managed text content — body in kv (`content:<fileId>`), node in files.
  // Uploads land base64 with `encoding:<fileId>` = "base64"; the read route
  // decodes so the editor always sees text.
  read_file_content: {
    op: 'kv.get',
    args: (a) => ({ key: `content:${a.fileId}` }),
    map: async (raw, a) => {
      const fileId = String(a.fileId ?? '')
      const row = raw as { value?: unknown } | null
      const body = row && typeof row === 'object' && typeof row.value === 'string' ? row.value : ''
      // The stored body may be base64 (upload), compressed, encrypted, or all
      // three — `readContentText` unwinds whatever the file's pipeline says.
      const content = await readContentText(fileId, body)
      const node = (await wasmDbDispatch('files.get', { fileId }).catch(() => null)) as {
        name?: string
        hashBlake3?: string | null
      } | null
      return {
        fileId,
        name: String(node?.name ?? a.name ?? a.fileName ?? ''),
        content,
        sizeBytes: content.length,
        truncated: false,
        hashBlake3: node?.hashBlake3 ?? null,
      }
    },
  },
}

/** Bytes in any shape the dialog hands us → `Uint8Array`. */
function coerceBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return Uint8Array.from(data as number[])
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return new Uint8Array()
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript',
  ts: 'text/typescript', py: 'text/x-python', rs: 'text/x-rust',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Commands with no REST twin that the *browser* can serve itself. Each one
 * is real work done against the worker database (or wasm), never a stub —
 * everything the desktop app does over IPC, the static build does here.
 */
type StaticHandler = (args: Record<string, unknown>) => Promise<unknown>

interface StaticLooseGroup {
  id: string
  name: string
  color: string
  fileIds: string[]
  createdAt: string
}

const LOOSE_INDEX_KEY = 'loose:index'
const looseKey = (id: string) => `loose:${id}`

async function readStaticLooseGroups(): Promise<StaticLooseGroup[]> {
  const idx = (await wasmDbDispatch('kv.get', { key: LOOSE_INDEX_KEY }).catch(() => null)) as {
    value?: unknown
  } | null
  let ids: string[] = []
  if (typeof idx?.value === 'string') {
    try {
      const parsed: unknown = JSON.parse(idx.value)
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string')
    } catch { ids = [] }
  }
  const groups: StaticLooseGroup[] = []
  for (const id of ids) {
    const row = (await wasmDbDispatch('kv.get', { key: looseKey(id) }).catch(() => null)) as {
      value?: unknown
    } | null
    if (typeof row?.value !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(row.value)
      const g = parsed as Partial<StaticLooseGroup>
      if (typeof g?.id === 'string' && typeof g?.name === 'string') {
        groups.push({
          id: g.id,
          name: g.name,
          color: typeof g.color === 'string' ? g.color : '#FFFFFF',
          fileIds: Array.isArray(g.fileIds) ? g.fileIds.filter((v): v is string => typeof v === 'string') : [],
          createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
        })
      }
    } catch { /* skip corrupt rows */ }
  }
  return groups
}

async function writeStaticLooseGroups(groups: StaticLooseGroup[]): Promise<void> {
  for (const g of groups) {
    await wasmDbDispatch('kv.set', { key: looseKey(g.id), value: JSON.stringify(g) })
  }
  await wasmDbDispatch('kv.set', { key: LOOSE_INDEX_KEY, value: JSON.stringify(groups.map((g) => g.id)) })
}

// ── Static-host cybsh deps (real browser implementations) ─────────────
// The terminal's vault-aware verbs (`quota`, `providers`, `oauth`, `disk`,
// `sync status`, `encrypt`, `compress`, cross-mount `cp`/`mv`/`rm`/`mkdir`)
// run in `src/utils/staticCybsh.ts` against these: the local-pc vault
// (`.cybermanju` file + kv secrets), the shell volume, and live CORS-OK
// provider probes. Provider push still needs the dashboard.

const STATIC_VOLUME_KEY = 'cybermanju.os.volume'

function readStaticVolume(): Record<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STATIC_VOLUME_KEY) : null
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {
    // Missing or corrupt — treated as an empty volume.
  }
  return {}
}

function writeStaticVolume(volume: Record<string, string>): void {
  try {
    localStorage.setItem(STATIC_VOLUME_KEY, JSON.stringify(volume))
  } catch {
    throw new Error('disk_full: browser storage refused the write — attach the .cybermanju file or free site data')
  }
  notifyOsDispatch()
}

async function staticFetchAdapter(
  url: string,
  init?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  const res = await fetch(url, init as RequestInit)
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> }
}

interface WasmCryptoExports {
  chacha20_generate_key(): Uint8Array
  chacha20_generate_nonce(): Uint8Array
  chacha20_encrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array
  chacha20_decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array
  compress_lz4(data: Uint8Array): Uint8Array
  decompress_lz4(data: Uint8Array): Uint8Array
  compress_brotli(data: Uint8Array, quality: number): Uint8Array
  decompress_brotli(data: Uint8Array): Uint8Array
  blake3_hash(data: Uint8Array): string
}

async function staticCryptoExports(): Promise<WasmCryptoExports | null> {
  try {
    const mod = await wasmModuleExports<Partial<WasmCryptoExports>>()
    if (
      typeof mod.chacha20_encrypt !== 'function' ||
      typeof mod.compress_lz4 !== 'function' ||
      typeof mod.blake3_hash !== 'function'
    ) {
      return null
    }
    return mod as WasmCryptoExports
  } catch {
    return null
  }
}

const STATIC_CYBSH_DEPS: StaticCybshDeps = {
  readVolume: readStaticVolume,
  getCwd: async () => {
    try {
      const raw = (await wasmOsDispatch('pwd', {})) as { output?: unknown } | null
      if (raw && typeof raw.output === 'string' && raw.output.startsWith('/')) return raw.output
    } catch {
      // Stale bundle or missing export — root is the honest fallback.
    }
    return '/'
  },
  writeVolumeFile: async (path, content) => {
    try {
      const raw = (await wasmOsDispatch('write', { path, content })) as {
        ok?: boolean
        output?: unknown
      } | null
      if (raw && typeof raw === 'object' && raw.ok === false) {
        throw new Error(String(raw.output ?? 'write failed'))
      }
      return
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (!/unknown command|wasm backend unavailable/i.test(detail)) throw e
      // Stale pkg without the `write` arm — write the volume directly and
      // nudge the mirror so `volume:*` kv rows still follow.
      const volume = readStaticVolume()
      volume[path] = content
      writeStaticVolume(volume)
    }
  },
  deleteVolumePath: async (path, recursive) => {
    const volume = readStaticVolume()
    const prefix = path === '/' ? '/' : `${path}/`
    const keys = Object.keys(volume).filter((k) => k === path || k.startsWith(prefix))
    if (!recursive && keys.some((k) => k !== path)) {
      throw new Error(`is a directory: ${path} (use -r)`)
    }
    const freed = keys.reduce((n, k) => n + (volume[k]?.length ?? 0), 0)
    try {
      const raw = (await wasmOsDispatch('rm', {
        recursive,
        paths: [path],
      })) as { ok?: boolean; output?: unknown } | null
      if (raw && typeof raw === 'object' && raw.ok === false) {
        throw new Error(String(raw.output ?? 'rm failed'))
      }
      return freed
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (!/unknown command|wasm backend unavailable/i.test(detail)) throw e
      for (const k of keys) delete volume[k]
      writeStaticVolume(volume)
      return freed
    }
  },
  killTask: async (id) => {
    const raw = (await wasmOsDispatch('kill', { id })) as {
      ok?: boolean
      output?: unknown
    } | null
    if (raw && typeof raw === 'object') {
      if (raw.ok) return true
      const out = String(raw.output ?? '')
      if (/no task|not_found/.test(out)) return false
      throw new Error(out || 'kill failed')
    }
    throw new Error('wasm backend unavailable')
  },
  listSyncConfigs: async () => {
    const raw = (await wasmDbDispatch('sync.list', {}).catch(() => [])) as Array<
      Record<string, unknown>
    >
    if (!Array.isArray(raw)) return []
    const out: StaticSyncConfig[] = []
    for (const row of raw) {
      if (row && typeof row === 'object') {
        const cfg = staticConfigFromRow(row)
        if (cfg) out.push(cfg)
      }
    }
    return out
  },
  getConfigSecret: async (configId) => {
    try {
      const raw = await wasmDbDispatch('sync.secret', { configId })
      if (typeof raw === 'string') return raw
      if (raw && typeof raw === 'object') {
        const token = (raw as Record<string, unknown>).token
        if (typeof token === 'string') return token
      }
    } catch {
      // No secret table in this bundle — unsigned.
    }
    return ''
  },
  getDiskStatus: async () => {
    const s = await wasmDiskStatus()
    return { attached: s.attached, name: s.name, savedBytes: s.savedBytes, dirty: s.dirty }
  },
  getStorageEstimate: async () => {
    try {
      const est = await navigator.storage?.estimate()
      if (!est) return null
      return { usage: est.usage, quota: est.quota }
    } catch {
      return null
    }
  },
  listMounts: async () => {
    const canal = await import('./useProviderCanal')
    const mounts = await canal.listVfsMounts()
    return mounts.map((m) => ({ id: m.id, name: m.name, backendType: m.backendType, configId: m.configId }))
  },
  providerRead: async (mountId, remotePath) => {
    const canal = await import('./useProviderCanal')
    const file = await canal.readVfsFile(mountId, remotePath)
    return file.bytes
  },
  providerWrite: async (mountId, remotePath, data) => {
    const canal = await import('./useProviderCanal')
    await canal.writeVfsFile(mountId, remotePath, data)
  },
  providerDelete: async (mountId, remotePath) => {
    const canal = await import('./useProviderCanal')
    await canal.deleteVfsFile(mountId, remotePath)
  },
  providerList: async (mountId, remotePath) => {
    const canal = await import('./useProviderCanal')
    const entries = await canal.listVfsDir(mountId, remotePath)
    return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, sizeBytes: e.sizeBytes ?? 0 }))
  },
  probeProviderQuota: (cfg, token) => probeProviderQuotaViaFetch(cfg, token, staticFetchAdapter),
  keyGet: (name) => vaultGet(name),
  keySet: (name, value) => vaultSet(name, value),
  chacha: async (): Promise<StaticChacha | null> => {
    const mod = await staticCryptoExports()
    if (!mod) return null
    return {
      genKey: () => mod.chacha20_generate_key(),
      genNonce: () => mod.chacha20_generate_nonce(),
      encrypt: (k, n, p) => mod.chacha20_encrypt(k, n, p),
      decrypt: (k, n, c) => mod.chacha20_decrypt(k, n, c),
    }
  },
  codecs: async (): Promise<StaticCodecs | null> => {
    const mod = await staticCryptoExports()
    if (!mod) return null
    return {
      compressLz4: (d) => mod.compress_lz4(d),
      decompressLz4: (d) => mod.decompress_lz4(d),
      compressBrotli: (d) => mod.compress_brotli(d, 11),
      decompressBrotli: (d) => mod.decompress_brotli(d),
    }
  },
  blake3: async (data) => {
    try {
      const mod = await staticCryptoExports()
      if (!mod) return null
      return mod.blake3_hash(new TextEncoder().encode(data))
    } catch {
      return null
    }
  },
}

const STATIC_COMMAND_HANDLERS: Record<string, StaticHandler> = {
  // Byte upload → base64 body in kv + `encoding:<id>` marker (binary files
  // are re-decoded on read so the editor still gets text out of them).
  upload_file: async (args) => {
    const fileName = String(args.fileName ?? '').trim()
    if (!fileName) throw new Error('invalid: fileName is required')
    const bytes = coerceBytes(args.fileData)
    const node = (await wasmDbDispatch('files.create', {
      name: fileName,
      fileType: 'file',
      parentId: args.parentPath ?? null,
      content: bytesToBase64(bytes),
      sizeBytes: bytes.length,
      mimeType: guessMime(fileName),
    })) as { id?: string } | null
    const id = node?.id
    if (!id) throw new Error('upload failed: the database did not create a file node')
    await wasmDbDispatch('kv.set', { key: `encoding:${id}`, value: 'base64' })
    return node
  },

  // Save from the editor: runs the file's compress/encrypt pipeline, then
  // reports the node as it now stands.
  write_file_content: async (args) => {
    const fileId = String(args.fileId ?? '')
    if (!fileId) throw new Error('invalid: fileId is required')
    await writeContentText(fileId, String(args.content ?? ''))
    const node = (await wasmDbDispatch('files.get', { fileId }).catch(() => null)) as {
      name?: string
      sizeBytes?: number
      hashBlake3?: string | null
      modifiedAt?: string
    } | null
    return {
      fileId,
      name: String(node?.name ?? ''),
      sizeBytes: Number(node?.sizeBytes ?? 0),
      hashBlake3: node?.hashBlake3 ?? null,
      modifiedAt: String(node?.modifiedAt ?? new Date().toISOString()),
    }
  },

  // ── Encryption (wasm ciphers, keys inside the vault) ──
  get_encryption_status: async (args) => getEncryptionStatus(args.fileId ? String(args.fileId) : undefined),
  list_keys: async () => listKeys(),
  generate_keypair: async (args) => generateKeyPair(String(args.algorithm ?? '') as EncryptionAlgo),
  encrypt_file: async (args) => {
    await encryptFile(String(args.fileId ?? ''), String(args.algorithm ?? '') as EncryptionAlgo)
    return { ok: true }
  },
  decrypt_file: async (args) => {
    await decryptFile(String(args.fileId ?? ''))
    return { ok: true }
  },

  // ── Compression (lz4 + brotli in wasm; zstd stays desktop-only) ──
  compress_file: async (args) =>
    compressFile(String(args.fileId ?? ''), String(args.layer ?? 'lz4')),
  decompress_file: async (args) => decompressFile(String(args.fileId ?? '')),

  // ── Loose groups (kv-backed mirror of the desktop loose-groups table) ──
  // The wasm crate ships no loose-group table, so the static build keeps
  // the same JSON row shape under `loose:<id>` keys with an index at
  // `loose:index`. Rows ride inside the `.cybermanju` container next to
  // third-party provider configs, and the store calls the same command
  // names on every transport.
  list_loose_groups: async () => readStaticLooseGroups(),
  create_loose_group: async (args) => {
    const name = String(args.name ?? '').trim()
    if (!name) throw new Error('invalid: group name is required')
    const now = new Date().toISOString()
    const group = {
      id: `loose-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      color: String(args.color ?? '#FFFFFF'),
      fileIds: [] as string[],
      createdAt: now,
    }
    const groups = await readStaticLooseGroups()
    groups.push(group)
    await writeStaticLooseGroups(groups)
    return group
  },
  add_to_loose_group: async (args) => {
    const groupId = String(args.groupId ?? '')
    const fileId = String(args.fileId ?? '')
    if (!groupId) throw new Error('invalid: groupId is required')
    if (!fileId) throw new Error('invalid: fileId is required')
    const groups = await readStaticLooseGroups()
    const group = groups.find((g) => g.id === groupId)
    if (!group) throw new Error(`not_found: loose group ${groupId}`)
    if (!group.fileIds.includes(fileId)) group.fileIds.push(fileId)
    await writeStaticLooseGroups(groups)
    return group
  },

  // ── Provider quota (vault token + live CORS-OK probe, no dashboard) ──
  // The Sync panel's quota button works on Pages too: same endpoints as
  // `crates/sync/src/quota.rs`, token sealed in the local vault.
  get_sync_usage: async (args) => {
    const configId = String(args.configId ?? '')
    if (!configId) throw new Error('invalid: configId is required')
    const all = (await wasmDbDispatch('sync.list', {}).catch(() => [])) as Array<
      Record<string, unknown>
    >
    const row = (Array.isArray(all) ? all : []).find((c) => String(c?.id) === configId)
    if (!row) throw new Error(`not_found: sync config ${configId}`)
    const cfg = staticConfigFromRow(row)
    if (!cfg) throw new Error(`not_found: sync config ${configId}`)
    let secret = ''
    try {
      const s = await wasmDbDispatch('sync.secret', { configId }).catch(() => null)
      if (typeof s === 'string') secret = s
      else if (s && typeof (s as Record<string, unknown>).token === 'string') {
        secret = (s as Record<string, unknown>).token as string
      }
    } catch {
      secret = ''
    }
    const probe = await probeProviderQuotaViaFetch(cfg, secret, staticFetchAdapter)
    if (!probe.ok) throw new Error(probe.error ?? 'quota probe failed')
    return {
      backendType: cfg.backendType,
      totalBytes: probe.totalBytes ?? null,
      usedBytes: probe.usedBytes ?? null,
      remainingRequests: probe.remainingRequests ?? null,
      requestLimit: probe.requestLimit ?? null,
      resetAt: probe.resetAt ?? null,
      detail: probe.detail,
    }
  },

  // ── Static-host reads with honest local answers (no dashboard) ──
  // These panels polled their REST twins on every boot and each miss logged
  // a `[WASM parity gap]` error. None of them needs the network:
  // collections/faces/trash/audit/sync-runs have no rows in a fresh static
  // vault (wasm deletes are hard-deletes; faces need the ONNX model which
  // honestly returns empty everywhere), sync status is idle without a sync
  // engine, and geo filters the local file nodes that already carry
  // gpsLat/gpsLon. Empty states render; write ops on these domains keep
  // their accurate "needs the dashboard" refusal until they get local
  // handlers too.
  list_collections: async () => [],
  get_collection_items: async () => [],
  list_face_groups: async () => [],
  get_geo_files: async () => {
    const raw = (await wasmDbDispatch('files.list', {}).catch(() => [])) as Array<
      Record<string, unknown>
    >
    const nodes = Array.isArray(raw) ? raw : []
    return nodes
      .filter((f) => typeof f?.gpsLat === 'number' && typeof f?.gpsLon === 'number')
      .map((f) => ({
        id: String(f.id ?? ''),
        name: String(f.name ?? ''),
        gpsLat: f.gpsLat as number,
        gpsLon: f.gpsLon as number,
      }))
  },
  list_sync_runs: async () => [],
  get_sync_status: async () => ({
    syncEnabled: false, status: 'idle', lastSync: null, provider: null,
  }),
  list_trash: async () => [],
  get_audit_log: async () => [],

  // ── Dashboard (no server behind a static host) ──
  // Pages/WASM has no `:3456` web server, so `dashboard_status` used to
  // throw `needs the CyberManju dashboard` on every boot/poll while the
  // templates read `dashboardStatus.running` — one shapeless assignment
  // away from `Cannot read properties of undefined (reading 'running')`.
  // Answer locally with the same row shape instead: offline, never throws.
  dashboard_status: async () => ({
    running: false, port: 3456, url: 'http://localhost:3456', activeConnections: 0,
  }),
  start_dashboard: async () => ({
    running: false, port: 3456, url: 'http://localhost:3456', activeConnections: 0,
  }),
  stop_dashboard: async () => ({ ok: true }),
}

/**
 * Connectivity probe for the static build: the worker holds credentials,
 * but the network call itself runs here (Workers *can* fetch — this just
 * keeps tokens next to the form that pasted them). Returns `true`/`false`
 * on HTTP answers; THROWS on transport failure (offline, CORS-blocked,
 * timeout) so the UI can tell "unreachable" apart from "wrong token".
 */
async function probeStaticConnection(args: Record<string, unknown>): Promise<boolean> {
  const cfg = (args.config ?? {}) as Record<string, unknown>
  const configId = typeof cfg.id === 'string' ? cfg.id : ''
  let token = typeof cfg.token === 'string' ? cfg.token : ''
  // The token never rides on the stored row: `sync.save` seals it into
  // `sync.secret` and strips it (mirroring the server's `skip_serializing`),
  // so a probe built from a re-fetched row + an empty draft carries no
  // token. Fall back to the sealed secret before calling the token absent —
  // otherwise every Test after an OAuth connect reports "provider answered
  // false" even though the OAuth token is saved and valid.
  if (!token && configId) {
    try {
      const s = await wasmDbDispatch('sync.secret', { configId }).catch(() => null)
      if (typeof s === 'string' && s) token = s
    } catch {
      // No sealed secret — the auth error below names the fix.
    }
  }
  const backend = String(cfg.backendType ?? '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  const blocked = (who: string): Error =>
    new Error(
      `network: ${who} is not reachable from this browser (offline, or the provider sends no CORS headers) — the token is still saved locally; live sync needs the desktop app, Docker image or dashboard server`
    )
  const needToken = (): Error =>
    new Error(
      `auth: ${configId || backend || 'provider'} has no token — paste a PAT on its provider card or connect OAuth, then retry`
    )
  try {
    switch (backend) {
      case 'local':
        return true
      case 'github': {
        if (!token) throw needToken()
        let res: Response
        try {
          res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
            signal: ctrl.signal,
          })
        } catch {
          throw blocked('api.github.com')
        }
        if (res.ok) return true
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `auth: GitHub rejected the token (HTTP ${res.status}) — the OAuth grant may lack the 'repo' scope or the PAT expired; reconnect OAuth or paste a PAT with repo scope, then retry`
          )
        }
        throw new Error(`network: GitHub connection test failed (HTTP ${res.status})`)
      }
      case 'gitlab': {
        if (!token) throw needToken()
        const project = String(cfg.repoName ?? '')
        const base = typeof cfg.basePath === 'string' && /^https?:\/\//.test(cfg.basePath)
          ? cfg.basePath.replace(/\/+$/, '')
          : 'https://gitlab.com'
        // No project set yet (fresh OAuth connect before the repo step):
        // verify the TOKEN against /user instead of failing the valid
        // OAuth grant as "provider answered false".
        if (!project) {
          let res: Response
          try {
            res = await fetch(`${base}/api/v4/user`, {
              headers: { 'PRIVATE-TOKEN': token },
              signal: ctrl.signal,
            })
          } catch {
            throw blocked(base)
          }
          if (res.ok) return true
          if (res.status === 401 || res.status === 403) {
            throw new Error(
              `auth: GitLab rejected the token (HTTP ${res.status}) — the OAuth grant may lack the 'api' scope; reconnect OAuth or paste a PAT with api scope, then retry`
            )
          }
          throw new Error(`network: GitLab connection test failed (HTTP ${res.status})`)
        }
        let res: Response
        try {
          res = await fetch(
            `${base}/api/v4/projects/${encodeURIComponent(project)}`,
            { headers: { 'PRIVATE-TOKEN': token }, signal: ctrl.signal },
          )
        } catch {
          throw blocked(base)
        }
        if (res.ok) return true
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `auth: GitLab rejected the token (HTTP ${res.status}) — reconnect OAuth (api scope) or paste a PAT with api scope, then retry`
          )
        }
        throw new Error(`network: GitLab connection test failed (HTTP ${res.status})`)
      }
      case 'googleDrive': {
        if (!token) throw needToken()
        let res: Response
        try {
          res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          })
        } catch {
          throw blocked('www.googleapis.com')
        }
        if (res.ok) return true
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `auth: Google rejected the token (HTTP ${res.status}) — sessions minted before the 'drive.file' scope grant cannot touch Drive; sign out + sign in again (or reconnect OAuth on the card), then retry`
          )
        }
        throw new Error(`network: Google Drive connection test failed (HTTP ${res.status})`)
      }
      default:
        throw new Error(
          `unsupported: sync backend "${backend || '(none)'}" cannot be probed from this browser — probing supports local/github/gitlab/googleDrive only`
        )
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The core invoke — works in both Tauri and Web modes. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // ── Provider VFS (CONTROL Phase 5.6): served by the TS canal
  // orchestration on EVERY transport — mounts + cache live in kv (inside
  // the `.cybermanju` container on static hosts); reads go through the Rust
  // canal and writes through `upload_remote_file`/direct fetch, so neither
  // hits the "needs the dashboard" refusal.
  if (cmd === 'vfs_list_mounts' || cmd === 'vfs_save_mount' || cmd === 'vfs_delete_mount' ||
    cmd === 'vfs_list_dir' || cmd === 'vfs_read_file' ||
    cmd === 'vfs_write_file' || cmd === 'vfs_delete_file') {
    const canal = await import('./useProviderCanal')
    switch (cmd) {
      case 'vfs_list_mounts':
        return (await canal.listVfsMounts()) as T
      case 'vfs_save_mount':
        return (await canal.saveVfsMount({
          id: args?.id as string | undefined,
          configId: String(args?.configId ?? ''),
          name: String(args?.name ?? args?.configId ?? ''),
          backendType: String(args?.backendType ?? 'github'),
          basePath: String(args?.basePath ?? ''),
        })) as T
      case 'vfs_delete_mount':
        await canal.deleteVfsMount(String(args?.id ?? args?.mountId ?? ''))
        return { ok: true } as T
      case 'vfs_list_dir':
        return (await canal.listVfsDir(
          String(args?.mountId ?? args?.id ?? ''),
          String(args?.remotePath ?? args?.path ?? ''),
        )) as T
      case 'vfs_read_file':
        return (await canal.readVfsFile(
          String(args?.mountId ?? args?.id ?? ''),
          String(args?.remotePath ?? args?.path ?? ''),
          {
            locator: args?.locator as string | undefined,
            passphrase: args?.passphrase as string | undefined,
          },
        )) as T
      case 'vfs_write_file': {
        const raw = args?.data ?? args?.bytes ?? args?.content ?? ''
        const data = typeof raw === 'string'
          ? raw as string
          : new Uint8Array(raw as ArrayLike<number>)
        return (await canal.writeVfsFile(
          String(args?.mountId ?? args?.id ?? ''),
          String(args?.remotePath ?? args?.path ?? ''),
          data,
          { locator: args?.locator as string | undefined },
        )) as T
      }
      case 'vfs_delete_file':
        await canal.deleteVfsFile(
          String(args?.mountId ?? args?.id ?? ''),
          String(args?.remotePath ?? args?.path ?? ''),
          { locator: args?.locator as string | undefined },
        )
        return { ok: true } as T
    }
  }
  // ── Static-host vault repo provisioning: direct provider fetch (CORS-OK),
  // no dashboard behind the page. Desktop/Docker fall through to Tauri/REST.
  if (isStaticHost() && (cmd === 'create_provider_repo' || cmd === 'seed_repo_files')) {
    const prov = await import('@/utils/gitProvision')
    if (cmd === 'create_provider_repo') {
      const backendType = String(args?.backendType ?? 'github').toLowerCase()
      if (backendType !== 'github' && backendType !== 'gitlab') {
        throw new Error(`unsupported: repo creation is not supported for '${args?.backendType}' (github + gitlab only)`)
      }
      return (await prov.createRepoDirect({
        backendType: backendType as 'github' | 'gitlab',
        token: String(args?.token ?? ''),
        name: String(args?.name ?? ''),
        privateRepo: args?.private !== false,
        description: typeof args?.description === 'string' ? args.description : undefined,
        branch: typeof args?.branch === 'string' ? args.branch : undefined,
        instanceUrl: typeof args?.basePath === 'string' ? args.basePath : undefined,
      })) as T
    }
    // seed_repo_files on a static host: push each file straight at the
    // provider Contents/files API (same layout the Rust seeder writes).
    const cfg = (args?.config ?? {}) as Record<string, unknown>
    const backendType = String(cfg.backendType ?? 'github').toLowerCase()
    const files = (args?.files ?? []) as Array<{ path: string; contentBase64: string }>
    const repoName = String(cfg.repoName ?? '')
    const branch = String(cfg.branch ?? 'main')
    if (backendType !== 'github' && backendType !== 'gitlab') {
      throw new Error(`unsupported: repo seed is not supported for '${cfg.backendType}'`)
    }
    const token = String(cfg.token ?? '')
    if (!token) throw new Error('auth: repo seed needs a token — paste it on the provider card first')
    if (!repoName) throw new Error('unsupported: provider has no repo yet — create the private repo first')
    const repo = {
      backend: backendType,
      repoName,
      fullName: backendType === 'github' ? repoName : repoName,
      branch,
      url: '',
      projectId: backendType === 'gitlab' ? repoName : null,
    }
    // GitLab fullName for URL building: fall back to the id when the
    // human path is unknown (the files API only needs the id).
    return (await prov.seedRepoDirect(
      backendType as 'github' | 'gitlab',
      repo,
      token,
      files,
      typeof cfg.basePath === 'string' ? cfg.basePath : undefined,
    )) as T
  }
  const mapping = REST_ROUTES[cmd]
  if (isTauri() && !REST_FIRST.has(cmd)) {
    // ── Tauri IPC path ────────────────────────────────────
    const core = await import('@tauri-apps/api/core')
    return core.invoke<T>(cmd, args)
  }

  // ── Static host (GitHub Pages / WASM pack) path ─────────
  // No dashboard exists behind the page. The OS layer goes to the wasm
  // crate, and the database-backed commands below go to the redb database
  // running in the DB worker (real cybermanju.db in OPFS). Anything else
  // refuses fast with one clear error instead of ERR_CONNECTION_REFUSED.
  if (isStaticHost() && (OS_WASM_COMMANDS.has(cmd) || mapping || STATIC_COMMAND_HANDLERS[cmd])) {
    if (OS_WASM_COMMANDS.has(cmd)) {
      // Vault-aware cybsh verbs (`quota`, `providers`, `oauth`, `disk`,
      // `sync`, `encrypt`, cross-mount `cp`/`mv`/`rm`/`mkdir`, …) answer
      // from the local vault + live provider probes before the wasm volume
      // dispatcher ever sees the line. Chained lines and unknown verbs
      // return `null` and fall through to the Rust shell as before.
      if (cmd === 'os_exec') {
        try {
          const handled = await runStaticCybshLine(String(args?.line ?? ''), STATIC_CYBSH_DEPS)
          if (handled) return handled as T
        } catch {
          // Interceptor failure — the wasm dispatcher stays the fallback.
        }
      }
      const wasmArgs = wasmArgsForCommand(cmd, args ?? {})
      const raw = await wasmOsDispatch(wasmArgs.cmd, wasmArgs.args)
      // The wasm dispatcher ALWAYS envelopes: `{"ok":bool,"output":"<inner>"}`
      // (see crates/os-wasm/src/os.rs `ok`/`err`). `os_exec` IS that envelope
      // (ShellResult), but the structured commands (ps/top/workers/jobs/df/…)
      // carry the REST payload JSON-encoded INSIDE `output`. Returning the
      // envelope as-is used to put `{ok, output}` into `store.osPs`, so
      // `store.osPs?.counts` was undefined and StatusBar's
      // `counts.running` threw `Cannot read properties of undefined`
      // every 4s poll. Unwrap the inner JSON for those commands.
      if (cmd === 'os_exec' || cmd === 'os_complete' || cmd === 'os_write') {
        return raw as T
      }
      if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).output === 'string') {
        const inner = (raw as Record<string, unknown>).output as string
        try {
          return transformResponseKeys(JSON.parse(inner)) as T
        } catch {
          return raw as T
        }
      }
      return transformResponseKeys(raw) as T
    }
    if (cmd === 'search_files') {
      const hits = await wasmSearchFiles(String(args?.query ?? ''))
      return hits.map(h => ({
        fileId: h.path,
        fileName: h.path.split('/').pop() ?? h.path,
        score: h.score,
        snippet: '',
      })) as unknown as T
    }
    // Paginated search answers from the same BM25-lite volume index, sliced
    // server-side-style so the store never throws `[WASM Mode]` here and
    // silently downgrades to the unpaginated shape (P1-8).
    if (cmd === 'search_files_paginated') {
      const hits = await wasmSearchFiles(String(args?.query ?? ''))
      const limit = Math.max(1, Number(args?.limit ?? 20) || 20)
      const offset = Math.max(0, Number(args?.offset ?? 0) || 0)
      const page = hits.slice(offset, offset + limit)
      return {
        results: page.map(h => ({
          fileId: h.path,
          fileName: h.path.split('/').pop() ?? h.path,
          score: h.score,
          snippet: '',
        })),
        total: hits.length,
      } as unknown as T
    }
    const dbRoute = DB_WASM_ROUTES[cmd]
    if (dbRoute) {
      if (dbRoute.probe) return (await probeStaticConnection(args ?? {})) as T
      const raw = await wasmDbDispatch(dbRoute.op, dbRoute.args(args ?? {}))
      const out = dbRoute.map ? await dbRoute.map(raw, args ?? {}) : raw
      return transformResponseKeys(out) as T
    }
    const handler = STATIC_COMMAND_HANDLERS[cmd]
    if (handler) return (await handler(args ?? {})) as T
    // Anything else (provider network sync, encryption, faces, …) still
    // needs the server — one clear error, no fetch spam.
    throw new Error(
      `[WASM Mode] "${cmd}" needs the CyberManju dashboard (REST API on port 3456). ` +
      'This static build runs the browser sandbox — accounts, files, providers and disks work offline, but provider network sync requires the desktop app, Docker image or dashboard server.'
    )
  }

  // ── Web / REST path ────────────────────────────────────
  if (mapping) {
    const path = mapping.buildPath(args ?? {})

    // Allow the mapping to transform the request body
    let body: unknown = undefined
    if (mapping.transformRequest && args) {
      body = mapping.transformRequest(args)
    } else if (mapping.method !== 'GET' && mapping.method !== 'HEAD' && args) {
      body = args
    }

    let raw: unknown
    try {
      raw = await restFetch<unknown>(mapping.method, path, body)
    } catch (restErr) {
      // P1-5 health gate: the desktop dashboard (:3456) can be down while
      // the native IPC twin in the same process is alive (same DB, same
      // sync registry). Fall back to it instead of surfacing a raw
      // connection refusal; when no twin exists (OS layer) the original
      // REST error is rethrown below.
      if (isTauri()) {
        try {
          const core = await import('@tauri-apps/api/core')
          const ipc = await core.invoke<unknown>(cmd, args ?? {})
          if (mapping.transformResponse) {
            return (mapping.transformResponse(ipc, args ?? {})) as T
          }
          return transformResponseKeys(ipc) as T
        } catch {
          // No usable IPC twin — report the REST failure.
        }
      }
      throw restErr
    }

    if (mapping.transformResponse) {
      return (mapping.transformResponse(raw, args ?? {})) as T
    }

    return transformResponseKeys(raw) as T
  }

  // Write-only / unsupported commands in web mode
  if (WRITE_ONLY_COMMANDS.has(cmd)) {
    throw new Error(
      `[Web Mode] Command "${cmd}" requires the Tauri desktop app and is not available through the Web Dashboard REST API.`
    )
  }

  // Unknown command — attempt a best-effort REST call
  console.warn(`[Web Mode] Unknown Tauri command "${cmd}" — no REST mapping exists.`)
  throw new Error(
    `[Web Mode] Command "${cmd}" is not supported. The Web Dashboard REST API does not provide this endpoint.`
  )
}

// ── Composable ──────────────────────────────────────────────

export function useTauri() {
  async function pickFolder(): Promise<string | null> {
    if (isWebMode()) {
      // Native folder picker not available in web mode
      return null
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true, multiple: false })
    return result as string | null
  }

  async function pickFiles(multiple = false): Promise<string[] | null> {
    if (isWebMode()) {
      return null
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: false, multiple })
    return result as string[] | null
  }

  async function readDirectory(path: string): Promise<FileNode[]> {
    if (isWebMode()) {
      // Use REST API to list files, then filter by path prefix
      try {
        const allFiles = await invoke<FileNode[]>('list_files', {})
        return allFiles
          .filter(f => {
            if (!f.path) return false
            const dir = f.path.substring(0, f.path.lastIndexOf('/')) || '/'
            return dir === path || (path === '/' && !f.path.includes('/'))
          })
          .map((f, i) => ({
            ...f,
            id: f.id || `web-${i}-${f.name}`,
          }))
      } catch {
        return []
      }
    }
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(path)
    return entries.map((entry, i) => ({
      id: `local-${i}-${entry.name}`,
      name: entry.name,
      path: `${path}/${entry.name}`,
      fileType: (entry as unknown as { isDirectory: boolean }).isDirectory ? 'folder' as const : 'file' as const,
      sizeBytes: 0,
      encrypted: false,
      compressionLayers: [],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    }))
  }

  async function readTextFile(path: string): Promise<string> {
    if (isWebMode()) {
      throw new Error('[Web Mode] Direct file reads are not available. Use the REST API file endpoints.')
    }
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return await readFile(path) as unknown as string
  }

  async function writeTextFile(path: string, contents: string): Promise<void> {
    if (isWebMode()) {
      throw new Error('[Web Mode] Direct file writes are not available through the Web Dashboard.')
    }
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(path, new TextEncoder().encode(contents))
  }

  async function createDir(path: string): Promise<void> {
    if (isWebMode()) {
      throw new Error('[Web Mode] Directory creation is not available through the Web Dashboard.')
    }
    const { mkdir } = await import('@tauri-apps/plugin-fs')
    await mkdir(path, { recursive: true })
  }

  async function deletePath(path: string): Promise<void> {
    if (isWebMode()) {
      throw new Error('[Web Mode] File deletion is not available through the Web Dashboard.')
    }
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(path)
  }

  async function renamePath(oldPath: string, newPath: string): Promise<void> {
    if (isWebMode()) {
      throw new Error('[Web Mode] File renaming is not available through the Web Dashboard.')
    }
    const { rename } = await import('@tauri-apps/plugin-fs')
    await rename(oldPath, newPath)
  }

  async function copyPath(src: string, dest: string): Promise<void> {
    if (isWebMode()) {
      throw new Error('[Web Mode] File copying is not available through the Web Dashboard.')
    }
    const { copyFile } = await import('@tauri-apps/plugin-fs')
    await copyFile(src, dest)
  }

  async function pathExists(path: string): Promise<boolean> {
    if (isWebMode()) {
      try {
        await restFetch<unknown>('GET', `/api/files`)
        return true
      } catch {
        return false
      }
    }
    const { exists } = await import('@tauri-apps/plugin-fs')
    return await exists(path)
  }

  return {
    invoke,
    pickFolder,
    pickFiles,
    readDirectory,
    readTextFile,
    writeTextFile,
    createDir,
    deletePath,
    renamePath,
    copyPath,
    pathExists,
    isTauri,
    isWebMode,
  }
}