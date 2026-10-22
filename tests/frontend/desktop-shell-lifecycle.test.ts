// CyberManju OS — Desktop shell lifecycle regressions (tests/frontend/desktop-shell-lifecycle.test.ts).
// Role: Verify persistent AppWindow hosts across shell visibility and layout transitions.
// Exports: Vitest suite mounting the real DesktopShell template in Vue's in-memory renderer.
// Integrates: Vue compiler-sfc template output and minimal reactive shell/window-manager context.
// Contracts: No browser, DOM, composable runtime, or production component edits.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { transpileModule, ModuleKind } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, reactive } from 'vue'

const sourceUrl = new URL('../../src/components/DesktopShell.vue', import.meta.url)
const source = readFileSync(sourceUrl, 'utf8')
const { descriptor } = parse(source)
const compiled = compileTemplate({ source: descriptor.template!.content, filename: sourceUrl.pathname, id: 'desktop-shell-lifecycle', compilerOptions: { expressionPlugins: ['typescript'] } })
if (compiled.errors.length) throw new Error(String(compiled.errors))
const js = transpileModule(compiled.code, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
const moduleExports: any = {}
// TransitionGroup's browser animation hooks require real DOM Elements.
// Keep keyed reconciliation but omit animation, which is not under test.
const TransitionGroup = Vue.defineComponent({ props: ['name'], setup: (_props, { slots }) => () => h(Vue.Fragment, null, slots.default?.()) })
new Function('require', 'exports', 'Vue', js)((id: string) => { if (id === 'vue') return { ...Vue, TransitionGroup }; throw new Error(id) }, moduleExports, Vue)

interface Node { tag: string; text: string; children: Node[]; parent: Node | null; props: Record<string, any>; style: Record<string, any> }
const node = (tag: string, text = ''): Node => ({ tag, text, children: [], parent: null, props: {}, style: {} })
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  patchProp(el, key, _old, value) { el.props[key] = value; if (key === 'style' && value && typeof value === 'object') el.style = { ...value } },
  insert(el, parent, anchor = null) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(el); else parent.children.splice(i, 0, el); el.parent = parent },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null },
})
const all = (el: Node): Node[] => [el, ...el.children.flatMap(all)]
const hidden = (el: Node | null): boolean => !!el && (el.style.display === 'none' || hidden(el.parent))

function mount() {
  const windows = reactive([
    { id: 'one', title: 'One', icon: 'app', line: 1, column: 0, minimized: false },
    { id: 'two', title: 'Two', icon: 'app', line: 2, column: 1, minimized: false },
  ])
  const mode = Vue.ref('floating')
  const wm: any = {
    windows: Vue.ref(windows), stripWindows: Vue.computed(() => windows.filter(w => !w.minimized && w.line === 2)),
    stripOffset: Vue.ref(0), stripLine: Vue.ref(2), shellLayoutMode: mode, shellStripDirection: Vue.ref('horizontal'), shellAutoTile: Vue.ref(false),
    close: (id: string) => { const i = windows.findIndex(w => w.id === id); if (i >= 0) windows.splice(i, 1) },
    minimize: (id: string) => { const w = windows.find(w => w.id === id); if (w) w.minimized = true },
    focus() {}, updatePosition() {}, updateSize() {}, setLayoutMode: (v: string) => { mode.value = v },
  }
  const ctx: any = {
    wm, theme: { settings: Vue.reactive({ glow: false, wallpaper: 'slopes-dark' }) }, customWallpaper: { source: Vue.ref(null), imageFailed() {} },
    dock: { layout: Vue.ref('pill'), visibility: Vue.ref('fixed') }, kickoff: { kickoffOpen: Vue.ref(false) },
    isOverview: Vue.computed(() => mode.value === 'overview'), isStrip: Vue.computed(() => mode.value === 'strip'), isVerticalStrip: false,
    isMobileViewport: false, isPlasma: false, isModernGlass: false, isFlatAmoled: false, chrome: { topBar: false, shortcutDock: false, bottom: false }, dockInset: Vue.ref(0),
    visibleWindowIds: Vue.computed(() => new Set((mode.value === 'strip' ? wm.stripWindows.value : windows.filter(w => !w.minimized)).map((w: any) => w.id))),
    overviewWindows: Vue.computed(() => windows), shortcuts: [], stripContentStyle: {}, desktopHomeLayout: { editing: Vue.ref(false), customized: Vue.ref(false), style: () => ({}), onPointerDown() {}, onClickCapture() {}, onKeydown() {}, toggle() {}, reset() {} },
    focusedWindowId: null, handleWorkspaceClick() {}, onStripWheel() {}, openShortcut() {}, leaveOverview() {}, pickFromOverview() {},
    dockMenu: Vue.reactive({ visible: false, items: [], x: 0, y: 0 }),
  }
  const AppWindow = { name: 'AppWindow', props: ['win'], setup(props: any) { const instance = ++lifecycle.mounts; return () => h('article', { 'data-window-id': props.win.id, 'data-instance': instance }) }, unmounted() { lifecycle.unmounts++ } }
  const lifecycle = { mounts: 0, unmounts: 0 }
  const root = node('root')
  const component = { setup: () => ctx, render: moduleExports.render, components: { AppWindow, TopMenuBar: { render: () => null }, StatusBar: { render: () => null }, MobileLauncher: { render: () => null }, AppIcon: { render: () => null }, ShellShortcutDock: { render: () => null }, PlasmaPanel: { render: () => null }, KickoffMenu: { render: () => null }, Dock: { render: () => null } } }
  const app = renderer.createApp(component)
  app.mount(root)
  return { root, windows, mode, lifecycle, app }
}

describe('DesktopShell keyed AppWindow lifecycle', () => {
  it('keeps each host mounted and inert/hidden when minimized, in overview, floating, tiled, and strip', async () => {
    const ui = mount()
    const host = (id: string) => all(ui.root).find(el => el.props['data-shell-window-id'] === id)
    expect(ui.lifecycle.mounts).toBe(2)
    const original = host('one')
    ui.windows[0]!.minimized = true; await nextTick()
    expect(host('one')).toBeDefined(); expect(host('one')!.style.display).toBe('none'); expect(host('one')!.props.inert).toBe(true)
    ui.windows[0]!.minimized = false; await nextTick()
    expect(host('one')!.style.display).not.toBe('none'); expect(host('one')!.props.inert).toBe(false)
    for (const layout of ['overview', 'floating', 'tiled', 'strip']) {
      ui.mode.value = layout; await nextTick()
      expect(ui.lifecycle.mounts).toBe(2); expect(ui.lifecycle.unmounts).toBe(0)
      expect(all(ui.root).filter(el => el.tag === 'article')).toHaveLength(2)
      expect(host('one')).toBe(original)
      expect(host('one')!.props['data-instance']).toBe(1)
      if (layout === 'overview') {
        expect(hidden(host('one')!)).toBe(true); expect(host('one')!.props.inert).toBe(true)
        expect(all(ui.root).filter(el => el.props.class === 'overview-card')).toHaveLength(2)
      }
      if (layout === 'strip') {
        expect(host('one')!.style.display).toBe('none'); expect(host('one')!.props.inert).toBe(true)
        expect(host('two')!.style.display).not.toBe('none')
      }
    }
    ui.app.unmount()
  })
  it('unmounts only the closed window and never duplicates AppWindow for overview cards', async () => {
    const ui = mount()
    const host = (id: string) => all(ui.root).find(el => el.props['data-shell-window-id'] === id)
    ui.mode.value = 'overview'; await nextTick()
    expect(all(ui.root).filter(el => el.props.class === 'overview-card')).toHaveLength(2)
    expect(ui.lifecycle.mounts).toBe(2)
    ui.windows.splice(0, 1); await nextTick()
    expect(ui.lifecycle.unmounts).toBe(1); expect(host('one')).toBeUndefined(); expect(host('two')).toBeDefined()
    expect(ui.lifecycle.mounts).toBe(2)
    ui.app.unmount()
  })
})
