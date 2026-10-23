// CyberManju OS — Home native-widget launch safety regressions.
// Role: exercise real Home actions, visibility bookkeeping and bridge timeout handling together.
// Integrates: HomeWorkspaceStudio, useHomeNativeWidgets and useAndroidWidgets; only native IPC is mocked.
// Contracts: no layout means no native hit region; uncertain layout stays fail-closed until acknowledged hide.
// @vitest-environment happy-dom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import HomeWorkspaceStudio from '@/components/HomeWorkspaceStudio.vue'
import { HOME_WORKSPACE_KEY, createHomeState } from '@/utils/homeWorkspaces'

const native = vi.hoisted(() => ({ invoke: vi.fn(), openApp: vi.fn() }))
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => true, isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@/composables/useAndroidApps', () => ({ useAndroidApps: () => ({ supported: true, apps: { value: [] }, status: { value: 'ready' }, refresh: vi.fn().mockResolvedValue(true), openApp: native.openApp }) }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ reduced: { value: false } }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@/components/HomeLocalWidget.vue', () => ({ default: { template: '<button class="local-open" @click="$emit(\'open\', \'terminal\')">Open terminal</button>' } }))
vi.mock('@/components/HomeDefaultRoleAction.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeWorkspacePreview.vue', () => ({ default: { template: '<div />' } }))

const record = { appWidgetId: 7, placementId: 'native-slot', provider: 'example/Widget', state: 'ready', providerAvailable: true, widthDp: 280, heightDp: 180 }
const nativeItem = { id: 'native-slot', kind: 'widget', ref: 'native:example/Widget', data: { widthDp: 280, heightDp: 180 } }
const apps = [{ id: 'files', label: 'Files', icon: 'solar:folder-bold' }, { id: 'terminal', label: 'Cybsh', icon: 'solar:code-bold' }]
const reply = (action: string) => ({ ok: true, action, viewport: { widthDp: 400, heightDp: 800 }, widgets: [record], providers: [{ provider: record.provider, label: 'Example', minWidthDp: 1, minHeightDp: 1 }] })
const visibilityKey = 'cybermanju.home.native-widget-visible.v1'
let hideMode: 'ok' | 'failure' | 'timeout' | 'unsupported'
let layoutMode: 'ok' | 'failure' | 'timeout'
let wrappers: VueWrapper[]

function actions(action: string) { return native.invoke.mock.calls.filter(([, args]) => args.action === action) }
function mountStudio(options: { widget?: boolean; inactiveWidget?: boolean; android?: boolean; local?: boolean } = {}) {
  const id = options.android ? 'android:com.example.reader' : 'files'
  localStorage.setItem(HOME_WORKSPACE_KEY, JSON.stringify({ version: 1, theme: 'aurora', activeId: 'home', pages: [
    { id: 'home', title: 'Home', items: [{ id: 'app', kind: 'app', ref: id }, ...(options.widget ? [nativeItem] : []), ...(options.local ? [{ id: 'local', kind: 'widget', ref: 'app-link' }] : [])] },
    { id: 'other', title: 'Other', items: options.inactiveWidget ? [nativeItem] : [] },
  ] }))
  const wrapper = mount(HomeWorkspaceStudio, { attachTo: document.body, props: { apps, initialIds: [id] } })
  wrappers.push(wrapper)
  return wrapper
}
async function click(wrapper: VueWrapper, selector = '.workspace-launch') {
  await wrapper.get(selector).trigger('click')
  await flushPromises()
}
async function settleWidget() {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(420)
  await flushPromises()
  expect(actions('layout')).toHaveLength(1)
}
async function freshCoordinator() {
  vi.resetModules()
  const { useHomeNativeWidgets } = await import('@/composables/useHomeNativeWidgets')
  const wrapper = mount(defineComponent({ setup(_, { expose }) {
    const root = ref<HTMLElement>(), state = ref(createHomeState([]))
    const home = useHomeNativeWidgets(root, state, () => true)
    expose({ hideNative: home.suspend })
    return () => h('div', { ref: root })
  } }), { attachTo: document.body })
  wrappers.push(wrapper); await flushPromises()
  return (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative
}

beforeEach(() => {
  vi.useFakeTimers()
  hideMode = 'ok'; layoutMode = 'ok'; wrappers = []
  native.invoke.mockReset(); native.openApp.mockReset().mockResolvedValue(undefined)
  native.invoke.mockImplementation(async (_command, { action }) => {
    const mode = action === 'hide' ? hideMode : action === 'layout' ? layoutMode : 'ok'
    if (action === 'layout' && mode !== 'ok') hideMode = 'failure'
    if (mode === 'unsupported') throw new Error('unknown command: android_widget_command')
    if (mode === 'failure') throw new Error('auth: widget actions require the unlocked foreground app')
    if (mode === 'timeout') return new Promise(() => {})
    return reply(action)
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  vi.stubGlobal('innerWidth', 400); vi.stubGlobal('innerHeight', 800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-native-placement') ? new DOMRect(20, 100, 280, 180) : new DOMRect(0, 0, 400, 800)
  })
})
afterEach(async () => {
  // Explicit successful cleanup also resets the document-scoped visibility debt between tests.
  hideMode = 'ok'; layoutMode = 'ok'
  for (const wrapper of wrappers) wrapper.unmount()
  await vi.advanceTimersByTimeAsync(8000)
  await flushPromises()
  // A previous in-flight timeout may have coalesced unmount's forced hide. A fresh owner must recover it.
  const cleanup = mountStudio()
  await flushPromises()
  await (cleanup.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative()
  cleanup.unmount(); await flushPromises()
  localStorage.clear(); document.body.innerHTML = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('Home native-widget launch gate', () => {
  it.each(['failure', 'timeout'] as const)('opens a built-in app exactly once with no layout despite startup hide %s', async mode => {
    hideMode = mode
    const wrapper = mountStudio()
    await flushPromises()
    await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
    expect(native.openApp).not.toHaveBeenCalled()
    expect(actions('layout')).toHaveLength(0)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('')
    await vi.advanceTimersByTimeAsync(8000)
    await flushPromises()
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it.each(['failure', 'timeout'] as const)('opens an Android shortcut exactly once without a native widget despite hide %s', async mode => {
    hideMode = mode
    const wrapper = mountStudio({ android: true })
    await flushPromises(); await click(wrapper)
    expect(native.openApp).toHaveBeenCalledExactlyOnceWith('com.example.reader')
    expect(wrapper.emitted('open')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(8000); await flushPromises()
    expect(native.openApp).toHaveBeenCalledOnce()
  })

  it('does not mistake saved widgets on another page for visible native views', async () => {
    hideMode = 'failure'
    const wrapper = mountStudio({ inactiveWidget: true })
    await flushPromises(); await click(wrapper)
    expect(actions('layout')).toHaveLength(0)
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it('preserves the local app-link / Cybsh open event without a native view', async () => {
    hideMode = 'failure'
    const wrapper = mountStudio({ local: true })
    await flushPromises(); await click(wrapper, '.local-open')
    expect(wrapper.emitted('open')).toEqual([['terminal']])
  })

  it.each(['failure', 'timeout'] as const)('blocks built-in launch when an attached widget hide has %s, then allows one explicit retry after recovery', async mode => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    hideMode = mode
    await click(wrapper)
    expect(wrapper.emitted('open')).toBeUndefined()
    if (mode === 'timeout') { await vi.advanceTimersByTimeAsync(8000); await flushPromises() }
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(native.openApp).not.toHaveBeenCalled()
    const alert = document.body.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('No app was opened.')
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    expect(alert.getAttribute('aria-atomic')).toBe('true')
    hideMode = 'ok'
    await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
    expect(alert.textContent).toBe('')
  })

  it('blocks the Android openApp call when an attached widget cannot hide', async () => {
    const wrapper = mountStudio({ widget: true, android: true })
    await settleWidget(); hideMode = 'failure'; await click(wrapper)
    expect(native.openApp).not.toHaveBeenCalled()
    expect(wrapper.emitted('open')).toBeUndefined()
    hideMode = 'ok'; await click(wrapper)
    expect(native.openApp).toHaveBeenCalledExactlyOnceWith('com.example.reader')
  })

  it.each(['failure', 'timeout'] as const)('keeps an uncertain %s layout fail-closed until hide succeeds', async mode => {
    layoutMode = mode
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    hideMode = 'failure'
    await click(wrapper)
    if (mode === 'timeout') { expect(actions('hide')).toHaveLength(2); await vi.advanceTimersByTimeAsync(8000); await flushPromises() }
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('No app was opened.')
    hideMode = 'ok'; await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it('does not lose visibility debt when Home remounts without the old widget in its state', async () => {
    const previous = mountStudio({ widget: true })
    await settleWidget(); hideMode = 'failure'
    previous.unmount(); await flushPromises()
    const wrapper = mountStudio()
    await flushPromises()
    const hideNative = (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative
    expect(await hideNative()).toBe(false)
    await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(document.body.querySelector('.native-suspend-alert.has-error')?.textContent).toContain('Unlock and return to this app, then try again.')
    hideMode = 'ok'; await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it('waits for an in-flight required hide rather than treating it as already hidden', async () => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    let finish!: (value: unknown) => void
    native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    document.dispatchEvent(new Event('scroll'))
    await flushPromises()
    await click(wrapper)
    expect(wrapper.emitted('open')).toBeUndefined()
    finish(reply('hide')); await flushPromises()
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it('cancels a queued settle before launch so no native view appears afterward', async () => {
    const wrapper = mountStudio({ widget: true })
    await flushPromises()
    await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
    await vi.advanceTimersByTimeAsync(420); await flushPromises()
    expect(actions('layout')).toHaveLength(0)
  })

  it('does not recreate visibility debt when a later forced hide fails after acknowledged hide', async () => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    const hideNative = (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative
    expect(await hideNative()).toBe(true)
    hideMode = 'failure'
    window.dispatchEvent(new Event('resize')); await flushPromises()
    await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
    expect(actions('layout')).toHaveLength(1)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('')
  })

  it.each(['ok', 'failure'] as const)('orders a remounted owner hide after the previous owner in-flight layout and requires a fresh %s acknowledgment', async recoveryMode => {
    let finish!: (value: unknown) => void
    let acknowledgeHide!: (value: unknown) => void
    let rejectHide!: (reason: Error) => void
    let holdRecovery = false
    const transport = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation((command, args) => {
      if (args.action === 'layout') return new Promise(resolve => { finish = resolve })
      if (args.action === 'hide' && holdRecovery) return new Promise((resolve, reject) => { acknowledgeHide = resolve; rejectHide = reject })
      return transport(command, args)
    })
    const previous = mountStudio({ widget: true })
    await settleWidget()
    const hidesBefore = actions('hide').length
    hideMode = 'failure'; previous.unmount()
    const wrapper = mountStudio(); await flushPromises()
    const preflight = (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative()
    await flushPromises()
    expect(actions('hide')).toHaveLength(hidesBefore)
    finish(reply('layout'))
    expect(await preflight).toBe(false)
    await flushPromises()
    expect(actions('hide').length).toBeGreaterThan(hidesBefore)
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    // Mount refresh can schedule another hide through a dynamic IPC import.
    // Drain that failed lifecycle attempt before requesting a distinct retry;
    // a 1 ms timer tick cannot prove the old hide has actually completed.
    await vi.waitFor(() => expect(actions('providers')).toHaveLength(2))
    await vi.dynamicImportSettled(); await flushPromises()
    expect(await (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative()).toBe(false)
    await vi.dynamicImportSettled(); await flushPromises()
    const hidesAfterFailure = actions('hide').length
    holdRecovery = true
    const recovery = (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative()
    await vi.dynamicImportSettled(); await flushPromises()
    expect(actions('hide')).toHaveLength(hidesAfterFailure + 1)
    // A launch while the retry is pending must join it, not bypass it.
    await click(wrapper)
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(native.openApp).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    expect(actions('hide')).toHaveLength(hidesAfterFailure + 1)
    if (recoveryMode === 'ok') acknowledgeHide(reply('hide'))
    else rejectHide(new Error('auth: widget actions require the unlocked foreground app'))
    expect(await recovery).toBe(recoveryMode === 'ok')
    await flushPromises()
    expect(sessionStorage.getItem(visibilityKey)).toBe(recoveryMode === 'ok' ? null : '1')
    expect(wrapper.emitted('open')).toEqual(recoveryMode === 'ok' ? [['files']] : undefined)
    if (recoveryMode === 'failure') expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('No app was opened.')
    holdRecovery = false; hideMode = 'ok'
    await click(wrapper)
    expect(wrapper.emitted('open')).toEqual(recoveryMode === 'ok' ? [['files'], ['files']] : [['files']])
  })

  it('does not open again when an unnecessary startup hide eventually acknowledges', async () => {
    let finish!: (value: unknown) => void
    native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountStudio({ android: true })
    await flushPromises(); await click(wrapper)
    expect(native.openApp).toHaveBeenCalledExactlyOnceWith('com.example.reader')
    finish(reply('hide')); await flushPromises()
    expect(native.openApp).toHaveBeenCalledOnce()
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('does not accept an unsupported bridge no-op as acknowledged hide for an attached widget', async () => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget(); hideMode = 'unsupported'
    await click(wrapper); await click(wrapper)
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(native.openApp).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('No app was opened.')
  })

  it('journals possible visibility before dispatch and clears it only after acknowledged hide', async () => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    hideMode = 'failure'; await click(wrapper)
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    hideMode = 'ok'; await click(wrapper)
    expect(sessionStorage.getItem(visibilityKey)).toBeNull()
    expect(wrapper.emitted('open')).toEqual([['files']])
  })

  it('never attaches a native view if its reload recovery marker cannot be saved', async () => {
    const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    const wrapper = mountStudio({ widget: true })
    await flushPromises(); await vi.advanceTimersByTimeAsync(420); await flushPromises()
    expect(actions('layout')).toHaveLength(0)
    expect(wrapper.text()).toContain('safe visibility recovery could not be saved')
    hideMode = 'failure'; await click(wrapper)
    expect(wrapper.emitted('open')).toEqual([['files']])
    storage.mockRestore()
  })

  it('retains native visibility debt across a fresh coordinator module after WebView reload', async () => {
    const previous = mountStudio({ widget: true })
    await settleWidget(); hideMode = 'failure'; previous.unmount(); await flushPromises()
    const hideNative = await freshCoordinator()
    expect(await hideNative()).toBe(false)
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    hideMode = 'ok'; await vi.advanceTimersByTimeAsync(1); await flushPromises()
    expect(await hideNative()).toBe(true)
    expect(sessionStorage.getItem(visibilityKey)).toBeNull()
  })

  it('fails closed when a fresh document cannot read whether a native view was attached', async () => {
    const storage = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
    hideMode = 'failure'
    const hideNative = await freshCoordinator()
    expect(await hideNative()).toBe(false)
    expect(actions('layout')).toHaveLength(0)
    storage.mockRestore(); hideMode = 'ok'
    await vi.advanceTimersByTimeAsync(1); await flushPromises()
    expect(await hideNative()).toBe(true)
  })

  it('keeps a stale marker conservative across reload if confirmed-hide cleanup cannot remove it', async () => {
    const wrapper = mountStudio({ widget: true })
    await settleWidget()
    const storage = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable') })
    expect(await (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative()).toBe(true)
    expect(sessionStorage.getItem(visibilityKey)).toBe('1')
    storage.mockRestore(); hideMode = 'failure'; wrapper.unmount(); await flushPromises()
    const hideNative = await freshCoordinator()
    expect(await hideNative()).toBe(false)
    hideMode = 'ok'; await vi.advanceTimersByTimeAsync(1); await flushPromises()
    expect(await hideNative()).toBe(true)
  })
})
