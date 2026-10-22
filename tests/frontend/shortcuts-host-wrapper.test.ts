// CyberManju OS — Shortcuts host wrapper tests (tests/frontend/shortcuts-host-wrapper.test.ts).
// Role: Verify that the mounted editor receives guarded host state and sends exact events.
// Exports: Vitest coverage for ShortcutsHostPanel.
// Integrates: Vue SFC compiler, host composition and ShortcutsPanel event boundary.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transpileModule, ModuleKind } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, reactive, ssrContextKey } from 'vue'

const mocks = vi.hoisted(() => ({
  store: null as any,
  android: false,
  tauri: false,
  static: false,
  invoke: vi.fn(async (_command: string, _args: any) => ({ ok: true })),
  options: null as any,
  host: null as any,
  childMounts: [] as any[],
  events: [] as any[],
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.store }))
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => mocks.android, isTauri: () => mocks.tauri, isStaticHost: () => mocks.static }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/composables/useShortcutsAutomationHost', () => ({ useShortcutsAutomationHost: (options: any) => { mocks.options = options; return mocks.host } }))
vi.mock('@/components/ShortcutsPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'ShortcutsPanelStub', props: ['modelValue','savedWorkflow','records','selectedWorkflowId','saveComplete','saveFailed','actions','canSave','canRun','authorizationConnected','authorizationRequest','running','result','resultContext','pendingRun','acknowledgeFailedContext'], emits: ['update:modelValue','update:selectedWorkflowId','request-save','request-run','authorization-decision','acknowledge-result'], setup(props, { emit }) { const instance = { props, emit }; mocks.childMounts.push(instance); return () => h('panel') } }) }
})
import ShortcutsHostPanel from '@/components/ShortcutsHostPanel.vue'

function clientTemplate(component: any, relative: string) {
  const filename = new URL(relative, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const script = compileScript(descriptor, { id: relative })
  const template = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: relative, compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ['typescript'] } })
  if (template.errors.length) throw new Error(String(template.errors))
  const exports: any = {}
  const code = transpileModule(template.code, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  new Function('require', 'exports', code)((id: string) => { if (id === 'vue') return { ...Vue }; throw new Error(id) }, exports)
  component.render = exports.render
}
clientTemplate(ShortcutsHostPanel, '../../src/components/ShortcutsHostPanel.vue')
interface Element { tag: string; children: Element[]; parent: Element | null; props: Record<string, any> }
const el = (tag: string): Element => ({ tag, children: [], parent: null, props: {} })
const renderer = createRenderer<Element, Element>({
  createElement: tag => el(tag), createText: () => el('#text'), createComment: () => el('#comment'),
  setText() {}, setElementText(node, _text) { node.children = [] }, parentNode: n => n.parent,
  nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  patchProp: (n, k, _o, v) => { n.props[k] = v },
  insert(n, p, anchor = null) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const i = anchor ? p.children.indexOf(anchor) : -1; if (i < 0) p.children.push(n); else p.children.splice(i, 0, n); n.parent = p },
  remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null },
})
const fields = ['modelValue','savedWorkflow','records','selectedWorkflowId','saveComplete','saveFailed','actions','canSave','canRun','authorizationConnected','authorizationRequest','running','result','resultContext','pendingRun','acknowledgeFailedContext'] as const
function setup(android = false, environment = { tauri: android, static: false, requiredAuth: !android }) {
  mocks.android = android; mocks.invoke.mockClear(); mocks.childMounts.length = 0; mocks.events.length = 0
  mocks.tauri = environment.tauri; mocks.static = environment.static
  mocks.store = reactive({ currentUser: { userId: 'alice' }, requiresServerAuth: () => environment.requiredAuth })
  const values: any = { modelValue: { draft: 1 }, savedWorkflow: { saved: 1 }, records: [], selectedWorkflowId: 'flow', saveComplete: null, saveFailed: null, actions: [], canSave: true, canRun: false, authorizationConnected: true, authorizationRequest: null, running: false, result: null, resultContext: null, pendingRun: null, acknowledgeFailedContext: null, notice: null }
  mocks.host = Object.fromEntries([...fields.map(k => [k, Vue.ref(values[k])]), ['connect', vi.fn()], ['disconnect', vi.fn()], ['updateModel', vi.fn()], ['select', vi.fn()], ['save', vi.fn()], ['run', vi.fn()], ['authorizationDecision', vi.fn()], ['acknowledge', vi.fn()]])
  const root = el('root'); const app = renderer.createApp(ShortcutsHostPanel); app.provide(ssrContextKey, { modules: new Set() }); app.mount(root)
  return { app, root, host: mocks.host, child: () => mocks.childMounts.at(-1) }
}
afterEach(() => vi.clearAllMocks())

describe('ShortcutsHostPanel composition wrapper', () => {
  it.each([
    ['Android', true, { tauri: true, static: false, requiredAuth: false }, true],
    ['native desktop', false, { tauri: true, static: false, requiredAuth: false }, true],
    ['static without login', false, { tauri: false, static: true, requiredAuth: false }, true],
    ['dashboard', false, { tauri: false, static: false, requiredAuth: true }, false],
    ['static with required authentication', false, { tauri: false, static: true, requiredAuth: true }, false],
    ['unrecognized web host', false, { tauri: false, static: false, requiredAuth: false }, false],
  ] as const)('opts into local identity only on an eligible %s host', async (_name, android, environment, allowed) => {
    const ui = setup(android, environment)
    expect(Vue.toValue(mocks.options.allowLocalIdentity)).toBe(allowed)
    expect(mocks.options.userId()).toBe('alice')
    mocks.store.currentUser = null; await nextTick()
    expect(mocks.options.userId()).toBeUndefined()
    expect(Vue.toValue(mocks.options.allowLocalIdentity)).toBe(allowed)
    ui.app.unmount()
  })
  it('maps every host prop and panel event to its host method with the exact payload', async () => {
    const ui = setup(); await nextTick()
    for (const key of fields) expect(ui.child().props[key]).toBe(ui.host[key].value)
    expect(ui.host.connect).toHaveBeenCalledOnce()
    const payloads = [ { draft: 2 }, 'other-flow', [{ workflow: 1 }, { requestId: 's1' }], { workflow: 2 }, { requestId: 'auth-1', decision: 'allow' }, { runId: 'run-1', workflowId: 'flow', workflowRevision: 4 } ]
    const events = ['update:modelValue','update:selectedWorkflowId','request-save','request-run','authorization-decision','acknowledge-result']
    const methods = ['updateModel','select','save','run','authorizationDecision','acknowledge']
    events.forEach((event, i) => ui.child().emit(event, payloads[i]))
    methods.forEach((method, i) => expect(ui.host[method]).toHaveBeenCalledExactlyOnceWith(payloads[i]))
    ui.app.unmount(); expect(ui.host.disconnect).toHaveBeenCalledOnce()
  })
  it('keys the child by user identity so changing account discards the prior child draft', async () => {
    const ui = setup(); await nextTick(); const first = ui.child()
    expect(first.props.modelValue).toEqual({ draft: 1 })
    ui.host.modelValue.value = { draft: 'alice-unsaved' }; await nextTick()
    ui.host.modelValue.value = { draft: 'bob-loaded' }
    mocks.store.currentUser.userId = 'bob'; await nextTick()
    const second = ui.child()
    expect(second).not.toBe(first)
    expect(second.props.modelValue).toEqual({ draft: 'bob-loaded' })
    expect(second.props.modelValue).not.toEqual({ draft: 'alice-unsaved' })
    ui.app.unmount()
  })
  it('provides a direct native invoke bridge only on Android and forwards exact request with live signal', async () => {
    setup(true)
    expect(mocks.options.android).toBe(true); expect(typeof mocks.options.nativeBridge).toBe('function')
    const request = { requestId: 'req-7', workflowId: 'wf', workflowRevision: 2, nodeId: 'n', actionId: 'android.dial', input: { phone: '+15550001111' }, idempotencyKey: 'idem-7' }
    const controller = new AbortController(); const response = await mocks.options.nativeBridge(request, controller.signal)
    expect(response).toEqual({ ok: true }); expect(controller.signal.aborted).toBe(false)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('automation_native_dispatch', { request })
    const web = setup(false)
    expect(web.host).toBeTruthy(); expect(mocks.options.android).toBe(false); expect(Object.hasOwn(mocks.options, 'nativeBridge')).toBe(false)
    web.app.unmount()
  })
})
