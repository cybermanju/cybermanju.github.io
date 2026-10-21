// CyberManju OS — Home favorites tests (tests/frontend/home-favorites.test.ts).
// Role: Verify mobile favorite selection, order, persistence and reset remain separate from icons.
// Exports: Vitest suite.
// Integrates: Pinia launcher store and localStorage test fixture.
// Contracts: At most six known unique shortcuts; old customization data stays intact.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLauncherStore } from '@/stores/launcher'
const saved = new Map<string, string>()
beforeEach(() => {
  saved.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())
describe('mobile home dock favorites', () => {
  it('keeps defaults and saves pinning without touching home aliases', () => {
    const store = useLauncherStore()
    expect(store.favorites).toEqual(['files', 'agent', 'terminal', 'settings'])
    store.rename('os:agent', 'My assistant')
    store.toggleFavorite('map')
    store.setFavorites(['map', 'agent', 'files'])
    expect(JSON.parse(saved.get('cybermanju.launcher.favorites.v1')!)).toEqual(['map', 'agent', 'files'])
    store.resetFavorites()
    expect(store.get('os:agent').alias).toBe('My assistant')
  })
  it('enforces known unique shortcuts and the six-icon mobile limit', () => {
    const store = useLauncherStore()
    store.setFavorites(['files', 'files', 'unknown', 'agent', 'terminal', 'settings', 'map', 'editor', 'storage'])
    expect(store.favorites).toEqual(['files', 'agent', 'terminal', 'settings', 'map', 'editor'])
    store.toggleFavorite('storage')
    expect(store.favorites).toHaveLength(6)
    store.toggleFavorite('files')
    expect(store.favorites).not.toContain('files')
    store.toggleFavorite('storage')
    expect(store.favorites).toContain('storage')
  })
  it('restores a deliberately empty dock and filters corrupted entries', () => {
    saved.set('cybermanju.launcher.favorites.v1', '[]')
    expect(useLauncherStore().favorites).toEqual([])
    setActivePinia(createPinia())
    saved.set('cybermanju.launcher.favorites.v1', '["map", "map", 42, "invalid"]')
    expect(useLauncherStore().favorites).toEqual(['map'])
  })
})
