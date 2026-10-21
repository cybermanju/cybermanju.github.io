// CyberManju OS — Android process death contracts (tests/frontend/android-process-death.test.ts).
// Role: Catch Android target omissions in native crash-lock recovery without local Cargo.
// Exports: Vitest source contracts; real subprocess/database regressions run in Rust CI.
// Integrates: database.rs, startup_storage.rs, Android smoke.
// Contracts: Android and Linux share dead-PID recovery; conflicts never quarantine a healthy vault.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const database = readFileSync('crates/db/src/database.rs', 'utf8')
const startup = readFileSync('src-tauri/src/startup_storage.rs', 'utf8')

describe('Android process-death recovery (source contracts, not device coverage)', () => {
  it('checks dead owners on Android as well as Linux and fails closed on denied metadata', () => {
    const pidLive = database.slice(database.indexOf('fn pid_live('), database.indexOf('impl Database {'))
    expect(pidLive).toContain('#[cfg(any(target_os = "linux", target_os = "android"))]')
    expect(pidLive).toContain('#[cfg(not(any(target_os = "linux", target_os = "android")))]')
    expect(pidLive).toContain('std::fs::metadata(format!("/proc/{pid}"))')
    expect(pidLive).toContain('error.kind() != std::io::ErrorKind::NotFound')
    expect(pidLive).toContain('Ok(pid) if pid > 0 => pid')
    expect(pidLive).not.toContain('.exists()')
  })

  it('classifies typed corruption before renaming and never removes a conflicting lock', () => {
    expect(startup.replace(/\s+/g, '')).toContain('Some(redb::DatabaseError::Storage(redb::StorageError::Corrupted(_)))')
    expect(startup.indexOf('if !is_database_corruption(&first)')).toBeLessThan(startup.indexOf('std::fs::rename(path, &backup)'))
    expect(startup).toContain('vault preserved (not confirmed corruption)')
    const production = startup.slice(0, startup.indexOf('#[cfg(test)]'))
    expect(production).not.toContain('remove_file')
    expect(production).not.toContain('remove_dir_all')
  })

  it('contains executable native regressions for repeated SIGKILL, data retention, conflicts and corruption', () => {
    expect(database).toContain('fn repeated_background_process_death_reopens_without_reset()')
    expect(database).toContain('child.kill().unwrap()')
    expect(database).toContain('for _ in 0..3')
    expect(startup).toContain('fn live_opener_never_quarantines_or_resets_the_vault()')
    expect(startup).toContain('fn uncertain_lock_preserves_database_and_lock_bytes()')
    expect(startup).toContain('fn confirmed_corruption_keeps_a_recovery_copy()')
  })
})
