// CyberManju OS — Agent workspace tests (tests/frontend/agent-workspace.test.ts).
// Role: Guard isolated drafts, actual native DTOs, single-recipient routing and fail-closed public chat.
// Exports: Vitest suite.
// Integrates: Actual Vue refs and SFC setup functions; clearly test-only fixtures, no app persistence.
// Contracts: No protocol bubbles, implicit tools/context, fake delivery, cross-owner acknowledgments or double submit.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import { userVisibleAgentEvents } from '@/utils/agentEventVisibility'
import { focusActiveWorkspaceHeading } from '@/utils/agentWorkspaceFocus'
import { useAgentWorkspaceNavigation } from '@/composables/useAgentWorkspaceNavigation'

const read = (name: string) => readFileSync(`src/components/agents/${name}.vue`, 'utf8')
function setup(name: string, props: Record<string, unknown>, exports: string) {
  const source = parse(read(name)).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '').replace(/^const props = defineProps.*$/m, 'const props = suppliedProps').replace(/^const emit = defineEmits.*$/m, 'const emit = emitSpy')
  const emit = vi.fn()
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 })
  const api = new Function('suppliedProps', 'emitSpy', 'computed', 'reactive', 'ref', 'watch', 'nextTick', 'userVisibleAgentEvents', `${js}; return { ${exports} }`)(props, emit, computed, reactive, ref, watch, nextTick, userVisibleAgentEvents)
  return { ...api, emit }
}
function workspace(overrides: Record<string, unknown> = {}) {
  const props = reactive({ available: true, profiles: [profile('a'), profile('b')], conversations: [conversation], events: [], configs: [], supportedConfigIds: [], ownerScope: 'native:local:epoch-1', canDelegate: true, busy: false, ...overrides })
  const source = parse(readFileSync('src/components/AgentsWorkspace.vue', 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '').replace(/const props = withDefaults[\s\S]*?\nconst emit = defineEmits[\s\S]*?\nconst pendingAction/, 'const props = suppliedProps\nconst emit = emitSpy\nconst pendingAction')
  const emit = vi.fn()
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 })
  const api = new Function('suppliedProps', 'emitSpy', 'computed', 'ref', 'watch', 'nextTick', 'defineAsyncComponent', 'onMounted', 'onBeforeUnmount', 'defineExpose', 'userVisibleAgentEvents', 'focusActiveWorkspaceHeading', 'useAgentWorkspaceNavigation', `${js}; return { openConversation, openProfile, openForm, profileSaved, conversationCreated, sendConfirmed, send, delegate, working, activeConversationId, nav, formView, reset }`)(props, emit, computed, ref, watch, nextTick, () => null, () => {}, () => {}, () => {}, userVisibleAgentEvents, focusActiveWorkspaceHeading, useAgentWorkspaceNavigation)
  return { ...api, props, emit }
}
const profile = (id: string) => ({ id, ownerId: 'local', name: id, providerConfigId: 'sealed', personality: '', goals: [], interests: [], knowledge: [], createdAt: '', updatedAt: '' })
const conversation = { id: 'chat-a', kind: 'direct', title: 'Direct', ownerId: 'local', members: ['a', 'b'], lastSeq: 0, createdAt: '' }
// Visibility is the explicitly confirmed future discriminator; legacy/missing values must remain hidden until projection integration.
const event = (id: string, seq: number, conversationId = 'chat-a') => ({ id, seq, conversationId, kind: 'message', senderId: null, recipientId: 'a', text: 'test', createdAt: '', runId: null, visibility: 'user' })
const profileProps = () => ({ profile: profile('a'), configs: [{ id: 'sealed', model: 'real-model', providerId: 'real-adapter' }], supportedConfigIds: ['sealed'], busy: false })
const chatProps = () => ({ conversation, profiles: [profile('a'), profile('b')], events: [], draft: 'hello', busy: false, loading: false, userVisibleEventIds: [] })

describe('Agent workspace navigation and scope', () => {
  it('focuses only a visible heading inside the active detail host', () => {
    const heading = { focus: vi.fn(), getClientRects: () => [{ width: 10, height: 10 }] } as unknown as HTMLElement
    const root = { querySelector: vi.fn(() => heading) } as unknown as ParentNode
    expect(focusActiveWorkspaceHeading(root, true)).toBe(true)
    expect(heading.focus).toHaveBeenCalledOnce()
    expect(root.querySelector).toHaveBeenCalledWith('.aw-content-host h1, .aw-content-host .aw-chat-title')
    expect(focusActiveWorkspaceHeading(root, false)).toBe(false)
    const hidden = { focus: vi.fn(), getClientRects: () => [] } as unknown as HTMLElement
    expect(focusActiveWorkspaceHeading({ querySelector: () => hidden } as unknown as ParentNode, true)).toBe(false)
    expect(hidden.focus).not.toHaveBeenCalled()
  })
  it('pops inner screens before closing the agent sheet and ignores other panels', () => {
    const nav = useAgentWorkspaceNavigation()
    nav.open({ view: 'conversation', id: 'chat-a' }); nav.open({ view: 'profile', id: 'a' })
    const other = new Event('back', { cancelable: true }); Object.assign(other, { detail: { panel: 'files' } })
    nav.handleMobileBack(other); expect(other.defaultPrevented).toBe(false)
    const back = new Event('back', { cancelable: true }); Object.assign(back, { detail: { panel: 'agent' } })
    nav.handleMobileBack(back); expect(back.defaultPrevented).toBe(true)
    expect(nav.route.value).toEqual({ view: 'conversation', id: 'chat-a' }); nav.back(); expect(nav.back()).toBe(false)
  })
  it('keeps drafts scoped and never clears a newer edit after an acknowledged send', () => {
    const nav = useAgentWorkspaceNavigation(); nav.setDraft('a', 'sent'); nav.setDraft('b', 'private b'); nav.setDraft('a', 'newer')
    nav.clearSubmittedDraft('a', 'sent'); expect(nav.draftFor('a')).toBe('newer'); expect(nav.draftFor('b')).toBe('private b')
    nav.clearSubmittedDraft('a', 'newer'); expect(nav.draftFor('a')).toBe(''); nav.reset(); expect(nav.draftFor('b')).toBe('')
  })
  it('does not duplicate a route or accept empty draft ownership', () => {
    const nav = useAgentWorkspaceNavigation(); nav.open({ view: 'inbox' }); expect(nav.canGoBack.value).toBe(false); nav.setDraft('', 'orphan'); expect(nav.draftFor('')).toBe('')
  })
  it('rejects old-scope save/send acknowledgments and clears drafts on owner/transport changes', async () => {
    const h = workspace(); h.openConversation('chat-a'); h.nav.setDraft('chat-a', 'new text')
    h.sendConfirmed('chat-a', 'new text', 'old-scope'); expect(h.nav.draftFor('chat-a')).toBe('new text')
    h.props.ownerScope = 'native:local:epoch-2'; await nextTick(); expect(h.nav.draftFor('chat-a')).toBe(''); expect(h.nav.route.value.view).toBe('inbox')
    h.profileSaved('a', 'native:local:epoch-1'); h.conversationCreated('chat-a', 'native:local:epoch-1'); expect(h.nav.route.value.view).toBe('inbox')
  })
  it('does not let an old completion unlock a newer owner-scoped operation', async () => {
    const h = workspace(); h.openConversation('chat-a'); h.send('first', 'a', vi.fn())
    const oldDone = h.emit.mock.calls.find((call: unknown[]) => call[0] === 'send').at(-1)
    h.props.ownerScope = 'native:local:epoch-2'; await nextTick(); h.openConversation('chat-a'); h.send('second', 'b', vi.fn()); oldDone()
    expect(h.working.value).toBe(true)
    h.emit.mock.calls.filter((call: unknown[]) => call[0] === 'send')[1].at(-1)(); expect(h.working.value).toBe(false)
  })
  it('blocks group-agent delegation even when the generic native capability is enabled', () => {
    const h = workspace({ conversations: [{ ...conversation, kind: 'group' }] }); h.openConversation('chat-a'); h.openForm('delegate'); expect(h.formView.value).toBe('')
    const complete = vi.fn(); h.delegate({ senderId: 'a', recipientId: 'b', text: 'task', selectedContext: [], toolGrants: [] }, complete)
    expect(h.emit.mock.calls.some((call: unknown[]) => call[0] === 'delegate')).toBe(false); expect(complete).toHaveBeenCalledOnce()
  })
})

describe('actual profile and conversation inputs', () => {
  it('keeps New chat available when a search hides every profile', () => {
    const h = setup('AgentInbox', { profiles: [profile('a')], conversations: [], loading: false, available: true }, 'profiles, query, canCreateConversation')
    h.query.value = 'no match'
    expect(h.profiles.value).toHaveLength(0)
    expect(h.canCreateConversation.value).toBe(true)
  })
  it('emits only ProfileInput fields, not fabricated workspace/revision/key fields', () => {
    const h = setup('AgentProfileEditor', profileProps(), 'form, valid, submit'); h.form.goals = 'goal one\n\n goal two '; h.submit()
    expect(h.emit).toHaveBeenCalledWith('save', expect.objectContaining({ providerConfigId: 'sealed', goals: ['goal one', 'goal two'] }), expect.any(Function))
    for (const field of ['key', 'workspaceId', 'revision', 'ownerId']) expect(h.emit.mock.calls[0][1]).not.toHaveProperty(field)
  })
  it('requires a real supported config and enforces UTF-8 byte and note limits', () => {
    const props = profileProps(); const h = setup('AgentProfileEditor', props, 'form, valid'); expect(h.valid.value).toBe(true)
    h.form.name = 'ç'.repeat(129); expect(h.valid.value).toBe(false); h.form.name = 'Name'; h.form.knowledge = Array(65).fill('note').join('\n'); expect(h.valid.value).toBe(false)
    h.form.knowledge = ''; h.form.providerConfigId = 'unsupported'; expect(h.valid.value).toBe(false)
  })
  it('accepts direct 1–2 or group 1–16 real members and emits members[]', () => {
    const h = setup('AgentConversationForm', { profiles: [profile('a'), profile('b'), profile('c')], busy: false }, 'title, kind, memberAgentIds, valid, submit')
    h.title.value = 'Conversation'; h.kind.value = 'direct'; h.memberAgentIds.value = ['a']; expect(h.valid.value).toBe(true)
    h.memberAgentIds.value = ['a', 'b']; expect(h.valid.value).toBe(true); h.memberAgentIds.value = ['a', 'b', 'c']; expect(h.valid.value).toBe(false)
    h.kind.value = 'group'; expect(h.valid.value).toBe(true); h.submit(); expect(h.emit.mock.calls[0][1]).toEqual({ kind: 'group', title: 'Conversation', members: ['a', 'b', 'c'] })
  })
})

describe('public projection fail-closed and one-recipient sends', () => {
  it('renders nothing without an explicit public projection allowlist', () => {
    expect(userVisibleAgentEvents([event('user', 1)] as any, 'chat-a')).toEqual([])
  })
  it('rejects internal, unknown, null and missing visibility even if ids are allowlisted', () => {
    const values = [null, undefined, event('public', 1), { ...event('internal', 2), visibility: 'internal', text: 'SECRET PROTOCOL' }, { ...event('missing', 3), visibility: undefined }, { ...event('unknown', 4), visibility: 'future' }, { ...event('badkind', 5), kind: 'internalUnknown', visibility: 'user' }, { ...event('nullkind', 6), kind: null }]
    expect(userVisibleAgentEvents(values as any, 'chat-a', ['public', 'internal', 'missing', 'unknown', 'badkind', 'nullkind']).map(e => e.id)).toEqual(['public'])
  })
  it('filters other conversations, deduplicates and orders safe public messages', () => {
    const props = { ...chatProps(), events: [event('second', 2), event('other', 1, 'private-chat'), event('first', 1), event('second', 2)], userVisibleEventIds: ['first', 'second', 'other'] }
    const h = setup('AgentConversationView', props, 'events, recipientId, canSend, send'); expect(h.events.value.map((e: { id: string }) => e.id)).toEqual(['first', 'second'])
    h.recipientId.value = 'foreign'; h.send(); expect(h.emit).not.toHaveBeenCalled(); h.recipientId.value = 'a'; h.send(); expect(h.emit).toHaveBeenCalledWith('send', 'hello', 'a', expect.any(Function))
  })
  it('can persist a user note without silently dispatching a provider run', () => {
    const h = setup('AgentConversationView', chatProps(), 'recipientId, send'); expect(h.recipientId.value).toBe(''); h.send(); expect(h.emit).toHaveBeenCalledWith('send', 'hello', null, expect.any(Function))
  })
  it('limits sends to 16,384 UTF-8 bytes and displays only real known compact run states', () => {
    const h = setup('AgentConversationView', { ...chatProps(), draft: 'ç'.repeat(8193), runStates: [{ id: 'valid', conversationId: 'chat-a', recipientId: 'a', status: 'running' }, { id: 'foreign', conversationId: 'private', recipientId: 'a', status: 'completed' }, { id: 'unknown', conversationId: 'chat-a', recipientId: 'a', status: 'made-up' }] }, 'canSend, runStates')
    expect(h.canSend.value).toBe(false); expect(h.runStates.value.map((run: { id: string }) => run.id)).toEqual(['valid'])
  })
})

describe('bounded tool-less delegation and synchronous guards', () => {
  it('requires explicit review and sends text context, never event ids or tool grants', () => {
    const h = setup('AgentDelegationForm', { members: [profile('a'), profile('b')], events: [event('first', 1)], busy: false }, 'fromAgentId, toAgentId, task, contextEventIds, reviewing, submit')
    h.fromAgentId.value = 'a'; h.toAgentId.value = 'b'; h.task.value = 'Bounded task'; h.contextEventIds.value = ['first']; h.submit(); expect(h.reviewing.value).toBe(true); expect(h.emit).not.toHaveBeenCalled()
    h.submit(); h.submit(); expect(h.emit).toHaveBeenCalledOnce(); expect(h.emit.mock.calls[0][1]).toEqual({ senderId: 'a', recipientId: 'b', text: 'Bounded task', selectedContext: ['test'], toolGrants: [] })
  })
  it('invalidates review synchronously when context changes and enforces context count/bytes', () => {
    const list = Array.from({ length: 9 }, (_, i) => ({ ...event(`e${i}`, i + 1), text: 'x'.repeat(1025) }))
    const h = setup('AgentDelegationForm', { members: [profile('a'), profile('b')], events: list, busy: false }, 'fromAgentId, toAgentId, task, contextEventIds, reviewing, valid, submit')
    h.fromAgentId.value = 'a'; h.toAgentId.value = 'b'; h.task.value = 'Task'; h.submit(); expect(h.reviewing.value).toBe(true)
    h.contextEventIds.value = ['e0']; expect(h.reviewing.value).toBe(false); h.contextEventIds.value = list.map(e => e.id); expect(h.valid.value).toBe(false)
    h.contextEventIds.value = list.slice(0, 8).map(e => e.id); expect(h.valid.value).toBe(false)
  })
  it('locks profile submit until completion and preserves its draft', () => {
    const h = setup('AgentProfileEditor', profileProps(), 'form, submit'); h.form.name = 'Edited'; h.submit(); h.submit(); expect(h.emit).toHaveBeenCalledOnce()
    h.emit.mock.calls[0].at(-1)(); expect(h.form.name).toBe('Edited'); h.submit(); expect(h.emit).toHaveBeenCalledTimes(2)
  })
  it('locks conversation creation before parent busy propagation', () => {
    const h = setup('AgentConversationForm', { profiles: [profile('a')], busy: false }, 'title, memberAgentIds, submit'); h.title.value = 'Chat'; h.memberAgentIds.value = ['a']; h.submit(); h.submit(); expect(h.emit).toHaveBeenCalledOnce()
  })
  it('locks sends and never clears a draft without runtime persistence acknowledgment', () => {
    const props = chatProps(); const h = setup('AgentConversationView', props, 'send'); h.send(); h.send(); expect(h.emit).toHaveBeenCalledOnce(); expect(props.draft).toBe('hello')
    h.emit.mock.calls[0].at(-1)(); h.send(); expect(h.emit).toHaveBeenCalledTimes(2)
  })
})

describe('mobile compilation and honest boundaries', () => {
  for (const name of ['AgentInbox', 'AgentProfileEditor', 'AgentConversationForm', 'AgentConversationView', 'AgentDelegationForm']) {
    it(`${name} compiles`, () => {
      const { descriptor, errors } = parse(read(name)); expect(errors).toEqual([]); const script = compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template!.content, filename: `${name}.vue`, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([])
    })
  }
  it('uses semantic colors, mobile touch sizes, focus and reduced-motion treatment', () => {
    const css = readFileSync('src/styles/agentWorkspace.css', 'utf8'); for (const text of ['min-height: 44px', 'font-size: 16px', 'var(--ui-on-accent)', 'var(--ui-danger-text)', ':focus-visible', '@container (max-width: 760px)', 'prefers-reduced-motion']) expect(css).toContain(text)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
  it('does not claim delivery/tools/group autonomy or render raw HTML', () => {
    const chat = read('AgentConversationView'); expect(chat).toContain('Persisted event #'); expect(chat).not.toContain('v-html'); expect(chat).toContain("conversation.kind === 'direct'")
    expect(read('AgentDelegationForm')).not.toContain('allowedTools'); expect(read('AgentDelegationForm')).toContain('toolGrants: []'); expect(read('AgentDelegationForm')).toContain('not authenticated Agent authorship'); expect(chat).toContain('owner-delegated route')
    expect(read('AgentInbox')).toContain('No profiles or messages are stored by this screen.'); expect(read('AgentProfileEditor')).toContain('not claimed to be encrypted')
  })
})
