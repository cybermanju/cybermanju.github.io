// CyberManju OS — Touch config session regression (tests/frontend/touch-config-session.test.ts).
// Role: Vitest regression for shared gesture settings and live shell recognizer options.
// Exports: module root (test suite).
// Integrates: vitest, useTouchConfig, createSwipeMachine.
// Contracts: Settings changes affect the already-mounted shell gesture session.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSwipeMachine, type SwipePointer } from '../../src/composables/useSwipe'
import { useTouchConfig } from '../../src/composables/useTouchConfig'

function pointer(id: number, x: number): SwipePointer {
  return { pointerId: id, pointerType: 'touch', clientX: x, clientY: 200 }
}

describe('touch configuration session', () => {
  it('shares Settings changes with the mounted shell and reads updated thresholds', () => {
    expect(readFileSync('src/App.vue', 'utf8')).toContain('useSwipe(mainAreaRef, () => touchConfig.getSwipeOptions())')

    const storageKey = `touch-config-session-${Math.random()}`
    const appConfig = useTouchConfig({ storageKey, threshold: 50 })
    const settingsConfig = useTouchConfig({ storageKey })
    const actions: string[] = []

    expect(settingsConfig).toBe(appConfig)
    appConfig.onAction(action => actions.push(action))

    // This is the source supplied by App to its long-lived useSwipe machine.
    const machine = createSwipeMachine(() => appConfig.getSwipeOptions())
    machine.setViewBox(500, 500)
    settingsConfig.setAction('swipe_right', 'open_settings')
    settingsConfig.setThreshold(100)

    machine.onPointerDown(pointer(1, 200))
    machine.onPointerMove(pointer(1, 280))
    machine.onPointerUp(pointer(1, 280))
    expect(actions).toEqual([])

    settingsConfig.setThreshold(40)
    machine.onPointerDown(pointer(2, 200))
    machine.onPointerMove(pointer(2, 280))
    machine.onPointerUp(pointer(2, 280))
    expect(actions).toEqual(['open_settings'])
  })
})
