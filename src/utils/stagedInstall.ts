// CyberManju OS — Staged installs (src/utils/stagedInstall.ts).
//
// The staged install → promote invariant: everything this OS mutates is
// written into a `.staging-<salt>` sibling FIRST and renamed into place
// only after validation. A crash mid-write can then never leave a
// half-mutated final path — "installed" is defined exactly once as "the
// promoted path exists and is complete", so every operation heals itself
// without checkpoints. CyberManju already had the seed of this in the
// sync temps (`cybermanju-up-*.cyb3`); this module centralises the
// naming, detection and gating so vault files, `.cybermanju` containers
// and mirrored folders all follow the same promote discipline.
//
// Pure file-system-free semantics here: planning + detection + gating.
// Side-effectful promote (rename/publish) belongs to each backend; the
// SetupWizard browser leg consumes detectStagedInstall today, and
// buildPromotionPlan is the shared definition every future promote must
// follow so "what counts as complete" is written exactly once.
//
// Role: pure stage-then-promote semantics (naming, detection, gating).
// Exports: STAGING_SUFFIX, STAGING_RE, stagedName, isStagedName,
//          baseNameOf, buildPromotionPlan, detectStagedInstall.
// Integrates: vaultFolder sync temps, SetupWizard browser leg (message).
// Contracts: promote only when the staged payload is validated; final
//            paths are NEVER mutated in place — a failed write promotes
//            nothing, so the previous final copy always survives.

export const STAGING_SUFFIX = '.staging'

export interface PromotionPlan {
  /** Staged path to rename over the final path, or null (nothing ready). */
  promote: string | null
  /** The destination the plan wants written. */
  final: string
  /** Staged leftovers to clear AFTER a successful promote (crumbs). */
  cleanup: string[]
  /** Staged payloads that failed validation (report, then scrub). */
  rejected: string[]
}

/** Staged sibling name for a final path (`x.cybermanju` → `x.cybermanju.staging-<salt>`). */
export function stagedName(finalPath: string, salt: string | number = Date.now()): string {
  const clean = finalPath.trim()
  if (!clean) return `${STAGING_SUFFIX}-${salt}`
  if (isStagedName(clean)) return clean
  return `${clean}${STAGING_SUFFIX}-${salt}`
}

/** True for `*.staging` / `*.staging-<anything>` (any depth, any body). */
export function isStagedName(path: string): boolean {
  const base = baseNameOf(path)
  if (!base) return false
  return /(?:^|\/)[^/]*\.staging(?:-[^/]*)?$/.test(base)
}
export const STAGING_RE = /\.staging(?:-[^/]*)?$/

/** Basename with both slashes handled (kept dependency-free). */
export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/**
 * One plan per promote: choose the newest VALIDATED staged payload, list
 * the rest for cleanup, and never be silent about rejects. `validate`
 * defaults to the completeness gate "non-empty ⇒ effective".
 */
export function buildPromotionPlan(
  finalPath: string,
  stagedEntries: Array<{ path: string; bytes?: number; ok?: boolean }>,
  validate?: (entry: { path: string; bytes?: number; ok?: boolean }) => boolean,
): PromotionPlan {
  const plan: PromotionPlan = { promote: null, final: finalPath, cleanup: [], rejected: [] }
  const check = validate ?? (e => (e.ok === undefined ? (e.bytes ?? 1) > 0 : e.ok === true))
  const ready: Array<{ path: string; rank: number }> = []
  for (const entry of stagedEntries) {
    const path = entry.path
    if (!isStagedName(path)) {
      plan.rejected.push(path)
      continue
    }
    if (!check(entry)) {
      plan.rejected.push(path)
      continue
    }
    // Prefer the HIGHEST salt (newest write) — salts are sortable numbers
    // only when a numeric suffix exists; strings sort after them.
    const suffix = path.slice(path.lastIndexOf(STAGING_SUFFIX) + STAGING_SUFFIX.length)
    const rank = /^-(\d+)$/.test(suffix) ? Number(suffix.slice(1)) : Number.MAX_SAFE_INTEGER
    ready.push({ path, rank })
  }
  ready.sort((a, b) => b.rank - a.rank)
  plan.promote = ready[0]?.path ?? null
  plan.cleanup = ready.slice(1).map(r => r.path).concat(plan.rejected)
  return plan
}

/**
 * Wizard-side detection over a picked vault folder's entry names: which
 * existing `*.cybermanju` container is present (open it) and which staged
 * leftovers mark a previously interrupted FIRST install (surface honestly,
 * then recreate over the frozen staging copy).
 */
export interface StagedInstallScan {
  /** Detected existing vault container in the folder, if any. */
  vault: string | null
  /** Staged leftover names present in the folder. */
  staging: string[]
}

export function detectStagedInstall(names: string[]): StagedInstallScan {
  const vault = names.find(n => baseNameOf(n).toLowerCase().endsWith('.cybermanju')
    && !isStagedName(n)) ?? null
  const staging = names.filter(n => isStagedName(n))
  return { vault, staging }
}
