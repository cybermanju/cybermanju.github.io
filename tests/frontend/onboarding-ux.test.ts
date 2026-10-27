// CyberManju OS — Onboarding UX layer.test (tests/frontend/onboarding-ux.test.ts).
// Role: press/haptics micro-feedback, coach-mark step math, welcome-demo
//       script cadence + reduced-motion jump, os-deck tokens presence.
// Exports: Vitest suite.
// Integrates: pressFeedback, coachMarks, welcomeDemoScript, ui/tokens.
// Contracts: feedback never throws without a browser; reduced motion
//            JUMPS animation states (skip, never slow).
import { describe, expect, it, vi, afterEach } from 'vitest'
import { HAPTIC_MS, PRESS_MS, PRESS_SCALE, prefersReducedMotion, vibratePress } from '@/utils/pressFeedback'
import {
  COACH_STEPS,
  clearCoachSeen,
  coachSeen,
  coachStepIndex,
  markCoachSeen,
  nextCoachStep,
  previousCoachStep,
} from '@/utils/coachMarks'
import {
  WELCOME_DEMO_LINES,
  WELCOME_TYPE_MS,
  advanceWelcomeDemo,
  initialWelcomeDemo,
} from '@/utils/welcomeDemoScript'
import { buildCssVars, DEFAULT_SETTINGS } from '@/ui/tokens'

describe('press feedback micro-language', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('seals the design constants (0.96 spring scale, 8 ms tick)', () => {
    expect(PRESS_SCALE).toBe(0.96)
    expect(HAPTIC_MS).toBe(8)
  })

  it('vibrates only where navigator.vibrate exists (best-effort)', () => {
    vi.stubGlobal('navigator', { vibrate: vi.fn() })
    vibratePress()
    expect((navigator as Navigator & { vibrate: (p: number) => boolean }).vibrate).toHaveBeenCalledWith(8)
    // Empty navigator (node env) must be a silent no-op …
    vi.stubGlobal('navigator', {})
    expect(() => vibratePress()).not.toThrow()
    // … and a defined-but-broken vibrate crashes nothing either.
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('broken vibrate plugin') } })
    expect(() => vibratePress()).not.toThrow()
    // Multi-pulse patterns pass through unchanged (the auth-shake haptic).
    vi.stubGlobal('navigator', { vibrate: vi.fn() })
    vibratePress([10, 30, 10])
    expect((navigator as Navigator & { vibrate: (p: number[]) => boolean }).vibrate).toHaveBeenCalledWith([10, 30, 10])
  })

  it('prefersReducedMotion is false without a matchMedia implementation', () => {
    expect(prefersReducedMotion()).toBe(false)
    expect(PRESS_MS).toBe(HAPTIC_MS) // alias stays glue-equal on purpose
  })
})

describe('coach-mark step math (pure)', () => {
  afterEach(() => clearCoachSeen())

  it('walks an ordered 3-step tour that ends un-manipulatively', () => {
    expect(COACH_STEPS.map(s => s.id)).toEqual(['dock', 'terminal', 'done'])
    expect(nextCoachStep(null)).toBe('dock')
    expect(nextCoachStep('dock')).toBe('terminal')
    expect(nextCoachStep('done')).toBeNull()
    expect(previousCoachStep('done')).toBe('terminal')
    expect(previousCoachStep(null)).toBeNull()
    expect(coachStepIndex('terminal')).toBe(2)
  })

  it('persists the once-only flag and degrades safely without storage', () => {
    clearCoachSeen()
    expect(coachSeen()).toBe(false)
    markCoachSeen()
    expect(coachSeen()).toBe(true)
    // The blocked-storage contract: FAIL CLOSED to "seen" so nothing loops.
    vi.stubGlobal('localStorage', undefined)
    expect(coachSeen()).toBe(true)
    expect(() => markCoachSeen()).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('treats unknown step ids as tour start (never a crash or skip)', () => {
    // Unknown next ⇒ the first step again; unknown prev/index stay inert.
    expect(nextCoachStep('bogus')).toBe('dock')
    expect(previousCoachStep('bogus')).toBeNull()
    expect(coachStepIndex('bogus')).toBe(0)
  })
})

describe('welcome demo script (pure typewriter)', () => {
  it('types only prompt lines; output lines reveal instantly', () => {
    const typed = WELCOME_DEMO_LINES.filter(l => l.typed)
    for (const line of typed) expect(line.text.startsWith('$')).toBe(true)
    expect(WELCOME_DEMO_LINES.some(l => !l.typed)).toBe(true)
  })

  it('reveals an output line whole at the half-hold, then quarter-step on', () => {
    // Start ON the first non-typed line (2) and advance: whole-reveal ms.
    const start = { chars: 0, lineIndex: 2, complete: false }
    const reveal = advanceWelcomeDemo(start)
    expect(reveal.ms).toBe(Math.round(WELCOME_HOLD_MS / 2))
    expect(reveal.state.chars).toBe(WELCOME_DEMO_LINES[2].text.length)
    // The tick after a revealed output line moves on at the quarter-step.
    const moved = advanceWelcomeDemo(reveal.state)
    expect(moved.state.lineIndex).toBe(3)
    expect(moved.state.chars).toBe(0)
    expect(moved.ms).toBe(Math.round(WELCOME_HOLD_MS / 4))
  })

  it('defensively moves on when chars already overflow the line', () => {
    const overflowing = { chars: WELCOME_DEMO_LINES[0].text.length + 10, lineIndex: 0, complete: false }
    const { state } = advanceWelcomeDemo(overflowing)
    expect(state.lineIndex).toBe(1)
  })

  it('char-ticks a typed line at the design cadence then moves on', () => {
    let st = initialWelcomeDemo()
    expect(st).toEqual({ chars: 0, lineIndex: 0, complete: false })
    const first = WELCOME_DEMO_LINES[0]
    let ms = 0
    for (let i = 0; i < first.text.length; i++) {
      const { state, ms: next } = advanceWelcomeDemo(st)
      expect(next).toBe(WELCOME_TYPE_MS)
      st = state
      ms += next
    }
    expect(st.chars).toBe(first.text.length)
    // One more tick lands on the first non-typed output line.
    const advanced = advanceWelcomeDemo(st)
    expect(advanced.state.lineIndex).toBe(1)
    expect(advanced.state.chars).toBeGreaterThan(0)
  })

  it('completes, holds, and admits a clean restart (the loop contract)', () => {
    let st = initialWelcomeDemo()
    for (;;) {
      const { state, ms } = advanceWelcomeDemo(st)
      st = state
      if (state.complete) {
        expect(ms).toBeGreaterThan(0)
        // The component restarts from initialWelcomeDemo() after hold.
        expect(initialWelcomeDemo()).toEqual({ chars: 0, lineIndex: 0, complete: false })
        break
      }
    }
    expect(st.lineIndex + 1).toBe(WELCOME_DEMO_LINES.length)
  })
})

describe('design-token wiring for the onboarding layer', () => {
  it('emits kicker tokens on every theme and honors the density scale', () => {
    for (const theme of ['os-dark', 'os-deck', 'os-light'] as const) {
      const compact = buildCssVars({ ...DEFAULT_SETTINGS, theme, density: 'compact', followSystem: false })
      const comfy = buildCssVars({ ...DEFAULT_SETTINGS, theme, density: 'comfortable', followSystem: false })
      for (const token of ['--ui-kicker-fs', '--ui-kicker-weight', '--ui-kicker-tracking', '--ui-kicker-transform', '--ui-kicker-color']) {
        expect(compact[token], `${theme} ${token}`).toBeTruthy()
      }
      expect(Number.parseFloat(comfy['--ui-kicker-fs'])).toBeGreaterThan(Number.parseFloat(compact['--ui-kicker-fs']))
      expect(comfy['--ui-kicker-transform']).toBe('uppercase')
      // Hairlines already existed; they are the borders of the idiom.
      expect(comfy['--ui-hairline']).toBeTruthy()
    }
  })
})
