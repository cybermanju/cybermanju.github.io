// CyberManju OS — Welcome demo script (src/utils/welcomeDemoScript.ts).
//
// The landing screen's self-typing mock cybsh session — the
// welcome-demo move of our design language: a fake terminal chars its
// way through a REAL product demo instead of describing the product. Pure here (line list + cadence
// + loop point + option state transitions); `WelcomeDemo.vue` only runs
// the clock. Nothing placeholdered: every line is something cybsh can
// actually answer, so the demo teaches real commands simply by existing.
//
// Role: pure script state machine + cadence constants for WelcomeDemo.
// Exports: WELCOME_DEMO_LINES, WELCOME_TYPE_MS, WELCOME_HOLD_MS,
//          initialWelcomeDemo, advanceWelcomeDemo, WELCOME_DEMO_LOOPS.
// Integrates: WelcomeDemo.vue (typewriter loop), landing screen.
// Contracts: reduced-motion skips animation entirely (jump to hold state);
//            script loops forever but holds WELCOME_HOLD_MS at the end.

/** Lines of the mock session. `{ typed: true }` = chars out at cadence. */
export interface WelcomeDemoLine {
  text: string
  typed?: boolean
  /** Accent this line renders in (cybsh prompt/green results). */
  tone?: 'prompt' | 'accent' | 'muted'
}

export const WELCOME_DEMO_LINES: WelcomeDemoLine[] = [
  { text: '$ cyb disk list', typed: true, tone: 'prompt' },
  { text: '  personal-vault  512 MB  sealed  ML-KEM-1024 3-device' },
  { text: '  travel-vault     64 MB  sealed  ChaCha20 (offline ok)' },
  { text: '$ cyb encrypt manifesto.txt', typed: true, tone: 'prompt' },
  { text: '  ✓ sealed — ChaCha20-Poly1305 + ML-KEM-1024' },
  { text: '  ✓ key shards sent to your devices — not to us' },
  { text: '$ cyb agent run "summarize last week"', typed: true, tone: 'prompt' },
  { text: '  ● reading 42 notes, 12 files…', tone: 'muted' },
  { text: '  ✓ done — 3-page brief, sources attached', tone: 'accent' },
  { text: 'your files. your keys. no cloud required.', tone: 'accent' },
]

/** Milliseconds per typed character (the welcome demo's 45 ms cadence). */
export const WELCOME_TYPE_MS = 45
/** Pause on the finished transcript before the loop restarts. */
export const WELCOME_HOLD_MS = 3200

/** Typing loops forever; UI consumers use this to key transitions. */
export const WELCOME_DEMO_LOOPS = true

export interface WelcomeDemoState {
  /** Count of characters typed into the CURRENT line. */
  chars: number
  /** Index into WELCOME_DEMO_LINES. */
  lineIndex: number
  /** True once the last line finished — component holds, then loops. */
  complete: boolean
}

export function initialWelcomeDemo(): WelcomeDemoState {
  return { chars: 0, lineIndex: 0, complete: false }
}

export interface WelcomeAdvance {
  state: WelcomeDemoState
  /** How many ms the caller should wait before the next advance. */
  ms: number
}

/**
 * Advance the typewriter by one tick. The FIRST non-`typed` line reveals
 * instantly (app output appears whole), which mirrors how a terminal
 * prints command output vs. user keystrokes.
 */
export function advanceWelcomeDemo(prev: WelcomeDemoState): WelcomeAdvance {
  const line = WELCOME_DEMO_LINES[prev.lineIndex]
  if (!line) return { state: { ...prev, complete: true }, ms: WELCOME_HOLD_MS }
  if (line.typed) {
    const chars = prev.chars + 1
    if (chars <= line.text.length) return { state: { ...prev, chars }, ms: WELCOME_TYPE_MS }
  } else if (prev.chars === 0) {
    return { state: { ...prev, chars: line.text.length }, ms: WELCOME_HOLD_MS / 2 }
  }
  // Line finished: move on, or hold/loop at the end of the script.
  const nextIndex = prev.lineIndex + 1
  if (nextIndex >= WELCOME_DEMO_LINES.length) {
    return { state: { ...prev, complete: true }, ms: WELCOME_HOLD_MS }
  }
  return { state: { chars: 0, lineIndex: nextIndex, complete: false }, ms: WELCOME_HOLD_MS / 4 }
}
