// CyberManju OS — Overview strip reflow regressions (tests/frontend/overview-strip-reflow.test.ts).
// Role: Exercise DesktopShell's real reactive layout watchers across overview transitions.
// Exports: Vitest regression suite.
// Integrates: Vue SFC AST extraction, real useWindowManager, strip layout utilities.
// Contracts: Canonical overview exit preserves strip geometry unless structural inputs changed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useWindowManager } from '@/composables/useWindowManager'
import { computeStripRects, stripColumnWidth } from '@/utils/shellLayout'

const root = resolve(__dirname, '../..')
const wm = useWindowManager()
const stateFields = ['x', 'y', 'width', 'height'] as const
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

type Runtime = { scope: ReturnType<typeof effectScope>; host: ReturnType<typeof makeHost>; dockInset: ReturnType<typeof ref<number>>; reflowCount: () => number; resetReflow: () => void; handleViewportResize: () => void }

function makeHost() {
  const host = {
    clientWidth: 1280,
    clientHeight: 800,
    scrollLeft: 0,
    scrollTop: 0,
    scrollTo: vi.fn((position: { left?: number; top?: number }) => {
      if (position.left !== undefined) host.scrollLeft = position.left
      if (position.top !== undefined) host.scrollTop = position.top
    }),
  }
  return host
}

function shellStatements(): { source: ts.SourceFile; declarations: ts.Statement[]; watcherStatements: ts.Statement[] } {
  const parsed = parse(readFileSync(resolve(root, 'src/components/DesktopShell.vue'), 'utf8'), { filename: 'DesktopShell.vue' })
  const script = parsed.descriptor.scriptSetup?.content ?? parsed.descriptor.script?.content
  if (!script) throw new Error('DesktopShell.vue script not found')
  const source = ts.createSourceFile('DesktopShell.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations: ts.Statement[] = []
  const watcherStatements: ts.Statement[] = []
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && ['layoutStripColumns', 'scrollStripIntoView', 'handleViewportResize', 'stripLayoutKey'].includes(statement.name?.text ?? '')) declarations.push(statement)
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(source) === 'stripOverviewLayoutKey')) declarations.push(statement)
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(source) === 'stripLayoutKey')) declarations.push(statement)
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) || statement.expression.expression.getText(source) !== 'watch') continue
    const text = statement.getText(source)
    if (text.includes('shellLayoutMode') || text.includes('stripOffset') || text.includes('dockInset')) watcherStatements.push(statement)
  }
  for (const name of ['layoutStripColumns', 'scrollStripIntoView', 'handleViewportResize']) {
    if (!declarations.some(d => ts.isFunctionDeclaration(d) && d.name?.text === name)) throw new Error(`DesktopShell.vue missing ${name}`)
  }
  if (!watcherStatements.some(s => s.getText(source).includes('shellLayoutMode'))) throw new Error('DesktopShell main layout watcher not found')
  if (!watcherStatements.some(s => s.getText(source).includes('stripOffset'))) throw new Error('DesktopShell strip-offset watcher not found')
  if (!watcherStatements.some(s => s.getText(source).includes('dockInset'))) throw new Error('DesktopShell dockInset watcher not found')
  return { source, declarations, watcherStatements }
}

function runtime(): Runtime {
  const host = makeHost()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: true }) } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null, querySelector: () => ({ clientWidth: 1280, clientHeight: 800 }) } })
  const { source, declarations, watcherStatements } = shellStatements()
  const scope = effectScope()
  const dockInset = ref(0)
  const isStrip = computed(() => wm.shellLayoutMode.value === 'strip')
  const isVerticalStrip = computed(() => wm.shellStripDirection.value === 'vertical')
  const stripScrollRef = ref(host as unknown as HTMLElement)
  const counter = { count: 0 }
  const layout = declarations.find(d => ts.isFunctionDeclaration(d) && d.name?.text === 'layoutStripColumns')!
  const originalLayout = layout.getText(source).replace('{', '{ reflowCounter();')
  const chunks = [...declarations.filter(d => d !== layout).map(d => d.getText(source)), originalLayout].join('\n')
  const watchCode = watcherStatements.map(s => s.getText(source)).join('\n')
  const js = ts.transpile(`${chunks}\n${watchCode}\nreturn { handleViewportResize };`, { target: ts.ScriptTarget.ES2022 })
  let api!: { handleViewportResize: () => void }
  scope.run(() => {
    api = new Function('reflowCounter', 'watch', 'nextTick', 'wm', 'stripScrollRef', 'isStrip', 'isVerticalStrip', 'computeStripRects', 'stripColumnWidth', 'dockInset', js)(
      () => { counter.count++ }, watch, nextTick, wm, stripScrollRef, isStrip, isVerticalStrip, computeStripRects, stripColumnWidth, dockInset,
    ) as { handleViewportResize: () => void }
  })
  return { scope, host, dockInset, reflowCount: () => counter.count, resetReflow: () => { counter.count = 0 }, handleViewportResize: api.handleViewportResize }
}

async function drain() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function openStripFixture() {
  wm.closeAll()
  wm.shellLayoutMode.value = 'floating'
  wm.shellStripDirection.value = 'horizontal'
  wm.stripLine.value = 0
  wm.stripOffset.value = 0
  wm.setLayoutMode('strip')
  const ids = ['files', 'terminal', 'settings'].map(panel => wm.open(panel as 'files' | 'terminal' | 'settings'))
  wm.windows.value.forEach((win, index) => Object.assign(win, {
    x: 321 + index * 487, y: 24, width: 468, height: 640, column: index * 2 + 1, line: 0,
  }))
  wm.stripLine.value = 0
  wm.stripOffset.value = 1
  return ids
}

function geometry() {
  return wm.windows.value.map(win => Object.fromEntries(stateFields.map(field => [field, win[field]])))
}

async function mountedStripFixture() {
  openStripFixture()
  current = runtime()
  await drain() // Complete the real initial strip entry/reflow first.
  wm.windows.value.forEach((win, index) => Object.assign(win, {
    x: 321 + index * 487, y: 24, width: 468, height: 640,
  }))
  current.resetReflow()
  current.host.scrollTo.mockClear()
}

async function overviewRoundTrip(exit: () => void = () => wm.exitOverview()) {
  const before = geometry()
  wm.setLayoutMode('overview')
  await drain()
  exit()
  await drain()
  return before
}

let current: Runtime | undefined
afterEach(() => {
  current?.scope.stop()
  current = undefined
  wm.closeAll()
  wm.shellLayoutMode.value = 'floating'
  wm.shellStripDirection.value = 'horizontal'
  wm.stripLine.value = 0
  wm.stripOffset.value = 0
  wm.shellAutoTile.value = false
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

describe('DesktopShell overview strip reflow watcher', () => {
  it.each(['exitOverview', 'toggleOverview', 'cycleLayout'] as const)('preserves custom strip geometry on canonical %s', async transition => {
    await mountedStripFixture()
    const before = geometry()
    const columns = wm.windows.value.map(win => win.column)
    const offset = wm.stripOffset.value
    expect(before[0]).toEqual({ x: 321, y: 24, width: 468, height: 640 })
    if (transition === 'exitOverview') {
      wm.setLayoutMode('overview'); await drain(); wm.exitOverview()
    } else if (transition === 'toggleOverview') {
      wm.toggleOverview(); await drain(); wm.toggleOverview()
    } else {
      wm.setLayoutMode('overview'); await drain(); wm.cycleLayout()
    }
    await drain()
    expect(geometry()).toEqual(before)
    expect(wm.windows.value.map(win => win.column)).toEqual(columns)
    expect(wm.stripOffset.value).toBe(offset)
    expect(current!.host.scrollTo).toHaveBeenCalled()
    expect(current!.reflowCount()).toBe(0)
  })

  it('preserves geometry when overview is toggled twice in the same tick', async () => {
    await mountedStripFixture()
    const before = geometry()
    wm.toggleOverview(); wm.toggleOverview()
    await drain()
    expect(geometry()).toEqual(before)
    expect(current!.reflowCount()).toBe(0)
  })

  it('still reflows on explicit strip selection from overview', async () => {
    await mountedStripFixture()
    wm.setLayoutMode('overview'); await drain()
    wm.setLayoutMode('strip'); await drain()
    expect(current!.reflowCount()).toBeGreaterThan(0)
    expect(geometry()[0]).toEqual({ x: 12, y: 12, width: 704, height: 776 })
  })

  it('reflows on explicit floating-to-strip selection, not treating it as overview return', async () => {
    wm.open('files'); wm.open('terminal')
    wm.setLayoutMode('floating')
    current = runtime()
    wm.setLayoutMode('strip')
    await drain()
    expect(current.reflowCount()).toBeGreaterThan(0)
  })

  it('reflows viewport changes after canonical return and while overview is active', async () => {
    await mountedStripFixture()
    await overviewRoundTrip()
    current!.host.clientWidth = 1100
    current!.host.clientHeight = 700
    current!.resetReflow()
    current!.handleViewportResize()
    expect(current!.reflowCount()).toBeGreaterThan(0)
    wm.setLayoutMode('overview'); await drain()
    current!.resetReflow()
    current!.host.clientWidth = 1024
    current!.host.clientHeight = 680
    current!.handleViewportResize()
    expect(current!.reflowCount()).toBe(0)
    wm.exitOverview(); await drain()
    expect(current!.reflowCount()).toBeGreaterThan(0)
  })

  it('reflows dock inset changes during overview and after return', async () => {
    await mountedStripFixture()
    wm.setLayoutMode('overview'); await drain()
    current!.resetReflow()
    current!.dockInset.value = 24
    await drain()
    expect(current!.reflowCount()).toBe(0)
    wm.exitOverview(); await drain()
    expect(current!.reflowCount()).toBeGreaterThan(0)
    current!.resetReflow()
    current!.dockInset.value = 48
    await drain()
    expect(current!.reflowCount()).toBeGreaterThan(0)
  })

  it.each(['membership', 'line', 'direction'] as const)('reflows when %s changes during overview', async change => {
    await mountedStripFixture()
    wm.setLayoutMode('overview'); await drain()
    current!.resetReflow()
    if (change === 'membership') wm.open('disks')
    else if (change === 'line') wm.stripLine.value = 1
    else wm.toggleStripDirection()
    await drain()
    wm.exitOverview(); await drain()
    expect(current!.reflowCount()).toBeGreaterThan(0)
  })
})
