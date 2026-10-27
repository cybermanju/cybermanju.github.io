// CyberManju OS — First-run coach marks (src/utils/coachMarks.ts).
//
// One quiet guided pass over the finished workspace, shown ONCE after the
// setup wizard is closed the first time: dim the real UI, cut a ring around
// the actual control (the "This is you." cutout mark), one short note per step.
// The overlay component (`FirstRunCoach.vue`) renders this list; this module
// owns the browser-free parts so steps, dismissal state and ordering stay
// pure and unit-tested.
//
// Role: pure state + step list for the first-run coach overlay.
// Exports: COACH_SEEN_KEY, CoachStep, COACH_STEPS, coachSeen, markCoachSeen,
//          clearCoachSeen, nextCoachStep, previousCoachStep, coachStepIndex.
// Integrates: localStorage (guarded), FirstRunCoach.vue, App.vue listener.
// Contracts: `.dock-container` and `.top-menubar` selectors must exist in
//            DesktopShell — steps without a target render as centered cards.

export const COACH_SEEN_KEY = 'cybermanju.coach.v1'

export interface CoachStep {
  /** Stable id — also the DOM/testid suffix and the skip reason key. */
  id: string
  /** CSS selector of the element to ring; empty = centered card. */
  target: string
  /** Tiny uppercase eyebrow above the note (design-language kicker). */
  kicker: string
  /** The one sentence the user should learn here. */
  label: string
  /** Optional follow-up sentence, rendered smaller under the label. */
  detail?: string
  /** Position of the callout relative to the ring. */
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Ordered tour of the entered desktop (mobile skips the coach entirely —
 * its launcher got the whole wizard). Selectors are DesktopShell classes,
 * resolved lazily by the component; missing elements end the tour.
 */
export const COACH_STEPS: CoachStep[] = [
  {
    id: 'dock',
    target: '.dock-container',
    kicker: 'YOUR APP GRID',
    label: 'This is the Dock — every app of the OS opens from here.',
    detail: 'Files, Terminal, Agent, Disks… click an icon to launch it in its own window.',
    side: 'top',
  },
  {
    id: 'terminal',
    target: '',
    kicker: 'ENCRYPTED SHELL',
    label: 'Ctrl+` opens cybsh — the shell with vault superpowers.',
    detail: 'disk · encrypt · sync · agent · keygen all work inside it. Esc closes again.',
  },
  {
    id: 'done',
    target: '',
    kicker: 'THAT’S THE TOUR',
    label: 'Nothing else is locked. Skipped wizard parts stay one click away.',
    detail: 'Help → Setup wizard reopens onboarding any time.',
  },
]

/** True once the tour was completed or dismissed. */
export function coachSeen(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(COACH_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** Remember dismissal/completion. Never throws. */
export function markCoachSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(COACH_SEEN_KEY, '1')
  } catch {
    // Private mode — the tour simply runs again next launch.
  }
}

/** Forget the flag (tests and Help → tour again). */
export function clearCoachSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(COACH_SEEN_KEY)
  } catch {
    // Nothing stored.
  }
}

/** 1-based index for the "Step n of N" line. */
export function coachStepIndex(id: string): number {
  return COACH_STEPS.findIndex(s => s.id === id) + 1
}

/** Next step id, or null when the tour ends (clamp at the last step). */
export function nextCoachStep(id: string | null): string | null {
  const i = id ? COACH_STEPS.findIndex(s => s.id === id) : -1
  const next = COACH_STEPS[i + 1]
  return next?.id ?? null
}

/** Previous step id (null on the first step). */
export function previousCoachStep(id: string | null): string | null {
  if (!id) return null
  const i = COACH_STEPS.findIndex(s => s.id === id)
  const prev = COACH_STEPS[i - 1]
  return prev?.id ?? null
}
