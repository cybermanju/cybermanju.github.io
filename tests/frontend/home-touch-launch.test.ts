// CyberManju OS — Home icon tap-to-launch regression.
// Role: exercise the real HomeWorkspaceStudio click path and guard mobile pointer pass-through.
// Integrates: Vue Test Utils, Happy DOM, native app interfaces and DesktopShell source.
// Contracts: only existing native interfaces are mocked; no production files are changed.
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomeWorkspaceStudio from '@/components/HomeWorkspaceStudio.vue'

const native = vi.hoisted(() => ({ suspend: vi.fn<() => Promise<boolean>>() }))
const android = vi.hoisted(() => ({ openApp: vi.fn() }))
vi.mock('@/composables/useHomeNativeWidgets', () => ({
  useHomeNativeWidgets: () => ({ bridge: { supported: false, busy: { value: false }, status: { value: 'unsupported' }, providers: { value: [] }, error: { value: '' }, viewport: { value: null }, refresh: vi.fn(), records: { value: [] }, mutate: vi.fn() }, placementMessages: { value: {} }, activeNative: { value: [] }, suspend: native.suspend, schedule: vi.fn() }),
}))
vi.mock('@/composables/useAndroidApps', () => ({
  useAndroidApps: () => ({ apps: { value: [] }, status: { value: 'ready' }, refresh: vi.fn(), openApp: android.openApp }),
}))
vi.mock('@/composables/useAndroidWidgets', () => ({ widgetConfirmation: vi.fn() }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ reduced: { value: false } }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@/components/HomeLocalWidget.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeDefaultRoleAction.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeWorkspacePreview.vue', () => ({ default: { template: '<div />' } }))

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

const apps = [{ id: 'files', label: 'Files', icon: 'solar:folder-bold' }]
function mountStudio(options: { blocked?: boolean; hidden?: boolean } = {}) {
  native.suspend.mockResolvedValue(options.hidden ?? true)
  const wrapper = mount(HomeWorkspaceStudio, {
    attachTo: document.body,
    props: { apps, initialIds: ['files'], blocked: options.blocked ?? false },
    global: { stubs: { AppIcon: true, HomeLocalWidget: true, HomeDefaultRoleAction: true, HomeWorkspacePreview: true } },
  })
  return wrapper
}

function touch(id: number, x: number, y = 180, target: Element) {
  return { identifier: id, clientX: x, clientY: y, target }
}
function dispatchTouch(target: Element, type: string, touches: ReturnType<typeof touch>[], changedTouches: ReturnType<typeof touch>[]) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
  target.dispatchEvent(event)
}

describe('Home app icon launch on touch/click', () => {
  it('emits the existing open event from a real home app icon click', async () => {
    const wrapper = mountStudio()
    await wrapper.get('.workspace-launch').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toEqual([['files']])
    expect(native.suspend).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('routes Android shortcut icons through the existing native openApp interface', async () => {
    android.openApp.mockResolvedValue(undefined)
    const wrapper = mount(HomeWorkspaceStudio, {
      attachTo: document.body,
      props: { apps, initialIds: ['android:com.example.reader'] },
      global: { stubs: { AppIcon: true, HomeLocalWidget: true, HomeDefaultRoleAction: true, HomeWorkspacePreview: true } },
    })
    await wrapper.get('.workspace-launch').trigger('click')
    await flushPromises()
    expect(android.openApp).toHaveBeenCalledWith('com.example.reader')
    expect(wrapper.emitted('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not launch while blocked or when native home suspension fails', async () => {
    const blocked = mountStudio({ blocked: true })
    await blocked.get('.workspace-launch').trigger('click')
    await flushPromises()
    expect(blocked.emitted('open')).toBeUndefined()
    expect(native.suspend).not.toHaveBeenCalled()
    blocked.unmount()

    const failedHide = mountStudio({ hidden: false })
    await failedHide.get('.workspace-launch').trigger('click')
    await flushPromises()
    expect(native.suspend).toHaveBeenCalledOnce()
    expect(failedHide.emitted('open')).toBeUndefined()
    failedHide.unmount()
  })

  it.each(['false', 'rejected'])('announces native suspend %s and blocks launch, customize, picker, and navigation', async outcome => {
    const wrapper = mountStudio()
    if (outcome === 'false') native.suspend.mockResolvedValue(false)
    else native.suspend.mockRejectedValue(new Error('host unavailable'))

    await wrapper.get('.workspace-launch').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined()
    let alert = document.body.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Unlock and return to this app, then try again.')
    expect(alert?.getAttribute('aria-live')).toBe('assertive')

    await wrapper.get('.workspace-launch').trigger('contextmenu')
    await flushPromises()
    expect(wrapper.emitted('customize')).toBeUndefined()
    await wrapper.get('button[aria-label="Add apps or widgets to home"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.studio-picker')).toBeNull()
    // The orb navigator is the only paging surface now; navigation is
    // suspend-gated, so the screen keeps its place on a failed suspend
    // (its single activation advances after its deliberate 450 ms delay).
    await wrapper.get('.orb-core').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 460))
    await flushPromises()
    expect(wrapper.get('.orb-core').attributes('aria-label')).toContain('Home screen 1 of 2')
    wrapper.unmount()
  })

  it('exposes safe hideNative feedback even while root is inert, then clears it after success', async () => {
    const wrapper = mountStudio({ blocked: true, hidden: false })
    const hideNative = (wrapper.vm as unknown as { hideNative: () => Promise<boolean> }).hideNative
    let alert = document.body.querySelector('[role="alert"]')
    expect(alert?.getAttribute('aria-live')).toBe('assertive')
    expect(alert?.getAttribute('aria-atomic')).toBe('true')
    expect(await hideNative()).toBe(false)
    alert = document.body.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Unlock and return to this app, then try again.')
    expect(wrapper.get('.home-studio').attributes('inert')).toBeDefined()
    native.suspend.mockRejectedValueOnce(new Error('host unavailable'))
    expect(await hideNative()).toBe(false)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Unlock and return to this app, then try again.')
    native.suspend.mockResolvedValue(true)
    expect(await hideNative()).toBe(true)
    await flushPromises()
    alert = document.body.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toBe('')
    expect(alert?.classList.contains('has-error')).toBe(false)
    wrapper.unmount()
  })

  it('lets an ordinary touch tap activate the existing icon action', async () => {
    const wrapper = mountStudio(), icon = wrapper.get('.workspace-launch').element
    const finger = touch(41, 120, 180, icon)
    dispatchTouch(icon, 'touchstart', [finger], [finger]); dispatchTouch(icon, 'touchend', [], [finger])
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await flushPromises(); expect(wrapper.emitted('open')).toEqual([['files']]); wrapper.unmount()
  })

  it.each(['cancel', 'drag', 'multitouch'])('suppresses the icon compatibility click after %s but allows keyboard activation', async reason => {
    const wrapper = mountStudio(), icon = wrapper.get('.workspace-launch').element
    const finger = touch(41, 120, 180, icon)
    dispatchTouch(icon, 'touchstart', [finger], [finger])
    if (reason === 'cancel') dispatchTouch(icon, 'touchcancel', [], [finger])
    if (reason === 'drag') { const moved = touch(41, 150, 180, icon); dispatchTouch(icon, 'touchmove', [moved], [moved]); dispatchTouch(icon, 'touchend', [], [moved]) }
    if (reason === 'multitouch') { const second = touch(82, 180, 180, icon); dispatchTouch(icon, 'touchstart', [finger, second], [second]); dispatchTouch(icon, 'touchend', [], [finger, second]) }
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await flushPromises(); expect(wrapper.emitted('open')).toBeUndefined()
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    await flushPromises(); expect(wrapper.emitted('open')).toEqual([['files']]); wrapper.unmount()
  })

  it.each(['blur', 'blocked', 'unmount'])('rejects a late native-hide completion after %s instead of launching', async reason => {
    const wrapper = mountStudio()
    let resolve!: (ok: boolean) => void
    native.suspend.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done }))
    await wrapper.get('.workspace-launch').trigger('click')
    if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    if (reason === 'blocked') await wrapper.setProps({ blocked: true })
    if (reason === 'unmount') wrapper.unmount()
    resolve(true); await flushPromises(); expect(wrapper.emitted('open')).toBeUndefined()
    if (reason !== 'unmount') wrapper.unmount()
  })

  it('pages through sequential two-finger formation and separate releases; persists the trailing empty page without adding content', async () => {
    const wrapper = mountStudio()
    const zone = wrapper.get('.studio-home').element
    const [left0, right0] = [touch(41, 240, 180, zone), touch(82, 270, 180, zone)]
    dispatchTouch(zone, 'touchstart', [left0], [left0])
    dispatchTouch(zone, 'touchstart', [left0, right0], [right0])
    await flushPromises()
    const left1 = touch(41, 120, 180, zone), right1 = touch(82, 150, 180, zone)
    dispatchTouch(zone, 'touchmove', [left1, right1], [left1, right1])
    dispatchTouch(zone, 'touchend', [right1], [left1])
    dispatchTouch(zone, 'touchend', [], [right1])
    await flushPromises()

    // The orb announces the new active screen and the overview is still
    // closed, so screen identity itself (plus persisted state) is the truth.
    expect(wrapper.get('.orb-core').attributes('aria-label')).toContain('Home screen 2 of 2')
    expect(wrapper.findAll('.workspace-app')).toHaveLength(1)
    const saved = JSON.parse(localStorage.getItem('cybermanju.home.workspaces.v1') || 'null')
    expect(saved.pages).toHaveLength(2)
    expect(saved.pages[1].items).toEqual([])
    expect(saved.activeId).toBe(saved.pages[1].id)
    const activeId = saved.activeId
    wrapper.unmount()

    const reloaded = mountStudio()
    await flushPromises()
    expect(reloaded.get('.orb-core').attributes('aria-label')).toContain('Home screen 2 of 2')
    expect(JSON.parse(localStorage.getItem('cybermanju.home.workspaces.v1') || 'null').activeId).toBe(activeId)
    reloaded.unmount()
  })

  it('keeps orb and keyboard navigation as non-gesture alternatives', async () => {
    const wrapper = mountStudio()
    const orb = wrapper.get('.orb-core')
    await orb.trigger('click')
    await new Promise(resolve => setTimeout(resolve, 460))
    await flushPromises()
    expect(orb.attributes('aria-label')).toContain('Home screen 2 of 2')
    const root = wrapper.get('.home-studio')
    await root.trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(orb.attributes('aria-label')).toContain('Home screen 1 of 2')
    wrapper.unmount()
  })

  it('keeps app-window pointer events enabled under mobile shell pass-through', () => {
    const shell = readFileSync('src/components/DesktopShell.vue', 'utf8')
    const styles = shell.slice(shell.indexOf('<style'), shell.indexOf('</style>'))
    // The mobile parent selector must cover both host layout variants, without
    // disabling pointer input on the app-window descendants themselves.
    const rules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector!, body!] as const)
    const passThrough = rules.find(([selector, body]) => selector.includes('.desktop-strip') && selector.includes('.desktop-workspace') && body.includes('pointer-events: none'))
    expect(passThrough).toBeDefined()
    const appWindows = rules.find(([selector, body]) => selector.includes('.app-window') && body.includes('pointer-events: auto'))
    expect(appWindows).toBeDefined()
  })
})
