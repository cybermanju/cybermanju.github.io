// CyberManju OS — HOME role Tauri wiring contract.
// Role: guard the thin UI-only wrappers and their exact frozen native payloads.
// Exports: Vitest regression suite; runtime Android behavior is covered by JVM tests/CI.
// Integrates: launcher wrappers, native invoke registration and the Home UI consumer.
// Contracts: no generic action/payload passthrough, automation exposure or startup request.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const launcher = read('src-tauri/src/commands/launcher.rs')
const handler = read('src-tauri/src/lib.rs')
const ui = read('src/composables/useHomeRoleAction.ts')
const native = read('native/android/CybermanjuHomeRole.kt')
const section = launcher.slice(launcher.indexOf('fn require_home_role_ui'), launcher.indexOf('/// Run one allowlisted native action'))
const status = section.slice(section.indexOf('pub fn android_home_role_status'), section.indexOf('/// Only the visible Home CTA'))
const request = section.slice(section.indexOf('pub fn android_home_role_request'))

describe('HOME role Tauri integration', () => {
  it('registers both frozen UI commands exactly once', () => {
    for (const name of ['android_home_role_status', 'android_home_role_request']) {
      expect(handler.match(new RegExp(`commands::launcher::${name}`, 'g'))).toHaveLength(1)
    }
    expect(ui).toContain("invoke('android_home_role_status')")
    expect(ui).toContain("invoke('android_home_role_request', { requestId })")
  })
  it('guards both wrappers with bundled main UI before dispatch', () => {
    expect(section).toContain('window.label() != "main" || !bundled')
    expect(section).toContain('url.scheme() == "tauri" && url.host_str() == Some("localhost")')
    expect(section).toContain('url.host_str() == Some("tauri.localhost")')
    expect(section).not.toContain('dev_url')
    for (const wrapper of [status, request]) {
      expect(wrapper.indexOf('require_home_role_ui(&window)?;')).toBeGreaterThan(0)
      expect(wrapper.indexOf('require_home_role_ui(&window)?;')).toBeLessThan(wrapper.indexOf('cybermanju_launcher::home_role_command'))
    }
  })
  it('constructs exact native payloads, with requestId camelCase from Tauri', () => {
    expect(status).toContain('home_role_command("status", serde_json::json!({}))')
    expect(request).toContain('request_id: String')
    expect(request).toMatch(/home_role_command\(\s*"request",\s*serde_json::json!\(\{\s*"requestId": request_id\s*\}\)/)
    expect(section).not.toMatch(/action: String|payload:|Option</)
    expect(section).not.toContain('rename_all')
  })
  it('retains authoritative foreground, resumed and unlocked native checks', () => {
    expect(native).toContain('requireForegroundUnlocked(activity)')
    expect(native).toContain('!activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()')
    expect(native).toContain('!keyguard.isKeyguardLocked')
    expect(native).toContain('current.resumed')
    expect(ui).toContain('!event.isTrusted')
    expect(ui).toContain('eventAge > 5000')
  })
  it('does not add HOME dispatch to REST or automation/Agent surfaces', () => {
    for (const path of ['crates/launcher/src/automation.rs', 'src/composables/useTauri.ts']) {
      expect(read(path)).not.toMatch(/android_home_role_(?:status|request)|home_role_command/)
    }
    expect(launcher.slice(launcher.indexOf('pub fn automation_native_dispatch'))).not.toMatch(/home_role_command|android_home_role/)
  })
})
