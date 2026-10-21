// CyberManju OS — Home command integration tests (tests/frontend/home-command-integration.test.ts).
// Role: Guard the home-bar handoff contract across the bar and its existing lazy panel consumers.
// Exports: none.
// Integrates: Vitest, Node fs, HomeCommandBar, AgentPanel and TerminalPanel.
// Contracts: User clicks stage drafts through wm.open; providers and shell execute only through their existing explicit submit flows.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bar = readFileSync('src/components/HomeCommandBar.vue', 'utf8')
const agent = readFileSync('src/components/AgentPanel.vue', 'utf8')
const terminal = readFileSync('src/components/TerminalPanel.vue', 'utf8')

describe('home command bar integration', () => {
  it('stages to the existing Assistant and cybsh windows through the window manager', () => {
    expect(bar).toContain("stageHomeCommand(target, text)")
    expect(bar).toContain('wm.open(target)')
    expect(bar).toContain("@click=\"stage('agent')\"")
    expect(bar).toContain("@click=\"stage('terminal')\"")
    expect(bar).not.toMatch(/fetch\s*\(|invoke\s*\(/)
  })

  it('AgentPanel appends a staged prompt and does not submit it automatically', () => {
    expect(agent).toContain("subscribeHomeCommand('agent'")
    expect(agent).toContain('promptInput.value ? `${promptInput.value}\\n${text}` : text')
    expect(agent).toContain("activeTab.value = 'chat'")
    expect(agent).not.toMatch(/subscribeHomeCommand\('agent',[\s\S]{0,300}sendPrompt\(/)
  })

  it('TerminalPanel appends staged text to its existing buffer and does not execute it automatically', () => {
    expect(terminal).toContain("subscribeHomeCommand('terminal'")
    expect(terminal).toContain('input.value ? `${input.value}\\n${text}` : text')
    expect(terminal).not.toMatch(/subscribeHomeCommand\('terminal',[\s\S]{0,300}submit\(/)
  })
})
