// CyberManju OS — Home role DOM lifecycle contract tests.
// Role: verify the Vue composable against browser-like event and focus ports in Node.
// Exports: Vitest suite. Integrates: createRenderer, native invoke mock and fake window/document.
// Contracts: listener precedes passive status recovery; result detail correlates; teardown ignores late events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, nextTick } from 'vue'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => true, isTauri: () => true }))

import { useHomeRoleAction } from '@/composables/useHomeRoleAction'

type HostNode = { children: HostNode[]; parent?: HostNode; text?: string }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }),
  createText: text => ({ children: [], text }),
  createComment: text => ({ children: [], text }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  parentNode: node => node.parent ?? null,
  nextSibling: node => {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  insert: (node, parent, anchor) => {
    if (node.parent) {
      const previous = node.parent.children.indexOf(node)
      if (previous >= 0) node.parent.children.splice(previous, 1)
    }
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove: node => {
    const index = node.parent?.children.indexOf(node) ?? -1
    if (index >= 0) node.parent!.children.splice(index, 1)
    node.parent = undefined
  },
})

let fakeWindow: EventTarget & { __CYBERMANJU_HOME_ROLE_READY__?: boolean; __CYBERMANJU_HOME_ROLE_ACKED__?: string | null }
let fakeDocument: EventTarget & { visibilityState: 'visible' | 'hidden'; hasFocus: () => boolean }
let focused: boolean
let visibility: 'visible' | 'hidden'
let root: HostNode
let mounted: ReturnType<typeof renderer.createApp>
let role: ReturnType<typeof useHomeRoleAction>

function createFixture() {
  root = { children: [] }
  mounted = renderer.createApp(defineComponent({
    setup() {
      role = useHomeRoleAction(async () => true)
      return () => null
    },
  }))
  mounted.mount(root)
  return { role: () => role, unmount: () => mounted.unmount() }
}

beforeEach(() => {
  invoke.mockReset()
  focused = true
  visibility = 'visible'
  fakeWindow = new EventTarget()
  fakeDocument = Object.assign(new EventTarget(), {
    get visibilityState() { return visibility },
    hasFocus: () => focused,
  })
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('crypto', { randomUUID: () => 'home-attempt-1' })
  vi.stubGlobal('performance', { now: () => 1000 })
  fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__ = null
  invoke.mockImplementation(async (command: string) => {
    if (command === 'android_home_role_status') return { state: 'not_held', apiLevel: 34, pendingRequestId: 'recovered-1' }
    throw new Error(`Unexpected native command: ${command}`)
  })
})
afterEach(() => {
  mounted?.unmount()
  vi.unstubAllGlobals()
})

describe('useHomeRoleAction DOM lifecycle', () => {
  it('installs the CustomEvent listener before passive status invoke and recovers pending without requesting', async () => {
    const add = fakeWindow.addEventListener.bind(fakeWindow)
    const addSpy = vi.spyOn(fakeWindow, 'addEventListener').mockImplementation((name, listener, options) => {
      if (name === 'cybermanju:home-role-result') expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).not.toBe(true)
      add(name, listener, options)
    })
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'android_home_role_status') throw new Error(`Unexpected command ${command}`)
      expect(addSpy).toHaveBeenCalledWith('cybermanju:home-role-result', expect.any(Function))
      expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(true)
      return { state: 'not_held', apiLevel: 34, pendingRequestId: 'recovered-1' }
    })
    const app = createFixture()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    await nextTick()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('android_home_role_status')
    expect(app.role().pendingId.value).toBe('recovered-1')
    expect(app.role().state.value).toBe('not_held')
    expect(invoke).not.toHaveBeenCalledWith('android_home_role_request', expect.anything())
    expect(addSpy).not.toHaveBeenCalledWith('tauri://home-role-result', expect.anything())
    app.unmount()
  })

  it('correlates the CustomEvent detail, performs a status read, and finalizes from observed status', async () => {
    let reads = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'android_home_role_status') throw new Error(`Unexpected command ${command}`)
      reads += 1
      return reads === 1
        ? { state: 'not_held', apiLevel: 34, pendingRequestId: 'recovered-1' }
        : { state: 'held', apiLevel: 34 }
    })
    const app = createFixture()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', {
      detail: { requestId: 'unrelated', state: 'held' },
    }))
    await nextTick()
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__).toBeNull()
    expect(invoke).toHaveBeenCalledOnce()
    fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__ = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recovered-1', state: 'bogus' } }))
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__).toBeNull()
    fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__ = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recovered-1', state: 'held' } }))
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__).toBe('recovered-1')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(app.role().pendingId.value).toBe('recovered-1')
    fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__ = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recovered-1', state: 'held' } }))
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_ACKED__).toBe('recovered-1')
    expect(invoke).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(app.role().pendingId.value).toBeNull())
    expect(app.role().state.value).toBe('held')
    expect(app.role().attempt.value).toBe('held')
    expect(invoke).toHaveBeenCalledTimes(2)
    app.unmount()
  })

  it('removes the result listener on unmount and ignores a late result event', async () => {
    const remove = fakeWindow.removeEventListener.bind(fakeWindow)
    const removeSpy = vi.spyOn(fakeWindow, 'removeEventListener').mockImplementation((name, listener, options) => {
      if (name === 'cybermanju:home-role-result') expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(false)
      remove(name, listener, options)
    })
    const app = createFixture()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    await nextTick()
    const readsAtUnmount = invoke.mock.calls.length
    app.unmount()
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(false)
    expect(removeSpy).toHaveBeenCalledWith('cybermanju:home-role-result', expect.any(Function))
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', {
      detail: { requestId: 'recovered-1', state: 'held' },
    }))
    await nextTick()
    expect(invoke).toHaveBeenCalledTimes(readsAtUnmount)
  })
  it('does not ACK early cold-start delivery; recovered pending retry ACKs synchronously before deferred reconciliation', async () => {
    let ready = false, reads = 0
    let resolveReconcile!: (value: { state: string; apiLevel: number }) => void
    let earlyAck: string | null | undefined
    Object.defineProperty(fakeWindow, '__CYBERMANJU_HOME_ROLE_READY__', {
      get: () => ready,
      set: (value: boolean) => {
        ready = value
        if (value === true) {
          earlyAck = null
          fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', {
            detail: { requestId: 'recreated-1', state: 'held' },
          }))
        }
      },
    })
    Object.defineProperty(fakeWindow, '__CYBERMANJU_HOME_ROLE_ACKED__', {
      get: () => earlyAck,
      set: (value: string | null) => { earlyAck = value },
    })
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'android_home_role_status') throw new Error(`Unexpected command ${command}`)
      if (++reads === 1) return { state: 'not_held', apiLevel: 34, pendingRequestId: 'recreated-1' }
      return new Promise(resolve => { resolveReconcile = resolve })
    })
    const app = createFixture()
    await vi.waitFor(() => expect(reads).toBe(1))
    expect(earlyAck).toBeNull()
    await vi.waitFor(() => expect(app.role().pendingId.value).toBe('recreated-1'))
    expect(app.role().state.value).toBe('not_held')
    earlyAck = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recreated-1', state: 'held' } }))
    expect(earlyAck).toBe('recreated-1')
    await vi.waitFor(() => expect(reads).toBe(2))
    expect(app.role().pendingId.value).toBe('recreated-1')
    expect(app.role().state.value).toBe('not_held')
    earlyAck = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recreated-1', state: 'held' } }))
    expect(earlyAck).toBe('recreated-1')
    expect(reads).toBe(2)
    resolveReconcile({ state: 'held', apiLevel: 34 })
    await vi.waitFor(() => expect(app.role().attempt.value).toBe('held'))
    expect(app.role().pendingId.value).toBeNull(); expect(app.role().state.value).toBe('held')
    expect(invoke).toHaveBeenCalledTimes(2); expect(ready).toBe(true)
    earlyAck = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recreated-1', state: 'held' } }))
    expect(earlyAck).toBeNull()
    app.role().dispose(); expect(ready).toBe(false)
    earlyAck = null
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', { detail: { requestId: 'recreated-1', state: 'held' } }))
    expect(earlyAck).toBeNull()
  })
  it('never signals readiness if DOM listener registration fails', async () => {
    vi.spyOn(fakeWindow, 'addEventListener').mockImplementation(name => {
      if (name === 'cybermanju:home-role-result') throw new Error('listener unavailable')
    })
    const app = createFixture()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).not.toBe(true)
    expect(invoke).not.toHaveBeenCalled(); expect(app.role().canRequest.value).toBe(false)
  })
  it('re-arms readiness only after a recreated UI installs its own listener', async () => {
    const first = createFixture()
    await vi.waitFor(() => expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(true))
    first.unmount(); expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(false)
    const second = createFixture()
    await vi.waitFor(() => expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(true))
    expect(invoke.mock.calls.every(([command]) => command === 'android_home_role_status')).toBe(true)
    second.unmount(); expect(fakeWindow.__CYBERMANJU_HOME_ROLE_READY__).toBe(false)
  })
})
