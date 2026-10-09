// Transport parity — every invoke() command resolves on web/smoke paths.
//
// Guards the gaps where a Tauri command existed but web/static transports
// threw "not supported": each mapped command must build the server path the
// dashboard actually serves (see crates/web/src/lib.rs), and local-only
// commands must be listed in WRITE_ONLY_COMMANDS instead of 404ing.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOBILE_NATIVE_OS_COMMANDS, REST_FIRST, REST_ROUTES, WRITE_ONLY_COMMANDS } from '@/composables/useTauri'

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

  it('maps os_write to PUT /api/os/write (P1-6)', () => {
    const r = REST_ROUTES.os_write
    expect(r.method).toBe('PUT')
    expect(r.buildPath({})).toBe('/api/os/write')
    expect(r.transformRequest!({ path: '/note.txt', content: 'hi' })).toEqual({
      path: '/note.txt',
      content: 'hi',
    })
    expect(REST_FIRST.has('os_write')).toBe(true)
  })

  it('routes local mobile telemetry through native IPC while retaining REST mappings', () => {
    for (const cmd of ['os_ps', 'os_top', 'os_workers', 'os_jobs', 'os_df']) {
      expect(REST_ROUTES[cmd]).toBeTruthy()
      expect(REST_FIRST.has(cmd)).toBe(true)
      expect(MOBILE_NATIVE_OS_COMMANDS.has(cmd)).toBe(true)
    }
    expect(MOBILE_NATIVE_OS_COMMANDS.has('os_exec')).toBe(false)
    expect(MOBILE_NATIVE_OS_COMMANDS.has('os_write')).toBe(false)
  })

  it('registers every mobile telemetry IPC command in the Tauri backend', () => {
    const commands = fs.readFileSync('src-tauri/src/commands/os_metrics.rs', 'utf8')
    const runtime = fs.readFileSync('src-tauri/src/lib.rs', 'utf8')
    for (const cmd of ['os_ps', 'os_top', 'os_workers', 'os_jobs', 'os_df']) {
      expect(commands).toMatch(new RegExp(`pub fn ${cmd}\\b`))
      expect(runtime).toContain(`commands::os_metrics::${cmd}`)
    }
  })

  it('encodes OS volume paths as ?path= (P1-7)', () => {
    expect(REST_ROUTES.os_stat.buildPath({ path: '/foo bar' })).toBe(
      '/api/os/stat?path=%2Ffoo%20bar',
    )
    expect(REST_ROUTES.os_ls.buildPath({ path: '/a/b' })).toBe('/api/os/ls?path=%2Fa%2Fb')
    expect(REST_ROUTES.os_du.buildPath({})).toBe('/api/os/du?path=%2F')
    // Parent traversal survives as data, not as URL segments.
    expect(REST_ROUTES.os_stat.buildPath({ path: '/x/../y' })).toBe(
      '/api/os/stat?path=%2Fx%2F..%2Fy',
    )
  })

  it('keeps the whole sync domain REST_FIRST (P1-5)', () => {
    for (const cmd of [
      'list_sync_configs',
      'create_sync_config',
      'delete_sync_config',
      'start_sync',
      'cancel_sync',
      'get_sync_progress',
      'test_sync_connection',
      'list_remote_files',
      'get_sync_job',
      'list_sync_runs',
      'get_sync_status',
      'restore_sync_file',
      'delete_remote_file',
      'create_provider_repo',
      'seed_repo_files',
      'upload_remote_file',
      'get_sync_usage',
      'oauth_start',
    ]) {
      expect(REST_ROUTES[cmd]).toBeTruthy()
      expect(REST_FIRST.has(cmd)).toBe(true)
    }
  })

  it('keeps the paginated search REST route for the wasm unwrap (P1-8)', () => {
    const r = REST_ROUTES.search_files_paginated
    expect(r.method).toBe('GET')
    expect(r.buildPath({ query: 'vault', limit: 20, offset: 40 })).toContain('/api/search/paginated')
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

  it('routes face detection to the server faces endpoints (heuristic everywhere)', () => {
    const single = REST_ROUTES.detect_faces
    expect(single.method).toBe('POST')
    expect(single.buildPath({ fileId: 'f1' })).toBe('/api/faces/detect')
    expect(single.transformRequest!({ fileId: 'f1' })).toEqual({ fileId: 'f1' })
    const batch = REST_ROUTES.detect_faces_batch_cmd
    expect(batch.method).toBe('POST')
    expect(batch.buildPath({})).toBe('/api/faces/detect-batch')
    expect(WRITE_ONLY_COMMANDS.has('detect_faces')).toBe(false)
    expect(WRITE_ONLY_COMMANDS.has('detect_faces_batch_cmd')).toBe(false)
    // Grouping admin ops stay desktop-only.
    for (const cmd of ['recluster_faces', 'rename_face_group', 'merge_face_groups', 'delete_face_group', 'find_similar_faces']) {
      expect(WRITE_ONLY_COMMANDS.has(cmd)).toBe(true)
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
