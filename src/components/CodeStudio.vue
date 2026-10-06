<template>
  <div ref="rootRef" class="cs" tabindex="0" @keydown="onGlobalKey">
    <div class="cs-aurora" aria-hidden="true" />

    <!-- ══ TOP: window-ish toolbar ══ -->
    <header class="cs-top">
      <div class="cs-logo"><AppIcon name="solar:file-code-bold" :size="14" /><b>STUDIO</b></div>
      <span class="cs-transport">{{ transportLabel }}</span>
      <span v-if="focusTab?.parse" class="cs-engine" :class="{ ts: focusTab.parse.engine === 'tree-sitter' }" :title="focusTab.parse.engine === 'tree-sitter' ? 'Real grammar parse' : 'Heuristic fallback'">
        {{ (focusTab.parse.engine || 'heuristic').toUpperCase() }}
      </span>
      <span class="cs-spacer" />
      <button class="cs-btn" :disabled="!focusTab || saving" title="Save (Ctrl+S)" @click="saveTab(focusTab)"><AppIcon name="solar:diskette-bold" :size="13" /> {{ saving ? 'Saving…' : 'Save' }}</button>
      <button class="cs-btn" :disabled="!focusTab" title="Split editor right" @click="splitRight"><AppIcon name="solar:columns-3-bold" :size="13" /> Split</button>
      <button class="cs-btn" :class="{ on: aiOpen }" title="Toggle AI panel (Ctrl+G)" @click="aiOpen = !aiOpen"><AppIcon name="solar:bot-bold" :size="13" /> AI</button>
      <button class="cs-btn" :class="{ on: bottomOpen }" title="Toggle panel (Ctrl+`)" @click="bottomOpen = !bottomOpen"><AppIcon name="solar:file-terminal-bold" :size="13" /> Panel</button>
    </header>

    <div class="cs-mid">
      <!-- ══ ACTIVITY BAR ══ -->
      <nav class="cs-activity" aria-label="Views">
        <button v-for="a in activities" :key="a.id" :class="{ active: sideView === a.id }" :title="a.label" @click="sideView = sideView === a.id ? '' : a.id">
          <AppIcon :name="a.icon" :size="17" />
        </button>
        <span class="cs-spacer" />
        <button :class="{ active: false }" title="Full agent panel" @click="wm.open('agent')"><AppIcon name="solar:chat-square-bold" :size="17" /></button>
        <button title="Settings" @click="wm.open('settings')"><AppIcon name="solar:settings-bold" :size="17" /></button>
      </nav>

      <!-- ══ SIDEBAR ══ -->
      <aside v-if="sideView" class="cs-side">
        <!-- FILES -->
        <template v-if="sideView === 'files'">
          <div class="cs-side-h">EXPLORER
            <span class="cs-spacer" />
            <button class="cs-ibtn" title="Refresh" @click="refreshExplorer"><AppIcon name="solar:refresh-bold" :size="12" /></button>
            <button v-if="isWasm" class="cs-ibtn" title="New file here" @click="wasmNewShow = !wasmNewShow"><AppIcon name="solar:add-bold" :size="12" /></button>
          </div>
          <input v-model="explorerFilter" class="cs-input" placeholder="Filter files…" spellcheck="false" />
          <div v-if="isWasm" class="cs-pathrow">
            <button class="cs-ibtn" :disabled="wasmCwd === '/'" title="Up" @click="wasmUp"><AppIcon name="solar:arrow-up-bold" :size="12" /></button>
            <span class="mono dim truncate">{{ wasmCwd }}</span>
          </div>
          <div v-if="isWasm && wasmNewShow" class="cs-pathrow">
            <input v-model="newFileName" class="cs-input" placeholder="new-file.txt" spellcheck="false" @keyup.enter="createWasmFile" />
            <button class="cs-btn xs" @click="createWasmFile">Create</button>
          </div>
          <div class="cs-tree">
            <template v-if="!isWasm">
              <TreeRow v-for="n in treeRoots" :key="n.id" :node="n" :depth="0" :active-key="focusTab?.key" @open="openNode" />
              <p v-if="!treeRoots.length" class="dim cs-empty">No editable text files (≤1 MiB, unencrypted).</p>
            </template>
            <template v-else>
              <button v-for="e in wasmEntriesFiltered" :key="e.key" class="cs-trow" :class="{ active: e.key === focusTab?.key, dir: e.isDir }" @click="e.isDir ? navigateWasm(e.path) : openWasmPath(e.path, e.label)" @dblclick="e.isDir ? navigateWasm(e.path) : openWasmPath(e.path, e.label)">
                <AppIcon :name="e.isDir ? 'solar:folder-bold' : 'solar:file-bold'" :size="13" />
                <span class="truncate">{{ e.label }}</span>
              </button>
              <p v-if="!wasmEntriesFiltered.length" class="dim cs-empty">Empty directory.</p>
            </template>
          </div>
        </template>

        <!-- SEARCH -->
        <template v-else-if="sideView === 'search'">
          <div class="cs-side-h">SEARCH</div>
          <input v-model="searchQuery" class="cs-input" placeholder="Search contents…" spellcheck="false" @keyup.enter="runSearch" />
          <div class="cs-tree">
            <button v-for="r in store.searchResults" :key="r.fileId" class="cs-trow col" @click="openSearchResult(r.fileId)">
              <span class="truncate"><b>{{ r.fileName }}</b></span>
              <span v-if="r.snippet" class="dim cs-snip">{{ r.snippet.slice(0, 120) }}</span>
            </button>
            <p v-if="store.isSearching" class="dim cs-empty">Searching…</p>
            <p v-else-if="searchQuery && !store.searchResults.length" class="dim cs-empty">No matches.</p>
            <p v-else-if="!searchQuery" class="dim cs-empty">Tantivy BM25 over file contents.</p>
          </div>
        </template>

        <!-- OUTLINE -->
        <template v-else-if="sideView === 'outline'">
          <div class="cs-side-h">OUTLINE · {{ outlineSymbols.length }}</div>
          <input v-model="outlineFilter" class="cs-input" placeholder="Filter symbols…" spellcheck="false" />
          <div class="cs-tree">
            <button v-for="s in outlineSymbols" :key="s.name + s.startLine" class="cs-trow" @click="jumpToLine(s.startLine)">
              <span class="cs-kind">{{ s.kind }}</span>
              <span class="truncate">{{ s.name }}</span>
              <span class="dim mono">:{{ s.startLine }}</span>
            </button>
            <p v-if="!outlineSymbols.length" class="dim cs-empty">{{ focusTab?.parse ? 'No symbols.' : 'Open a file to parse.' }}</p>
          </div>
        </template>

        <!-- SESSIONS -->
        <template v-else>
          <div class="cs-side-h">AI SESSIONS · {{ ai.sessions.value.length }}</div>
          <div class="cs-tree">
            <button v-for="s in ai.sessions.value" :key="s.id" class="cs-trow col" :class="{ active: ai.viewing.value?.id === s.id }" @click="ai.loadSession(s.id)">
              <span class="truncate"><b>{{ s.title }}</b></span>
              <span class="dim">{{ s.model }} · {{ s.messages.length }} msgs</span>
            </button>
            <p v-if="!ai.sessions.value.length" class="dim cs-empty">No sessions yet — ask the AI.</p>
          </div>
        </template>
      </aside>

      <!-- ══ EDITOR COLUMN ══ -->
      <section class="cs-edcol">
        <div class="cs-groups" :class="{ split: groupBKey }">
          <!-- GROUP A -->
          <div class="cs-group">
            <div class="cs-tabs">
              <div v-for="t in tabs" :key="'a' + t.key" class="cs-tab" :class="{ active: t.key === groupAKey, dirty: t.dirty }" @click="activate(t.key, 'a')">
                <span v-if="t.dirty" class="cs-dot">●</span>
                <span class="truncate">{{ t.label }}</span>
                <button class="cs-x" title="Close" @click.stop="closeTab(t.key)"><AppIcon name="solar:close-bold" :size="10" /></button>
              </div>
            </div>
            <EditorPane v-if="tabA" :key="'a:' + tabA.key" :tab="tabA" group="a" @cursor="onCursor" @edit="onEdit(tabA)" />
            <div v-else class="cs-welcome">
              <AppIcon name="solar:file-code-bold" :size="34" />
              <p>Open a file from the Explorer</p>
              <span class="dim">Ctrl+S saves (versions snapshot) · Ctrl+F finds · Ctrl+G splits AI in</span>
            </div>
          </div>
          <!-- GROUP B -->
          <div v-if="groupBKey" class="cs-group">
            <div class="cs-tabs">
              <div class="cs-tab active">
                <span v-if="tabB?.dirty" class="cs-dot">●</span>
                <span class="truncate">{{ tabB?.label }}</span>
                <span class="cs-spacer" />
                <button class="cs-x" title="Close split" @click="groupBKey = null"><AppIcon name="solar:close-bold" :size="10" /></button>
              </div>
            </div>
            <EditorPane v-if="tabB" :key="'b:' + tabB.key" :tab="tabB" group="b" @cursor="onCursor" @edit="onEdit(tabB!)" />
          </div>
        </div>

        <!-- FIND BAR -->
        <div v-if="findOpen" class="cs-find">
          <input ref="findRef" v-model="findQuery" class="cs-input" placeholder="Find…" spellcheck="false" @keyup.enter="findNext(1)" />
          <input v-model="replaceQuery" class="cs-input" placeholder="Replace…" spellcheck="false" @keyup.enter="replaceOne" />
          <span class="dim mono">{{ findCount ? `${findIndex + 1}/${findCount}` : '' }}</span>
          <button class="cs-btn xs" @click="findNext(1)">Next</button>
          <button class="cs-btn xs" @click="findNext(-1)">Prev</button>
          <button class="cs-btn xs" @click="replaceOne">Replace</button>
          <button class="cs-btn xs" @click="replaceAll">All</button>
          <button class="cs-ibtn" title="Go to line" @click="gotoOpen = !gotoOpen">:ln</button>
          <input v-if="gotoOpen" v-model="gotoLine" class="cs-input sm" placeholder="line…" @keyup.enter="jumpToLine(Number(gotoLine))" />
          <button class="cs-ibtn" @click="findOpen = false"><AppIcon name="solar:close-bold" :size="12" /></button>
        </div>

        <!-- BOTTOM PANEL -->
        <div v-if="bottomOpen" class="cs-bottom">
          <div class="cs-btabs">
            <button :class="{ active: bottomTab === 'term' }" @click="bottomTab = 'term'">TERMINAL</button>
            <button :class="{ active: bottomTab === 'problems' }" @click="bottomTab = 'problems'">PROBLEMS · {{ problems.length }}</button>
            <span class="cs-spacer" />
            <button class="cs-ibtn" @click="bottomOpen = false"><AppIcon name="solar:close-bold" :size="12" /></button>
          </div>
          <div v-if="bottomTab === 'term'" class="cs-termwrap">
            <div ref="termScrollRef" class="cs-term">
              <div v-for="l in termLines" :key="l.id" class="cs-terml" :class="l.kind">{{ l.text }}</div>
            </div>
            <form class="cs-termin" @submit.prevent="submitTerm">
              <span class="mono">❯</span>
              <input v-model="termInput" class="mono" :placeholder="`cybsh in ${termCwd}…`" aria-label="Terminal input" />
            </form>
          </div>
          <div v-else class="cs-problems">
            <div v-for="p in problems" :key="p.key" class="cs-prow" @click="p.tab && activate(p.tab, 'a'); p.line && jumpToLine(p.line)">
              <span class="cs-pkind" :class="p.sev">{{ p.sev }}</span>
              <span class="truncate">{{ p.text }}</span>
              <span class="dim mono">{{ p.where }}</span>
            </div>
            <p v-if="!problems.length" class="dim cs-empty">No problems — parses clean, all tabs saved.</p>
          </div>
        </div>

        <!-- STATUS BAR -->
        <footer class="cs-status">
          <span>Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
          <span class="dim">{{ focusTab?.language || '—' }}</span>
          <span v-if="crumbPath" class="dim truncate hide-mid" :title="crumbPath">{{ crumbPath }}</span>
          <span class="cs-spacer" />
          <span v-if="focusTab" :class="focusTab.dirty ? 'cs-warn' : 'dim'">{{ focusTab.dirty ? '● unsaved' : 'saved ✓' }}</span>
          <span class="dim">{{ focusTab?.content.length ?? 0 }} B</span>
          <span class="cs-aistat" :class="{ run: ai.jobActive.value }" :title="ai.jobLine.value || 'AI idle'">
            <AppIcon name="solar:bot-bold" :size="11" /> {{ ai.jobActive.value ? ai.jobLine.value : 'AI ready' }}
          </span>
        </footer>
      </section>

      <!-- ══ AI PANEL ══ -->
      <aside v-if="aiOpen" class="cs-ai">
        <div class="cs-ai-h">
          <AppIcon name="solar:bot-bold" :size="14" /><b>AI · {{ ai.chatConfig.value?.name || 'no config' }}</b>
          <span class="cs-spacer" />
          <button class="cs-ibtn" title="Open full agent panel" @click="wm.open('agent')"><AppIcon name="solar:chat-square-bold" :size="12" /></button>
          <button class="cs-ibtn" title="Close AI" @click="aiOpen = false"><AppIcon name="solar:close-bold" :size="12" /></button>
        </div>
        <div class="cs-ai-cfg">
          <select v-model="ai.chatConfigId.value" class="cs-select" aria-label="Agent config">
            <option value="">— pick agent config —</option>
            <option v-for="c in ai.configs.value" :key="c.id" :value="c.id">{{ c.name }} · {{ c.model }}</option>
          </select>
          <button class="cs-btn xs" title="New session" @click="ai.newSession">New</button>
        </div>
        <div v-if="!ai.configs.value.length" class="cs-ai-note">
          No agent configs. <button class="cs-link" @click="wm.open('agent')">Set one up in Agent →</button>
        </div>
        <div v-if="ai.wasmMode.value && ai.chatConfig.value && !hasLocalKey" class="cs-ai-note">
          Browser loop needs the key (memory only):
          <form @submit.prevent="sealKey"><input v-model="keyInput" type="password" class="cs-input" placeholder="paste API key…" /><button class="cs-btn xs" type="submit">Seal</button></form>
        </div>
        <div v-if="ai.viewing.value" class="cs-ai-meta mono dim">
          {{ ai.viewing.value.title }} · ctx ~{{ fmtTok(ai.contextTokens.value) }}/{{ fmtTok(ai.contextWindow.value) }}
          <span v-if="ai.costUsd.value != null"> · ~${{ ai.costUsd.value.toFixed(2) }}</span>
          <div class="cs-ctxbar"><i :style="{ width: ai.contextPct.value + '%' }" :class="ai.contextPct.value >= 85 ? 'bad' : ai.contextPct.value >= 60 ? 'warn' : ''" /></div>
        </div>

        <div ref="threadRef" class="cs-thread">
          <template v-for="row in ai.threadRows.value" :key="row.key">
            <div v-if="row.kind === 'message'" class="cs-msg" :class="'r-' + row.message.role">
              <div class="cs-role dim">{{ roleLabel(row.message) }}</div>
              <div v-if="row.message.role === 'assistant' && row.message.content" class="cs-md" v-html="renderMarkdown(row.message.content)" />
              <div v-else-if="row.message.content" class="cs-body">{{ row.message.content }}</div>
              <div v-else class="cs-toolblock">{{ toolNameOf(row.message) }}</div>
            </div>
            <div v-else class="cs-tgroup">
              <div v-if="row.lead" class="cs-md" v-html="renderMarkdown(row.lead)" />
              <div v-for="t in row.rows" :key="t.key" class="cs-trow2" :class="['is-' + t.state, { open: openRows.has(t.key) }]">
                <button class="cs-thead" @click="toggleRow(t.key)">
                  <AppIcon :name="toolMeta(t.name).icon" :size="11" />
                  <span class="truncate">{{ t.title }}</span>
                  <span class="cs-tstate">{{ t.state }}</span>
                </button>
                <div v-if="openRows.has(t.key) || t.state === 'running'" class="cs-tdetail">
                  <pre>{{ prettyTool(t) }}</pre>
                  <pre v-if="t.result" class="res">{{ t.result.slice(0, 1200) }}</pre>
                  <span v-else-if="t.state === 'running'" class="dim mono">waiting for result…</span>
                </div>
              </div>
            </div>
          </template>
          <p v-if="!ai.threadRows.value.length" class="dim cs-empty">Ask about this file — attach it with @file.</p>
        </div>

        <div v-if="ai.pendingApproval.value" class="cs-approval">
          <div class="cs-apph"><AppIcon name="solar:shield-check-bold" :size="12" /> {{ ai.pendingApproval.value.question ? 'NEEDS YOUR ANSWER' : 'APPROVAL' }}</div>
          <div class="cs-apptext">{{ ai.pendingApproval.value.question || ai.pendingApproval.value.summary }}</div>
          <pre v-if="!ai.pendingApproval.value.question" class="cs-appinput">{{ approvalInput }}</pre>
          <input v-if="ai.pendingApproval.value.question" v-model="ai.answerInput.value" class="cs-input" placeholder="Type answer…" @keyup.enter="ai.answer(true)" />
          <div class="cs-approw">
            <button class="cs-btn xs primary" @click="ai.answer(true)">Allow</button>
            <button v-if="!ai.pendingApproval.value.question" class="cs-btn xs" @click="ai.answer(true, true)">Always</button>
            <button class="cs-btn xs danger" @click="ai.answer(false)">Deny</button>
          </div>
        </div>

        <div v-if="ai.queue.value.length" class="cs-queue">
          <span v-for="(q, qi) in ai.queue.value" :key="qi" class="cs-qitem" :title="q">
            <span class="truncate">{{ q.slice(0, 90) }}</span>
            <button class="cs-ibtn" title="Drop queued prompt" @click="ai.dropQueued(qi)"><AppIcon name="solar:close-bold" :size="10" /></button>
          </span>
        </div>
        <div class="cs-quick">
          <button :class="{ on: attachFile }" title="Attach active file to next prompt" @click="attachFile = !attachFile">@file{{ focusTab ? ':' + shortName(focusTab.label) : '' }}</button>
          <button :class="{ on: attachSel }" :disabled="!selection" title="Attach current selection" @click="attachSel = !attachSel">@sel{{ selection ? ` (${selection.length}B)` : '' }}</button>
          <button title="Explain this file" @click="quick('explain')">Explain</button>
          <button title="Review for bugs" @click="quick('review')">Review</button>
          <button title="Apply last code block to file" @click="applyLastBlock">Apply ⤵</button>
        </div>
        <form class="cs-prompt" @submit.prevent="sendPrompt">
          <textarea ref="promptEl" v-model="promptInput" rows="2" :placeholder="ai.jobActive.value ? 'Running — Ctrl+Enter queues next…' : 'Ask the AI… (Ctrl+Enter sends)'" @keydown.ctrl.enter.exact.prevent="sendPrompt" @keydown.meta.enter.exact.prevent="sendPrompt" />
          <button v-if="voice.isSupported.value" class="cs-btn xs" :class="{ on: voice.listening.value }" type="button" :title="voice.listening.value ? `Listening… ${voice.interim.value}` : 'Dictate (code mode: say “open paren”, “dot”, “camel case …”)'" @click="toggleVoice">{{ voice.listening.value ? 'Stop' : 'Mic' }}</button>
          <button class="cs-btn xs primary" type="submit" :disabled="!canSend">{{ ai.jobActive.value ? 'Queue' : 'Send' }}</button>
          <button v-if="ai.jobActive.value" class="cs-btn xs danger" type="button" @click="ai.abort()">Stop</button>
        </form>
        <div v-if="ai.jobLine.value" class="mono dim cs-jobline">{{ ai.jobLine.value }}</div>
        <div v-if="ai.jobError.value" class="cs-err" :title="ai.jobHint.value">{{ ai.jobError.value.slice(0, 200) }}</div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, h, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { useStudioAgent, type FileCtx } from '@/composables/useStudioAgent'
import { invoke, isTauri, isStaticHost } from '@/composables/useTauri'
import { escapeHtml, renderMarkdown } from '@/utils/markdown'
import { checkBrackets, detectLanguage, highlightSyntax } from '@/utils/codeDetect'
import { correctShellLine } from '@/utils/speechCorrect'
import { useVoiceInput } from '@/composables/useVoiceInput'
import { trackShellCwd } from '@/utils/shellCwd'
import { toolMeta } from '@/utils/agentUi'
import type { CodeSymbol, FileNode, ParseResult } from '@/types'

/* ═══════════════ tabs / editor core ═══════════════ */

interface Tab {
  key: string
  label: string
  kind: 'managed' | 'wasm'
  fileId: string
  path: string
  language: string
  content: string
  savedContent: string
  dirty: boolean
  parse: ParseResult | null
  pinned?: boolean
}

const store = useAppStore()
const wm = useWindowManager()
const ai = useStudioAgent()

const isDesktop = isTauri()
const isWasm = computed(() => {
  try { return isStaticHost() } catch { return false }
})
const transportLabel = computed(() => (isDesktop ? 'DESKTOP' : isWasm.value ? 'WASM LOCAL' : 'WEB / REST'))

const tabs = ref<Tab[]>([])
const groupAKey = ref('')
const groupBKey = ref<string | null>(null)
const activeGroup = ref<'a' | 'b'>('a')
const tabA = computed(() => tabs.value.find(t => t.key === groupAKey.value) ?? null)
const tabB = computed(() => (groupBKey.value ? tabs.value.find(t => t.key === groupBKey.value) ?? null : null))
const focusTab = computed(() => (activeGroup.value === 'b' ? tabB.value ?? tabA.value : tabA.value))

const MAX_EDIT_BYTES = 1024 * 1024
const CODE_EXTS = new Set(['rs','ts','tsx','js','jsx','py','go','c','h','cpp','hpp','cc','java','rb','swift','kt','html','htm','css','scss','less','json','toml','yaml','yml','md','mdx','sql','sh','bash','zsh','lua','zig','ex','vue','svelte','dart','txt','log','ini','cfg'])
const extOf = (n: string) => { const p = n.toLowerCase().split('.'); return p.length > 1 ? p[p.length - 1] : '' }
const shortName = (n: string) => (n.length > 18 ? '…' + n.slice(-17) : n)
function isEditableNode(n: FileNode): boolean {
  if (n.fileType !== 'file' || n.encrypted) return false
  if (n.sizeBytes > MAX_EDIT_BYTES) return false
  const m = n.mimeType ?? ''
  if (m.startsWith('text/') || m === 'application/json') return true
  return CODE_EXTS.has(extOf(n.name))
}

/* ═══════════════ explorer tree (managed) ═══════════════ */

const sideView = ref('files')
const activities = [
  { id: 'files', label: 'Explorer', icon: 'solar:folder-bold' },
  { id: 'search', label: 'Search', icon: 'solar:magnifier-bold' },
  { id: 'outline', label: 'Outline', icon: 'solar:folder-tree-bold' },
  { id: 'sessions', label: 'AI sessions', icon: 'solar:chat-square-bold' },
]
const explorerFilter = ref('')
const editableFiles = computed(() => {
  const q = explorerFilter.value.trim().toLowerCase()
  return store.files.filter(n => isEditableNode(n)).filter(n => !q || n.name.toLowerCase().includes(q))
})
interface TreeNode extends FileNode { kids: TreeNode[] }
const treeRoots = computed<TreeNode[]>(() => {
  const map = new Map<string, TreeNode>()
  for (const f of editableFiles.value) map.set(f.id, { ...f, kids: [] })
  const roots: TreeNode[] = []
  for (const n of map.values()) {
    const p = n.parentId && map.get(n.parentId)
    if (p) p.kids.push(n)
    else if (n.fileType === 'folder' || !n.parentId) roots.push(n)
    else {
      // parent folder itself isn't editable (or hidden) — still show the file at root
      roots.push(n)
    }
  }
  const sort = (xs: TreeNode[]) => xs.sort((a, b) => ((b.fileType === 'folder') as unknown as number) - ((a.fileType === 'folder') as unknown as number) || a.name.localeCompare(b.name)).forEach(n => sort(n.kids))
  sort(roots)
  return roots
})

// Explicit annotation: the component references itself for folder recursion,
// and without it vue-tsc infers a circular `any` (TS7022/TS7024). The stable
// identity also keeps per-folder collapse state across explorer re-renders.
const TreeRow: ReturnType<typeof defineComponent> = defineComponent({
  name: 'TreeRow',
  props: {
    node: { type: Object as PropType<TreeNode>, required: true },
    depth: { type: Number, default: 0 },
    activeKey: { type: String, default: '' },
  },
  emits: ['open'],
  setup(props, { emit }) {
    const collapsed = ref(props.depth > 1)
    const isDir = computed(() => props.node.fileType === 'folder')
    const isActive = computed(() => props.node.id === (props.activeKey ?? '').replace(/^m:/, ''))
    const onRow = () => {
      if (isDir.value) collapsed.value = !collapsed.value
      else emit('open', props.node)
    }
    return () =>
      h('div', { class: 'cs-tbranch' }, [
        h('button', {
          class: ['cs-trow', { dir: isDir.value, active: isActive.value }],
          style: { paddingLeft: `${6 + props.depth * 12}px` },
          onClick: onRow,
          onDblclick: onRow,
        }, [
          h('span', { class: 'cs-caret' }, isDir.value ? (collapsed.value ? '▸' : '▾') : ''),
          h('span', { class: 'cs-ticon' }, isDir.value ? '📁' : '📄'),
          h('span', { class: 'truncate' }, props.node.name),
        ]),
        isDir.value && !collapsed.value
          ? props.node.kids.map(k =>
              h(TreeRow, { node: k, depth: props.depth + 1, activeKey: props.activeKey, onOpen: (n: FileNode) => emit('open', n) }),
            )
          : null,
      ])
  },
})

async function openNode(n: FileNode) {
  if (n.fileType === 'folder') return
  const key = `m:${n.id}`
  const existing = tabs.value.find(t => t.key === key)
  if (existing) { activate(key, activeGroup.value); return }
  const res = await store.readManagedContent(n.id)
  if (!res) return
  tabs.value.push({ key, label: n.name, kind: 'managed', fileId: n.id, path: n.id, language: detectLanguage(n.name, res.content).language, content: res.content, savedContent: res.content, dirty: false, parse: null })
  activate(key, activeGroup.value)
  void reparse(tabs.value[tabs.value.length - 1])
}

function activate(key: string, group: 'a' | 'b') {
  activeGroup.value = group
  if (group === 'a') groupAKey.value = key
  else groupBKey.value = key
  nextTick(() => updateCursorFromDom())
}
function closeTab(key: string) {
  const i = tabs.value.findIndex(t => t.key === key)
  if (i === -1) return
  tabs.value.splice(i, 1)
  if (groupBKey.value === key) groupBKey.value = null
  if (groupAKey.value === key) {
    // Prefer the neighbour, but never mirror the split group.
    const cands = [tabs.value[i - 1], tabs.value[i], ...tabs.value].filter((t): t is Tab => !!t)
    groupAKey.value = cands.find(t => t.key !== groupBKey.value)?.key ?? ''
  }
}
function splitRight() {
  if (!focusTab.value) return
  groupBKey.value = focusTab.value.key
  activeGroup.value = 'b'
}

/* ═══════════════ wasm explorer ═══════════════ */

const wasmCwd = ref('/')
const wasmEntries = ref<string[]>([])
const wasmNewShow = ref(false)
const newFileName = ref('')
const wasmEntriesFiltered = computed(() => {
  const q = explorerFilter.value.trim().toLowerCase()
  return wasmEntries.value.filter(n => !q || n.toLowerCase().includes(q)).map(name => {
    const isDir = name.endsWith('/')
    const clean = isDir ? name.slice(0, -1) : name
    return { key: `w:${wasmCwd.value === '/' ? '/' + clean : wasmCwd.value + '/' + clean}`, label: clean, path: wasmCwd.value === '/' ? `/${clean}` : `${wasmCwd.value}/${clean}`, isDir }
  })
})
async function refreshExplorer() {
  if (isWasm.value) wasmEntries.value = await store.listWasmDir(wasmCwd.value)
  else await store.fetchFiles()
}
function wasmUp() {
  if (wasmCwd.value === '/') return
  const p = wasmCwd.value.split('/').filter(Boolean)
  p.pop()
  wasmCwd.value = p.length ? '/' + p.join('/') : '/'
  void refreshExplorer()
}
function navigateWasm(path: string) { wasmCwd.value = path; void refreshExplorer() }
async function createWasmFile() {
  const name = newFileName.value.trim().replace(/\//g, '_')
  if (!name) return
  const full = wasmCwd.value === '/' ? `/${name}` : `${wasmCwd.value}/${name}`
  newFileName.value = ''
  wasmNewShow.value = false
  if (await store.saveWasmFile(full, '')) {
    await refreshExplorer()
    await openWasmPath(full, name)
  }
}
async function openWasmPath(path: string, label: string) {
  const key = `w:${path}`
  const existing = tabs.value.find(t => t.key === key)
  if (existing) { activate(key, activeGroup.value); return }
  const content = await store.readWasmFile(path)
  if (content === null) return
  tabs.value.push({ key, label, kind: 'wasm', fileId: '', path, language: detectLanguage(label, content).language, content, savedContent: content, dirty: false, parse: null })
  activate(key, activeGroup.value)
  void reparse(tabs.value[tabs.value.length - 1])
}

/* ═══════════════ search ═══════════════ */

const searchQuery = ref('')
function runSearch() {
  const q = searchQuery.value.trim()
  if (q) void store.searchFiles(q)
}
async function openSearchResult(fileId: string) {
  const node = store.files.find(f => f.id === fileId)
  if (node && isEditableNode(node)) return openNode(node)
  const got = await store.getFile(fileId)
  if (got && isEditableNode(got)) return openNode(got)
  store.notifySuccess('Found — but not an editable text file')
}

/* ═══════════════ outline / parse ═══════════════ */

const outlineFilter = ref('')
const parsingOutline = ref(false)
const outlineSymbols = computed<CodeSymbol[]>(() => {
  const q = outlineFilter.value.trim().toLowerCase()
  const syms = focusTab.value?.parse?.symbols ?? []
  if (!q) return syms
  return syms.filter(s => s.name.toLowerCase().includes(q) || (s.detail ?? '').toLowerCase().includes(q))
})
async function reparse(tab: Tab | null) {
  if (!tab || tab.content.length > 256 * 1024) return
  parsingOutline.value = true
  try {
    const res = await invoke<ParseResult>('parse_text', { fileName: tab.label, content: tab.content })
    const t = tabs.value.find(t => t.key === tab.key)
    if (t) t.parse = res
  } catch { /* best-effort */ } finally { parsingOutline.value = false }
}
let reparseTimer = 0
function scheduleReparse() {
  window.clearTimeout(reparseTimer)
  const tab = focusTab.value
  if (!tab || tab.content.length > 256 * 1024) return
  reparseTimer = window.setTimeout(() => void reparse(tab), 1200)
}
const cursorLine = ref(1)
const cursorCol = ref(1)
const selection = ref('')
function onCursor(line: number, col: number, sel: string) {
  cursorLine.value = line
  cursorCol.value = col
  selection.value = sel
}
function updateCursorFromDom() {
  const el = document.querySelector<HTMLTextAreaElement>(`.cs-pane[data-g="${activeGroup.value}"] textarea`)
  if (!el || !focusTab.value) return
  const pos = el.selectionStart ?? 0
  const before = focusTab.value.content.slice(0, pos)
  cursorLine.value = before.split('\n').length
  cursorCol.value = pos - before.lastIndexOf('\n')
  selection.value = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
}
const crumbPath = computed(() => {
  const tab = focusTab.value
  if (!tab?.parse) return ''
  const chain: string[] = []
  const walk = (syms: CodeSymbol[]) => {
    for (const s of syms) {
      if (s.startLine <= cursorLine.value && cursorLine.value <= s.endLine) { chain.push(s.name); walk(s.children); break }
    }
  }
  walk(tab.parse.symbols)
  return chain.join(' › ')
})
function jumpToLine(line: number) {
  const el = document.querySelector<HTMLTextAreaElement>(`.cs-pane[data-g="${activeGroup.value}"] textarea`)
  const tab = focusTab.value
  if (!el || !tab || !line) return
  const lines = tab.content.split('\n')
  const idx = Math.max(0, Math.min(line - 1, lines.length - 1))
  const pos = lines.slice(0, idx).join('\n').length + (idx > 0 ? 1 : 0)
  el.focus()
  el.selectionStart = el.selectionEnd = pos
  updateCursorFromDom()
}

/* ═══════════════ find / replace ═══════════════ */

const findOpen = ref(false)
const findQuery = ref('')
const replaceQuery = ref('')
const findIndex = ref(-1)
const gotoOpen = ref(false)
const gotoLine = ref('')
const findRef = ref<HTMLInputElement | null>(null)
const findMatches = computed(() => {
  const tab = focusTab.value
  const q = findQuery.value
  if (!tab || !q) return []
  const out: number[] = []
  let i = tab.content.indexOf(q)
  while (i !== -1 && out.length < 500) { out.push(i); i = tab.content.indexOf(q, i + q.length) }
  return out
})
const findCount = computed(() => findMatches.value.length)
watch(findQuery, () => { findIndex.value = -1 })
function focusMatch() {
  const tab = focusTab.value
  const el = document.querySelector<HTMLTextAreaElement>(`.cs-pane[data-g="${activeGroup.value}"] textarea`)
  if (!el || !tab || !findMatches.value.length) return
  const pos = findMatches.value[findIndex.value]
  el.focus()
  el.selectionStart = pos
  el.selectionEnd = pos + findQuery.value.length
  updateCursorFromDom()
}
function findNext(dir: 1 | -1) {
  if (!findMatches.value.length) { findIndex.value = -1; return }
  findIndex.value = (findIndex.value + dir + findMatches.value.length) % findMatches.value.length
  focusMatch()
}
function replaceOne() {
  const tab = focusTab.value
  if (!tab || !findQuery.value || findIndex.value < 0) return
  const pos = findMatches.value[findIndex.value]
  tab.content = tab.content.slice(0, pos) + replaceQuery.value + tab.content.slice(pos + findQuery.value.length)
  onEdit(tab)
}
function replaceAll() {
  const tab = focusTab.value
  if (!tab || !findQuery.value) return
  tab.content = tab.content.split(findQuery.value).join(replaceQuery.value)
  onEdit(tab)
}

/* ═══════════════ save / edit ═══════════════ */

const saving = ref(false)
function onEdit(tab: Tab) {
  tab.dirty = tab.content !== tab.savedContent
  scheduleReparse()
}
async function saveTab(tab: Tab | null) {
  if (!tab || saving.value) return
  saving.value = true
  try {
    if (tab.kind === 'managed') {
      const saved = await store.saveManagedContent(tab.fileId, tab.content)
      if (saved) { tab.savedContent = tab.content; tab.dirty = false }
    } else {
      if (await store.saveWasmFile(tab.path, tab.content)) { tab.savedContent = tab.content; tab.dirty = false }
    }
    if (!tab.dirty) void reparse(tab)
  } finally { saving.value = false }
}
function onGlobalKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  const tag = t.tagName
  const inInput = tag === 'INPUT' || tag === 'SELECT'
  const inPrompt = t === promptEl.value
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveTab(focusTab.value); return }
  // Find works from the editor textarea too (VSCode-like); plain inputs keep theirs.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !inInput && !inPrompt) { e.preventDefault(); findOpen.value = true; nextTick(() => findRef.value?.focus()); return }
  // Ctrl+G summons the AI from anywhere except its own prompt (there it blurs back).
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    if (inPrompt) { promptEl.value?.blur(); return }
    aiOpen.value = true
    nextTick(() => promptEl.value?.focus())
    return
  }
  if (e.ctrlKey && e.key === '`' && !inPrompt) { e.preventDefault(); bottomOpen.value = !bottomOpen.value; return }
  if (e.key === 'Escape' && findOpen.value && !inPrompt) { findOpen.value = false; return }
}

/* ═══════════════ problems ═══════════════ */

const bottomOpen = ref(false)
const bottomTab = ref<'term' | 'problems'>('term')
const problems = computed(() => {
  const out: { key: string; sev: string; text: string; where: string; tab: string | null; line: number }[] = []
  for (const t of tabs.value) {
    if (t.dirty) out.push({ key: t.key + ':dirty', sev: 'info', text: `Unsaved changes`, where: t.label, tab: t.key, line: 0 })
    if (t.parse && !t.parse.symbols.length && t.content.length > 0) out.push({ key: t.key + ':nosym', sev: 'warn', text: 'No symbols parsed', where: `${t.label} · ${t.parse.engine}`, tab: t.key, line: 0 })
    if (t.content.length > 0 && t.content.length <= 256 * 1024) {
      for (const b of checkBrackets(t.content, t.language)) {
        out.push({ key: `${t.key}:br:${b.line}:${b.message}`, sev: 'warn', text: b.message, where: t.label, tab: t.key, line: b.line })
      }
    }
  }
  return out
})

/* ═══════════════ bottom terminal (cybsh mirror — server keeps the real cwd) ═══════════════ */

// Writable mirror: the old `computed(() => '/')` was readonly, so every
// `cd` assignment failed typecheck (TS2540) and the label never moved.
const termCwd = ref('/')
const termInput = ref('')
const termLines = ref<{ id: number; kind: string; text: string }[]>([])
const termScrollRef = ref<HTMLElement | null>(null)
let termId = 0
function termPush(kind: string, text: string) {
  for (const line of text.split('\n')) {
    if (line === '' && kind !== 'in') continue
    termLines.value.push({ id: ++termId, kind, text: line || ' ' })
  }
  if (termLines.value.length > 400) termLines.value.splice(0, termLines.value.length - 400)
  nextTick(() => { const el = termScrollRef.value; if (el) el.scrollTop = el.scrollHeight })
}
async function runTerm(line: string) {
  const full = line.trim()
  if (!full) return
  const fix = correctShellLine(full)
  if (fix.fixed) termPush('out', `auto-fix: ${fix.fixes.join(', ')}`)
  const effective = fix.line || full
  termPush('in', '❯ ' + effective)
  termCwd.value = trackShellCwd(termCwd.value, effective)
  const res = await store.execShellLine(effective)
  termPush(res.ok ? 'out' : 'err', res.output || (res.ok ? 'ok' : 'failed'))
}
function submitTerm() { const v = termInput.value; termInput.value = ''; void runTerm(v) }

/* ═══════════════ AI panel ═══════════════ */

const aiOpen = ref(true)
const promptInput = ref('')
const promptEl = ref<HTMLTextAreaElement | null>(null)
const threadRef = ref<HTMLElement | null>(null)
const openRows = ref<Set<string>>(new Set())
const attachFile = ref(true)
const attachSel = ref(false)
const keyInput = ref('')
const hasLocalKey = computed(() => !!(ai.chatConfigId.value && ai.localKeys.value[ai.chatConfigId.value]))

watch(() => ai.threadRows.value.length, () => nextTick(() => { const el = threadRef.value; if (el) el.scrollTop = el.scrollHeight }))
watch(() => ai.configs.value.length, n => {
  if (n && !ai.chatConfigId.value) ai.chatConfigId.value = ai.configs.value[0].id
})

const canSend = computed(() => promptInput.value.trim() !== '' && ai.chatConfigId.value !== '')

/* ── voice dictation (code mode: symbols + camel/snake phrases) ── */
const voice = useVoiceInput('code')
let stopVoice: (() => void) | null = null
function toggleVoice() {
  if (voice.listening.value) {
    stopVoice?.()
    stopVoice = null
    return
  }
  stopVoice = voice.dictateInto(promptInput)
}
function activeFileCtx(): FileCtx[] {
  const tab = focusTab.value
  if (!tab) return []
  const out: FileCtx[] = []
  if (attachFile.value) out.push({ label: tab.label, path: tab.kind === 'wasm' ? tab.path : tab.label, language: tab.language, content: tab.content.slice(0, 6000), selection: attachSel.value && selection.value ? selection.value.slice(0, 2000) : undefined })
  return out
}
async function sendPrompt() {
  if (!canSend.value) return
  const v = promptInput.value
  promptInput.value = ''
  await ai.send(v, activeFileCtx())
}
function quick(kind: 'explain' | 'review') {
  if (!focusTab.value) return
  const p = kind === 'explain'
    ? `Explain what this file does, section by section. Reference file:line. Be concise.`
    : `Review this code for bugs, edge cases and security issues. List findings with file:line, then propose minimal fixes.`
  void ai.send(p, activeFileCtx())
}
function lastCodeBlock(): string | null {
  const msgs = ai.viewing.value?.messages ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i].content || ''
    // Closed fence first; fall back to a trailing unclosed fence (the model
    // sometimes stops before emitting the closer).
    const m = /```(?:\w+)?\n([\s\S]*?)```/.exec(c) ?? /```(?:\w+)?\n([\s\S]*)$/.exec(c)
    if (m) return m[1]
  }
  return null
}
function applyLastBlock() {
  const tab = focusTab.value
  const block = lastCodeBlock()
  if (!tab) { store.notifyError('No file open', 'open a file first'); return }
  if (!block) { store.notifyError('No code block', 'the agent has not emitted a fenced block yet'); return }
  // Insert at the cursor/selection — never overwrite the whole file.
  const clean = block.replace(/\n$/, '')
  const el = document.querySelector<HTMLTextAreaElement>(`.cs-pane[data-g="${activeGroup.value}"] textarea`)
  if (el) {
    const s = el.selectionStart ?? tab.content.length
    const en = el.selectionEnd ?? s
    tab.content = tab.content.slice(0, s) + clean + tab.content.slice(en)
    const pos = s + clean.length
    nextTick(() => { el.focus(); el.selectionStart = el.selectionEnd = pos })
  } else {
    tab.content = tab.content + (tab.content.endsWith('\n') || !tab.content ? '' : '\n') + clean + '\n'
  }
  onEdit(tab)
  store.notifySuccess('Applied agent code block — review then save')
}
function sealKey() {
  if (ai.chatConfigId.value && keyInput.value) {
    ai.sealLocalKey(ai.chatConfigId.value, keyInput.value)
    keyInput.value = ''
    store.notifySuccess('Key held in memory for this page only')
  }
}
function roleLabel(m: { role: string; toolName?: string | null }) {
  if (m.role === 'user') return 'YOU'
  if (m.role === 'tool') return `TOOL · ${m.toolName ?? ''}`
  if (m.role === 'assistant_tool') return 'AGENT · TOOLS'
  return 'AGENT'
}
function toolNameOf(m: { toolInput?: unknown }) {
  try {
    const arr = (m.toolInput ?? []) as Array<{ name?: string }>
    return arr.map(c => c.name ?? '?').join(', ')
  } catch { return '' }
}
function prettyTool(t: { name: string; input: unknown }) {
  try { return `${t.name} ${JSON.stringify(t.input ?? {}).slice(0, 500)}` } catch { return t.name }
}
const approvalInput = computed(() => {
  const p = ai.pendingApproval.value
  if (!p) return ''
  try {
    const text = JSON.stringify(p.input ?? {}, null, 1)
    return text.length > 600 ? text.slice(0, 600) + '…' : text
  } catch { return '' }
})
function toggleRow(key: string) {
  const next = new Set(openRows.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openRows.value = next
}
function fmtTok(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/* ═══════════════ editor pane (highlight overlay) ═══════════════ */

const EditorPane = defineComponent({
  name: 'EditorPane',
  props: {
    tab: { type: Object as PropType<Tab>, required: true },
    group: { type: String, required: true },
  },
  emits: ['cursor', 'edit'],
  setup(props, { emit }) {
    const lines = computed(() => props.tab.content.split('\n').length)
    const gutter = computed(() => Array.from({ length: lines.value }, (_, i) => String(i + 1)).join('\n'))
    // Highlight is O(n) regex over the whole file per keystroke — past this
    // size render plain escaped text so big logs don't freeze the pane.
    // `:key="tab.key"` on each EditorPane instance guarantees this view state
    // (scroll, textarea) remounts per file instead of leaking across tabs.
    const MAX_HL_BYTES = 64 * 1024
    const html = computed(() => (props.tab.content.length > MAX_HL_BYTES ? escapeHtml(props.tab.content) : highlightSyntax(props.tab.content, props.tab.language)))
    const taRef = ref<HTMLTextAreaElement | null>(null)
    const hlRef = ref<HTMLElement | null>(null)
    const guRef = ref<HTMLElement | null>(null)
    const onScroll = () => {
      const ta = taRef.value
      if (!ta) return
      if (hlRef.value) { hlRef.value.scrollTop = ta.scrollTop; hlRef.value.scrollLeft = ta.scrollLeft }
      if (guRef.value) guRef.value.scrollTop = ta.scrollTop
    }
    const cursor = (el?: HTMLTextAreaElement | null) => {
      const ta = el ?? taRef.value
      if (!ta) return
      const pos = ta.selectionStart ?? 0
      const before = props.tab.content.slice(0, pos)
      emit('cursor', before.split('\n').length, pos - before.lastIndexOf('\n'), ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0))
    }
    const onKey = (e: KeyboardEvent) => {
      const ta = e.target as HTMLTextAreaElement
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = ta.selectionStart ?? 0
        const en = ta.selectionEnd ?? 0
        props.tab.content = props.tab.content.slice(0, s) + '  ' + props.tab.content.slice(en)
        nextTick(() => { ta.selectionStart = ta.selectionEnd = s + 2; cursor(ta) })
        emit('edit')
      }
    }
    const onInput = (e: Event) => {
      const ta = e.target as HTMLTextAreaElement
      props.tab.content = ta.value
      emit('edit')
      cursor(ta)
    }
    return () =>
      h('div', { class: 'cs-pane', 'data-g': props.group }, [
        h('div', { class: 'cs-gutter', ref: guRef }, gutter.value),
        h('div', { class: 'cs-code' }, [
          h('pre', { class: 'cs-hl', ref: hlRef, 'aria-hidden': 'true' }, [h('code', { innerHTML: html.value })]),
          h('textarea', {
            ref: taRef,
            class: 'cs-input2',
            spellcheck: false,
            wrap: 'off',
            value: props.tab.content,
            onInput,
            onScroll,
            onKeydown: onKey,
            onKeyup: (e: KeyboardEvent) => cursor(e.target as HTMLTextAreaElement),
            onClick: (e: MouseEvent) => cursor(e.target as HTMLTextAreaElement),
          }),
        ]),
      ])
  },
})

const rootRef = ref<HTMLElement | null>(null)

onMounted(() => {
  void refreshExplorer()
  void ai.ensureCatalog()
})
onBeforeUnmount(() => { window.clearTimeout(reparseTimer); stopVoice?.() })
</script>

<style scoped>
.cs { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; outline: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 45%, transparent), color-mix(in srgb, var(--ui-content) 96%, transparent));
  color: var(--ui-text); font-size: 12px; }
.cs-aurora { position: absolute; inset: -20%; pointer-events: none; z-index: 0;
  background: radial-gradient(36% 30% at 85% 0%, color-mix(in srgb, var(--ui-accent) 12%, transparent), transparent 70%),
    radial-gradient(40% 36% at 8% 100%, color-mix(in srgb, var(--ui-info) 9%, transparent), transparent 70%);
  animation: cs-drift 26s ease-in-out infinite alternate; }
@keyframes cs-drift { from { transform: translate3d(1%, 1%, 0); } to { transform: translate3d(-1.5%, -1%, 0) scale(1.03); } }
.cs > *:not(.cs-aurora) { position: relative; z-index: 1; }

/* top */
.cs-top { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: var(--ui-glass);
  border-bottom: 1px solid var(--ui-hairline); backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); }
.cs-logo { display: flex; align-items: center; gap: 6px; color: var(--ui-accent); font-size: 12px; letter-spacing: .1em; }
.cs-transport, .cs-engine { font-size: 9px; font-weight: 800; letter-spacing: .08em; color: var(--ui-text-3);
  border: 1px solid var(--ui-hairline); padding: 2px 7px; border-radius: 99px; }
.cs-engine.ts { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.cs-spacer { flex: 1; }
.cs-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 9px; cursor: pointer;
  font-size: 11px; font-weight: 700; color: var(--ui-text-2); background: color-mix(in srgb, var(--ui-text) 5%, transparent);
  border: 1px solid var(--ui-hairline); white-space: nowrap; }
.cs-btn:hover:not(:disabled) { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 40%, transparent); }
.cs-btn:disabled { opacity: .4; } .cs-btn.on { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 50%, transparent); }
.cs-btn.xs { padding: 3px 9px; font-size: 10px; }
.cs-btn.primary { background: var(--ui-accent-softer); color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.cs-btn.danger { color: var(--ui-danger); border-color: color-mix(in srgb, var(--ui-danger) 45%, transparent); }
.cs-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px;
  border: 1px solid transparent; background: transparent; color: var(--ui-text-3); cursor: pointer; flex-shrink: 0; }
.cs-ibtn:hover:not(:disabled) { color: var(--ui-accent); background: var(--ui-accent-softer); }
.cs-ibtn:disabled { opacity: .3; }
.cs-input, .cs-select { background: color-mix(in srgb, var(--ui-text) 4%, transparent); border: 1px solid var(--ui-hairline);
  color: var(--ui-text); font-size: 11.5px; padding: 5px 8px; border-radius: 8px; outline: none; min-width: 0; }
.cs-input:focus, .cs-select:focus { border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.cs-input.sm { width: 64px; }
.cs-link { background: none; border: none; color: var(--ui-accent); cursor: pointer; font-weight: 700; }

/* mid */
.cs-mid { flex: 1; display: flex; min-height: 0; }
.cs-activity { width: 44px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0;
  border-right: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 60%, transparent); }
.cs-activity button { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 10px;
  background: transparent; border: none; border-left: 2px solid transparent; color: var(--ui-text-3); cursor: pointer; }
.cs-activity button:hover { color: var(--ui-text); background: var(--ui-accent-softer); }
.cs-activity button.active { color: var(--ui-accent); border-left-color: var(--ui-accent); background: var(--ui-accent-softer); }

/* sidebar */
.cs-side { width: 232px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px;
  border-right: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 55%, transparent); min-height: 0; }
.cs-side-h { display: flex; align-items: center; font-size: 9.5px; font-weight: 800; letter-spacing: .12em; color: var(--ui-text-3); padding: 2px 4px; }
.cs-tree { flex: 1; overflow-y: auto; min-height: 0; }
.cs-trow { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 6px; border-radius: 8px; cursor: pointer;
  background: transparent; border: none; color: var(--ui-text-2); font-size: 12px; text-align: left; }
.cs-trow:hover { background: var(--ui-accent-softer); color: var(--ui-text); }
.cs-trow.active { background: var(--ui-accent-softer); color: var(--ui-accent); }
.cs-trow.dir { color: var(--ui-text-2); font-weight: 700; }
.cs-trow.col { flex-direction: column; align-items: flex-start; gap: 1px; }
.cs-tbranch { display: flex; flex-direction: column; }
.cs-caret { width: 10px; color: var(--ui-text-3); font-size: 9px; flex-shrink: 0; }
.cs-ticon { flex-shrink: 0; }
.cs-kind { font-size: 8.5px; font-weight: 800; color: var(--ui-text-3); min-width: 52px; text-transform: uppercase; }
.cs-snip { font-size: 10px; }
.cs-empty { padding: 10px; font-size: 11px; text-align: center; }
.cs-pathrow { display: flex; align-items: center; gap: 6px; }
.mono { font-family: var(--ui-font-mono); font-size: 10.5px; } .dim { color: var(--ui-text-3); }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* editor column */
.cs-edcol { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cs-groups { flex: 1; display: flex; min-height: 0; }
.cs-groups.split .cs-group { width: 50%; }
.cs-group { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cs-group + .cs-group { border-left: 1px solid var(--ui-hairline); }
.cs-tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 65%, transparent); flex-shrink: 0; }
.cs-tab { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 12px; font-size: 11.5px; cursor: pointer; white-space: nowrap;
  color: var(--ui-text-3); border-right: 1px solid var(--ui-hairline); max-width: 190px; }
.cs-tab.active { color: var(--ui-text); background: var(--ui-accent-softer); box-shadow: inset 0 2px 0 var(--ui-accent); }
.cs-dot { color: var(--ui-warning); font-size: 8px; }
.cs-x { display: inline-flex; background: none; border: none; color: inherit; opacity: .5; cursor: pointer; padding: 2px; }
.cs-x:hover { opacity: 1; color: var(--ui-danger); }
.cs-welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--ui-text-3); }
.cs-welcome p { font-weight: 800; color: var(--ui-text-2); margin: 0; }
.cs-pane { flex: 1; display: flex; min-height: 0; }
.cs-gutter { width: 46px; flex-shrink: 0; padding: 10px 6px 10px 0; text-align: right; color: color-mix(in srgb, var(--ui-text) 30%, transparent);
  font-family: var(--ui-font-mono); font-size: 12px; line-height: 1.6; overflow: hidden; white-space: pre; user-select: none; }
.cs-code { flex: 1; position: relative; min-width: 0; }
.cs-hl, .cs-input2 { margin: 0; padding: 10px 12px; font-family: var(--ui-font-mono); font-size: 12px; line-height: 1.6; white-space: pre; tab-size: 2; }
.cs-hl { position: absolute; inset: 0; overflow: hidden; pointer-events: none; color: var(--ui-text); }
.cs-input2 { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; border: none; outline: none; resize: none;
  color: transparent; caret-color: var(--ui-accent); overflow: auto; }

/* find */
.cs-find { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--ui-hairline);
  background: color-mix(in srgb, var(--ui-surface) 80%, transparent); flex-shrink: 0; flex-wrap: wrap; }
.cs-find .cs-input { width: 150px; }

/* bottom */
.cs-bottom { height: 190px; flex-shrink: 0; display: flex; flex-direction: column; border-top: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent); background: rgba(0,0,0,.45); }
.cs-btabs { display: flex; gap: 2px; padding: 4px 8px 0; }
.cs-btabs button { padding: 5px 12px; font-size: 9.5px; font-weight: 800; letter-spacing: .08em; background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--ui-text-3); cursor: pointer; }
.cs-btabs button.active { color: var(--ui-accent); border-bottom-color: var(--ui-accent); }
.cs-termwrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.cs-term { flex: 1; overflow-y: auto; padding: 6px 10px; font-family: var(--ui-font-mono); font-size: 10.5px; }
.cs-terml.in { color: var(--ui-accent); font-weight: 700; } .cs-terml.out { color: var(--ui-text-2); white-space: pre-wrap; } .cs-terml.err { color: var(--ui-danger); white-space: pre-wrap; }
.cs-termin { display: flex; gap: 7px; padding: 6px 10px; border-top: 1px solid var(--ui-hairline); color: var(--ui-accent); }
.cs-termin input { flex: 1; background: transparent; border: none; outline: none; color: var(--ui-text); font-size: 11.5px; }
.cs-problems { flex: 1; overflow-y: auto; padding: 4px 8px; }
.cs-prow { display: flex; gap: 8px; align-items: center; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 11.5px; }
.cs-prow:hover { background: var(--ui-accent-softer); }
.cs-pkind { font-size: 8.5px; font-weight: 800; padding: 1px 7px; border-radius: 99px; background: color-mix(in srgb, var(--ui-text) 8%, transparent); }
.cs-pkind.warn { color: var(--ui-warning); } .cs-pkind.info { color: var(--ui-info); }

/* status */
.cs-status { display: flex; align-items: center; gap: 12px; padding: 4px 10px; font-size: 10px; font-family: var(--ui-font-mono);
  border-top: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 80%, transparent); flex-shrink: 0; overflow: hidden; white-space: nowrap; }
.cs-warn { color: var(--ui-warning); font-weight: 700; }
.cs-aistat { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-text-3); max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.cs-aistat.run { color: var(--ui-accent); font-weight: 700; }

/* AI panel */
.cs-ai { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid var(--ui-hairline); background: var(--ui-glass);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); }
.cs-ai-h { display: flex; align-items: center; gap: 7px; padding: 9px 10px; border-bottom: 1px solid var(--ui-hairline); font-size: 12px; color: var(--ui-accent); }
.cs-ai-cfg { display: flex; gap: 6px; padding: 8px 10px 4px; }
.cs-ai-cfg .cs-select { flex: 1; }
.cs-ai-note { margin: 6px 10px 0; padding: 8px 10px; font-size: 11px; border-radius: 10px; color: var(--ui-text-2);
  border: 1px dashed var(--ui-border-strong); background: color-mix(in srgb, var(--ui-text) 3%, transparent); }
.cs-ai-note form { display: flex; gap: 6px; margin-top: 6px; }
.cs-ai-note .cs-input { flex: 1; }
.cs-ai-meta { padding: 6px 10px 0; font-size: 10px; }
.cs-ctxbar { height: 4px; border-radius: 99px; background: color-mix(in srgb, var(--ui-text) 10%, transparent); margin-top: 4px; overflow: hidden; }
.cs-ctxbar i { display: block; height: 100%; background: var(--ui-success); border-radius: 99px; }
.cs-ctxbar i.warn { background: var(--ui-warning); } .cs-ctxbar i.bad { background: var(--ui-danger); }
.cs-thread { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.cs-msg { padding: 7px 9px; border-radius: 11px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 2.5%, transparent); }
.cs-msg.r-user { background: var(--ui-accent-softer); border-color: color-mix(in srgb, var(--ui-accent) 30%, transparent); }
.cs-role { font-size: 8.5px; font-weight: 800; letter-spacing: .1em; margin-bottom: 3px; }
.cs-body { font-size: 11.5px; white-space: pre-wrap; word-break: break-word; }
.cs-md { font-size: 11.5px; word-break: break-word; }
.cs-md :deep(pre) { background: rgba(0,0,0,.4); border: 1px solid var(--ui-hairline); border-radius: 8px; padding: 7px; overflow-x: auto; font-size: 10.5px; }
.cs-md :deep(code) { font-family: var(--ui-font-mono); font-size: 10.5px; }
.cs-md :deep(p) { margin: 4px 0; } .cs-md :deep(ul) { margin: 4px 0; padding-left: 16px; }
.cs-toolblock { font-family: var(--ui-font-mono); font-size: 10px; color: var(--ui-text-3); }
.cs-tgroup { display: flex; flex-direction: column; gap: 4px; }
.cs-trow2 { border: 1px solid var(--ui-hairline); border-radius: 9px; overflow: hidden; }
.cs-thead { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; background: transparent; border: none;
  color: var(--ui-text-2); cursor: pointer; font-size: 11px; text-align: left; }
.cs-thead:hover { background: var(--ui-accent-softer); }
.cs-tstate { margin-left: auto; font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: var(--ui-text-3); }
.is-running .cs-tstate { color: var(--ui-accent); } .is-error .cs-tstate, .is-denied .cs-tstate { color: var(--ui-danger); }
.cs-tdetail { padding: 4px 8px 8px; } .cs-tdetail pre { font-size: 10px; white-space: pre-wrap; word-break: break-word; margin: 4px 0; color: var(--ui-text-2); }
.cs-tdetail pre.res { color: var(--ui-text-3); max-height: 160px; overflow-y: auto; }
.cs-approval { margin: 0 10px; padding: 9px 10px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--ui-warning) 50%, transparent);
  background: color-mix(in srgb, var(--ui-warning) 7%, transparent); display: flex; flex-direction: column; gap: 6px; }
.cs-apph { font-size: 10px; font-weight: 800; display: flex; gap: 5px; align-items: center; color: var(--ui-warning); }
.cs-apptext { font-size: 11px; } .cs-appinput { font-size: 10px; max-height: 90px; overflow-y: auto; margin: 0; color: var(--ui-text-2); }
.cs-approw { display: flex; gap: 6px; }
.cs-quick { display: flex; gap: 4px; padding: 6px 10px 0; flex-wrap: wrap; }
.cs-quick button { font-size: 9.5px; font-weight: 800; padding: 3px 9px; border-radius: 99px; cursor: pointer;
  border: 1px solid var(--ui-hairline); background: transparent; color: var(--ui-text-3); }
.cs-quick button.on { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 50%, transparent); background: var(--ui-accent-softer); }
.cs-quick button:hover:not(:disabled) { color: var(--ui-accent); } .cs-quick button:disabled { opacity: .4; }
.cs-queue { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px 0; }
.cs-qitem { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--ui-text-3);
  border: 1px dashed var(--ui-border-strong); border-radius: 8px; padding: 3px 4px 3px 9px; }
.cs-qitem .truncate { flex: 1; min-width: 0; }
.cs-prompt { display: flex; gap: 6px; padding: 8px 10px; align-items: flex-end; }
.cs-prompt textarea { flex: 1; background: color-mix(in srgb, var(--ui-text) 4%, transparent); border: 1px solid var(--ui-hairline);
  border-radius: 10px; color: var(--ui-text); font-size: 11.5px; padding: 7px 9px; outline: none; resize: none; }
.cs-prompt textarea:focus { border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.cs-jobline { padding: 0 10px 4px; font-size: 9.5px; }
.cs-err { margin: 0 10px 8px; font-size: 10px; color: var(--ui-danger); }

@media (max-width: 1100px) { .cs-ai { width: 270px; } .cs-side { width: 190px; } }
@media (max-width: 860px) { .cs-ai, .cs-side { display: none; } .hide-mid { display: none; } }
</style>

<style>
.sx-k { color: var(--ui-accent); font-weight: 700; }
.sx-s { color: color-mix(in srgb, var(--ui-info) 80%, var(--ui-text)); }
.sx-c { color: color-mix(in srgb, var(--ui-text) 35%, transparent); font-style: italic; }
.sx-n { color: color-mix(in srgb, var(--ui-warning) 80%, var(--ui-text)); }
</style>
