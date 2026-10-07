import { ref, computed, markRaw, defineAsyncComponent, type Component } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { PanelType } from '@/types'
import { MODULE_METADATA } from '@/types'
import {
  computeTileRects,
  clampStripOffset,
  resolveStripLine,
} from '@/utils/shellLayout'
import { PANEL_ALIASES, ALIAS_TAB_PROPS, resolvePanel } from '@/utils/panels'
import FileManager from '@/components/FileManager.vue'
import OrganizePanel from '@/components/OrganizePanel.vue'
import FaceGroupingPanel from '@/components/FaceGroupingPanel.vue'
import MapView from '@/components/MapView.vue'
import WebDashboardPanel from '@/components/WebDashboardPanel.vue'
import SyncPanel from '@/components/SyncPanel.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import DiskManagerPage from '@/components/DiskManagerPage.vue'
import ShieldPanel from '@/components/ShieldPanel.vue'
import FilePermissionsPanel from '@/components/FilePermissionsPanel.vue'
import ProcessPanel from '@/components/ProcessPanel.vue'
import DevicesPanel from '@/components/DevicesPanel.vue'
import AccountManagerPanel from '@/components/AccountManagerPanel.vue'
import TransferGraph from '@/components/TransferGraph.vue'
import WindowContent from '@/components/WindowContent.vue'

// AGENT-8: the terminal is the heaviest new panel (a few thousand scrollback
// lines), so it is the first panel in the shell to be code-split — it is
// fetched the first time someone opens it, not on boot.
const TerminalPanel = defineAsyncComponent(
  () => import('@/components/TerminalPanel.vue')
)

// The agent panel is as heavy as the terminal (thread + approvals), so it
// is code-split the same way — fetched on first open, not on boot.
const AgentPanel = defineAsyncComponent(
  () => import('@/components/AgentPanel.vue')
)

// The code studio (editor + AI sidecar) is as heavy as the terminal, so it
// is code-split like the terminal — fetched on first open, not on boot.
const CodeStudio = defineAsyncComponent(
  () => import('@/components/CodeStudio.vue')
)

export interface WindowState {
  id: string
  panelType: PanelType
  title: string
  icon: string
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  zIndex: number
  component: Component | null
  props?: Record<string, unknown>
  /** Niri-style strip column index (order on the infinite strip). */
  column?: number
  /** Niri-style line/row index (vertical workspace line on the strip). */
  line?: number
}

export type ShellLayoutMode = 'floating' | 'tiled' | 'strip' | 'overview'
/**
 * Niri/Noctalia-inspired strip axis:
 * - `horizontal`: one infinite screen scrolling left ↔ right, lines stack
 *   top ↔ bottom (separate vertical workspace lines).
 * - `vertical`: one infinite screen scrolling top ↔ bottom, lines run
 *   left ↔ right.
 */
export type StripDirection = 'horizontal' | 'vertical'

type SizeMap = { [K in PanelType]?: { width: number; height: number } } & {
  permissions?: { width: number; height: number }
}
const defaultSizes: SizeMap = {
  files: { width: 1240, height: 720 },
  search: { width: 600, height: 480 },
  collections: { width: 500, height: 420 },
  faces: { width: 620, height: 640 },
  map: { width: 720, height: 520 },
  code: { width: 1280, height: 740 },
  editor: { width: 1280, height: 740 },
  agent: { width: 1020, height: 680 },
  users: { width: 520, height: 460 },
  sync: { width: 580, height: 440 },
  transfer: { width: 980, height: 660 },
  settings: { width: 560, height: 520 },
  trash: { width: 500, height: 400 },
  activity: { width: 540, height: 400 },
  favorites: { width: 420, height: 360 },
  recent: { width: 420, height: 360 },
  accounts: { width: 780, height: 640 },
  'loose-groups': { width: 440, height: 380 },
  style: { width: 440, height: 360 },
  storage: { width: 580, height: 480 },
  terminal: { width: 760, height: 520 },
  processes: { width: 660, height: 460 },
  disks: { width: 700, height: 540 },
  devices: { width: 680, height: 560 },
  dashboard: { width: 600, height: 460 },
  webdash: { width: 640, height: 500 },
  encryption: { width: 480, height: 420 },
  compression: { width: 480, height: 420 },
  permissions: { width: 440, height: 380 },
  preview: { width: 480, height: 540 },
}

const inlinePanels: PanelType[] = [
  'search', 'trash', 'activity', 'recent',
]

const panelComponentMap: Record<string, Component> = {
  files: FileManager,
  collections: OrganizePanel,
  favorites: OrganizePanel,
  'loose-groups': OrganizePanel,
  style: OrganizePanel,
  faces: FaceGroupingPanel,
  map: MapView,
  // Merged studio: `code` (tree-sitter intel) and `editor` (VSCode-like)
  // are one window now — `code` stays as an alias so old shortcuts,
  // palette entries and menu items keep working.
  code: CodeStudio,
  editor: CodeStudio,
  agent: AgentPanel,
  users: AccountManagerPanel,
  dashboard: WebDashboardPanel,
  sync: SyncPanel,
  transfer: TransferGraph,
  settings: SettingsPage,
  storage: DiskManagerPage,
  terminal: TerminalPanel,
  processes: ProcessPanel,
  disks: DiskManagerPage,
  devices: DevicesPanel,
  accounts: AccountManagerPanel,
  encryption: ShieldPanel,
  compression: ShieldPanel,
  permissions: FilePermissionsPanel,
  preview: FileManager,
  webdash: WebDashboardPanel,
}

function getComponent(panelType: PanelType): Component | null {
  if (panelComponentMap[panelType]) return markRaw(panelComponentMap[panelType])
  if (inlinePanels.includes(panelType)) return markRaw(WindowContent)
  return null
}

let windowCounter = 0

const windows = ref<WindowState[]>([])
const nextZIndex = ref(10)
const windowFocusHistory = ref<string[]>([])

// ── Shell layout (VueUse-persisted) ────────────────────────────
// `floating`: classic free windows. `tiled`: auto-grid. `strip`: niri-like
// infinite strip (new windows append right, never resize existing ones —
// the viewport scrolls). `overview`: zoomed-out grid to pick a window.
export const shellLayoutMode = useLocalStorage<ShellLayoutMode>(
  'cybermanju_shell_layout',
  'floating',
)
export const shellStripDirection = useLocalStorage<StripDirection>(
  'cybermanju_shell_strip_dir',
  'horizontal',
)
export const shellAutoTile = useLocalStorage<boolean>(
  'cybermanju_shell_autotile',
  false,
)
/** Niri-style viewport: first visible column (horizontal) or line (vertical). */
export const stripOffset = ref(0)
/** Niri-style vertical line selector (which "row" of the strip is live). */
export const stripLine = ref(0)

function cascadePosition(index: number): { x: number; y: number } {
  const offset = 30 + (index % 10) * 28
  return { x: offset, y: offset }
}

function workspaceSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 800 }
  const el = document.querySelector('.desktop-workspace') as HTMLElement | null
  if (el && el.clientWidth > 0) return { w: el.clientWidth, h: el.clientHeight }
  return { w: window.innerWidth, h: Math.max(400, window.innerHeight - 120) }
}

export function useWindowManager() {
  const activeWindow = computed(() => {
    if (windowFocusHistory.value.length === 0) return null
    const id = windowFocusHistory.value[windowFocusHistory.value.length - 1]
    return windows.value.find(w => w.id === id) || null
  })

  /** Windows on the live strip line, in column order (niri strip). */
  const stripWindows = computed(() =>
    windows.value
      .filter(w => !w.minimized && (w.line ?? 0) === stripLine.value)
      .sort((a, b) => (a.column ?? 0) - (b.column ?? 0)),
  )

  function nextColumn(): number {
    const cols = windows.value.map(w => w.column ?? 0)
    return cols.length === 0 ? 0 : Math.max(...cols) + 1
  }

  function open(panelType: PanelType, props?: Record<string, unknown>) {
    // Merged-window aliases: `preview` opens Files with the inspector up,
    // `storage` opens Disks on its overview tab, etc.
    const target = resolvePanel(panelType)
    const mergedProps = { ...(ALIAS_TAB_PROPS[panelType] || {}), ...(props || {}) }
    const existing = windows.value.find(
      w => w.panelType === target && !w.minimized
    )
    if (existing) {
      // Re-steer the live window (e.g. switch the organize tab) instead of
      // stacking a second copy of the same surface.
      existing.props = { ...(existing.props || {}), ...mergedProps }
      focus(existing.id)
      return existing.id
    }

    const meta = MODULE_METADATA[target] || { label: target.toUpperCase(), icon: 'solar:grid-2x2-bold' }
    const size = defaultSizes[target] || { width: 520, height: 440 }
    const pos = cascadePosition(windows.value.length)
    const id = `win-${++windowCounter}`
    const comp = getComponent(target)

    const resolvedProps = { ...mergedProps }
    if (inlinePanels.includes(target)) {
      resolvedProps.panelType = target
    }

    const win: WindowState = {
      id,
      panelType: target,
      title: meta.label,
      icon: meta.icon,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      minimized: false,
      zIndex: nextZIndex.value++,
      component: comp,
      props: resolvedProps,
      column: nextColumn(),
      line: stripLine.value,
    }
    windows.value.push(win)
    windowFocusHistory.value = windowFocusHistory.value.filter(w => w !== id)
    windowFocusHistory.value.push(id)
    // Tiled mode (or floating + autotile) re-tiles on open so the grid
    // stays dense. Strip mode never resizes — the viewport follows instead.
    if (
      shellLayoutMode.value === 'tiled' ||
      (shellAutoTile.value && shellLayoutMode.value === 'floating')
    ) {
      tileWindows()
    }
    // Niri rule: a new window never resizes existing ones — the strip
    // viewport follows it instead.
    if (shellLayoutMode.value === 'strip') {
      stripOffset.value = Math.max(0, stripWindows.value.length - 1)
    }
    return id
  }

  function close(id: string) {
    windows.value = windows.value.filter(w => w.id !== id)
    windowFocusHistory.value = windowFocusHistory.value.filter(w => w !== id)
    resequenceColumns()
    // Niri dynamic workspaces: a line with no windows is gone — pull the
    // viewport back onto the nearest live line instead of an empty index.
    const live = new Set(windows.value.map(w => w.line ?? 0))
    if (!live.has(stripLine.value)) {
      const sorted = [...live].sort((a, b) => a - b)
      stripLine.value = sorted.length === 0 ? 0 : sorted[sorted.length - 1]
    }
    stripOffset.value = clampStripOffset(stripOffset.value, stripWindows.value.length)
  }

  function minimize(id: string) {
    const win = windows.value.find(w => w.id === id)
    if (win) {
      win.minimized = true
      windowFocusHistory.value = windowFocusHistory.value.filter(w => w !== id)
    }
  }

  function restore(id: string) {
    const win = windows.value.find(w => w.id === id)
    if (win) {
      win.minimized = false
      focus(id)
    }
  }

  function focus(id: string) {
    const win = windows.value.find(w => w.id === id)
    if (win) {
      win.zIndex = nextZIndex.value++
      windowFocusHistory.value = windowFocusHistory.value.filter(w => w !== id)
      windowFocusHistory.value.push(id)
      if (shellLayoutMode.value === 'strip') {
        const idx = stripWindows.value.findIndex(w => w.id === id)
        if (idx >= 0) stripOffset.value = idx
      }
    }
  }

  function blurAll() {
    windowFocusHistory.value = []
  }

  function toggle(panelType: PanelType, props?: Record<string, unknown>) {
    const existing = windows.value.find(
      w => w.panelType === panelType
    )
    if (existing) {
      if (existing.minimized) {
        restore(existing.id)
      } else {
        close(existing.id)
      }
    } else {
      open(panelType, props)
    }
  }

  function closeAll() {
    windows.value = []
    windowFocusHistory.value = []
    stripOffset.value = 0
  }

  function minimizeAll() {
    windows.value.forEach(w => { w.minimized = true })
    windowFocusHistory.value = []
  }

  function updatePosition(id: string, x: number, y: number) {
    const win = windows.value.find(w => w.id === id)
    if (win) {
      win.x = x
      win.y = y
    }
  }

  function updateSize(id: string, width: number, height: number) {
    const win = windows.value.find(w => w.id === id)
    if (win) {
      win.width = Math.max(320, width)
      win.height = Math.max(240, height)
    }
  }

  // ── Focus movement ──────────────────────────────────────────
  function focusByOffset(delta: number) {
    const list = shellLayoutMode.value === 'strip'
      ? stripWindows.value
      : windows.value.filter(w => !w.minimized)
    if (list.length === 0) return
    const activeId = activeWindow.value?.id
    const idx = list.findIndex(w => w.id === activeId)
    const next = list[(idx < 0 ? (delta > 0 ? -1 : 0) : idx + delta + list.length) % list.length]
    if (next) focus(next.id)
  }
  function focusNext() { focusByOffset(1) }
  function focusPrev() { focusByOffset(-1) }

  function closeFocused() {
    const a = activeWindow.value
    if (a) close(a.id)
  }
  function minimizeFocused() {
    const a = activeWindow.value
    if (a) minimize(a.id)
  }

  // ── Auto-organization ───────────────────────────────────────
  /** Grid-tile every visible window into the workspace (classic autotile). */
  function tileWindows() {
    const list = windows.value.filter(w => !w.minimized)
    if (list.length === 0) return
    const { w, h } = workspaceSize()
    const rects = computeTileRects(list.length, w, h)
    list.forEach((win, i) => {
      const r = rects[i]
      win.x = r.x
      win.y = r.y
      win.width = r.width
      win.height = r.height
      win.zIndex = 10 + i
    })
    nextZIndex.value = 10 + list.length
  }

  /** Cascade from top-left (classic floating cleanup). */
  function cascadeWindows() {
    const list = windows.value.filter(w => !w.minimized)
    list.forEach((win, i) => {
      const p = cascadePosition(i)
      win.x = p.x
      win.y = p.y
      win.zIndex = 10 + i
    })
    nextZIndex.value = 10 + list.length
  }

  function resequenceColumns() {
    const lines = new Map<number, WindowState[]>()
    for (const w of windows.value) {
      const line = w.line ?? 0
      if (!lines.has(line)) lines.set(line, [])
      lines.get(line)!.push(w)
    }
    for (const group of lines.values()) {
      group.sort((a, b) => (a.column ?? 0) - (b.column ?? 0))
      group.forEach((w, i) => { w.column = i })
    }
  }

  // ── Niri-style strip viewport ───────────────────────────────
  /** Scroll the infinite strip by `delta` columns. Focus follows. */
  function scrollStrip(delta: number) {
    const n = stripWindows.value.length
    if (n === 0) return
    stripOffset.value = clampStripOffset(stripOffset.value + delta, n)
    const target = stripWindows.value[stripOffset.value]
    if (target) focus(target.id)
  }
  function stripLeft() { scrollStrip(-1) }
  function stripRight() { scrollStrip(1) }
  /**
   * Move between vertical lines (workspaces) on the strip. Niri keeps one
   * empty line below the lowest occupied one — moving down onto it lets a
   * new window claim a fresh line; empty lines otherwise vanish (see close).
   */
  function stripLineMove(delta: number) {
    const lines = [...new Set(windows.value.map(w => w.line ?? 0))]
    stripLine.value = resolveStripLine(lines, stripLine.value, delta)
    stripOffset.value = 0
  }
  function moveFocusedOnStrip(delta: number) {
    const a = activeWindow.value
    if (!a) return
    a.column = (a.column ?? 0) + delta
    resequenceColumns()
  }
  function moveFocusedToLine(delta: number) {
    const a = activeWindow.value
    if (!a) return
    a.line = Math.max(0, (a.line ?? 0) + delta)
    resequenceColumns()
  }

  /**
   * Nudge the focused window by a few pixels (floating/tiled arrow-key
   * moves). In strip mode callers prefer moveFocusedOnStrip/ToLine instead
   * so columns keep their size.
   */
  function nudgeFocused(dx: number, dy: number) {
    const a = activeWindow.value
    if (!a) return
    a.x = Math.max(0, a.x + dx)
    a.y = Math.max(0, a.y + dy)
  }

  // ── Layout mode ─────────────────────────────────────────────
  function setLayoutMode(mode: ShellLayoutMode) {
    shellLayoutMode.value = mode
    if (mode === 'tiled') tileWindows()
    if (mode === 'floating') cascadeWindows()
    if (mode === 'strip') {
      resequenceColumns()
      stripOffset.value = Math.max(0, stripWindows.value.length - 1)
    }
  }
  function cycleLayout() {
    const order: ShellLayoutMode[] = ['floating', 'tiled', 'strip', 'overview']
    const next = order[(order.indexOf(shellLayoutMode.value) + 1) % order.length]
    setLayoutMode(next)
  }
  function toggleAutoTile() {
    shellAutoTile.value = !shellAutoTile.value
    if (shellAutoTile.value) tileWindows()
  }
  function toggleStripDirection() {
    shellStripDirection.value = shellStripDirection.value === 'horizontal' ? 'vertical' : 'horizontal'
  }

  const openWindowCount = computed(() =>
    windows.value.filter(w => !w.minimized).length
  )

  const isOpen = (panelType: PanelType) =>
    windows.value.some(w => w.panelType === panelType)

  return {
    windows,
    activeWindow,
    nextZIndex,
    stripWindows,
    shellLayoutMode,
    shellStripDirection,
    shellAutoTile,
    stripOffset,
    stripLine,
    open,
    close,
    minimize,
    restore,
    focus,
    blurAll,
    toggle,
    closeAll,
    minimizeAll,
    updatePosition,
    updateSize,
    openWindowCount,
    isOpen,
    inlinePanels,
    // organization
    tileWindows,
    cascadeWindows,
    focusNext,
    focusPrev,
    focusByOffset,
    closeFocused,
    minimizeFocused,
    // niri strip
    scrollStrip,
    stripLeft,
    stripRight,
    stripLineMove,
    moveFocusedOnStrip,
    moveFocusedToLine,
    nudgeFocused,
    setLayoutMode,
    cycleLayout,
    toggleAutoTile,
    toggleStripDirection,
  }
}

export type WindowManager = ReturnType<typeof useWindowManager>
