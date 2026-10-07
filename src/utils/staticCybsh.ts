// CyberManju OS — static-host cybsh answers (WASM transport).
//
// The Rust wasm dispatcher (`crates/os-wasm/src/os.rs`) owns the volume
// commands (ls/cat/write/…) but cannot see the vault, the sync configs, or
// the provider network — it runs on the main thread while the database lives
// in the worker. So before an `os_exec` line reaches `wasmOsDispatch`, the
// static transport offers it here: every verb below is answered locally from
// the local-pc vault (OAuth/PAT signs in `sync.secret`, keys under
// `secret:cybsh:key:*`, the `.cybermanju` file behind `wasmDiskStatus`) plus
// live CORS-OK provider probes. Anything that truly needs the server (sync
// push, the OAuth dance, provider scrub) warns that the dashboard is
// required instead of dying with ERR_CONNECTION_REFUSED.
//
// File verbs (`cp`, `mv`, `rm`, `mkdir`) work across the merged namespace:
// plain paths hit the local shell volume, `/providers/<mountId>/…` paths hit
// that mount through the provider canal — same-provider renames, cross-
// provider copies, and provider↔local moves all go through one byte path,
// with `-r` gating every recursive directory walk.
//
// Dependency injection: every browser effect arrives through
// `StaticCybshDeps`, so vitest drives each verb with fakes (node env, no
// window). `useTauri.ts` supplies the real deps; nothing here imports a
// composable, so there are no module cycles.

import type { ShellResult } from '@/types'

/** The 1 MiB single-write cap mirrors `MAX_WRITE_BYTES` in os.rs. */
export const STATIC_WRITE_LIMIT = 1024 * 1024

/** Report footer: provider push always needs the server behind the page. */
export const DASHBOARD_NOTE =
  'note: provider push / sync start needs the CyberManju dashboard (:3456, desktop app or Docker image) — above is the local vault + live provider probes'

export interface StaticSyncConfig {
  id: string
  backendType: string
  enabled: boolean
  name?: string
  repoName?: string
  branch?: string
  basePath?: string
  folderId?: string
}

export interface StaticDiskStatus {
  attached: boolean
  name: string
  savedBytes: number
  dirty: boolean
}

export interface StaticMount {
  id: string
  name: string
  backendType: string
  configId: string
}

/** One row of a provider directory listing (mirrors `VfsEntry`). */
export interface StaticVfsEntry {
  name: string
  path: string
  isDir: boolean
  sizeBytes: number
}

export interface ProviderQuotaProbe {
  configId: string
  backendType: string
  ok: boolean
  totalBytes?: number | null
  usedBytes?: number | null
  remainingRequests?: number | null
  requestLimit?: number | null
  resetAt?: number | null
  detail: string
  error?: string
}

export interface StaticChacha {
  genKey(): Uint8Array
  genNonce(): Uint8Array
  encrypt(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Uint8Array
  decrypt(key: Uint8Array, nonce: Uint8Array, cipher: Uint8Array): Uint8Array
}

export interface StaticCodecs {
  compressLz4(data: Uint8Array): Uint8Array
  decompressLz4(data: Uint8Array): Uint8Array
  compressBrotli(data: Uint8Array): Uint8Array
  decompressBrotli(data: Uint8Array): Uint8Array
}

export interface StaticCybshDeps {
  readVolume(): Record<string, string>
  getCwd(): Promise<string>
  writeVolumeFile(path: string, content: string): Promise<void>
  deleteVolumePath(path: string, recursive: boolean): Promise<number>
  killTask(id: number): Promise<boolean>
  listSyncConfigs(): Promise<StaticSyncConfig[]>
  getConfigSecret(configId: string): Promise<string>
  getDiskStatus(): Promise<StaticDiskStatus>
  getStorageEstimate(): Promise<{ usage?: number; quota?: number } | null>
  listMounts(): Promise<StaticMount[]>
  providerRead(mountId: string, remotePath: string): Promise<Uint8Array>
  providerWrite(mountId: string, remotePath: string, data: Uint8Array): Promise<void>
  providerDelete(mountId: string, remotePath: string): Promise<void>
  providerList(mountId: string, remotePath: string): Promise<StaticVfsEntry[]>
  probeProviderQuota(cfg: StaticSyncConfig, token: string): Promise<ProviderQuotaProbe>
  keyGet(name: string): Promise<string | null>
  keySet(name: string, value: string): Promise<void>
  chacha(): Promise<StaticChacha | null>
  codecs(): Promise<StaticCodecs | null>
  blake3(data: string): Promise<string | null>
}

export interface ParsedLine {
  verb: string
  args: string[]
  json: boolean
}

/** Verbs answered here. Everything else (and every chained line) falls
 *  through to the wasm dispatcher. */
const HANDLED_VERBS = new Set([
  'echo', 'cp', 'mv', 'rm', 'mkdir', 'kill',
  'quota', 'providers', 'oauth', 'disk', 'sync',
  'encrypt', 'decrypt', 'keygen', 'compress', 'decompress',
  'scrub', 'repair', 'gc', 'lease', 'mount', 'umount', 'ai',
])

export function handlesStaticVerb(verb: string): boolean {
  return HANDLED_VERBS.has(verb.toLowerCase())
}

/**
 * Quote-aware first-word parse. Returns `null` for chained lines (`&&`,
 * `;`, `|` outside quotes) — those stay with the wasm shell, which stitches
 * `&&`/`;` itself and refuses `|` honestly.
 */
export function parseCybshLine(line: string): ParsedLine | null {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let hasToken = false
  const push = () => {
    if (hasToken) {
      tokens.push(current)
      current = ''
      hasToken = false
    }
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else {
        current += c
        hasToken = true
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasToken = true
      continue
    }
    if (c === '|' || c === ';') return null
    if (c === '&' && line[i + 1] === '&') return null
    if (/\s/.test(c)) {
      push()
      continue
    }
    current += c
    hasToken = true
  }
  push()
  if (tokens.length === 0) return null
  const args = tokens.slice(1).filter((a) => a !== '--json')
  const json = tokens.slice(1).some((a) => a === '--json')
  return { verb: tokens[0].toLowerCase(), args, json }
}

/** Mirror of `join()` in crates/os-wasm/src/os.rs (cwd + relative → absolute). */
export function joinVolumePath(cwd: string, path: string): string {
  const parts: string[] = []
  if (!path.startsWith('/')) {
    for (const part of cwd.replace(/^\/+/, '').split('/')) {
      if (part !== '' && part !== '.') parts.push(part)
    }
  }
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

/**
 * Split an absolute shell path into a provider mount reference.
 * `/providers/<mountId>` is the mount root, `/providers/<mountId>/a/b` a
 * path inside it. Anything else returns `null` (a local volume path). The
 * shape mirrors `parseProviderPath` in useProviderCanal.
 */
export function splitProviderPath(absPath: string): { mountId: string; remotePath: string } | null {
  const norm = absPath.replace(/\\/g, '/')
  const segs = norm.split('/').filter((s) => s !== '')
  if (segs.length < 2 || segs[0] !== 'providers') return null
  return { mountId: segs[1], remotePath: segs.slice(2).join('/').replace(/^\/+|\/+$/g, '') }
}

function baseName(path: string): string {
  const clean = path.replace(/\/+$/g, '')
  const i = clean.lastIndexOf('/')
  return i < 0 ? clean : clean.slice(i + 1)
}

function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Human byte size in the native shell's `1.5G` style (`human()` in shell.rs). */
export function humanBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '?'
  const units = ['B', 'k', 'M', 'G', 'T']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  if (unit === 0) return `${Math.round(value)}B`
  return `${value.toFixed(1)}${units[unit]}`
}

// Node-only fallback for non-DOM runtimes (browsers and modern Node take
// the btoa/atob path above): declared locally so the web build needs no
// @types/node dependency.
declare const Buffer: {
  from(input: Uint8Array | string, encoding?: string): Uint8Array & { toString(encoding?: string): string }
}

function b64Encode(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

function b64Decode(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** Canonical backend name — tolerant of whatever casing a config carries. */
export function normalizeBackend(raw: string): string {
  const b = (raw ?? '').trim().toLowerCase()
  if (b === 'googledrive' || b === 'google_drive' || b === 'drive' || b === 'google') return 'googleDrive'
  if (b === 'github') return 'github'
  if (b === 'gitlab') return 'gitlab'
  if (b === 'local' || b === 'localdir' || b === 'local_dir') return 'local'
  return b || 'unknown'
}

/**
 * Normalize one `sync.list` row (wasm db or REST, camelCase or snake_case)
 * into the shape the static handlers probe. Returns `null` for id-less rows.
 */
export function staticConfigFromRow(row: Record<string, unknown>): StaticSyncConfig | null {
  const id = String(row.id ?? '')
  if (!id) return null
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return {
    id,
    backendType: str(row.backendType) ?? str(row.backend_type) ?? str(row.backend) ?? 'unknown',
    enabled: row.enabled !== false,
    name: str(row.name),
    repoName: str(row.repoName) ?? str(row.repo_name),
    branch: str(row.branch),
    basePath: str(row.basePath) ?? str(row.base_path) ?? str(row.instanceUrl) ?? str(row.instance_url),
    folderId: str(row.folderId) ?? str(row.folder_id),
  }
}

export function isOauthBackend(backend: string): boolean {
  const b = normalizeBackend(backend)
  return b === 'github' || b === 'gitlab' || b === 'googleDrive'
}

export function oauthSlug(backend: string): string | null {
  const b = normalizeBackend(backend)
  if (b === 'googleDrive') return 'google'
  if (b === 'github' || b === 'gitlab') return b
  return null
}

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** A body that is not JSON is a transport failure, never a probe throw —
 *  `probeProviderQuotaViaFetch` keeps its never-throws contract either way. */
async function safeJson(res: {
  json(): Promise<unknown>
}): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await res.json() }
  } catch {
    return { ok: false }
  }
}

/**
 * Live provider quota over browser fetch — the same endpoints
 * `crates/sync/src/quota.rs::usage()` probes (Drive quotaInfo, GitHub
 * rate-limit, GitLab project statistics), so a number here means the same
 * thing as on the desktop. `fetchFn` is injected (browser `fetch` in prod,
 * a fake in tests).
 */
export async function probeProviderQuotaViaFetch(
  cfg: StaticSyncConfig,
  token: string,
  fetchFn: FetchFn,
  timeoutMs = 10000,
): Promise<ProviderQuotaProbe> {
  const backend = normalizeBackend(cfg.backendType)
  const base = { configId: cfg.id, backendType: cfg.backendType }
  if (backend === 'local') {
    return {
      ...base,
      ok: true,
      detail: 'local filesystem quota is not tracked (best-effort: unknown)',
    }
  }
  if (!token) {
    return {
      ...base,
      ok: false,
      detail: '',
      error:
        `auth: ${cfg.id} has no token — paste a PAT on its provider card or connect OAuth via the dashboard, then retry`,
    }
  }
  const ctrl =
    typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    ctrl !== null ? setTimeout(() => ctrl.abort(), timeoutMs) : 0
  const blocked = (host: string): ProviderQuotaProbe => ({
    ...base,
    ok: false,
    detail: '',
    error:
      `network: ${host} is not reachable from this browser (offline, or the provider sends no CORS headers) — the token stays saved in the local vault; live quota needs the desktop app, Docker image or dashboard server`,
  })
  try {
    if (backend === 'github') {
      let res
      try {
        res = await fetchFn('https://api.github.com/rate_limit', {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
          },
          signal: ctrl?.signal,
        })
      } catch {
        return blocked('api.github.com')
      }
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          detail: '',
          error:
            res.status === 401 || res.status === 403
              ? `auth: GitHub rejected the token for ${cfg.id} (HTTP ${res.status}) — reseal it on the provider card`
              : `network: GitHub quota probe failed for ${cfg.id} (HTTP ${res.status})`,
        }
      }
      const body = await safeJson(res)
      if (!body.ok) {
        return {
          ...base,
          ok: false,
          detail: '',
          error: `network: GitHub quota response unreadable for ${cfg.id}`,
        }
      }
      const json = body.value as { resources?: { core?: { limit?: number; remaining?: number; reset?: number } } }
      const core = json?.resources?.core ?? {}
      return {
        ...base,
        ok: true,
        requestLimit: typeof core.limit === 'number' ? core.limit : null,
        remainingRequests: typeof core.remaining === 'number' ? core.remaining : null,
        resetAt: typeof core.reset === 'number' ? core.reset : null,
        detail: 'GitHub REST rate-limit window (storage quota not published)',
      }
    }
    if (backend === 'gitlab') {
      const repo = (cfg.repoName ?? '').trim()
      if (!repo) {
        return {
          ...base,
          ok: false,
          detail: '',
          error: 'not_found: GitLab backend requires project_id (use repo_name field)',
        }
      }
      const rawBase = (cfg.basePath ?? '').trim()
      const host =
        /^https?:\/\//.test(rawBase) && rawBase
          ? rawBase.replace(/\/+$/, '')
          : 'https://gitlab.com'
      const hostName = host.replace(/^https?:\/\//, '').split('/')[0]
      let res
      try {
        res = await fetchFn(
          `${host}/api/v4/projects/${encodeURIComponent(repo)}?statistics=true`,
          { headers: { 'PRIVATE-TOKEN': token }, signal: ctrl?.signal },
        )
      } catch {
        return blocked(hostName)
      }
      if (res.status === 401) {
        return {
          ...base,
          ok: false,
          detail: '',
          error: `auth: GitLab rejected the token for ${cfg.id} (HTTP 401) — reseal it on the provider card`,
        }
      }
      if (res.status !== 200) {
        return {
          ...base,
          ok: true,
          detail:
            `project statistics need maintainer access (HTTP ${res.status}) — best-effort: unknown`,
        }
      }
      const body = await safeJson(res)
      if (!body.ok) {
        return {
          ...base,
          ok: false,
          detail: '',
          error: `network: GitLab quota response unreadable for ${cfg.id}`,
        }
      }
      const json = body.value as { statistics?: { storage_size?: number; repository_size?: number } }
      const stats = json?.statistics ?? {}
      return {
        ...base,
        ok: true,
        usedBytes:
          typeof stats.storage_size === 'number'
            ? stats.storage_size
            : typeof stats.repository_size === 'number'
              ? stats.repository_size
              : null,
        detail: 'project statistics.storage_size (project storage has no provider quota)',
      }
    }
    if (backend === 'googleDrive') {
      let res
      try {
        res = await fetchFn(
          'https://www.googleapis.com/drive/v3/about?fields=user,quotaInfo',
          { headers: { Authorization: `Bearer ${token}` }, signal: ctrl?.signal },
        )
      } catch {
        return blocked('www.googleapis.com')
      }
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          detail: '',
          error:
            res.status === 401 || res.status === 403
              ? `auth: Google rejected the token for ${cfg.id} (HTTP ${res.status}) — reconnect OAuth via the dashboard`
              : `network: Google Drive quota probe failed for ${cfg.id} (HTTP ${res.status})`,
        }
      }
      const body = await safeJson(res)
      if (!body.ok) {
        return {
          ...base,
          ok: false,
          detail: '',
          error: `network: Google Drive quota response unreadable for ${cfg.id}`,
        }
      }
      const json = body.value as {
        quotaInfo?: { usage?: number | string; usageInDriveTrash?: number | string; limit?: number | string }
      }
      const info = json?.quotaInfo ?? {}
      const num = (v: unknown): number | null => {
        if (typeof v === 'number') return v
        if (typeof v === 'string' && v !== '') {
          const n = parseInt(v, 10)
          return Number.isNaN(n) ? null : n
        }
        return null
      }
      const used = num(info.usage)
      const trash = num(info.usageInDriveTrash) ?? 0
      const total = num(info.limit)
      const out: ProviderQuotaProbe = {
        ...base,
        ok: true,
        usedBytes: used === null ? null : used + trash,
        totalBytes: total,
        detail: 'Drive v3 about/quotaInfo',
      }
      if (out.usedBytes === null && out.totalBytes === null) {
        out.detail = 'Drive returned no quotaInfo for this account'
      }
      return out
    }
    return {
      ...base,
      ok: false,
      detail: '',
      error: `unsupported: quota is not supported for '${cfg.backendType}' (github + gitlab + googleDrive + local only)`,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface VerbOut {
  ok: boolean
  text: string
}

function shellOk(text: string): VerbOut {
  return { ok: true, text }
}

function shellErr(text: string): VerbOut {
  return { ok: false, text }
}

function fmtProbeLine(probe: ProviderQuotaProbe, cfgId: string, backend: string): string {
  if (!probe.ok) return probe.error ?? `network: quota probe failed for ${cfgId}`
  const used = humanBytes(probe.usedBytes)
  const total = humanBytes(probe.totalBytes)
  let extra = ''
  if (probe.remainingRequests !== null && probe.remainingRequests !== undefined) {
    extra = ` · ${probe.remainingRequests}/${probe.requestLimit ?? '?'} requests left`
  }
  return `${cfgId} (${backend}): used ${used} of ${total}${extra} · source: ${probe.detail}`
}

async function handleQuota(_args: string[], json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  const volume = deps.readVolume()
  const names = Object.keys(volume)
  const localBytes = names.reduce((n, k) => n + (volume[k]?.length ?? 0), 0)
  const [disk, est, configs] = await Promise.all([
    deps.getDiskStatus().catch((): StaticDiskStatus => ({ attached: false, name: '', savedBytes: 0, dirty: false })),
    deps.getStorageEstimate().catch(() => null),
    deps.listSyncConfigs().catch((): StaticSyncConfig[] => []),
  ])
  const lines: string[] = []
  lines.push(`local vault: ${names.length} files · ${humanBytes(localBytes)} in the shell volume`)
  if (est && (est.usage !== undefined || est.quota !== undefined)) {
    const pct =
      est.quota && est.quota > 0 && est.usage !== undefined
        ? ` (${Math.round((est.usage / est.quota) * 100)}%)`
        : ''
    lines.push(
      `browser storage: ${humanBytes(est.usage)} of ${humanBytes(est.quota)}${pct} · persisted by the OS when granted`,
    )
  }
  lines.push(
    disk.attached
      ? `.cybermanju file: ${disk.name || 'attached'} · ${humanBytes(disk.savedBytes)} saved${disk.dirty ? ' · UNSAVED CHANGES' : ''}`
      : `.cybermanju file: none attached — open or create one to take the vault home (local-pc file)`,
  )
  const enabled = configs.filter((c) => c.enabled)
  const probes: ProviderQuotaProbe[] = []
  let failed = false
  if (enabled.length === 0) {
    lines.push('not_found: no enabled provider to query — add one on its provider card')
    failed = true
  }
  for (const cfg of enabled) {
    const token = await deps.getConfigSecret(cfg.id).catch(() => '')
    const probe = await deps
      .probeProviderQuota(cfg, token)
      .catch(
        (e): ProviderQuotaProbe => ({
          configId: cfg.id,
          backendType: cfg.backendType,
          ok: false,
          detail: '',
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    probes.push(probe)
    lines.push(fmtProbeLine(probe, cfg.id, cfg.backendType))
    if (!probe.ok) failed = true
  }
  lines.push(DASHBOARD_NOTE)
  if (json) {
    return (failed ? shellErr : shellOk)(
      JSON.stringify({
        local: { files: names.length, bytes: localBytes },
        browser: est,
        disk,
        providers: probes,
        dashboardRequired: true,
      }),
    )
  }
  return (failed ? shellErr : shellOk)(lines.join('\n'))
}

async function handleProviders(args: string[], json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  void args
  const [configs, mounts, disk] = await Promise.all([
    deps.listSyncConfigs().catch((): StaticSyncConfig[] => []),
    deps.listMounts().catch((): StaticMount[] => []),
    deps.getDiskStatus().catch((): StaticDiskStatus => ({ attached: false, name: '', savedBytes: 0, dirty: false })),
  ])
  const rows: Array<Record<string, unknown>> = []
  for (const c of configs) {
    const secret = await deps.getConfigSecret(c.id).catch(() => '')
    rows.push({
      id: c.id,
      backend: c.backendType,
      enabled: c.enabled,
      hasKey: secret !== '',
      repo: c.repoName ?? null,
      disk: disk.attached ? disk.name : null,
    })
  }
  if (json) return shellOk(JSON.stringify({ providers: rows, mounts, dashboardRequired: true }))
  if (rows.length === 0 && mounts.length === 0) {
    return shellOk(
      `no providers connected — add one in Settings (provider card), then \`oauth status\` to check its sign-in\n${DASHBOARD_NOTE}`,
    )
  }
  const out = ['ID                   BACKEND       ENABLED   SIGNED-IN   REPO']
  for (const r of rows) {
    out.push(
      `${String(r.id).padEnd(20)} ${String(r.backend).padEnd(13)} ${(r.enabled ? 'yes' : 'no').padEnd(9)} ${(r.hasKey ? 'yes' : 'no').padEnd(11)} ${String(r.repo ?? '—')}`,
    )
  }
  for (const m of mounts) {
    out.push(`  mount ${m.id} → ${m.backendType} (${m.name})`)
  }
  out.push(DASHBOARD_NOTE)
  return shellOk(out.join('\n'))
}

async function handleOauth(args: string[], json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  const sub = (args[0] ?? 'status').toLowerCase()
  const configs = await deps.listSyncConfigs().catch((): StaticSyncConfig[] => [])
  if (sub === 'status' || sub === 'list') {
    const rows = []
    for (const c of configs) {
      const slug = oauthSlug(c.backendType)
      const secret = await deps.getConfigSecret(c.id).catch(() => '')
      rows.push({ id: c.id, backend: c.backendType, oauth: slug, signedIn: secret !== '' })
    }
    if (json) return shellOk(JSON.stringify({ oauth: rows, dashboardRequired: true }))
    if (rows.length === 0) return shellOk('no provider configs yet — add one on its provider card first')
    return shellOk(
      rows
        .map((r) =>
          r.oauth
            ? `${r.id} (${r.backend}): ${r.signedIn ? 'signed in (token sealed in the local vault)' : 'NOT signed in — `oauth start ' + r.backend + ' ' + r.id + '`'}`
            : `${r.id} (${r.backend}): local backend, no OAuth flow — nothing to sign`,
        )
        .join('\n'),
    )
  }
  if (sub === 'start') {
    const backend = normalizeBackend(args[1] ?? '')
    const configId = args[2] ?? ''
    const slug = oauthSlug(backend)
    if (!slug) {
      return shellErr(
        `unsupported: no OAuth flow for '${args[1] ?? ''}' (oauth-capable: github, gitlab, googleDrive)`,
      )
    }
    const target =
      configs.find((c) => c.id === configId) ??
      configs.find((c) => normalizeBackend(c.backendType) === backend && c.enabled) ??
      configs.find((c) => normalizeBackend(c.backendType) === backend)
    if (target) {
      const secret = await deps.getConfigSecret(target.id).catch(() => '')
      if (secret) {
        const msg = `${target.id} is already signed in (token sealed in the local vault) — \`quota\` probes it live`
        return json
          ? shellOk(JSON.stringify({ configId: target.id, signedIn: true }))
          : shellOk(msg)
      }
    }
    const msg = [
      `static build: the ${slug} OAuth dance needs the dashboard — this page cannot receive the provider callback`,
      'sign in instead with one of:',
      '  1. paste a personal token on the provider card (Settings → provider) — it seals into the local vault',
      target
        ? `  2. set a dashboard URL in Settings, then \`oauth start\` runs the full flow for ${target.id}`
        : '  2. set a dashboard URL in Settings for the full OAuth redirect flow',
    ].join('\n')
    return json
      ? shellErr(JSON.stringify({ signedIn: false, dashboardRequired: true, hint: msg }))
      : shellErr(`auth: ${msg}`)
  }
  return shellErr(`usage: oauth [status|start <github|gitlab|googleDrive> [configId]]`)
}

async function handleDisk(args: string[], json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  const sub = (args[0] ?? 'status').toLowerCase()
  if (sub === 'status' || sub === 'list' || sub === 'df') {
    const [disk, est] = await Promise.all([
      deps.getDiskStatus().catch((): StaticDiskStatus => ({ attached: false, name: '', savedBytes: 0, dirty: false })),
      deps.getStorageEstimate().catch(() => null),
    ])
    const volume = deps.readVolume()
    const bytes = Object.values(volume).reduce((n, v) => n + v.length, 0)
    const payload = {
      file: disk,
      shellVolume: { files: Object.keys(volume).length, bytes },
      browser: est,
      dashboardRequired: true,
    }
    if (json) return shellOk(JSON.stringify(payload))
    const lines = [
      disk.attached
        ? `local-pc vault file: ${disk.name} · ${humanBytes(disk.savedBytes)} saved${disk.dirty ? ' · UNSAVED CHANGES (`save` in the file menu writes it back)' : ''}`
        : 'local-pc vault file: none attached — open or create a .cybermanju file to persist the vault',
      `shell volume: ${payload.shellVolume.files} files · ${humanBytes(bytes)} (mirrored into the vault as volume:*)`,
    ]
    if (est?.quota) lines.push(`browser storage: ${humanBytes(est.usage)} of ${humanBytes(est.quota)}`)
    lines.push(DASHBOARD_NOTE)
    return shellOk(lines.join('\n'))
  }
  return shellErr(
    `unsupported: \`disk ${sub}\` mutates provider disks on the server — open/attach .cybermanju files from the file menu on this build (${DASHBOARD_NOTE})`,
  )
}

async function handleSync(args: string[], json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  const sub = (args[0] ?? 'status').toLowerCase()
  if (sub === 'status' || sub === 'list') {
    const configs = await deps.listSyncConfigs().catch((): StaticSyncConfig[] => [])
    const payload = {
      active: false,
      jobId: null,
      configs: configs.map((c) => ({ id: c.id, backend: c.backendType, enabled: c.enabled })),
      detail: 'static build keeps no run registry — start/cancel run on the dashboard (202 jobs)',
    }
    if (json) return shellOk(JSON.stringify(payload))
    if (configs.length === 0) return shellOk('no sync configs yet — add a provider first')
    return shellOk(
      [
        ...configs.map(
          (c) => `${c.id} (${c.backendType}): ${c.enabled ? 'enabled' : 'disabled'} · browse offline via its provider mount, push via the dashboard`,
        ),
        DASHBOARD_NOTE,
      ].join('\n'),
    )
  }
  if (sub === 'start' || sub === 'cancel') {
    return shellErr(
      `unsupported: \`sync ${sub}\` runs detached 202 jobs on the server — this static build answers \`sync status\` locally; seed/browse providers offline, push from the desktop app, Docker image or dashboard server`,
    )
  }
  return shellErr(`usage: sync [status|list|start|cancel] (only status|list answer locally — the rest need the dashboard)`)
}

async function handleMount(args: string[], _json: boolean, deps: StaticCybshDeps): Promise<VerbOut> {
  if (args.length === 0) {
    const mounts = await deps.listMounts().catch((): StaticMount[] => [])
    if (mounts.length === 0) {
      return shellOk('no provider mounts — create one from a provider card (Accounts), then browse it under /providers/<id>')
    }
    return shellOk(mounts.map((m) => `${m.id} → ${m.backendType} (${m.name})`).join('\n'))
  }
  return shellErr(
    'unsupported: mounts are created from the provider cards on this build (tokens stay sealed in the local vault) — `mount` with no args lists them',
  )
}

async function handleEncrypt(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const [rawPath, keyNameArg] = args
  if (!rawPath) return shellErr('usage: encrypt <path> [key-name]')
  const chacha = await deps.chacha().catch(() => null)
  if (!chacha) {
    return shellErr('unsupported: encrypt needs the rebuilt wasm crypto bundle — reconnect after the next Pages deploy')
  }
  const cwd = await deps.getCwd().catch(() => '/')
  const path = joinVolumePath(cwd, rawPath)
  const volume = deps.readVolume()
  const text = volume[path]
  if (text === undefined) {
    const prefix = `${path}/`
    if (Object.keys(volume).some((k) => k.startsWith(prefix))) {
      return shellErr(`is a directory: ${rawPath} (encrypt seals files only)`)
    }
    return shellErr(`not_found: ${rawPath}`)
  }
  const keyName = keyNameArg || 'default'
  let keyB64 = await deps.keyGet(`secret:cybsh:key:${keyName}`).catch(() => null)
  if (!keyB64) {
    keyB64 = b64Encode(chacha.genKey())
    await deps.keySet(`secret:cybsh:key:${keyName}`, keyB64)
  }
  const key = b64Decode(keyB64)
  const nonce = chacha.genNonce()
  let cipher: Uint8Array
  try {
    cipher = chacha.encrypt(key, nonce, utf8Encode(text))
  } catch (e) {
    return shellErr(`integrity: encryption failed (${e instanceof Error ? e.message : String(e)})`)
  }
  const sealedPath = `${path}.sealed`
  const sealed = JSON.stringify({
    alg: 'chacha20-poly1305',
    key: keyName,
    nonce: b64Encode(nonce),
    data: b64Encode(cipher),
  })
  if (sealed.length > STATIC_WRITE_LIMIT) {
    return shellErr(`too_large: sealed output is ${sealed.length} bytes, wasm write limit is ${STATIC_WRITE_LIMIT}`)
  }
  await deps.writeVolumeFile(sealedPath, sealed)
  await deps.keySet(`secret:cybsh:seal:${sealedPath}`, keyName).catch(() => undefined)
  return shellOk(`${path} -> ${sealedPath} (${text.length} bytes sealed, ChaCha20-Poly1305, key '${keyName}' in the local vault)`)
}

async function handleDecrypt(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const [rawPath, keyNameArg] = args
  if (!rawPath) return shellErr('usage: decrypt <path.sealed> [key-name]')
  const chacha = await deps.chacha().catch(() => null)
  if (!chacha) {
    return shellErr('unsupported: decrypt needs the rebuilt wasm crypto bundle — reconnect after the next Pages deploy')
  }
  const cwd = await deps.getCwd().catch(() => '/')
  const path = joinVolumePath(cwd, rawPath)
  const volume = deps.readVolume()
  const sealed = volume[path]
  if (sealed === undefined) return shellErr(`not_found: ${rawPath}`)
  let env: { alg?: string; key?: string; nonce?: string; data?: string }
  try {
    env = JSON.parse(sealed) as typeof env
  } catch {
    return shellErr(`invalid: ${rawPath} is not a cybsh sealed file (no JSON envelope)`)
  }
  if (env.alg !== 'chacha20-poly1305' || !env.nonce || !env.data) {
    return shellErr(`invalid: ${rawPath} is not a cybsh sealed file (desktop .sealed files open on the desktop)`)
  }
  const keyName =
    keyNameArg ?? env.key ?? (await deps.keyGet(`secret:cybsh:seal:${path}`).catch(() => null)) ?? 'default'
  const keyB64 = await deps.keyGet(`secret:cybsh:key:${keyName}`).catch(() => null)
  if (!keyB64) return shellErr(`auth: no key '${keyName}' in the local vault — unlock or re-encrypt first`)
  let plain: Uint8Array
  try {
    plain = chacha.decrypt(b64Decode(keyB64), b64Decode(env.nonce), b64Decode(env.data))
  } catch {
    return shellErr('integrity: sealed bytes failed authentication — wrong key or tampered file')
  }
  const outPath = path.endsWith('.sealed') ? path.slice(0, -'.sealed'.length) : `${path}.plain`
  const text = utf8Decode(plain)
  if (text.length > STATIC_WRITE_LIMIT) {
    return shellErr(`too_large: plaintext is ${text.length} bytes, wasm write limit is ${STATIC_WRITE_LIMIT}`)
  }
  await deps.writeVolumeFile(outPath, text)
  return shellOk(`${path} -> ${outPath} (${text.length} bytes)`)
}

async function handleKeygen(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const name = args[0] || `key-${Math.random().toString(36).slice(2, 10)}`
  const chacha = await deps.chacha().catch(() => null)
  if (!chacha) {
    return shellErr('unsupported: keygen needs the rebuilt wasm crypto bundle — reconnect after the next Pages deploy')
  }
  const keyB64 = b64Encode(chacha.genKey())
  await deps.keySet(`secret:cybsh:key:${name}`, keyB64)
  return shellOk(`key '${name}' ready (32 bytes, ChaCha20-Poly1305, sealed in the local vault)`)
}

async function handleCompress(args: string[], deps: StaticCybshDeps, layer: 'lz4' | 'brotli'): Promise<VerbOut> {
  const [rawPath, layerArg] = args
  const want = (layerArg ?? layer).toLowerCase()
  if (!rawPath) return shellErr(`usage: compress <path> [lz4|brotli] (decompress: decompress <path.(lz4|br)>)`)
  if (want !== 'lz4' && want !== 'brotli') return shellErr(`unsupported: compress layer '${layerArg}' (lz4|brotli only on this build)`)
  const codecs = await deps.codecs().catch(() => null)
  if (!codecs) {
    return shellErr('unsupported: compress needs the rebuilt wasm bundle — reconnect after the next Pages deploy')
  }
  const cwd = await deps.getCwd().catch(() => '/')
  const path = joinVolumePath(cwd, rawPath)
  const volume = deps.readVolume()
  const text = volume[path]
  if (text === undefined) return shellErr(`not_found: ${rawPath}`)
  const input = utf8Encode(text)
  let out: Uint8Array
  try {
    out = want === 'lz4' ? codecs.compressLz4(input) : codecs.compressBrotli(input)
  } catch (e) {
    return shellErr(`integrity: compression failed (${e instanceof Error ? e.message : String(e)})`)
  }
  const ext = want === 'lz4' ? '.lz4' : '.br'
  const stored = JSON.stringify({ alg: want, data: b64Encode(out) })
  if (stored.length > STATIC_WRITE_LIMIT) {
    return shellErr(`too_large: compressed output is ${stored.length} bytes, wasm write limit is ${STATIC_WRITE_LIMIT}`)
  }
  await deps.writeVolumeFile(`${path}${ext}`, stored)
  const ratio = input.length === 0 ? '—' : `${Math.round((out.length / input.length) * 100)}%`
  return shellOk(`${path} -> ${path}${ext} (${input.length}B → ${out.length}B, ${ratio}, ${want} in the local vault volume)`)
}

async function handleDecompress(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const [rawPath] = args
  if (!rawPath) return shellErr('usage: decompress <path.(lz4|br)>')
  const codecs = await deps.codecs().catch(() => null)
  if (!codecs) {
    return shellErr('unsupported: decompress needs the rebuilt wasm bundle — reconnect after the next Pages deploy')
  }
  const cwd = await deps.getCwd().catch(() => '/')
  const path = joinVolumePath(cwd, rawPath)
  const volume = deps.readVolume()
  const stored = volume[path]
  if (stored === undefined) return shellErr(`not_found: ${rawPath}`)
  let env: { alg?: string; data?: string }
  try {
    env = JSON.parse(stored) as typeof env
  } catch {
    return shellErr(`invalid: ${rawPath} is not a cybsh compressed file`)
  }
  if ((env.alg !== 'lz4' && env.alg !== 'brotli') || !env.data) {
    return shellErr(`invalid: ${rawPath} is not a cybsh compressed file`)
  }
  let plain: Uint8Array
  try {
    plain = env.alg === 'lz4' ? codecs.decompressLz4(b64Decode(env.data)) : codecs.decompressBrotli(b64Decode(env.data))
  } catch {
    return shellErr('integrity: compressed bytes failed to decode — tampered file')
  }
  const text = utf8Decode(plain)
  const outPath = path.replace(/\.(lz4|br)$/, '') || `${path}.plain`
  if (text.length > STATIC_WRITE_LIMIT) {
    return shellErr(`too_large: plaintext is ${text.length} bytes, wasm write limit is ${STATIC_WRITE_LIMIT}`)
  }
  await deps.writeVolumeFile(outPath, text)
  return shellOk(`${path} -> ${outPath} (${text.length} bytes)`)
}

const SCRUB_CACHE_KEY = 'cache:cybsh:scrub'

async function handleScrub(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  void args
  const volume = deps.readVolume()
  const names = Object.keys(volume)
  const prevRaw = await deps.keyGet(SCRUB_CACHE_KEY).catch(() => null)
  let prev: Record<string, string> = {}
  try {
    if (prevRaw) prev = JSON.parse(prevRaw) as Record<string, string>
  } catch {
    prev = {}
  }
  const next: Record<string, string> = {}
  let verified = 0
  let changed = 0
  let fresh = 0
  for (const name of names) {
    const hash = await deps.blake3(volume[name] ?? '').catch(() => null)
    const digest = hash ?? `fnv:${fnv1a(volume[name] ?? '')}`
    next[name] = digest
    if (!(name in prev)) fresh++
    else if (prev[name] === digest) verified++
    else changed++
  }
  const missing = Object.keys(prev).filter((k) => !(k in volume))
  await deps.keySet(SCRUB_CACHE_KEY, JSON.stringify(next)).catch(() => undefined)
  const bytes = names.reduce((n, k) => n + (volume[k]?.length ?? 0), 0)
  const suffix =
    missing.length > 0
      ? ` · ${missing.length} vanished since last scrub (run \`repair\` to prune the record)`
      : ''
  return shellOk(
    `scrub done · ${names.length} files · ${humanBytes(bytes)} hashed (${verified} verified, ${changed} changed, ${fresh} new)${suffix} · provider chunk scrub needs the dashboard`,
  )
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function handleRepair(_args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const prevRaw = await deps.keyGet(SCRUB_CACHE_KEY).catch(() => null)
  if (!prevRaw) {
    return shellOk('nothing queued — run `scrub` first to snapshot the volume (provider repair needs the dashboard)')
  }
  let prev: Record<string, string> = {}
  try {
    prev = JSON.parse(prevRaw) as Record<string, string>
  } catch {
    return shellOk('nothing queued — run `scrub` first to snapshot the volume (provider repair needs the dashboard)')
  }
  const volume = deps.readVolume()
  const missing = Object.keys(prev).filter((k) => !(k in volume))
  if (missing.length === 0) {
    return shellOk(`nothing queued — ${Object.keys(prev).length} scrubbed paths all present (provider repair needs the dashboard)`)
  }
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(prev)) {
    if (k in volume) next[k] = v
  }
  await deps.keySet(SCRUB_CACHE_KEY, JSON.stringify(next)).catch(() => undefined)
  return shellOk(
    `repaired scrub record · ${missing.length} vanished path(s) pruned (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}) · provider rebuild needs the dashboard`,
  )
}

async function handleGc(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  const apply = args.includes('--apply') || args.includes('-a')
  const volume = deps.readVolume()
  const names = Object.keys(volume)
  const empty = names.filter((k) => (volume[k] ?? '').length === 0 && !k.endsWith('/.keep'))
  const keepMarkers = names.filter((k) => k.endsWith('/.keep'))
  // A `.keep` whose directory holds nothing else is reclaimable.
  const lonelyKeeps = keepMarkers.filter((k) => {
    const dir = k.slice(0, -'/.keep'.length)
    const prefix = dir === '' ? '/' : `${dir}/`
    return !names.some((n) => n !== k && (n === dir || n.startsWith(prefix)))
  })
  const reclaimable = [...new Set([...empty, ...lonelyKeeps])]
  const bytes = reclaimable.reduce((n, k) => n + (volume[k]?.length ?? 0), 0)
  if (!apply) {
    return shellOk(
      `gc (dry run) · ${names.length} checked · ${reclaimable.length} reclaimable (${humanBytes(bytes)}: ${empty.length} empty files, ${lonelyKeeps.length} lonely .keep markers) · re-run with --apply to delete · provider GC needs the dashboard`,
    )
  }
  let freed = 0
  for (const k of reclaimable) {
    try {
      freed += await deps.deleteVolumePath(k, false)
    } catch {
      // Best-effort per path; the summary reports what moved.
    }
  }
  return shellOk(`gc · ${names.length} checked · ${reclaimable.length} deleted · ${humanBytes(freed)} freed · provider GC needs the dashboard`)
}

type Endpoint =
  | { kind: 'local'; path: string }
  | { kind: 'provider'; mountId: string; remotePath: string; label: string }

function resolveEndpoint(cwd: string, raw: string): Endpoint {
  const abs = joinVolumePath(cwd, raw)
  const split = splitProviderPath(abs)
  if (split) {
    const label = `/providers/${split.mountId}${split.remotePath ? `/${split.remotePath}` : ''}`
    return { kind: 'provider', mountId: split.mountId, remotePath: split.remotePath, label }
  }
  return { kind: 'local', path: abs }
}

/** Split leading `-r`/`-f`-style flags off an operand list. */
function splitFlags(args: string[], allowed: string): { flags: Set<string>; rest: string[] } {
  const flags = new Set<string>()
  const rest: string[] = []
  for (const a of args) {
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      const letters = a.slice(1)
      if ([...letters].every((ch) => allowed.includes(ch))) {
        for (const ch of letters) flags.add(ch)
        continue
      }
      throw new Error(`usage: unknown flag -${letters} (allowed: -${allowed.split('').join('/')})`)
    }
    rest.push(a)
  }
  return { flags, rest }
}

function localDirExists(volume: Record<string, string>, path: string): boolean {
  if (path === '/') return true
  const prefix = `${path}/`
  return Object.keys(volume).some((k) => k.startsWith(prefix))
}

function localChildren(volume: Record<string, string>, dir: string): string[] {
  const prefix = dir === '/' ? '/' : `${dir}/`
  return Object.keys(volume).filter((k) => k.startsWith(prefix))
}

async function readEndpointFile(ep: Endpoint, deps: StaticCybshDeps): Promise<Uint8Array> {
  if (ep.kind === 'local') {
    const text = deps.readVolume()[ep.path]
    if (text === undefined) throw new Error('__missing__')
    return utf8Encode(text)
  }
  try {
    return await deps.providerRead(ep.mountId, ep.remotePath)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (/not_found|404|does not exist|no such/i.test(detail)) throw new Error('__missing__')
    throw e
  }
}

async function writeEndpointFile(ep: Endpoint, data: Uint8Array, deps: StaticCybshDeps): Promise<void> {
  if (ep.kind === 'local') {
    if (data.length > STATIC_WRITE_LIMIT) {
      throw new Error(`too_large: content is ${data.length} bytes, wasm write limit is ${STATIC_WRITE_LIMIT}`)
    }
    const text = utf8DecodeStrict(data)
    if (text === null) {
      throw new Error('unsupported: binary content cannot live in the text shell volume — keep it on the provider or use the dashboard')
    }
    await deps.writeVolumeFile(ep.path, text)
    return
  }
  if (!ep.remotePath) throw new Error(`invalid: cannot overwrite the mount root ${ep.label}`)
  await deps.providerWrite(ep.mountId, ep.remotePath, data)
}

/** Classify an endpoint: file (with bytes), directory, or missing. */
async function classifyEndpoint(
  ep: Endpoint,
  deps: StaticCybshDeps,
): Promise<{ kind: 'file'; bytes: Uint8Array } | { kind: 'dir' } | { kind: 'missing' }> {
  if (ep.kind === 'local') {
    const volume = deps.readVolume()
    if (volume[ep.path] !== undefined) return { kind: 'file', bytes: utf8Encode(volume[ep.path]) }
    return localDirExists(volume, ep.path) ? { kind: 'dir' } : { kind: 'missing' }
  }
  if (!ep.remotePath) return { kind: 'dir' }
  try {
    const bytes = await readEndpointFile(ep, deps)
    return { kind: 'file', bytes }
  } catch (e) {
    // Genuine transport failures surface; only `__missing__` falls through
    // to the listing, which decides dir vs missing. Git-backed mounts
    // cannot hold empty directories, so an empty listing is `missing`.
    if (e instanceof Error && e.message !== '__missing__') throw e
    const entries = await deps.providerList(ep.mountId, ep.remotePath).catch(() => null)
    if (entries && entries.length > 0) return { kind: 'dir' }
    return { kind: 'missing' }
  }
}

async function copyTree(
  src: Endpoint,
  dst: Endpoint,
  recursive: boolean,
  deps: StaticCybshDeps,
  tally: { files: number; bytes: number },
): Promise<void> {
  const cls = await classifyEndpoint(src, deps)
  if (cls.kind === 'missing') throw new Error('__missing__')
  if (cls.kind === 'dir' && !recursive) {
    throw new Error('__isdir__')
  }
  if (cls.kind === 'file') {
    let target = dst
    if (dst.kind === 'local' && localDirExists(deps.readVolume(), dst.path)) {
      target = { kind: 'local', path: `${dst.path === '/' ? '' : dst.path}/${baseName(srcLabel(src))}` }
    } else if (dst.kind === 'provider') {
      const listed = await deps.providerList(dst.mountId, dst.remotePath).catch(() => null)
      if (listed && listed.length > 0) {
        target = {
          kind: 'provider',
          mountId: dst.mountId,
          remotePath: `${dst.remotePath}/${baseName(srcLabel(src))}`.replace(/^\/+/, ''),
          label: `${dst.label}/${baseName(srcLabel(src))}`,
        }
      }
    }
    await writeEndpointFile(target, cls.bytes, deps)
    tally.files++
    tally.bytes += cls.bytes.length
    return
  }
  // Directory walk. Destination becomes a directory prefix on both sides.
  if (src.kind === 'local') {
    const volume = deps.readVolume()
    const strip = src.path === '/' ? 1 : src.path.length + 1
    for (const key of localChildren(volume, src.path)) {
      const rel = key.slice(strip)
      const childDst: Endpoint =
        dst.kind === 'local'
          ? { kind: 'local', path: `${dst.path === '/' ? '' : dst.path}/${rel}` }
          : {
              kind: 'provider',
              mountId: dst.mountId,
              remotePath: `${dst.remotePath}/${rel}`.replace(/^\/+/, ''),
              label: `${dst.label}/${rel}`,
            }
      await writeEndpointFile(childDst, utf8Encode(volume[key] ?? ''), deps)
      tally.files++
      tally.bytes += (volume[key] ?? '').length
    }
    return
  }
  const walk = async (remoteDir: string, dstPrefix: Endpoint): Promise<void> => {
    const entries = await deps.providerList(src.mountId, remoteDir)
    for (const e of entries) {
      const childRemote = remoteDir ? `${remoteDir}/${e.name}` : e.name
      if (e.isDir) {
        await walk(childRemote, dstPrefix)
        continue
      }
      const bytes = await readEndpointFile(
        {
          kind: 'provider',
          mountId: src.mountId,
          remotePath: childRemote,
          label: `/providers/${src.mountId}/${childRemote}`,
        },
        deps,
      )
      const rel = childRemote.slice(src.remotePath ? src.remotePath.length + 1 : 0)
      const childDst: Endpoint =
        dstPrefix.kind === 'local'
          ? { kind: 'local', path: `${dstPrefix.path === '/' ? '' : dstPrefix.path}/${rel}` }
          : {
              kind: 'provider',
              mountId: dstPrefix.mountId,
              remotePath: `${dstPrefix.remotePath}/${rel}`.replace(/^\/+/, ''),
              label: `${dstPrefix.label}/${rel}`,
            }
      await writeEndpointFile(childDst, bytes, deps)
      tally.files++
      tally.bytes += bytes.length
    }
  }
  await walk(src.remotePath, dst)
}

function srcLabel(ep: Endpoint): string {
  return ep.kind === 'local' ? ep.path : ep.label
}

async function deleteTree(ep: Endpoint, recursive: boolean, deps: StaticCybshDeps): Promise<{ files: number; bytes: number }> {
  const cls = await classifyEndpoint(ep, deps)
  if (cls.kind === 'missing') throw new Error('__missing__')
  if (cls.kind === 'file') {
    if (ep.kind === 'local') {
      const freed = await deps.deleteVolumePath(ep.path, false)
      return { files: 1, bytes: freed }
    }
    await deps.providerDelete(ep.mountId, ep.remotePath)
    return { files: 1, bytes: cls.bytes.length }
  }
  if (!recursive) throw new Error('__isdir__')
  if (ep.kind === 'local') {
    const volume = deps.readVolume()
    const keys = localChildren(volume, ep.path)
    let files = 0
    let freed = 0
    for (const key of keys) {
      try {
        freed += await deps.deleteVolumePath(key, false)
        files++
      } catch {
        // Best-effort per key; the summary reports what actually moved.
      }
    }
    return { files, bytes: freed }
  }
  let files = 0
  let bytes = 0
  const walk = async (remoteDir: string): Promise<void> => {
    const entries = await deps.providerList(ep.mountId, remoteDir)
    for (const e of entries) {
      const childRemote = remoteDir ? `${remoteDir}/${e.name}` : e.name
      if (e.isDir) {
        await walk(childRemote)
        continue
      }
      await deps.providerDelete(ep.mountId, childRemote)
      files++
      bytes += e.sizeBytes ?? 0
    }
  }
  await walk(ep.remotePath)
  return { files, bytes }
}

async function handleFileOp(
  verb: 'cp' | 'mv',
  args: string[],
  deps: StaticCybshDeps,
): Promise<VerbOut> {
  let flags: Set<string>
  let rest: string[]
  try {
    // `mv` is always recursive (like the native shell); `-r` is accepted
    // and ignored so `mv -r a b` muscle memory keeps working.
    ;({ flags, rest } = splitFlags(args, 'rRf'))
  } catch (e) {
    return shellErr(e instanceof Error ? e.message : String(e))
  }
  const recursive = flags.has('r') || flags.has('R')
  if (rest.length < 2) return shellErr(`usage: ${verb} [-r] <src> <dst>`)
  const cwd = await deps.getCwd().catch(() => '/')
  // `mv a b c` (multi-source) is dashboard territory; two-operand form only.
  if (rest.length > 2) {
    return shellErr(`unsupported: \`${verb}\` with ${rest.length} operands needs the dashboard shell (two-operand form only here)`)
  }
  const src = resolveEndpoint(cwd, rest[0])
  const dst = resolveEndpoint(cwd, rest[1])
  const tally = { files: 0, bytes: 0 }
  try {
    await copyTree(src, dst, verb === 'mv' ? true : recursive, deps, tally)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (detail === '__missing__') return shellErr(`not_found: ${rest[0]}`)
    if (detail === '__isdir__') return shellErr(`is a directory: ${rest[0]} (use -r)`)
    return shellErr(detail)
  }
  if (verb === 'mv') {
    try {
      await deleteTree(src, true, deps)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return shellErr(`conflict: copied ${tally.files} file(s) but the source would not delete (${detail})`)
    }
  }
  const what = `${tally.files} file${tally.files === 1 ? '' : 's'} · ${humanBytes(tally.bytes)}`
  return shellOk(`${srcLabel(src)} -> ${srcLabel(dst)} (${what}${verb === 'mv' ? ' moved' : ' copied'})`)
}

async function handleRm(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  let flags: Set<string>
  let rest: string[]
  try {
    ;({ flags, rest } = splitFlags(args, 'rRf'))
  } catch (e) {
    return shellErr(e instanceof Error ? e.message : String(e))
  }
  if (rest.length === 0) return shellErr('usage: rm [-r] [-f] <path>…')
  const recursive = flags.has('r') || flags.has('R')
  const force = flags.has('f')
  const cwd = await deps.getCwd().catch(() => '/')
  const lines: string[] = []
  let failed = 0
  let files = 0
  let bytes = 0
  for (const raw of rest) {
    const ep = resolveEndpoint(cwd, raw)
    try {
      const done = await deleteTree(ep, recursive, deps)
      files += done.files
      bytes += done.bytes
      lines.push(`removed ${srcLabel(ep)}`)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (detail === '__missing__') {
        if (force) continue
        lines.push(`not_found: ${raw}`)
        failed++
        continue
      }
      if (detail === '__isdir__') {
        lines.push(`is a directory: ${raw} (use -r)`)
        failed++
        continue
      }
      lines.push(detail)
      failed++
    }
  }
  if (files > 0) lines.push(`${files} file${files === 1 ? '' : 's'} removed · ${humanBytes(bytes)} freed`)
  return (failed > 0 ? shellErr : shellOk)(lines.join('\n') || 'nothing removed')
}

async function handleMkdir(args: string[], deps: StaticCybshDeps): Promise<VerbOut> {
  let rest: string[]
  try {
    ;({ rest } = splitFlags(args, 'p'))
  } catch (e) {
    return shellErr(e instanceof Error ? e.message : String(e))
  }
  if (rest.length === 0) return shellErr('usage: mkdir [-p] <dir>…')
  const cwd = await deps.getCwd().catch(() => '/')
  for (const raw of rest) {
    const ep = resolveEndpoint(cwd, raw)
    if (ep.kind === 'local') {
      if (ep.path === '/') continue
      const volume = deps.readVolume()
      if (volume[ep.path] !== undefined) {
        return shellErr(`conflict: ${raw} exists and is a file`)
      }
      // Directories are implied by paths; the `.keep` marker makes the
      // empty directory visible to `ls`/`cd` (same as the wasm `mkdir` arm).
      await deps.writeVolumeFile(`${ep.path}/.keep`, '')
    } else {
      if (!ep.remotePath) continue
      // Git-backed mounts cannot hold empty directories — the `.keep`
      // marker is the portable equivalent (and `rm -r` cleans it).
      await deps.providerWrite(ep.mountId, `${ep.remotePath}/.keep`, new Uint8Array())
    }
  }
  return shellOk(rest.length === 1 ? `made ${rest[0]}` : `made ${rest.length} directories`)
}

/**
 * Run one terminal line against the local vault. Returns `null` when the
 * line is not ours (chained line, unknown verb) so the caller falls through
 * to the wasm dispatcher. Never throws — handler failures become
 * `{ ok: false }` shell answers with the house `prefix: detail` contract.
 */
export async function runStaticCybshLine(
  line: string,
  deps: StaticCybshDeps,
): Promise<ShellResult | null> {
  let parsed: ParsedLine | null
  try {
    parsed = parseCybshLine(line)
  } catch {
    return null
  }
  if (!parsed || !handlesStaticVerb(parsed.verb)) return null
  const done = (out: VerbOut): ShellResult => ({
    ok: out.ok,
    line,
    output: out.text,
    ...(out.ok ? {} : { error: out.text }),
    prompt: 'cybsh> ',
  })
  try {
    const { verb, args, json } = parsed
    switch (verb) {
      case 'echo':
        return done(shellOk(args.join(' ')))
      case 'cp':
      case 'mv':
        return done(await handleFileOp(verb, args, deps))
      case 'rm':
        return done(await handleRm(args, deps))
      case 'mkdir':
        return done(await handleMkdir(args, deps))
      case 'kill': {
        const id = parseInt(args[0] ?? '', 10)
        if (!Number.isInteger(id)) return done(shellErr('usage: kill <id>'))
        try {
          const removed = await deps.killTask(id)
          return done(removed ? shellOk(`killed task ${id}`) : shellErr(`not_found: no task ${id}`))
        } catch (e) {
          return done(
            shellErr(
              `unsupported: kill needs the rebuilt wasm task table (${e instanceof Error ? e.message : String(e)}) — \`ps\` still lists tasks`,
            ),
          )
        }
      }
      case 'quota':
        return done(await handleQuota(args, json, deps))
      case 'providers':
        return done(await handleProviders(args, json, deps))
      case 'oauth':
        return done(await handleOauth(args, json, deps))
      case 'disk':
        return done(await handleDisk(args, json, deps))
      case 'sync':
        return done(await handleSync(args, json, deps))
      case 'mount':
        return done(await handleMount(args, json, deps))
      case 'umount':
        return done(
          shellErr('unsupported: `umount` detaches provider mounts managed by the dashboard — remove the mount from its provider card on this build'),
        )
      case 'encrypt':
        return done(await handleEncrypt(args, deps))
      case 'decrypt':
        return done(await handleDecrypt(args, deps))
      case 'keygen':
        return done(await handleKeygen(args, deps))
      case 'compress':
        return done(await handleCompress(args, deps, 'lz4'))
      case 'decompress':
        return done(await handleDecompress(args, deps))
      case 'scrub':
        return done(await handleScrub(args, deps))
      case 'repair':
        return done(await handleRepair(args, deps))
      case 'gc':
        return done(await handleGc(args, deps))
      case 'lease':
        return done(
          shellOk('no lease held for browser scope (this tab owns the local vault volume) · provider single-writer leases need the dashboard'),
        )
      case 'ai':
        return done(
          shellErr('unsupported: `ai ask` needs a detached worker — run it from the Agent panel or POST /api/os/exec on the dashboard; see docs/OPERATIONS.md'),
        )
      default:
        return null
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return done(shellErr(detail))
  }
}
