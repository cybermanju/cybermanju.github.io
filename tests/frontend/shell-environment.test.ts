// CyberManju OS — Scrubbed device environment.test (tests/frontend/shell-environment.test.ts).
// Role: synthetic-env contract: allowlist gating, PATH
//       growth, dotenv round-trip. Pure — no browser required.
// Exports: Vitest suite.
// Integrates: src/utils/shellEnvironment.ts.
// Contracts: only allowlisted keys escape the wall (`env_clear`, PATH/
//            locale only — AGENTS.md §5); multi-line values blank out.
import { describe, expect, it } from 'vitest'
import {
  DEVICE_ENV_ALLOWLIST,
  buildDeviceShellEnv,
  parseDotenv,
  renderDeviceEnvFile,
  toDotenv,
} from '@/utils/shellEnvironment'

describe('scrubbed device environment', () => {
  it('keeps the allowlist to PATH/locale only (the AGENTS §5 contract)', () => {
    expect([...DEVICE_ENV_ALLOWLIST].sort()).toEqual(['LANG', 'LC_ALL', 'PATH', 'TZ'])
  })

  it('drops every non-allowlisted host variable (ANDROID_*, vendor junk)', () => {
    const env = buildDeviceShellEnv({
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      ANDROID_DATA: '/data',
      SHELL: '/bin/sh',
      BOOTCLASSPATH: '/system/framework/core.jar',
      LD_PRELOAD: '/evil.so',
    })
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH'])
    expect(env.PATH).toBe('/usr/bin:/bin')
  })

  it('drops EMPTY allowlist values and emits PWD only when handed one', () => {
    const env = buildDeviceShellEnv({ PATH: '/bin', LANG: '', TZ: 'UTC', LC_ALL: 'C' })
    expect(env.LANG).toBeUndefined()
    expect(env.TZ).toBe('UTC')
    expect(env.LC_ALL).toBe('C')
    expect(env.PWD).toBeUndefined()
    // No workingDirectory, no host PATH ⇒ the compiled-default PATH and no PWD.
    const hermetic = buildDeviceShellEnv(undefined, { workingDirectory: '/home/u/vault' })
    expect(hermetic.PATH).toBe('/usr/bin:/bin')
    expect(hermetic.PWD).toBe('/home/u/vault')
  })

  it('prepends app paths and dedupes PATH entries (first occurrence wins)', () => {
    const env = buildDeviceShellEnv(
      { PATH: '/system/bin:/bin:/system/bin' },
      { pathPrefix: ['/data/local/tmp/cyb/bin', '/bin'] },
    )
    expect(env.PATH).toBe('/data/local/tmp/cyb/bin:/bin:/system/bin')
  })

  it('defaults HOME to a harmless path and never inherits the host HOME', () => {
    const env = buildDeviceShellEnv({ PATH: '/bin' })
    expect(env.HOME).toBe('/tmp')
    // PATH/locale-only contract: the host HOME is scrubbed, not forwarded.
    expect(buildDeviceShellEnv({ PATH: '/bin', HOME: '/root' }).HOME).toBe('/tmp')
    // The caller hands an explicit session HOME instead (per-session TMP/HOME).
    expect(buildDeviceShellEnv({ PATH: '/bin' }, { home: '/home/u/vault' }).HOME).toBe('/home/u/vault')
  })

  it('strips newlines from PWD/HOME overrides (injection hygiene)', () => {
    const env = buildDeviceShellEnv({ PATH: '/bin' }, { workingDirectory: '/home/u\nEVIL=1', home: '/x\r\nc' })
    expect(env.PWD).toBe('/home/uEVIL=1')
    expect(env.HOME).toBe('/xc')
  })

  it('quotes shell-dangerous dotenv values and round-trips', () => {
    const env = { PATH: '/usr/bin:/bin', LANG: "en'A'US" }
    const lines = toDotenv(env)
    expect(lines).toEqual(['LANG=' + `'en'\\''A'\\''US'`, 'PATH=/usr/bin:/bin'])
    expect(parseDotenv(lines.join('\n'))).toEqual({ LANG: "en'A'US", PATH: '/usr/bin:/bin' })
  })

  it('blanks multi-line values in dotenv (documented limit) and sorts keys', () => {
    const lines = toDotenv({ ZED: '1', ABC: 'a\nb' })
    expect(lines[0]).toBe('ABC=')
    expect(lines[1]).toBe('ZED=1')
  })

  it('renders a self-describing env file that re-derives through parseDotenv', () => {
    const file = renderDeviceEnvFile('device session', buildDeviceShellEnv({ PATH: '/bin', LANG: 'C.UTF-8' }))
    expect(file).toContain('# device session')
    expect(file).toContain('# Generated ')
    const parsed = parseDotenv(file)
    expect(parsed.PATH).toBe('/bin')
    expect(parsed.LANG).toBe('C.UTF-8')
  })
})
