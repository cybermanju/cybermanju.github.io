// CyberManju OS — window input ownership.
// Normal app controls own their keyboard input; overview alone activates a window.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

const source = readFileSync('src/components/AppWindow.vue', 'utf8')

function harness(overview: boolean) {
  const start = source.indexOf('function onOverviewKeydown(')
  const end = source.indexOf('\nfunction getWorkspaceSize(', start)
  const helper = source.slice(start, end)
  const js = ts.transpile(helper, { target: ts.ScriptTarget.ES2022 })
  const onFocus = vi.fn()
  const handle = new Function('isOverview', 'onFocus', `${js}; return onOverviewKeydown`)(
    { value: overview }, onFocus,
  )
  return { handle, onFocus }
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}

describe('AppWindow input ownership', () => {
  it.each(['Enter', ' '])('does not consume %j from normal app content', key => {
    const h = harness(false)
    const event = keyEvent(key)
    h.handle(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(h.onFocus).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' '])('activates an overview window with %j', key => {
    const h = harness(true)
    const event = keyEvent(key)
    h.handle(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(h.onFocus).toHaveBeenCalledOnce()
  })

  it('leaves other overview keys untouched', () => {
    const h = harness(true)
    const event = keyEvent('ArrowDown')
    h.handle(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(h.onFocus).not.toHaveBeenCalled()
  })

  it('keeps normal pointer focus non-cancelling and hit-testing restrictions overview-only', () => {
    expect(source).toContain('@pointerdown="onFocus"')
    expect(source).toContain('@keydown="onOverviewKeydown"')
    expect(source).not.toMatch(/@keydown\.(?:enter|space)\.stop\.prevent/)
    expect(source).toContain(':inert="isOverview"')
    expect(source).toContain('.app-window--overview .window-content,')
  })
})
