// CyberManju OS — Unified Home theme and presentation contracts.
// Role: prevent a second Home grid or private palette from bypassing global themes.
// Exports: Vitest suite. Integrates: Vue compiler and real launcher/studio/drawer sources.
// Contracts: app catalog, custom icons, favorites and accessible navigation remain available.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc'
const paths = ['src/components/MobileLauncher.vue', 'src/components/HomeWorkspaceStudio.vue', 'src/components/AppDrawer.vue']
const [launcher, studio, drawer] = paths.map(path => readFileSync(path, 'utf8'))
describe('unified Home themes', () => {
  it('mounts exactly one canonical workspace independent of search or legacy mode preference', () => {
    const template = parse(launcher).descriptor.template!.content
    expect(template.match(/<HomeWorkspaceStudio\b/g)).toHaveLength(1)
    expect(template).not.toMatch(/workspaceMode|mla-grid|mla-pages|homeLayout/)
    expect(template).toContain(':apps="workspaceApps"')
    expect(template).toContain(':initial-ids="orderedApps.map(app => app.panel)"')
    expect(launcher).not.toContain('cybermanju.home.workspaceMode.v1')
    expect(launcher).toContain('launcher.favorites.flatMap')
    expect(launcher).toContain('homeTile(app)')
    expect(launcher).toContain('if (contextMenuFired)')
    expect(launcher).toContain('if (longPressedHome)')
  })
  it('inherits live global tokens instead of applying the saved Orbit identity palette', () => {
    for (const token of ['--ui-bg', '--ui-surface', '--ui-text', '--ui-text-3', '--ui-accent', '--ui-border']) expect(studio).toContain(`var(${token})`)
    expect(studio).not.toMatch(/identity-\$|--hw-bg:\s*#/)
    expect(launcher).toContain('.mla.theme-flat-amoled { background: #000; }')
    expect(launcher).toContain('--ui-ambient-background')
    expect(launcher).toContain('background: var(--ui-glass)')
    expect(drawer).toContain('blur(var(--ui-blur, 0px)) saturate(var(--ui-saturate, 1))')
    expect(drawer).toContain('.theme-flat-amoled .drawer-img { filter: none; }')
  })
  it('keeps real search, drawer and accessible paging pathways', () => {
    expect(launcher).toContain('<OmniSearchPanel ref="searchRef" home')
    expect(launcher).toContain('aria-label="Open all apps"')
    expect(launcher).toContain('@click="openDrawer"')
    expect(drawer).toContain('@click="onTap(row)"')
    for (const marker of ['@keydown="workspaceKeys"', 'Previous home screen', 'Next home screen', 'Overview of home screens', 'aria-current', 'tabindex="0"']) expect(studio).toContain(marker)
    expect(studio).toContain('await nativeHome.suspend()')
  })
  it('compiles every unified Home template and scoped style', () => {
    for (const path of paths) {
      const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
      expect(errors).toEqual([])
      expect(compileTemplate({ source: descriptor.template!.content, filename: path, id: 'home-theme' }).errors).toEqual([])
      for (const style of descriptor.styles) expect(compileStyle({ source: style.content, filename: path, id: 'home-theme', scoped: style.scoped }).errors).toEqual([])
    }
  })
})
