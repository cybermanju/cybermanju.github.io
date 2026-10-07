// CyberManju OS — first-run setup wizard state (pure, unit-tested).
//
// The wizard itself lives in `SetupWizard.vue` (vault file + local sync +
// agent AI, every step skippable). This module owns the browser-free parts:
// the "seen" flag in localStorage and the step order, so both stay honest
// without a browser.

export const SETUP_SEEN_KEY = 'cybermanju.setupSeen.v1'

export const SETUP_STEPS = ['welcome', 'storage', 'agent', 'done'] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  welcome: 'Welcome',
  storage: 'Storage & sync',
  agent: 'Agent AI (optional)',
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
