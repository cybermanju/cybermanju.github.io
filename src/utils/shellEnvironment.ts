// CyberManju OS — Device shell environment (src/utils/shellEnvironment.ts).
//
// The environment a child process inherits must be SYNTHETIC, not
// inherited from the host: host environments leak platform/vendor junk
// into every shell, so well-built terminals clear the environment and
// re-put a short allowlist. Our own contract (AGENTS.md §5) already
// states the device shell spawns scrubbed — `env_clear`, PATH/locale
// only. This module is the in-app twin of that invariant: everything
// that later spawns local/device helpers or renders "what the shell
// will see" builds from these helpers, so even a compromised
// configuration cannot inflate the device env.
//
// The dotenv emitter writes a canonical, sourceable environment file:
// later shells re-derive the exact device environment without re-reading
// the parent process (a future `cyb env` can paste this file over ssh
// as the seed).
//
// Role: pure scrubbed-device-env builder + canonical dotenv writer.
// Exports: DEVICE_ENV_ALLOWLIST, buildDeviceShellEnv, toDotenv,
//          renderDeviceEnvFile, parseDotenv.
// Integrates: pure — no imports (keeps the allowlist auditable).
// Contracts: only allowlisted keys ever leave the wall; PATH is the single
//            growth point; values are POSIX-quoted (`'` with `'\''`).

/**
 * The whole environment wall for device-side child processes — additions
 * are a reviewed design decision here, not incidental host leakage.
 * Mirrors the AGENTS.md contract: `env_clear`, PATH/locale only.
 */
export const DEVICE_ENV_ALLOWLIST = ['LANG', 'LC_ALL', 'PATH', 'TZ'] as readonly string[]


export interface DeviceEnvOptions {
  /**
   * Extra PATH entries prepended to the host PATH (app paths the device
   * runbook installs, e.g. the cyb binary). Duplicates dropped.
   */
  pathPrefix?: string[]
  /** Subdirectory to treat as the child's HOME ("" = inherit from host). */
  home?: string
  /** Working directory handed to the spawner as PWD when set. */
  workingDirectory?: string
}


/**
 * Build the scrubbed device environment from a host environment map.
 * Unknown keys are dropped silently — allowlist additions are a design
 * decision gated by `DEVICE_ENV_ALLOWLIST`, never by data.
 */
export function buildDeviceShellEnv(
  hostEnv: Record<string, string> | undefined,
  opts: DeviceEnvOptions = {},
): Record<string, string> {
  const host = hostEnv ?? {}
  const out: Record<string, string> = {}
  for (const key of DEVICE_ENV_ALLOWLIST) {
    const v = host[key]
    if (v !== undefined && v !== '') out[key] = v
  }
  // Locale fallbacks omitted on purpose: an absent LANG means the child
  // uses its compiled default — hermetic by construction.
  if (opts.workingDirectory) out.PWD = opts.workingDirectory.replace(/[\r\n]/g, '')
  if (opts.home) out.HOME = opts.home.replace(/[\r\n]/g, '')
  else if (!out.HOME) out.HOME = '/tmp'
  // PATH is the one allowlist entry the caller may grow — app paths first,
  // then the host PATH. No duplicates, no empties.
  const hostPath = out.PATH ?? '/usr/bin:/bin'
  const entries = [...opts.pathPrefix ?? [], hostPath]
    .flatMap(p => p.split(':'))
    .map(p => p.trim())
    .filter(p => p !== '')
  out.PATH = Array.from(new Set(entries)).join(':')
  return out
}

/** POSIX-quote a value for safe dotenv consumption (`sh`-sourced). */
function posixQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/i.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Canonical dotenv lines, sorted for stable diffs. Multi-line values are
 * not representable in a POSIX dotenv — blank them (documented limit).
 */
export function toDotenv(env: Record<string, string>): string[] {
  return Object.keys(env).sort().map(key => {
    const v = String(env[key] ?? '')
    if (/[\r\n]/.test(v)) return `${key}=` // documented: multi-line unsupported
    return `${key}=${posixQuote(v)}`
  })
}

/** Full env-file body with a machine comments header (`cyb env` output). */
export function renderDeviceEnvFile(title: string, env: Record<string, string>): string {
  const stamp = new Date().toISOString()
  const lines = [
    `# ${title} — CyberManju OS scrubbed device environment`,
    `# Generated ${stamp}. Allowlist: ${DEVICE_ENV_ALLOWLIST.join(', ')}.`,
    '# Source from any shell to re-derive the canonical environment.',
    ...toDotenv(env),
    '',
  ]
  return lines.join('\n')
}

/** Minimal dotenv reader for tests and round-trips (`A=b` lines only). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq)
    let value = line.slice(eq + 1)
    if (value.startsWith("'") && value.length >= 2) {
      // Renderer shape: `'` parts `'` between embedded `'\''` sequences.
      const body = value.slice(1)
      const close = body.lastIndexOf("'")
      value = close > -1 ? body.slice(0, close).replaceAll(`'\\''`, `'`) : value
    }
    out[key] = value
  }
  return out
}
