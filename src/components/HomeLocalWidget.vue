<!-- CyberManju OS — HomeLocalWidget (src/components/HomeLocalWidget.vue). -->
<!-- Role: render useful, stateful Home widgets without implying native services. -->
<!-- Exports: HomeLocalWidget component. -->
<!-- Integrates: shared tasks, managed Markdown files, app store and workspace state. -->
<!-- Contracts: notes are real vault files; task rows share Archive state; clock/timer remain local UI features. -->
<template>
  <div class="local-widget" :class="`local-widget--${item.ref}`">
    <template v-if="item.ref === 'clock'">
      <div class="clock-readout">
        <time class="widget-clock" :datetime="nowIso">{{ clock }}</time>
        <div class="clock-date">{{ date }}</div>
      </div>
      <p class="widget-caption">Local device time</p>
    </template>

    <template v-else-if="item.ref === 'notes'">
      <div class="widget-heading">
        <div><span class="widget-eyebrow">QUICK CAPTURE</span><strong>Notes</strong></div>
        <button class="widget-icon-button" type="button" aria-label="Open Notes app" title="Open Notes" @click="openNotes">↗</button>
      </div>
      <div v-if="noteFiles.length" class="quick-note-body">
        <label class="sr-only" :for="`quick-note-select-${item.id}`">Choose a note</label>
        <select :id="`quick-note-select-${item.id}`" :value="selectedNoteId" class="widget-select" @change="selectQuickNote(($event.target as HTMLSelectElement).value)">
          <option v-for="note in noteFiles" :key="note.id" :value="note.id">{{ note.name }}</option>
        </select>
        <textarea
          :id="`quick-note-body-${item.id}`"
          :value="noteDraft"
          maxlength="20000"
          aria-label="Quick note text"
          placeholder="Capture an idea…"
          @input="editQuickNote(($event.target as HTMLTextAreaElement).value)"
          @blur="saveQuickNote()"
        />
        <div class="widget-note-footer">
          <span class="widget-caption" role="status" aria-live="polite">{{ noteStatus }}</span>
          <button class="text-button" type="button" @click="openNotes">All notes</button>
        </div>
      </div>
      <div v-else class="widget-empty">
        <p>{{ notesLoading ? 'Loading notes…' : 'Notes are managed Markdown files. Choose a connected provider in Notes to sync them.' }}</p>
        <button type="button" :disabled="notesLoading || notesBusy" @click="createQuickNote()">{{ notesBusy ? 'Creating…' : 'Create a note' }}</button>
      </div>
      <button v-if="noteFiles.length" class="text-button quick-note-new" type="button" :disabled="notesBusy" @click="createQuickNote()">+ New note</button>
    </template>

    <template v-else-if="item.ref === 'counter'">
      <div class="widget-heading">
        <div><span class="widget-eyebrow">PERSONAL</span><strong>{{ String(data.label || 'Counter') }}</strong></div>
        <button class="text-button" type="button" @click="patch({ count: 0 })">Reset</button>
      </div>
      <strong class="widget-number" aria-live="polite">{{ countValue.toLocaleString() }}</strong>
      <div class="widget-actions">
        <button type="button" :aria-label="`Decrease ${String(data.label || 'counter')}`" @click="patch({ count: countValue - stepValue })">−</button>
        <button type="button" :aria-label="`Increase ${String(data.label || 'counter')}`" @click="patch({ count: countValue + stepValue })">+</button>
      </div>
      <label class="widget-inline-label">Label<input :value="String(data.label || 'Counter')" maxlength="32" aria-label="Counter label" @change="patch({ label: ($event.target as HTMLInputElement).value.trim() || 'Counter' })" /></label>
    </template>

    <template v-else-if="item.ref === 'pixel-pet'">
      <div class="widget-heading">
        <div><span class="widget-eyebrow">SMALL, STEADY WINS</span><strong>Daily momentum</strong></div>
        <span class="streak-badge" aria-label="Current daily streak">{{ streak }} day{{ streak === 1 ? '' : 's' }}</span>
      </div>
      <div class="momentum-meter" role="img" :aria-label="`${streak} day streak`"><span :style="{ '--meter-progress': `${Math.min(100, streak / 30 * 100)}%` }" /></div>
      <p class="widget-caption">{{ checkedInToday ? 'Nice work. Come back tomorrow to keep it going.' : 'Build a streak with one small win today.' }}</p>
      <button type="button" :disabled="checkedInToday" @click="checkIn">{{ checkedInToday ? 'Today complete' : 'Mark today complete' }}</button>
    </template>

    <template v-else-if="item.ref === 'focus'">
      <div class="widget-heading">
        <div><span class="widget-eyebrow">FOCUS SESSION</span><strong>Stay with one thing</strong></div>
        <span class="focus-dot" :class="{ running: timerRunning }" aria-hidden="true" />
      </div>
      <strong class="widget-number focus-time" role="timer" aria-live="off">{{ remainingText }}</strong>
      <div class="duration-options" role="group" aria-label="Focus duration">
        <button v-for="minutes in focusOptions" :key="minutes" type="button" :aria-pressed="duration === minutes" :disabled="timerRunning" @click="setDuration(minutes)">{{ minutes }}m</button>
      </div>
      <div class="widget-actions focus-actions">
        <button type="button" @click="toggleTimer">{{ timerRunning ? 'Pause' : pausedSeconds ? 'Resume' : 'Start focus' }}</button>
        <button type="button" :disabled="!timerRunning && !pausedSeconds && !timerFinished" @click="resetTimer">Reset</button>
      </div>
      <p class="widget-caption">In-app timer; no background alarms or app blocking.</p>
    </template>

    <template v-else-if="item.ref === 'checklist'">
      <div class="widget-heading tasks-heading">
        <div><span class="widget-eyebrow">TASKS</span><strong>{{ remainingTasks }} left</strong></div>
        <button class="text-button" type="button" @click="$emit('open', 'archive')">Full list</button>
      </div>
      <div class="task-progress" role="progressbar" :aria-valuenow="taskProgress" aria-valuemin="0" aria-valuemax="100" :aria-label="`${taskProgress}% of tasks complete`"><span :style="{ width: `${taskProgress}%` }" /></div>
      <form class="task-capture" @submit.prevent="addWidgetTask">
        <label class="sr-only" :for="`widget-task-${item.id}`">Add a task</label>
        <input :id="`widget-task-${item.id}`" v-model="taskDraft" maxlength="160" placeholder="Add a task…" autocomplete="off" />
        <button type="submit" :disabled="!taskDraft.trim()" aria-label="Add task">+</button>
      </form>
      <div class="task-list" aria-label="Tasks">
        <label v-for="task in visibleTasks" :key="task.id" class="task-row" :class="{ done: task.done }">
          <input type="checkbox" :checked="task.done" :aria-label="`${task.done ? 'Reopen' : 'Complete'}: ${task.title}`" @change="toggleWidgetTask(task, ($event.target as HTMLInputElement).checked)" />
          <span>{{ task.title }}<small v-if="task.source === 'server'" class="task-source">SERVER</small></span>
          <button type="button" class="task-remove" :aria-label="`Remove ${task.title}`" @click.prevent="removeWidgetTask(task)">×</button>
        </label>
        <p v-if="!visibleTasks.length" class="widget-empty-line">{{ taskFilter === 'done' ? 'No completed tasks yet.' : 'Nothing on the list. Add a small win.' }}</p>
      </div>
      <div class="task-footer">
        <div class="task-filter" role="group" aria-label="Filter tasks">
          <button v-for="filter in taskFilters" :key="filter.id" type="button" :aria-pressed="taskFilter === filter.id" @click="taskFilter = filter.id">{{ filter.label }}</button>
        </div>
        <button v-if="completedTasks" class="text-button" type="button" @click="clearWidgetTasks">Clear done</button>
      </div>
      <p v-if="taskSourceLabel" class="widget-caption">{{ taskSourceLabel }}</p>
    </template>

    <template v-else>
      <div class="widget-heading app-link-heading">
        <AppIcon :name="linkedIcon" :size="20" />
        <div><span class="widget-eyebrow">CYBERMANJU APP</span><strong>{{ linkedTitle }}</strong></div>
      </div>
      <p class="widget-caption">{{ linkedDescription || 'Open the linked app. This shortcut does not claim to display live service data.' }}</p>
      <button v-if="appId" type="button" @click="$emit('open', appId)">Open {{ linkedTitle }} <span aria-hidden="true">↗</span></button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAppStore } from '@/stores/app'
import { useTodos } from '@/composables/useTodos'
import { invoke } from '@/composables/useTauri'
import type { FileNode } from '@/types'
import type { HomeItem } from '@/utils/homeWorkspaces'
import { isNoteFile } from '@/utils/notes'
import { homeWidgetCatalog } from '@/data/homeWidgetCatalog'

const props = defineProps<{ item: HomeItem; appId?: string }>()
const emit = defineEmits<{ update: [data: Record<string, string | number | boolean>]; open: [id: string] }>()
const store = useAppStore()
const localTodos = useTodos()
const data = computed(() => props.item.data || {})
const linkedWidget = computed(() => homeWidgetCatalog.find(widget => widget.id === props.item.ref))
const linkedTitle = computed(() => linkedWidget.value?.title || props.appId || 'App')
const linkedDescription = computed(() => linkedWidget.value?.description || '')
const linkedIcon = computed(() => linkedWidget.value?.icon || 'solar:widget-bold')
const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | undefined
let noteSaveTimer: ReturnType<typeof setTimeout> | undefined
let noteReadToken = 0
const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
const date = computed(() => new Date(now.value).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))
const nowIso = computed(() => new Date(now.value).toISOString())

function patch(value: Record<string, string | number | boolean>) {
  emit('update', { ...data.value, ...value })
}

const countValue = computed(() => Number.isFinite(Number(data.value.count)) ? Number(data.value.count) : 0)
const stepValue = computed(() => Math.max(1, Math.min(100, Math.trunc(Number(data.value.step) || 1))))

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function priorLocalDay(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() - 1)
  return localDay(date)
}
const checkedInToday = computed(() => data.value.lastCheckin === localDay())
const streak = computed(() => Math.max(0, Math.trunc(Number(data.value.streak) || 0)))
function checkIn() {
  if (checkedInToday.value) return
  const today = localDay()
  const prior = priorLocalDay(today)
  const previous = String(data.value.lastCheckin || '')
  const next = previous === prior ? streak.value + 1 : 1
  patch({ lastCheckin: today, streak: next })
}

const focusOptions = [15, 25, 50]
const duration = computed(() => [15, 25, 50].includes(Number(data.value.durationMinutes)) ? Number(data.value.durationMinutes) : 25)
const timerRunning = computed(() => Number(data.value.endsAt || 0) > now.value)
const timerFinished = computed(() => Number(data.value.endsAt || 0) > 0 && !timerRunning.value && !Number(data.value.pausedSeconds || 0))
const pausedSeconds = computed(() => Math.max(0, Math.trunc(Number(data.value.pausedSeconds || 0))))
const remainingSeconds = computed(() => timerRunning.value
  ? Math.max(0, Math.ceil((Number(data.value.endsAt) - now.value) / 1000))
  : pausedSeconds.value || (timerFinished.value ? 0 : duration.value * 60))
const remainingText = computed(() => `${String(Math.floor(remainingSeconds.value / 60)).padStart(2, '0')}:${String(remainingSeconds.value % 60).padStart(2, '0')}`)
function setDuration(minutes: number) {
  if (timerRunning.value) return
  patch({ durationMinutes: minutes, endsAt: 0, pausedSeconds: 0 })
}
function toggleTimer() {
  if (timerRunning.value) {
    const left = Math.max(0, Math.ceil((Number(data.value.endsAt) - Date.now()) / 1000))
    patch({ endsAt: 0, pausedSeconds: left })
  } else {
    const seconds = pausedSeconds.value || duration.value * 60
    patch({ durationMinutes: duration.value, pausedSeconds: 0, endsAt: Date.now() + seconds * 1000 })
  }
}
function resetTimer() {
  patch({ endsAt: 0, pausedSeconds: 0 })
}

/* Notes widgets edit the same managed Markdown files shown by the Notes app. */
const noteFiles = computed(() => store.files
  .filter(file => file.fileType !== 'folder' && isNoteFile(file.name, file.fileType) && !file.id.startsWith('providers/') && !file.id.startsWith('host:'))
  .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt)))
const selectedNoteId = ref(String(data.value.noteId || ''))
const selectedNote = computed(() => noteFiles.value.find(note => note.id === selectedNoteId.value) ?? null)
const noteDraft = ref('')
const savedNoteText = ref('')
const notesLoading = ref(false)
const notesBusy = ref(false)
const noteStatus = ref('Saved in vault')
watch(noteFiles, notes => {
  if (!notes.length) {
    selectedNoteId.value = ''
    patch({ noteId: '' })
  } else if (!notes.some(note => note.id === selectedNoteId.value)) {
    selectedNoteId.value = notes[0]!.id
    patch({ noteId: notes[0]!.id })
  }
}, { immediate: true })
watch(selectedNoteId, id => {
  if (id) void loadQuickNote(id)
  else { noteDraft.value = ''; savedNoteText.value = '' }
})
watch(() => data.value.noteId, id => {
  if (typeof id === 'string' && id && id !== selectedNoteId.value && noteFiles.value.some(note => note.id === id)) selectedNoteId.value = id
})
async function loadQuickNote(id: string) {
  const token = ++noteReadToken
  notesLoading.value = true
  noteStatus.value = 'Loading…'
  try {
    const result = await invoke<string | { content?: string }>('read_file_content', { fileId: id })
    const content = typeof result === 'string' ? result : String(result?.content ?? '')
    if (token !== noteReadToken) return
    noteDraft.value = content
    savedNoteText.value = content
    noteStatus.value = 'Saved in vault'
  } catch {
    if (token === noteReadToken) noteStatus.value = 'Could not load — open Notes'
  } finally {
    if (token === noteReadToken) notesLoading.value = false
  }
}
async function selectQuickNote(nextId: string) {
  const previousId = selectedNoteId.value
  if (noteDraft.value !== savedNoteText.value && !(await saveQuickNote())) {
    const select = document.getElementById(`quick-note-select-${props.item.id}`) as HTMLSelectElement | null
    if (select) select.value = previousId
    return
  }
  selectedNoteId.value = nextId
  patch({ noteId: nextId })
}
function editQuickNote(text: string) {
  noteDraft.value = text
  noteStatus.value = 'Unsaved changes'
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  noteSaveTimer = setTimeout(() => { void saveQuickNote() }, 900)
}
async function saveQuickNote(): Promise<boolean> {
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  noteSaveTimer = undefined
  const id = selectedNoteId.value
  const content = noteDraft.value
  if (!id || content === savedNoteText.value || notesLoading.value) return true
  const baseline = savedNoteText.value
  noteStatus.value = 'Saving…'
  try {
    const latest = await invoke<string | { content?: string }>('read_file_content', { fileId: id })
    const current = typeof latest === 'string' ? latest : String(latest?.content ?? '')
    if (current !== baseline) {
      noteStatus.value = 'Changed elsewhere — open Notes to review'
      return false
    }
    await invoke('write_file_content', { fileId: id, content })
    if (selectedNoteId.value !== id) return false
    savedNoteText.value = content
    noteStatus.value = 'Saved in vault'
    void store.fetchFiles('/')
    return true
  } catch {
    noteStatus.value = 'Save failed — open Notes to retry'
    return false
  }
}
async function createQuickNote(legacyText?: string, titlePrefix = 'Quick note') {
  if (selectedNoteId.value && noteDraft.value !== savedNoteText.value && !(await saveQuickNote())) return
  notesBusy.value = true
  try {
    const title = `${titlePrefix} ${new Date().toISOString().slice(0, 10)}.md`
    const body = legacyText ?? '# Quick note\n\n'
    const created = await invoke<FileNode>('upload_file', {
      fileName: title,
      fileData: Array.from(new TextEncoder().encode(body)),
      parentPath: '/',
    })
    if (!created?.id) throw new Error('The vault did not return a note id')
    await store.fetchFiles('/')
    selectedNoteId.value = created.id
    patch({ noteId: created.id, ...(legacyText !== undefined ? { legacyNoteMigrated: true, text: '' } : {}) })
    noteDraft.value = body
    savedNoteText.value = body
    noteStatus.value = 'Saved in vault'
  } catch {
    noteStatus.value = 'Could not create note — check the vault'
  } finally {
    notesBusy.value = false
  }
}
async function openNotes() {
  await saveQuickNote()
  emit('open', 'notes')
}

/* Full-list tasks use the same rows and actions as Archive's TASKS tab. */
type TaskRow = { id: string; title: string; done: boolean; createdAt?: string; source: 'local' | 'server' }
const taskDraft = ref('')
const taskFilter = ref<'all' | 'open' | 'done'>('open')
const taskFilters = [
  { id: 'open', label: 'Open' },
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Done' },
] as const
const taskRows = computed<TaskRow[]>(() => [
  ...(store.serverTodos ?? []).map(todo => ({ id: todo.id, title: todo.title, done: todo.done, createdAt: todo.createdAt, source: 'server' as const })),
  ...localTodos.todos.value.map(todo => ({ id: todo.id, title: todo.title, done: todo.done, createdAt: todo.createdAt, source: 'local' as const })),
])
const visibleTasks = computed(() => taskRows.value.filter(task => {
  if (taskFilter.value === 'done') return task.done
  if (taskFilter.value === 'open') return !task.done
  return true
}).slice(0, 4))
const completedTasks = computed(() => taskRows.value.filter(task => task.done).length)
const remainingTasks = computed(() => taskRows.value.filter(task => !task.done).length)
const taskProgress = computed(() => taskRows.value.length ? Math.round(completedTasks.value / taskRows.value.length * 100) : 0)
const taskSourceLabel = computed(() => store.serverTodos === null ? 'Saved on this device' : 'Includes local and connected-server tasks')
async function addWidgetTask() {
  const title = taskDraft.value.trim()
  if (!title) return
  if (store.serverTodos !== null) await store.createServerTodo(title)
  else localTodos.add(title)
  taskDraft.value = ''
}
async function toggleWidgetTask(task: TaskRow, done: boolean) {
  if (task.source === 'server') await store.toggleServerTodo(task.id, done)
  else localTodos.toggle(task.id)
}
async function removeWidgetTask(task: TaskRow) {
  if (task.source === 'server') await store.deleteServerTodo(task.id)
  else localTodos.remove(task.id)
}
async function clearWidgetTasks() {
  const serverDone = taskRows.value.filter(task => task.done && task.source === 'server')
  for (const task of serverDone) await store.deleteServerTodo(task.id)
  localTodos.clearDone()
}

onMounted(async () => {
  if (['clock', 'focus'].includes(props.item.ref)) interval = setInterval(() => { now.value = Date.now() }, 1000)
  if (props.item.ref === 'notes' || props.item.ref === 'checklist') {
    await store.fetchFiles()
    if (props.item.ref === 'notes' && String(data.value.text || '').trim() && !data.value.legacyNoteMigrated) {
      // Preserve old Home scratchpad text as a normal vault note before clearing its duplicate.
      await createQuickNote(String(data.value.text), 'Imported note')
    }
  }
  if (props.item.ref === 'checklist') {
    await store.fetchServerTodos()
    if (props.item.data?.text && !props.item.data?.legacyTaskMigrated) {
      const title = String(props.item.data.text)
      const moved = store.serverTodos !== null ? await store.createServerTodo(title) : null
      if (!moved) localTodos.add(title)
      patch({ legacyTaskMigrated: true, text: '', done: false })
    }
  }
})
onBeforeUnmount(() => {
  if (interval) clearInterval(interval)
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  if (noteDraft.value !== savedNoteText.value) void saveQuickNote()
})
</script>

<style scoped>
.local-widget { display:flex; flex-direction:column; gap:10px; min-width:0; color:var(--ui-text, inherit); font-size:12px; }
.local-widget button,.local-widget input,.local-widget select,.local-widget textarea { font:inherit; }
.local-widget button { min-height:38px; border:1px solid var(--hw-line, var(--ui-border)); border-radius:11px; color:inherit; background:color-mix(in srgb, var(--hw-bg, var(--ui-surface)) 88%, transparent); padding:8px 12px; cursor:pointer; transition:background .16s ease,border-color .16s ease,transform .16s ease; }
.local-widget button:hover:not(:disabled) { border-color:var(--hw-accent, var(--ui-accent)); background:color-mix(in srgb, var(--hw-accent, var(--ui-accent)) 10%, var(--hw-bg, var(--ui-surface))); }
.local-widget button:active:not(:disabled) { transform:scale(.98); }
.local-widget button:disabled { opacity:.52; cursor:not-allowed; }
.local-widget :focus-visible { outline:2px solid var(--hw-accent, var(--ui-accent)); outline-offset:2px; }
.widget-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
.widget-heading > div { display:flex; flex-direction:column; gap:2px; min-width:0; }
.widget-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.app-link-heading { justify-content:flex-start; color:var(--hw-accent, var(--ui-accent)); }
.app-link-heading > div { color:var(--ui-text); }
.widget-eyebrow { color:var(--ui-text-3, #92a0b0); font-size:9px; font-weight:800; letter-spacing:.12em; }
.widget-caption { margin:0; color:var(--ui-text-3, #92a0b0); font-size:10px; line-height:1.45; }
.widget-clock,.widget-number { display:block; font-size:clamp(26px, 8vw, 42px); font-variant-numeric:tabular-nums; font-weight:750; letter-spacing:-.055em; line-height:1; }
.clock-readout { display:flex; flex-direction:column; gap:7px; }
.clock-date { color:var(--ui-text-2, #c7d0db); font-size:13px; font-weight:600; }
.widget-actions { display:flex; gap:8px; }
.widget-actions button { flex:1; min-height:44px; font-size:20px; }
.widget-actions.focus-actions button { font-size:12px; }
.widget-icon-button { width:38px; min-width:38px; padding:6px!important; font-size:17px!important; }
.text-button { min-height:32px!important; border-color:transparent!important; background:transparent!important; padding:4px 6px!important; color:var(--ui-text-2, #d5deea)!important; font-size:10px!important; }
.text-button:hover:not(:disabled) { color:var(--hw-accent, var(--ui-accent))!important; }
.local-widget textarea,.local-widget input:not([type=checkbox]),.widget-select { box-sizing:border-box; width:100%; min-width:0; border:1px solid var(--hw-line, var(--ui-border)); border-radius:10px; background:color-mix(in srgb, var(--hw-bg, var(--ui-surface)) 86%, transparent); color:inherit; padding:9px 10px; }
.local-widget textarea { min-height:72px; flex:1; resize:vertical; line-height:1.45; }
.local-widget textarea::placeholder,.local-widget input::placeholder { color:var(--ui-text-3, #92a0b0); }
.widget-select { font-size:11px!important; }
.widget-note-footer,.task-footer { display:flex; align-items:center; justify-content:space-between; gap:6px; min-width:0; }
.quick-note-body { display:flex; flex-direction:column; gap:7px; min-height:0; flex:1; }
.quick-note-new { align-self:flex-start; }
.widget-empty { display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
.widget-empty p,.widget-empty-line { margin:0; color:var(--ui-text-3, #92a0b0); font-size:11px; line-height:1.45; }
.widget-inline-label { display:flex; align-items:center; gap:8px; color:var(--ui-text-3, #92a0b0); font-size:10px; }
.widget-inline-label input { flex:1; padding:6px 8px!important; }
.streak-badge { border:1px solid color-mix(in srgb, var(--hw-accent, var(--ui-accent)) 28%, transparent); border-radius:999px; padding:5px 8px; color:var(--hw-accent, var(--ui-accent)); font-size:10px; font-weight:700; white-space:nowrap; }
.momentum-meter,.task-progress { width:100%; height:8px; overflow:hidden; border-radius:999px; background:color-mix(in srgb, var(--hw-accent, var(--ui-accent)) 12%, var(--hw-bg, var(--ui-surface))); }
.momentum-meter span { display:block; width:var(--meter-progress); height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--hw-accent, var(--ui-accent)),color-mix(in srgb,var(--hw-accent, var(--ui-accent)) 50%,#fff)); transition:width .2s ease; }
.focus-time { font-size:clamp(30px, 10vw, 48px); }
.focus-dot { width:9px; height:9px; border-radius:50%; background:var(--ui-text-3, #92a0b0); }
.focus-dot.running { background:#4ad9a3; box-shadow:0 0 12px #4ad9a377; }
.duration-options { display:flex; gap:6px; }
.duration-options button { flex:1; min-height:32px; padding:5px 6px; font-size:10px; }
.tasks-heading strong { font-size:14px; }
.task-progress { height:5px; }
.task-progress span { display:block; height:100%; border-radius:inherit; background:var(--hw-accent, var(--ui-accent)); transition:width .2s ease; }
.task-capture { display:flex; gap:6px; }
.task-capture input { flex:1; min-width:0; min-height:36px; padding:6px 9px!important; }
.task-capture button { width:38px; min-width:38px; min-height:36px; padding:0; font-size:20px; }
.task-list { display:flex; flex-direction:column; gap:3px; min-height:0; }
.task-row { display:flex; align-items:center; gap:8px; min-width:0; min-height:34px; border-bottom:1px solid color-mix(in srgb,var(--hw-line, var(--ui-border)) 56%,transparent); }
.task-row > input { width:17px; height:17px; flex:0 0 auto; accent-color:var(--hw-accent, var(--ui-accent)); }
.task-row > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.task-source { margin-left:5px; color:var(--ui-text-3, #92a0b0); font-size:7px; font-weight:800; letter-spacing:.08em; }
.task-row.done > span { color:var(--ui-text-3, #92a0b0); text-decoration:line-through; }
.task-remove { width:32px; min-width:32px; min-height:32px!important; padding:0!important; border-color:transparent!important; background:transparent!important; font-size:18px!important; }
.task-filter { display:flex; gap:2px; }
.task-filter button { min-height:29px; padding:4px 7px; border-color:transparent; background:transparent; color:var(--ui-text-3, #92a0b0); font-size:9px; }
.task-filter button[aria-pressed="true"] { border-color:var(--hw-line, var(--ui-border)); background:color-mix(in srgb,var(--hw-accent, var(--ui-accent)) 12%,transparent); color:inherit; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (prefers-reduced-motion:reduce) { .local-widget *, .local-widget *::before, .local-widget *::after { transition:none!important; animation:none!important; } }
</style>
