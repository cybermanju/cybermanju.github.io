// Merged-window aliases stay honest: every alias resolves to a real,
// non-aliased canonical window that exists in the module metadata, and no
// alias chain can loop back on itself.
import { describe, expect, it } from 'vitest'
import { ALIAS_TAB_PROPS, PANEL_ALIASES, resolvePanel } from '@/utils/panels'
import { MODULE_METADATA } from '@/types'

describe('panel aliases', () => {
  it('resolves unknown ids to themselves', () => {
    expect(resolvePanel('files')).toBe('files')
    expect(resolvePanel('editor')).toBe('editor')
  })

  it('resolves every alias to its canonical window', () => {
    expect(resolvePanel('code')).toBe('editor')
    expect(resolvePanel('webdash')).toBe('dashboard')
    expect(resolvePanel('storage')).toBe('disks')
    expect(resolvePanel('compression')).toBe('encryption')
    expect(resolvePanel('users')).toBe('accounts')
    expect(resolvePanel('favorites')).toBe('collections')
    expect(resolvePanel('loose-groups')).toBe('collections')
    expect(resolvePanel('style')).toBe('collections')
    expect(resolvePanel('preview')).toBe('files')
  })

  it('routes the scheduler aliases onto the Tasks window (Phase 1)', () => {
    for (const alias of ['cron', 'automation', 'schedules'] as const) {
      expect(resolvePanel(alias), `${alias} → processes`).toBe('processes')
      expect(ALIAS_TAB_PROPS[alias], `${alias} tab props`).toEqual({ tab: 'schedules' })
      expect(MODULE_METADATA[alias], `${alias} metadata`).toBeDefined()
    }
  })

  it('has no self-aliases, chains or cycles', () => {
    for (const [alias, target] of Object.entries(PANEL_ALIASES)) {
      expect(target, `${alias} aliases to itself`).not.toBe(alias)
      // A target must be canonical: resolving it again is a no-op.
      expect(resolvePanel(target as never), `${alias} → ${target} chains`).toBe(target)
    }
  })

  it('points every alias at metadata-backed windows', () => {
    for (const [alias, target] of Object.entries(PANEL_ALIASES)) {
      expect(MODULE_METADATA[target as never], `no metadata for ${alias} target ${target}`).toBeDefined()
    }
  })

  it('only carries tab props for aliased ids', () => {
    for (const id of Object.keys(ALIAS_TAB_PROPS)) {
      expect(PANEL_ALIASES[id as never], `${id} has tab props but is not an alias`).toBeDefined()
    }
  })
})
