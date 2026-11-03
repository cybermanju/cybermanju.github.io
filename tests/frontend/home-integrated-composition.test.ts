// CyberManju OS — Integrated mobile Home composition regression (tests/frontend/home-integrated-composition.test.ts).
// Role: verify launcher capture, unified search presence and real Home workspace barriers together.
// Exports: Vitest composition tests. Integrates: MobileLauncher, HomeLauncher, mocked host services.
// Contracts: no production changes; native suspension must succeed before Home actions or drawer open.
// @vitest-environment happy-dom
import { defineComponent, h, reactive, ref } from 'vue'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MobileLauncher from '@/components/MobileLauncher.vue'

const native = vi.hoisted(() => ({ suspend: vi.fn<() => Promise<boolean>>() }))
const appState = reactive({ searchQuery: '', currentPanel: 'landing', files: [] as unknown[], disks: [] as unknown[], trashItems: [] as unknown[], activeAgentJob: null as unknown })
const launcherState = reactive({ drawerOpen: false, messagesOpen: false, favorites: [] as string[], overrides: {} as Record<string, unknown> })
const opened = vi.hoisted(() => ({ panels: [] as string[] }))
vi.mock('@/composables/useHomeNativeWidgets', () => ({ useHomeNativeWidgets: () => ({ bridge: { supported: false, busy: { value: false }, status: { value: 'unsupported' }, providers: { value: [] }, error: { value: '' }, viewport: { value: null }, refresh: vi.fn(), records: { value: [] }, mutate: vi.fn() }, placementMessages: { value: {} }, activeNative: { value: [] }, suspend: native.suspend, schedule: vi.fn() }) }))
vi.mock('@/composables/useAndroidApps', () => ({ useAndroidApps: () => ({ apps: { value: [] }, status: { value: 'ready' }, supported: false, refresh: vi.fn(), openApp: vi.fn() }) }))
vi.mock('@/composables/useAndroidWidgets', () => ({ widgetConfirmation: vi.fn() }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ reduced: { value: false } }) }))
vi.mock('@/composables/useTheme', () => ({ useTheme: () => ({ themeId: { value: 'default' } }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => Object.assign(appState, { fetchDisks: vi.fn().mockResolvedValue(undefined), fetchTrashItems: vi.fn().mockResolvedValue(undefined), fetchSyncConfigs: vi.fn().mockResolvedValue(undefined), notifyError: vi.fn(), notifySuccess: vi.fn() }) }))
vi.mock('@/stores/launcher', () => ({ useLauncherStore: () => Object.assign(launcherState, { setDrawer: (value: boolean) => { launcherState.drawerOpen = value }, setMessagesOpen: (value: boolean) => { launcherState.messagesOpen = value }, setFavorites: vi.fn(), toggleFavorite: vi.fn(), pinToEnd: vi.fn(), hide: vi.fn(), rename: vi.fn(), reset: vi.fn(), setIcon: vi.fn() }) }))
vi.mock('@/composables/useMessages', () => ({ useMessages: () => ({ supported: false, unread: { value: 0 }, refresh: vi.fn() }) }))
vi.mock('@/composables/useNotifications', () => ({ useNotifications: () => ({ unreadCount: { value: 0 } }) }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ windows: ref([]), open: (panel: string) => opened.panels.push(panel) }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<span aria-hidden="true" />' } }))
vi.mock('@/components/OmniSearchPanel.vue', () => ({ default: defineComponent({ setup(_, { expose }) { const input = ref<HTMLInputElement>(); expose({ focus: () => input.value?.focus() }); return () => h('input', { ref: input, 'aria-label': 'Omni search', type: 'search' }) } }) }))
vi.mock('@/components/AppDrawer.vue', () => ({ default: { template: '<aside data-test="drawer" />' } }))
vi.mock('@/components/MessagesHub.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeLocalWidget.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeDefaultRoleAction.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeWorkspacePreview.vue', () => ({ default: { template: '<div />' } }))
enableAutoUnmount(afterEach)

function mountLauncher() {
  native.suspend.mockResolvedValue(true)
  return mount(MobileLauncher, { attachTo: document.body })
}
type TouchPoint = { identifier: number; clientX: number; clientY: number; target: Element }
function point(identifier: number, x: number, y: number, target: Element): TouchPoint { return { identifier, clientX: x, clientY: y, target } }
function touch(target: Element, type: string, touches: TouchPoint[], changed: TouchPoint[] = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changed } })
  target.dispatchEvent(event)
  return event
}
function swipe(target: Element, id: number, x: number, fromY: number, toY: number) {
  const from = point(id, x, fromY, target), to = point(id, x, toY, target)
  touch(target, 'touchstart', [from], [from]); touch(target, 'touchmove', [to], [to]); touch(target, 'touchend', [], [to])
}
beforeEach(() => { appState.searchQuery = ''; appState.currentPanel = 'landing'; launcherState.drawerOpen = false; launcherState.messagesOpen = false; launcherState.favorites = []; launcherState.overrides = {}; opened.panels = []; Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 }) })
afterEach(() => { vi.clearAllMocks(); localStorage.clear(); document.body.innerHTML = '' })

describe('MobileLauncher + HomeLauncher integrated composition', () => {
  it('keeps unified search present and blocks Home gestures while search tools are focused', async () => {
    const wrapper = mountLauncher()
    expect(wrapper.get('[aria-label="Search and commands"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Omni search"]').exists()).toBe(true)
    const input = wrapper.get('[aria-label="Omni search"]')
    ;(input.element as HTMLInputElement).focus(); await flushPromises()
    swipe(wrapper.get('.home-studio').element, 1, 150, 740, 590); await flushPromises()
    expect(launcherState.drawerOpen).toBe(false)
    await input.setValue('needle'); await flushPromises()
    swipe(wrapper.get('.home-studio').element, 2, 150, 740, 590); await flushPromises()
    expect(launcherState.drawerOpen).toBe(false)
  })

  it.each(['false', 'reject', 'success'] as const)('guards drawer swipe on native suspend (%s)', async outcome => {
    const wrapper = mountLauncher()
    if (outcome === 'false') native.suspend.mockResolvedValue(false)
    if (outcome === 'reject') native.suspend.mockRejectedValue(new Error('host unavailable'))
    swipe(wrapper.get('.home-studio').element, 4, 150, 740, 590); await flushPromises()
    // The current gesture path performs one native suspension before handoff.
    expect(native.suspend).toHaveBeenCalledTimes(1)
    expect(launcherState.drawerOpen).toBe(outcome === 'success')
    expect(opened.panels).toEqual([])
    if (outcome !== 'success') {
      const alert = document.body.querySelector('[role="alert"]')
      expect(alert?.getAttribute('aria-live')).toBe('assertive')
      expect(alert?.textContent).toContain('Unlock and return to this app, then try again.')
    }
  })

  it.each(['false', 'reject', 'success'] as const)('guards search swipe on native suspend (%s)', async outcome => {
    const wrapper = mountLauncher()
    if (outcome === 'false') native.suspend.mockResolvedValue(false)
    if (outcome === 'reject') native.suspend.mockRejectedValue(new Error('host unavailable'))
    swipe(wrapper.get('.home-studio').element, 5, 150, 100, 220)
    await flushPromises()
    expect(document.activeElement === wrapper.get('[aria-label="Omni search"]').element).toBe(outcome === 'success')
    expect(launcherState.drawerOpen).toBe(false)
    expect(opened.panels).toEqual([])
    if (outcome !== 'success') expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Unlock and return')
  })
  it('activates a workspace icon once for touch plus compatibility click, while retaining mouse and keyboard click', async () => {
    const wrapper = mountLauncher(), icon = wrapper.get('.workspace-launch').element as HTMLElement
    const panel = icon.getAttribute('aria-label')!.replace(/^Open /, '').split(';')[0].toLowerCase()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(icon)
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); await flushPromises()
    expect(opened.panels).toEqual([panel])
    const finger = point(8, 200, 300, icon)
    touch(icon, 'touchstart', [finger], [finger]); const ended = touch(icon, 'touchend', [], [finger]); await flushPromises()
    expect(ended.defaultPrevented).toBe(true)
    expect(opened.panels).toEqual([panel, panel])
    const compat = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    icon.dispatchEvent(compat); await flushPromises()
    expect(compat.defaultPrevented).toBe(true)
    expect(opened.panels).toEqual([panel, panel])
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); await flushPromises()
    expect(opened.panels).toEqual([panel, panel, panel])
  })

  it('fails closed on rejected native suspend when launching; no panel opens and alert is accessible', async () => {
    const wrapper = mountLauncher()
    native.suspend.mockRejectedValue(new Error('host unavailable'))
    await wrapper.get('.workspace-launch').trigger('click'); await flushPromises()
    expect(opened.panels).toEqual([])
    expect(launcherState.drawerOpen).toBe(false)
    expect(document.body.querySelector('[role="alert"]')?.getAttribute('aria-live')).toBe('assertive')
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('No app was opened.')
  })

})
