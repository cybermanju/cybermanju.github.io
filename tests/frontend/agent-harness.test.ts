// CyberManju OS — Agent harness.test (tests/frontend/agent-harness.test.ts).
// Agent harness helpers — the shared surface AgentPanel + CodeStudio consume.
import { describe, expect, it } from 'vitest'
import {
  capabilitySummary,
  contextPctOf,
  formatTokens,
  quickPrompts,
  slashCommands,
} from '../../src/composables/useAgentHarness'
import { localProviderEndpoint } from '../../src/composables/useAgent'
import { agentPermissionPreset, type AgentConfig } from '../../src/types'

function cfg(over: Partial<AgentConfig> = {}): AgentConfig {
  const now = new Date().toISOString()
  return {
    id: 'cfg-1',
    name: 'Test',
    providerId: 'openrouter',
    model: 'gpt-4o',
    workingDir: '',
    agentKind: 'build',
    permission: agentPermissionPreset('balanced'),
    autoApprove: false,
    maxTurns: 25,
    hasKey: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('browser provider endpoint auth routing', () => {
  it('retains route query authentication on rebuilt OpenAI and Anthropic endpoints', () => {
    expect(localProviderEndpoint('https://api.example/v1?api_key=a%2Bb&tenant=x', 'openAi'))
      .toBe('https://api.example/v1/chat/completions?api_key=a%2Bb&tenant=x')
    expect(localProviderEndpoint('https://api.example/?key=secret', 'anthropic'))
      .toBe('https://api.example/v1/messages?key=secret')
  })

  it('does not add query credentials to a separate fallback route', () => {
    expect(localProviderEndpoint('https://fallback.example/v1', 'openAi'))
      .toBe('https://fallback.example/v1/chat/completions')
  })
})

describe('formatTokens', () => {
  it('formats compactly', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('capabilitySummary', () => {
  it('describes a keyless build config in plain language', () => {
    const s = capabilitySummary(cfg({ hasKey: true }), null, false)
    expect(s.persona).toBe('Build')
    expect(s.hasKey).toBe(true)
    expect(s.permission).toBe('BALANCED')
  })

  it('marks plan persona read-only', () => {
    const s = capabilitySummary(cfg({ agentKind: 'plan' }), null, false)
    expect(s.persona).toBe('Plan')
    expect(s.personaHint).toMatch(/read-only/i)
  })

  it('reports browser sandbox shell in wasm mode', () => {
    const s = capabilitySummary(cfg(), null, true)
    expect(s.shell).toMatch(/browser/i)
  })
})

describe('contextPctOf', () => {
  it('stays within 0-100', () => {
    const pct = contextPctOf([{ role: 'user', content: 'hi' }], 'gpt-4o')
    expect(pct).toBeGreaterThanOrEqual(0)
    expect(pct).toBeLessThanOrEqual(100)
  })
})

describe('composer aids', () => {
  it('ships quick prompts and slash commands', () => {
    expect(quickPrompts.length).toBeGreaterThan(0)
    expect(slashCommands.map(s => s.cmd)).toContain('/read')
  })
})
