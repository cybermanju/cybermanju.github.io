// CyberManju OS — Agent config persistence tests (tests/frontend/agent-config-persistence.test.ts).
// Regression coverage for config updates that must not hide keys held by the local vault or native store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  LOCAL_CONFIGS_KEY,
  forgetLocalKey,
  getLocalKey,
  hasLocalKey,
  listLocalConfigs,
  saveLocalConfig,
  setLocalKey,
} from '../../src/composables/useAgent'
import { useAppStore } from '../../src/stores/app'
import { agentPermissionPreset, type AgentConfig } from '../../src/types'

const { invokeMock, notifyMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  notifyMock: vi.fn(),
}))

vi.mock('@/composables/useTauri', () => ({
  invoke: invokeMock,
  getAuthToken: () => '',
  isStaticHost: () => false,
  isWebMode: () => false,
  setAuthToken: vi.fn(),
}))

vi.mock('@/composables/useNotifications', () => ({
  useNotifications: () => ({ notify: notifyMock }),
}))

vi.mock('@/composables/useWindowManager', () => ({
  useWindowManager: () => ({ open: vi.fn() }),
}))

const localConfig = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'local-key-config',
  name: 'Local',
  providerId: 'openrouter',
  model: 'gpt-4o',
  workingDir: '',
  agentKind: 'build',
  permission: agentPermissionPreset('balanced'),
  autoApprove: false,
  maxTurns: 25,
  hasKey: false,
  createdAt: 'created',
  updatedAt: 'updated',
  ...over,
})

const nativeConfig = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  ...localConfig({ id: 'native-key-config', hasKey: true }),
  ...over,
})

beforeEach(() => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  })
  forgetLocalKey('local-key-config')
  invokeMock.mockReset()
  notifyMock.mockReset()
})

afterEach(() => {
  forgetLocalKey('local-key-config')
  vi.unstubAllGlobals()
})

describe('local agent config key metadata', () => {
  it('does not clear an existing in-memory key or mark it missing from a stale false snapshot', () => {
    const key = 'provider-secret'
    setLocalKey('local-key-config', key)

    saveLocalConfig(localConfig({ hasKey: false }))

    expect(getLocalKey('local-key-config')).toBe(key)
    expect(hasLocalKey('local-key-config')).toBe(true)
    expect(listLocalConfigs()).toEqual([localConfig({ hasKey: true })])
    const stored = JSON.parse(localStorage.getItem(LOCAL_CONFIGS_KEY) ?? '[]') as AgentConfig[]
    expect(stored[0].hasKey).toBe(true)
    expect(JSON.stringify(stored)).not.toContain(key)
  })

  it('clears the volatile key only when explicitly asked to clear it', () => {
    setLocalKey('local-key-config', 'provider-secret')
    setLocalKey('local-key-config', '')
    saveLocalConfig(localConfig({ hasKey: true }))

    expect(hasLocalKey('local-key-config')).toBe(false)
    expect(getLocalKey('local-key-config')).toBe('')
    expect(listLocalConfigs()[0].hasKey).toBe(false)
  })
})

describe('native app-store config updates', () => {
  it('sends the known hasKey bit on update and adopts the native vault-derived response', async () => {
    const stored = nativeConfig()
    const saveResponse = { ...stored, updatedAt: 'saved' }
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'save_agent_config') return saveResponse
      if (command === 'list_agent_configs') return [saveResponse]
      throw new Error(`unexpected command: ${command}`)
    })

    setActivePinia(createPinia())
    const store = useAppStore()
    store.agentConfigs = [stored]
    const saved = await store.saveAgentConfig({
      id: stored.id,
      name: stored.name,
      providerId: stored.providerId,
      model: stored.model,
      workingDir: stored.workingDir,
      agentKind: stored.agentKind,
      permission: stored.permission,
      autoApprove: stored.autoApprove,
      maxTurns: stored.maxTurns,
    })

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'save_agent_config', {
      config: expect.objectContaining({ id: stored.id, hasKey: true }),
    })
    expect(saved?.hasKey).toBe(true)
    expect(store.agentConfigs[0].hasKey).toBe(true)
  })
})
