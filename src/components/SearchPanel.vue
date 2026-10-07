<template>
  <div class="panel-search">
    <div class="bw-card search-card">
      <div class="bw-title">SEARCH FILES</div>
      <p class="panel-hint search-sub">Full-text search across file names and contents. Type at least 2 characters.</p>
      <UiToolbar glass divided>
        <template #lead>
          <p class="text-muted search-summary" role="status" aria-live="polite">{{ searchSummary }}</p>
        </template>
        <UiSelect
          v-model="searchTypeFilter"
          :options="SEARCH_TYPE_OPTIONS"
          inline
          aria-label="Filter results by type"
          title="Filter results by type"
        />
        <UiCheckbox v-model="searchCurrentDir" label="Current folder only" title="Only search inside the current folder" />
        <UiButton
          size="sm"
          variant="ghost"
          icon="solar:keyboard-bold"
          icon-only
          title="Keyboard shortcuts (?)"
          aria-label="Open keyboard shortcuts help"
          @click="store.showShortcutsHelp = true"
        />
      </UiToolbar>
    </div>

    <div v-if="store.isSearching" class="panel-loading" role="status" aria-live="polite">
      <UiSpinner size="sm" show-label label="Searching files" />
    </div>

    <div v-if="recentSearches.length > 0 && !store.searchQuery" class="recent-searches">
      <div class="recent-head">
        <div class="bw-title">RECENT SEARCHES</div>
        <UiButton size="xs" variant="ghost" icon-only icon="solar:close-bold" title="Clear recent searches" aria-label="Clear recent searches" @click="clearRecentSearches()" />
      </div>
      <button
        v-for="sq in recentSearches"
        :key="sq"
        type="button"
        class="recent-search-item"
        :title="`Search again for ${sq}`"
        @click="store.searchQuery = sq; store.searchFiles(sq)"
      >
        <span class="text-muted"><AppIcon name="solar:history-bold" :size="12" /></span>
        <span>{{ sq }}</span>
      </button>
    </div>

    <div v-if="sceneMatches.length > 0 && store.searchQuery.trim().length >= 2" class="scene-strip">
      <span class="scene-strip__label">SCENES</span>
      <button
        v-for="s in sceneMatches"
        :key="s.category"
        type="button"
        class="scene-chip"
        :title="`Matched ${s.hits.slice(0, 3).join(', ')} — click to search ${s.category}`"
        @click="searchScene(s.category)"
      >
        {{ s.label.toUpperCase() }} {{ Math.round(s.score * 100) }}%
      </button>
    </div>

    <div v-if="filteredSearchResults.length" class="search-results-list">
      <div
        v-for="result in filteredSearchResults"
        :key="result.fileId"
        class="search-result-item bw-card"
        @click="emit('open', result.fileId)"
      >
        <div class="search-match-type">{{ result.matchType?.toUpperCase() || 'SEARCH' }}</div>
        <div class="search-result-body">
          <div class="search-result-name" v-html="highlightTerms(result.fileName, store.searchQuery)"></div>
          <div class="search-result-snippet text-muted" v-if="result.snippet" v-html="highlightTerms(result.snippet, store.searchQuery)"></div>
          <div v-if="topScene(result.fileName)" class="search-result-scene">
            {{ topScene(result.fileName)!.label.toUpperCase() }} {{ Math.round(topScene(result.fileName)!.score * 100) }}%
          </div>
        </div>
        <div class="search-result-score">{{ result.score.toFixed(3) }}</div>
      </div>
      <UiButton
        v-if="filteredSearchResults.length < store.searchTotalResults"
        icon="solar:double-alt-arrow-down-bold"
        :disabled="store.isSearching"
        @click="store.loadMoreSearchResults()"
      >
        LOAD MORE ({{ store.searchTotalResults - filteredSearchResults.length }} MORE)
      </UiButton>
    </div>
    <UiEmpty
      v-else-if="store.searchQuery && !store.isSearching"
      size="sm"
      icon="solar:magnifier-bold"
      :title="`No results for “${store.searchQuery}”`"
      description="Try fewer words, check spelling, or clear the type filter."
    >
      <template #actions>
        <UiButton size="sm" variant="ghost" @click="clearSearch()">Clear search</UiButton>
        <UiButton size="sm" variant="ghost" @click="store.searchQuery = ''; searchTypeFilter = 'all'">Show everything</UiButton>
      </template>
    </UiEmpty>
    <UiEmpty
      v-else-if="!store.searchQuery"
      size="sm"
      icon="solar:magnifier-bold"
      title="Search your files"
      description="Use the search bar above (Ctrl+F). Try a file name, a word inside a file, or a style tag."
    >
      <template #actions>
        <UiButton size="sm" variant="ghost" icon="solar:face-scan-circle-bold" @click="wm.open('faces')">Browse people</UiButton>
        <UiButton size="sm" variant="ghost" icon="solar:folder-bold" @click="wm.open('files')">Browse files</UiButton>
      </template>
    </UiEmpty>
  </div>
</template>

<script setup lang="ts">
// Shared search surface: the Search window and the Code Studio SEARCH side
// view render the same component — one query UI, one result list. Callers
// decide what opening a result means via the `open` event.
import AppIcon from '@/components/AppIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCheckbox from '@/components/ui/UiCheckbox.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { classifyScene, matchSceneQuery } from '@/utils/scene'

const store = useAppStore()
const wm = useWindowManager()

const emit = defineEmits<{
  open: [fileId: string]
}>()

const searchTypeFilter = ref('all')
const searchCurrentDir = ref(false)

const SEARCH_TYPE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Images', value: 'image' },
  { label: 'Text', value: 'text' },
  { label: 'Folders', value: 'folder' },
  { label: 'Files', value: 'file' },
]

const recentSearches = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem('cybermanju_recent_searches') || '[]') as string[] } catch { return [] }
})())

function clearSearch() {
  store.searchQuery = ''
}

function clearRecentSearches() {
  recentSearches.value = []
  try { localStorage.setItem('cybermanju_recent_searches', '[]') } catch {}
}

const searchSummary = computed(() => {
  const q = store.searchQuery.trim()
  if (store.isSearching) return q ? `Searching for “${q}”…` : 'Searching…'
  if (!q) return 'Type above to search'
  const n = filteredSearchResults.value.length
  const total = store.searchTotalResults
  const shown = total > n ? `${n} of ${total}` : `${n}`
  return `${shown} result${n === 1 ? '' : 's'} for “${q}”`
})

const filteredSearchResults = computed(() => {
  const results = store.searchResults
  if (searchTypeFilter.value === 'all') return results
  return results.filter(r => {
    if (searchTypeFilter.value === 'folder') return r.matchType === 'folder'
    if (searchTypeFilter.value === 'image') return r.matchType === 'image'
    if (searchTypeFilter.value === 'text') return r.matchType === 'text'
    return true
  })
})

/** Scene categories named by the current query (multilingual, scored). */
const sceneMatches = computed(() => {
  const q = store.searchQuery.trim()
  if (q.length < 2) return []
  return matchSceneQuery(q).slice(0, 4)
})

function searchScene(category: string) {
  store.searchQuery = category
  void store.searchFiles(category)
}

/** Top heuristic scene for a result filename (with its tags when known). */
function topScene(fileName: string) {
  const file = store.files.find(f => f.name === fileName)
  const scores = classifyScene({
    fileName,
    tags: file?.tags,
    path: file?.path,
  })
  return scores[0] ?? null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightTerms(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text)
  const escaped = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escapeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>')
}
</script>

<style scoped>
.panel-search {
  padding: 12px;
}
.search-card { margin-bottom: 12px; }
.search-summary { margin: 0; font-size: 10px; flex: 1; min-width: 0; }
.search-sub { margin: -6px 0 10px; }
.bw-title {
  font-family: var(--ui-font);
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text);
  margin-bottom: 10px;
  letter-spacing: 1px;
}
.bw-card {
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 12px;
  color: var(--ui-text);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
}
.panel-hint { font-family: var(--ui-font); font-size: 9px; color: var(--ui-text-3); margin-bottom: 12px; }
.text-muted { color: var(--ui-text-3) !important; }
.recent-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.recent-head .bw-title { margin-bottom: 8px; }
.recent-searches { margin-bottom: 10px; }
.recent-search-item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px;
  cursor: pointer; font-family: var(--ui-font); font-size: 11px; color: var(--ui-text);
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  margin-bottom: 4px; background: var(--ui-glass); text-align: left;
}
.recent-search-item:hover { border-color: var(--ui-border-hover); background: var(--ui-glass-2); }
.search-results-list { display: flex; flex-direction: column; gap: 4px; }
.search-result-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px; cursor: pointer; border-radius: var(--ui-radius-md); }
.search-result-item:hover { border-color: var(--ui-border-hover); }
.search-match-type { font-size: 8px; font-weight: 700; padding: 2px 6px; background: var(--ui-surface-3); color: var(--ui-text-2); white-space: nowrap; border-radius: var(--ui-radius-xs); }
.search-result-body { flex: 1; min-width: 0; }
.search-result-name { font-size: 11px; font-weight: 700; margin-bottom: 2px; }
.search-result-snippet { font-size: 10px; word-break: break-word; }
.search-result-score { font-family: var(--ui-font-mono); font-size: 9px; color: var(--ui-text-3); }
.scene-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.scene-strip__label { font-family: var(--ui-font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--ui-text-3); }
.scene-chip {
  font-family: var(--ui-font-mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em;
  padding: 3px 10px; border-radius: var(--ui-radius-full);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent);
  background: var(--ui-accent-softer); color: var(--ui-accent); cursor: pointer;
}
.scene-chip:hover { background: color-mix(in srgb, var(--ui-accent) 20%, transparent); }
.search-result-scene {
  display: inline-block; margin-top: 3px; font-family: var(--ui-font-mono);
  font-size: 8.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--ui-accent);
  background: var(--ui-accent-softer);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent);
  border-radius: var(--ui-radius-full); padding: 1px 7px;
}
.search-result-name :deep(mark),
.search-result-snippet :deep(mark) {
  background: color-mix(in srgb, var(--ui-accent) 35%, transparent);
  color: var(--ui-text); border-radius: 2px; padding: 0 2px;
}
.panel-loading { display: flex; align-items: center; justify-content: center; padding: 22px 0; }
</style>
