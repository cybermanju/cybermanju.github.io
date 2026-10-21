// CyberManju OS — Agent setup tests (tests/frontend/agent-setup.test.ts).
// Role: prevent model/key save regressions and unsafe connection credential reuse.
// Exports: Vitest suite.
// Integrates: agentSetup helpers and AgentPanel settings UI.
// Contracts: blank means keep; edits retain identity; replacement keys use the saved id.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { agentPermissionPreset, type AgentConfig } from '../../src/types'
import { mergeAgentDraft, sameAgentConnection, persistAgentSetup } from '../../src/utils/agentSetup'

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'existing', name: 'My agent', providerId: 'openai', model: 'chosen-model',
    workingDir: '/project', agentKind: 'build', shellMode: 'auto',
    permission: agentPermissionPreset('balanced'), autoApprove: false, maxTurns: 25,
    hasKey: true, createdAt: 'original', updatedAt: 'now', fallbackIds: ['backup'],
    mcpServers: { tools: { transport: 'http', args: [], env: {}, headers: [], enabled: true } },
    ...overrides,
  }
}

const panel = readFileSync('src/components/AgentPanel.vue', 'utf8')

describe('assistant configuration identity', () => {
  it('keeps the saved identity, key metadata, creation time, routes, and tools on model edits', () => {
    const previous = config()
    const draft = config({ id: 'fresh', model: 'new-model', name: 'Renamed', hasKey: false, fallbackIds: [], mcpServers: {}, createdAt: 'new' })
    expect(mergeAgentDraft(draft, previous)).toMatchObject({
      id: 'existing', name: 'Renamed', model: 'new-model', hasKey: true,
      createdAt: 'original', fallbackIds: ['backup'], mcpServers: previous.mcpServers,
    })
    expect(previous.model).toBe('chosen-model')
  })

  it.each([
    { providerId: 'other-provider' },
    { baseUrlOverride: 'https://other.example/v1' },
    { dialectOverride: 'anthropic' as const },
    { authSchemeOverride: 'query' as const },
    { authNameOverride: 'new-key-header' },
  ])('never carries keys to a changed connection %o', change => {
    const draft = config({ ...change, id: 'fresh', hasKey: true })
    const merged = mergeAgentDraft(draft, config())
    expect(merged.id).toBe('fresh')
    expect(merged.hasKey).toBe(false)
  })

  it('normalizes transport nulls, empty endpoints and trailing slashes', () => {
    expect(sameAgentConnection(config({ baseUrlOverride: null, dialectOverride: null, authSchemeOverride: null, authNameOverride: null }), config())).toBe(true)
    expect(sameAgentConnection(config({ baseUrlOverride: 'https://api.example/v1/' }), config({ baseUrlOverride: ' https://api.example/v1 ' }))).toBe(true)
  })

  it('does not mark a brand-new config keyed', () => {
    expect(mergeAgentDraft(config()).hasKey).toBe(false)
  })
})

describe('integrated model and API-key saving', () => {
  it.each(['', '   '])('never writes a blank replacement key (%j)', async key => {
    const saveKey = vi.fn()
    const saved = config({ model: 'edited-model' })
    const onConfigSaved = vi.fn()
    const result = await persistAgentSetup(saved, key, {
      saveConfig: vi.fn().mockResolvedValue(saved), saveKey, onConfigSaved,
    })
    expect(saveKey).not.toHaveBeenCalled()
    expect(result?.config).toMatchObject({ id: 'existing', model: 'edited-model', hasKey: true })
    expect(onConfigSaved).toHaveBeenCalledWith(saved)
  })

  it('saves a new model and its key to the returned id without resetting the model/name', async () => {
    const events: string[] = []
    const saved = config({ id: 'backend-id', name: 'Personal', model: 'manual-model', hasKey: false })
    const saveKey = vi.fn(async (id, key) => { events.push('key'); return id === saved.id && key === 'test-only-key' })
    const result = await persistAgentSetup(config({ id: 'temporary-id' }), ' test-only-key ', {
      saveConfig: async () => { events.push('config'); return saved },
      onConfigSaved: cfg => { events.push('adopt:' + cfg.id) }, saveKey,
    })
    expect(events).toEqual(['config', 'adopt:backend-id', 'key'])
    expect(saveKey).toHaveBeenCalledWith('backend-id', 'test-only-key')
    expect(result).toEqual({ config: { ...saved, hasKey: true }, keySaved: true })
  })

  it('never saves a key when the config could not be saved', async () => {
    const saveKey = vi.fn()
    const onConfigSaved = vi.fn()
    expect(await persistAgentSetup(config(), 'test-only-key', {
      saveConfig: vi.fn().mockResolvedValue(null), saveKey, onConfigSaved,
    })).toBeNull()
    expect(saveKey).not.toHaveBeenCalled()
    expect(onConfigSaved).not.toHaveBeenCalled()
  })

  it('retains the saved identity after key failure so a retry updates the same config', async () => {
    let identity = ''
    const saveKey = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const saved = config({ id: 'retry-id', hasKey: false })
    const persistence = {
      saveConfig: vi.fn(async () => saved), saveKey,
      onConfigSaved: (cfg: AgentConfig) => { identity = cfg.id },
    }
    const failed = await persistAgentSetup(saved, 'test-only-key', persistence)
    expect(identity).toBe('retry-id')
    expect(failed).toEqual({ config: saved, keySaved: false })
    const retried = await persistAgentSetup({ ...saved, id: identity }, 'test-only-key', persistence)
    expect(retried?.keySaved).toBe(true)
    expect(saveKey.mock.calls.map(([id]) => id)).toEqual(['retry-id', 'retry-id'])
  })
})

describe('compact mobile agent settings', () => {
  it('keeps an accessible settings shortcut outside the hidden desktop toolbar', () => {
    const shortcut = panel.indexOf('class="agent-nav-toggle agent-settings-shortcut"')
    expect(shortcut).toBeGreaterThan(-1)
    expect(shortcut).toBeLessThan(panel.indexOf('<div class="agent-header-meta">'))
    expect(panel.slice(shortcut, panel.indexOf('</button>', shortcut))).toContain('aria-label="Assistant settings"')
  })

  it('groups provider/model/key before advanced fields with one save action', () => {
    const setup = panel.slice(panel.indexOf('aria-label="Assistant setup"'), panel.indexOf('<!-- Controls tab:'))
    expect(setup.indexOf('aria-label="Model provider"')).toBeLessThan(setup.indexOf('aria-label="Model id"'))
    expect(setup.indexOf('aria-label="API key"')).toBeLessThan(setup.indexOf('<details class="agent-advanced">'))
    expect(setup).toContain('Save changes')
    expect(setup).not.toContain('Save key')
    expect(setup).not.toContain('SEAL KEY')
    expect(setup).toContain('role="status"')
  })

  it('loads current config into an explicit editor and never uses sidebar selection as a key fallback', () => {
    expect(panel).toContain('function editSetup(cfg: AgentConfig)')
    expect(panel).toContain('mergeAgentDraft(localConfigFromForm(), editingConfig.value)')
    expect(panel).not.toContain('effectiveKeyConfigId')
    expect(panel).not.toContain('chatConfigId.value || savedConfigId.value')
  })
})

describe('provider connection onboarding', () => {
  it('shows a clear no-provider state with a working route into provider setup', () => {
    expect(panel).toContain('NO PROVIDER CONNECTED')
    expect(panel).toContain('Connect an AI provider and save its API key')
    expect(panel).toContain('aria-live="polite"')
    expect(panel).toContain('>CONNECT</UiButton>')
    expect(panel).toContain('@click="openSetup">CONNECT</UiButton>')
    expect(panel).toContain('const hasUsableProvider = computed(() => configs.value.some(cfg => cfg.hasKey || isKeyless(cfg)))')
  })

  it('blocks prompt dispatch and hides the composer until the selected provider is usable', () => {
    expect(panel).toContain('const selectedProviderReady = computed(() => {')
    expect(panel).toContain('return !!cfg && (cfg.hasKey || isKeyless(cfg))')
    expect(panel).toContain('v-if="selectedProviderReady" class="composer"')
    expect(panel).toContain('const canSend = computed(() => promptInput.value.trim() !== \'\' && selectedProviderReady.value)')
    expect(panel).toContain('if (!canSend.value || !selectedProviderReady.value) return')
  })
})
