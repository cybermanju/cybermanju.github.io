// CyberManju OS — Automation storage (src/automation/storage.ts).
// Role: Provide atomic key/value storage for automation repositories and journals.
// Exports: AutomationStorage, MemoryAutomationStorage, IndexedDBAutomationStorage.
// Integrates: Repository CAS, run bindings and execution journals through explicit keys.
// Namespace: The owner/developer chooses and documents databaseName and key prefixes; this module creates a dedicated database and never shares handles.
// Durability: IndexedDB requests strict transaction durability when supported; this is not a claim of native crash-proof persistence.

export interface AutomationStorage {
  readonly durability: 'persistent' | 'session'
  get(key: string): Promise<unknown | undefined>
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>
  update<T>(key: string, change: (current: unknown | undefined) => { value: unknown; result: T }): Promise<T>
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  // Values in this API are bounded JSON-compatible records.
  return JSON.parse(JSON.stringify(value)) as T
}

function storageError(kind: 'storage_unavailable' | 'storage_failure'): Error {
  return new Error(kind)
}

/** In-memory, session-only storage. Updates are linearized per instance. */
export class MemoryAutomationStorage implements AutomationStorage {
  readonly durability = 'session' as const
  private readonly values = new Map<string, unknown>()
  private tail: Promise<void> = Promise.resolve()

  async get(key: string): Promise<unknown | undefined> {
    await this.tail
    const value = this.values.get(key)
    return value === undefined ? undefined : clone(value)
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    await this.tail
    return [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value: clone(value) }))
  }

  update<T>(key: string, change: (current: unknown | undefined) => { value: unknown; result: T }): Promise<T> {
    const operation = this.tail.then(() => {
      const stored = this.values.get(key)
      let current: unknown | undefined
      let nextValue: unknown
      try {
        current = stored === undefined ? undefined : clone(stored)
      } catch { throw storageError('storage_failure') }
      const outcome = change(current)
      try { nextValue = clone(outcome.value) }
      catch { throw storageError('storage_failure') }
      this.values.set(key, nextValue)
      return outcome.result
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }
}

export interface IndexedDBAutomationStorageOptions {
  databaseName: string
  indexedDB?: IDBFactory
}

/** Dedicated IndexedDB database, version 1, with one `automation` object store. */
export class IndexedDBAutomationStorage implements AutomationStorage {
  readonly durability = 'persistent' as const
  private database?: Promise<IDBDatabase>
  private readonly factory: IDBFactory
  private readonly databaseName: string

  constructor(options: IndexedDBAutomationStorageOptions) {
    if (!options || typeof options.databaseName !== 'string' || options.databaseName.length === 0) {
      throw storageError('storage_unavailable')
    }
    const factory = options.indexedDB ?? globalThis.indexedDB
    if (!factory) throw storageError('storage_unavailable')
    this.factory = factory
    this.databaseName = options.databaseName
  }

  private connection(): Promise<IDBDatabase> {
    if (!this.database) {
      const database = this.open(this.factory, this.databaseName).then(db => {
        db.onversionchange = () => {
          if (this.database === database) this.database = undefined
          db.close()
        }
        return db
      }, error => {
        if (this.database === database) this.database = undefined
        throw error
      })
      this.database = database
    }
    return this.database
  }

  private open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try { request = factory.open(name, 1) } catch { reject(storageError('storage_unavailable')); return }
      let settled = false
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains('automation')) request.result.createObjectStore('automation')
        } catch {
          try { request.transaction?.abort() } catch { /* already inactive */ }
        }
      }
      request.onblocked = () => {
        if (!settled) { settled = true; reject(storageError('storage_unavailable')) }
      }
      request.onerror = () => {
        if (!settled) { settled = true; reject(storageError('storage_unavailable')) }
      }
      request.onsuccess = () => {
        const db = request.result
        if (settled) { db.close(); return }
        settled = true
        resolve(db)
      }
    })
  }

  async get(key: string): Promise<unknown | undefined> {
    const db = await this.connection()
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction
      try { tx = db.transaction('automation', 'readonly') } catch { reject(storageError('storage_failure')); return }
      const request = tx.objectStore('automation').get(key)
      let result: unknown | undefined
      request.onsuccess = () => {
        try { result = request.result === undefined ? undefined : clone(request.result) }
        catch { try { tx.abort() } catch { /* inactive */ } }
      }
      request.onerror = () => { /* transaction completion reports failure */ }
      tx.oncomplete = () => resolve(result)
      tx.onabort = tx.onerror = () => reject(storageError('storage_failure'))
    })
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    const db = await this.connection()
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction
      try { tx = db.transaction('automation', 'readonly') } catch { reject(storageError('storage_failure')); return }
      const rows: Array<{ key: string; value: unknown }> = []
      const request = tx.objectStore('automation').openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        try {
          const key = cursor.key
          if (typeof key === 'string' && key.startsWith(prefix)) rows.push({ key, value: clone(cursor.value) })
          cursor.continue()
        } catch { try { tx.abort() } catch { /* inactive */ } }
      }
      tx.oncomplete = () => {
        rows.sort((a, b) => a.key.localeCompare(b.key))
        resolve(rows)
      }
      tx.onabort = tx.onerror = () => reject(storageError('storage_failure'))
    })
  }

  async update<T>(key: string, change: (current: unknown | undefined) => { value: unknown; result: T }): Promise<T> {
    const db = await this.connection()
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction
      try {
        // Strict durability is requested where supported. If the runtime cannot create it, fail closed.
        tx = db.transaction('automation', 'readwrite', { durability: 'strict' })
      } catch { reject(storageError('storage_failure')); return }
      const store = tx.objectStore('automation')
      let result!: T
      let callbackError: unknown
      const request = store.get(key)
      request.onsuccess = () => {
        let current: unknown | undefined
        try {
          current = request.result === undefined ? undefined : clone(request.result)
        } catch {
          callbackError = storageError('storage_failure')
          try { tx.abort() } catch { /* already inactive */ }
          return
        }
        let outcome: { value: unknown; result: T }
        try {
          outcome = change(current) // Must remain synchronous within this transaction callback.
        } catch (error) {
          callbackError = error
          try { tx.abort() } catch { /* already inactive */ }
          return
        }
        try {
          const nextValue = clone(outcome.value)
          result = outcome.result
          store.put(nextValue, key)
        } catch {
          callbackError = storageError('storage_failure')
          try { tx.abort() } catch { /* already inactive */ }
        }
      }
      tx.oncomplete = () => resolve(result)
      tx.onabort = tx.onerror = () => reject(callbackError ?? storageError('storage_failure'))
    })
  }
}
