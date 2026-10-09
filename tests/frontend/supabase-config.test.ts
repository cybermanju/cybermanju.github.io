import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseConfig, supabaseOAuthQueryParams, supabaseScopesFor } from '@/composables/useSupabase'

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://broker.example.test/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'build-public-anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Supabase broker configuration (fixed at build time)', () => {
  it('uses the build-time pair', () => {
    expect(getSupabaseConfig()).toEqual({
      url: 'https://broker.example.test',
      key: 'build-public-anon-key',
      source: 'build-env',
    })
  })

  it('has no runtime override — localStorage entries are ignored', () => {
    const values = new Map<string, string>()
    values.set('cybermanju.supabaseUrl', 'https://manual.example.test/')
    values.set('cybermanju.supabaseKey', 'manual-public-anon-key')
    // getSupabaseConfig reads build env only; the manual pair never surfaces.
    expect(getSupabaseConfig()).toEqual({
      url: 'https://broker.example.test',
      key: 'build-public-anon-key',
      source: 'build-env',
    })
  })

  it('reports an empty source when the build has no broker', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(getSupabaseConfig()).toEqual({ url: '', key: '', source: 'none' })
  })

  it('requests a fresh offline Google consent when reconnecting Drive', () => {
    expect(supabaseScopesFor('googleDrive')).toContain('https://www.googleapis.com/auth/drive.file')
    expect(supabaseOAuthQueryParams('googleDrive', true)).toEqual({ access_type: 'offline', prompt: 'consent' })
    expect(supabaseOAuthQueryParams('google', true)).toEqual({ access_type: 'offline', prompt: 'consent' })
    expect(supabaseOAuthQueryParams('github', true)).toBeUndefined()
    expect(supabaseOAuthQueryParams('googleDrive')).toBeUndefined()
  })
})
