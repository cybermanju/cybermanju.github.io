// CyberManju OS — VersionCheck (src/utils/versionCheck.ts).
// Role: pure TS helpers + live version resolver (unit-testable).
// Exports: currentVersion, parseVersion, compareVersions, isOutdated,
//   fetchLatestVersion, checkForUpdate, UpdateStatus.
// Integrates: fetch, import.meta.env.VITE_APP_VERSION,
//   @/utils/installLinks (releasePageUrl fallback).
// Contracts: semver-ish compare (major.minor.patch, optional 'v' prefix,
//   prerelease ignored); never throws past caller; network failures degrade
//   to latest: null + outdated: false so the UI stays honest instead of
//   spamming retries.

export interface UpdateStatus {
  current: string
  latest: string | null
  /** True only when latest is known AND strictly newer than current. */
  outdated: boolean
  /** Direct link to the release / install page for applying the update. */
  updateUrl: string | null
  checkedAt: number | null
  error: string | null
}

/** Version baked at build time from package.json (single source of truth). */
export const currentVersion: string =
  typeof import.meta.env?.VITE_APP_VERSION === 'string' && import.meta.env.VITE_APP_VERSION
    ? import.meta.env.VITE_APP_VERSION
    : '0.0.0'

const RELEASE_API = 'https://api.github.com/repos/cybermanju/cybermanju.github.io/releases/latest'

/** Parse "v1.2.3" / "1.2.3" / "1.2.3-rc1" → [major, minor, patch]. */
function parseVersion(version: string): [number, number, number] {
  const clean = String(version ?? '').replace(/^v/i, '').trim()
  const [major = '0', minor = '0', patch = '0'] = clean.split(/[.-]/)
  return [
    Number.parseInt(String(major).replace(/\D/g, '') || '0', 10),
    Number.parseInt(String(minor).replace(/\D/g, '') || '0', 10),
    Number.parseInt(String(patch).replace(/\D/g, '') || '0', 10),
  ]
}

/** -1 | 0 | 1 comparing two semver-ish versions. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPat] = parseVersion(a)
  const [bMaj, bMin, bPat] = parseVersion(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPat !== bPat) return aPat < bPat ? -1 : 1
  return 0
}

/** True when `current` is strictly older than `latest`. */
export function isOutdated(current: string, latest: string | null): boolean {
  if (!latest) return false
  return compareVersions(current, latest) < 0
}

/** Strip a leading "v" from a release tag. */
function normalizeTag(tag: string): string {
  return String(tag ?? '').replace(/^v/i, '').trim()
}

/**
 * Resolve the latest released version from the GitHub releases API.
 * Accepts an optional `fetcher` (defaults to global fetch) so the function
 * is unit-testable without the network. Returns null on any failure.
 */
export async function fetchLatestVersion(
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      // Keep the probe short so a hung network never stalls the boot flow.
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { tag_name?: string }
    const tag = normalizeTag(body.tag_name ?? '')
    return tag || null
  } catch {
    return null
  }
}

/** Release page URL (fallback when we can't resolve per-asset URLs). */
function defaultUpdateUrl(): string {
  return `https://github.com/cybermanju/cybermanju.github.io/releases/latest`
}

/**
 * One-shot update check: read the baked current version, resolve the latest
 * release, compare, and return a status object. Never throws.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const status: UpdateStatus = {
    current: currentVersion,
    latest: null,
    outdated: false,
    updateUrl: defaultUpdateUrl(),
    checkedAt: null,
    error: null,
  }
  try {
    const latest = await fetchLatestVersion()
    status.latest = latest
    status.checkedAt = Date.now()
    if (latest) {
      status.outdated = isOutdated(currentVersion, latest)
    }
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e)
  }
  return status
}

export default {
  currentVersion,
  parseVersion,
  compareVersions,
  isOutdated,
  fetchLatestVersion,
  checkForUpdate,
}
