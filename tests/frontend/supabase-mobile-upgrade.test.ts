// CyberManju OS — Supabase mobile upgrade regression tests.
// Role: verify persisted settings never disable valid bundled defaults.
// Integrates: Vitest and useSupabase; no real credentials or network calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseConfig, hydrateSupabaseConfig, setSupabaseConfig, supabaseConfigured, getSupabaseClient } from '@/composables/useSupabase'

beforeEach(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://broker.example.test/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'build-public-anon-key')
  vi.stubEnv('VITE_SUPABASE_KEY', '')
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  await hydrateSupabaseConfig()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Supabase broker configuration after a mobile upgrade', () => {
  it.each([
    ['undefined', 'old-public-key'],
    ['null', 'old-public-key'],
    ['http-not-a-url', 'old-public-key'],
    ['https://manual.example.test', 'short'],
    ['https://manual.example.test', ''],
  ])('falls back to the build pair for invalid saved settings (%s)', async (url, key) => {
    localStorage.setItem('cybermanju.supabaseUrl', url)
    localStorage.setItem('cybermanju.supabaseKey', key)
    await hydrateSupabaseConfig()
    expect(getSupabaseConfig()).toEqual({ url: 'https://broker.example.test', key: 'build-public-anon-key', source: 'build-env' })
    expect(supabaseConfigured()).toBe(true)
  })

  it('does not combine a saved project URL with another project build key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    localStorage.setItem('cybermanju.supabaseUrl', 'https://other.example.test')
    await hydrateSupabaseConfig()
    expect(getSupabaseConfig()).toEqual({ url: 'https://other.example.test', key: '', source: 'settings' })
    expect(supabaseConfigured()).toBe(false)
    expect(await getSupabaseClient()).toBeNull()
  })

  it('rejects URL lookalikes that used to pass the startsWith(http) check', () => {
    expect(setSupabaseConfig('http-not-a-url', 'manual-public-key')).toMatch(/https/i)
    expect(getSupabaseConfig().source).toBe('build-env')
  })

  it('preserves a valid explicit custom broker', () => {
    expect(setSupabaseConfig('https://custom.example.test/', 'custom-public-key')).toBeNull()
    expect(getSupabaseConfig()).toEqual({ url: 'https://custom.example.test', key: 'custom-public-key', source: 'settings' })
  })
})
