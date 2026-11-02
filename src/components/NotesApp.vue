<!-- CyberManju OS — Notes app (src/components/NotesApp.vue). -->
<!-- Role: create, organize and edit Markdown notes as ordinary managed vault files. -->
<!-- Exports: NotesApp component. -->
<!-- Integrates: managed file APIs, Archive wikilinks, favorites, and provider sync. -->
<!-- Contracts: provider sync is per file and explicit; the .cybermanju container itself is not a sync target. -->
<template>
  <main class="notes-app" @keydown="onEditorKeydown">
    <header class="notes-header">
      <div class="notes-brand">
        <span class="notes-brand-icon"><AppIcon name="solar:notes-bold" :size="20" /></span>
        <div><span class="notes-kicker">CYBERMANJU OS</span><h1>Notes</h1></div>
        <span class="notes-count">{{ noteFiles.length }} {{ noteFiles.length === 1 ? 'note' : 'notes' }}</span>
      </div>
      <div class="notes-header-actions">
        <button type="button" class="notes-button" :disabled="loading" @click="refreshNotes"><AppIcon name="solar:refresh-bold" :size="15" /> Refresh</button>
        <button type="button" class="notes-button notes-button--primary" :disabled="busy" @click="createNote"><AppIcon name="solar:add-circle-bold" :size="16" /> New note</button>
      </div>
    </header>

    <div class="notes-search-row">
      <label class="notes-search">
        <AppIcon name="solar:magnifier-bold" :size="16" />
        <span class="sr-only">Search notes by title</span>
        <input v-model="query" type="search" placeholder="Search your notes…" autocomplete="off" />
      </label>
      <button type="button" class="notes-button notes-button--subtle" :disabled="loading" @click="refreshNotes">{{ loading ? 'Loading…' : 'Reload files' }}</button>
    </div>

    <div class="notes-layout">
      <aside class="notes-sidebar" aria-label="Notes list">
        <div class="notes-sidebar-heading"><span>YOUR NOTES</span><span>{{ filteredNotes.length }}</span></div>
        <div v-if="filteredNotes.length" class="notes-list" role="list">
          <button v-for="note in filteredNotes" :key="note.id" class="notes-list-item" :class="{ selected: note.id === selectedId }" type="button" role="listitem" :aria-current="note.id === selectedId ? 'true' : undefined" @click="openNote(note.id)">
            <AppIcon :name="note.isStarred ? 'solar:star-bold' : 'solar:document-text-bold'" :size="16" />
            <span class="notes-list-copy"><strong>{{ titleFor(note.name) }}</strong><small>{{ notePreview(note) }}</small></span>
            <time :datetime="note.modifiedAt">{{ shortDate(note.modifiedAt) }}</time>
          </button>
        </div>
        <div v-else-if="loading" class="notes-sidebar-empty" role="status">Finding Markdown files…</div>
        <div v-else class="notes-sidebar-empty">{{ query ? 'No notes match that title.' : 'Your vault has no notes yet.' }}<button v-if="!query" type="button" class="text-link" @click="createNote">Create your first note</button></div>
        <div class="notes-sidebar-foot"><span class="sync-indicator" :class="{ connected: syncConfigs.length }" />{{ syncConfigs.length ? `${syncConfigs.length} provider connection${syncConfigs.length === 1 ? '' : 's'}` : 'No provider connection' }}</div>
      </aside>

      <section class="notes-editor" aria-label="Note editor">
        <template v-if="selectedNote">
          <header class="note-toolbar">
            <div class="note-title-wrap">
              <label class="sr-only" :for="`note-title-${selectedNote.id}`">Note title</label>
              <input :id="`note-title-${selectedNote.id}`" v-model="titleDraft" class="note-title" maxlength="120" @blur="renameSelected" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
              <span class="note-extension">.md</span>
            </div>
            <div class="note-actions">
              <span class="save-state" :class="`save-state--${saveState}`" role="status" aria-live="polite">{{ saveLabel }}</span>
              <button type="button" class="notes-icon-button" :aria-pressed="!!selectedNote.isStarred" :aria-label="selectedNote.isStarred ? 'Remove from favorites' : 'Add to favorites'" :title="selectedNote.isStarred ? 'Remove from favorites' : 'Add to favorites'" @click="store.toggleStar(selectedNote.id)"><AppIcon :name="selectedNote.isStarred ? 'solar:star-bold' : 'solar:star-linear'" :size="17" /></button>
              <button type="button" class="notes-icon-button" :aria-pressed="mode === 'preview'" :title="mode === 'preview' ? 'Edit Markdown' : 'Preview Markdown'" @click="togglePreview"><AppIcon :name="mode === 'preview' ? 'solar:pen-bold' : 'solar:eye-bold'" :size="17" /></button>
              <button type="button" class="notes-button notes-save" :disabled="!dirty || busy" @click="saveNote()">Save</button>
              <button type="button" class="notes-icon-button notes-delete" :disabled="busy" :aria-label="confirmDelete ? 'Confirm move to trash' : 'Move note to trash'" :title="confirmDelete ? 'Move to Trash' : 'Move note to Trash'" @click="confirmDelete ? deleteSelected() : confirmDelete = true"><AppIcon :name="confirmDelete ? 'solar:check-circle-bold' : 'solar:trash-bin-trash-bold'" :size="17" /></button>
              <button v-if="confirmDelete" type="button" class="notes-button notes-button--subtle" @click="confirmDelete = false">Cancel</button>
            </div>
          </header>
          <p v-if="errorMessage" class="notes-error" role="alert">{{ errorMessage }}</p>
          <div v-if="saveState === 'conflict'" class="conflict-actions">
            <button type="button" class="notes-button" :disabled="busy" @click="loadLatestVersion">Load latest</button>
            <button type="button" class="notes-button notes-button--primary" :disabled="busy" @click="saveNote(true)">Overwrite with draft</button>
          </div>
          <div class="note-meta"><span>Markdown</span><span>·</span><span>{{ wordCount }} words</span><span>·</span><span>{{ new Date(selectedNote.modifiedAt).toLocaleString() }}</span></div>
          <section v-if="mode === 'write'" class="note-editor-wrap">
            <label class="sr-only" :for="`note-content-${selectedNote.id}`">Markdown note content</label>
            <textarea :id="`note-content-${selectedNote.id}`" v-model="bodyDraft" class="note-editor-input" spellcheck="true" placeholder="# A new thought&#10;&#10;Write in Markdown…" @input="onBodyInput" />
          </section>
          <article v-else class="note-preview markdown-preview" aria-label="Markdown preview" v-html="previewHtml" />
          <footer class="note-footer">
            <div class="note-links"><span>LINKS</span><span v-if="outLinks.length">{{ outLinks.length }} linked note{{ outLinks.length === 1 ? '' : 's' }}</span><span v-else>No internal links yet</span></div>
            <div class="note-links"><span>BACKLINKS</span><span>{{ backlinks.length }} among loaded notes</span></div>
            <p>Use <code>[[note title]]</code> to link another note. Backlinks shown here are limited to note bodies loaded in this session.</p>
          </footer>
        </template>
        <div v-else-if="loading" class="notes-empty-editor" role="status"><span class="notes-spinner" />Loading notes…</div>
        <div v-else class="notes-empty-editor">
          <AppIcon name="solar:notes-bold" :size="34" />
          <h2>{{ query ? 'No matching notes' : 'A clear page' }}</h2>
          <p>{{ query ? 'Try another title or clear the search.' : 'Create a Markdown note. It will be saved as a normal file in this vault.' }}</p>
          <button v-if="!query" type="button" class="notes-button notes-button--primary" @click="createNote">Create note</button>
        </div>
      </section>
    </div>

    <footer class="notes-sync">
      <div class="sync-copy">
        <strong><AppIcon name="solar:cloud-upload-bold" :size="16" /> Provider sync</strong>
        <p>Sync uploads these Markdown files through your configured provider. The <code>.cybermanju</code> container itself is not a sync target; on another device, restore the provider files into that vault. This is not automatic LAN/peer sync. Keep the remote destination private if the notes are private.</p>
      </div>
      <div class="sync-controls">
        <label class="sr-only" for="notes-sync-provider">Provider connection</label>
        <select id="notes-sync-provider" v-model="syncConfigId" :disabled="!syncConfigs.length" aria-label="Provider connection">
          <option value="">{{ syncConfigs.length ? 'Choose provider' : 'No provider configured' }}</option>
          <option v-for="config in syncConfigs" :key="config.id" :value="config.id">{{ config.name || config.backendType }}</option>
        </select>
        <button type="button" class="notes-button notes-button--primary" :disabled="!selectedSyncConfig || !noteFiles.length || syncing" @click="syncAllNotes"><AppIcon name="solar:cloud-upload-bold" :size="15" />{{ syncing ? 'Syncing…' : 'Sync notes' }}</button>
        <button type="button" class="notes-button notes-button--subtle" @click="wm.open('sync')">Sync panel</button>
      </div>
      <p v-if="syncMessage" class="sync-message" role="status" aria-live="polite">{{ syncMessage }}</p>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { invoke } from '@/composables/useTauri'
import type { FileNode, SyncConfig } from '@/types'
import { buildNoteIndex, extractWikilinks, isNoteFile, type NoteDoc } from '@/utils/notes'
import { renderMarkdown } from '@/utils/markdown'

const store = useAppStore()
const wm = useWindowManager()
const query = ref('')
const selectedId = ref('')
const bodyDraft = ref('')
const savedBody = ref('')
const titleDraft = ref('')
const saveState = ref<'saved' | 'unsaved' | 'saving' | 'conflict' | 'error'>('saved')
const errorMessage = ref('')
const loading = ref(false)
const busy = ref(false)
const syncing = ref(false)
const confirmDelete = ref(false)
const mode = ref<'write' | 'preview'>('write')
const syncConfigId = ref('')
const syncMessage = ref('')
const loadedBodies = ref(new Map<string, string>())
let saveTimer: ReturnType<typeof setTimeout> | undefined
let readToken = 0
let loadToken = 0

const noteFiles = computed(() => store.files
  .filter(file => file.fileType !== 'folder' && isNoteFile(file.name, file.fileType) && !file.id.startsWith('providers/') && !file.id.startsWith('host:'))
  .sort((a, b) => Date.parse(b.modifiedAt || '') - Date.parse(a.modifiedAt || '')))
const filteredNotes = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? noteFiles.value.filter(note => note.name.toLowerCase().includes(needle)) : noteFiles.value
})
const selectedNote = computed(() => noteFiles.value.find(note => note.id === selectedId.value) ?? null)
const syncConfigs = computed(() => store.syncConfigs.filter(config => config.enabled))
const selectedSyncConfig = computed<SyncConfig | undefined>(() => syncConfigs.value.find(config => config.id === syncConfigId.value))
const dirty = computed(() => !!selectedNote.value && bodyDraft.value !== savedBody.value)
const saveLabel = computed(() => ({ saved: 'Saved', unsaved: 'Unsaved', saving: 'Saving…', conflict: 'Changed elsewhere', error: 'Save failed' })[saveState.value])
const wordCount = computed(() => bodyDraft.value.trim() ? bodyDraft.value.trim().split(/\s+/).length : 0)
const previewHtml = computed(() => renderMarkdown(bodyDraft.value))
const noteDocs = computed<NoteDoc[]>(() => noteFiles.value.map(note => ({ id: note.id, name: note.name, path: note.path, contentText: loadedBodies.value.get(note.id) })))
const noteIndex = computed(() => buildNoteIndex(noteDocs.value))
const outLinks = computed(() => selectedNote.value ? extractWikilinks(bodyDraft.value) : [])
const backlinks = computed(() => selectedNote.value ? noteIndex.value.backlinks[selectedNote.value.id] ?? [] : [])

function titleFor(name: string): string { return name.replace(/\.(md|markdown|txt)$/i, '') }
function notePreview(note: FileNode): string {
  const body = loadedBodies.value.get(note.id) ?? note.contentText ?? ''
  const plain = body.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim()
  return plain || 'Empty note'
}
function shortDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}
function safeFileName(value: string): string {
  const clean = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/\.+$/g, '').slice(0, 112)
  return `${clean || 'Untitled'}.md`
}

async function readContent(id: string): Promise<string> {
  const result = await invoke<string | { content?: string }>('read_file_content', { fileId: id })
  return typeof result === 'string' ? result : String(result?.content ?? '')
}
async function refreshNotes(): Promise<void> {
  if (dirty.value && !(await saveNote())) return
  loading.value = true
  try {
    await Promise.all([store.fetchFiles('/'), store.fetchSyncConfigs()])
    if (!syncConfigId.value && syncConfigs.value.length) syncConfigId.value = syncConfigs.value[0]!.id
  } finally {
    loading.value = false
  }
}
async function openNote(id: string): Promise<void> {
  if (id === selectedId.value) return
  if (dirty.value) {
    const saved = await saveNote()
    if (!saved) return
  }
  selectedId.value = id
  mode.value = 'write'
  confirmDelete.value = false
}
async function loadSelected(): Promise<void> {
  const token = ++loadToken
  const id = selectedId.value
  if (!id) {
    bodyDraft.value = ''
    savedBody.value = ''
    titleDraft.value = ''
    saveState.value = 'saved'
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const body = await readContent(id)
    if (token !== loadToken) return
    bodyDraft.value = body
    savedBody.value = body
    titleDraft.value = titleFor(selectedNote.value?.name ?? 'Untitled')
    loadedBodies.value.set(id, body)
    saveState.value = 'saved'
  } catch (error) {
    if (token !== loadToken) return
    errorMessage.value = error instanceof Error ? error.message : String(error)
    saveState.value = 'error'
  } finally {
    if (token === loadToken) loading.value = false
  }
}
watch(selectedId, () => { void loadSelected() })
watch(noteFiles, files => {
  if (selectedId.value && files.some(file => file.id === selectedId.value)) return
  selectedId.value = filteredNotes.value[0]?.id ?? files[0]?.id ?? ''
})
watch(query, () => {
  if (selectedId.value && !filteredNotes.value.some(file => file.id === selectedId.value)) {
    if (dirty.value) {
      errorMessage.value = 'Save or resolve the current note before changing the selection.'
      return
    }
    selectedId.value = filteredNotes.value[0]?.id ?? ''
  }
})
watch(() => store.lastSyncAt, (at, previous) => {
  if (at && at !== previous) syncMessage.value = store.lastSyncSummary || 'Provider sync finished; check the Sync panel for status.'
})

function onBodyInput(): void {
  errorMessage.value = ''
  saveState.value = dirty.value ? 'unsaved' : 'saved'
  if (saveTimer) clearTimeout(saveTimer)
  if (dirty.value) saveTimer = setTimeout(() => { void saveNote() }, 1200)
}
async function saveNote(force = false): Promise<boolean> {
  const id = selectedId.value
  const content = bodyDraft.value
  if (!id || !dirty.value) return !!id
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  const baseline = savedBody.value
  const token = ++readToken
  busy.value = true
  saveState.value = 'saving'
  errorMessage.value = ''
  try {
    if (!force) {
      const latest = await readContent(id)
      if (latest !== baseline) {
        saveState.value = 'conflict'
        errorMessage.value = 'This note changed after it was opened. Load the latest version or explicitly overwrite it with your draft.'
        return false
      }
    }
    await invoke('write_file_content', { fileId: id, content })
    if (token !== readToken) return false
    savedBody.value = content
    loadedBodies.value.set(id, content)
    saveState.value = 'saved'
    await store.fetchFiles('/')
    return true
  } catch (error) {
    saveState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    if (token === readToken) busy.value = false
  }
}
async function loadLatestVersion(): Promise<void> {
  const id = selectedId.value
  if (!id) return
  busy.value = true
  try {
    const latest = await readContent(id)
    bodyDraft.value = latest
    savedBody.value = latest
    loadedBodies.value.set(id, latest)
    errorMessage.value = ''
    saveState.value = 'saved'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    saveState.value = 'error'
  } finally {
    busy.value = false
  }
}
function onEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveNote()
  }
}
async function togglePreview(): Promise<void> {
  if (mode.value === 'write') {
    if (dirty.value && !(await saveNote())) return
    mode.value = 'preview'
  } else mode.value = 'write'
}
async function renameSelected(): Promise<void> {
  const note = selectedNote.value
  if (!note || !titleDraft.value.trim()) return
  const nextName = safeFileName(titleDraft.value)
  if (nextName === note.name) return
  busy.value = true
  try {
    await invoke('rename_file', { fileId: note.id, newName: nextName })
    await store.fetchFiles('/')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    saveState.value = 'error'
  } finally {
    busy.value = false
  }
}
async function createNote(): Promise<void> {
  if (dirty.value && !(await saveNote())) return
  busy.value = true
  errorMessage.value = ''
  try {
    const title = `Untitled ${new Date().toLocaleDateString()}`
    const body = '# New note\n\n'
    const node = await invoke<FileNode>('upload_file', {
      fileName: safeFileName(title),
      fileData: Array.from(new TextEncoder().encode(body)),
      parentPath: '/',
    })
    if (!node?.id) throw new Error('The vault did not return a note id.')
    await store.fetchFiles('/')
    selectedId.value = node.id
    mode.value = 'write'
    syncMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    saveState.value = 'error'
  } finally {
    busy.value = false
  }
}
async function deleteSelected(): Promise<void> {
  const note = selectedNote.value
  if (!note) return
  if (dirty.value && !(await saveNote())) return
  busy.value = true
  try {
    await store.deleteFile(note.id)
    confirmDelete.value = false
    await store.fetchFiles('/')
    selectedId.value = filteredNotes.value[0]?.id ?? ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
async function syncAllNotes(): Promise<void> {
  if (!selectedSyncConfig.value || !noteFiles.value.length) return
  if (dirty.value && !(await saveNote())) return
  syncing.value = true
  syncMessage.value = 'Sending Markdown files to the selected provider…'
  try {
    const started = await store.startSync(selectedSyncConfig.value.id, noteFiles.value.map(note => note.id))
    if (!started) {
      syncMessage.value = 'Provider sync could not start. Check the Sync panel, connection and host support.'
      return
    }
    await store.fetchSyncRuns()
    const progress = store.syncProgress
    syncMessage.value = progress?.status ? `Sync status: ${progress.status}. Open Sync for details and restore options.` : 'Sync started; open the Sync panel to follow progress and restore options.'
  } catch (error) {
    syncMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    syncing.value = false
  }
}

onMounted(async () => {
  await refreshNotes()
  if (!selectedId.value) selectedId.value = filteredNotes.value[0]?.id ?? ''
})
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (dirty.value) void saveNote()
})
</script>

<style scoped>
.notes-app { display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; color:var(--ui-text); background:var(--ui-surface); font-family:var(--ui-font); }
.notes-header,.notes-search-row,.note-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.notes-header { padding:14px 18px 12px; border-bottom:1px solid var(--ui-border); }
.notes-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.notes-brand-icon { display:grid; width:38px; height:38px; place-items:center; border:1px solid color-mix(in srgb,var(--ui-accent) 28%,var(--ui-border)); border-radius:12px; background:color-mix(in srgb,var(--ui-accent) 10%,transparent); color:var(--ui-accent); }
.notes-kicker { color:var(--ui-text-3); font-size:9px; font-weight:800; letter-spacing:.13em; }
.notes-brand h1 { margin:1px 0 0; font-size:19px; line-height:1.15; }
.notes-count { padding:4px 8px; border:1px solid var(--ui-border); border-radius:999px; color:var(--ui-text-3); font-size:10px; white-space:nowrap; }
.notes-header-actions,.note-actions,.sync-controls { display:flex; align-items:center; gap:7px; }
.notes-button,.notes-icon-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:36px; border:1px solid var(--ui-border); border-radius:10px; padding:7px 10px; background:var(--ui-glass); color:var(--ui-text); font:inherit; font-size:11px; cursor:pointer; }
.notes-button:hover:not(:disabled),.notes-icon-button:hover:not(:disabled) { border-color:var(--ui-accent); }
.notes-button:disabled,.notes-icon-button:disabled { opacity:.52; cursor:not-allowed; }
.notes-button--primary { border-color:color-mix(in srgb,var(--ui-accent) 60%,var(--ui-border)); background:color-mix(in srgb,var(--ui-accent) 17%,var(--ui-glass)); }
.notes-button--subtle { background:transparent; color:var(--ui-text-2); }
.notes-search-row { padding:10px 18px; border-bottom:1px solid var(--ui-border); }
.notes-search { display:flex; align-items:center; gap:8px; flex:1; min-width:0; max-width:440px; height:36px; padding:0 10px; border:1px solid var(--ui-border); border-radius:10px; background:var(--ui-glass); color:var(--ui-text-3); }
.notes-search input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--ui-text); font:inherit; font-size:11px; }
.notes-layout { display:grid; grid-template-columns:minmax(180px, 28%) minmax(0,1fr); flex:1; min-height:0; }
.notes-sidebar { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid var(--ui-border); background:color-mix(in srgb,var(--ui-glass) 48%,transparent); }
.notes-sidebar-heading { display:flex; justify-content:space-between; padding:12px 12px 8px; color:var(--ui-text-3); font-size:9px; font-weight:800; letter-spacing:.12em; }
.notes-list { display:flex; flex-direction:column; gap:3px; overflow:auto; padding:4px 7px 10px; }
.notes-list-item { display:flex; align-items:center; gap:8px; min-width:0; min-height:54px; border:1px solid transparent; border-radius:10px; padding:7px 8px; background:transparent; color:var(--ui-text-2); text-align:left; cursor:pointer; }
.notes-list-item.selected { border-color:color-mix(in srgb,var(--ui-accent) 40%,var(--ui-border)); background:color-mix(in srgb,var(--ui-accent) 9%,var(--ui-glass)); color:var(--ui-text); }
.notes-list-copy { display:flex; flex:1; flex-direction:column; gap:3px; min-width:0; }
.notes-list-copy strong,.notes-list-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.notes-list-copy strong { font-size:11px; }
.notes-list-copy small { color:var(--ui-text-3); font-size:9px; }
.notes-list-item time { align-self:flex-start; color:var(--ui-text-3); font-size:9px; white-space:nowrap; }
.notes-sidebar-empty { display:flex; flex-direction:column; gap:8px; padding:14px 12px; color:var(--ui-text-3); font-size:11px; line-height:1.5; }
.text-link { align-self:flex-start; border:0; background:transparent; color:var(--ui-accent); font:inherit; cursor:pointer; }
.notes-sidebar-foot { display:flex; align-items:center; gap:7px; margin-top:auto; padding:10px 12px; border-top:1px solid var(--ui-border); color:var(--ui-text-3); font-size:9px; }
.sync-indicator { width:7px; height:7px; border-radius:50%; background:#8791a1; }
.sync-indicator.connected { background:#47c98d; box-shadow:0 0 9px #47c98d66; }
.notes-editor { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; }
.note-toolbar { flex-wrap:wrap; padding:10px 14px 7px; }
.note-title-wrap { display:flex; align-items:center; flex:1; min-width:140px; gap:4px; }
.note-title { width:100%; min-width:0; border:0; outline:0; background:transparent; color:var(--ui-text); font:inherit; font-size:17px; font-weight:700; }
.note-extension { color:var(--ui-text-3); font-size:10px; }
.note-actions { justify-content:flex-end; flex-wrap:wrap; }
.notes-icon-button { width:34px; min-width:34px; min-height:34px; padding:6px; }
.notes-save { min-height:34px; padding:6px 12px; }
.notes-delete { color:#ee8790; }
.save-state { min-width:70px; color:var(--ui-text-3); font-size:9px; text-align:right; }
.save-state--unsaved,.save-state--conflict { color:#e8b66e; }
.save-state--error { color:#ff8585; }
.save-state--saved { color:#63d3a2; }
.note-meta { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 9px; color:var(--ui-text-3); font-size:9px; }
.note-editor-wrap { display:flex; flex:1; min-height:0; padding:0 14px 10px; }
.note-editor-input { flex:1; width:100%; min-height:180px; resize:none; border:1px solid var(--ui-border); border-radius:12px; padding:14px; background:color-mix(in srgb,var(--ui-glass) 74%,transparent); color:var(--ui-text); font-family:var(--ui-font-mono); font-size:12px; line-height:1.7; tab-size:2; }
.note-editor-input:focus-visible { outline:2px solid var(--ui-accent); outline-offset:1px; }
.note-preview { flex:1; min-height:0; margin:0 14px 10px; overflow:auto; border:1px solid var(--ui-border); border-radius:12px; padding:14px; background:color-mix(in srgb,var(--ui-glass) 74%,transparent); line-height:1.65; }
.markdown-preview :deep(h1) { margin-top:0; font-size:24px; }
.markdown-preview :deep(h2),.markdown-preview :deep(h3) { margin:1.2em 0 .45em; }
.markdown-preview :deep(p),.markdown-preview :deep(ul),.markdown-preview :deep(ol) { color:var(--ui-text-2); font-size:12px; }
.markdown-preview :deep(code),.note-footer code,.notes-sync code { border-radius:4px; padding:1px 4px; background:color-mix(in srgb,var(--ui-accent) 11%,transparent); font-family:var(--ui-font-mono); }
.markdown-preview :deep(pre) { overflow:auto; padding:10px; border-radius:8px; background:color-mix(in srgb,var(--ui-glass) 72%,#000); }
.note-footer { display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; padding:9px 14px 11px; border-top:1px solid var(--ui-border); }
.note-links { display:flex; gap:6px; min-width:0; color:var(--ui-text-3); font-size:9px; }
.note-links span:first-child { font-weight:800; letter-spacing:.08em; }
.note-footer p { grid-column:1 / -1; margin:0; color:var(--ui-text-3); font-size:9px; }
.notes-error { margin:0 14px 8px; border-left:3px solid #e46d75; padding:7px 9px; background:color-mix(in srgb,#e46d75 10%,transparent); color:var(--ui-text); font-size:10px; line-height:1.45; }
.conflict-actions { display:flex; flex-wrap:wrap; gap:7px; padding:0 14px 9px; }
.notes-empty-editor { display:flex; flex:1; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:24px; color:var(--ui-text-3); text-align:center; }
.notes-empty-editor h2 { margin:0; color:var(--ui-text); font-size:17px; }
.notes-empty-editor p { max-width:300px; margin:0 0 6px; font-size:11px; line-height:1.55; }
.notes-spinner { width:21px; height:21px; border:2px solid var(--ui-border); border-top-color:var(--ui-accent); border-radius:50%; animation:notes-spin .8s linear infinite; }
.notes-sync { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px 16px; padding:10px 14px; border-top:1px solid var(--ui-border); background:color-mix(in srgb,var(--ui-glass) 68%,transparent); }
.sync-copy { min-width:0; }
.sync-copy strong { display:flex; align-items:center; gap:6px; color:var(--ui-text); font-size:10px; }
.sync-copy p { margin:4px 0 0; color:var(--ui-text-3); font-size:9px; line-height:1.45; }
.sync-controls select { max-width:150px; min-height:34px; border:1px solid var(--ui-border); border-radius:9px; padding:5px 8px; background:var(--ui-surface); color:var(--ui-text); font:inherit; font-size:10px; }
.sync-controls .notes-button { min-height:34px; font-size:10px; }
.sync-message { grid-column:1 / -1; margin:0; color:var(--ui-text-2); font-size:9px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@keyframes notes-spin { to { transform:rotate(360deg); } }
@media (max-width:680px) {
  .notes-header { align-items:flex-start; padding:11px 12px; }
  .notes-count { display:none; }
  .notes-header-actions { gap:5px; }
  .notes-header-actions .notes-button { font-size:10px; padding:6px 8px; }
  .notes-search-row { padding:8px 12px; }
  .notes-layout { grid-template-columns:minmax(100px,34%) minmax(0,1fr); }
  .notes-list-item { gap:5px; padding:6px; }
  .notes-list-item time { display:none; }
  .note-toolbar { padding:8px; gap:6px; }
  .note-actions { gap:4px; }
  .save-state { min-width:auto; }
  .note-title { font-size:14px; }
  .note-editor-wrap { padding:0 8px 8px; }
  .note-editor-input { padding:10px; font-size:11px; }
  .notes-sync { grid-template-columns:1fr; padding:9px 10px; }
  .sync-controls { flex-wrap:wrap; }
  .sync-controls select { flex:1; min-width:130px; }
}
@media (prefers-reduced-motion:reduce) { .notes-spinner { animation:none; } }
</style>
