// CyberManju OS — Tauri IPC Composable
// Supports both Tauri desktop (IPC) and Server/Web (REST) modes
//
// In Tauri mode: delegates to @tauri-apps/api/core invoke
// In Web mode: calls the Web Dashboard REST API (port 3456 by default)

import type { FileNode } from '@/types'
import { wasmOsDispatch, wasmSearchFiles, wasmBackendActive, wasmDbDispatch } from './useWasmBackend'
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
  return typeof window !== 'undefined' && '__TAURI__' in window
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
  if (window.location.port === '3456' || _serverUrl) return false
  return true
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
  const init: RequestInit = {
    method,
    headers: buildHeaders(),
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new Error(
      `Network error calling ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

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
      // ignore parse failure
    }
    throw new Error(message)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
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

const REST_ROUTES: Record<string, RestMapping> = {
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

  search_files: {
    method: 'GET',
    buildPath: (args) => `/api/search?q=${encodeURIComponent(String(args.query ?? ''))}`,
    transformResponse: (raw) => {
      // REST returns raw file objects; map to SearchResult shape
      const items = transformResponseKeys(raw) as Array<Record<string, unknown>>
      return items.map(item => ({
        fileId: item.id ?? '',
        fileName: item.name ?? '',
        score: 1.0,
        snippet: '',
      }))
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
    buildPath: () => '/api/encryption/status',
    transformResponse: (raw) => {
      const data = transformResponseKeys(raw) as Record<string, unknown>
      return {
        isEncrypted: false,
        algorithm: undefined,
        nistLevel: undefined,
        keyId: undefined,
        encryptedAt: undefined,
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
    buildPath: (args) => `/api/os/stat${String(args.path ?? '')}`,
  },
  os_ls: {
    method: 'GET',
    buildPath: (args) => `/api/os/ls${String(args.path ?? '')}`,
  },
  os_du: {
    method: 'GET',
    buildPath: (args) => `/api/os/du${String(args.path ?? '')}`,
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
const WRITE_ONLY_COMMANDS = new Set([
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
  'parse_file',
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
 */
const REST_FIRST = new Set([
  'os_exec', 'os_complete', 'os_stat', 'os_ls', 'os_du', 'os_df', 'os_ps',
  'os_top', 'os_workers', 'os_jobs',
  'list_disks', 'get_disk', 'create_disk', 'attach_disk', 'detach_disk',
  'resize_disk', 'destroy_disk', 'check_disk', 'volume_df',
  'get_sync_job', 'list_sync_runs', 'get_sync_status', 'restore_sync_file',
  'delete_remote_file', 'get_sync_usage', 'oauth_start',
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
  const token = typeof cfg.token === 'string' ? cfg.token : ''
  const backend = String(cfg.backendType ?? '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  const blocked = (who: string): Error =>
    new Error(
      `network: ${who} is not reachable from this browser (offline, or the provider sends no CORS headers) — the token is still saved locally; live sync needs the desktop app, Docker image or dashboard server`
    )
  try {
    switch (backend) {
      case 'local':
        return true
      case 'github': {
        if (!token) return false
        let res: Response
        try {
          res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
            signal: ctrl.signal,
          })
        } catch {
          throw blocked('api.github.com')
        }
        return res.ok
      }
      case 'gitlab': {
        if (!token) return false
        const project = String(cfg.repoName ?? '')
        if (!project) return false
        const base = typeof cfg.basePath === 'string' && /^https?:\/\//.test(cfg.basePath)
          ? cfg.basePath.replace(/\/+$/, '')
          : 'https://gitlab.com'
        let res: Response
        try {
          res = await fetch(
            `${base}/api/v4/projects/${encodeURIComponent(project)}`,
            { headers: { 'PRIVATE-TOKEN': token }, signal: ctrl.signal },
          )
        } catch {
          throw blocked(base)
        }
        return res.ok
      }
      case 'googleDrive': {
        if (!token) return false
        let res: Response
        try {
          res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          })
        } catch {
          throw blocked('www.googleapis.com')
        }
        return res.ok
      }
      default:
        return false
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The core invoke — works in both Tauri and Web modes. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // ── Provider VFS (CONTROL Phase 5.6): served by the TS canal
  // orchestration on EVERY transport — mounts + cache live in kv (inside
  // the `.cybermanju` container on static hosts), network bytes go through
  // the Rust canal, so reads never hit the "needs the dashboard" refusal.
  if (cmd === 'vfs_list_mounts' || cmd === 'vfs_save_mount' || cmd === 'vfs_delete_mount' ||
    cmd === 'vfs_list_dir' || cmd === 'vfs_read_file') {
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
    }
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
      const wasmArgs = wasmArgsForCommand(cmd, args ?? {})
      const raw = await wasmOsDispatch(wasmArgs.cmd, wasmArgs.args)
      return raw as T
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

    const raw = await restFetch<unknown>(mapping.method, path, body)

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