// CyberManju OS — AgentAI theme and interaction accessibility tests.
// Role: guard readable semantic colors, focus outlines and touch target sizing.
// Integrates: Vitest and AgentPanel source contracts.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const panel = readFileSync('src/components/AgentPanel.vue', 'utf8')
const styles = panel.slice(panel.indexOf('<style scoped>'), panel.indexOf('</style>'))

describe('AgentPanel theme and interaction accessibility', () => {
  it('uses semantic UI colors for readable supporting and voice-call copy', () => {
    expect(styles).toMatch(/\.agent-note \{[^}]*color: var\(--ui-text-2\)/)
    expect(styles).not.toMatch(/\.agent-note \{[^}]*color-mix/)
    expect(styles).toContain('color: var(--ui-text-2);')
    expect(styles).not.toMatch(/\.voice-call[^\n]*#[\da-f]{3,8}/i)
  })

  it('provides visible keyboard focus for interactive controls', () => {
    expect(styles).toContain('button:focus-visible')
    expect(styles).toContain('textarea:focus-visible')
    expect(styles).toContain('outline: 2px solid var(--ui-focus-color)')
  })

  it('keeps voice call actions at a 44px minimum touch height', () => {
    expect(styles).toContain('.voice-call-actions :deep(button)')
    expect(styles).toContain('.agent-phone-options :deep(button) { min-height: 44px; }')
  })

  it('keeps Android permissions readable and keyboard reachable in teleported modals', () => {
    const permissions = readFileSync('src/components/AndroidVoiceSettings.vue', 'utf8')
    expect(permissions).toContain(':is(input, textarea, select, summary):focus-visible')
    expect(permissions).toContain('.android-voice .agent-note { color: var(--ui-text-2);')
    expect(permissions).toContain('.android-voice-actions :deep(button) { min-height: 44px; }')
    expect(permissions).toContain('.android-installed-apps small { color: var(--ui-text-2);')
    const modal = readFileSync('src/components/ui/UiModal.vue', 'utf8')
    expect(modal).toMatch(/\.ui-modal__body \{[^}]*background: var\(--ui-surface\)/)
  })
})
