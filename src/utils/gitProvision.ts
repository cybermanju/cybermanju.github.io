// CyberManju OS — private vault repo provisioning (GitHub + GitLab).
//
// One flow turns a pasted PAT / OAuth token into a fully synced system:
//
//   create private repo → save provider config → seed README + manifest +
//   exported `vault.cybermanju` → verify → provision + attach system disk.
//
// Transports:
//   desktop / Docker  → `create_provider_repo` / `seed_repo_files` (Rust
//                       backends, same error-prefix contract as sync).
//   static Pages host → direct `fetch` to api.github.com / gitlab.com
//                       (both send CORS headers; tokens stay in the form).

import type { SyncBackendType, SyncConfig } from '@/types'

export interface CreatedRepo {
  backend: string
  repoName: string
  fullName: string
  branch: string
  url: string
  projectId?: string | null
}

export interface ProvisionInput {
  backendType: Extract<SyncBackendType, 'github' | 'gitlab'>
  /** Freshly typed PAT (or OAuth token). Never persisted here. */
  token: string
  /** `my-vault` or `owner/my-vault` — only the last segment is sent. */
  name: string
  /** Always true from the UI; kept explicit so tests pin the default. */
  privateRepo?: boolean
  description?: string
  branch?: string
  /** GitLab self-hosted instance (empty = gitlab.com). */
  instanceUrl?: string
  displayName?: string
}

/** Canonical vault layout inside every provisioned repo. */
export const VAULT_FILE_PATH = 'vault.cybermanju'
export const VAULT_README_PATH = 'README.md'
export const VAULT_MANIFEST_PATH = '.cybermanju.json'
export const DEFAULT_VAULT_REPO = 'cybermanju-vault'
export const DEFAULT_VAULT_BRANCH = 'main'
/** Upper bound for one repo-set provisioning run (provider rate limits). */
export const MAX_VAULT_REPOS = 8
/** Seed endpoint cap per file — mirrored vaults bigger than this seed
 *  README + manifest only (the live sync still carries the data). */
export const MAX_SEED_BYTES = 5 * 1024 * 1024

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/

export function lastSegment(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .pop() ?? ''
}

/** `my-vault` / `owner/my-vault` → error string, or `''` when valid. */
export function validateRepoName(name: string): string {
  const seg = lastSegment(name)
  if (!seg) return 'Give the repo a name — e.g. cybermanju-vault.'
  if (seg === '.' || seg === '..') return 'That name is reserved — pick another.'
  if (!SEGMENT_RE.test(seg)) {
    return 'Letters, numbers, "-", "_" or "." only (max 100 chars).'
  }
  return ''
}

/** Suggest `name`, `name-2`, … given the taken names (case-insensitive). */
export function suggestRepoName(wanted: string, taken: string[] = []): string {
  const base = lastSegment(wanted) || DEFAULT_VAULT_REPO
  const lower = new Set(taken.map((t) => lastSegment(t).toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let i = 2; i < 100; i++) {
    const cand = `${base}-${i}`
    if (!lower.has(cand.toLowerCase())) return cand
  }
  return `${base}-${Date.now().toString(36)}`
}

export function defaultVaultRepoName(): string {
  return DEFAULT_VAULT_REPO
}

export function vaultReadme(fullName: string, branch: string, set?: VaultSetInfo): string {
  const setLine = set && set.total > 1
    ? `Vault set \`${set.name}\` — repo ${set.index} of ${set.total} (disks merge into one virtual volume).`
    : null
  return [
    `# ${fullName || 'cybermanju-vault'}`,
    '',
    'Private CyberManju OS vault — created from Accounts → Connections.',
    ...(setLine ? ['', setLine] : []),
    '',
    `- \`vault.cybermanju\` — encrypted + compressed vault container (the file this app opens).`,
    `- \`.cybermanju.json\` — vault manifest (version, branch, updated-at).`,
    '',
    `Branch: \`${branch || DEFAULT_VAULT_BRANCH}\``,
    '',
    '> Do not edit these files by hand — use the app so hashes stay verifiable.',
    '',
  ].join('\n')
}

export interface VaultSetInfo {
  /** Base name of the set (`cybermanju-vault`). */
  name: string
  /** 1-based index of this repo inside the set. */
  index: number
  /** Total repos in the set (merged into one virtual disk). */
  total: number
}

export function vaultManifest(fullName: string, branch: string, set?: VaultSetInfo): string {
  return JSON.stringify(
    {
      app: 'cybermanju-os',
      version: 1,
      repo: fullName,
      branch: branch || DEFAULT_VAULT_BRANCH,
      vaultFile: VAULT_FILE_PATH,
      ...(set ? { set } : {}),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n'
}

/** Clamp a requested repo count into the supported range. */
export function validateRepoCount(n: unknown): number {
  const parsed = typeof n === 'number' ? Math.floor(n) : parseInt(String(n ?? ''), 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_VAULT_REPOS, Math.max(1, parsed))
}

/**
 * Expand a base name into per-repo names: `vault` → [`vault`] for one repo,
 * `vault` → [`vault-1`, …, `vault-N`] for a set. Every name stays valid for
 * `validateRepoName` (suffixes are appended to the last segment only).
 */
export function expandRepoNames(base: string, count: number): string[] {
  const n = validateRepoCount(count)
  const seg = lastSegment(base) || DEFAULT_VAULT_REPO
  const prefix = String(base ?? '').trim().replace(/^\/+|\/+$/g, '')
  const head = prefix.includes('/') ? `${prefix.slice(0, prefix.lastIndexOf('/') + 1)}` : ''
  if (n === 1) return [`${head}${seg}`]
  return Array.from({ length: n }, (_, i) => `${head}${seg}-${i + 1}`)
}

export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function encodeBytesBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Bootstrap files for a fresh vault repo (README + manifest). */
export function buildSeedFiles(
  fullName: string,
  branch: string,
  set?: VaultSetInfo,
): Array<{ path: string; contentBase64: string }> {
  return [
    { path: VAULT_README_PATH, contentBase64: encodeUtf8Base64(vaultReadme(fullName, branch, set)) },
    { path: VAULT_MANIFEST_PATH, contentBase64: encodeUtf8Base64(vaultManifest(fullName, branch, set)) },
  ]
}

function gitlabBase(instanceUrl?: string): string {
  const raw = String(instanceUrl ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(raw) ? raw : 'https://gitlab.com'
}

function classifyCreateError(status: number, body: string, provider: string): Error {
  const snippet = String(body || '').slice(0, 300)
  if (status === 401 || status === 403) {
    return new Error(`auth: ${provider} rejected the token (HTTP ${status}) — check scopes (github: repo, gitlab: api) ${snippet}`)
  }
  if (status === 422 || status === 400) {
    const taken = /already|taken|exists|duplicate/i.test(snippet)
    if (taken) return new Error(`conflict: that repo name is taken on ${provider} — pick another name`)
    return new Error(`unsupported: ${provider} refused the repo name (HTTP ${status}): ${snippet}`)
  }
  if (status === 404) return new Error(`not_found: ${provider} repo endpoint missing (HTTP 404) — check the instance URL`)
  if (status === 429) return new Error(`rate_limited: ${provider} throttled repo creation — wait a minute and retry`)
  return new Error(`network: ${provider} repo creation failed (HTTP ${status}): ${snippet}`)
}

/**
 * Direct browser creation (static Pages host — no dashboard behind the page).
 * Desktop/Docker builds go through `create_provider_repo` (Rust) instead.
 */
export async function createRepoDirect(input: ProvisionInput): Promise<CreatedRepo> {
  const name = lastSegment(input.name)
  const problem = validateRepoName(input.name)
  if (problem) throw new Error(`unsupported: ${problem}`)
  const token = input.token.trim()
  if (!token) throw new Error('auth: paste a token first — repo creation needs one')
  const branch = input.branch?.trim() || DEFAULT_VAULT_BRANCH
  const description = input.description?.trim() || 'Private CyberManju OS vault (.cybermanju)'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    if (input.backendType === 'github') {
      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, private: input.privateRepo !== false, description, auto_init: true, default_branch: branch }),
        signal: ctrl.signal,
      }).catch(() => {
        throw new Error('network: api.github.com is not reachable from this browser (offline or blocked) — use the desktop app or Docker server')
      })
      if (!res.ok) throw classifyCreateError(res.status, await res.text().catch(() => ''), 'GitHub')
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const full = typeof json.full_name === 'string' && json.full_name ? json.full_name : name
      return {
        backend: 'github',
        repoName: full,
        fullName: full,
        branch: typeof json.default_branch === 'string' && json.default_branch ? json.default_branch : branch,
        url: typeof json.html_url === 'string' && json.html_url ? json.html_url : `https://github.com/${full}`,
        projectId: null,
      }
    }
    const base = gitlabBase(input.instanceUrl)
    const res = await fetch(`${base}/api/v4/projects`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        path: name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'cybermanju-vault',
        visibility: input.privateRepo !== false ? 'private' : 'public',
        description,
        initialize_with_readme: true,
        default_branch: branch,
      }),
      signal: ctrl.signal,
    }).catch(() => {
      throw new Error(`network: ${base} is not reachable from this browser (offline or blocked) — use the desktop app or Docker server`)
    })
    if (!res.ok) throw classifyCreateError(res.status, await res.text().catch(() => ''), 'GitLab')
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof json.id === 'number' ? String(json.id) : typeof json.id === 'string' ? json.id : ''
    const full = typeof json.path_with_namespace === 'string' && json.path_with_namespace ? json.path_with_namespace : name
    return {
      backend: 'gitlab',
      repoName: id,
      fullName: full,
      branch: typeof json.default_branch === 'string' && json.default_branch ? json.default_branch : branch,
      url: typeof json.web_url === 'string' && json.web_url ? json.web_url : `${base}/${full}`,
      projectId: id || null,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Seed files straight into a fresh repo from the browser (static host). */
export async function seedRepoDirect(
  backendType: 'github' | 'gitlab',
  repo: CreatedRepo,
  token: string,
  files: Array<{ path: string; contentBase64: string }>,
  instanceUrl?: string,
): Promise<string[]> {
  const urls: string[] = []
  if (backendType === 'github') {
    const [owner, name] = repo.fullName.split('/')
    if (!owner || !name) throw new Error('unsupported: GitHub repo has no owner/name yet — create it first')
    for (const f of files) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${f.path}`, {
        method: 'PUT',
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `CyberManju vault seed: ${f.path}`, content: f.contentBase64, branch: repo.branch }),
      })
      if (!res.ok && res.status !== 422) {
        const body = await res.text().catch(() => '')
        throw new Error(`network: GitHub seed of '${f.path}' failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
      }
      urls.push(`https://github.com/${owner}/${name}/blob/${repo.branch}/${f.path}`)
    }
    return urls
  }
  const base = gitlabBase(instanceUrl)
  const pid = encodeURIComponent(repo.repoName)
  for (const f of files) {
    // Create-or-update: try POST, fall back to PUT when the file exists
    // (fresh repos only have the README, so POST usually wins).
    const body = JSON.stringify({ branch: repo.branch, content: f.contentBase64, encoding: 'base64', commit_message: `CyberManju vault seed: ${f.path}` })
    let res = await fetch(`${base}/api/v4/projects/${pid}/repository/files/${encodeURIComponent(f.path)}`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      res = await fetch(`${base}/api/v4/projects/${pid}/repository/files/${encodeURIComponent(f.path)}`, {
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
        body,
      })
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`network: GitLab seed of '${f.path}' failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
    urls.push(`${base}/${repo.fullName}/-/blob/${repo.branch}/${f.path}`)
  }
  return urls
}

/**
 * Full synced-system provisioning after the repo exists:
 * save provider config → seed README/manifest (+ vault bytes when given) →
 * probe → create + attach a system disk. Returns the saved config + disk id.
 */
export async function provisionSyncedSystem(deps: {
  backendType: 'github' | 'gitlab'
  repo: CreatedRepo
  token: string
  displayName: string
  instanceUrl?: string
  diskSizeMb?: number
  diskPassphrase?: string
  /** Compress uploads on future syncs (the container itself is always LZ4). */
  compressBeforeUpload?: boolean
  /** Set membership for the manifest when provisioning N repos at once. */
  set?: VaultSetInfo
  vaultBytes?: Uint8Array | null
  saveConfig: (cfg: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SyncConfig | null>
  seedViaBackend: (cfg: SyncConfig, files: Array<{ path: string; contentBase64: string }>) => Promise<unknown>
  probe: (cfg: SyncConfig) => Promise<{ ok: boolean; detail: string }>
  createDisk: (configId: string, sizeBytes: number, passphrase: string) => Promise<{ id: string } | null>
  attachDisk: (diskId: string, passphrase: string) => Promise<unknown>
  useDirectSeed: boolean
}): Promise<{ config: SyncConfig; diskId: string | null; vaultSeeded: boolean }> {
  const branch = deps.repo.branch || DEFAULT_VAULT_BRANCH
  const baseCfg: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'> = {
    backendType: deps.backendType,
    enabled: true,
    autoSync: false,
    compressBeforeUpload: deps.compressBeforeUpload !== false,
    createPreviews: false,
    deleteRawAfterSync: false,
    maxConcurrentUploads: 1,
    encryptBeforeUpload: true,
    conflictPolicy: 'skip',
    placement: 'whole',
    parity: 1,
    name: deps.displayName || `${deps.repo.fullName} vault`,
    repoName: deps.repo.repoName,
    branch,
    token: deps.token.trim() || undefined,
    ...(deps.backendType === 'gitlab' && deps.instanceUrl?.trim()
      ? { basePath: deps.instanceUrl.trim().replace(/\/+$/, '') }
      : {}),
  }
  const saved = await deps.saveConfig(baseCfg)
  if (!saved?.id) throw new Error('network: provider config could not be saved — retry')
  const files = buildSeedFiles(deps.repo.fullName, branch, deps.set)
  // Mirror the encrypted + compressed container into every repo of the set.
  // Oversized vaults skip the file seed (README + manifest still land; the
  // live sync carries the data instead of a 5 MiB-capped seed commit).
  let vaultSeeded = false
  if (deps.vaultBytes && deps.vaultBytes.length > 0 && deps.vaultBytes.length <= MAX_SEED_BYTES) {
    files.push({ path: VAULT_FILE_PATH, contentBase64: encodeBytesBase64(deps.vaultBytes) })
    vaultSeeded = true
  }
  if (deps.useDirectSeed) {
    await seedRepoDirect(deps.backendType, deps.repo, deps.token, files, deps.instanceUrl)
  } else {
    await deps.seedViaBackend(saved, files)
  }
  const probe = await deps.probe({ ...saved, token: deps.token.trim() || saved.token })
  if (!probe.ok) throw new Error(`network: repo created and seeded, but the probe failed — ${probe.detail}`)
  const mb = Math.min(8192, Math.max(64, Math.round(deps.diskSizeMb ?? 512)))
  let diskId: string | null = null
  try {
    const disk = await deps.createDisk(saved.id, mb * 1024 * 1024, deps.diskPassphrase ?? '')
    diskId = disk?.id ?? null
    if (diskId) await deps.attachDisk(diskId, deps.diskPassphrase ?? '').catch(() => undefined)
  } catch (e) {
    // The repo + config + seed are all live — a disk failure must not look
    // like a provisioning failure. Surface it through the returned null.
    console.warn('[vault-provision] system disk step failed (repo is still synced):', e)
  }
  return { config: saved, diskId, vaultSeeded }
}

export interface VaultSetResult {
  repos: CreatedRepo[]
  configs: SyncConfig[]
  diskIds: (string | null)[]
  /** Sum of the requested per-disk sizes (bytes). */
  totalDiskBytes: number
  /** Every repo whose step failed — the rest of the set is still live. */
  failures: Array<{ name: string; error: string }>
}

/**
 * Provision a whole set of private vault repos on one provider (1–8):
 * sequential create → config → seed (mirrored encrypted vault) → probe →
 * encrypted system disk per repo. Disks merge into one virtual volume, so
 * N repos × M MB = N×M of merged space.
 *
 * Partial failure is normal (name taken, rate limit): failures are collected
 * per repo and the run resolves when at least one repo synced; it rejects
 * only when nothing succeeded.
 */
export async function provisionVaultRepoSet(deps: {
  backendType: 'github' | 'gitlab'
  baseName: string
  count: number
  token: string
  description?: string
  branch?: string
  instanceUrl?: string
  displayPrefix?: string
  diskSizeMb?: number
  diskPassphrase?: string
  compressBeforeUpload?: boolean
  vaultBytes?: Uint8Array | null
  createRepo: (input: ProvisionInput) => Promise<CreatedRepo>
  saveConfig: (cfg: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SyncConfig | null>
  seedViaBackend: (cfg: SyncConfig, files: Array<{ path: string; contentBase64: string }>) => Promise<unknown>
  probe: (cfg: SyncConfig) => Promise<{ ok: boolean; detail: string }>
  createDisk: (configId: string, sizeBytes: number, passphrase: string) => Promise<{ id: string } | null>
  attachDisk: (diskId: string, passphrase: string) => Promise<unknown>
  useDirectSeed: boolean
  onProgress?: (done: number, total: number, stage: string, name: string) => void
}): Promise<VaultSetResult> {
  const total = validateRepoCount(deps.count)
  const names = expandRepoNames(deps.baseName, total)
  const branch = deps.branch?.trim() || DEFAULT_VAULT_BRANCH
  const setName = lastSegment(deps.baseName) || DEFAULT_VAULT_REPO
  const result: VaultSetResult = { repos: [], configs: [], diskIds: [], totalDiskBytes: 0, failures: [] }
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    try {
      deps.onProgress?.(i, total, 'creating repo', name)
      const repo = await deps.createRepo({
        backendType: deps.backendType,
        token: deps.token,
        name,
        privateRepo: true,
        description: deps.description,
        branch,
        instanceUrl: deps.instanceUrl,
      })
      deps.onProgress?.(i, total, 'seeding + disk', repo.fullName)
      const { config, diskId } = await provisionSyncedSystem({
        backendType: deps.backendType,
        repo,
        token: deps.token,
        displayName: `${deps.displayPrefix || setName} ${i + 1}/${total}`,
        instanceUrl: deps.instanceUrl,
        diskSizeMb: deps.diskSizeMb,
        diskPassphrase: deps.diskPassphrase,
        compressBeforeUpload: deps.compressBeforeUpload,
        set: total > 1 ? { name: setName, index: i + 1, total } : undefined,
        vaultBytes: deps.vaultBytes,
        saveConfig: deps.saveConfig,
        seedViaBackend: deps.seedViaBackend,
        probe: deps.probe,
        createDisk: deps.createDisk,
        attachDisk: deps.attachDisk,
        useDirectSeed: deps.useDirectSeed,
      })
      result.repos.push(repo)
      result.configs.push(config)
      result.diskIds.push(diskId)
      deps.onProgress?.(i + 1, total, diskId ? 'synced' : 'synced (disk skipped)', repo.fullName)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.failures.push({ name, error })
      deps.onProgress?.(i + 1, total, `failed: ${error.slice(0, 80)}`, name)
    }
  }
  if (result.repos.length === 0) {
    const first = result.failures[0]
    throw new Error(first ? first.error : 'network: repo set provisioning failed')
  }
  const mb = Math.min(8192, Math.max(64, Math.round(deps.diskSizeMb ?? 512)))
  result.totalDiskBytes = result.diskIds.filter((d): d is string => !!d).length * mb * 1024 * 1024
  return result
}
