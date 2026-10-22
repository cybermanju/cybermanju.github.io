// CyberManju OS — Home and shell gesture ownership tests.
// Role: ensure the app-local touch surface is excluded from shell Pointer recognition.
// Integrates: real swipe machine and source ownership contracts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSwipeMachine, type SwipePointer } from '../../src/composables/useSwipe'

const swipeSource = readFileSync('src/composables/useSwipe.ts', 'utf8')
const launcherSource = readFileSync('src/components/MobileLauncher.vue', 'utf8')

function pointer(pointerId: number, clientY: number): SwipePointer {
  return { pointerId, pointerType: 'touch', clientX: 200, clientY }
}

// Exercise the same pointerdown guard installed by useSwipe, while keeping its
// machine real; only Vue's lifecycle/event registration is intentionally out.
function shellPointerDown(machine: ReturnType<typeof createSwipeMachine>, target: { closest: (selector: string) => unknown }) {
  const match = swipeSource.match(/function handlePointerDown\(e: PointerEvent\) \{([\s\S]*?)\n  \}/)
  if (!match) throw new Error('Could not locate useSwipe handlePointerDown')
  const body = match[1].replace('(e.target as HTMLElement | null)', 'e.target')
  // Supply the desktop composable's session locals for this single pointerdown.
  // Multi-contact session lifecycle is exercised through useSwipe in swipe-ownership.test.ts.
  const handler = new Function('machine', 'refreshViewBox', 'e', `
    const sessionPointers = new Set();
    let excludedSession = false;
    ${body}
  `) as (machine: typeof machine, refresh: () => void, e: { target: typeof target } & SwipePointer) => void
  handler(machine, () => {}, { target, ...pointer(99, 0) })
}

describe('Home gesture ownership', () => {
  it('shell does not enroll pointerdowns started under Home or terminal exclusions', () => {
    const selectors = ['[data-shell-gesture-exclude]', '.terminal-gesture-exclude']
    for (const selector of selectors) {
      let actionCount = 0
      const machine = createSwipeMachine({ threshold: 10, onSwipe: () => actionCount++ })
      shellPointerDown(machine, { closest: query => query.includes(selector) ? {} : null })
      expect(machine.peakCount(), selector).toBe(0)
      machine.onPointerMove(pointer(1, 0))
      machine.onPointerUp(pointer(1, 0))
      expect(actionCount, selector).toBe(0)
    }
  })

  it('shell still enrolls pointerdowns outside Home and terminal exclusions', () => {
    let actionCount = 0
    const machine = createSwipeMachine({ threshold: 10, onSwipe: () => actionCount++ })
    shellPointerDown(machine, { closest: () => null })
    expect(machine.peakCount()).toBe(1)
    machine.onPointerMove(pointer(99, 100))
    machine.onPointerUp(pointer(99, 100))
    expect(actionCount).toBe(1)
  })

  it('pointercancel never dispatches a swipe action', () => {
    let actions = 0
    const machine = createSwipeMachine({ threshold: 10, onSwipe: () => actions++ })
    machine.onPointerDown(pointer(1, 100))
    machine.onPointerMove(pointer(1, 0))
    machine.onPointerCancel(pointer(1, 0))
    expect(actions).toBe(0)
  })

  it('Home keeps local bubbling ownership while the launcher observes touch in capture', () => {
    const studio = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
    expect(studio).toMatch(/class="home-studio"[^>]*data-shell-gesture-exclude[^>]*@touchstart\.stop/)
    expect(studio).toMatch(/@touchmove\.stop/)
    expect(studio).toMatch(/@touchend\.stop/)
    expect(studio).toMatch(/@touchcancel\.stop/)
    expect(launcherSource).toContain('@touchstart.capture.passive="onTouchStart"')
    expect(launcherSource).toContain('@touchmove.capture="onTouchMove"')
    expect(launcherSource).toContain('@touchend.capture="onTouchEnd"')
    expect(launcherSource).toContain('@touchcancel.capture.passive="cancelLauncherTouch"')
    expect(launcherSource).not.toContain('@touchstart.passive="onTouchStart"')
  })

  it('HomeWorkspaceStudio root declares the shell-exclusion marker', () => {
    const studio = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
    expect(studio).toMatch(/<section[^>]*class="home-studio"[^>]*data-shell-gesture-exclude/)
  })
})
