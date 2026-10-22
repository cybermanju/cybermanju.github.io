// @vitest-environment happy-dom
// CyberManju OS — ContextMenu mobile interaction regressions.
// Role: exercise real menu focus, action alignment, scrolling and viewport positioning.
// Integrates: Vue Test Utils, happy-dom and the production context-menu registry.
// Contracts: disabled items and separators cannot activate; submenus preserve parent focus.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ContextMenu from '@/components/ContextMenu.vue'
import { useContextMenu } from '@/composables/useContextMenu'

vi.mock('@/components/AppIcon.vue', () => ({
  default: { template: '<span />', props: ['name', 'size'] },
}))
const ctx = useContextMenu()
const mounts: ReturnType<typeof mount>[] = []
function launch(items: any[]) {
  ctx.resetRegistry()
  ctx.registerContext('test', items)
  const event = new MouseEvent('contextmenu', {
    clientX: 150,
    clientY: 300,
    bubbles: true,
    cancelable: true,
  })
  ctx.open(event, 'test')
  const wrapper = mount(ContextMenu, {
    attachTo: document.body,
    global: { stubs: { Transition: true } },
  })
  mounts.push(wrapper)
  return wrapper
}
afterEach(() => {
  mounts.splice(0).forEach((w) => w.unmount())
  ctx.close()
  document.body.innerHTML = ''
})

describe('ContextMenu mobile interaction', () => {
  it('skips disabled rows and separators for roving keyboard focus and actions', async () => {
    const action = vi.fn()
    const w = launch([
      { id: 'off', label: 'Disabled', disabled: true },
      { id: 'sep', divider: true, label: '' },
      { id: 'go', label: 'Go', action },
      { id: 'last', label: 'Last', action },
    ])
    await nextTick()
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement?.textContent).toContain('Go')
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    expect(action).toHaveBeenCalledOnce()
  })
  it('moves real focus into submenu, supports Home/End and returns focus to parent on Left', async () => {
    const w = launch([
      {
        id: 'parent',
        label: 'Parent',
        submenu: [
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ],
      },
    ])
    await nextTick()
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(document.activeElement?.textContent).toContain('Alpha')
    const sub = document.querySelector('.ctx-submenu') as HTMLElement
    sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    await nextTick()
    expect(document.activeElement?.textContent).toContain('Beta')
    sub.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(document.activeElement?.textContent).toContain('Parent')
  })
  it.each(['ArrowDown', 'ArrowUp'])('restores parent focus after hover closes a focused submenu, then handles %s and Enter', async (key) => {
    const action = vi.fn()
    const renameAction = vi.fn()
    const collectionAction = vi.fn()
    launch([
      {
        id: 'collection',
        label: 'Add to collection…',
        submenu: [{ id: 'choice', label: 'Collection', action: collectionAction }],
      },
      { id: 'hovered', label: 'Rename', action: renameAction },
      { id: 'sep', label: '', divider: true },
      { id: 'disabled', label: 'Unavailable', disabled: true },
      { id: 'action', label: 'Compress', action },
    ])
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    const rows = menu.querySelectorAll<HTMLElement>('.ctx-item')
    rows[0].dispatchEvent(new MouseEvent('mouseenter'))
    await flushPromises()
    const submenu = document.querySelector('.ctx-submenu') as HTMLElement
    expect(submenu.contains(document.activeElement)).toBe(true)

    submenu.dispatchEvent(new PointerEvent('pointerleave'))
    rows[0].dispatchEvent(new MouseEvent('mouseleave'))
    const hovered = rows[key === 'ArrowDown' ? 1 : 3]
    hovered.dispatchEvent(new MouseEvent('mouseenter'))
    await flushPromises()
    expect(document.querySelector('.ctx-submenu')).toBeNull()
    expect(document.activeElement).toBe(hovered)

    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(document.activeElement).toBe(rows[key === 'ArrowDown' ? 3 : 1])
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    expect(collectionAction).not.toHaveBeenCalled()
    expect(ctx.state.visible).toBe(false)
    expect(action).toHaveBeenCalledTimes(key === 'ArrowDown' ? 1 : 0)
    expect(renameAction).toHaveBeenCalledTimes(key === 'ArrowUp' ? 1 : 0)
  })
  it('clamps against viewport and constrains long mobile menus for internal scrolling', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })
    const w = launch(Array.from({ length: 24 }, (_, i) => ({ id: `${i}`, label: `Action ${i}` })))
    await nextTick()
    await nextTick()
    const menu = document.querySelector('.ctx-menu') as HTMLElement
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(menu.style.left) + menu.getBoundingClientRect().width).toBeLessThanOrEqual(
      390,
    )
    expect(
      parseFloat(menu.getAttribute('style')?.match(/max-height:\s*([^;]+)/)?.[1] || ''),
    ).toBeLessThanOrEqual(667)
  })
  it('keeps Down and Enter aligned to the fifth enabled action (Compress, not Encrypt)', async () => {
    const encrypt = vi.fn(),
      compress = vi.fn()
    const entries = [
      { id: 'open', label: 'Open' },
      { id: 'disabled', label: 'Unavailable', disabled: true },
      { id: 'divider', label: '', divider: true },
      { id: 'rename', label: 'Rename' },
      { id: 'copy', label: 'Copy' },
      { id: 'encrypt', label: 'Encrypt', action: encrypt },
      { id: 'compress', label: 'Compress', action: compress },
    ]
    const w = launch(entries)
    await nextTick()
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    for (let i = 0; i < 5; i++)
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    expect(compress).toHaveBeenCalledOnce()
    expect(encrypt).not.toHaveBeenCalled()
  })
  it('Escape from a submenu after a divider returns focus to its parent and internal scroll stays open', async () => {
    const w = launch([
      {
        id: 'parent',
        label: 'Parent',
        submenu: [
          { id: 'sep', label: '', divider: true },
          { id: 'choice', label: 'Choice' },
        ],
      },
    ])
    await nextTick()
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    )
    await nextTick()
    await flushPromises()
    const submenu = document.querySelector('.ctx-submenu') as HTMLElement
    expect(document.activeElement?.textContent).toContain('Choice')
    submenu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(document.activeElement?.textContent).toContain('Parent')
    menu.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(ctx.state.visible).toBe(true)
  })
  it('positions a measured submenu within 390px viewport bounds', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 })
    const w = launch([
      { id: 'parent', label: 'Parent', submenu: [{ id: 'choice', label: 'Choice' }] },
    ])
    await nextTick()
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    const parent = menu.querySelector('.ctx-item') as HTMLElement
    parent.getBoundingClientRect = () => ({
      left: 150,
      right: 340,
      top: 150,
      bottom: 194,
      width: 190,
      height: 44,
      x: 150,
      y: 150,
      toJSON() {},
    })
    Object.defineProperty(parent, 'offsetWidth', { configurable: true, value: 190 })
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    )
    await nextTick()
    await flushPromises()
    const submenu = document.querySelector('.ctx-submenu') as HTMLElement
    Object.defineProperty(submenu, 'offsetWidth', { configurable: true, value: 190 })
    Object.defineProperty(submenu, 'offsetHeight', { configurable: true, value: 100 })
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    const bounds = submenu.style
    expect(parseFloat(bounds.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(bounds.left) + 190).toBeLessThanOrEqual(390)
    expect(parseFloat(bounds.top)).toBeGreaterThanOrEqual(0)
  })

  it('remeasures a wide submenu before choosing its side and respects safe insets', async () => {
    const originalGetStyle = window.getComputedStyle.bind(window)
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if ((element as HTMLElement).style.visibility === 'hidden') {
        return {
          paddingTop: '24px',
          paddingRight: '20px',
          paddingBottom: '34px',
          paddingLeft: '16px',
        } as CSSStyleDeclaration
      }
      return originalGetStyle(element)
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 })
    launch([
      {
        id: 'parent',
        label: 'Parent',
        submenu: [{ id: 'choice', label: 'A very long collection name' }],
      },
    ])
    await flushPromises()
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    const parent = menu.querySelector('.ctx-item') as HTMLElement
    parent.getBoundingClientRect = () => ({
      left: 400,
      right: 600,
      top: 300,
      bottom: 344,
      width: 200,
      height: 44,
      x: 400,
      y: 300,
      toJSON() {},
    })
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    const submenu = document.querySelector('.ctx-submenu') as HTMLElement
    Object.defineProperty(submenu, 'offsetWidth', { configurable: true, value: 300 })
    Object.defineProperty(submenu, 'offsetHeight', { configurable: true, value: 609 })
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(submenu.style.left).toBe('100px')
    expect(submenu.style.top).toBe('24px')
    expect(submenu.style.maxHeight).toBe('609px')
    expect(menu.style.maxHeight).toBe('609px')
    styleSpy.mockRestore()
  })
})
