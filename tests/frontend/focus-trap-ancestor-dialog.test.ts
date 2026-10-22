// CyberManju OS — Focus trap ancestor-dialog regressions.
// Role: exercise production consumers whose semantic dialog wraps the trapped container.
// Exports: none.
// Integrates: Vue Test Utils, happy-dom, ConfirmDialog, AppDrawer, useFocusTrap.
// Contracts: Tab boundaries wrap after initial focus; foreign overlays retain keyboard ownership; no backend IO.
// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import ConfirmDialog from '../../src/components/ConfirmDialog.vue'
import AppDrawer from '../../src/components/AppDrawer.vue'

const state = vi.hoisted(() => ({ launcher: null as any }))
vi.mock('@/stores/launcher', () => ({ useLauncherStore: () => state.launcher }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }) }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: vi.fn() }) }))
vi.mock('@/composables/useAndroidApps', () => ({ useAndroidApps: () => ({ supported: false, apps: ref([]) }) }))
vi.mock('@/composables/useTheme', () => ({ useTheme: () => ({ shellStyle: ref('default'), themeId: ref('default') }) }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ duration: () => 0, reduced: ref(true) }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: defineComponent({ template: '<span aria-hidden="true" />' }) }))

let productionStyle: HTMLStyleElement
beforeAll(() => {
  // Use real overlay layers: SFC styles are not injected by Vitest.
  productionStyle = document.createElement('style')
  productionStyle.textContent = ['ConfirmDialog', 'AppDrawer'].flatMap(name =>
    parse(readFileSync(`src/components/${name}.vue`, 'utf8')).descriptor.styles.map(block => block.content),
  ).join('\n')
  document.head.append(productionStyle)
})
afterAll(() => productionStyle.remove())
const roots: Array<ReturnType<typeof mount>> = []
let opener: HTMLButtonElement
beforeEach(() => {
  document.body.innerHTML = ''
  state.launcher = reactive({ drawerOpen: false, drawerDisplay: 'both', overrides: {}, setDrawer(open: boolean) { this.drawerOpen = open } })
  opener = document.createElement('button')
  opener.textContent = 'Background opener'
  document.body.append(opener)
  opener.focus()
})
afterEach(() => {
  for (const wrapper of roots.splice(0).reverse()) wrapper.unmount()
  document.body.innerHTML = ''
})
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 65)); await nextTick() }
function key(target: Element, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
function openConfirm(initiallyOpen = true) {
  const wrapper = mount(ConfirmDialog, { attachTo: document.body, props: { visible: initiallyOpen } })
  roots.push(wrapper)
  return wrapper
}
function openDrawer(initiallyOpen = true) {
  state.launcher.drawerOpen = initiallyOpen
  const wrapper = mount(AppDrawer, { attachTo: document.body, props: { builtInApps: [
    { panel: 'files', label: 'Files', icon: 'solar:folder-bold', tint: '#123456' },
  ] } })
  roots.push(wrapper)
  return wrapper
}
function boundaries(container: HTMLElement) {
  const controls = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
  expect(controls.length).toBeGreaterThan(1)
  return { first: controls[0], last: controls.at(-1)! }
}
function expectWrapped(container: HTMLElement) {
  const { first, last } = boundaries(container)
  // Reverse immediately from initial focus, then forward from the last control.
  expect(key(first, true).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(last)
  expect(key(last).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(first)
  // Interior Tab must remain native (the DOM emulator does not perform tabbing).
  expect(key(first).defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(first)
}

for (const consumer of [
  { name: 'ConfirmDialog', open: openConfirm, container: '.confirm-modal', overlay: '.confirm-overlay' },
  { name: 'AppDrawer', open: openDrawer, container: '.app-drawer', overlay: '.app-drawer-veil' },
]) {
  describe(`${consumer.name} ancestor semantic dialog`, () => {
    it.each([true, false])('contains both Tab boundaries after initial focus (initiallyOpen=%s)', async initiallyOpen => {
      const wrapper = consumer.open(initiallyOpen)
      if (!initiallyOpen) {
        expect(document.body.querySelector(consumer.overlay)).toBeNull()
        if (consumer.name === 'ConfirmDialog') await wrapper.setProps({ visible: true })
        else state.launcher.setDrawer(true)
      }
      await settle()
      const container = document.body.querySelector<HTMLElement>(consumer.container)!
      const overlay = document.body.querySelector<HTMLElement>(consumer.overlay)!
      expect(overlay.getAttribute('role')).toBe('dialog')
      expect(overlay.getAttribute('aria-modal')).toBe('true')
      expect(overlay.contains(container)).toBe(true)
      expect(container.contains(overlay)).toBe(false)
      expect(document.activeElement).toBe(boundaries(container).first)
      expectWrapped(container)
    })

    it('closes only itself on Escape and restores the background opener', async () => {
      const wrapper = consumer.open(); await settle()
      const escaped = vi.fn()
      window.addEventListener('keydown', escaped)
      try {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        document.activeElement!.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(escaped).not.toHaveBeenCalled()
        if (consumer.name === 'ConfirmDialog') {
          expect(wrapper.emitted('cancel')).toHaveLength(1)
          await wrapper.setProps({ visible: false })
        } else expect(state.launcher.drawerOpen).toBe(false)
        await settle()
        expect(document.activeElement).toBe(opener)
      } finally {
        window.removeEventListener('keydown', escaped)
      }
    })

    it.each([0, 1])('leaves Tab/Shift+Tab to a foreign dialog at the same/higher layer (delta=%s)', async delta => {
      const wrapper = consumer.open(); await settle()
      const container = document.body.querySelector<HTMLElement>(consumer.container)!
      const overlay = document.body.querySelector<HTMLElement>(consumer.overlay)!
      const foreign = document.createElement('div')
      foreign.setAttribute('role', 'dialog')
      foreign.setAttribute('aria-modal', 'true')
      foreign.style.position = 'fixed'
      foreign.style.zIndex = String(Number.parseInt(getComputedStyle(overlay).zIndex, 10) + delta)
      const control = document.createElement('button')
      foreign.append(control)
      document.body.append(foreign)
      control.focus()
      for (const reverse of [false, true]) {
        expect(key(control, reverse).defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(control)
      }
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      control.dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(control)
      expect(wrapper.emitted('update:visible')).toBeUndefined()
      if (consumer.name === 'AppDrawer') expect(state.launcher.drawerOpen).toBe(true)
      foreign.remove()
      boundaries(container).first.focus()
      expectWrapped(container)
    })
  })
}

describe('registered overlay stack with ancestor dialog consumers', () => {
  it.each(['Escape', 'cancel', 'confirm', 'backdrop'])('restores the drawer control after closing ConfirmDialog via %s', async method => {
    openDrawer(); await settle()
    const drawer = document.body.querySelector<HTMLElement>('.app-drawer')!
    const drawerOpener = drawer.querySelector<HTMLInputElement>('input')!
    drawerOpener.focus()
    const confirm = openConfirm(); await settle()
    const modal = document.body.querySelector<HTMLElement>('.confirm-modal')!
    expect(document.activeElement).toBe(boundaries(modal).first)
    if (method === 'Escape') {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    } else if (method === 'backdrop') {
      document.body.querySelector<HTMLElement>('.confirm-overlay')!.click()
    } else {
      modal.querySelector<HTMLButtonElement>(method === 'cancel' ? '.cancel' : '.ok')!.click()
    }
    expect(confirm.emitted('update:visible')).toEqual([[false]])
    // Model the parent applying the production v-model update.
    await confirm.setProps({ visible: false }); await settle()
    expect(state.launcher.drawerOpen).toBe(true)
    expect(document.activeElement).toBe(drawerOpener)
    boundaries(drawer).first.focus()
    expectWrapped(drawer)
  })

  it('focuses the remaining drawer when ConfirmDialog opened before it and its opener is behind the stack', async () => {
    const confirm = openConfirm(); await settle()
    openDrawer(); await settle()
    const drawer = document.body.querySelector<HTMLElement>('.app-drawer')!
    await confirm.setProps({ visible: false }); await settle()
    expect(document.activeElement).toBe(boundaries(drawer).first)
    expect(document.activeElement).not.toBe(opener)
    expectWrapped(drawer)
  })

  it.each([true, false])('keeps the higher ConfirmDialog isolated regardless of activation order (confirmFirst=%s)', async confirmFirst => {
    if (!confirmFirst) { openDrawer(); await settle() }
    openConfirm(); await settle()
    const modal = document.body.querySelector<HTMLElement>('.confirm-modal')!
    const first = boundaries(modal).first
    if (confirmFirst) { openDrawer(); await settle() }
    expect(getComputedStyle(document.body.querySelector('.confirm-overlay')!).zIndex).toBe('10002')
    expect(getComputedStyle(document.body.querySelector('.app-drawer-veil')!).zIndex).toBe('9000')
    expect(document.activeElement).toBe(first)
    expectWrapped(modal)
    state.launcher.setDrawer(false); await settle()
    expect(document.activeElement).toBe(first)
    expectWrapped(modal)
  })
})
