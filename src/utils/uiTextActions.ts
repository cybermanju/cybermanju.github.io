// CyberManju OS — Edit menu text-action handoff (src/utils/uiTextActions.ts).
// Role: capture and revalidate transient editor selection without clipboard access.
// Exports: UI_TEXT_ACTION_EVENT, action types, capture/dispatch helpers.
// Integrates: TopMenuBar and UiTextContextMenu; forwards the original trusted click.
// Contracts: never persist/log content; reject disconnected, protected or stale targets.
export const UI_TEXT_ACTION_EVENT = 'cybermanju:text-action' as const

export type UiTextAction = 'copy' | 'cut' | 'paste'

export interface UiTextActionDetail {
  action: UiTextAction
  event: Event
  target: HTMLElement
  range?: Range
  start?: number
  end?: number
}

export interface UiTextActionSnapshot {
  target: HTMLElement
  value?: string
  html?: string
  range?: Range
  start?: number
  end?: number
  /** Selection snapshot is retained only in memory until dispatch. */
  selectionText?: string
}

const SECRET_NAME = /(?:password|passwd|secret|token|credential|private.?key|api.?key)/i

function isProtected(target: HTMLElement): boolean {
  if (target.isContentEditable) {
    const editable = target.closest<HTMLElement>('[contenteditable="true"]') ?? target
    if (editable.getAttribute('data-protected') === 'true' || editable.getAttribute('data-secret') === 'true') return true
  }
  const input = target instanceof HTMLInputElement ? target : target.closest('input,textarea') as HTMLInputElement | null
  if (input) {
    if (input.type.toLowerCase() === 'password' || input.readOnly || input.disabled) return true
    const descriptors = [input.name, input.id, input.autocomplete, input.getAttribute('aria-label'), input.getAttribute('data-sensitive')]
    if (descriptors.some(value => value && SECRET_NAME.test(value))) return true
  }
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node.getAttribute('data-protected') === 'true' || node.getAttribute('data-secret') === 'true' || node.getAttribute('data-sensitive') === 'true') return true
  }
  return false
}

function currentOffsets(el: HTMLInputElement | HTMLTextAreaElement): { start: number; end: number } | null {
  if (el.selectionStart == null || el.selectionEnd == null) return null
  return { start: el.selectionStart, end: el.selectionEnd }
}

/** Capture without reading/logging/persisting selected text outside this transient snapshot. */
export function captureUiTextActionSnapshot(doc: Document = document): UiTextActionSnapshot | null {
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
  const selection = doc.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined
  const selectedNode = range?.commonAncestorContainer
  const selectedTarget = selectedNode instanceof HTMLElement ? selectedNode : selectedNode?.parentElement ?? null
  const target = active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable)
    ? active
    : selectedTarget
  if (!target || !target.isConnected || isProtected(target)) return null
  const snap: UiTextActionSnapshot = { target }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target.readOnly || target.disabled) return null
    snap.value = target.value
    const offsets = currentOffsets(target)
    if (offsets) Object.assign(snap, offsets)
  } else if (target.isContentEditable) {
    snap.html = target.innerHTML
    if (range && target.contains(range.commonAncestorContainer)) snap.range = range
  } else if (range && target.contains(range.commonAncestorContainer)) {
    // Ordinary document text selection is permitted only when the selected DOM is stable.
    snap.range = range
    snap.html = target.innerHTML
    snap.selectionText = selection?.toString() ?? ''
  } else return null
  return snap
}

/** Revalidate against live DOM immediately before dispatch; stale selections fail closed. */
export function dispatchUiTextAction(action: UiTextAction, event: Event, snapshot: UiTextActionSnapshot | null): boolean {
  if (!event.isTrusted || event.type !== 'click' || !snapshot) return false
  const { target } = snapshot
  if (!target.isConnected || isProtected(target)) return false
  if (snapshot.value !== undefined) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.readOnly || target.disabled || target.value !== snapshot.value) return false
    const offsets = currentOffsets(target)
    if (!offsets || offsets.start !== snapshot.start || offsets.end !== snapshot.end) return false
  } else {
    if (snapshot.html !== undefined && target.innerHTML !== snapshot.html) return false
    if (snapshot.range) {
      const selection = target.ownerDocument.getSelection()
      if (!selection || selection.rangeCount !== 1 || (selection.getRangeAt(0).startContainer !== snapshot.range.startContainer || selection.getRangeAt(0).startOffset !== snapshot.range.startOffset || selection.getRangeAt(0).endContainer !== snapshot.range.endContainer || selection.getRangeAt(0).endOffset !== snapshot.range.endOffset) || selection.toString() !== snapshot.selectionText && snapshot.selectionText !== undefined) return false
    }
  }
  const detail: UiTextActionDetail = { action, event, target }
  if (snapshot.range) detail.range = snapshot.range.cloneRange()
  if (snapshot.start !== undefined) detail.start = snapshot.start
  if (snapshot.end !== undefined) detail.end = snapshot.end
  const view = target.ownerDocument.defaultView
  if (!view) return false
  view.dispatchEvent(new CustomEvent<UiTextActionDetail>(UI_TEXT_ACTION_EVENT, { detail }))
  return true
}
