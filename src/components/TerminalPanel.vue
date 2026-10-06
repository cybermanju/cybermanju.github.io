<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// CyberManju OS — cybsh terminal (AGENT-8)
//
// Transport-agnostic: everything goes through the store, which calls
// `invoke()` — so the same panel runs in tauri, rest and wasm builds.
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'

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
const history = ref<string[]>([])
const histIndex = ref(-1)
const draft = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
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

function currentWord(): string {
  const upto = input.value.slice(0, caretWordStart())
  return upto
}

function caretWordStart(): number {
  const before = input.value
  const idx = before.search(/\s[^\s]*$/)
  return idx === -1 ? 0 : idx + 1
}

/** Tab: complete from the live command table, listing on ambiguity. */
async function complete() {
  const word = currentWord()
  const hits = await store.completeShellLine(word)
  if (hits.length === 1) {
    const start = caretWordStart()
    input.value = input.value.slice(0, start) + hits[0]
    return
  }
  if (hits.length > 1) {
    push('in', `${PROMPT}${input.value}`)
    push('out', hits.join('   '))
    push('sys', `${hits.length} candidates — keep typing`)
  }
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
  if (history.value[history.value.length - 1] !== line) history.value.push(line)
  if (history.value.length > 500) history.value.splice(0, history.value.length - 500)
  push('in', `${PROMPT}${line}`)
  const result = await store.execShellLine(line)
  for (const chunk of result.output.split('\n')) {
    push(result.ok ? 'out' : 'err', chunk)
  }
  if (!result.ok && result.output === '') push('err', 'command failed')
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    void complete()
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (history.value.length === 0) return
    if (histIndex.value === -1) {
      draft.value = input.value
      histIndex.value = history.value.length - 1
    } else if (histIndex.value > 0) {
      histIndex.value -= 1
    }
    input.value = history.value[histIndex.value] ?? ''
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (histIndex.value === -1) return
    if (histIndex.value < history.value.length - 1) {
      histIndex.value += 1
      input.value = history.value[histIndex.value] ?? ''
    } else {
      histIndex.value = -1
      input.value = draft.value
    }
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

onMounted(async () => {
  push('sys', `cybsh — type \`help\` for the command table · TAB completes · ↑/↓ walks history`)
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
        <h2 class="panel-title">CYBSH</h2>
        <span class="job-badge" :class="{ on: running }">{{ running ? 'BUSY' : 'IDLE' }}</span>
      </div>
      <div class="header-right">
        <button class="ghost-btn" type="button" @click="lines = []">CLEAR</button>
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
        @paste="onPaste"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  letter-spacing: 2px;
}

.job-badge {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid var(--ui-border);
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
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

.term-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 12px;
  contain: strict;
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
  background: transparent;
  border: none;
  outline: none;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 13px;
}
</style>
