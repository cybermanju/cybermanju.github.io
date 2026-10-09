import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseConfig, supabaseOAuthQueryParams, supabaseScopesFor } from '@/composables/useSupabase'

const URL_KEY = 'cybermanju.supabaseUrl'
const KEY_KEY = 'cybermanju.supabaseKey'
const values = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)) },
  removeItem: (key: string) => { values.delete(key) },
  clear: () => { values.clear() },
}

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', localStorageMock)
  vi.stubEnv('VITE_SUPABASE_URL', 'https://broker.example.test/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'build-public-anon-key')
})

afterEach(() => {
  values.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Supabase broker configuration', () => {
  it('uses the build-time pair when no manual settings are saved', () => {
    expect(getSupabaseConfig()).toEqual({
      url: 'https://broker.example.test',
      key: 'build-public-anon-key',
      source: 'build-env',
    })
  })

  it('prefers a complete manual pair over the build-time pair', () => {
    localStorageMock.setItem(URL_KEY, 'https://manual.example.test/')
    localStorageMock.setItem(KEY_KEY, 'manual-public-anon-key')

    expect(getSupabaseConfig()).toEqual({
      url: 'https://manual.example.test',
      key: 'manual-public-anon-key',
      source: 'localStorage',
    })
  })

  it('does not let a partial manual override mask a complete build-time pair', () => {
    localStorageMock.setItem(URL_KEY, 'https://stale.example.test/')

    expect(getSupabaseConfig()).toEqual({
      url: 'https://broker.example.test',
      key: 'build-public-anon-key',
      source: 'build-env',
    })
  })

  it('reports an empty source when neither configuration pair is complete', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    localStorageMock.setItem(URL_KEY, 'https://manual.example.test/')

    expect(getSupabaseConfig()).toEqual({
      url: 'https://manual.example.test',
      key: '',
      source: 'localStorage',
    })

    localStorageMock.removeItem(URL_KEY)
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
