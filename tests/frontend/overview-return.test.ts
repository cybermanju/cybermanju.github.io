// CyberManju OS — Overview return regressions (tests/frontend/overview-return.test.ts).
// Role: Execute real overview entry/exit handlers and guard layout state restoration.
// Exports: Vitest regression suite.
// Integrates: Vue SFC compiler, TypeScript AST, shared useWindowManager.
// Contracts: Overview is transient; returning preserves window identity and geometry.
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useWindowManager } from '@/composables/useWindowManager'

const root = resolve(__dirname, '../..')
const wm = useWindowManager()
const stateFields = ['x', 'y', 'width', 'height', 'column', 'line', 'zIndex'] as const

type EntryPoint = 'gesture' | 'shortcut' | 'dock' | 'shell-exit' | 'cycle'

function scriptOf(file: string): ts.SourceFile {
  const source = readFileSync(resolve(root, file), 'utf8')
  const parsed = parse(source, { filename: file })
  if (!parsed.descriptor.script && !parsed.descriptor.scriptSetup) throw new Error(`No script in ${file}`)
  const script = parsed.descriptor.scriptSetup?.content ?? parsed.descriptor.script!.content
  return ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function arrow(node: ts.Node | undefined): node is ts.ArrowFunction {
  return !!node && ts.isArrowFunction(node)
}

function extracted(expression: ts.ArrowFunction): (wm: ReturnType<typeof useWindowManager>) => unknown {
  const text = expression.getText()
  return new Function('wm', `return (${text})`)(wm) as (wm: ReturnType<typeof useWindowManager>) => unknown
}

function appHandler(kind: 'gesture' | 'shortcut'): (wm: ReturnType<typeof useWindowManager>) => unknown {
  const source = scriptOf('src/App.vue')
  let found: ts.ArrowFunction | undefined
  const visit = (node: ts.Node) => {
    if (kind === 'gesture' && ts.isPropertyAssignment(node) && node.name.getText() === 'overview_toggle' && arrow(node.initializer)) found = node.initializer
    if (kind === 'shortcut' && ts.isCallExpression(node) && node.expression.getText() === 'shortcuts.on' && node.arguments[0]?.getText().replace(/['"`]/g, '') === 'overview_toggle' && arrow(node.arguments[1])) found = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error(`Could not find App.vue ${kind} overview_toggle arrow`)
  return extracted(found)
}

function dockHandler(): (wm: ReturnType<typeof useWindowManager>) => unknown {
  const source = scriptOf('src/components/ShellShortcutDock.vue')
  let found: ts.ArrowFunction | undefined
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'overview_toggle' && arrow(node.initializer)) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error('Could not find ShellShortcutDock.vue overview_toggle arrow')
  return extracted(found)
}

function shellExitHandler(): (wm: ReturnType<typeof useWindowManager>) => unknown {
  const source = scriptOf('src/components/DesktopShell.vue')
  let method: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'leaveOverview') method = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!method?.body) throw new Error('Could not find DesktopShell.vue leaveOverview method')
  // Execute the real function with focus scheduling stubbed; focus restoration is not DOM-tested.
  const transpiled = ts.transpile(method.getText(), { target: ts.ScriptTarget.ES2022 })
  return new Function('wm', 'nextTick', 'overviewReturnFocus', 'focusWindowSurface', `return (${transpiled})`)(
    wm, () => undefined, null, () => undefined,
  ) as (wm: ReturnType<typeof useWindowManager>) => unknown
}

const entries: Record<EntryPoint, () => (wm: ReturnType<typeof useWindowManager>) => unknown> = {
  gesture: () => appHandler('gesture'),
  shortcut: () => appHandler('shortcut'),
  dock: dockHandler,
  'shell-exit': shellExitHandler,
  cycle: () => (manager) => manager.cycleLayout(),
}

function openStripFixture() {
  wm.setLayoutMode('strip')
  const ids = ['files', 'terminal', 'settings'].map(panel => wm.open(panel as 'files' | 'terminal' | 'settings'))
  wm.windows.value.forEach((win, index) => {
    // Custom positions and sparse columns detect accidental cascade/resequence,
    // even if the return-mode assertion alone happens to remain correct.
    Object.assign(win, { x: 321 + index * 487, y: 24, width: 468, height: 640, column: index * 2 + 1 })
  })
  wm.stripLine.value = 0
  wm.stripOffset.value = 1
  wm.focus(ids[1])
  wm.stripOffset.value = 1
  return ids
}

function snapshot() {
  return {
    windows: wm.windows.value.map(win => ({ ref: win, id: win.id, panelType: win.panelType, minimized: win.minimized,
      ...Object.fromEntries(stateFields.map(field => [field, win[field]])) })),
    stripOffset: wm.stripOffset.value,
    stripLine: wm.stripLine.value,
  }
}

function expectRestored(before: ReturnType<typeof snapshot>) {
  expect(wm.windows.value).toHaveLength(before.windows.length)
  before.windows.forEach((saved, index) => {
    const current = wm.windows.value[index]
    expect(current).toBe(saved.ref)
    expect(current.id).toBe(saved.id)
    expect(current.panelType).toBe(saved.panelType)
    expect(current.minimized).toBe(saved.minimized)
    for (const field of stateFields) expect(current[field]).toBe(saved[field])
  })
  expect(wm.stripOffset.value).toBe(before.stripOffset)
  expect(wm.stripLine.value).toBe(before.stripLine)
}

afterEach(() => {
  wm.closeAll()
  wm.shellLayoutMode.value = 'floating'
  wm.shellAutoTile.value = false
  wm.stripLine.value = 0
  wm.stripOffset.value = 0
  // Reset the transient-return singleton through the public transition contract.
  wm.setLayoutMode('overview')
  wm.exitOverview()
})

describe('overview round-trip regression', () => {
  it.each(['gesture', 'shortcut', 'dock', 'shell-exit', 'cycle'] as const)(
    'preserves strip windows across %s entry/exit', (entry) => {
      const ids = openStripFixture()
      const before = snapshot()
      const invoke = entries[entry]()
      if (entry === 'shell-exit' || entry === 'cycle') wm.setLayoutMode('overview')
      else invoke(wm)
      expect(wm.shellLayoutMode.value).toBe('overview')
      invoke(wm)
      expect(wm.shellLayoutMode.value).toBe('strip')
      expect(wm.windows.value.map(win => win.id)).toEqual(ids)
      expectRestored(before)
    },
  )

  it.each([
    ['floating', false], ['floating', true], ['tiled', false], ['tiled', true],
  ] as const)('returns to %s with autotile=%s and preserves geometry', (mode, autoTile) => {
    wm.shellAutoTile.value = autoTile
    wm.setLayoutMode(mode)
    wm.open('files'); wm.open('terminal'); wm.open('settings')
    wm.windows.value.forEach((win, index) => { win.x += 17 + index; win.height -= 13 })
    const before = snapshot()
    wm.toggleOverview()
    expect(wm.shellLayoutMode.value).toBe('overview')
    wm.toggleOverview()
    expect(wm.shellLayoutMode.value).toBe(mode)
    expectRestored(before)
  })

  it('keeps the first return layout when overview is entered repeatedly', () => {
    wm.setLayoutMode('strip')
    openStripFixture()
    const before = snapshot()
    wm.setLayoutMode('overview')
    wm.setLayoutMode('overview')
    wm.exitOverview()
    expect(wm.shellLayoutMode.value).toBe('strip')
    expectRestored(before)
  })

  it('shares overview return mode between independent useWindowManager consumers', () => {
    wm.setLayoutMode('strip'); openStripFixture()
    const before = snapshot()
    const otherConsumer = useWindowManager()
    wm.setLayoutMode('overview')
    otherConsumer.exitOverview()
    expect(wm.shellLayoutMode.value).toBe('strip')
    expectRestored(before)
  })

  it.each(['floating', 'tiled', 'strip'] as const)('treats explicit %s selection in overview as authoritative', (chosen) => {
    wm.setLayoutMode('strip'); openStripFixture()
    wm.setLayoutMode('overview')
    wm.setLayoutMode(chosen)
    expect(wm.shellLayoutMode.value).toBe(chosen)
    const selected = snapshot()
    wm.exitOverview()
    expect(wm.shellLayoutMode.value).toBe(chosen)
    expectRestored(selected)
  })

  it('makes exitOverview idempotent after restoring the original mode', () => {
    wm.setLayoutMode('strip'); openStripFixture()
    const before = snapshot()
    wm.toggleOverview()
    wm.exitOverview()
    const once = snapshot()
    wm.exitOverview()
    expect(wm.shellLayoutMode.value).toBe('strip')
    expectRestored(before)
    expectRestored(once)
  })
})
