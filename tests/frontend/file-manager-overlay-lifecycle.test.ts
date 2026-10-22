// CyberManju OS — FileManager overlay lifecycle integration regressions.
// Role: exercise Files dialogs through real shell visibility and keyboard transitions.
// Exports: none.
// Integrates: DesktopShell, AppWindow, FileManager, useWindowManager, useShortcuts, happy-dom.
// Contracts: backend IO and unrelated chrome are mocked; panel/dialog instances stay real.
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import DesktopShell from '@/components/DesktopShell.vue'
import FileManager from '@/components/FileManager.vue'
import { useWindowManager } from '@/composables/useWindowManager'
import { useShortcuts } from '@/composables/useShortcuts'
import { defaultKpl, defaultKpd } from '@/keymaps'

const state = vi.hoisted(() => ({ store: null as any }))
vi.mock('@/stores/app', () => ({ useAppStore: () => state.store }))
vi.mock('@/composables/useTauri', () => ({ invoke: vi.fn(async () => []), isTauri: () => false, isAndroidApp: () => false }))
vi.mock('@/composables/useTheme', () => ({ useTheme: () => ({ settings: reactive({ glow: false, wallpaper: 'slopes-dark', density: 'comfortable', motion: 'reduced' }), shellStyle: ref('macos'), themeId: ref('default') }) }))
vi.mock('@/composables/useCustomWallpaper', () => ({ useCustomWallpaper: () => ({ source: ref(null), load: vi.fn(), imageFailed: vi.fn() }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@/components/MobileLauncher.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/TopMenuBar.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/Dock.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/StatusBar.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/PlasmaPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/KickoffMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/ShellShortcutDock.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/WindowContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/TerminalPanel.vue', () => ({ default: { template: '<div>Terminal fixture</div>' } }))

const wm = useWindowManager()
const roots: ReturnType<typeof mount>[] = []
const settle = async () => { await flushPromises(); await nextTick(); await nextTick() }
const key = (target: Element, name: string, altKey = false) => {
  const event = new KeyboardEvent('keydown', { key: name, altKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
function host() {
  // Same dispatcher, shipped keymaps and handler wiring as App.vue.
  const Harness = defineComponent({ setup() {
    const shortcuts = useShortcuts(defaultKpl, defaultKpd)
    shortcuts.on('overview_toggle', () => wm.toggleOverview())
    return () => h(DesktopShell)
  } })
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: { UiTrafficLights: true, UiTitlebarButtons: true } } })
  roots.push(wrapper)
  return wrapper
}
async function openDialog(kind: 'folder' | 'rename') {
  const wrapper = host()
  const shortcut = wrapper.findAll('.desktop-shortcut').find(button => button.text() === 'Files')!
  await shortcut.trigger('click'); await settle()
  const fileManager = wrapper.findComponent(FileManager)
  expect(fileManager.exists()).toBe(true)
  if (kind === 'folder') await fileManager.get('button[title="New folder"]').trigger('click')
  else {
    state.store.selectedFileId = 'file-one'
    await nextTick()
    await fileManager.get('.fm').trigger('keydown', { key: 'F2' })
  }
  await settle()
  const input = document.body.querySelector<HTMLInputElement>(kind === 'folder' ? '[aria-label="Folder name"]' : '[aria-label="New name"]')!
  expect(document.activeElement).toBe(input)
  input.value = 'draft preserved'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const overlay = input.closest('.fm-ov') as HTMLElement
  const button = overlay.querySelectorAll<HTMLButtonElement>('button')[1]!
  button.focus()
  return { wrapper, fileManager, input, overlay, button, win: wm.windows.value[0]! }
}
function expectSuspended(overlay: HTMLElement) {
  const hiddenWindow = overlay.closest<HTMLElement>('[data-shell-window-id]')
  expect(hiddenWindow).not.toBeNull()
  expect(hiddenWindow!.hasAttribute('inert')).toBe(true)
  let hidden = false
  for (let element: HTMLElement | null = overlay; element; element = element.parentElement) {
    if (getComputedStyle(element).display === 'none') hidden = true
  }
  expect(hidden).toBe(true)
  expect(overlay.contains(document.activeElement)).toBe(false)
}
beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
  wm.closeAll(); wm.setLayoutMode('floating'); wm.stripLine.value = 0
  const file = { id: 'file-one', name: 'notes.txt', path: '/notes.txt', fileType: 'text', size: 10, tags: [], modifiedAt: 0 }
  state.store = reactive({
    currentPath: '/', viewMode: 'grid', files: [file], selectedFileId: null, selectedFileIds: [], isMultiSelect: false,
    get selectedFile() { return this.selectedFileId === file.id ? file : null },
    collections: [], syncConfigs: [], disks: [], faceGroups: [], starredFiles: [], shareLinks: [], fileVersions: [], osDf: [],
    compressionStats: null, parseResult: null, isLoading: false, searchQuery: '', shellBusy: false,
    fetchFiles: vi.fn(async () => []), fetchOsDf: vi.fn(), fetchSyncConfigs: vi.fn(), fetchDisks: vi.fn(), fetchCollections: vi.fn(),
    fetchEncryptionStatus: vi.fn(), fetchFileVersions: vi.fn(), fetchShareLinks: vi.fn(), notifyError: vi.fn(), notifySuccess: vi.fn(),
    createFolder: vi.fn(), renameFile: vi.fn(),
  })
})
afterEach(() => {
  for (const wrapper of roots.splice(0)) wrapper.unmount()
  wm.closeAll(); document.body.innerHTML = ''
})

describe('FileManager teleported overlays follow the persistent shell window', () => {
  it.each(['folder', 'rename'] as const)('%s: Files → dialog button → Alt+O suspends interaction, selection restores draft and focus', async kind => {
    const ui = await openDialog(kind)
    const instance = ui.fileManager.vm.$
    expect(ui.overlay.closest('.app-window')).toBeNull()
    expect(key(ui.button, 'o', true).defaultPrevented).toBe(true)
    await settle()
    expect(wm.shellLayoutMode.value).toBe('overview')
    expectSuspended(ui.overlay)
    const overview = ui.wrapper.get('.desktop-overview')
    expect(document.activeElement).toBe(overview.element)
    const card = ui.wrapper.get('.overview-card')
    ;(card.element as HTMLElement).focus()
    expect(document.activeElement).toBe(card.element)
    key(card.element, 'Tab')
    expect(ui.overlay.contains(document.activeElement)).toBe(false)
    await card.trigger('click'); await settle()
    expect(wm.shellLayoutMode.value).toBe('floating')
    expect(ui.wrapper.findComponent(FileManager).vm.$).toBe(instance)
    expect(document.body.querySelector('.fm-ov')).toBe(ui.overlay)
    expect(ui.overlay.closest('.app-window')).toBeNull()
    expect(ui.input.value).toBe('draft preserved')
    expect(document.activeElement).toBe(ui.button)
    expect(state.store.createFolder).not.toHaveBeenCalled()
    expect(state.store.renameFile).not.toHaveBeenCalled()
    ui.overlay.querySelector<HTMLButtonElement>('button')!.click(); await settle()
    expect(document.body.querySelector('.fm-ov')).toBeNull()
  })

  it.each(['folder', 'rename'] as const)('%s: minimize and strip-line hiding preserve the same dialog nodes', async kind => {
    const ui = await openDialog(kind)
    wm.minimize(ui.win.id); await settle()
    expectSuspended(ui.overlay)
    wm.restore(ui.win.id); await settle()
    expect(ui.overlay.closest('.app-window')).toBeNull()
    expect(document.activeElement).toBe(ui.button)
    wm.setLayoutMode('strip'); await settle()
    wm.stripLine.value = (ui.win.line ?? 0) + 1; await settle()
    expectSuspended(ui.overlay)
    wm.stripLine.value = ui.win.line ?? 0; await settle()
    expect(ui.overlay.closest('.app-window')).toBeNull()
    expect(ui.input.value).toBe('draft preserved')
    expect(document.activeElement).toBe(ui.button)
    wm.close(ui.win.id); await settle()
    expect(document.body.querySelector('.fm-ov')).toBeNull()
  })

  it('Escape from Overview resumes the original dialog, while selecting another window does not steal focus', async () => {
    const ui = await openDialog('folder')
    key(ui.button, 'o', true); await settle()
    key(ui.wrapper.get('.desktop-overview').element, 'Escape'); await settle()
    expect(document.activeElement).toBe(ui.button)
    wm.open('terminal'); await settle()
    // The visible Files dialog is not incorrectly suspended merely by losing focus.
    expect(ui.overlay.closest('.app-window')).toBeNull()
    ui.button.focus(); key(ui.button, 'o', true); await settle()
    const otherCard = ui.wrapper.findAll('.overview-card').find(card => card.text().includes('CYBSH'))!
    await otherCard.trigger('click'); await settle()
    expect(ui.overlay.contains(document.activeElement)).toBe(false)
  })
})
