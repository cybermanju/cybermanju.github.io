// CyberManju OS — Home launcher themes (tests/frontend/home-launcher-themes.test.ts).
// Role: Regression coverage for theme-aware mobile launcher and drawer presentation.
// Exports: Vitest suite for flat AMOLED, modern glass, navigation semantics, and SFC compilation.
// Integrates: Vue compiler-sfc, Vitest, filesystem source fixtures.
// Contracts: Tests preserve accessible app/search/drawer actions and valid scoped styles.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc'

const launcherPath = 'src/components/MobileLauncher.vue'
const drawerPath = 'src/components/AppDrawer.vue'
const launcher = readFileSync(launcherPath, 'utf8')
const drawer = readFileSync(drawerPath, 'utf8')

function compileComponent(source: string, filename: string) {
  const parsed = parse(source, { filename })
  expect(parsed.errors, `${filename} SFC parse`).toEqual([])
  expect(parsed.descriptor.template, `${filename} template`).toBeTruthy()
  expect(parsed.descriptor.styles.length, `${filename} style`).toBeGreaterThan(0)

  const template = compileTemplate({
    source: parsed.descriptor.template!.content,
    filename,
    id: 'home-launcher-theme-test',
  })
  expect(template.errors, `${filename} template compile`).toEqual([])

  for (const style of parsed.descriptor.styles) {
    const result = compileStyle({
      source: style.content,
      filename,
      id: 'home-launcher-theme-test',
      scoped: style.scoped,
    })
    expect(result.errors, `${filename} style compile`).toEqual([])
  }
}

describe('home launcher themes', () => {
  it('keeps flat AMOLED home to monochrome app glyphs and names with search and drawer access', () => {
    expect(launcher).toContain("themeId.value === 'flat-amoled'")
    expect(launcher).toContain('v-if="isFlatAmoled && !query.trim() && filtered.length"')
    expect(launcher).toContain('mla-flat-icon-image')
    expect(launcher).toContain('filter: grayscale(1) brightness(0) invert(1)')
    expect(launcher).toContain('background: #000')
    expect(launcher).toContain('<OmniSearchPanel ref="searchRef" home')
    expect(launcher).toContain('aria-label="Open all apps"')
    expect(launcher).toContain('@click="openDrawer"')
    expect(launcher).toContain('onHomePressStart(app, $event)')
    expect(launcher).toContain('homeName(app)')
    expect(launcher).toContain('v-if="!isFlatAmoled && !query.trim()" class="mla-dock"')
  })

  it('exposes accessible page controls and keeps all app launch pathways available', () => {
    expect(launcher).toContain('tabindex="0"')
    expect(launcher).toContain('@keydown.left.prevent')
    expect(launcher).toContain('@keydown.right.prevent')
    expect(launcher).toContain(':aria-current="activePage === dotIndex ? \'page\' : undefined"')
    expect(launcher).toContain('aria-label="Home app pages"')
    expect(launcher).toContain('v-if="isFlatAmoled && !query.trim() && filtered.length"\n      ref="pagerRef"')
    expect(launcher).toContain('@touchstart.passive="onTouchStart"')
    expect(drawer).toContain('@click="onTap(row)"')
    expect(drawer).toContain('theme-flat-amoled')
  })

  it('provides a scoped modern glass surface using effective blur tokens', () => {
    expect(launcher).toContain('.mla.theme-modern-glass')
    expect(drawer).toContain('.theme-modern-glass')
    expect(launcher).toContain('background: var(--ui-glass)')
    expect(drawer).toContain('background: var(--ui-glass)')
    expect(drawer).toContain('blur(var(--ui-blur, 0px)) saturate(var(--ui-saturate, 1))')
  })

  it('compiles both launcher SFC templates and scoped styles', () => {
    compileComponent(launcher, launcherPath)
    compileComponent(drawer, drawerPath)
  })
})
