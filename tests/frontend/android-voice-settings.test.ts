// CyberManju OS — Android voice settings.test (tests/frontend/android-voice-settings.test.ts).
// Role: Frontend source-contract tests for Android notification and assisted-input safety.
// Exports: Vitest suite.
// Integrates: vitest, node:fs.
// Contracts: No polling, assistant forwarding, or automatic message sending.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('../../src/components/AndroidVoiceSettings.vue', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../../src/components/AgentPanel.vue', import.meta.url), 'utf8')

describe('Android voice settings UI', () => {
  it('renders only on native Android and makes app selection explicitly opt-in', () => {
    expect(component).toContain('isNativeAndroid()')
    expect(component).toContain('v-if="android"')
    expect(component).toContain('Selected app package names')
    expect(component).toContain("'configure', { packages: selectedPackages.value }")
    expect(component).toContain("items.value = []")
  })

  it('fetches notifications only on manual request and filters to approved packages', () => {
    expect(component).toContain('Refresh notifications')
    expect(component).toContain("androidVoiceCommand<{ items: AndroidVoiceNotification[] }>('notifications')")
    expect(component).toContain('selectedPackages.value.includes(item.packageName)')
    expect(component).not.toMatch(/setInterval|setTimeout|onActivated/)
    expect(component).not.toMatch(/sendPrompt|voiceCall\.start|promptInput/)
  })

  it('requires native review actions and never exposes an automatic send action', () => {
    expect(component).toContain("'reply', { key: item.key, text }")
    expect(component).toContain('Review reply on Android')
    expect(component).toContain("'fill', { packageName, text }")
    expect(component).toContain('Review fill on Android')
    expect(component).toContain('It will not send the text.')
    expect(component).toContain('never sends messages')
    expect(component).not.toMatch(/androidVoiceCommand[^\n]*'send'/)
  })

  it('is integrated adjacent to the call controls, without altering voice-call logic', () => {
    expect(panel).toContain("import AndroidVoiceSettings from '@/components/AndroidVoiceSettings.vue'")
    expect(panel).toContain('<AndroidVoiceSettings />')
  })
})
