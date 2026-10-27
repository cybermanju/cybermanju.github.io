// CyberManju OS — Staged installs.test (tests/frontend/staged-install.test.ts).
// Role: stage-then-promote semantics: naming, completeness
//       gating, newest-ready selection, leftover detection.
// Exports: Vitest suite.
// Integrates: src/utils/stagedInstall.ts.
// Contracts: a failed write promotes nothing — the previous final copy
//            always survives (planner never selects a rejected stage).
import { describe, expect, it } from 'vitest'
import {
  baseNameOf,
  buildPromotionPlan,
  detectStagedInstall,
  isStagedName,
  stagedName,
} from '@/utils/stagedInstall'

describe('staged installs (stage → gate → promote)', () => {
  it('derives stable staging names and recognizes only its own shape', () => {
    expect(stagedName('personal-vault.cybermanju', 17)).toBe('personal-vault.cybermanju.staging-17')
    expect(isStagedName('personal-vault.cybermanju.staging-17')).toBe(true)
    expect(isStagedName('personal-vault.cybermanju.staging')).toBe(true)
    expect(isStagedName('personal-vault.cybermanju')).toBe(false)
    expect(isStagedName('/a/b/files/c.staging')).toBe(true)
    expect(isStagedName('stageless/staging.cybermanju')).toBe(false)
    // Idempotent: re-staging an already-staged name returns it unchanged.
    expect(stagedName('x.staging-3', 9)).toBe('x.staging-3')
  })

  it('promotes the newest validated stage and never a rejected one', () => {
    const plan = buildPromotionPlan('v.cybermanju', [
      { path: 'v.cybermanju.staging-100', bytes: 0 }, // incomplete tail
      { path: 'v.cybermanju.staging-200', bytes: 512 },
      { path: 'v.cybermanju.staging-300', bytes: 48 }, // crash mid-write
    ])
    expect(plan.promote).toBe('v.cybermanju.staging-200')
    expect(plan.final).toBe('v.cybermanju')
    expect(plan.cleanup).toContain('v.cybermanju.staging-300')
    expect(plan.cleanup).toContain('v.cybermanju.staging-100')
  })

  it('gates completeness by the validator (non-empty ⇒ effective)', () => {
    const ok = buildPromotionPlan('v', [{ path: 'v.staging-1', bytes: 512 }])
    expect(ok.promote).toBe('v.staging-1')
    const zero = buildPromotionPlan('v', [{ path: 'v.staging-1', bytes: 0 }])
    expect(zero.promote).toBeNull()
    const flagged = buildPromotionPlan('v', [{ path: 'v.staging-1', bytes: 999, ok: false }])
    expect(flagged.promote).toBeNull()
    expect(flagged.rejected).toEqual(['v.staging-1'])
  })

  it('does not promote foreign files (validator-shaped, not name-shaped)', () => {
    const plan = buildPromotionPlan('v', [{ path: 'v.cyb3' }])
    expect(plan.promote).toBeNull()
    expect(plan.rejected).toEqual(['v.cyb3'])
  })

  it('promotes custom-validated non-numeric stages after MAX_SAFE_INTEGER ranks', () => {
    const plan = buildPromotionPlan(
      'v',
      [
        { path: 'v.staging-legacy', ok: true },
        { path: 'v.staging-5', ok: true },
      ],
      () => true,
    )
    // Non-numeric salt ranks above every numeric one (newest by convention).
    expect(plan.promote).toBe('v.staging-legacy')
    expect(plan.cleanup).toContain('v.staging-5')
  })

  it('promotes nothing when every stage fails validation (fail-safe promote)', () => {
    const plan = buildPromotionPlan('v.cybermanju', [
      { path: 'v.cybermanju.staging-1', ok: false },
      { path: 'v.cybermanju.staging-2', bytes: 0 },
      { path: 'other.cyb3' },
    ])
    expect(plan.promote).toBeNull()
    expect(plan.rejected).toHaveLength(3)
    // Rejects land in cleanup too — scrubbed after a later real promote.
    expect(plan.cleanup).toHaveLength(3)
  })

  it('returns an all-null plan for an empty staging dir', () => {
    expect(buildPromotionPlan('v.cybermanju', [])).toEqual({
      promote: null, final: 'v.cybermanju', cleanup: [], rejected: [],
    })
  })

  it('detects an existing vault + interrupted staging in a picked folder', () => {
    const scan = detectStagedInstall([
      'vault.cybermanju',
      'files',
      'notes.txt',
      'vault.cybermanju.staging-11',
    ])
    expect(scan.vault).toBe('vault.cybermanju')
    expect(scan.staging).toEqual(['vault.cybermanju.staging-11'])
    // No vault: a pure interrupted first install (staging only).
    expect(detectStagedInstall(['vault.cybermanju.staging-11']).vault).toBeNull()
    // Case-insensitive vault detection (Windows/USB naming habits).
    expect(detectStagedInstall(['VAULT.CYBERMANJU']).vault).toBe('VAULT.CYBERMANJU')
    // Case-insensitive vault detection (Windows/USB naming habits).
    expect(detectStagedInstall(['VAULT.CYBERMANJU']).vault).toBe('VAULT.CYBERMANJU')
    // Uppercase staging bodies are foreign names and stay unclassified.
    expect(detectStagedInstall(['staging-1', 'a.STAGING-2'])).toEqual({ vault: null, staging: [] })
  })

  it('basename helper matches vaultFolder behavior', () => {
    expect(baseNameOf('/a/b/c.staging-2')).toBe('c.staging-2')
    expect(baseNameOf('C:\\a\\b')).toBe('b')
    expect(baseNameOf('')).toBe('')
  })
})
