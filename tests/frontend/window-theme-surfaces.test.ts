// CyberManju OS — window-theme-surfaces.test.ts
// Desktop theme-specific window and launcher contracts. Mobile sizing/chrome
// remain owned by their existing responsive rules and are not changed here.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { compileStyle, parse } from '@vue/compiler-sfc'

const files = {
  window: 'src/components/AppWindow.vue',
  shell: 'src/components/DesktopShell.vue',
  dock: 'src/components/Dock.vue',
  shortcutDock: 'src/components/ShellShortcutDock.vue',
}
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])) as Record<keyof typeof files, string>

describe('desktop Modern Glass and Flat AMOLED surfaces', () => {
  it('uses theme IDs without weakening opaque window body text or focus hierarchy', () => {
    expect(source.window).toContain("theme.themeId.value === 'modern-glass'")
    expect(source.window).toContain("theme.themeId.value === 'flat-amoled'")
    expect(source.window).toContain('.app-window--modern-glass.focused')
    expect(source.window).toContain('.app-window--modern-glass.blurred')
    expect(source.window).toMatch(/\.app-window--modern-glass \.window-content\s*\{\s*background:\s*var\(--ui-surface\)/)
    expect(source.window).toContain('.app-window--flat-amoled.focused')
    expect(source.window).toContain('outline: 1px solid rgba(255, 255, 255, 0.5)')
    expect(source.window).toContain('text-overflow: ellipsis')
    expect(source.window).toContain('.window-titlebar--narrow .titlebar-label')
    expect(source.window).toContain('pointer-events: none;') // minimized / drag behavior retained
    expect(source.window).toContain('startResize(\'n\', $event)')
  })

  it('renders Flat AMOLED as a black, wallpaper-free icon launcher without icon tiles', () => {
    expect(source.shell).toContain("theme.themeId.value === 'flat-amoled'")
    expect(source.shell).toContain('.desktop-shell--flat-amoled:not(.desktop-shell--mobile) .desktop-area')
    expect(source.shell).toContain('background: #000;')
    expect(source.shell).toContain('.desktop-shell--flat-amoled:not(.desktop-shell--mobile) .desktop-wallpaper')
    expect(source.shell).toContain('display: none;')
    expect(source.shell).toContain('color: #fff;')
    expect(source.shell).toContain('background: transparent;')
    // Hiding the visual layer must not discard a user's configured wallpaper.
    expect(source.shell).toContain('v-if="customWallpaper.source.value"')
    expect(source.shell).toContain('void customWallpaper.load()')
  })

  it('keeps dock names visible and each launcher action keyboard/AT accessible', () => {
    expect(source.dock).toContain('dock-container--flat-amoled')
    expect(source.dock).toContain('class="dock-item-label"')
    expect(source.dock).toContain('role="button"')
    expect(source.dock).toContain('tabindex="0"')
    expect(source.dock).toContain('@keydown.enter.stop.prevent')
    expect(source.dock).toContain('@keydown.space.stop.prevent')
    expect(source.dock).toContain(':aria-label="app.label"')
    expect(source.dock).toContain(':aria-label="win.title"')
    expect(source.shortcutDock).toContain('shell-dock--modern-glass')
    expect(source.shortcutDock).toContain('shell-dock--flat-amoled')
  })

  it('compiles the assigned Vue SFC style blocks', () => {
    for (const [name, path] of Object.entries(files)) {
      const { descriptor, errors } = parse(source[name as keyof typeof files], { filename: path })
      expect(errors, `${path} SFC parse errors`).toEqual([])
      for (const [index, style] of descriptor.styles.entries()) {
        const result = compileStyle({
          source: style.content,
          filename: path,
          id: `theme-surfaces-${name}-${index}`,
          scoped: style.scoped,
        })
        expect(result.errors, `${path} style block ${index} compile errors`).toEqual([])
      }
    }
  })
})
