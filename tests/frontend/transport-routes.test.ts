// Transport parity — every invoke() command resolves on web/smoke paths.
//
// Guards the gaps where a Tauri command existed but web/static transports
// threw "not supported": each mapped command must build the server path the
// dashboard actually serves (see crates/web/src/lib.rs), and local-only
// commands must be listed in WRITE_ONLY_COMMANDS instead of 404ing.
import { describe, expect, it } from 'vitest'
import { REST_ROUTES, WRITE_ONLY_COMMANDS } from '@/composables/useTauri'

describe('REST route coverage', () => {
  it('maps suggest to the server suggest endpoint', () => {
    const r = REST_ROUTES.suggest
    expect(r.method).toBe('GET')
    expect(r.buildPath({ prefix: 'va', limit: 5 })).toContain('/api/search/suggest')
    expect(r.buildPath({ prefix: 'va', limit: 5 })).toContain('q=va')
  })

  it('maps share + permission + preview commands to their server routes', () => {
    expect(REST_ROUTES.get_shared_file.buildPath({ token: 'abc' })).toBe('/api/shared/abc')
    expect(REST_ROUTES.set_file_permission.buildPath({})).toBe('/api/permissions')
    expect(REST_ROUTES.get_preview.buildPath({ fileId: 'f1' })).toBe('/api/files/f1/preview')
    expect(REST_ROUTES.upload_remote_file.buildPath({})).toBe('/api/sync/upload')
  })

  it('keeps local-only commands in WRITE_ONLY instead of 404ing', () => {
    for (const cmd of ['get_compression_stats', 'get_symbols', 'parse_file', 'upload_file']) {
      expect(WRITE_ONLY_COMMANDS.has(cmd)).toBe(true)
    }
    for (const cmd of ['suggest', 'get_shared_file', 'set_file_permission', 'get_preview']) {
      expect(WRITE_ONLY_COMMANDS.has(cmd)).toBe(false)
      expect(REST_ROUTES[cmd]).toBeTruthy()
    }
  })
})

describe('REST response transforms', () => {
  it('passes real BM25 scores and snippets through search_files', () => {
    const out = REST_ROUTES.search_files.transformResponse!(
      [{ fileId: 'a', fileName: 'a.txt', score: 2.5, snippet: 'hit' }],
      {},
    ) as Array<Record<string, unknown>>
    expect(out[0].score).toBe(2.5)
    expect(out[0].snippet).toBe('hit')
  })

  it('falls back cleanly when the server sends file-shaped rows', () => {
    const out = REST_ROUTES.search_files.transformResponse!(
      [{ id: 'a', name: 'a.txt' }],
      {},
    ) as Array<Record<string, unknown>>
    expect(out[0]).toMatchObject({ fileId: 'a', fileName: 'a.txt', score: 1.0, snippet: '' })
  })

  it('passes real encryption status through instead of hardcoding false', () => {
    const out = REST_ROUTES.get_encryption_status.transformResponse!(
      { isEncrypted: true, algorithm: 'hybrid', available: true },
      {},
    ) as Record<string, unknown>
    expect(out.isEncrypted).toBe(true)
    expect(out.algorithm).toBe('hybrid')
  })
})
