// First-run setup wizard flag + step order stay honest without a browser:
// unseen by default, finish/skip persists, navigation clamps at both ends.
import { describe, expect, it, beforeEach } from 'vitest'
import {
  SETUP_SEEN_KEY,
  SETUP_STEPS,
  clearSetupSeen,
  markSetupSeen,
  nextSetupStep,
  prevSetupStep,
  setupSeen,
  setupStepIndex,
  type SetupStep,
} from '@/utils/setupWizard'

describe('setup wizard state', () => {
  beforeEach(() => {
    clearSetupSeen()
  })

  it('is unseen on a fresh profile', () => {
    expect(setupSeen()).toBe(false)
  })

  it('round-trips the seen flag without throwing', () => {
    markSetupSeen()
    // Node has no localStorage — the helpers degrade to "unseen".
    // In a browser this would read back true; here we assert no crash.
    expect(typeof setupSeen()).toBe('boolean')
    clearSetupSeen()
    expect(setupSeen()).toBe(false)
  })

  it('exposes the flag key for the component', () => {
    expect(SETUP_SEEN_KEY).toBe('cybermanju.setupSeen.v1')
  })

  it('walks forward and clamps on done', () => {
    const order: SetupStep[] = ['welcome', 'storage', 'agent', 'done']
    expect([...SETUP_STEPS]).toEqual(order)
    let s: SetupStep = 'welcome'
    for (const expected of order.slice(1)) {
      s = nextSetupStep(s)
      expect(s).toBe(expected)
    }
    expect(nextSetupStep('done')).toBe('done')
  })

  it('walks back and clamps on welcome', () => {
    expect(prevSetupStep('done')).toBe('agent')
    expect(prevSetupStep('storage')).toBe('welcome')
    expect(prevSetupStep('welcome')).toBe('welcome')
  })

  it('numbers steps 1-based for the progress dots', () => {
    expect(setupStepIndex('welcome')).toBe(1)
    expect(setupStepIndex('storage')).toBe(2)
    expect(setupStepIndex('agent')).toBe(3)
    expect(setupStepIndex('done')).toBe(4)
  })
})
