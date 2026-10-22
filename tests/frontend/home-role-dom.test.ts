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

let fakeWindow: EventTarget
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
    const addSpy = vi.spyOn(fakeWindow, 'addEventListener')
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'android_home_role_status') throw new Error(`Unexpected command ${command}`)
      expect(addSpy).toHaveBeenCalledWith('cybermanju:home-role-result', expect.any(Function))
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
    expect(invoke).toHaveBeenCalledOnce()
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', {
      detail: { requestId: 'recovered-1', state: 'held' },
    }))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(app.role().pendingId.value).toBeNull())
    expect(app.role().state.value).toBe('held')
    expect(app.role().attempt.value).toBe('held')
    expect(invoke).toHaveBeenCalledTimes(2)
    app.unmount()
  })

  it('removes the result listener on unmount and ignores a late result event', async () => {
    const removeSpy = vi.spyOn(fakeWindow, 'removeEventListener')
    const app = createFixture()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    await nextTick()
    const readsAtUnmount = invoke.mock.calls.length
    app.unmount()
    expect(removeSpy).toHaveBeenCalledWith('cybermanju:home-role-result', expect.any(Function))
    fakeWindow.dispatchEvent(new CustomEvent('cybermanju:home-role-result', {
      detail: { requestId: 'recovered-1', state: 'held' },
    }))
    await nextTick()
    expect(invoke).toHaveBeenCalledTimes(readsAtUnmount)
  })
})
