// CyberManju OS — Shortcuts review regressions (tests/frontend/shortcuts-review.test.ts).
// Role: Exercise real component events, persisted-snapshot review and save acknowledgements.
// Exports: Vitest regression suite using Vue's in-memory host renderer.
// Integrates: ShortcutsPanel props/events and public automation schema only.
// Contracts: No DOM dependency, persistence, runtime or secret resolution.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transpileModule, ModuleKind } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import ShortcutsPanel from '@/components/ShortcutsPanel.vue'
import ShortcutNodeEditor from '@/components/shortcuts/ShortcutNodeEditor.vue'
import ShortcutRunStatus from '@/components/shortcuts/ShortcutRunStatus.vue'
import type { PendingRun, Workflow } from '@/automation'

// Vitest imports SSR SFCs; attach client renders compiled from the same real templates.
function clientTemplate(component: any, relative: string) {
  const filename = new URL(relative, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const script = compileScript(descriptor, { id: relative })
  const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: relative, compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ['typescript'] } })
  if (template.errors.length) throw new Error(String(template.errors))
  const code = transpileModule(template.code, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  const exports: any = {}
  new Function('require', 'exports', code)((id: string) => { if (id === 'vue') return { ...Vue, vModelText: {}, vModelSelect: {}, vModelCheckbox: {} }; throw new Error(id) }, exports)
  component.render = exports.render
}
clientTemplate(ShortcutsPanel, '../../src/components/ShortcutsPanel.vue')
clientTemplate(ShortcutNodeEditor, '../../src/components/shortcuts/ShortcutNodeEditor.vue')
clientTemplate(ShortcutRunStatus, '../../src/components/shortcuts/ShortcutRunStatus.vue')

interface Element { tag: string; text: string; children: Element[]; parent: Element | null; props: Record<string, any> }
const element = (tag: string, text = ''): Element => ({ tag, text, children: [], parent: null, props: {} })
const renderer = createRenderer<Element, Element>({
  createElement: tag => element(tag), createText: text => element('#text', text), createComment: text => element('#comment', text),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node)
    node.parent = parent
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null },
})
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const workflow: Workflow = { schemaVersion: 1, id: 'review-workflow', revision: 3, entryNodeId: 'first', nodes: [
  { id: 'first', type: 'action', actionId: 'core.script', input: { steps: [{ id: 'text', op: 'text.upper', args: ['oi'] }] }, next: 'end' },
  { id: 'end', type: 'end' },
] }
const record = (value: Workflow, name = 'Meu atalho') => ({ recordVersion: 1 as const, workflow: clone(value), name, updatedAt: '2026-10-22T00:00:00Z' })
const text = (node: Element): string => node.tag === '#comment' ? '' : node.text + node.children.map(text).join('')
const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)]
async function mount(overrides: Record<string, any> = {}) {
  const decisions: { requestId: string; decision: 'allow' | 'deny' }[] = []
  const runs: Workflow[] = [], saves: { workflow: Workflow; request: any }[] = [], updates: Workflow[] = [], selections: string[] = []
  const state = reactive<Record<string, any>>({ modelValue: clone(workflow), savedWorkflow: clone(workflow), records: [record(workflow)], selectedWorkflowId: workflow.id, canRun: true, canSave: true, authorizationConnected: true, ...overrides })
  const root = element('root')
  const app = renderer.createApp({ render: () => h(ShortcutsPanel, { ...state,
    'onRequest-run': (value: Workflow) => runs.push(value),
    'onAuthorization-decision': overrides.decisionListener === false ? undefined : (value: any) => decisions.push(value),
    'onRequest-save': (value: Workflow, request: any) => saves.push({ workflow: value, request }),
    'onUpdate:modelValue': (value: Workflow) => updates.push(value),
    'onUpdate:selectedWorkflowId': (value: string) => selections.push(value),
  }) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root); await nextTick()
  const button = (label: string) => { const node = all(root).find(n => n.tag === 'button' && text(n) === label); if (!node) throw new Error(`Missing button ${label}`); return node }
  const click = async (label: string) => { button(label).props.onClick(); await nextTick() }
  const setName = async (name: string) => {
    const input = all(root).find(n => n.tag === 'input' && n.props.id?.endsWith('-name'))!
    input.props['onUpdate:modelValue'](name); input.props.onInput(); await nextTick()
  }
  const edit = async (value: Workflow) => {
    if (!all(root).some(n => n.tag === 'textarea' && n.props.id?.endsWith('-raw'))) await click('Abrir JSON do workflow')
    const input = all(root).find(n => n.tag === 'textarea' && n.props.id?.endsWith('-raw'))!
    input.props['onUpdate:modelValue'](JSON.stringify(value)); input.props.onInput(); await nextTick()
    await click('Validar e aplicar JSON')
  }
  return { root, state, runs, decisions, saves, updates, selections, button, click, edit, setName, unmount: () => app.unmount() }
}

describe('Shortcuts persisted snapshot and explicit review', () => {
  it('requires a validated saved snapshot, not just a modelValue echo', async () => {
    for (const savedWorkflow of [undefined, { ...workflow, revision: 2 }, { ...workflow, id: 'other' }, { ...workflow, revision: 0 }]) {
      const ui = await mount({ savedWorkflow })
      expect(ui.button('Revisar e executar').props.disabled).toBe(true)
      await ui.click('Revisar e executar') // A direct invocation cannot bypass the disabled button.
      expect(text(ui.root)).not.toContain('Enviar solicitação ao host')
      expect(ui.runs).toHaveLength(0); ui.unmount()
    }
  })
  it('blocks dirty drafts, draft echoes and arbitrary saved-prop updates until a correlated ACK', async () => {
    const ui = await mount()
    const changed = clone(workflow); (changed.nodes[0] as any).input = { value: 'alterado' }
    await ui.edit(changed)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.state.modelValue = clone(changed); ui.state.savedWorkflow = clone(changed); await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    await ui.click('Revisar e executar'); expect(ui.runs).toHaveLength(0)
    ui.unmount()
  })
  it('shows every action and exact input including refs, branches and HTML-like text, then emits that detached snapshot once', async () => {
    const branch: Workflow = { ...workflow, entryNodeId: 'gate', nodes: [
      { id: 'gate', type: 'condition', predicate: { op: 'eq', left: true, right: true }, trueNext: 'first', falseNext: 'second' },
      { id: 'first', type: 'action', actionId: 'core.http', input: { headers: { authorization: { secretRef: 'saved-token' } }, body: '<img src=x>', values: [0, false, null, ''] }, next: 'end' },
      { id: 'second', type: 'action', actionId: 'core.ai.invoke', input: { prompt: { $output: { nodeId: 'first', path: ['message'] } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ] }
    const ui = await mount({ modelValue: clone(branch), savedWorkflow: clone(branch), records: [record(branch)], actions: [{ id: 'core.http', effect: 'write' }, { id: 'core.ai.invoke', effect: 'write' }] })
    await ui.click('Revisar e executar')
    const review = all(ui.root).find(n => n.props.class === 'inline-confirm run-review')!
    expect(text(review)).toContain(`Workflow ID: ${branch.id}`); expect(text(review)).toContain('Revisão: 3')
    const inputs = all(review).filter(n => n.tag === 'pre').map(text)
    expect(inputs.map(value => JSON.parse(value))).toEqual(branch.nodes.filter(n => n.type === 'action').map(n => n.input))
    expect(text(review)).toContain('core.http'); expect(text(review)).toContain('core.ai.invoke')
    expect(text(review)).toContain('saved-token'); expect(text(review)).toContain('Esta revisão não autoriza ações')
    expect(all(ui.root).find(n => n.tag === 'input' && n.props.id?.endsWith('-name'))?.props.disabled).toBe(true)
    const send = ui.button('Enviar solicitação ao host').props.onClick
    send(); send(); await nextTick()
    expect(ui.runs).toHaveLength(1); expect(ui.runs[0]).toEqual(branch)
    expect(ui.runs[0]).not.toBe(ui.state.savedWorkflow)
    ui.unmount()
  })
  it('rejects a stale send handler immediately when saved content changes, even before watcher flush', async () => {
    const ui = await mount(); await ui.click('Revisar e executar')
    const send = ui.button('Enviar solicitação ao host').props.onClick
    ui.state.savedWorkflow.nodes[0].input = { changed: true }
    send(); await nextTick()
    expect(ui.runs).toHaveLength(0)
    expect(text(ui.root)).not.toContain('Enviar solicitação ao host'); ui.unmount()
  })
  it('invalidates review when the host replaces both draft and saved revision', async () => {
    const ui = await mount(); await ui.click('Revisar e executar')
    const send = ui.button('Enviar solicitação ao host').props.onClick
    ui.state.modelValue = { ...clone(workflow), revision: 4 }; ui.state.savedWorkflow = { ...clone(workflow), revision: 4 }
    await nextTick(); send(); await nextTick()
    expect(ui.runs).toHaveLength(0)
    expect(text(ui.root)).not.toContain('Enviar solicitação ao host'); ui.unmount()
  })
})

describe('Shortcuts host save ACK and controlled selection', () => {
  it('uses loaded revision as CAS, accepts only own exact ACK and loads the incremented revision', async () => {
    const ui = await mount(); await ui.setName('Nome escolhido')
    await ui.click('Solicitar salvamento')
    const pending = ui.saves[0]!
    expect(pending.request).toMatchObject({ name: 'Nome escolhido', expectedRevision: 3 })
    expect(pending.workflow.revision).toBe(3) // Host constructs revision 4 before repository.save.
    ui.state.saveComplete = { requestId: 'foreign', record: record({ ...clone(workflow), revision: 4 }, 'Nome escolhido') }
    await nextTick(); expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.state.saveComplete = { requestId: pending.request.requestId, record: record({ ...clone(workflow), revision: 4 }, 'Nome escolhido') }
    await nextTick()
    expect(text(ui.root)).toContain('Salvamento confirmado pelo host')
    expect(ui.button('Revisar e executar').props.disabled).toBe(false)
    expect(ui.updates.at(-1)?.revision).toBe(4)
    await ui.click('Solicitar salvamento'); expect(ui.saves.at(-1)?.request.expectedRevision).toBe(4)
    ui.unmount()
  })
  it('preserves later edits when an ACK for an earlier submitted snapshot arrives', async () => {
    const ui = await mount(); await ui.setName('Nome escolhido'); await ui.click('Solicitar salvamento')
    const pending = ui.saves[0]!
    const changed = clone(workflow); (changed.nodes[0] as any).input = { later: true }; await ui.edit(changed)
    ui.state.saveComplete = { requestId: pending.request.requestId, record: record({ ...clone(workflow), revision: 4 }, 'Nome escolhido') }
    await nextTick()
    expect(text(ui.root)).toContain('edições posteriores foram preservadas')
    expect(ui.updates.at(-1)).toEqual(changed)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.unmount()
  })
  it('rejects mismatched ACK content and preserves remote conflicts without changing stale CAS', async () => {
    const ui = await mount(); await ui.setName('Nome escolhido'); await ui.click('Solicitar salvamento')
    const pending = ui.saves[0]!
    const remote = clone(workflow); remote.revision = 4; (remote.nodes[0] as any).input = { remote: true }
    ui.state.saveComplete = { requestId: pending.request.requestId, record: record(remote, 'Nome escolhido') }; await nextTick()
    expect(text(ui.root)).toContain('não corresponde ao snapshot solicitado')
    ui.state.modelValue = clone(remote); ui.state.savedWorkflow = clone(remote); await nextTick()
    expect(text(ui.root)).toContain('Nova versão recebida do host')
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.state.saveFailed = pending.request.requestId; await nextTick(); await ui.click('Manter rascunho local'); await ui.click('Solicitar salvamento')
    expect(ui.saves.at(-1)?.request.expectedRevision).toBe(3)
    ui.unmount()
  })
  it('does not let an own valid ACK erase a newer remote conflict', async () => {
    const ui = await mount(); await ui.setName('Nome escolhido'); await ui.click('Solicitar salvamento')
    const pending = ui.saves[0]!
    const remote = { ...clone(workflow), revision: 5 }
    ui.state.modelValue = remote; ui.state.savedWorkflow = clone(remote)
    ui.state.saveComplete = { requestId: pending.request.requestId, record: record({ ...clone(workflow), revision: 4 }, 'Nome escolhido') }
    await nextTick()
    expect(text(ui.root)).toContain('Nova versão recebida do host')
    expect(text(ui.root)).toContain('v5')
    expect(ui.updates).toHaveLength(0)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true); ui.unmount()
  })
  it('blocks reset during a pending save and recovers only through a correlated failure or valid ACK', async () => {
    const ui = await mount(); await ui.setName('Nome escolhido'); await ui.click('Solicitar salvamento')
    const pending = ui.saves[0]!
    expect(ui.button('Novo atalho').props.disabled).toBe(true)
    await ui.click('Novo atalho'); await ui.click('Descartar e criar') // Direct reset invocation remains guarded.
    expect(ui.updates).toHaveLength(0)
    ui.state.saveComplete = { requestId: pending.request.requestId, record: record({ ...clone(workflow), revision: 8 }, 'Nome escolhido') }
    await nextTick(); expect(ui.button('Solicitar salvamento').props.disabled).toBe(true)
    ui.state.saveFailed = 'foreign'; await nextTick(); expect(ui.button('Solicitar salvamento').props.disabled).toBe(true)
    ui.state.saveFailed = pending.request.requestId; await nextTick()
    expect(ui.button('Solicitar salvamento').props.disabled).toBe(false)
    expect(ui.updates).toHaveLength(0); ui.unmount()
  })
  it('does not invent a name and sends null CAS only for creation', async () => {
    const ui = await mount(); await ui.click('Novo atalho'); await ui.click('Descartar e criar')
    expect(ui.button('Solicitar salvamento').props.disabled).toBe(true)
    await ui.setName('Novo escolhido'); await ui.click('Solicitar salvamento')
    expect(ui.saves[0]?.request).toMatchObject({ name: 'Novo escolhido', expectedRevision: null })
    expect(ui.saves[0]?.workflow.revision).toBe(1); ui.unmount()
  })
  it('keeps selection controlled and refuses to select away from a dirty draft', async () => {
    const other = { ...clone(workflow), id: 'other-workflow' }
    const ui = await mount({ records: [record(workflow), record(other, 'Outro')] })
    const picker = all(ui.root).find(n => n.tag === 'select' && n.props.id?.endsWith('-records'))!
    picker.props.onChange({ target: { value: other.id } }); await nextTick()
    expect(ui.selections).toEqual([other.id]); expect(ui.state.selectedWorkflowId).toBe(workflow.id)
    await ui.setName('Editado'); picker.props.onChange({ target: { value: other.id } }); await nextTick()
    expect(ui.selections).toEqual([other.id]); ui.unmount()
  })
})

const writeWorkflow: Workflow = { ...clone(workflow), nodes: [
  { id: 'first', type: 'action', actionId: 'core.http', input: { body: { $output: { nodeId: 'first', path: ['message'] } } }, next: 'end' },
  { id: 'end', type: 'end' },
] }
const authorizationId = (runId = 'auth-1') => JSON.stringify([workflow.id, 3, runId, 'first'])
const authorization = (runId = 'auth-1') => ({ requestId: authorizationId(runId), workflowId: workflow.id, workflowRevision: 3, nodeId: 'first', actionId: 'core.http', input: { body: '<img src=x>', token: { secretRef: 'saved-token' }, values: [0, false, null, ''] } })
async function runningWrite() {
  const ui = await mount({ modelValue: clone(writeWorkflow), savedWorkflow: clone(writeWorkflow), records: [record(writeWorkflow)], actions: [{ id: 'core.http', effect: 'write' }] })
  await ui.click('Revisar e executar'); await ui.click('Enviar solicitação ao host')
  ui.state.running = true; await nextTick()
  return ui
}

describe('Shortcuts per-action fail-closed authorization', () => {
  it('requires explicit guard connection and decision event consumer even with canRun', async () => {
    for (const overrides of [{ authorizationConnected: false }, { decisionListener: false }]) {
      const ui = await mount(overrides)
      expect(ui.button('Revisar e executar').props.disabled).toBe(true)
      await ui.click('Revisar e executar'); expect(ui.runs).toHaveLength(0); ui.unmount()
    }
  })
  it('shows only exact resolved action input and literal secret refs, requires one explicit decision and freezes editing', async () => {
    const ui = await runningWrite()
    ui.state.authorizationRequest = authorization(); await nextTick()
    const panel = all(ui.root).find(node => node.props.class === 'inline-confirm action-authorization')!
    expect(JSON.parse(text(all(panel).find(node => node.tag === 'pre')!))).toEqual(authorization().input)
    expect(all(panel).some(node => node.tag === 'img')).toBe(false)
    expect(ui.decisions).toHaveLength(0)
    for (const label of ['Novo atalho', 'Solicitar salvamento', 'Revisar e executar']) expect(ui.button(label).props.disabled).toBe(true)
    const allow = ui.button('Permitir ação').props.onClick
    allow(); allow(); await nextTick()
    expect(ui.decisions).toEqual([{ requestId: authorizationId(), decision: 'allow' }])
    expect(text(ui.root)).not.toContain('saved-token') // No action payload retained in status.
    ui.state.authorizationRequest = null; await nextTick()
    ui.state.authorizationRequest = authorization(); await nextTick(); allow()
    expect(ui.decisions).toHaveLength(1); expect(text(ui.root)).not.toContain('Permitir ação'); ui.unmount()
  })
  it('denies replaced requests and prevents a captured allow from approving a new request', async () => {
    const ui = await runningWrite(); ui.state.authorizationRequest = authorization(); await nextTick()
    const stale = ui.button('Permitir ação').props.onClick
    ui.state.authorizationRequest = authorization('auth-2'); await nextTick(); stale()
    expect(ui.decisions).toEqual([{ requestId: authorizationId(), decision: 'deny' }])
    await ui.click('Negar ação')
    expect(ui.decisions.at(-1)).toEqual({ requestId: authorizationId('auth-2'), decision: 'deny' }); ui.unmount()
  })
  it('denies mutation of input or run snapshot before a stale allow, preserving the editor snapshot', async () => {
    for (const change of ['input', 'model', 'saved', 'registry', 'guard', 'result', 'cancel'] as const) {
      const ui = await runningWrite(); ui.state.authorizationRequest = authorization(); await nextTick()
      const stale = ui.button('Permitir ação').props.onClick
      if (change === 'input') ui.state.authorizationRequest.input.body = 'changed'
      if (change === 'model') ui.state.modelValue = { ...clone(writeWorkflow), revision: 4 }
      if (change === 'saved') ui.state.savedWorkflow = { ...clone(writeWorkflow), revision: 4 }
      if (change === 'registry') ui.state.actions = [{ id: 'core.http', effect: 'read' }]
      if (change === 'guard') ui.state.authorizationConnected = false
      if (change === 'result') ui.state.result = { status: 'completed', steps: 1, outputs: {} }
      if (change === 'cancel') ui.state.authorizationRequest = null
      await nextTick(); stale(); await nextTick()
      expect(ui.decisions, change).toEqual([{ requestId: authorizationId(), decision: 'deny' }])
      expect(ui.updates).toHaveLength(0); ui.unmount()
    }
  })
  it('denies unknown, mismatched, unresolved, malformed and plaintext-secret requests without rendering payloads', async () => {
    const requests = [
      { ...authorization(), workflowId: 'other' }, { ...authorization(), workflowRevision: 4 },
      { ...authorization(), nodeId: 'end' }, { ...authorization(), actionId: 'core.ai.invoke' },
      { ...authorization(), input: { value: { $output: { nodeId: 'first', path: [] } } } },
      { ...authorization(), input: { token: 'DO-NOT-RENDER' } }, { ...authorization(), extra: 'DO-NOT-RENDER' },
    ]
    for (const request of requests) {
      const ui = await runningWrite(); ui.state.authorizationRequest = request; await nextTick()
      // Existing UI only echoes short identifiers on initial rejection; tuple requests stay blocked.
      expect(ui.decisions).toEqual([])
      expect(text(ui.root)).toContain('Pedido de autorização recusado')
      expect(text(ui.root)).not.toContain('DO-NOT-RENDER'); expect(text(ui.root)).not.toContain('Permitir ação'); ui.unmount()
    }
    const idle = await mount({ authorizationRequest: authorization() })
    expect(idle.decisions).toEqual([])
    expect(text(idle.root)).toContain('Pedido de autorização recusado'); idle.unmount()
  })
  it('denies on timeout and unmount; a late click cannot allow', async () => {
    vi.useFakeTimers()
    try {
      const ui = await runningWrite(); ui.state.authorizationRequest = authorization(); await nextTick()
      const stale = ui.button('Permitir ação').props.onClick
      vi.advanceTimersByTime(60_000); await nextTick(); stale()
      expect(ui.decisions).toEqual([{ requestId: authorizationId(), decision: 'deny' }])
      ui.state.authorizationRequest = authorization('auth-2'); await nextTick(); ui.unmount()
      expect(ui.decisions.at(-1)).toEqual({ requestId: authorizationId('auth-2'), decision: 'deny' })
    } finally { vi.useRealTimers() }
  })
  it('queues external changes without replacing a workflow while reviewing', async () => {
    const ui = await mount(); await ui.click('Revisar e executar')
    ui.state.modelValue = { ...clone(workflow), revision: 4 }; await nextTick()
    expect(text(ui.root)).toContain('Nova versão recebida do host')
    expect(all(ui.root).find(node => node.props.class === 'draft-badge') && text(all(ui.root).find(node => node.props.class === 'draft-badge')!)).toContain('v3')
    expect(ui.runs).toHaveLength(0); ui.unmount()
  })
})

describe('Shortcuts explicit result acknowledgement', () => {
  const context = { runId: 'host-run-42', workflowId: workflow.id, workflowRevision: 3 }
  it('never clears any result itself and only emits the exact host correlation after confirmation', async () => {
    const acknowledgements: any[] = []
    const result = { status: 'completed', steps: 1, outputs: {} }
    const ui = await mount({ result, resultContext: context, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
    await ui.click('Dispensar resultado concluído'); expect(acknowledgements).toHaveLength(0)
    const confirm = ui.button('Confirmar reconhecimento').props.onClick
    confirm(); confirm(); await nextTick()
    expect(acknowledgements).toEqual([context]); expect(ui.state.result).toEqual(result)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(text(ui.root)).toContain('Aguardando o host reconciliar'); ui.unmount()
  })
  it('warns uncertain outcomes can duplicate effects, and invalidates stale acknowledgement when run changes', async () => {
    for (const status of ['accepted', 'needs_confirmation', 'unknown']) {
      const acknowledgements: any[] = []
      const ui = await mount({ result: { status: 'halted', nodeId: 'first', steps: 1, result: { status } }, resultContext: context, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
      expect(text(ui.root)).toContain('repetir pode duplicá-lo')
      await ui.click('Revisar reconhecimento do resultado')
      const stale = ui.button('Confirmar reconhecimento').props.onClick
      ui.state.resultContext = { ...context, runId: 'host-run-43' }; await nextTick(); stale()
      expect(acknowledgements).toHaveLength(0)
      await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
      expect(acknowledgements).toEqual([{ ...context, runId: 'host-run-43' }]); expect(ui.state.result).not.toBeNull(); ui.unmount()
    }
  })
  it('requires host correlation and does not acknowledge or clear results on unmount', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ result: { status: 'completed', steps: 1, outputs: {} }, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
    expect(ui.button('Dispensar resultado concluído').props.disabled).toBe(true)
    await ui.click('Dispensar resultado concluído'); ui.unmount()
    expect(acknowledgements).toHaveLength(0); expect(ui.state.result).not.toBeNull()
  })
})

describe('Shortcuts durable pending-run host boundary', () => {
  const context = { runId: 'restored-run', workflowId: workflow.id, workflowRevision: 3 }
  const pending: PendingRun = { ...context, status: 'unknown', code: 'interrupted', startedAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:01:00Z' }
  it('blocks a restored pending run, exposes no opaque fields and unlocks only after explicit correlated ACK and host reconciliation', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: { ...pending, privateInternalField: 'NEVER-SHOW-THIS' }, resultContext: context, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(text(ui.root)).toContain('Execução pendente restaurada pelo host')
    expect(text(ui.root)).not.toContain('NEVER-SHOW-THIS')
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([context]); expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.state.pendingRun = null; ui.state.resultContext = null; await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(false); ui.unmount()
  })
  it.each(['interrupted', 'uncertain'] as const)('uses PendingRun correlation without a separate context and explicitly accepts %s only on confirmation', async code => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: { ...pending, code }, 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    await ui.click('Revisar reconhecimento do resultado')
    expect(acknowledgements).toEqual([])
    expect(text(ui.root)).toContain('aceita explicitamente essa incerteza')
    await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[context, { acceptUncertain: true }]])
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(ui.state.pendingRun.code).toBe(code)
    ui.unmount()
  })
  it('requires ACK even for durable completed and does not describe it as uncertain', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: { ...pending, status: 'completed', code: 'completed' }, 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(text(ui.root)).not.toContain('resultado é incerto')
    await ui.click('Revisar reconhecimento do resultado')
    expect(text(ui.root)).not.toContain('Entendo que não há conclusão certa')
    await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[context]])
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    ui.state.pendingRun = null; await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(false); ui.unmount()
  })
  it('blocks live running, malformed pending metadata and conflicting external correlation', async () => {
    for (const overrides of [
      { pendingRun: { ...pending, status: 'running', code: 'running' } },
      { pendingRun: { ...pending, updatedAt: 'invalid' } },
      { pendingRun: pending, resultContext: { ...context, runId: 'stale-run' } },
    ]) {
      const acknowledgements: any[] = []
      const ui = await mount({ ...overrides, 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
      expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(true)
      await ui.click('Revisar reconhecimento do resultado')
      expect(acknowledgements).toEqual([])
      expect(ui.button('Revisar e executar').props.disabled).toBe(true); ui.unmount()
    }
  })
  it('invalidates captured confirmation when pending run changes before watcher flush', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: clone(pending), 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    await ui.click('Revisar reconhecimento do resultado')
    const stale = ui.button('Confirmar reconhecimento').props.onClick
    ui.state.pendingRun.runId = 'new-run'
    stale(); await nextTick()
    expect(acknowledgements).toEqual([])
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[{ ...context, runId: 'new-run' }, { acceptUncertain: true }]])
    ui.unmount()
  })
  it('ACKs rejected pending_run as a transient result when no durable run exists, without uncertainty options', async () => {
    const acknowledgements: any[] = []
    const result = { status: 'rejected', code: 'pending_run' }
    const ui = await mount({ result, pendingRun: null, resultContext: context, 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[context]])
    expect(ui.state.pendingRun).toBeNull(); expect(ui.state.result).toEqual(result)
    ui.state.result = null; ui.state.resultContext = null; await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(false); ui.unmount()
  })
  it('re-enables failed ACK only for the exact pending correlation and requires another explicit confirmation', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: clone(pending), 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    // An unsolicited failure cannot authorize or acknowledge anything.
    ui.state.acknowledgeFailedContext = clone(context); await nextTick()
    expect(acknowledgements).toEqual([])
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[context, { acceptUncertain: true }]])
    expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(true)
    for (const failed of [
      { ...context, runId: 'other-run' }, { ...context, workflowId: 'other-workflow' },
      { ...context, workflowRevision: 4 }, { ...context, workflowRevision: '3' }, null,
    ]) {
      ui.state.acknowledgeFailedContext = failed; await nextTick()
      expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(true)
      await ui.click('Revisar reconhecimento do resultado')
      expect(acknowledgements).toHaveLength(1)
    }
    ui.state.acknowledgeFailedContext = clone(context); await nextTick()
    expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(false)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(ui.state.pendingRun).toEqual(pending)
    expect(acknowledgements).toHaveLength(1)
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([[context, { acceptUncertain: true }], [context, { acceptUncertain: true }]])
    expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(true)
    ui.state.pendingRun = null; await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(false); ui.unmount()
  })
  it('does not let an old ACK failure reopen a reconciled or different run', async () => {
    const acknowledgements: any[] = []
    const ui = await mount({ pendingRun: clone(pending), 'onAcknowledge-result': (...args: any[]) => acknowledgements.push(args) })
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    ui.state.pendingRun = null; await nextTick()
    ui.state.acknowledgeFailedContext = clone(context); await nextTick()
    expect(ui.button('Revisar e executar').props.disabled).toBe(false)
    ui.state.pendingRun = { ...pending, runId: 'newer-run' }; await nextTick()
    await ui.click('Revisar reconhecimento do resultado'); await ui.click('Confirmar reconhecimento')
    ui.state.acknowledgeFailedContext = clone(context); await nextTick()
    expect(ui.button('Revisar reconhecimento do resultado').props.disabled).toBe(true)
    expect(acknowledgements).toHaveLength(2); ui.unmount()
  })
  it('does not unlock if the host drops a pending run or a result without an explicit acknowledgement', async () => {
    for (const initial of [{ pendingRun: pending }, { result: { status: 'completed', steps: 1, outputs: {} } }]) {
      const ui = await mount(initial)
      ui.state.pendingRun = null; ui.state.result = null; await nextTick()
      expect(ui.button('Revisar e executar').props.disabled).toBe(true)
      expect(ui.runs).toHaveLength(0); ui.unmount()
    }
  })
  it('does not acknowledge restored state on navigation, a new window or unmount', async () => {
    const acknowledgements: any[] = []
    for (let i = 0; i < 2; i++) {
      const ui = await mount({ pendingRun: pending, resultContext: context, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
      await ui.click('Novo atalho'); await ui.click('Descartar e criar')
      expect(ui.button('Revisar e executar').props.disabled).toBe(true)
      expect(ui.state.pendingRun).toEqual(pending); ui.unmount()
    }
    expect(acknowledgements).toHaveLength(0)
  })
})

describe('Shortcuts authorization and ACK hardening', () => {
  it('rejects a plaintext credential before any rendering while preserving literal vault references', async () => {
    const { parseAuthorizationRequest } = await import('@/utils/shortcutAuthorization')
    expect(() => parseAuthorizationRequest({ ...authorization(), input: { token: 'DO-NOT-RENDER' } })).toThrow('plaintext_secret')
    expect(parseAuthorizationRequest(authorization()).input).toEqual(authorization().input)
    expect(() => parseAuthorizationRequest({ ...authorization(), input: { body: { $output: { nodeId: 'first', path: [] } } } })).toThrow('unresolved_authorization')
  })
  it('emits one ACK per run correlation, including after nested changes and replay of the same run', async () => {
    const acknowledgements: any[] = []
    const context = { runId: 'one-run', workflowId: workflow.id, workflowRevision: 3 }
    const ui = await mount({ result: { status: 'completed', steps: 1, outputs: {} }, resultContext: context, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
    await ui.click('Dispensar resultado concluído'); await ui.click('Confirmar reconhecimento')
    ui.state.result.steps = 2; await nextTick()
    expect(ui.button('Dispensar resultado concluído').props.disabled).toBe(true)
    await ui.click('Dispensar resultado concluído'); expect(acknowledgements).toEqual([context])
    ui.state.result = null; ui.state.resultContext = null; await nextTick()
    ui.state.result = { status: 'completed', steps: 1, outputs: {} }; ui.state.resultContext = clone(context); await nextTick()
    expect(ui.button('Dispensar resultado concluído').props.disabled).toBe(true)
    expect(ui.button('Revisar e executar').props.disabled).toBe(true)
    expect(acknowledgements).toEqual([context]); ui.unmount()
  })
  it('sends only approved correlation fields, never arbitrary host metadata', async () => {
    const acknowledgements: any[] = []
    const context = { runId: 'minimal-run', workflowId: workflow.id, workflowRevision: 3 }
    const ui = await mount({ result: { status: 'completed', steps: 1, outputs: {} }, resultContext: { ...context, internal: 'DO-NOT-EMIT' }, 'onAcknowledge-result': (value: any) => acknowledgements.push(value) })
    await ui.click('Dispensar resultado concluído'); await ui.click('Confirmar reconhecimento')
    expect(acknowledgements).toEqual([context]); expect(text(ui.root)).not.toContain('DO-NOT-EMIT'); ui.unmount()
  })
})
