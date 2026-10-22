// CyberManju OS — Window manager lifecycle (tests/frontend/window-manager-lifecycle.test.ts).
// Role: Guard panel identity, alias restore and active strip-row keyboard focus.
// Exports: Vitest regression suite.
// Integrates: useWindowManager shared state.
// Contracts: Hidden windows remain alive but cannot receive shell keyboard actions.
import { afterEach, describe, expect, it } from 'vitest'
import { useWindowManager } from '@/composables/useWindowManager'

describe('window manager lifecycle', () => {
  const manager = useWindowManager()

  afterEach(() => {
    manager.closeAll()
    manager.shellLayoutMode.value = 'floating'
    manager.stripLine.value = 0
    manager.stripOffset.value = 0
  })

  it('reopens a minimized canonical panel in place and preserves alias and caller props', () => {
    const original = manager.open('files', { source: 'first', retained: true })
    const instance = manager.windows.value[0]
    const component = instance.component
    manager.minimize(original)

    const reopened = manager.open('preview', { source: 'alias', custom: 42 })

    expect(reopened).toBe(original)
    expect(manager.windows.value).toHaveLength(1)
    expect(manager.windows.value[0]).toBe(instance)
    expect(manager.windows.value[0].component).toBe(component)
    expect(manager.windows.value[0]).toMatchObject({
      id: original,
      minimized: false,
      panelType: 'files',
      props: { source: 'alias', retained: true, custom: 42, inspector: true, inspTab: 'info' },
    })
    expect(manager.activeWindow.value?.id).toBe(original)
  })

  it('restores strip focus to the window line and its column offset', () => {
    manager.setLayoutMode('strip')
    const first = manager.open('files')
    manager.stripLine.value = 1
    const target = manager.open('terminal')
    manager.stripLine.value = 0

    manager.restore(target)
    expect(manager.stripLine.value).toBe(1)
    expect(manager.stripOffset.value).toBe(0)
    expect(manager.activeWindow.value?.id).toBe(target)

    manager.focus(first)
    expect(manager.stripLine.value).toBe(0)
    expect(manager.stripOffset.value).toBe(0)
  })

  it('line navigation selects the nearest available column and cycles only active-line windows', () => {
    manager.setLayoutMode('strip')
    const lineZeroA = manager.open('files')
    const lineZeroB = manager.open('terminal')
    manager.stripLine.value = 1
    const lineOneA = manager.open('settings')
    const lineOneB = manager.open('disks')
    manager.focus(lineOneB)

    manager.stripLineMove(-1)
    expect(manager.activeWindow.value?.id).toBe(lineZeroB)
    expect(manager.stripOffset.value).toBe(1)

    manager.focusNext()
    expect(manager.activeWindow.value?.id).toBe(lineZeroA)
    expect(manager.stripLine.value).toBe(0)

    manager.minimize(lineZeroB)
    manager.focusNext()
    expect(manager.activeWindow.value?.id).toBe(lineZeroA)
    expect(manager.stripWindows.value.map(win => win.id)).toEqual([lineZeroA])
    expect(manager.windows.value.map(win => win.id)).toEqual([lineZeroA, lineZeroB, lineOneA, lineOneB])
  })

  it('does not target hidden rows with focused-window keyboard actions', () => {
    manager.setLayoutMode('strip')
    const first = manager.open('files')
    manager.stripLine.value = 1
    const second = manager.open('terminal')
    manager.minimize(second)
    manager.focus(first)
    manager.stripLineMove(1)

    expect(manager.stripLine.value).toBe(1)
    expect(manager.activeWindow.value).toBeNull()
    manager.closeFocused()
    manager.minimizeFocused()
    expect(manager.windows.value.map(win => win.id)).toEqual([first, second])
    expect(manager.windows.value[0].minimized).toBe(false)
  })

  it('clamps the strip viewport after minimizing the last column', () => {
    manager.setLayoutMode('strip')
    const first = manager.open('files')
    const last = manager.open('terminal')
    expect(manager.stripOffset.value).toBe(1)

    manager.minimize(last)
    expect(manager.stripOffset.value).toBe(0)
    expect(manager.stripWindows.value.map(win => win.id)).toEqual([first])
    manager.restore(last)
    expect(manager.stripOffset.value).toBe(1)
    manager.minimizeAll()
    expect(manager.stripOffset.value).toBe(0)
  })
})
