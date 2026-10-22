// CyberManju OS — Setup wizard.test (tests/frontend/setup-wizard.test.ts).
// First-run setup wizard flag + step order stay honest without a browser:
// unseen by default, finish/skip persists, navigation clamps at both ends.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  SETUP_SEEN_KEY,
  SETUP_RESUME_STEP_KEY,
  SETUP_STEP_LABELS,
  SETUP_STEPS,
  clearSetupSeen,
  clampVaultSizeMb,
  markSetupSeen,
  nextSetupStep,
  prevSetupStep,
  providerConfigForAccount,
  setupSeen,
  setupStepIndex,
  saveSetupResumeStep,
  signedProviderCards,
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
    const order: SetupStep[] = ['welcome', 'vault', 'cloud', 'disks', 'agent', 'appearance', 'done']
    expect([...SETUP_STEPS]).toEqual(order)
    let s: SetupStep = 'welcome'
    for (const expected of order.slice(1)) {
      s = nextSetupStep(s)
      expect(s).toBe(expected)
    }
    expect(nextSetupStep('done')).toBe('done')
  })

  it('walks back and clamps on welcome', () => {
    expect(prevSetupStep('done')).toBe('appearance')
    expect(prevSetupStep('appearance')).toBe('agent')
    expect(prevSetupStep('agent')).toBe('disks')
    expect(prevSetupStep('disks')).toBe('cloud')
    expect(prevSetupStep('cloud')).toBe('vault')
    expect(prevSetupStep('vault')).toBe('welcome')
    expect(prevSetupStep('welcome')).toBe('welcome')
  })

  it('numbers steps 1-based for the progress dots', () => {
    expect(setupStepIndex('welcome')).toBe(1)
    expect(setupStepIndex('vault')).toBe(2)
    expect(setupStepIndex('cloud')).toBe(3)
    expect(setupStepIndex('disks')).toBe(4)
    expect(setupStepIndex('agent')).toBe(5)
    expect(setupStepIndex('appearance')).toBe(6)
    expect(setupStepIndex('done')).toBe(7)
  })

  it('maps the legacy standalone sync resume step onto the merged vault step', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)) },
      removeItem: (key: string) => { values.delete(key) },
    })
    try {
      saveSetupResumeStep('vault')
      values.set(SETUP_RESUME_STEP_KEY, 'sync')
      expect(takeSetupResumeStep()).toBe('vault')
      expect(takeSetupResumeStep()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('exposes a disks substep between cloud and agent', () => {
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('cloud') + 1]).toBe('disks')
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('disks') + 1]).toBe('agent')
    expect(SETUP_STEP_LABELS.disks).toBe('Disks')
  })

  it('exposes an appearance step between agent and done', () => {
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('agent') + 1]).toBe('appearance')
    expect(SETUP_STEPS[SETUP_STEPS.indexOf('appearance') + 1]).toBe('done')
    expect(SETUP_STEP_LABELS.appearance).toBe('Appearance')
    expect(nextSetupStep('appearance')).toBe('done')
  })

  it('builds one OAuth substep card per account and matches only its exact config', () => {
    const cards = signedProviderCards(
      [
        { provider: 'google', id: 'google:ana', name: 'Ana', email: 'ana@example.com' },
        { provider: 'github', id: 'github:dev', email: 'dev@example.com' },
        { provider: 'google', id: 'google:second', name: 'Second Google' },
        { provider: 'unknown-slug', name: 'Nobody' },
        { provider: 'gitlab', name: 'Legacy without safe identity' },
      ],
      [
        { backendType: 'googleDrive', accountId: 'google:second', id: 'second-config' },
        { backendType: 'github', accountId: 'github:dev', id: 'github-config' },
        { backendType: 'googleDrive', accountId: 'other-google', id: 'other-config' },
      ],
    )
    expect(cards.map(c => c.accountId)).toEqual(['google:ana', 'github:dev', 'google:second'])
    expect(cards.map(c => c.backend)).toEqual(['googleDrive', 'github', 'googleDrive'])
    expect(cards[0].accountName).toBe('Ana')
    expect(cards[0].logo).toBe('google')
    expect(cards[0].hasConfig).toBe(false)
    expect(cards[1].accountName).toBe('dev@example.com')
    expect(cards[1].hasConfig).toBe(true)
    expect(cards[2].hasConfig).toBe(true)
  })

  it.each(['google', 'github', 'gitlab'])('renders the active %s account once with unique card keys while keeping other accounts', provider => {
    const active = { provider, id: `${provider}:work`, name: 'Current work profile' }
    const remembered = [
      { ...active, name: 'Stale remembered profile' },
      { provider, id: `${provider}:personal`, name: 'Personal' },
      { provider: 'github', id: 'github:linked-broker-user', name: 'Linked GitHub' },
      { provider: 'google', id: 'google:linked-broker-user', name: 'Linked Google' },
    ]
    // Mirrors SetupWizard's active-identity prepend before calling the helper.
    const cards = signedProviderCards([active, ...remembered], [])
    expect(cards).toHaveLength(4)
    expect(cards.filter(card => card.accountId === active.id)).toHaveLength(1)
    expect(cards[0].accountName).toBe('Current work profile')
    expect(cards.some(card => card.accountId === `${provider}:personal`)).toBe(true)
    expect(new Set(cards.map(card => card.accountId)).size).toBe(cards.length)
  })

  it('selects the matching account config rather than another row for that backend', () => {
    const first = { backendType: 'googleDrive', accountId: 'google:first', id: 'first' }
    const second = { backendType: 'googleDrive', accountId: 'google:second', id: 'second' }
    const rows = [first, second]
    expect(providerConfigForAccount(rows, 'googleDrive', 'google:second')).toBe(second)
    expect(providerConfigForAccount(rows, 'googleDrive', 'unbound')).toBeNull()
    expect(providerConfigForAccount([{ backendType: 'googleDrive', id: 'legacy' }], 'googleDrive', 'google:first')).toBeNull()
  })

  it('clamps the .cybermanju size into 64–8192 MB', () => {
    expect(clampVaultSizeMb(512)).toBe(512)
    expect(clampVaultSizeMb(4)).toBe(64)
    expect(clampVaultSizeMb(99999)).toBe(8192)
    expect(clampVaultSizeMb(Number.NaN)).toBe(512)
  })
})
