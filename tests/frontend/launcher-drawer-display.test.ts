// CyberManju OS — Drawer display (tests/frontend/launcher-drawer-display.test.ts).
// Role: Regressions for persistent drawer layouts, accessible icons and scroll-safe gestures.
// Integrates: Pinia launcher store, Vue SFC compiler and Vitest; no native runtime required.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useLauncherStore } from '@/stores/launcher'

const key = 'cybermanju.launcher.drawerDisplay.v1'
const overridesKey = 'cybermanju.launcher.overrides.v1'
const drawer = readFileSync('src/components/AppDrawer.vue', 'utf8')
let entries: Map<string, string>

beforeEach(() => {
  entries = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => entries.set(name, value),
  })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('persistent drawer display', () => {
  it('defaults existing installations to names and icons', () => {
    expect(useLauncherStore().drawerDisplay).toBe('both')
  })

  it.each(['list', 'icons', 'both'] as const)('restores %s immediately without affecting app overrides', async mode => {
    const store = useLauncherStore()
    store.rename('android:example.app', 'My app')
    await nextTick()
    const originalOverrides = entries.get(overridesKey)
    store.setDrawerDisplay(mode)
    expect(entries.get(key)).toBe(mode)
    expect(entries.get(overridesKey)).toBe(originalOverrides)
    setActivePinia(createPinia())
    const restored = useLauncherStore()
    expect(restored.drawerDisplay).toBe(mode)
    expect(restored.get('android:example.app').alias).toBe('My app')
  })

  it('migrates the old names-only preference to the icon-and-name list', () => {
    entries.set(key, 'names')
    expect(useLauncherStore().drawerDisplay).toBe('list')
  })

  it.each(['', 'grid', 'null', '{broken'])('falls back safely for invalid stored value %s', value => {
    entries.set(key, value)
    expect(useLauncherStore().drawerDisplay).toBe('both')
  })

  it('rejects unsupported display modes without overwriting the preference', () => {
    const store = useLauncherStore()
    store.setDrawerDisplay('names')
    store.setDrawerDisplay('unsupported')
    store.setDrawerDisplay(1)
    expect(store.drawerDisplay).toBe('list')
    expect(entries.get(key)).toBe('list')
  })

  it('remains usable when local storage is blocked or full', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
    })
    const store = useLauncherStore()
    expect(store.drawerDisplay).toBe('both')
    expect(() => store.setDrawerDisplay('icons')).not.toThrow()
    expect(store.drawerDisplay).toBe('icons')
  })
})

describe('drawer presentation and smooth interaction contracts', () => {
  it('exposes all layouts and labels both built-in and Android icon-only buttons', () => {
    for (const label of ['List', 'Icons only', 'Names & icons']) expect(drawer).toContain(label)
    expect(drawer).toContain('aria-label="App drawer display"')
    expect(drawer).toContain(':aria-pressed="launcher.drawerDisplay === mode.value"')
    expect(drawer).toContain(':aria-label="`Open ${app.label}`"')
    expect(drawer).toContain(':aria-label="`Open ${row.name}`"')
    expect(drawer.match(/v-if="showIcons"/g)).toHaveLength(2)
    expect(drawer.match(/v-if="showNames"/g)).toHaveLength(2)
    expect(drawer).toContain('.drawer-display-list .drawer-grid { grid-template-columns: minmax(0, 1fr)')
    expect(drawer).toContain('.drawer-display-list .drawer-app { min-height: 56px; flex-direction: row;')
    expect(drawer).toContain('const showIcons = computed(() => true)')
  })

  it('avoids repeat icon resolution and search-triggered entrance animations', () => {
    expect(drawer).toContain('tile: tileFor(row)')
    expect(drawer).not.toContain('tileFor(row).src')
    expect(drawer).toContain('decoding="async"')
    expect(drawer).toContain('v-memo="[visible, showIcons, showNames]"')
    expect(drawer).toContain('v-memo="[visibleBuiltIns, showIcons, showNames, isFlatAmoled]"')
    expect(drawer).toContain('.drawer-enter-active .drawer-cell { animation: drawer-reveal')
    expect(drawer).not.toContain('.app-drawer-veil:not(.is-preview) .drawer-cell')
    expect(drawer).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('uses movement cancellation and gesture-start scroll position to prevent accidental actions', () => {
    expect(drawer).toContain('@pointermove="onPressMove"')
    expect(drawer).toContain('Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10')
    expect(drawer).toContain('onUnmounted(onPressEnd)')
    expect(drawer).toContain('@touchcancel.passive="resetSheetGesture"')
    const touchStart = drawer.slice(drawer.indexOf('function onSheetTouchStart'), drawer.indexOf('function onSheetTouchEnd'))
    expect(touchStart).toContain('(gridRef.value?.scrollTop ?? 0) <= 8')
    expect(touchStart).toContain("!(e.target as HTMLElement | null)?.closest('.drawer-grid')")
    expect(drawer).toContain('shouldCommitDrawerGesture(point.clientY - sheetStartY, point.clientX - sheetStartX, Date.now() - sheetStartTime)')
    expect(drawer).toMatch(/v-if="visibleBuiltIns.length"[^>]*ref="gridRef"/)
  })
})
