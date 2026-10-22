// CyberManju OS — Upload and messages modal keyboard regressions.
// Role: mount production modal components and exercise the real focus trap in a DOM.
// Exports: none.
// Integrates: Vue Test Utils, happy-dom, useFocusTrap.
// Contracts: no file selection, upload, send, or backend IO occurs.
// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive } from 'vue'
import FileUploadDialog from '../../src/components/FileUploadDialog.vue'
import MessagesHub from '../../src/components/MessagesHub.vue'

const state = vi.hoisted(() => ({ launcher: null as any }))
vi.mock('@/stores/launcher', () => ({ useLauncherStore: () => state.launcher }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ currentPath: '/', fetchFiles: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn() }) }))
vi.mock('@/composables/useTauri', () => ({ invoke: vi.fn(async () => []), isTauri: () => false, isAndroidApp: () => false }))
vi.mock('@/composables/useMessages', () => ({ useMessages: () => ({ supported: false, unread: { value: 0 }, notifState: { value: null }, socialApps: { value: [] }, status: { value: 'ready' }, lastError: { value: null }, messages: { value: [] }, refresh: vi.fn(async () => []), refreshSocial: vi.fn(async () => []), markSeen: vi.fn(), clear: vi.fn(), openSettings: vi.fn() }) }))
vi.mock('@/composables/useAndroidApps', () => ({ useAndroidApps: () => ({ openApp: vi.fn() }) }))
vi.mock('@/composables/useNotifications', () => ({ useNotifications: () => ({ history: { value: [] }, unreadCount: { value: 0 }, markRead: vi.fn(), markAllRead: vi.fn(), clearHistory: vi.fn() }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: defineComponent({ template: '<span aria-hidden="true" />' }) }))

// Vitest does not inject SFC style blocks; use the actual production rules,
// rather than invented z-indices or treating a layoutless DOM as Chromium.
beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = ['FileUploadDialog', 'MessagesHub'].flatMap(name =>
    parse(readFileSync(`src/components/${name}.vue`, 'utf8')).descriptor.styles.map(block => block.content),
  ).join('\n')
  document.head.append(style)
})
const roots: Array<ReturnType<typeof mount>> = []
let opener: HTMLButtonElement
beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  state.launcher = reactive({ messagesOpen: false, centerTab: 'messages', overrides: {}, messagesSeenAt: 0, setMessagesOpen(open: boolean) { this.messagesOpen = open }, markMessagesSeen() {} })
  opener = document.createElement('button'); opener.textContent = 'Open dialog'; document.body.append(opener); opener.focus()
})
afterEach(() => { for (const wrapper of roots.splice(0)) wrapper.unmount(); document.body.innerHTML = '' })
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 65)); await nextTick() }
function key(target: Element, keyName: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: keyName, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
function openUpload(visible = true) {
  const wrapper = mount(FileUploadDialog, { attachTo: document.body, props: { visible } }); roots.push(wrapper); return wrapper
}
function openMessages() {
  state.launcher.messagesOpen = true
  const wrapper = mount(MessagesHub, { attachTo: document.body }); roots.push(wrapper); return wrapper
}

describe('production upload and messages modal keyboard behavior', () => {
  it('moves initial focus to upload dialog, exposes labelled semantics and excludes display:none file input', async () => {
    const wrapper = openUpload(); await settle()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog.querySelector('button'))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent).toBe('FILE UPLOAD')
    const hiddenInput = dialog.querySelector('input[type=file]')!
    expect(getComputedStyle(hiddenInput).display).toBe('none')
    const choose = dialog.querySelector('.file-picker-button')!
    ;(choose as HTMLElement).focus()
    expect(key(choose, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog.querySelector('button'))
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('traps Tab boundaries and redirects outside focus into the upload modal', async () => {
    openUpload(); await settle()
    const dialog = document.body.querySelector('[role="dialog"]')!
    const buttons = [...dialog.querySelectorAll('button')]
    const first = buttons[0], last = buttons.at(-1)!
    last.focus(); const forward = key(last, 'Tab')
    expect(forward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
    first.focus(); const reverse = key(first, 'Tab', true)
    expect(reverse.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
    opener.focus(); expect(document.activeElement).not.toBe(opener)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape emits close and click/backdrop close restore the connected opener', async () => {
    const wrapper = openUpload(); await settle()
    const dialog = document.body.querySelector('[role="dialog"]')!
    const event = key(dialog, 'Escape')
    expect(event.defaultPrevented).toBe(true); expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount(); roots.splice(roots.indexOf(wrapper), 1); opener.focus();
    const next = openUpload(); await settle()
    ;(document.body.querySelector('.upload-overlay') as HTMLElement).click()
    expect(next.emitted('close')).toHaveLength(1)
    next.unmount(); roots.splice(roots.indexOf(next), 1)
    expect(document.activeElement).toBe(opener)
  })

  it('keeps initially-open and opener-removed lifecycle safe', async () => {
    const wrapper = openUpload(true); await settle()
    expect(document.activeElement).toBe(document.body.querySelector('.upload-close'))
    opener.remove()
    wrapper.setProps({ visible: false }); await settle()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).not.toBe(opener)
  })

  it('opens MessagesHub with focus, dialog semantics, close state and opener restoration', async () => {
    const wrapper = openMessages(); await settle()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog.querySelector('button'))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Messages')
    const event = key(dialog, 'Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(state.launcher.messagesOpen).toBe(false)
    await flushPromises(); await settle()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })

  it('contains Messages Tab/Shift+Tab, recovers background focus, and restores on button/backdrop close', async () => {
    openMessages(); await settle()
    const dialog = document.body.querySelector('.msg-veil') as HTMLElement
    const buttons = [...dialog.querySelectorAll('button')]
    const first = buttons[0], last = buttons.at(-1)!
    last.focus()
    expect(key(last, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(key(first, 'Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    opener.focus()
    expect(document.activeElement).toBe(first)
    first.click(); await settle()
    expect(state.launcher.messagesOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
    state.launcher.messagesOpen = true; await settle()
    ;(document.body.querySelector('.msg-veil') as HTMLElement).click(); await settle()
    expect(state.launcher.messagesOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('does not let the lower-z upload overlay steal focus or Escape from messages', async () => {
    state.launcher.messagesOpen = true
    const messages = openMessages(); await settle()
    const upload = openUpload(true); await settle()
    const msg = document.body.querySelector('.msg-veil') as HTMLElement
    const up = document.body.querySelector('.upload-overlay') as HTMLElement
    expect(Number.parseInt(getComputedStyle(msg).zIndex)).toBe(9400)
    expect(Number.parseInt(getComputedStyle(up).zIndex)).toBe(200)
    expect(document.activeElement).toBe(msg.querySelector('button'))
    key(msg, 'Escape')
    expect(state.launcher.messagesOpen).toBe(false)
    expect(upload.emitted('close')).toBeUndefined()
    await settle()
    expect(document.activeElement).toBe(document.body.querySelector('.upload-close'))
    upload.unmount(); messages.unmount()
  })

  it('defers to a teleported higher dialog, and closing a lower overlay does not restore behind it', async () => {
    openUpload(); await settle()
    const top = document.createElement('div'); top.setAttribute('role', 'dialog'); top.style.position = 'fixed'; top.style.zIndex = '99999'
    const control = document.createElement('button'); top.append(control); document.body.append(top); control.focus()
    // A newly active lower overlay cannot steal focus from the already higher dialog.
    const upload = openUpload(true); await settle()
    expect(document.activeElement).toBe(control)
    upload.setProps({ visible: false }); await settle()
    expect(document.activeElement).toBe(control)
    top.remove()
  })
})
