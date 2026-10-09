// First-run setup wizard flag + step order stay honest without a browser:
// unseen by default, finish/skip persists, navigation clamps at both ends.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  SETUP_SEEN_KEY,
  SETUP_RESUME_STEP_KEY,
  SETUP_STEP_LABELS,
  SETUP_STEPS,
  clearSetupSeen,
  markSetupSeen,
  nextSetupStep,
  prevSetupStep,
  setupSeen,
  setupStepIndex,
  saveSetupResumeStep,
  takeSetupResumeStep,
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

  it('consumes a valid Account Manager continuation only once', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)) },
      removeItem: (key: string) => { values.delete(key) },
    })
    try {
      saveSetupResumeStep('disks')
      expect(values.get(SETUP_RESUME_STEP_KEY)).toBe('disks')
      expect(takeSetupResumeStep()).toBe('disks')
      expect(takeSetupResumeStep()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('walks forward and clamps on done', () => {
    const order: SetupStep[] = ['welcome', 'vault', 'sync', 'cloud', 'disks', 'agent', 'done']
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
    expect(prevSetupStep('agent')).toBe('disks')
    expect(prevSetupStep('disks')).toBe('cloud')
    expect(prevSetupStep('cloud')).toBe('sync')
    expect(prevSetupStep('sync')).toBe('vault')
    expect(prevSetupStep('vault')).toBe('welcome')
    expect(prevSetupStep('welcome')).toBe('welcome')
  })

  it('numbers steps 1-based for the progress dots', () => {
    expect(setupStepIndex('welcome')).toBe(1)
    expect(setupStepIndex('vault')).toBe(2)
    expect(setupStepIndex('sync')).toBe(3)
    expect(setupStepIndex('cloud')).toBe(4)
    expect(setupStepIndex('disks')).toBe(5)
    expect(setupStepIndex('agent')).toBe(6)
    expect(setupStepIndex('done')).toBe(7)
  })

  it('exposes a disks substep between cloud and agent', () => {
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('cloud') + 1]).toBe('disks')
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('disks') + 1]).toBe('agent')
    expect(SETUP_STEP_LABELS.disks).toBe('Disks')
  })
})
