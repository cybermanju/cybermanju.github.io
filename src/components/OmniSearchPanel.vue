<!-- CyberManju OS — Unified search results (src/components/OmniSearchPanel.vue). -->
<!-- Role: shared Home and window search with local actions and rendered web answers. -->
<!-- Exports: OmniSearchPanel Vue component. -->
<!-- Integrates: unified search, presentation helpers, and platform external opener. -->
<!-- Contracts: safe external links, shared filters/paging, accessible bounded results. -->
<template>
  <div class="omni" :class="{ 'omni--home': props.home, 'omni--flat': isFlatAmoled, 'omni--glass': isModernGlass, 'omni--solid': theme.glass.value === 0 }" @keydown="handleKeydown">
    <div class="omni-col">
      <div ref="barRef" class="omni-bar" :class="{ focused: focused || query }">
        <AppIcon name="solar:magnifier-bold" :size="18" class="omni-bar__icon" />
        <input ref="inputRef" v-model="query" class="omni-bar__input" type="text" placeholder="Search anything..."
          aria-label="Search anything — apps, collections, people, providers, files"
          title="Apps · collections · people · providers · folders · files · contents — ↑↓ navigate · Enter opens · right-click manages"
          autocomplete="off" spellcheck="false" @focus="focused = true" @blur="focused = false" />
        <button v-if="query" class="omni-bar__clear" type="button" aria-label="Clear search" title="Clear search (Esc)" @click="clearQuery()"><AppIcon name="solar:close-bold" :size="13" /></button>
        <span v-else class="omni-bar__hint">TYPE TO SEARCH</span>
      </div>
      <Transition name="omni-drop">
        <div v-if="dropdownOpen" ref="dropRef" class="omni-drop" :style="resultsViewportStyle" role="region" aria-label="Search results">
          <div v-if="store.isSearching" class="omni-loading" role="status" aria-live="polite"><UiSpinner size="sm" show-label label="Searching" /></div>
          <div v-if="!q && recentSearches.length" class="omni-sec">
            <div class="omni-sec__head"><span class="omni-tag">RECENT</span><span class="omni-div" aria-hidden="true" />
              <button class="omni-inline__btn omni-inline__btn--ghost omni-recent-clear" type="button" @click="clearRecent">Clear recent</button></div>
            <button v-for="sq in recentSearches" :key="sq" type="button" class="omni-row omni-row--recent" :title="`Search again for ${sq}`" @click="rerun(sq)">
              <span class="omni-row__icon"><AppIcon name="solar:history-bold" :size="14" /></span><span class="omni-row__body"><span class="omni-row__name">{{ sq }}</span></span><span class="omni-row__enter" aria-hidden="true">⏎</span>
            </button>
          </div>
          <nav v-if="q" class="omni-filters" aria-label="Filter search results">
            <button v-for="filter in SEARCH_CATEGORIES" :key="filter.id" type="button" class="omni-filter" :class="{ 'is-selected': category === filter.id }"
              :aria-pressed="category === filter.id" @click="selectCategory(filter.id)">{{ filter.label }} <span>{{ categoryCounts[filter.id] }}</span></button>
          </nav>
          <div v-for="(sec, si) in sections" :key="sec.id" class="omni-sec">
            <div class="omni-sec__head"><span class="omni-tag">{{ OMNI_SECTION_TAG[sec.id] }} · {{ sectionCounts[sec.id] }}</span><span class="omni-div" aria-hidden="true" /></div>
            <div v-for="(row, ri) in sec.rows" :key="sec.id + ':' + row.key" :id="rowId(si, ri)" :data-nav="sec.id + ':' + row.key"
              class="omni-row" :class="{ active: activeKey === sec.id + ':' + row.key }" :style="{ '--i': ri }" :title="rowHint(sec.id, row)"
              tabindex="0" @click="activate(sec.id, row)" @focus="activeKey = sec.id + ':' + row.key" @mouseenter="activeKey = sec.id + ':' + row.key"
              @contextmenu.prevent="openCtx($event, sec.id, row)">
              <span class="omni-row__icon"><AppIcon :name="row.icon" :size="15" /></span>
              <span class="omni-row__body"><span class="omni-row__name" v-html="highlight(row.name)" /><span v-if="row.sub" class="omni-row__sub">{{ row.sub }}</span></span>
              <form v-if="renameTarget?.key === sec.id + ':' + row.key" class="omni-inline" @submit.prevent="saveRename()" @click.stop>
                <input v-model="renameDraft" class="omni-inline__input" aria-label="New name" maxlength="120" />
                <button type="submit" class="omni-inline__btn" :disabled="!renameDraft.trim()">Save</button>
                <button type="button" class="omni-inline__btn omni-inline__btn--ghost" @click="renameTarget = null">Cancel</button>
              </form>
              <form v-else-if="tagTarget?.key === sec.id + ':' + row.key" class="omni-inline" @submit.prevent="saveTags()" @click.stop>
                <input v-model="tagDraft" class="omni-inline__input" aria-label="Comma-separated tags" placeholder="tag1, tag2" maxlength="240" />
                <button type="submit" class="omni-inline__btn">Save</button>
                <button type="button" class="omni-inline__btn omni-inline__btn--ghost" @click="tagTarget = null">Cancel</button>
              </form>
              <div v-else class="omni-row__actions" @click.stop>
                <button class="omni-row__action" type="button" :aria-label="`Open ${row.name}`" @click="activate(sec.id, row)">Open</button>
                <button class="omni-row__action" type="button" :aria-label="`Copy ${copyLabel(sec.id)}`" @click="copyLocalRow(sec.id, row)">Copy {{ copyLabel(sec.id) }}</button>
                <button v-if="isFileSection(sec.id)" class="omni-row__action" type="button" :aria-label="`Show ${row.name} in files`" @click="openFilesAt(row.refId)">Show in files</button>
                <button class="omni-row__action" type="button" aria-label="More actions" title="More actions" @click="openCtx($event, sec.id, row)">More</button>
              </div>
            </div>
            <button v-if="visibleCount(sec.id) < sectionCounts[sec.id] && visibleCount(sec.id) < MAX_VISIBLE_ROWS_PER_SECTION" class="omni-load-section" type="button" @click="showMore(sec.id)">
              Show more {{ OMNI_SECTION_TAG[sec.id].toLowerCase() }} results ({{ visibleCount(sec.id) }} of {{ sectionCounts[sec.id] }})
            </button>
          </div>
          <section v-if="q && unified.localReadyQuery.value === q && (category === 'all' || category === 'web')" class="omni-web" aria-label="DuckDuckGo web results">
            <div class="omni-sec__head"><span class="omni-tag">DUCKDUCKGO INSTANT ANSWERS</span><span class="omni-div" aria-hidden="true" /></div>
            <p v-if="unified.webLoading.value" class="omni-web__status" role="status" aria-live="polite">Searching DuckDuckGo Instant Answers…</p>
            <template v-else-if="unified.webError.value">
              <p class="omni-web__status" role="status">DuckDuckGo is unavailable: {{ unified.webError.value }}</p>
              <button class="omni-web__action" type="button" @click="retryWeb">Retry DuckDuckGo search</button>
            </template>
            <template v-else-if="unified.webResponse.value">
              <article v-if="unified.webResponse.value.answer" class="omni-web__answer">
                <div class="omni-web__answer-body omni-web__answer-body--link" role="link" data-search-answer-link tabindex="0"
                  @click="openAnswerLink(answerDestination)" @keydown.enter.space.prevent="openAnswerLink(answerDestination)">
                  <span class="omni-web__meta">INSTANT ANSWER · {{ unified.webResponse.value.answerSource || 'DuckDuckGo' }}</span>
                  <span class="omni-web__answer-text">{{ unified.webResponse.value.answer }}</span>
                  <span class="omni-web__answer-hint">{{ unified.webResponse.value.answerUrl ? 'Open answer source' : 'Open DuckDuckGo results for this query' }}</span>
                </div>
                <div class="omni-web__actions">
                  <button type="button" class="omni-web__action" @click="copyWithStatus(unified.webResponse.value.answer, 'Answer')">Copy answer</button>
                  <button type="button" class="omni-web__action" @click="copyWithStatus(answerDestination, unified.webResponse.value.answerUrl ? 'Link' : 'Search link')">{{ unified.webResponse.value.answerUrl ? 'Copy link' : 'Copy search link' }}</button>
                </div>
              </article>
              <article v-for="result in unified.webResponse.value.results" :key="result.url" class="omni-web__result-card">
                <a class="omni-web__result" :href="result.url" target="_blank" rel="noopener noreferrer" @click="handleWebLink($event, result.url)" @auxclick.middle="handleWebLink($event, result.url)">
                  <span class="omni-web__meta">WEB RESULT · {{ result.source }}</span><span class="omni-web__title">{{ result.title }}</span>
                  <span class="omni-web__domain">{{ result.url }}</span><span v-if="result.description" class="omni-web__description">{{ result.description }}</span>
                </a>
                <div class="omni-web__actions"><button type="button" class="omni-web__action" @click="copyWithStatus(result.url, 'Link')">Copy link</button></div>
              </article>
              <p v-if="!unified.webResponse.value.answer && unified.webResponse.value.results.length === 0" class="omni-web__status" role="status">DuckDuckGo returned no instant answers or related topics. Try the full DuckDuckGo results page below.</p>
              <p class="omni-web__disclaimer">Instant answers and related topics only; not a full search-engine results page.</p>
              <button class="omni-web__action" type="button" @click="retryWeb">Refresh DuckDuckGo results</button>
            </template>
            <p v-else-if="localCount === 0" class="omni-web__status" role="status" aria-live="polite">Checking DuckDuckGo Instant Answers. This public API provides instant answers and related topics, not a full search-results page.</p>
            <p v-else class="omni-web__status">Web results are not fetched automatically when local matches exist.</p>
            <button v-if="!unified.webLoading.value && !unified.webResponse.value && !unified.webError.value && unified.webQuery.value !== q" class="omni-web__action" type="button" @click="retryWeb">Search web with DuckDuckGo</button>
            <p v-if="linkError" class="omni-web__status" role="alert">{{ linkError }}</p>
            <a class="omni-web__all" :href="duckDuckGoSearchUrl(q)" target="_blank" rel="noopener noreferrer" @click="handleWebLink($event, duckDuckGoSearchUrl(q))" @auxclick.middle="handleWebLink($event, duckDuckGoSearchUrl(q))">Open full DuckDuckGo results for “{{ q }}” ↗</a>
          </section>
          <p v-if="q && unified.localReadyQuery.value === q && category !== 'web' && sections.length === 0" class="omni-empty-state" role="status">{{ emptyCategoryMessage }}</p>
          <p v-if="q && empty && unified.localReadyQuery.value !== q" class="omni-web__status" role="status" aria-live="polite">{{ q.length < 2 ? 'Type at least 2 characters to search.' : 'Searching your apps, files, and file contents…' }}</p>
          <div v-if="canLoadMoreContent && (category === 'all' || category === 'files')" class="omni-more">
            <UiButton size="sm" icon="solar:double-alt-arrow-down-bold" :disabled="store.isSearching" @click="store.loadMoreSearchResults()">LOAD MORE CONTENT ({{ store.searchTotalResults - contentRows.length }} MORE)</UiButton>
          </div>
          <p v-if="copyStatus" class="omni-live-status" role="status" aria-live="polite">{{ copyStatus }}</p>
          <div class="omni-foot"><span class="omni-foot__counts">{{ q ? `${localCount} LOCAL · ${webResultCount} WEB` : `${totalRows} RESULT${totalRows === 1 ? '' : 'S'}` }}</span>
            <span class="omni-foot__keys">↑↓ navigate · ⏎ open · right-click manages · Esc clear</span></div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/composables/useTheme'
import { useWindowManager } from '@/composables/useWindowManager'
import { useContextMenu, type ContextMenuEntry } from '@/composables/useContextMenu'
import { MODULE_METADATA, type PanelType } from '@/types'
import { resolvePanel } from '@/utils/panels'
import { isEditableTarget } from '@/utils/dom'
import { OMNI_SECTION_TAG, buildOmniSections, type OmniSectionId } from '@/utils/omniSearch'
import { useUnifiedSearch } from '@/composables/useUnifiedSearch'
import { useSearchViewport } from '@/composables/useSearchViewport'
import { duckDuckGoSearchUrl } from '@/utils/duckDuckGoSearch'
import { handleSearchLink, openSearchLink } from '@/utils/searchExternal'
import { SEARCH_CATEGORIES, INITIAL_ROWS_PER_SECTION, MAX_VISIBLE_ROWS_PER_SECTION, countSearchCategories, countSectionRows, filterSearchSections, nextVisibleRowCount, sharedSearchCategory, sharedSearchVisibleRows, resetSearchVisibleRows, type SearchCategory } from '@/utils/searchPresentation'

const props = withDefaults(defineProps<{ home?: boolean }>(), { home: false })
const store = useAppStore()
const theme = useTheme()
const isFlatAmoled = computed(() => theme.themeId.value === 'flat-amoled')
const isModernGlass = computed(() => theme.themeId.value === 'modern-glass')
const wm = useWindowManager()
const ctx = useContextMenu()

interface OmniRow {
  key: string
  kind: OmniSectionId
  name: string
  sub?: string
  icon: string
  refId: string
}

const query = computed({ get: () => store.searchQuery, set: (value: string) => { store.searchQuery = value } })
const instanceId = `omni-${useId().replace(/[^a-zA-Z0-9_-]/g, '-')}`
const focused = ref(false)
const category = sharedSearchCategory()
const copyStatus = ref('')
const linkError = ref('')
const visibleBySection = sharedSearchVisibleRows()
const inputRef = ref<HTMLInputElement | null>(null)
const barRef = ref<HTMLElement | null>(null)
const dropRef = ref<HTMLElement | null>(null)
const resultsViewportStyle = useSearchViewport(barRef, dropRef)
const activeKey = ref<string | null>(null)
const renameTarget = ref<{ key: string; kind: OmniSectionId; refId: string } | null>(null)
const renameDraft = ref('')
const tagTarget = ref<{ key: string; fileId: string } | null>(null)
const tagDraft = ref('')
const q = computed(() => query.value.trim())
const dropdownOpen = computed(() => props.home ? q.value.length > 0 : focused.value || q.value.length > 0 || totalRows.value > 0)

const recentSearches = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem('cybermanju_recent_searches') || '[]') as string[] } catch { return [] }
})())

function rememberSearch(sq: string) {
  if (!sq.trim()) return
  const arr = recentSearches.value.filter((s) => s !== sq)
  arr.unshift(sq)
  if (arr.length > 10) arr.pop()
  recentSearches.value = arr
  try { localStorage.setItem('cybermanju_recent_searches', JSON.stringify(arr)) } catch {}
}

/* ── section inputs (ordered downstream by buildOmniSections) ── */

const appRows = computed<OmniRow[]>(() => {
  const seen = new Set<string>()
  const rows: OmniRow[] = []
  for (const [id, meta] of Object.entries(MODULE_METADATA)) {
    const canonical = resolvePanel(id as PanelType)
    if (canonical !== (id as PanelType) || seen.has(canonical)) continue
    seen.add(canonical)
    if (canonical === 'landing') continue
    rows.push({
      key: canonical, kind: 'apps', name: meta.label, sub: meta.description,
      icon: meta.icon, refId: canonical,
    })
  }
  return rows
})

const collectionRows = computed<OmniRow[]>(() =>
  store.collections.map((c) => ({
    key: c.id, kind: 'collections' as const, name: c.name,
    sub: `${c.collectionType.toUpperCase()} · ${c.itemIds.length} ITEMS`,
    icon: 'solar:library-bold', refId: c.id,
  })),
)

const peopleRows = computed<OmniRow[]>(() =>
  store.faceGroups.map((g) => ({
    key: g.id, kind: 'people' as const, name: g.name,
    sub: `${g.fileIds.length} FILES${g.detectionEngine ? ` · ${g.detectionEngine.toUpperCase()}` : ''}`,
    icon: 'solar:face-scan-circle-bold', refId: g.id,
  })),
)

const providerRows = computed<OmniRow[]>(() =>
  store.syncConfigs.map((c) => ({
    key: c.id, kind: 'providers' as const,
    name: c.name || `${c.backendType}`,
    sub: `${String(c.backendType).toUpperCase()} · OPEN FILE MANAGER IN PROVIDER`,
    icon: 'solar:cloud-bold', refId: c.id,
  })),
)

const folderRows = computed<OmniRow[]>(() =>
  store.files
    .filter((f) => f.fileType === 'folder')
    .map((f) => ({
      key: f.id, kind: 'folders' as const, name: f.name,
      sub: f.path || 'FOLDER', icon: 'solar:folder-bold', refId: f.id,
    })),
)

const fileRows = computed<OmniRow[]>(() =>
  store.files
    .filter((f) => f.fileType !== 'folder')
    .map((f) => ({
      key: f.id, kind: 'files' as const, name: f.name,
      sub: [f.path, (f.tags ?? []).join(' #')].filter(Boolean).join(' · ') || undefined,
      icon: f.encrypted ? 'solar:lock-bold' : 'solar:file-bold', refId: f.id,
    })),
)

const contentRows = computed<OmniRow[]>(() =>
  unified.localReadyQuery.value === q.value ? store.searchResults.map((r) => ({
    key: r.fileId, kind: 'content' as const, name: r.fileName,
    sub: r.snippet || `${r.matchType ?? 'match'} · score ${r.score.toFixed(2)}`,
    icon: 'solar:file-text-bold', refId: r.fileId,
  })) : [],
)

const sectionInput = computed<Record<OmniSectionId, OmniRow[]>>(() => ({
  apps: appRows.value, collections: collectionRows.value, people: peopleRows.value,
  providers: providerRows.value, folders: folderRows.value, files: fileRows.value,
  content: contentRows.value,
}))
const allSections = computed(() => buildOmniSections(q.value, sectionInput.value, MAX_VISIBLE_ROWS_PER_SECTION))
const unified = useUnifiedSearch(() => localCount.value)
const webResultCount = computed(() => (unified.webResponse.value?.answer ? 1 : 0) + (unified.webResponse.value?.results.length ?? 0))
const answerDestination = computed(() => unified.webResponse.value?.answerUrl || (q.value ? duckDuckGoSearchUrl(q.value) : 'https://duckduckgo.com/'))
const categoryCounts = computed(() => countSearchCategories(q.value, sectionInput.value, webResultCount.value))
const localCount = computed(() => countSearchCategories(q.value, sectionInput.value).all)
const sectionCounts = computed(() => ({
  apps: countSectionRows(q.value, sectionInput.value.apps), collections: countSectionRows(q.value, sectionInput.value.collections),
  people: countSectionRows(q.value, sectionInput.value.people), providers: countSectionRows(q.value, sectionInput.value.providers),
  folders: countSectionRows(q.value, sectionInput.value.folders), files: countSectionRows(q.value, sectionInput.value.files),
  content: countSectionRows(q.value, sectionInput.value.content),
}))
const sections = computed(() => filterSearchSections(allSections.value, category.value).map((section) => ({
  ...section, rows: section.rows.slice(0, visibleBySection.value[section.id]),
})))
const flatRows = computed(() => sections.value.flatMap((section) => section.rows.map((row) => ({ sec: section.id as OmniSectionId, row }))))
const totalRows = computed(() => flatRows.value.length)
const empty = computed(() => localCount.value === 0)
const emptyCategoryMessage = computed(() => category.value === 'all'
  ? 'No local matches. Try a different query or switch to Web.'
  : `No ${SEARCH_CATEGORIES.find((item) => item.id === category.value)?.label.toLowerCase() ?? 'matching'} results for this query.`)

/** BM25 page behind the visible content rows — offer the next page inline. */
const canLoadMoreContent = computed(() =>
  q.value.length >= 2
  && contentRows.value.length > 0
  && store.searchTotalResults > contentRows.value.length,
)

/** Drop a highlight that no longer exists (new keystroke, new results). */
watch(flatRows, (rows) => {
  if (activeKey.value && !rows.some(({ sec, row }) => `${sec}:${row.key}` === activeKey.value)) {
    activeKey.value = null
  }
})
watch(q, () => {
  category.value = 'all'
  resetSearchVisibleRows(visibleBySection.value)
  linkError.value = ''
})

/* ── search wiring (query state lives in the Pinia store; pipeline is shared) ── */
watch(() => store.searchResults, (results) => {
  if (results.length > 0 && q.value) rememberSearch(q.value)
})

function clearQuery() {
  query.value = ''
  activeKey.value = null
  inputRef.value?.focus()
}

function rerun(sq: string) {
  query.value = sq
}

function clearRecent() {
  recentSearches.value = []
  try { localStorage.removeItem('cybermanju_recent_searches') } catch {}
}

function visibleCount(id: OmniSectionId): number { return visibleBySection.value[id] }
function showMore(id: OmniSectionId) { visibleBySection.value[id] = nextVisibleRowCount(visibleCount(id), sectionCounts.value[id]) }
function isFileSection(id: OmniSectionId): boolean { return id === 'folders' || id === 'files' || id === 'content' }
function copyLabel(id: OmniSectionId): string { return isFileSection(id) ? 'path' : 'name' }
function copyLocalRow(id: OmniSectionId, row: OmniRow) {
  const file = isFileSection(id) ? fileById(row.refId) : undefined
  void copyWithStatus(file?.path || row.name, copyLabel(id) === 'path' ? 'Path' : 'Name')
}

function revealSelectedCategory() {
  void nextTick(() => dropRef.value?.querySelector<HTMLElement>('.omni-filter.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
}
watch(category, revealSelectedCategory)
onMounted(revealSelectedCategory)
function selectCategory(value: SearchCategory) { category.value = value }
watch(() => [category.value, unified.localReadyQuery.value, q.value] as const, ([selected, ready, current]) => {
  if (selected === 'web' && current.length >= 2 && ready === current && !unified.webLoading.value
    && !unified.webResponse.value && !unified.webError.value && unified.webQuery.value !== current) unified.searchWeb(current)
})
function retryWeb() { if (q.value.length >= 2) unified.searchWeb(q.value) }

/* ── openers ── */

function openFilesAt(fileId: string) {
  store.selectFile(fileId)
  wm.open('files')
}

function activate(sec: OmniSectionId, row: OmniRow) {
  if (q.value) rememberSearch(q.value)
  if (sec === 'apps') wm.open(row.refId as PanelType)
  else if (sec === 'collections') {
    const col = store.collections.find((c) => c.id === row.refId)
    const first = col?.itemIds[0]
    if (first) openFilesAt(first)
    else wm.open('files')
  } else if (sec === 'people') {
    const g = store.faceGroups.find((x) => x.id === row.refId)
    if (g?.fileIds[0]) openFilesAt(g.fileIds[0])
    else wm.open('files')
  } else if (sec === 'providers') {
    const path = `/providers/${row.refId}`
    store.currentPath = path
    void store.fetchFiles(path)
    wm.open('files')
  } else {
    openFilesAt(row.refId)
  }
}

function rowId(sectionIndex: number, rowIndex: number): string { return `${instanceId}-${sectionIndex}-${rowIndex}` }

async function handleWebLink(event: MouseEvent, url: string) {
  try { await handleSearchLink(event, url) }
  catch (error) { linkError.value = error instanceof Error ? error.message : 'Could not open this search link.' }
}

async function openAnswerLink(url: string) {
  linkError.value = ''
  try { await openSearchLink(url) }
  catch (error) { linkError.value = error instanceof Error ? error.message : 'Could not open this search link.' }
}

function rowHint(sec: OmniSectionId, row: OmniRow): string {
  if (sec === 'providers') return `${row.name} — Enter opens the file manager inside this provider · right-click for more`
  return `${row.name} — Enter opens · right-click manages, tags, renames`
}

/* ── rich right-click context menu (store-backed actions only) ── */

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const copied = document.execCommand('copy')
    ta.remove()
    if (!copied) throw new Error('Clipboard copy failed')
  }
}

async function copyWithStatus(text: string, label: string) {
  copyStatus.value = ''
  try {
    await copyText(text)
    copyStatus.value = `${label} copied.`
  } catch {
    copyStatus.value = `Could not copy ${label.toLowerCase()}. Select and copy it manually.`
  }
}

function fileById(id: string) {
  return store.files.find((f) => f.id === id)
}

function startRename(kind: OmniSectionId, row: OmniRow) {
  if (kind === 'people' || kind === 'folders' || kind === 'files' || kind === 'content') {
    renameTarget.value = { key: `${kind}:${row.key}`, kind, refId: row.refId }
    renameDraft.value = row.name
    void nextTick(() => {
      dropRef.value?.querySelector<HTMLInputElement>('.omni-inline__input')?.focus()
    })
  }
}

async function saveRename() {
  const t = renameTarget.value
  if (!t || !renameDraft.value.trim()) return
  const name = renameDraft.value.trim()
  if (t.kind === 'people') await store.renameFaceGroup(t.refId, name)
  else await store.renameFile(t.refId, name)
  renameTarget.value = null
}

function startTags(row: OmniRow) {
  const f = fileById(row.refId)
  tagTarget.value = { key: `${row.kind}:${row.key}`, fileId: row.refId }
  tagDraft.value = (f?.tags ?? []).join(', ')
  void nextTick(() => {
    dropRef.value?.querySelector<HTMLInputElement>('.omni-inline__input')?.focus()
  })
}

async function saveTags() {
  const t = tagTarget.value
  if (!t) return
  const tags = tagDraft.value.split(',').map((s) => s.trim()).filter(Boolean)
  await store.setFileTags(t.fileId, tags)
  tagTarget.value = null
}

async function createCollectionFromQuery() {
  const name = q.value || 'Untitled'
  await store.createCollection(name, 'custom', '#FFFFFF')
}

function openCtx(e: MouseEvent, sec: OmniSectionId, row: OmniRow) {
  const entries: ContextMenuEntry[] = []
  const fileSubmenu: ContextMenuEntry[] = store.collections.map((c) => ({
    id: `add-to-${c.id}`, label: c.name.toUpperCase().slice(0, 32), icon: 'solar:library-bold',
    action: () => { void store.addToCollection(c.id, row.refId) },
  }))

  if (sec === 'apps') {
    entries.push(
      { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: () => activate(sec, row) },
      { id: 'div1', label: '', divider: true },
      { id: 'copy', label: 'COPY APP NAME', icon: 'solar:copy-bold', action: () => { void copyText(row.name) } },
    )
  } else if (sec === 'collections') {
    const col = store.collections.find((c) => c.id === row.refId)
    entries.push(
      { id: 'open', label: 'OPEN COLLECTION', icon: 'solar:folder-open-bold', action: () => activate(sec, row) },
      { id: 'copy', label: 'COPY NAME', icon: 'solar:copy-bold', action: () => { void copyText(row.name) } },
      { id: 'div1', label: '', divider: true },
      {
        id: 'add-sel', label: 'ADD SELECTED FILE', icon: 'solar:file-add-bold',
        disabled: !store.selectedFileId,
        action: () => { if (store.selectedFileId) void store.addToCollection(row.refId, store.selectedFileId) },
      },
      ...(col && store.selectedFileId && col.itemIds.includes(store.selectedFileId)
        ? [{ id: 'rm-sel', label: 'REMOVE SELECTED FILE', icon: 'solar:file-minus-bold', action: () => { void store.removeFromCollection(row.refId, store.selectedFileId as string) } } as ContextMenuEntry]
        : []),
      { id: 'new', label: 'NEW COLLECTION FROM QUERY', icon: 'solar:add-bold', action: () => { void createCollectionFromQuery() } },
    )
  } else if (sec === 'people') {
    const others = store.faceGroups.filter((g) => g.id !== row.refId).slice(0, 8)
    entries.push(
      { id: 'open', label: 'OPEN PHOTOS', icon: 'solar:folder-open-bold', action: () => activate(sec, row) },
      { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: () => startRename(sec, row) },
      { id: 'div1', label: '', divider: true },
      {
        id: 'merge', label: 'MERGE INTO…', icon: 'solar:git-branch-bold',
        submenu: others.map((g) => ({
          id: `merge-${g.id}`, label: g.name.toUpperCase().slice(0, 32), icon: 'solar:face-scan-circle-bold',
          action: () => { void store.mergeFaceGroups(row.refId, g.id) },
        })),
        disabled: others.length === 0,
      },
      { id: 'similar', label: 'FIND SIMILAR FACES', icon: 'solar:users-group-two-rounded-bold', action: () => { void store.findSimilarFaces(row.refId) } },
      { id: 'detect', label: 'BATCH DETECT', icon: 'solar:face-scan-circle-bold', action: () => { void store.detectFacesBatch() } },
      { id: 'div2', label: '', divider: true },
      { id: 'delete', label: 'DELETE GROUP', icon: 'solar:trash-bin-trash-bold', action: () => { void store.deleteFaceGroup(row.refId) } },
    )
  } else if (sec === 'providers') {
    entries.push(
      { id: 'open', label: 'OPEN FILE MANAGER IN PROVIDER', icon: 'solar:folder-open-bold', action: () => activate(sec, row) },
      { id: 'sync', label: 'OPEN SYNC PANEL', icon: 'solar:refresh-bold', action: () => wm.open('sync') },
      { id: 'div1', label: '', divider: true },
      { id: 'copy', label: 'COPY PROVIDER ID', icon: 'solar:copy-bold', action: () => { void copyText(row.refId) } },
    )
  } else {
    // folders · files · content — full file management.
    const f = fileById(row.refId)
    entries.push(
      { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: () => activate(sec, row) },
      { id: 'star', label: f?.isStarred ? 'UNSTAR' : 'STAR', icon: 'solar:star-bold', action: () => { void store.toggleStar(row.refId) } },
      { id: 'div1', label: '', divider: true },
      { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: () => startRename(sec, row) },
      { id: 'tags', label: 'EDIT TAGS', icon: 'solar:tag-bold', action: () => startTags(row) },
      {
        id: 'addto', label: 'ADD TO COLLECTION…', icon: 'solar:library-bold',
        submenu: fileSubmenu.length ? fileSubmenu : undefined,
        disabled: fileSubmenu.length === 0,
        action: fileSubmenu.length ? undefined : () => { void createCollectionFromQuery() },
      },
      { id: 'div2', label: '', divider: true },
      { id: 'copy', label: 'COPY PATH', icon: 'solar:copy-bold', action: () => { void copyText(f?.path ?? row.name) } },
      { id: 'show', label: 'SHOW IN FOLDER', icon: 'solar:folder-search-bold', action: () => openFilesAt(row.refId) },
      { id: 'div3', label: '', divider: true },
      { id: 'delete', label: 'DELETE', icon: 'solar:trash-bin-trash-bold', action: () => { void store.deleteFile(row.refId) } },
    )
  }
  ctx.replaceEntries('omni_result', entries)
  ctx.open(e, 'omni_result', { sec, row })
}

/* ── keyboard ── */

function moveActive(delta: 1 | -1) {
  const order = flatRows.value.map(({ sec, row }) => `${sec}:${row.key}`)
  if (!order.length) return
  const idx = activeKey.value ? order.indexOf(activeKey.value) : -1
  const next = idx === -1 ? (delta === 1 ? 0 : order.length - 1) : (idx + delta + order.length) % order.length
  activeKey.value = order[next]
  void nextTick(() => {
    dropRef.value?.querySelector(`[data-nav="${CSS.escape(activeKey.value as string)}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeydown(e: KeyboardEvent) {
  // Native web links and action buttons keep their normal Enter/arrow behavior;
  // Escape remains available globally to clear the current query.
  if (e.target instanceof HTMLElement && e.target.closest('a, button, [data-search-answer-link]') && e.key !== 'Escape') return
  // Typing inside the rename/tag editors must never steer the list —
  // only the main search line shares keys with navigation.
  if (isEditableTarget(e.target) && e.target !== inputRef.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1) }
  else if (e.key === 'Enter' && activeKey.value) {
    e.preventDefault()
    const found = flatRows.value.find(({ sec, row }) => `${sec}:${row.key}` === activeKey.value)
    if (found) activate(found.sec, found.row)
  } else if (e.key === 'Escape' && q.value) { e.preventDefault(); clearQuery() }
}

/* ── highlight ── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(name: string): string {
  const needle = q.value
  if (!needle) return escapeHtml(name)
  const safe = escapeHtml(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escapeHtml(name).replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>')
}

onMounted(() => {
  void Promise.allSettled([store.fetchFiles(), store.fetchCollections(), store.fetchFaceGroups(), store.fetchSyncConfigs()])
  // Handoff from another surface (e.g. Code Studio search) may leave a
  // query with stale results — re-fire so content rows match the line.
  if (!props.home) void nextTick(() => inputRef.value?.focus())
})

onUnmounted(() => {
  ctx.unregisterContext('omni_result')
})

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style scoped>
.omni {
  --omni-accent: var(--ui-accent);
  width: 100%; min-height: 100%; display: flex; justify-content: center;
  padding: 7vh 24px 24px; background: var(--ui-surface); overflow-y: auto;
  font-family: var(--ui-font); color: var(--ui-text);
}
.omni--glass:not(.omni--home) { background: var(--ui-ambient-background, var(--ui-surface)); }
.omni--home { min-height: 0; height: auto; max-width: none; padding: 0; background: transparent; overflow: visible; }
.omni--home .omni-col { max-width: none; margin: 0; align-self: stretch; }
.omni--home .omni-drop { max-height: min(58dvh, 700px); }
.omni-col { width: min(100%, 860px); display: flex; flex-direction: column; margin: 0 auto; align-self: flex-start; }
.omni-bar {
  display: flex; align-items: center; gap: 12px; padding: 0 18px; min-height: 58px;
  border-radius: var(--ui-radius-lg); background: var(--ui-glass-2); border: 1px solid var(--ui-border-strong);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate)); -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  box-shadow: var(--ui-shadow-2), inset 0 1px 0 var(--ui-glass-highlight); transition: border-color var(--ui-dur) var(--ui-ease-out), box-shadow var(--ui-dur) var(--ui-ease-out);
}
.omni--glass .omni-bar { background-color: var(--ui-glass); background-image: var(--ui-glass-sheen); border-color: var(--ui-border-strong); box-shadow: var(--ui-glass-shadow, var(--ui-shadow-2)); }
.omni-bar.focused { border-color: color-mix(in srgb, var(--omni-accent) 65%, transparent); box-shadow: var(--ui-shadow-2), 0 0 0 3px color-mix(in srgb, var(--omni-accent) 16%, transparent); }
.omni-bar__icon { color: var(--ui-text-3); flex-shrink: 0; }
.omni-bar.focused .omni-bar__icon { color: var(--omni-accent); }
.omni-bar__input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--ui-text); font: 550 17px var(--ui-font); height: 100%; }
.omni-bar__input::placeholder { color: var(--ui-text-faint); }
.omni-bar__clear { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--ui-border); background: color-mix(in srgb, var(--ui-text) 7%, transparent); color: var(--ui-text-2); cursor: pointer; flex-shrink: 0; }
.omni-bar__clear:hover { color: var(--omni-accent); border-color: var(--omni-accent); }
.omni-bar__hint { font: 700 9px var(--ui-font-mono); letter-spacing: .12em; color: var(--ui-text-faint); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xs); padding: 3px 7px; flex-shrink: 0; }
.omni-drop {
  margin-top: 12px; border-radius: var(--ui-radius-lg); background: color-mix(in srgb, var(--ui-glass-2) 92%, var(--ui-surface));
  border: 1px solid var(--ui-border-strong); backdrop-filter: blur(calc(var(--ui-blur-strong) * 1.2)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(calc(var(--ui-blur-strong) * 1.2)) saturate(var(--ui-saturate)); box-shadow: var(--ui-shadow-menu), inset 0 1px 0 var(--ui-glass-highlight);
  padding: 14px; display: flex; flex-direction: column; gap: 12px; max-height: min(68vh, 720px); overflow-y: auto; overscroll-behavior: contain; transform-origin: top center;
}
.omni--glass .omni-drop { background-color: var(--ui-glass); background-image: var(--ui-glass-sheen); border-color: var(--ui-border-strong); box-shadow: var(--ui-glass-shadow), var(--ui-glass-edge); }
.omni-drop-enter-active { animation: omni-in var(--ui-dur) var(--ui-ease-spring) both; }
.omni-drop-leave-active { animation: omni-out 120ms ease-in both; }
@keyframes omni-in { from { opacity: 0; transform: translateY(-8px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes omni-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-4px) scale(.995); } }
.omni-loading { display: flex; justify-content: center; padding: 8px 0; }
.omni-filters { flex: 0 0 auto; min-height: 52px; display: flex; gap: 8px; overflow-x: auto; padding: 2px 1px 6px; scrollbar-width: thin; overscroll-behavior-x: contain; }
.omni-filter { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; min-height: 42px; padding: 0 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-full); color: var(--ui-text-2); background: var(--ui-glass-reading, var(--ui-surface)); font: 600 12px var(--ui-font); cursor: pointer; }
.omni-filter span { min-width: 1.25em; color: var(--ui-text-3); font: 700 10px var(--ui-font-mono); text-align: center; }
.omni-filter:hover, .omni-filter.is-selected { border-color: var(--omni-accent); color: var(--ui-text); background: color-mix(in srgb, var(--omni-accent) 12%, var(--ui-surface)); }
.omni-filter.is-selected span { color: var(--omni-accent); }
.omni-sec { display: flex; flex-direction: column; gap: 6px; }
.omni-sec__head { display: flex; align-items: center; gap: 9px; padding: 2px 3px; }
.omni-tag { font: 800 9px var(--ui-font-mono); letter-spacing: .11em; color: var(--omni-accent); background: color-mix(in srgb, var(--omni-accent) 10%, var(--ui-surface)); border: 1px solid color-mix(in srgb, var(--omni-accent) 32%, var(--ui-border)); border-radius: var(--ui-radius-full); padding: 4px 10px; white-space: nowrap; flex-shrink: 0; }
.omni-div { flex: 1; height: 1px; background: var(--ui-hairline); }
.omni-row { display: flex; align-items: flex-start; gap: 12px; width: 100%; min-height: 62px; padding: 12px; border-radius: var(--ui-radius-md); background: var(--ui-surface); border: 1px solid var(--ui-border); cursor: pointer; text-align: left; color: var(--ui-text); font-family: var(--ui-font); transition: border-color var(--ui-dur-fast) var(--ui-ease-out), background-color var(--ui-dur-fast) var(--ui-ease-out); }
.omni--glass .omni-row { background: var(--ui-glass-reading, var(--ui-surface)); border-color: var(--ui-border); box-shadow: var(--ui-glass-edge); }
.omni-row:hover, .omni-row.active { border-color: color-mix(in srgb, var(--omni-accent) 55%, var(--ui-border)); background-color: color-mix(in srgb, var(--omni-accent) 7%, var(--ui-surface)); }
.omni-row:focus-visible, .omni-filter:focus-visible, .omni-row__action:focus-visible, .omni-load-section:focus-visible { outline: 2px solid var(--omni-accent); outline-offset: 2px; }
.omni-row__icon { display: inline-flex; color: var(--ui-text-3); flex-shrink: 0; padding-top: 2px; }
.omni-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.omni-row__name { font-size: 14px; font-weight: 650; overflow-wrap: anywhere; white-space: normal; }
.omni-row__name :deep(mark) { background: color-mix(in srgb, var(--omni-accent) 38%, transparent); color: var(--ui-text); border-radius: 2px; padding: 0 2px; }
.omni-row__sub { color: var(--ui-text-2); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; white-space: normal; }
.omni-row__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; flex: 0 0 auto; }
.omni-row__action, .omni-load-section { min-height: 40px; padding: 7px 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); color: var(--ui-text-2); background: var(--ui-glass-reading, var(--ui-surface)); font: 600 11px var(--ui-font); cursor: pointer; }
.omni-row__action:hover, .omni-load-section:hover { border-color: var(--omni-accent); color: var(--ui-text); }
.omni-row__enter { display: none; }
.omni-row--recent { align-items: center; min-height: 48px; }
.omni-inline { display: flex; gap: 6px; flex: 1; min-width: 0; }
.omni-inline__input { flex: 1; min-width: 0; min-height: 44px; background: var(--ui-surface); border: 1px solid color-mix(in srgb, var(--omni-accent) 55%, transparent); border-radius: var(--ui-radius-sm); color: var(--ui-text); font: 16px var(--ui-font); padding: 5px 9px; outline: none; }
.omni-inline__btn { min-height: 44px; padding: 6px 12px; border-radius: var(--ui-radius-sm); border: 1px solid color-mix(in srgb, var(--omni-accent) 55%, transparent); background: var(--omni-accent); color: var(--ui-on-accent, #fff); font: 700 11px var(--ui-font); cursor: pointer; }
.omni-inline__btn--ghost { background: transparent; color: var(--ui-text-2); border-color: var(--ui-border); }
.omni-inline__btn:disabled { opacity: .45; cursor: default; }
.omni-recent-clear { min-height: 36px; white-space: nowrap; }
.omni-load-section { align-self: flex-start; margin: 1px 0 4px 36px; }
.omni-web { display: flex; flex-direction: column; gap: 9px; border-top: 1px solid var(--ui-hairline); padding-top: 12px; }
.omni-web__answer, .omni-web__result-card { display: flex; flex-direction: column; gap: 8px; padding: 13px 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); color: var(--ui-text); background: var(--ui-glass-reading, var(--ui-surface)); }
.omni--glass .omni-web__answer, .omni--glass .omni-web__result-card { background: var(--ui-glass-reading, var(--ui-surface)); border-color: var(--ui-border); box-shadow: var(--ui-glass-edge); }
.omni-web__answer-body { display: flex; flex-direction: column; gap: 8px; color: var(--ui-text); text-decoration: none; }
.omni-web__answer-body--link { cursor: pointer; border-radius: var(--ui-radius-sm); }
.omni-web__answer-body--link:hover .omni-web__answer-text { text-decoration: underline; text-decoration-color: var(--omni-accent); text-underline-offset: 3px; }
.omni-web__answer-body:focus-visible, .omni-web__result:focus-visible, .omni-web__all:focus-visible, .omni-web__action:focus-visible { outline: 2px solid var(--omni-accent); outline-offset: 2px; }
.omni-web__meta { color: var(--omni-accent); font: 800 9px var(--ui-font-mono); letter-spacing: .1em; overflow-wrap: anywhere; }
.omni-web__answer-text { margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.omni-web__answer-hint { color: var(--ui-text-2); font: 10px var(--ui-font-mono); }
.omni-web__result { display: flex; flex-direction: column; gap: 5px; color: var(--ui-text); text-decoration: none; }
.omni-web__result:hover .omni-web__title { color: var(--omni-accent); }
.omni-web__title { color: var(--ui-text); font-size: 14px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.omni-web__domain { color: var(--ui-text-2); font: 11px var(--ui-font-mono); overflow-wrap: anywhere; }
.omni-web__description, .omni-web__status, .omni-web__disclaimer { margin: 0; color: var(--ui-text-2); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.omni-web__actions { display: flex; flex-wrap: wrap; gap: 7px; }
.omni-web__action, .omni-web__all { align-self: flex-start; min-height: 40px; display: inline-flex; align-items: center; padding: 7px 11px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); color: var(--ui-text); background: transparent; font: 600 11px var(--ui-font); cursor: pointer; text-decoration: none; }
.omni-web__action:hover, .omni-web__all:hover { border-color: var(--omni-accent); }
.omni-web__all { text-decoration: underline; text-underline-offset: 2px; }
.omni-empty-state { padding: 12px; border: 1px dashed var(--ui-border-strong); border-radius: var(--ui-radius-md); color: var(--ui-text-2); background: var(--ui-glass-reading, var(--ui-surface)); font-size: 13px; line-height: 1.5; }
.omni-live-status { margin: 0; color: var(--ui-text-2); font-size: 12px; }
.omni--flat { --omni-accent: #fff; }
.omni--flat .omni-bar, .omni--flat .omni-drop, .omni--flat .omni-row, .omni--flat .omni-web__answer, .omni--flat .omni-web__result-card { background: #000; color: #fff; border-color: #fff; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
.omni--flat .omni-bar__input, .omni--flat .omni-row__name, .omni--flat .omni-row__sub, .omni--flat .omni-web__title, .omni--flat .omni-web__domain, .omni--flat .omni-web__description, .omni--flat .omni-web__answer-text, .omni--flat .omni-web__status, .omni--flat .omni-web__disclaimer { color: #fff; }
.omni--flat .omni-filter, .omni--flat .omni-row__action, .omni--flat .omni-load-section, .omni--flat .omni-web__action, .omni--flat .omni-web__all { color: #fff; border-color: #fff; background: #000; }
.omni--flat .omni-row:hover, .omni--flat .omni-row.active, .omni--flat .omni-filter.is-selected { background: #171717; border-color: #fff; }
.omni-more { display: flex; justify-content: center; padding: 2px 0; }
.omni-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--ui-hairline); padding-top: 9px; }
.omni-foot__counts { font: 800 9px var(--ui-font-mono); letter-spacing: .1em; color: var(--omni-accent); }
.omni-foot__keys { margin-left: auto; color: var(--ui-text-3); font: 9px var(--ui-font-mono); }
.omni--glass.omni--solid .omni-bar,
.omni--glass.omni--solid .omni-drop { backdrop-filter: none; -webkit-backdrop-filter: none; }
@media (prefers-reduced-transparency: reduce) { .omni-bar, .omni-drop { backdrop-filter: none; -webkit-backdrop-filter: none; } }
@media (prefers-contrast: more) { .omni-bar, .omni-drop, .omni-row, .omni-web__answer, .omni-web__result-card, .omni-filter { border-width: 2px; } }
@media (max-width: 768px) {
  .omni:not(.omni--home) { min-width: 0; padding: max(14px, env(safe-area-inset-top, 0px)) 12px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .omni-bar { min-height: 54px; padding-inline: 12px; }
  .omni-bar__input { min-height: 50px; font-size: 16px; }
  .omni-drop, .omni--home .omni-drop {
    box-sizing: border-box;
    flex: 0 0 auto;
    height: max(0px, calc(var(--omni-mobile-results-height, 50dvh) - env(safe-area-inset-bottom, 0px)));
    max-height: max(0px, calc(var(--omni-mobile-results-height, 50dvh) - env(safe-area-inset-bottom, 0px)));
    padding: 11px; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch;
  }
  .omni-drop > * { flex-shrink: 0; }
  .omni-row { min-height: 60px; flex-wrap: wrap; }
  .omni-row__body { flex-basis: calc(100% - 42px); }
  .omni-row__actions { width: 100%; justify-content: flex-start; padding-left: 26px; }
  .omni-row__action { min-height: 44px; }
  .omni-inline { flex-wrap: wrap; }
  .omni-inline__input { flex-basis: 100%; font-size: 16px; }
  .omni-inline__btn { flex: 1 1 calc(50% - 6px); }
  .omni-foot { align-items: flex-start; }
  .omni-foot__keys { display: none; }
}
@media (max-width: 380px) { .omni { padding-inline: 8px; } .omni-drop { padding: 8px; } .omni-row { gap: 8px; padding: 10px; } .omni-row__actions { padding-left: 0; } }
@media (prefers-reduced-motion: reduce) { .omni-drop-enter-active, .omni-drop-leave-active { animation: none; } *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
</style>
