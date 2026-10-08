<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// CyberManju OS — cybsh terminal (AGENT-8)
//
// Transport-agnostic: everything goes through the store, which calls
// `invoke()` — so the same panel runs in tauri, rest and wasm builds.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/composables/useTheme'
import { useVoiceInput } from '@/composables/useVoiceInput'
import { correctShellLine, CYBSH_PHRASES } from '@/utils/speechCorrect'
import {
  currentWord,
  ghostSuffix,
  historyTokenHints,
  isVerbPosition,
  loadHistory,
  nextHistoryMatch,
  prevHistoryMatch,
  pushHistory,
  replaceWord,
  saveHistory,
} from '@/utils/shellComplete'

interface Line {
  id: number
  kind: 'in' | 'out' | 'err' | 'sys'
  text: string
  /** SGR segments, computed once at push time — never per frame. */
  segs: Seg[]
}

interface Seg {
  text: string
  color?: string
  bold?: boolean
}

const store = useAppStore()

/** Scrollback cap — a few thousand lines is the 60 fps budget (item 15). */
const MAX_LINES = 2000
const PROMPT = 'cybsh> '

const lines = ref<Line[]>([])
const input = ref('')
/** Shell history: persisted across reloads, prefix-filtered on ↑/↓. */
const history = ref<string[]>(loadHistory())
const histIndex = ref(-1)
const draft = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
/** Caret position for ghost-text gating and word-bound Tab completion. */
const caretPos = ref(0)
const running = computed(() => store.shellBusy)
let lineId = 0

const ANSI_FG = [
  '#d0d0d0', // 30 black — kept light on the black panel
  '#ff5f56', // 31 red
  '#5af78e', // 32 green
  '#f3f99d', // 33 yellow
  '#57c7ff', // 34 blue
  '#ff6ac1', // 35 magenta
  '#9aedfe', // 36 cyan
  '#e6e6e6', // 37 white
]
const ANSI_BRIGHT = ['#808080', '#ff7b72', '#7dff9f', '#faf3a6', '#7fd4ff', '#ff8ed4', '#bff3ff', '#ffffff']

function push(kind: Line['kind'], text: string) {
  if (text === '') return
  lines.value.push({ id: ++lineId, kind, text, segs: segments(text) })
  if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
  void scrollToBottom()
}

/** Split one server line on SGR sequences into renderable segments. */
function segments(text: string): Seg[] {
  const out: Seg[] = []
  const re = /\x1b\[([0-9;]*)m/g
  let color: string | undefined
  let bold = false
  let cursor = 0
  let match: RegExpExecArray | null
  const emit = (chunk: string) => {
    if (chunk) out.push(color || bold ? { text: chunk, color, bold } : { text: chunk })
  }
  while ((match = re.exec(text)) !== null) {
    emit(text.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const codes = (match[1] === '' ? '0' : match[1]).split(';').map(Number)
    for (const code of codes) {
      if (code === 0) {
        color = undefined
        bold = false
      } else if (code === 1) {
        bold = true
      } else if (code === 22) {
        bold = false
      } else if (code === 39) {
        color = undefined
      } else if (code >= 30 && code <= 37) {
        color = ANSI_FG[code - 30]
      } else if (code >= 90 && code <= 97) {
        color = ANSI_BRIGHT[code - 90]
      }
    }
  }
  emit(text.slice(cursor))
  return out
}

async function scrollToBottom() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** Click an output line to copy it — output is selectable text, not an image. */
async function copyLine(line: Line) {
  try {
    await navigator.clipboard.writeText(line.text)
  } catch {
    // Clipboard unavailable (insecure origin) — the text is still selectable.
  }
}

/** Ghost auto-suggest: history first, command table second. Shown only
 *  when the caret is at the end of the line. → or Tab accepts. */
const ghost = computed(() => {
  if (caretPos.value !== input.value.length) return ''
  return ghostSuffix(input.value, history.value, CYBSH_PHRASES)
})

function acceptGhost(): boolean {
  if (!ghost.value) return false
  input.value += ghost.value
  caretPos.value = input.value.length
  nextTick(() => {
    inputEl.value?.setSelectionRange(caretPos.value, caretPos.value)
  })
  return true
}

/**
 * Tab: full-line completion off the live command table (commands AND
 * `disk create`-style subcommands), history-word fallback for arguments,
 * ghost accept when the server has nothing.
 */
async function complete() {
  const caret = caretPos.value
  const prefix = input.value.slice(0, caret)
  if (!prefix.trim()) {
    push('sys', 'Tab completes commands · subcommands (disk …) · history words — type to narrow')
    return
  }
  let hits = await store.completeShellLine(prefix)
  let fromHistory = false
  if (!hits.length) {
    const w = currentWord(prefix, prefix.length)
    if (w && !isVerbPosition(prefix, prefix.length)) {
      hits = historyTokenHints(history.value, w)
      fromHistory = hits.length > 0
    }
  }
  if (!hits.length) {
    if (!acceptGhost()) push('sys', 'no candidates — ↑ walks matching history')
    return
  }
  if (hits.length === 1) {
    const hit = hits[0]
    const atEnd = caret === input.value.length
    if (fromHistory) {
      const next = replaceWord(input.value, caret, hit)
      input.value = next.line
      caretPos.value = next.caret
    } else if (hit === prefix) {
      // Exact verb already typed — advance into its arguments.
      input.value = `${hit} `
      caretPos.value = input.value.length
    } else {
      // Replace everything up to the caret; keep text after the caret only
      // when it starts at a word boundary (otherwise it is the fragment
      // being completed and would double up, e.g. `cre|ate`).
      const after = input.value.slice(caret)
      const keep = after && /^\s/.test(after) ? after : ''
      input.value = hit + (atEnd ? (hit.includes(' ') ? '' : ' ') : keep)
      caretPos.value = atEnd ? input.value.length : hit.length
    }
    nextTick(() => {
      inputEl.value?.setSelectionRange(caretPos.value, caretPos.value)
    })
    return
  }
  push('in', `${PROMPT}${input.value}`)
  push('out', hits.join('   '))
  push('sys', `${hits.length} candidates — keep typing`)
}

async function execAndRender(cmd: string) {
  push('in', `${PROMPT}${cmd}`)
  const result = await store.execShellLine(cmd)
  for (const chunk of result.output.split('\n')) {
    push(result.ok ? 'out' : 'err', chunk)
  }
  if (!result.ok && result.output === '') push('err', 'command failed')
  applyCybshUiEffects(result.output)
  return result
}

/**
 * `.cybsh` OS-interface effects: `theme`/`ui` verbs (and scripts calling
 * them) print machine `ui: theme=<id>` / `ui: accent=<hex|system>` /
 * `ui: density|glass|motion|glow|accent-for=…` lines. Applying them here
 * makes the whole interface change on every transport — the verbs already
 * persist the same intent to the volume mirror + localStorage.
 */
function applyCybshUiEffects(output: string) {
  let touched = false
  try {
    const { setTheme, setAccent, setAccentFor, setDensity, setGlass, setMotion, setGlow, themes } = useTheme()
    for (const raw of output.split('\n')) {
      const line = raw.trim()
      if (!line.startsWith('ui:')) continue
      const rest = line.slice(3).trim()
      const eq = rest.indexOf('=')
      if (eq < 0) continue
      const key = rest.slice(0, eq).trim()
      const value = rest.slice(eq + 1).trim()
      if (key === 'theme' && value in themes) {
        setTheme(value as keyof typeof themes)
        touched = true
      } else if (key === 'accent') {
        if (value === 'system' || value === 'default' || value === 'none') setAccent(null)
        else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) setAccent(value)
        else continue
        touched = true
      } else if (key === 'accent-for') {
        // Per-theme accent: `<theme-id>:<#hex|system>`.
        const sep = value.indexOf(':')
        if (sep < 0) continue
        const themeId = value.slice(0, sep).trim()
        const hex = value.slice(sep + 1).trim()
        if (!(themeId in themes)) continue
        if (hex === 'system' || hex === 'default' || hex === 'none') setAccentFor(themeId, null)
        else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) setAccentFor(themeId, hex)
        else continue
        touched = true
      } else if (key === 'density' && (value === 'compact' || value === 'comfortable')) {
        setDensity(value)
        touched = true
      } else if (key === 'glass' && (value === '0' || value === '1' || value === '2' || value === '3')) {
        setGlass(Number(value) as 0 | 1 | 2 | 3)
        touched = true
      } else if (key === 'motion' && (value === 'auto' || value === 'full' || value === 'reduced')) {
        setMotion(value)
        touched = true
      } else if (key === 'glow') {
        if (value === 'on' || value === 'true' || value === '1') setGlow(true)
        else if (value === 'off' || value === 'false' || value === '0') setGlow(false)
        else continue
        touched = true
      }
    }
  } catch {
    // Theme store unavailable — the persisted intent still applies on reload.
  }
  if (touched) push('sys', 'ui updated from shell effect')
}

async function submit() {
  const line = input.value
  input.value = ''
  histIndex.value = -1
  draft.value = ''
  if (line.trim() === '') {
    push('in', `${PROMPT}`)
    return
  }
  history.value = pushHistory(history.value, line)
  saveHistory(history.value)
  // Client-side dictionary fallback: repair the verb/subcommand before the
  // server ever sees it (`lss→ls`, `disk lis→list`, spoken `see dee→cd`).
  const fix = correctShellLine(line)
  if (fix.fixed) push('sys', `auto-fix: ${fix.fixes.join(', ')}`)
  const effective = fix.line || line
  const result = await execAndRender(effective)
  // Server still confused but names a neighbour? Apply its did-you-mean once
  // instead of making the user retype.
  if (!result.ok && !fix.fixed) {
    const m = /did you mean '([^']+)'/.exec(result.output)
    if (m) {
      const parts = effective.split(' ')
      parts[0] = m[1]
      push('sys', `retrying as '${parts.join(' ')}'`)
      await execAndRender(parts.join(' '))
    }
  }
  input.value = ''
  void scrollToBottom()
}

/** Multi-line paste: submit each complete line, keep the last fragment. */
async function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (!text.includes('\n')) return
  event.preventDefault()
  const parts = text.split(/\r?\n/)
  const hasTrailing = parts[parts.length - 1] === ''
  const queue = parts.slice(0, -1)
  const tail = hasTrailing ? '' : parts[parts.length - 1]
  for (const cmd of queue) {
    input.value = cmd
    await submit()
  }
  input.value = tail
}

function trackCaret(el: HTMLInputElement | null) {
  caretPos.value = el?.selectionStart ?? input.value.length
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    trackCaret(event.target as HTMLInputElement)
    void complete()
    return
  }
  if (event.key === 'ArrowRight' && ghost.value) {
    const el = event.target as HTMLInputElement
    if ((el.selectionStart ?? 0) >= input.value.length) {
      event.preventDefault()
      acceptGhost()
      return
    }
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    input.value = ''
    histIndex.value = -1
    draft.value = ''
    caretPos.value = 0
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (history.value.length === 0) return
    if (histIndex.value === -1) {
      draft.value = input.value
      histIndex.value = prevHistoryMatch(history.value, draft.value, history.value.length - 1)
    } else {
      const i = prevHistoryMatch(history.value, draft.value, histIndex.value - 1)
      if (i !== -1) histIndex.value = i
    }
    if (histIndex.value !== -1) {
      input.value = history.value[histIndex.value] ?? ''
      caretPos.value = input.value.length
      nextTick(() => {
        inputEl.value?.setSelectionRange(caretPos.value, caretPos.value)
      })
    }
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (histIndex.value === -1) return
    const i = nextHistoryMatch(history.value, draft.value, histIndex.value + 1)
    if (i !== -1) {
      histIndex.value = i
      input.value = history.value[histIndex.value] ?? ''
    } else {
      histIndex.value = -1
      input.value = draft.value
    }
    caretPos.value = input.value.length
    nextTick(() => {
      inputEl.value?.setSelectionRange(caretPos.value, caretPos.value)
    })
    return
  }
  // Ctrl+C — abandon the line being typed (the job itself is `kill <id>`).
  if (event.key === 'c' && event.ctrlKey) {
    event.preventDefault()
    push('in', `${PROMPT}${input.value}^C`)
    input.value = ''
  }
}

function focusInput() {
  inputEl.value?.focus()
}

// External inserts (voice dictation) land at the end — keep the caret
// model in sync when the user is typing in the field.
watch(input, () => {
  if (document.activeElement === inputEl.value && inputEl.value) {
    caretPos.value = inputEl.value.selectionStart ?? input.value.length
  } else {
    caretPos.value = input.value.length
  }
})

// Provider sync auto-update: a finished run re-fetches the file manager +
// volume `df` in the store, and the terminal prints the summary as a `sys`
// notice so the next `ls`/`df` visibly includes the synced data.
watch(() => store.lastSyncAt, (at) => {
  if (!at) return
  push('sys', store.lastSyncSummary || 'sync finished — file manager + terminal refreshed')
})

/* ── voice input (shell mode: verbs + symbols, corrected on insert) ── */
const voice = useVoiceInput('shell')
let stopVoice: (() => void) | null = null
function toggleVoice() {
  if (voice.listening.value) {
    stopVoice?.()
    stopVoice = null
    focusInput()
    return
  }
  stopVoice = voice.dictateInto(input)
}

onBeforeUnmount(() => {
  stopVoice?.()
})

onMounted(async () => {
  push('sys', `cybsh — \`help\` lists commands · TAB completes (→ accepts the grey hint) · ↑/↓ walks matching history · ESC clears`)
  if (store.osWorkers === null) await store.fetchOsWorkers()
  focusInput()
  void scrollToBottom()
})
</script>

<template>
  <div class="terminal-panel" @click="focusInput">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-terminal"><AppIcon name="solar:file-terminal-bold" /></span>
        <h2 class="panel-title">Terminal</h2>
        <span class="job-badge" :class="{ on: running }">{{ running ? 'Busy' : 'Idle' }}</span>
      </div>
      <div class="header-right">
        <button class="ghost-btn" type="button" @click="lines = []">Clear</button>
      </div>
    </div>

    <div ref="scrollEl" class="term-scroll" role="log" aria-label="cybsh output">
      <div
        v-for="line in lines"
        :key="line.id"
        class="term-line"
        :class="`kind-${line.kind}`"
        tabindex="0"
        :title="'Click to copy'"
        @click.stop="copyLine(line)"
      >
        <span v-for="(seg, i) in line.segs" :key="i" :style="{ color: seg.color, fontWeight: seg.bold ? 700 : 400 }">{{ seg.text }}</span>
      </div>
    </div>

    <div class="term-input-row">
      <span class="term-prompt">{{ PROMPT }}</span>
      <div class="term-input-wrap">
        <div class="term-ghost" aria-hidden="true"><span class="ghost-hide">{{ input }}</span><span class="ghost-show">{{ ghost }}</span></div>
        <input
          ref="inputEl"
          v-model="input"
          class="term-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label="cybsh command"
          @keydown="onKeydown"
          @keydown.enter.prevent="submit"
          @keyup="trackCaret($event.target as HTMLInputElement)"
          @click="trackCaret($event.target as HTMLInputElement)"
          @paste="onPaste"
        />
      </div>
      <select
        v-if="voice.isSupported.value"
        class="ghost-select"
        :value="voice.lang.value"
        aria-label="Voice language"
        title="Voice language: English (EN) or Portuguese (PT-BR)"
        @change="voice.setLang(($event.target as HTMLSelectElement).value as 'en-US' | 'pt-BR')"
      >
        <option value="en-US">EN</option>
        <option value="pt-BR">PT</option>
      </select>
      <button
        v-if="voice.isSupported.value"
        class="ghost-btn"
        type="button"
        :title="voice.listening.value ? `Listening… ${voice.interim.value}` : 'Voice command (typos auto-fixed)'"
          @click="toggleVoice"
        >{{ voice.listening.value ? 'Stop' : 'Dictate' }}</button>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: var(--ui-font-mono);
  font-size: 13px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border);
  flex: 0 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-terminal {
  color: var(--ui-accent);
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.job-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--ui-radius-full);
  border: 1px solid var(--ui-border);
  color: var(--ui-text-3);
}

.job-badge.on {
  color: var(--ui-warning);
  border-color: var(--ui-warning);
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  font-family: inherit;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}

.ghost-btn:hover {
  color: var(--ui-text);
  border-color: var(--ui-border-strong);
}

.ghost-select {
  background: transparent;
  border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 6px;
  cursor: pointer;
}

.term-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-gutter: stable;
  padding: 8px 12px;
  /* `strict` included size containment, which fights the flex layout and
     can pin the scroll height so new lines never become reachable.
     Layout + paint containment keeps the 60fps budget without that. */
  contain: layout paint;
}

.term-scroll::-webkit-scrollbar {
  width: 10px;
}

.term-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  border-radius: var(--ui-radius-full);
  border: 3px solid transparent;
  background-clip: content-box;
}

.term-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-accent);
  background-clip: content-box;
  border: 2px solid transparent;
}

.term-line {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  cursor: copy;
  min-height: 1.45em;
}

.term-line:focus {
  outline: 1px solid color-mix(in srgb, var(--ui-accent) 50%, transparent);
}

.kind-in {
  color: var(--ui-info);
}

.kind-out {
  color: var(--ui-text);
}

.kind-err {
  color: var(--ui-danger);
}

.kind-sys {
  color: color-mix(in srgb, var(--ui-text) 40%, transparent);
  font-style: italic;
}

.term-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--ui-border);
  flex: 0 0 auto;
}

.term-prompt {
  color: var(--ui-accent);
}

.term-input {
  flex: 1;
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 13px;
  position: relative;
  z-index: 1;
  padding: 0;
}

/* Ghost auto-suggest: the invisible current text keeps metrics identical
 * so the grey remainder aligns exactly with the real caret. */
.term-input-wrap {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
}

.term-ghost {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  font-family: inherit;
  font-size: 13px;
  white-space: pre;
  overflow: hidden;
}

.ghost-hide {
  visibility: hidden;
}

.ghost-show {
  color: color-mix(in srgb, var(--ui-text) 35%, transparent);
}

@media (max-width: 560px) {
  .term-input-row { padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .term-input { font-size: 16px; }
  .term-ghost { font-size: 16px; }
  .ghost-btn { min-height: 44px; padding: 6px 12px; }
  .term-scroll { padding: 6px 8px; }
}
</style>
