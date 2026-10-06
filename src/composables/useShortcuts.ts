import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { isEditableTarget } from '@/utils/dom'

export type ShortcutGroup = 'Global Shortcuts' | 'Navigation' | 'File Operations' | 'View' | 'Panels' | 'Touchpad'

export interface KplData {
  global: { name: string; version: string; description: string }
  shortcuts: Record<string, string>
}

export interface KpdData {
  modifiers: Record<string, string>
  components: Record<string, string>
  contextActions: Record<string, string>
  touchpadGestures: Record<string, string>
}

export interface ShortcutEntry {
  action: string
  keys: string
  group: ShortcutGroup
  description: string
}

type ShortcutHandler = () => void

interface ChordState {
  buffer: string[]
  timeout: number | null
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  let currentGroup = '__root__'
  result[currentGroup] = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const groupMatch = line.match(/^\[(.+)\]$/)
    if (groupMatch) {
      currentGroup = groupMatch[1]
      if (!result[currentGroup]) result[currentGroup] = {}
      continue
    }
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const val = line.slice(eqIdx + 1).trim()
    if (key) result[currentGroup][key] = val
  }
  return result
}

function normalizeKeys(keys: string, modifiers: Record<string, string>): string {
  let normalized = keys
  for (const [alias, mod] of Object.entries(modifiers)) {
    normalized = normalized.replace(new RegExp(`\\b${alias}\\b`, 'gi'), mod)
  }
  return normalized
}

function keyEventToSequence(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  }
  return parts.join('+')
}

function sequencesMatch(pressed: string, binding: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  return normalize(pressed) === normalize(binding)
}

export function useShortcuts(
  kplSource: string | (() => Promise<string>),
  kpdSource: string | (() => Promise<string>),
  scopeRef?: Ref<HTMLElement | null>,
  overrides?: Ref<Record<string, string>>
) {
  const handlers = new Map<string, ShortcutHandler[]>()
  const chord: ChordState = { buffer: [], timeout: null }
  let kpl: KplData = { global: { name: '', version: '', description: '' }, shortcuts: {} }
  let kpd: KpdData = { modifiers: {}, components: {}, contextActions: {}, touchpadGestures: {} }
  let activeBindings = new Map<string, string>()
  let paused = false

  async function load() {
    const kplText = typeof kplSource === 'string' ? kplSource : await kplSource()
    const kpdText = typeof kpdSource === 'string' ? kpdSource : await kpdSource()
    const kplRaw = parseIni(kplText)
    const kpdRaw = parseIni(kpdText)
    kpl = {
      global: { name: kplRaw.Global?.name || '', version: kplRaw.Global?.version || '', description: kplRaw.Global?.description || '' },
      shortcuts: Object.fromEntries(
        Object.entries(kplRaw).filter(([g]) => g !== 'Global').flatMap(([, vals]) => Object.entries(vals))
      ),
    }
    kpd = {
      modifiers: kpdRaw.Modifiers || {},
      components: kpdRaw.Components || {},
      contextActions: kpdRaw.ContextActions || {},
      touchpadGestures: kpdRaw.TouchpadGestures || {},
    }
    buildBindings()
  }

  function buildBindings() {
    activeBindings.clear()
    const merged = { ...kpl.shortcuts }
    if (overrides?.value) {
      for (const [action, keys] of Object.entries(overrides.value)) {
        if (keys) merged[action] = keys
      }
    }
    for (const [action, keys] of Object.entries(merged)) {
      activeBindings.set(action, normalizeKeys(keys, kpd.modifiers))
    }
  }

  if (overrides) {
    watch(overrides, () => { buildBindings() }, { deep: true })
  }

  function on(action: string, handler: ShortcutHandler) {
    if (!handlers.has(action)) handlers.set(action, [])
    handlers.get(action)!.push(handler)
    return () => {
      const arr = handlers.get(action)
      if (arr) {
        const idx = arr.indexOf(handler)
        if (idx !== -1) arr.splice(idx, 1)
      }
    }
  }

  function off(action: string, handler: ShortcutHandler) {
    const arr = handlers.get(action)
    if (arr) {
      const idx = arr.indexOf(handler)
      if (idx !== -1) arr.splice(idx, 1)
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (paused) return
    if (!e.ctrlKey && !e.metaKey && isEditableTarget(e.target)) return
    const seq = keyEventToSequence(e)
    if (chord.timeout) {
      clearTimeout(chord.timeout)
      chord.timeout = null
    }
    const fullChord = [...chord.buffer, seq].join(', ')
    for (const [action, binding] of activeBindings) {
      if (sequencesMatch(seq, binding)) {
        if (binding.includes(',')) {
          chord.buffer.push(seq)
          chord.timeout = window.setTimeout(() => { chord.buffer = [] }, 1000)
          return
        }
        fire(action, e)
        return
      }
      if (binding.includes(',') && sequencesMatch(fullChord, binding)) {
        chord.buffer = []
        fire(action, e)
        return
      }
    }
    chord.buffer = []
  }

  function fire(action: string, e: KeyboardEvent) {
    const arr = handlers.get(action)
    if (arr) {
      e.preventDefault()
      e.stopPropagation()
      for (const h of arr) h()
    }
  }

  onMounted(() => {
    load()
    const el = scopeRef?.value || document
    el.addEventListener('keydown', handleKey as EventListener)
  })

  onUnmounted(() => {
    const el = scopeRef?.value || document
    el.removeEventListener('keydown', handleKey as EventListener)
    if (chord.timeout) clearTimeout(chord.timeout)
  })

  function pause() { paused = true }
  function resume() { paused = false }

  function getShortcut(action: string): string {
    return activeBindings.get(action) || ''
  }

  function getAllShortcuts(): ShortcutEntry[] {
    const entries: ShortcutEntry[] = []
    for (const [action, keys] of activeBindings) {
      let group: ShortcutGroup = 'Global Shortcuts'
      for (const [g, content] of Object.entries(parseIni(''))) {
        if (Object.keys(content).includes(action)) group = g as ShortcutGroup
      }
      entries.push({ action, keys: keys.replace(/,/g, ', '), group, description: action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })
    }
    return entries
  }

  function getComponentActions(componentId: string): string[] {
    const raw = kpd.components[componentId]
    if (!raw) return []
    return raw.split(',').map(s => s.trim())
  }

  function getContextActions(fileType: string): string[] {
    const raw = kpd.contextActions[fileType]
    if (!raw) return kpd.contextActions.file?.split(',').map(s => s.trim()) || []
    return raw.split(',').map(s => s.trim())
  }

  function getTouchpadGesture(gesture: string): string {
    return kpd.touchpadGestures[gesture] || ''
  }

  function getModifier(key: string): string {
    return kpd.modifiers[key] || key
  }

  return {
    load,
    on,
    off,
    pause,
    resume,
    getShortcut,
    getAllShortcuts,
    getComponentActions,
    getContextActions,
    getTouchpadGesture,
    getModifier,
    activeBindings,
    kpl,
    kpd,
  }
}
