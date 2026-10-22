// CyberManju OS — Automation storage tests (tests/frontend/automation-storage.test.ts).
// Role: Verify storage linearization, isolation and fail-closed behavior.
// Exports: Vitest suites.
// Integrates: Memory and IndexedDB automation storage implementations.
// Contracts: No silent memory fallback, callback rollback and detached snapshots.
import { describe, expect, it, vi } from 'vitest'
import { IndexedDBAutomationStorage, MemoryAutomationStorage } from '../../src/automation/storage'

function readableDatabase(value: unknown) {
  let closed = false
  const db = {
    close: vi.fn(() => { closed = true }),
    onversionchange: null,
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => {
      if (closed) throw new Error('InvalidStateError')
      const request = { result: value } as IDBRequest
      const tx = {
        objectStore: () => ({ get: () => request }),
      } as unknown as IDBTransaction
      queueMicrotask(() => {
        request.onsuccess?.(new Event('success'))
        tx.oncomplete?.(new Event('complete'))
      })
      return tx
    }),
  }
  return db
}

describe('automation storage', () => {
  it('serializes concurrent updates and returns detached values', async () => {
    const storage = new MemoryAutomationStorage()
    const values = await Promise.all(Array.from({ length: 30 }, () => storage.update('n', current => {
      const n = typeof current === 'number' ? current + 1 : 1
      return { value: n, result: n }
    })))
    expect(values).toEqual(Array.from({ length: 30 }, (_, n) => n + 1))
    expect(await storage.get('n')).toBe(30)
    const value = { nested: { n: 1 } }
    await storage.update('record', () => ({ value, result: undefined }))
    value.nested.n = 99
    const result = await storage.get('record') as typeof value
    result.nested.n = 200
    expect(await storage.get('record')).toEqual({ nested: { n: 1 } })
    const entries = await storage.list('rec')
    ;(entries[0].value as typeof value).nested.n = 300
    expect(await storage.get('record')).toEqual({ nested: { n: 1 } })
  })
  it('rolls back throwing callbacks, preserves their identity and recovers its queue', async () => {
    const storage = new MemoryAutomationStorage(), error = new Error('typed error')
    await storage.update('n', () => ({ value: { n: 1 }, result: undefined }))
    await expect(storage.update('n', current => {
      ;(current as { n: number }).n = 99
      throw error
    })).rejects.toBe(error)
    expect(await storage.get('n')).toEqual({ n: 1 })
    expect(await storage.update('n', () => ({ value: 2, result: true }))).toBe(true)
    expect(await storage.get('n')).toBe(2)
  })
  it('does not commit uncloneable values or silently fall back from unavailable IndexedDB', async () => {
    const storage = new MemoryAutomationStorage()
    await expect(storage.update('n', () => ({ value: () => undefined, result: true }))).rejects.toThrow('storage_failure')
    expect(await storage.get('n')).toBeUndefined()
    expect(() => new IndexedDBAutomationStorage({ databaseName: '' })).toThrow('storage_unavailable')
    expect(() => new IndexedDBAutomationStorage({ databaseName: 'node-test' })).toThrow('storage_unavailable')
  })

  it.each(['throw', 'error', 'blocked'] as const)('retries opening after %s without a memory fallback', async failure => {
    const db = readableDatabase({ persisted: true })
    const open = vi.fn()
      .mockImplementationOnce(() => {
        if (failure === 'throw') throw new Error('SecurityError')
        const request = {} as IDBOpenDBRequest
        queueMicrotask(() => {
          if (failure === 'blocked') request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
          else request.onerror?.(new Event('error'))
        })
        return request
      })
      .mockImplementationOnce(() => {
        const request = { result: db } as unknown as IDBOpenDBRequest
        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request
      })
    const storage = new IndexedDBAutomationStorage({ databaseName: 'retry-test', indexedDB: { open } as unknown as IDBFactory })

    await expect(storage.get('record')).rejects.toThrow('storage_unavailable')
    expect(db.transaction).not.toHaveBeenCalled()
    await expect(storage.get('record')).resolves.toEqual({ persisted: true })
    await expect(storage.get('record')).resolves.toEqual({ persisted: true })
    expect(open.mock.calls).toEqual([['retry-test', 1], ['retry-test', 1]])
  })

  it('closes on versionchange and reopens the next operation at the supported version', async () => {
    const first = readableDatabase('before'), second = readableDatabase('after')
    const databases = [first, second]
    const open = vi.fn(() => {
      const request = { result: databases.shift() } as unknown as IDBOpenDBRequest
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
      return request
    })
    const storage = new IndexedDBAutomationStorage({ databaseName: 'version-test', indexedDB: { open } as unknown as IDBFactory })

    await expect(storage.get('record')).resolves.toBe('before')
    const versionchange = (first as unknown as IDBDatabase).onversionchange!
    versionchange.call(first as unknown as IDBDatabase, new Event('versionchange') as IDBVersionChangeEvent)
    expect(first.close).toHaveBeenCalledTimes(1)
    await expect(storage.get('record')).resolves.toBe('after')
    // A stale event from the old handle must not evict the replacement connection.
    versionchange.call(first as unknown as IDBDatabase, new Event('versionchange') as IDBVersionChangeEvent)
    await expect(storage.get('record')).resolves.toBe('after')
    expect(first.transaction).toHaveBeenCalledTimes(1)
    expect(second.transaction).toHaveBeenCalledTimes(2)
    expect(open.mock.calls).toEqual([['version-test', 1], ['version-test', 1]])
  })

  it.each([false, true])('preserves the automation schema upgrade when the store exists: %s', async exists => {
    const db = readableDatabase('persisted')
    db.objectStoreNames.contains.mockReturnValue(exists)
    const open = vi.fn(() => {
      const request = { result: db } as unknown as IDBOpenDBRequest
      queueMicrotask(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        request.onsuccess?.(new Event('success'))
      })
      return request
    })
    const storage = new IndexedDBAutomationStorage({ databaseName: 'schema-test', indexedDB: { open } as unknown as IDBFactory })

    await expect(storage.get('record')).resolves.toBe('persisted')
    expect(open).toHaveBeenCalledWith('schema-test', 1)
    expect(db.objectStoreNames.contains).toHaveBeenCalledWith('automation')
    if (exists) expect(db.createObjectStore).not.toHaveBeenCalled()
    else expect(db.createObjectStore).toHaveBeenCalledWith('automation')
  })
})
