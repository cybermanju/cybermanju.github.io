// Mobile first-run flow stays honest: step order, partition clamping/validity.
import { describe, expect, it } from 'vitest'
import {
  MOBILE_SETUP_STEPS,
  MOBILE_SETUP_STEP_LABELS,
  blankPartitionDraft,
  mobileSetupStepIndex,
  nextMobileSetupStep,
  normalizePartitionDraft,
  partitionDraftValid,
  prevMobileSetupStep,
  type MobileSetupStep,
} from '@/utils/setupWizard'

describe('mobile setup flow', () => {
  it('walks welcome → account → vaults → providers → repos → agent → done', () => {
    expect([...MOBILE_SETUP_STEPS]).toEqual([
      'welcome',
      'account',
      'vaults',
      'providers',
      'repos',
      'agent',
      'done',
    ])
    let s: MobileSetupStep = 'welcome'
    for (const expected of MOBILE_SETUP_STEPS.slice(1)) {
      s = nextMobileSetupStep(s)
      expect(s).toBe(expected)
    }
    expect(nextMobileSetupStep('done')).toBe('done')
    expect(prevMobileSetupStep('welcome')).toBe('welcome')
    expect(mobileSetupStepIndex('vaults')).toBe(3)
  })

  it('names repos as an explicit repos + disks substep', () => {
    expect(MOBILE_SETUP_STEP_LABELS.repos).toContain('disks')
  })

  it('clamps partition sizes into 64–8192 MB and trims names', () => {
    expect(normalizePartitionDraft(blankPartitionDraft('vault-1')).sizeMb).toBe(512)
    expect(normalizePartitionDraft({ ...blankPartitionDraft(), sizeMb: 4 }).sizeMb).toBe(64)
    expect(normalizePartitionDraft({ ...blankPartitionDraft(), sizeMb: 99999 }).sizeMb).toBe(8192)
    expect(partitionDraftValid(blankPartitionDraft('ab'))).toBe(true)
    expect(partitionDraftValid(blankPartitionDraft('x'))).toBe(false)
  })
})
