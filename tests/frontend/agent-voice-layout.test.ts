// CyberManju OS — Agent voice layout (tests/frontend/agent-voice-layout.test.ts).
// Role: regressions for compact voice controls and safe manual-text ownership.
// Exports: Vitest suite.
// Integrates: AgentPanel.vue, AndroidVoiceSettings.vue, TypeScript compiler.
// Contracts: audio controls do not displace chat; typing invalidates voice without aborting the agent task.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
const panel = readFileSync('src/components/AgentPanel.vue', 'utf8')
const settings = readFileSync('src/components/AndroidVoiceSettings.vue', 'utf8')
function textHarness(active = true, ready = true) {
  const voiceCall = { active: { value: active }, end: vi.fn() }
  const sendPrompt = vi.fn(async () => {})
  const canSend = { value: ready }
  const helpers = panel.slice(panel.indexOf('function switchToText()'), panel.indexOf('async function sendPrompt(signal?'))
  const js = ts.transpile(helpers, { target: ts.ScriptTarget.ES2022 })
  const api = new Function('voiceCall', 'canSend', 'sendPrompt', `${js}; return { switchToText, sendTypedPrompt }`)(voiceCall, canSend, sendPrompt)
  return { ...api, voiceCall, sendPrompt }
}
describe('Agent voice and text layout', () => {
  it('puts app access behind the rightmost named phone shortcut, outside the chat stack', () => {
    const header = panel.slice(panel.indexOf('<header'), panel.indexOf('</header>'))
    expect(header).toContain('agent-phone-shortcut')
    expect(header).toContain('aria-label="Voice and Android apps"')
    expect(header).toContain('aria-haspopup="dialog"')
    expect(header.indexOf('agent-phone-shortcut')).toBeGreaterThan(header.indexOf('agent-header-meta'))
    const chat = panel.slice(panel.indexOf('<!-- Chat tab -->'), panel.indexOf('</template>\n<script'))
    expect(chat).not.toContain('<AndroidVoiceSettings')
    expect(chat).not.toContain('class="voice-call"')
    expect(panel).toMatch(/<UiModal[^>]*phoneControlsOpen[\s\S]*?<AndroidVoiceSettings \/>[\s\S]*?<\/UiModal>/)
  })
  it('keeps the editor and send control usable during calls', () => {
    const editor = panel.match(/<textarea[\s\S]*?class="composer-box"[\s\S]*?\/>/)?.[0]
    expect(editor).not.toContain(':disabled=')
    expect(editor).toContain('@input="switchToText"')
    expect(editor).toContain('@keydown.enter.exact="sendTypedPrompt($event)"')
    expect(panel).not.toContain(':disabled="!canSend || voiceCall.active.value"')
    expect(panel).toContain('class="agent-call-status"')
  })
  it('ends only audio on manual input and leaves task cancellation untouched', () => {
    const h = textHarness()
    h.switchToText()
    expect(h.voiceCall.end).toHaveBeenCalledOnce()
    expect(h.sendPrompt).not.toHaveBeenCalled()
    const helper = panel.slice(panel.indexOf('function switchToText()'), panel.indexOf('async function sendPrompt(signal?'))
    expect(helper).not.toMatch(/abortJob|abortAgent|abortJob|abort\(/)
  })
  it('invalidates audio before sending a typed message through the existing pipeline', async () => {
    const h = textHarness()
    const event = { isComposing: false, keyCode: 13, preventDefault: vi.fn() }
    await h.sendTypedPrompt(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.voiceCall.end).toHaveBeenCalledOnce()
    expect(h.sendPrompt).toHaveBeenCalledOnce()
    expect(h.voiceCall.end.mock.invocationCallOrder[0]).toBeLessThan(h.sendPrompt.mock.invocationCallOrder[0])
  })
  it.each([{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }])('never sends an Android IME commit (%j)', async flags => {
    const h = textHarness()
    const event = { ...flags, preventDefault: vi.fn() }
    await h.sendTypedPrompt(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.voiceCall.end).not.toHaveBeenCalled()
    expect(h.sendPrompt).not.toHaveBeenCalled()
  })
  it('does not end audio on an empty send, and can send text without an active call', async () => {
    const empty = textHarness(true, false)
    await empty.sendTypedPrompt()
    expect(empty.voiceCall.end).not.toHaveBeenCalled()
    expect(empty.sendPrompt).not.toHaveBeenCalled()
    const text = textHarness(false)
    await text.sendTypedPrompt()
    expect(text.voiceCall.end).not.toHaveBeenCalled()
    expect(text.sendPrompt).toHaveBeenCalledOnce()
  })
  it('flushes the tab-change audio cleanup before starting a call from Settings', () => {
    expect(panel).toContain("watch([chatConfigId, activeTab], () => voiceCall.end(), { flush: 'sync' })")
    const start = panel.slice(panel.indexOf('function startVoiceCall()'), panel.indexOf('// Changing assistants/tabs'))
    expect(start.indexOf("activeTab.value = 'chat'")).toBeLessThan(start.indexOf('voiceCall.start()'))
    expect(start).toContain('phoneControlsOpen.value = false')
    expect(start).toContain('!selectedProviderReady.value')
  })
  it('uses the existing app bridge with searchable, touch-friendly selection and explicit save', () => {
    expect(settings).toContain('await installed.refresh()')
    expect(settings).toContain('aria-label="Search installed apps"')
    expect(settings).toContain('v-for="app in filteredApps"')
    expect(settings).toContain('min-height: 44px')
    expect(settings).toContain('Save app selection')
    expect(settings).toContain('Advanced: app package names')
    expect(settings).toContain('!status?.notificationAccess')
  })
})
