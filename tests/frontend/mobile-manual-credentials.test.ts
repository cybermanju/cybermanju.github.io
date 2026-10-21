// CyberManju OS — Mobile manual credentials (tests/frontend/mobile-manual-credentials.test.ts).
// Role: guard the mobile setup wizard's collapsed manual token-entry path.
// Exports: none.
// Integrates: Vitest, Node fs, src/components/MobileSetupWizard.vue.
// Contracts: display name and PAT are disclosed only after an explicit button action.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const mobileWizard = readFileSync('src/components/MobileSetupWizard.vue', 'utf8')

describe('mobile setup manual credentials', () => {
  it('keeps manual name and token fields collapsed until requested', () => {
    expect(mobileWizard).toContain("{{ manualCredentialsOpen ? 'Hide manual credentials' : 'Enter token manually' }}")
    expect(mobileWizard).toContain('v-if="manualCredentialsOpen"')
    expect(mobileWizard).toContain('v-model="prov.name"')
    expect(mobileWizard).toContain('v-model="prov.secret"')
  })
})
