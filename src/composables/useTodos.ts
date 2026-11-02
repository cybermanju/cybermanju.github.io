// CyberManju OS — Shared todo state (src/composables/useTodos.ts).
// Role: keep the Home tasks widget and Archive on one persisted local list.
// Exports: useTodos, todos storage key and event name.
// Integrates: Vue refs, localStorage, pure task operations.
// Contracts: legacy key remains canonical; cross-tab updates are observed; failures stay local and non-fatal.
import { readonly, ref } from 'vue'
import {
  addTodo as addTodoRow,
  clearDone as clearDoneRows,
  parseTodosStore,
  removeTodo as removeTodoRow,
  serializeTodosStore,
  toggleTodo as toggleTodoRow,
  type TodoItem,
} from '@/utils/tasks'

export const TODOS_STORAGE_KEY = 'cybermanju.todos.v1'
export const TODOS_UPDATED_EVENT = 'cybermanju:todos-updated'

const rows = ref<TodoItem[]>([])
let loaded = false
let listenersAttached = false

function readStored(): TodoItem[] {
  try {
    return parseTodosStore(globalThis.localStorage?.getItem(TODOS_STORAGE_KEY) ?? null)
  } catch {
    return []
  }
}

function syncFromStorage(event?: StorageEvent): void {
  if (event && event.key !== null && event.key !== TODOS_STORAGE_KEY) return
  rows.value = event ? parseTodosStore(event.newValue) : readStored()
}

function ensureLoaded(): void {
  if (!loaded) {
    rows.value = readStored()
    loaded = true
  }
  if (listenersAttached || typeof window === 'undefined') return
  window.addEventListener('storage', syncFromStorage)
  window.addEventListener(TODOS_UPDATED_EVENT, () => syncFromStorage())
  listenersAttached = true
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(TODOS_STORAGE_KEY, serializeTodosStore(rows.value))
  } catch {
    // Keep the in-memory list usable when storage is full or unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TODOS_UPDATED_EVENT))
  }
}

/** One shared, reactive task list for every local consumer in this tab. */
export function useTodos() {
  ensureLoaded()

  function add(title: string): TodoItem | null {
    const result = addTodoRow(rows.value, title)
    if (!result) return null
    rows.value = result.list
    persist()
    return result.item
  }

  function toggle(id: string): void {
    rows.value = toggleTodoRow(rows.value, id)
    persist()
  }

  function remove(id: string): void {
    rows.value = removeTodoRow(rows.value, id)
    persist()
  }

  function clearDone(): number {
    const result = clearDoneRows(rows.value)
    rows.value = result.list
    persist()
    return result.cleared
  }

  return {
    todos: readonly(rows),
    add,
    toggle,
    remove,
    clearDone,
    refresh: () => syncFromStorage(),
  }
}
