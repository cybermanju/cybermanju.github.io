// CyberManju OS — first-run setup wizard state (pure, unit-tested).
//
// The wizard itself lives in `SetupWizard.vue` (vault file + local sync +
// cloud + disks + agent AI, every step skippable). This module owns the browser-free parts:
// the "seen" flag in localStorage and the step order, so both stay honest
// without a browser.

export const SETUP_SEEN_KEY = 'cybermanju.setupSeen.v1'

export const SETUP_STEPS = ['welcome', 'vault', 'sync', 'cloud', 'disks', 'agent', 'done'] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  welcome: 'Welcome',
  vault: 'Vault',
  sync: 'Local sync',
  cloud: 'Accounts',
  disks: 'Disks',
  agent: 'Agent (optional)',
  done: 'Done',
}

/** True once the user finished or explicitly skipped the wizard. */
export function setupSeen(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(SETUP_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember the choice (finish or skip-all). Never throws. */
export function markSetupSeen(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SETUP_SEEN_KEY, '1')
  } catch {
    // Private mode — the wizard simply returns next launch.
  }
}

/** Forget the choice (used by tests and the Help-menu re-run path). */
export function clearSetupSeen(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(SETUP_SEEN_KEY)
  } catch {
    // Nothing stored — nothing to clear.
  }
}

export function nextSetupStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, i + 1)]
}

export function prevSetupStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.max(0, i - 1)]
}

/** 1-based position for the progress dots. */
export function setupStepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step) + 1
}

// ── Mobile first-run (Android) ─────────────────────────────────────
// Desktop keeps the steps above (pinned by tests). Mobile gets its
// own 7-step flow: identity → vault partitions → providers → repos, so a
// phone can create an account, N `.cybermanju` partitions on any provider
// (or local disk), and N provider repos in one pass. Pure + unit-tested.

export const MOBILE_SETUP_STEPS = [
  'welcome',
  'account',
  'vaults',
  'providers',
  'repos',
  'agent',
  'done',
] as const

export type MobileSetupStep = (typeof MOBILE_SETUP_STEPS)[number]

export const MOBILE_SETUP_STEP_LABELS: Record<MobileSetupStep, string> = {
  welcome: 'Welcome',
  account: 'Accounts',
  vaults: 'Vault partitions',
  providers: 'Providers',
  repos: 'Repos + disks',
  agent: 'Agent AI (optional)',
  done: 'Done',
}

export function mobileSetupStepIndex(step: MobileSetupStep): number {
  return MOBILE_SETUP_STEPS.indexOf(step) + 1
}

export function nextMobileSetupStep(step: MobileSetupStep): MobileSetupStep {
  const i = MOBILE_SETUP_STEPS.indexOf(step)
  return MOBILE_SETUP_STEPS[Math.min(MOBILE_SETUP_STEPS.length - 1, i + 1)]
}

export function prevMobileSetupStep(step: MobileSetupStep): MobileSetupStep {
  const i = MOBILE_SETUP_STEPS.indexOf(step)
  return MOBILE_SETUP_STEPS[Math.max(0, i - 1)]
}

export interface VaultPartitionDraft {
  name: string
  sizeMb: number
  passphrase: string
  /** sync config id, or '' = local app-private vault */
  configId: string
}

export const PARTITION_MIN_MB = 64
export const PARTITION_MAX_MB = 8192

export function blankPartitionDraft(name = ''): VaultPartitionDraft {
  return { name, sizeMb: 512, passphrase: '', configId: '' }
}

/** Clamp + sanitize a partition row (pure, so the wizard + tests agree). */
export function normalizePartitionDraft(d: VaultPartitionDraft): VaultPartitionDraft {
  const sizeMb = Math.max(
    PARTITION_MIN_MB,
    Math.min(PARTITION_MAX_MB, Math.round(Number(d.sizeMb) || 512)),
  )
  return {
    name: d.name.trim().slice(0, 64),
    sizeMb,
    passphrase: d.passphrase,
    configId: d.configId,
  }
}

export function partitionDraftValid(d: VaultPartitionDraft): boolean {
  const n = normalizePartitionDraft(d)
  return n.name.length >= 2 && n.sizeMb >= PARTITION_MIN_MB && n.sizeMb <= PARTITION_MAX_MB
}
