// CyberManju OS — Supabase mobile bundle guard tests.
// Role: assert builds cannot silently publish a brokerless frontend.
// Integrates: Vitest, temporary Vite output fixtures, Node child process.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
let dir: string
const url = 'https://broker.example.test'
const key = 'sb_publishable_test_public_key'
function verify(env: Record<string, string>) {
  return execFileSync(process.execPath, [resolve('scripts/verify-supabase-build.mjs'), dir], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: 'pipe',
  })
}
beforeEach(async () => { dir = await mkdtemp(resolve(tmpdir(), 'broker-build-')); await mkdir(resolve(dir, 'assets')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
describe('mobile broker build guard', () => {
  it('rejects missing broker values on trusted builds', () => {
    expect(() => verify({ REQUIRE_BROKER: '1' })).toThrow()
  })
  it('explicitly permits brokerless fork builds', () => {
    expect(verify({})).toContain('Skipped')
  })
  it('rejects a partial secret pair even on an untrusted build', () => {
    expect(() => verify({ VITE_SUPABASE_URL: url })).toThrow()
  })
  it('rejects a bundle that lost the key', async () => {
    await writeFile(resolve(dir, 'assets/main.js'), `const marker='cybermanju.supabaseUrl';const url=${JSON.stringify(url)}`)
    expect(() => verify({ REQUIRE_BROKER: '1', VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key })).toThrow()
  })
  it('verifies the broker-bearing bundle without printing either value', async () => {
    await writeFile(resolve(dir, 'assets/main.js'), `const marker='cybermanju.supabaseUrl';const url=${JSON.stringify(url)},key=${JSON.stringify(key)}`)
    const output = verify({ REQUIRE_BROKER: '1', VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key })
    expect(output).toContain('Verified')
    expect(output).not.toContain(url)
    expect(output).not.toContain(key)
  })
})
