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

export function vaultReadme(fullName: string, branch: string): string {
  return [
    `# ${fullName || 'cybermanju-vault'}`,
    '',
    'Private CyberManju OS vault — created from Accounts → Connections.',
    '',
    `- \`vault.cybermanju\` — encrypted vault container (the file this app opens).`,
    `- \`.cybermanju.json\` — vault manifest (version, branch, updated-at).`,
    '',
    `Branch: \`${branch || DEFAULT_VAULT_BRANCH}\``,
    '',
    '> Do not edit these files by hand — use the app so hashes stay verifiable.',
    '',
  ].join('\n')
}

export function vaultManifest(fullName: string, branch: string): string {
  return JSON.stringify(
    {
      app: 'cybermanju-os',
      version: 1,
      repo: fullName,
      branch: branch || DEFAULT_VAULT_BRANCH,
      vaultFile: VAULT_FILE_PATH,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n'
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
export function buildSeedFiles(fullName: string, branch: string): Array<{ path: string; contentBase64: string }> {
  return [
    { path: VAULT_README_PATH, contentBase64: encodeUtf8Base64(vaultReadme(fullName, branch)) },
    { path: VAULT_MANIFEST_PATH, contentBase64: encodeUtf8Base64(vaultManifest(fullName, branch)) },
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
  vaultBytes?: Uint8Array | null
  saveConfig: (cfg: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SyncConfig | null>
  seedViaBackend: (cfg: SyncConfig, files: Array<{ path: string; contentBase64: string }>) => Promise<unknown>
  probe: (cfg: SyncConfig) => Promise<{ ok: boolean; detail: string }>
  createDisk: (configId: string, sizeBytes: number, passphrase: string) => Promise<{ id: string } | null>
  attachDisk: (diskId: string, passphrase: string) => Promise<unknown>
  useDirectSeed: boolean
}): Promise<{ config: SyncConfig; diskId: string | null }> {
  const branch = deps.repo.branch || DEFAULT_VAULT_BRANCH
  const baseCfg: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'> = {
    backendType: deps.backendType,
    enabled: true,
    autoSync: false,
    compressBeforeUpload: false,
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
  const files = buildSeedFiles(deps.repo.fullName, branch)
  if (deps.vaultBytes && deps.vaultBytes.length > 0) {
    files.push({ path: VAULT_FILE_PATH, contentBase64: encodeBytesBase64(deps.vaultBytes) })
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
  return { config: saved, diskId }
}
