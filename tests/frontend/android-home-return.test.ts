// CyberManju OS — Android HOME return (tests/frontend/android-home-return.test.ts).
// Role: Exercise the root HOME handler without mounting unrelated native panels.
// Exports: Vitest suite.
// Integrates: App.vue, launcher overlays, window manager, native readiness contract.
// Contracts: HOME reveals the launcher; ordinary browser events do not mutate UI.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync('src/App.vue', 'utf8')
const handler = source.match(/function handleAndroidHome\(\) \{[\s\S]*?\n\}/)?.[0]
if (!handler) throw new Error('Android HOME handler not found')
function harness(android: boolean) {
  class Element { blur = vi.fn() }
  const focused = new Element()
  const state = {
    isAndroidApp: () => android,
    store: { currentPanel: 'landing', searchQuery: 'old search', commandPaletteOpen: true, showShortcutsHelp: true, createFolderPromptOpen: true },
    showUploadDialog: { value: true }, confirmVisible: { value: true },
    launcher: { setDrawer: vi.fn(), setMessagesOpen: vi.fn() },
    ctx: { close: vi.fn() }, wm: { minimizeAll: vi.fn() },
    document: { activeElement: focused }, HTMLElement: Element,
  }
  runInNewContext(`${handler}; handleAndroidHome()`, state)
  return { ...state, focused }
}
describe('system Android HOME return', () => {
  it('reveals the launcher, clears transient UI, and minimizes rather than destroys sheets', () => {
    const state = harness(true)
    expect(state.store).toEqual({ currentPanel: 'files', searchQuery: '', commandPaletteOpen: false, showShortcutsHelp: false, createFolderPromptOpen: false })
    expect(state.showUploadDialog.value).toBe(false)
    expect(state.confirmVisible.value).toBe(false)
    expect(state.launcher.setDrawer).toHaveBeenCalledWith(false)
    expect(state.launcher.setMessagesOpen).toHaveBeenCalledWith(false)
    expect(state.ctx.close).toHaveBeenCalledOnce()
    expect(state.wm.minimizeAll).toHaveBeenCalledOnce()
    expect(state.focused.blur).toHaveBeenCalledOnce()
  })
  it('does not hijack browser HOME-like events', () => {
    const state = harness(false)
    expect(state.store.currentPanel).toBe('landing')
    expect(state.store.searchQuery).toBe('old search')
    expect(state.wm.minimizeAll).not.toHaveBeenCalled()
    expect(state.focused.blur).not.toHaveBeenCalled()
  })
  it('publishes native readiness after listener registration and removes both on teardown', () => {
    const listener = source.indexOf("window.addEventListener('cybermanju:android-home', handleAndroidHome)")
    const ready = source.indexOf('__CYBERMANJU_HOME_READY__ = true')
    expect(listener).toBeGreaterThan(0)
    expect(ready).toBeGreaterThan(listener)
    expect(source).toContain("window.removeEventListener('cybermanju:android-home', handleAndroidHome)")
    expect(source).toContain('delete (window as unknown as Record<string, unknown>).__CYBERMANJU_HOME_READY__')
  })
})
