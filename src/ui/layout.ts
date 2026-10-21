// CyberManju OS — UiLayoutTargets (src/ui/layout.ts).
// Role: mark safe Vue component roots and semantic controls for explicit UI-layout editing.
// Exports: installUiLayoutTargets, componentLayoutId.
// Integrates: vue.
// Contracts: tagging only; never handles gestures or invokes shell/backend transports.
import type { App, ComponentPublicInstance } from 'vue'

const ROOT_EXCLUSIONS = new Set([
  'App', 'DesktopShell', 'LandingPage', 'MobileLauncher', 'WindowContent', 'CanvasEngine',
  'AsyncComponentWrapper', 'Transition', 'TransitionGroup',
])
const SEMANTIC_TARGETS = [
  'button', 'input', 'textarea', 'select', 'summary', 'a[href]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="option"]',
  '[role="slider"]', '[role="separator"][tabindex]', '[tabindex]:not([tabindex="-1"])',
  'toolbar', '[role="toolbar"]', 'header', 'section', 'nav', 'aside', 'article', 'footer',
].join(',')
const EXCLUDED_ANCESTORS = [
  '[data-ui-layout-ignore]', '[data-home-item]', '.desktop-icons',
].join(',')
const ENTRY_TARGETS = '.dock-item, .pp-launcher, .pp-task, .mn-btn, .titlebar-app'

function safeSegment(value: unknown): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return normalized || 'component'
}

function componentName(instance: ComponentPublicInstance): string {
  const options = instance.$options as typeof instance.$options & { __name?: string }
  return options.name || options.__name || 'component'
}

function unkeyedSiblingOrdinal(instance: ComponentPublicInstance): number | null {
  type Node = { key?: unknown; type?: unknown; children?: unknown }
  const internal = (instance as unknown as { $?: { vnode?: Node; parent?: { subTree?: Node } } }).$
  const vnode = internal?.vnode
  if (!vnode || vnode.key != null) return null
  const tree = internal.parent?.subTree
  if (!tree) return null
  let ordinal = 0
  let result: number | null = null
  // Component children often sit below native elements and Fragment nodes.
  // Count matching VNodes throughout the owner's render tree, not just its
  // immediate children; otherwise adjacent unkeyed UiButtons share an ID.
  function visit(node: Node) {
    if (result !== null) return
    if (node.type === vnode!.type) {
      if (node === vnode) { result = ordinal; return }
      if (node.key == null) ordinal++
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) if (child && typeof child === 'object') visit(child)
    }
  }
  visit(tree)
  return result
}

/** Stable identity from component names and vnode keys; no rendered/text content is used. */
export function componentLayoutId(instance: ComponentPublicInstance): string {
  const parts: string[] = []
  let cursor: ComponentPublicInstance | null = instance
  while (cursor) {
    const vnode = (cursor as unknown as { $?: { vnode?: { key?: unknown } } }).$?.vnode
    const name = componentName(cursor)
    if (name === 'AppWindow') {
      // A fresh window receives a new win-N. Its panel remains the same entity
      // when reopened, so never persist the process-local window counter.
      const props = cursor.$props as { win?: { panelType?: string } }
      parts.unshift(`panel-${safeSegment(props?.win?.panelType || 'app')}`)
      break
    }
    if (['Dock', 'TopMenuBar', 'MobileNav', 'PlasmaPanel', 'ShellShortcutDock', 'StatusBar'].includes(name)) {
      parts.unshift(`chrome-${safeSegment(name)}`)
      break
    }
    if (name === 'AsyncComponentWrapper' || name === 'TransitionGroup' || name === 'Transition') {
      cursor = cursor.$parent
      continue
    }
    const parentName = cursor.$parent ? componentName(cursor.$parent) : ''
    const key = parentName === 'AsyncComponentWrapper' || parentName === 'AppWindow' ? undefined : vnode?.key
    const ordinal = key == null ? unkeyedSiblingOrdinal(cursor) : null
    const discriminator = key != null ? `-key-${safeSegment(key)}` : ordinal == null ? '' : `-sibling-${ordinal}`
    parts.unshift(`${safeSegment(name)}${discriminator}`)
    cursor = cursor.$parent
  }
  return `ui-${parts.join('-')}`
}

function excluded(element: HTMLElement): boolean {
  if (element.matches('.mla, .desktop-icons, [data-home-item]')) return true
  return Boolean(element.closest(EXCLUDED_ANCESTORS))
}

function isWindowShellRoot(element: HTMLElement, component: string): boolean {
  return ROOT_EXCLUSIONS.has(component) || element.matches('html, body, #app')
}

function elementOrdinal(element: Element): number {
  let ordinal = 0
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === element.tagName) ordinal++
  }
  return ordinal
}

function domPath(element: HTMLElement, root: HTMLElement): string {
  const parts: string[] = []
  let cursor: HTMLElement | null = element
  while (cursor && cursor !== root) {
    parts.unshift(`${cursor.tagName.toLowerCase()}-${elementOrdinal(cursor)}`)
    cursor = cursor.parentElement
  }
  return parts.join('-') || 'root'
}

function markRoot(instance: ComponentPublicInstance, element: HTMLElement, rootIndex: number): void {
  if (!element.isConnected) return
  const name = componentName(instance)
  if (excluded(element)) return

  const identity = `${componentLayoutId(instance)}${rootIndex ? `-root-${rootIndex}` : ''}`
  const isTerminalRoot = element.classList.contains('terminal-panel') || name === 'TerminalPanel'
  if (!isWindowShellRoot(element, name)) {
    element.dataset.uiComponent = name
    const id = isTerminalRoot ? 'cybsh-console' : identity
    if (element.dataset.uiLayoutId !== id) element.dataset.uiLayoutId = id
  }

  // Shell containers stay fixed. Window entities are editable only in the
  // explicit global session; normal titlebar gestures remain window-owned.
  const targets = element.querySelectorAll<HTMLElement>(SEMANTIC_TARGETS)
  targets.forEach(target => {
    if (excluded(target)) return
    if (target.dataset.uiLayoutId) return
    target.dataset.uiComponent ||= name
    target.dataset.uiLayoutId = isTerminalRoot
      ? `cybsh-console-${domPath(target, element)}`
      : `${identity}-${domPath(target, element)}`
  })

  // No visible edit button: launcher entries and icons are hold-to-customize
  // entry points, including icons inside a dialog that covers the launcher.
  element.querySelectorAll<HTMLElement>(ENTRY_TARGETS).forEach(target => {
    if (excluded(target) || target.closest('.mla [data-home-item]')) return
    target.dataset.uiLayoutEntry = 'true'
    target.dataset.uiComponent ||= name
    target.dataset.uiLayoutId ||= `${identity}-${domPath(target, element)}`
  })
  if (element.classList.contains('app-icon')) element.setAttribute('data-ui-layout-entry', 'true')
}

function markComponent(instance: ComponentPublicInstance): void {
  type RenderNode = { el?: unknown; children?: unknown }
  const roots: HTMLElement[] = []
  const styledElement = (el: unknown): el is HTMLElement => el instanceof HTMLElement || (typeof SVGElement !== 'undefined' && el instanceof SVGElement)
  const collect = (node: RenderNode) => {
    if (styledElement(node.el)) { roots.push(node.el); return }
    // Fragment and Teleport roots are comments/text, but their actual rendered
    // children still belong to this component, including body-mounted chrome.
    if (Array.isArray(node.children)) for (const child of node.children) {
      if (child && typeof child === 'object') collect(child)
    }
  }
  const tree = (instance as unknown as { $?: { subTree?: RenderNode } }).$?.subTree
  if (styledElement(instance.$el)) roots.push(instance.$el)
  else if (tree) collect(tree)
  roots.forEach((element, index) => markRoot(instance, element, index))
}

/** Vue plugin that only tags DOM nodes; runtime owns edit-mode gestures and persistence. */
export function installUiLayoutTargets(app: App): void {
  app.mixin({
    mounted() { markComponent(this) },
    updated() { markComponent(this) },
  })
}

export default installUiLayoutTargets
