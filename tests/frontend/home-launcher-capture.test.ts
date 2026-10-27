// CyberManju OS — Simulated integration coverage for MobileLauncher capture routing + real Home workspace.
// @vitest-environment happy-dom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeWorkspaceStudio from '@/components/HomeWorkspaceStudio.vue'
import { useHomeTapActivation } from '@/composables/useHomeTapActivation'
import { useLauncherWorkspaceGestures } from '@/composables/useLauncherWorkspaceGestures'
import { normalizeHomeState, HOME_WORKSPACE_KEY } from '@/utils/homeWorkspaces'

const native = vi.hoisted(() => ({ suspend: vi.fn<() => Promise<boolean>>() }))
vi.mock('@/composables/useHomeNativeWidgets', () => ({
  useHomeNativeWidgets: () => ({ bridge: { supported: false, busy: { value: false }, status: { value: 'unsupported' }, providers: { value: [] }, error: { value: '' }, viewport: { value: null }, refresh: vi.fn(), records: { value: [] }, mutate: vi.fn() }, placementMessages: { value: {} }, activeNative: { value: [] }, suspend: native.suspend, schedule: vi.fn() }),
}))
vi.mock('@/composables/useAndroidApps', () => ({ useAndroidApps: () => ({ apps: { value: [] }, status: { value: 'ready' }, refresh: vi.fn(), openApp: vi.fn() }) }))
vi.mock('@/composables/useAndroidWidgets', () => ({ widgetConfirmation: vi.fn() }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ reduced: { value: false } }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@/components/HomeLocalWidget.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeDefaultRoleAction.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/HomeWorkspacePreview.vue', () => ({ default: { template: '<div />' } }))
enableAutoUnmount(afterEach)

const apps = [{ id: 'files', label: 'Files', icon: 'solar:folder-bold' }]
const Harness = defineComponent({
  components: { HomeWorkspaceStudio },
  setup() {
    const opened = ref<string[]>([]), drawers = ref(0), searches = ref(0), progress = ref(0), suppressed = ref(0)
    const blocked = ref(false)
    const tap = useHomeTapActivation()
    const gestures = useLauncherWorkspaceGestures({ blocked: () => blocked.value, openDrawer: () => drawers.value++, openSearch: () => searches.value++, progress: value => { progress.value = value }, suppressClick: () => suppressed.value++ })
    return { opened, drawers, searches, progress, suppressed, blocked, tap, gestures, apps }
  },
  template: `<main data-test="capture" @touchstart.capture.passive="tap.start($event); gestures.start($event)" @touchmove.capture="tap.move($event); gestures.move($event)" @touchend.capture="tap.end($event); gestures.end($event)" @touchcancel.capture="tap.cancel($event); gestures.cancel($event)" @click.capture="tap.click($event)"><HomeWorkspaceStudio :apps="apps" :initial-ids="['files']" :blocked="blocked" @open="opened.push($event)" /></main>`,
})
function mountHarness() {
  native.suspend.mockResolvedValue(true)
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: { AppIcon: true, HomeLocalWidget: true, HomeDefaultRoleAction: true, HomeWorkspacePreview: true } } })
  return wrapper
}
type Point = { identifier: number; clientX: number; clientY: number; target: Element }
function point(identifier: number, clientX: number, clientY: number, target: Element): Point { return { identifier, clientX, clientY, target } }
function dispatch(target: Element, type: string, touches: Point[], changedTouches: Point[]) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
  target.dispatchEvent(event)
  return event
}
function stroke(target: Element, id: number, x: number, y1: number, y2: number) {
  const first = point(id, x, y1, target), last = point(id, x, y2, target)
  dispatch(target, 'touchstart', [first], [first])
  dispatch(target, 'touchmove', [last], [last])
  dispatch(target, 'touchend', [], [last])
}
function screen(wrapper: ReturnType<typeof mount>) { return wrapper.get('.studio-kicker').text() }

beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 }) })
afterEach(() => { vi.clearAllMocks(); localStorage.clear(); document.body.innerHTML = '' })

describe('HomeWorkspaceStudio inside launcher capture routing (simulated touch events)', () => {
  it('routes a bottom-up empty-canvas swipe to drawer exactly once, without opening or changing screen', async () => {
    const wrapper = mountHarness(), root = wrapper.get('[data-test="capture"]').element
    expect(wrapper.get('.home-studio').attributes('data-shell-gesture-exclude')).toBeDefined()
    stroke(root.querySelector('.studio-stage')!, 1, 150, 740, 590)
    await flushPromises()
    expect(wrapper.vm.$.setupState.drawers).toBe(1)
    expect(wrapper.vm.$.setupState.searches).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
    expect(screen(wrapper)).toBe('SCREEN 1 / 2')
  })
  it('routes an upper down-swipe to search exactly once, without opening or changing screen', async () => {
    const wrapper = mountHarness(), target = wrapper.get('.studio-stage').element
    stroke(target, 2, 150, 100, 220)
    await flushPromises()
    expect(wrapper.vm.$.setupState.searches).toBe(1)
    expect(wrapper.vm.$.setupState.drawers).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
    expect(screen(wrapper)).toBe('SCREEN 1 / 2')
  })
  it('poisons a two-finger sequence despite separate releases; no drawer or search', async () => {
    const wrapper = mountHarness(), target = wrapper.get('.studio-stage').element
    const one = point(10, 120, 740, target), two = point(11, 220, 730, target)
    dispatch(target, 'touchstart', [one], [one])
    dispatch(target, 'touchstart', [one, two], [two])
    dispatch(target, 'touchmove', [one, two], [one, two])
    dispatch(target, 'touchend', [two], [one])
    dispatch(target, 'touchend', [], [two])
    await flushPromises()
    expect(wrapper.vm.$.setupState.drawers).toBe(0)
    expect(wrapper.vm.$.setupState.searches).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
    expect(screen(wrapper)).toBe('SCREEN 1 / 2')
  })
  it('a two-finger swipe advances the actual workspace page, never drawer or search', async () => {
    const wrapper = mountHarness(), target = wrapper.get('.workspace-content').element
    const one = point(20, 260, 600, target), two = point(21, 290, 600, target)
    dispatch(target, 'touchstart', [one], [one])
    dispatch(target, 'touchstart', [one, two], [two])
    await flushPromises()
    const movedOne = point(20, 110, 600, target), movedTwo = point(21, 140, 600, target)
    dispatch(target, 'touchmove', [movedOne, movedTwo], [movedOne, movedTwo])
    dispatch(target, 'touchend', [movedTwo], [movedOne])
    dispatch(target, 'touchend', [], [movedTwo])
    await flushPromises()
    expect(screen(wrapper)).toBe('SCREEN 2 / 2')
    expect(wrapper.vm.$.setupState.drawers).toBe(0)
    expect(wrapper.vm.$.setupState.searches).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
  })
  it.each(['complete', 'multitouch', 'touchcancel', 'pointercancel', 'blur', 'blocked'])('keeps Pointer drag ownership, with safe %s termination', async mode => {
    const wrapper = mountHarness()
    wrapper.get('[aria-label="Overview of home screens"]').element.click()
    await flushPromises()
    const chip = wrapper.get('.eagle-chip').element as HTMLElement
    const details = wrapper.get('.eagle-move-list').element as HTMLDetailsElement
    details.open = true
    Object.defineProperty(chip, 'setPointerCapture', { configurable: true, value: vi.fn() })
    const destination = wrapper.findAll('.eagle-card')[1]!.element
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(destination)
    chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 100 }))
    const first = point(7, 100, 100, chip), last = point(7, 250, 250, chip)
    dispatch(chip, 'touchstart', [first], [first])
    if (mode === 'multitouch') {
      const second = point(8, 130, 100, chip)
      dispatch(chip, 'touchstart', [first, second], [second])
      dispatch(chip, 'touchend', [first], [second])
    }
    if (mode === 'touchcancel') dispatch(chip, 'touchcancel', [], [first])
    if (mode === 'pointercancel') chip.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7, pointerType: 'touch' }))
    if (mode === 'blur') window.dispatchEvent(new Event('blur'))
    if (mode === 'blocked') { wrapper.vm.$.setupState.blocked = true; await flushPromises() }
    dispatch(chip, 'touchmove', [last], [last])
    chip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 250, clientY: 250 }))
    dispatch(chip, 'touchend', [], [last])
    await flushPromises()
    const saved = JSON.parse(localStorage.getItem(HOME_WORKSPACE_KEY)!)
    expect(saved.pages[0].items.some((item: { ref: string }) => item.ref === 'files')).toBe(mode !== 'complete')
    expect(saved.pages[1].items.some((item: { ref: string }) => item.ref === 'files')).toBe(mode === 'complete')
    expect(wrapper.vm.$.setupState.drawers).toBe(0)
    expect(wrapper.vm.$.setupState.searches).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
  })
  it('activates a real icon once on touchend and consumes a late compatibility click but preserves keyboard click', async () => {
    const wrapper = mountHarness(), icon = wrapper.get('.workspace-launch').element as HTMLButtonElement
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(icon)
    const start = point(30, 200, 300, icon), end = point(30, 200, 300, icon)
    dispatch(icon, 'touchstart', [start], [start])
    const endEvent = dispatch(icon, 'touchend', [], [end])
    await flushPromises()
    expect(endEvent.defaultPrevented).toBe(true)
    expect(wrapper.vm.$.setupState.opened).toEqual(['files'])
    const lateClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    icon.dispatchEvent(lateClick)
    await flushPromises()
    expect(lateClick.defaultPrevented).toBe(true)
    expect(wrapper.vm.$.setupState.opened).toEqual(['files'])
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    await flushPromises()
    expect(wrapper.vm.$.setupState.opened).toEqual(['files', 'files'])
  })
  it.each(['cancel', 'edit', 'overview', 'widget'])('does not claim excluded/cancelled %s gesture', async mode => {
    if (mode === 'widget') {
      const state = normalizeHomeState(null, ['files'])
      state.pages[0]!.items.push({ id: 'native-exclusion-slot', kind: 'widget', ref: 'native:42', data: { label: 'Test widget' } })
      localStorage.setItem(HOME_WORKSPACE_KEY, JSON.stringify(state))
    }
    const wrapper = mountHarness()
    if (mode === 'edit') {
      wrapper.findAll('.studio-tools button').find(button => button.text() === 'Edit')!.element.click()
      await flushPromises()
      expect(wrapper.get('.home-studio').classes()).toContain('is-editing')
    }
    if (mode === 'overview') { wrapper.get('button[aria-label^="Overview of home screens"]').element.click(); await flushPromises() }
    let target: Element
    if (mode === 'widget') target = wrapper.get('[data-native-placement="native-exclusion-slot"]').element
    else if (mode === 'edit') target = wrapper.get('.studio-stage').element
    else if (mode === 'overview') target = wrapper.get('.studio-stage').element
    else target = wrapper.get('.studio-stage').element
    const first = point(40, 160, 740, target)
    dispatch(target, 'touchstart', [first], [first])
    if (mode === 'cancel') dispatch(target, 'touchcancel', [], [first])
    else { const last = point(40, 160, 590, target); dispatch(target, 'touchmove', [last], [last]); dispatch(target, 'touchend', [], [last]) }
    await flushPromises()
    expect(wrapper.vm.$.setupState.drawers).toBe(0)
    expect(wrapper.vm.$.setupState.searches).toBe(0)
    expect(wrapper.vm.$.setupState.opened).toEqual([])
  })
})
