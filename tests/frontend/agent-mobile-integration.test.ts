// CyberManju OS — Mobile agent integration tests (tests/frontend/agent-mobile-integration.test.ts).
// Role: exercise UI session routing and native submission gaps without touching voice core.
// Exports: Vitest suite.
// Integrates: AgentPanel.vue handlers compiled with TypeScript, mocked UI/store boundaries.
// Contracts: selected transcript owns its assistant; failed drafts survive; double taps start once.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

const panel = readFileSync('src/components/AgentPanel.vue', 'utf8')
function compile(start: string, end: string, bindings: Record<string, unknown>, exports: string) {
  const source = panel.slice(panel.indexOf(start), panel.indexOf(end, panel.indexOf(start)))
    .replaceAll("const { invoke } = await import('@/composables/useTauri')", 'const invoke = invokeMock')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 })
  return new Function(...Object.keys(bindings), `${js}; return { ${exports} }`)(...Object.values(bindings))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function sendHarness() {
  const promptInput = { value: 'Keep my message' }
  const startingRun = { value: false }
  const chatConfigId = { value: 'assistant-a' }
  const viewing = { value: null as { id: string; configId: string } | null }
  const queue = { value: [] as Array<{ prompt: string; configId: string; sessionId?: string }> }
  const jobActive = { value: false }
  const store = {
    fetchAgentSessions: vi.fn(async () => {}),
    startAgentRun: vi.fn(async () => ({ jobId: 'started' }) as { jobId: string } | null),
    notifyError: vi.fn(),
  }
  const invokeMock = vi.fn(async () => ({ id: 'session-a', configId: 'assistant-a' }))
  const api = compile('async function sendPrompt(signal?', '/** Browser-local run:', {
    promptInput, startingRun, chatConfigId, viewing, queue, jobActive, store, invokeMock,
    canSend: { get value() { return !!promptInput.value.trim() && !startingRun.value } },
    selectedProviderReady: { value: true }, wasmMode: { value: false },
    scrollToBottom: vi.fn(), setViewing: (value: typeof viewing.value) => { viewing.value = value },
  }, 'sendPrompt')
  return { ...api, promptInput, startingRun, chatConfigId, viewing, queue, jobActive, store, invokeMock }
}

describe('mobile prompt submission', () => {
  it('locks a deferred create/start gap against a second tap', async () => {
    const h = sendHarness()
    const pending = deferred<{ id: string; configId: string }>()
    h.invokeMock.mockReturnValueOnce(pending.promise)
    const first = h.sendPrompt()
    expect(h.startingRun.value).toBe(true)
    h.promptInput.value = 'A newer draft'
    await h.sendPrompt()
    expect(h.invokeMock).toHaveBeenCalledOnce()
    pending.resolve({ id: 'session-a', configId: 'assistant-a' })
    await first
    expect(h.store.startAgentRun).toHaveBeenCalledExactlyOnceWith('assistant-a', 'Keep my message', 'session-a')
    expect(h.promptInput.value).toBe('A newer draft')
    expect(h.startingRun.value).toBe(false)
  })
  it('restores the prompt when session creation fails', async () => {
    const h = sendHarness()
    h.invokeMock.mockRejectedValueOnce(new Error('offline'))
    await h.sendPrompt()
    expect(h.promptInput.value).toBe('Keep my message')
    expect(h.startingRun.value).toBe(false)
    expect(h.store.startAgentRun).not.toHaveBeenCalled()
    expect(h.store.notifyError).toHaveBeenCalledOnce()
  })
  it('restores the prompt when the store refuses to start the run', async () => {
    const h = sendHarness()
    h.store.startAgentRun.mockResolvedValueOnce(null)
    await h.sendPrompt()
    expect(h.promptInput.value).toBe('Keep my message')
    expect(h.startingRun.value).toBe(false)
  })
  it('never overwrites a newer draft after an async failure', async () => {
    const h = sendHarness()
    const pending = deferred<{ id: string; configId: string }>()
    h.invokeMock.mockReturnValueOnce(pending.promise)
    const first = h.sendPrompt()
    h.promptInput.value = 'Do not replace this'
    pending.reject(new Error('offline'))
    await first
    expect(h.promptInput.value).toBe('Do not replace this')
    expect(h.queue.value).toEqual([{ prompt: 'Keep my message', configId: 'assistant-a' }])
  })
  it('does not redirect an in-flight prompt after changing assistants', async () => {
    const h = sendHarness()
    const pending = deferred<{ id: string; configId: string }>()
    h.invokeMock.mockReturnValueOnce(pending.promise)
    const first = h.sendPrompt()
    h.chatConfigId.value = 'assistant-b'
    pending.resolve({ id: 'session-a', configId: 'assistant-a' })
    await first
    expect(h.store.startAgentRun).not.toHaveBeenCalled()
    expect(h.promptInput.value).toBe('Keep my message')
  })
  it('retains follow-up queueing while an existing job is active', async () => {
    const h = sendHarness()
    h.jobActive.value = true
    await h.sendPrompt()
    expect(h.queue.value).toEqual([{ prompt: 'Keep my message', configId: 'assistant-a' }])
    expect(h.promptInput.value).toBe('')
    expect(h.invokeMock).not.toHaveBeenCalled()
  })
  it('reuses the selected assistant session and clears a successfully sent draft', async () => {
    const h = sendHarness()
    h.viewing.value = { id: 'existing-session', configId: 'assistant-a' }
    await h.sendPrompt()
    expect(h.invokeMock).not.toHaveBeenCalled()
    expect(h.store.startAgentRun).toHaveBeenCalledWith('assistant-a', 'Keep my message', 'existing-session')
    expect(h.promptInput.value).toBe('')
  })
})

describe('safe queue resumption', () => {
  function harness() {
    const h = sendHarness()
    h.promptInput.value = ''
    h.viewing.value = { id: 'thread-a', configId: 'assistant-a' }
    h.queue.value = [
      { prompt: 'First follow-up', configId: 'assistant-a', sessionId: 'thread-a' },
      { prompt: 'Second follow-up', configId: 'assistant-a', sessionId: 'thread-a' },
    ]
    const api = compile('const queueCanResume = computed', '/** Terminal status:', {
      ...h, selectedProviderReady: { value: true },
      computed: (get: () => unknown) => ({ get value() { return get() } }),
    }, 'queueCanResume, sendNextQueued')
    return { ...h, ...api }
  }
  it('sends the next prompt through the existing pipeline and leaves the rest queued', async () => {
    const h = harness()
    await h.sendNextQueued()
    expect(h.store.startAgentRun).toHaveBeenCalledWith('assistant-a', 'First follow-up', 'thread-a')
    expect(h.queue.value.map(q => q.prompt)).toEqual(['Second follow-up'])
  })
  it.each(['assistant', 'conversation'])('never redirects a queued message after changing %s', async field => {
    const h = harness()
    if (field === 'assistant') h.chatConfigId.value = 'assistant-b'
    else h.viewing.value = { id: 'thread-b', configId: 'assistant-a' }
    await h.sendNextQueued()
    expect(h.queue.value).toHaveLength(2)
    expect(h.store.startAgentRun).not.toHaveBeenCalled()
  })
  it('preserves a new draft instead of overwriting it with a queued prompt', async () => {
    const h = harness()
    h.promptInput.value = 'Still editing'
    await h.sendNextQueued()
    expect(h.promptInput.value).toBe('Still editing')
    expect(h.queue.value).toHaveLength(2)
    expect(h.store.startAgentRun).not.toHaveBeenCalled()
  })
  it('keeps failed queued work recoverable and later messages available for manual resume', async () => {
    const h = harness()
    h.store.startAgentRun.mockResolvedValueOnce(null)
    await h.sendNextQueued()
    expect(h.promptInput.value).toBe('First follow-up')
    expect(h.queue.value.map(q => q.prompt)).toEqual(['Second follow-up'])
    await h.sendNextQueued()
    expect(h.store.startAgentRun).toHaveBeenCalledOnce()
    expect(panel).toContain('Send next queued message')
  })
  it('waits for the start lock and never automatically resumes cancelled or failed work', async () => {
    const h = harness()
    h.startingRun.value = true
    await h.sendNextQueued()
    expect(h.queue.value).toHaveLength(2)
    expect(h.store.startAgentRun).not.toHaveBeenCalled()
    expect(panel).toContain("if (status !== 'done' || starting || jobActive.value || !queue.value.length) return")
    expect(panel).toContain('() => [activeJob.value?.status, startingRun.value] as const')
  })
})

describe('conversation routing', () => {
  function harness() {
    const chatConfigId = { value: 'a' }
    const activeTab = { value: 'setup' }
    const setViewing = vi.fn()
    const store = { loadAgentSession: vi.fn() }
    const api = compile('let sessionLoadRevision = 0', 'function removeSession', {
      chatConfigId, activeTab, setViewing, store,
      configs: { value: [{ id: 'a' }, { id: 'b' }] }, wasmMode: { value: false },
    }, 'loadSession')
    return { ...api, chatConfigId, activeTab, setViewing, store }
  }
  it('adopts the loaded conversation assistant and opens Chat', async () => {
    const h = harness()
    h.store.loadAgentSession.mockResolvedValue({ id: 'thread-b', configId: 'b' })
    await h.loadSession('thread-b')
    expect(h.chatConfigId.value).toBe('b')
    expect(h.activeTab.value).toBe('chat')
    expect(h.setViewing).toHaveBeenCalledWith({ id: 'thread-b', configId: 'b' })
  })
  it('does not silently use another assistant for a deleted-config transcript', async () => {
    const h = harness()
    h.store.loadAgentSession.mockResolvedValue({ id: 'orphan', configId: 'deleted' })
    await h.loadSession('orphan')
    expect(h.chatConfigId.value).toBe('')
    expect(h.setViewing).toHaveBeenCalledOnce()
  })
  it('ignores an older session load completing after the latest selection', async () => {
    const h = harness()
    const old = deferred<unknown>()
    h.store.loadAgentSession.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ id: 'latest', configId: 'b' })
    const first = h.loadSession('old')
    await h.loadSession('latest')
    old.resolve({ id: 'old', configId: 'a' })
    await first
    expect(h.chatConfigId.value).toBe('b')
    expect(h.setViewing).toHaveBeenCalledExactlyOnceWith({ id: 'latest', configId: 'b' })
  })
})

describe('touch UI and provider readiness', () => {
  it('offers recovery for an unkeyed selected assistant even when another is ready', () => {
    expect(panel).toContain('v-else-if="!selectedProviderReady" class="agent-provider-notice"')
    expect(panel).toContain('@click="editSetup(chatConfig)">Add API key')
    expect(panel).toContain('@click="sidebarOpen = true">Choose assistant')
    expect(panel).toContain('v-if="selectedProviderReady && !viewing"')
  })
  it('exposes a persistent cancel control outside Chat', () => {
    const header = panel.slice(panel.indexOf('<header'), panel.indexOf('</header>'))
    expect(header).toContain('v-if="jobActive && activeTab !== \'chat\'"')
    expect(header).toContain('aria-label="Stop current task"')
    expect(header).toContain('@click="abortJob"')
  })
  it('opens language choices on tap without hover and provides 44px targets', () => {
    expect(panel).toContain('aria-label="Choose dictation language"')
    expect(panel).toContain('@click="dictationLanguageOpen = !dictationLanguageOpen"')
    expect(panel).toContain('v-if="dictationLanguageOpen"')
    expect(panel).not.toContain('.voice-group:hover .voice-pop')
    expect(panel).toMatch(/\.voice-opt\s*\{[^}]*min-height: 44px/)
    expect(panel).toContain("voice.setLang('pt-BR'); dictationLanguageOpen = false")
  })
  it('honors explicit auth overrides over a preset keyless flag', () => {
    const api = compile('function isKeyless(cfg:', 'function localConfigFromForm', {
      providers: { value: [{ id: 'local', keyless: true }, { id: 'remote', keyless: false }] },
    }, 'isKeyless')
    expect(api.isKeyless({ providerId: 'custom', authSchemeOverride: 'none' })).toBe(true)
    expect(api.isKeyless({ providerId: 'local' })).toBe(true)
    expect(api.isKeyless({ providerId: 'local', authSchemeOverride: 'bearer' })).toBe(false)
    expect(api.isKeyless({ providerId: 'remote' })).toBe(false)
    expect(panel).toContain('if (!key && !isKeyless(cfg) && !fallbackRoutes.length)')
    expect(panel).toContain('if (!fkey && !isKeyless(fc)) continue')
    expect(panel).toContain("chatConfig && isKeyless(chatConfig) ? 'No API key needed'")
    expect(panel).toContain('v-if="!selectedProviderReady" class="agent-caps-key"')
  })
})
