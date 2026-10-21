// CyberManju OS — native oplog IPC regression tests (tests/frontend/file-manager-oplog.test.ts).
// Role: Pin native handler availability and shared local-owner security contracts without Rust tooling.
// Exports: none (Vitest suite).
// Integrates: Tauri commands, shared web oplog logic, useTauri REST mappings.
// Contracts: static parity assertions complement the Rust owner-filtering and signature tests.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('native file-manager oplog IPC', () => {
  it('declares the four mapped command entry points with local owner context', () => {
    const native = fs.readFileSync('src-tauri/src/commands/oplog.rs', 'utf8')
    const modules = fs.readFileSync('src-tauri/src/commands/mod.rs', 'utf8')
    const routes = fs.readFileSync('src/composables/useTauri.ts', 'utf8')
    const registry = fs.readFileSync('src-tauri/src/lib.rs', 'utf8')
    for (const cmd of ['oplog_since', 'oplog_conflicts', 'oplog_push', 'oplog_resolve']) {
      expect(native).toContain(`fn ${cmd}`)
      expect(routes).toContain(`${cmd}: {`)
      expect(registry).toContain(`commands::oplog::${cmd},`)
    }
    expect(modules).toContain('pub mod oplog;')
    expect(native).toContain('"local"')
  })
  it('reuses REST validation and owner-filtered shared query functions', () => {
    const native = fs.readFileSync('src-tauri/src/commands/oplog.rs', 'utf8')
    const shared = fs.readFileSync('crates/web/src/api/oplog.rs', 'utf8')
    expect(native).toContain('since_for_owner')
    expect(native).toContain('conflicts_for_owner')
    expect(native).toContain('oplog::push')
    expect(native).toContain('oplog::resolve_op')
    expect(shared).toContain('filter(|d| !d.revoked && d.owner_id == owner_id)')
    expect(shared).toContain('verify_envelope')
  })
})
