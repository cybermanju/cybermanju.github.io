<template>
  <div class="window-content-panel">
    <!-- Search Panel -->
    <div v-if="panelType === 'search'" class="panel-search">
      <div class="bw-card search-card">
        <div class="bw-title">TANTIVY SEARCH</div>
        <UiToolbar glass divided>
          <template #lead>
            <p class="text-muted search-summary">"{{ store.searchQuery }}" - {{ filteredSearchResults.length }} RESULTS</p>
          </template>
          <UiSelect
            v-model="searchTypeFilter"
            :options="SEARCH_TYPE_OPTIONS"
            inline
            aria-label="Filter by type"
            title="FILTER BY TYPE"
          />
          <UiCheckbox v-model="searchCurrentDir" label="DIR" title="SEARCH ONLY IN CURRENT DIRECTORY" />
        </UiToolbar>
      </div>

      <div v-if="recentSearches.length > 0 && !store.searchQuery" class="recent-searches">
        <div class="bw-title">RECENT SEARCHES</div>
        <div v-for="sq in recentSearches" :key="sq" class="recent-search-item" @click="store.searchQuery = sq; store.searchFiles(sq)">
          <span class="text-muted"><AppIcon name="solar:history-bold" :size="12" /></span>
          <span>{{ sq }}</span>
        </div>
      </div>

      <div v-if="filteredSearchResults.length" class="search-results-list">
        <div
          v-for="result in filteredSearchResults"
          :key="result.fileId"
          class="search-result-item bw-card"
          @click="store.selectFile(result.fileId); wm.open('files')"
        >
          <div class="search-match-type">{{ result.matchType?.toUpperCase() || 'SEARCH' }}</div>
          <div class="search-result-body">
            <div class="search-result-name" v-html="highlightTerms(result.fileName, store.searchQuery)"></div>
            <div class="search-result-snippet text-muted" v-if="result.snippet" v-html="highlightTerms(result.snippet, store.searchQuery)"></div>
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
      />
      <UiEmpty
        v-else-if="!store.searchQuery"
        size="sm"
        icon="solar:magnifier-bold"
        title="Tantivy BM25 search"
        description="Type in the search bar to search file contents."
      />
    </div>

    <!-- Trash Panel -->
    <div v-if="panelType === 'trash'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">TRASH</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH TRASH" aria-label="REFRESH TRASH" @click="store.fetchTrashItems()" />
            <UiButton size="sm" variant="danger" icon="solar:trash-bin-trash-bold" icon-only title="EMPTY TRASH" aria-label="EMPTY TRASH" @click="store.emptyTrash()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">DELETED FILES CAN BE RESTORED FROM HERE.</p>
        <UiEmpty
          v-if="store.trashItems.length === 0"
          size="sm"
          icon="solar:trash-bin-trash-bold"
          title="No files in trash"
        />
        <div v-else class="trash-list">
          <div v-for="item in store.trashItems" :key="item.id" class="trash-item">
            <span class="trash-icon"><AppIcon :name="item.originalFile.fileType === 'folder' ? 'solar:folder-bold' : 'solar:file-bold'" :size="14" /></span>
            <div class="trash-info">
              <span class="trash-name truncate">{{ item.originalFile.name }}</span>
              <span class="trash-date text-muted">{{ new Date(item.deletedAt).toLocaleDateString() }}</span>
            </div>
            <div class="trash-actions">
              <UiButton size="xs" icon="solar:undo-left-round-bold" icon-only title="RESTORE" aria-label="RESTORE" @click="store.restoreTrashItem(item.originalFile.id)" />
              <UiButton size="xs" variant="danger" icon="solar:trash-bin-trash-bold" icon-only title="DELETE PERMANENTLY" aria-label="DELETE PERMANENTLY" @click="store.deleteFromTrash(item.originalFile.id)" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity Panel -->
    <div v-if="panelType === 'activity'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">ACTIVITY LOG</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH" aria-label="REFRESH ACTIVITY" @click="store.fetchAuditLog()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">FILE OPERATIONS TIMELINE.</p>
        <UiEmpty
          v-if="store.auditLog.length === 0"
          size="sm"
          icon="solar:pulse-bold"
          title="No recent activity"
        />
        <div v-else class="activity-list">
          <div v-for="entry in store.auditLog" :key="entry.id" class="activity-item">
            <span class="activity-action">{{ entry.action.toUpperCase() }}</span>
            <span class="activity-entity text-muted">{{ entry.entityType }}</span>
            <span class="activity-date text-muted">{{ new Date(entry.timestamp).toLocaleString() }}</span>
            <span v-if="entry.details && Object.keys(entry.details).length" class="activity-detail text-muted">{{ JSON.stringify(entry.details).substring(0, 40) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Favorites Panel -->
    <div v-if="panelType === 'favorites'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">FAVORITES · {{ store.starredFiles.length }}</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH" aria-label="REFRESH FAVORITES" :loading="store.isLoading" @click="refreshPanel()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">STARRED FILES — PERSISTED IN THE LOCAL DB MIRROR.</p>
        <UiError
          v-if="store.lastError"
          size="sm"
          title="Could not load favorites"
          :message="store.lastError"
          retryable
          @retry="refreshPanel()"
        />
        <div v-else-if="store.isLoading && store.starredFiles.length === 0" class="panel-loading">
          <UiSpinner size="sm" show-label label="Loading favorites" />
        </div>
        <UiEmpty
          v-else-if="store.starredFiles.length === 0"
          size="sm"
          icon="solar:star-bold"
          title="No starred files"
          description="Star anything in Files to pin it here."
        />
        <div v-else class="fav-list">
          <div v-for="f in store.starredFiles" :key="f.id" class="fav-item" @click="store.selectFile(f.id)">
            <span class="fav-icon"><AppIcon :name="f.fileType === 'folder' ? 'solar:folder-bold' : 'solar:file-bold'" :size="14" /></span>
            <span class="fav-name truncate">{{ f.name }}</span>
            <UiButton size="xs" variant="ghost" icon="solar:star-bold" icon-only title="UNSTAR" aria-label="UNSTAR" @click.stop="store.toggleStar(f.id)" />
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Panel -->
    <div v-if="panelType === 'recent'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">RECENT FILES</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH" aria-label="REFRESH RECENT" :loading="store.isLoading" @click="refreshPanel()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">NEWEST FIRST — LIVE FROM THE FILE TABLE.</p>
        <UiError
          v-if="store.lastError"
          size="sm"
          title="Could not load recent files"
          :message="store.lastError"
          retryable
          @retry="refreshPanel()"
        />
        <div v-else-if="store.isLoading && recentFiles.length === 0" class="panel-loading">
          <UiSpinner size="sm" show-label label="Loading recent files" />
        </div>
        <UiEmpty
          v-else-if="recentFiles.length === 0"
          size="sm"
          icon="solar:history-bold"
          title="No files yet"
        />
        <div v-else class="recent-list">
          <div
            v-for="f in recentFiles"
            :key="f.id"
            class="recent-item"
            @click="store.selectFile(f.id)"
          >
            <span class="recent-icon"><AppIcon :name="f.fileType === 'folder' ? 'solar:folder-bold' : 'solar:file-bold'" :size="14" /></span>
            <div class="recent-info">
              <span class="recent-name truncate">{{ f.name }}</span>
              <span class="recent-date text-muted">{{ new Date(f.modifiedAt).toLocaleDateString() }}</span>
            </div>
            <UiButton size="xs" variant="ghost" :icon="f.isStarred ? 'solar:star-bold' : 'solar:star-linear'" icon-only :title="f.isStarred ? 'UNSTAR' : 'STAR'" :aria-label="f.isStarred ? 'UNSTAR' : 'STAR'" @click.stop="store.toggleStar(f.id)" />
          </div>
        </div>
      </div>
    </div>

    <!-- Loose Groups Panel -->
    <div v-if="panelType === 'loose-groups'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">LOOSE FILE GROUPING · {{ store.looseGroups.length }}</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH" aria-label="REFRESH LOOSE GROUPS" :loading="store.isLoading" @click="refreshPanel()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">AD-HOC GROUPS — STORED IN THE INTERNAL DB ON EVERY TRANSPORT.</p>
        <UiError
          v-if="store.lastError"
          size="sm"
          title="Could not load loose groups"
          :message="store.lastError"
          retryable
          @retry="refreshPanel()"
        />
        <form class="loose-create" @submit.prevent="createGroup()">
          <UiInput
            v-model="looseName"
            placeholder="New group name…"
            aria-label="New loose group name"
            clearable
          />
          <UiButton size="sm" icon="solar:add-circle-bold" type="submit" :loading="looseBusy" :disabled="!looseName.trim()">
            CREATE
          </UiButton>
        </form>
        <UiEmpty
          v-if="!store.lastError && store.looseGroups.length === 0"
          size="sm"
          icon="solar:users-group-two-rounded-bold"
          title="No loose groups yet"
          description="Create one above, then add files from the picker on each card."
        />
        <div v-else class="loose-groups-list">
          <div v-for="group in store.looseGroups" :key="group.id" class="loose-group-item panel-card-row">
            <div class="lg-info">
              <div class="lg-name">{{ group.name }}</div>
              <div class="lg-count">{{ group.fileIds.length }} FILES</div>
              <div v-if="group.fileIds.length" class="lg-members">
                <button
                  v-for="fid in group.fileIds"
                  :key="fid"
                  type="button"
                  class="lg-member"
                  :title="fileName(fid)"
                  @click="store.selectFile(fid)"
                >
                  {{ fileName(fid) }}
                </button>
              </div>
              <div class="lg-add">
                <UiSelect
                  v-model="addTarget[group.id]"
                  :options="fileOptions"
                  inline
                  aria-label="Pick a file to add"
                  title="PICK A FILE TO ADD"
                />
                <UiButton size="xs" icon="solar:add-circle-bold" :disabled="!addTarget[group.id]" @click="addFile(group.id)">
                  ADD
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Style Tags Panel -->
    <div v-if="panelType === 'style'" class="panel-page">
      <div class="panel-card">
        <UiToolbar divided>
          <template #lead>
            <div class="panel-title">STYLE-BASED ORGANIZATION</div>
          </template>
          <template #trail>
            <UiButton size="sm" icon="solar:refresh-bold" icon-only title="REFRESH" aria-label="REFRESH TAGS" :loading="store.isLoading" @click="refreshPanel()" />
          </template>
        </UiToolbar>
        <p class="panel-hint">FILES ORGANIZED BY VISUAL STYLE (CLIP MODEL)</p>
        <UiError
          v-if="store.lastError"
          size="sm"
          title="Could not load tags"
          :message="store.lastError"
          retryable
          @retry="refreshPanel()"
        />
        <div v-else-if="store.isLoading && allStyleTags.length === 0" class="panel-loading">
          <UiSpinner size="sm" show-label label="Loading tags" />
        </div>
        <UiEmpty
          v-else-if="allStyleTags.length === 0"
          size="sm"
          icon="solar:tag-bold"
          title="No style tags yet"
          description="Tags appear here once files are tagged."
        />
        <div v-else class="style-tags">
          <span v-for="tag in allStyleTags" :key="tag" class="style-tag" @click="store.searchQuery = tag; wm.open('search'); store.searchFiles(tag)">
            {{ tag }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCheckbox from '@/components/ui/UiCheckbox.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import type { PanelType } from '@/types'

const props = defineProps<{
  panelType: PanelType
}>()

const store = useAppStore()
const wm = useWindowManager()

const looseName = ref('')
const looseBusy = ref(false)
const addTarget = ref<Record<string, string>>({})

async function refreshPanel() {
  store.clearError()
  await Promise.allSettled([store.fetchFiles(), store.fetchLooseGroups()])
}

async function createGroup() {
  const name = looseName.value.trim()
  if (!name) return
  looseBusy.value = true
  try {
    const created = await store.createLooseGroup(name)
    if (created) looseName.value = ''
  } finally {
    looseBusy.value = false
  }
}

async function addFile(groupId: string) {
  const fid = addTarget.value[groupId]
  if (!fid) return
  await store.addFileToLooseGroup(groupId, fid)
}

function fileName(fileId: string): string {
  return store.files.find(f => f.id === fileId)?.name ?? fileId.slice(0, 8)
}

const fileOptions = computed(() =>
  store.files.map(f => ({ label: f.name, value: f.id }))
)

const allStyleTags = computed(() =>
  [...new Set(store.files.flatMap(f => f.tags || []))].sort()
)

onMounted(() => {
  if (['favorites', 'recent', 'loose-groups', 'style'].includes(props.panelType)) {
    void refreshPanel()
  }
})

const searchTypeFilter = ref('all')
const searchCurrentDir = ref(false)

const SEARCH_TYPE_OPTIONS = [
  { label: 'ALL', value: 'all' },
  { label: 'IMAGES', value: 'image' },
  { label: 'TEXT', value: 'text' },
  { label: 'FOLDERS', value: 'folder' },
  { label: 'FILES', value: 'file' },
]

const recentSearches = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem('cybermanju_recent_searches') || '[]') as string[] } catch { return [] }
})())

const recentFiles = computed(() =>
  [...store.files]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 20)
)

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
.window-content-panel {
  height: 100%;
  overflow-y: auto;
  padding: 0;
  background: var(--ui-surface);
}

.panel-page {
  padding: 12px;
}

.panel-card {
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 16px;
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  box-shadow: var(--ui-shadow-1);
}

.panel-card-row {
  background: var(--ui-glass);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out);
}

.panel-card-row:hover {
  border-color: var(--ui-border-hover);
}

.panel-card-row.active {
  border-color: color-mix(in srgb, var(--ui-accent) 40%, transparent);
  box-shadow: var(--ui-glow-soft);
}

.panel-title {
  font-family: var(--ui-font);
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text);
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.panel-hint {
  font-family: var(--ui-font);
  font-size: 9px;
  color: var(--ui-text-3);
  margin-bottom: 12px;
}

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

.search-card { margin-bottom: 12px; }
.search-summary { margin: 0; font-size: 10px; flex: 1; min-width: 0; }

.text-muted {
  color: var(--ui-text-3) !important;
}

/* Search panel styles */
.panel-search {
  padding: 12px;
}

.recent-searches {
  margin-bottom: 10px;
}

.recent-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-family: var(--ui-font);
  font-size: 11px;
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  margin-bottom: 4px;
  background: var(--ui-glass);
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out);
}

.recent-search-item:hover {
  border-color: var(--ui-border-hover);
  background: var(--ui-glass-2);
}

.search-results-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-result-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out);
  border-radius: var(--ui-radius-md);
}

.search-result-item:hover {
  border-color: var(--ui-border-hover);
}

.search-match-type {
  font-size: 8px;
  font-weight: 700;
  padding: 2px 6px;
  background: var(--ui-surface-3);
  color: var(--ui-text-2);
  white-space: nowrap;
  border-radius: var(--ui-radius-xs);
}

.search-result-body {
  flex: 1;
  min-width: 0;
}

.search-result-name {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 2px;
}

.search-result-snippet {
  font-size: 10px;
  word-break: break-word;
}

.search-result-score {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  color: var(--ui-text-3);
}

.search-result-name :deep(mark),
.search-result-snippet :deep(mark) {
  background: color-mix(in srgb, var(--ui-accent) 35%, transparent);
  color: var(--ui-text);
  border-radius: 2px;
  padding: 0 2px;
}

.trash-list,
.activity-list,
.fav-list,
.recent-list,
.loose-groups-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trash-item,
.fav-item,
.recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-glass);
  cursor: pointer;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out);
}

.trash-item:hover,
.fav-item:hover,
.recent-item:hover {
  border-color: var(--ui-border-hover);
}

.trash-icon,
.fav-icon,
.recent-icon {
  color: var(--ui-text-2);
  display: flex;
  flex-shrink: 0;
}

.trash-info,
.recent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trash-name,
.fav-name,
.recent-name {
  font-size: 11px;
  font-weight: 600;
}

.trash-date,
.recent-date {
  font-size: 9px;
}

.trash-actions {
  display: flex;
  gap: 4px;
}

.activity-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ui-hairline);
  font-size: 10px;
  align-items: baseline;
}

.activity-action {
  font-weight: 700;
  min-width: 72px;
}

.activity-entity {
  min-width: 70px;
}

.activity-date {
  font-family: var(--ui-font-mono);
  font-size: 9px;
}

.activity-detail {
  font-family: var(--ui-font-mono);
  font-size: 9px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lg-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lg-name {
  font-size: 12px;
  font-weight: 700;
}

.lg-count {
  font-size: 9px;
  color: var(--ui-text-3);
}

.style-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.style-tag {
  font-family: var(--ui-font-mono);
  font-size: 10px;
  padding: 4px 10px;
  border-radius: var(--ui-radius-full);
  border: 1px solid var(--ui-border);
  background: var(--ui-glass);
  color: var(--ui-text-2);
  cursor: pointer;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out), color var(--ui-dur-fast) var(--ui-ease-out);
}

.style-tag:hover {
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
  color: var(--ui-accent);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px 0;
}

.loose-create {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.loose-create > :first-child {
  flex: 1;
  min-width: 0;
}

.lg-members {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.lg-member {
  font-family: var(--ui-font-mono);
  font-size: 9.5px;
  padding: 2px 8px;
  border-radius: var(--ui-radius-full);
  border: 1px solid var(--ui-border);
  background: var(--ui-glass);
  color: var(--ui-text-2);
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color var(--ui-dur-fast) var(--ui-ease-out), color var(--ui-dur-fast) var(--ui-ease-out);
}

.lg-member:hover {
  border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent);
  color: var(--ui-accent);
}

.lg-add {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.lg-add > :first-child {
  flex: 1;
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .window-content-panel .ui-empty,
  .window-content-panel .ui-error {
    animation: none;
  }
}
</style>
