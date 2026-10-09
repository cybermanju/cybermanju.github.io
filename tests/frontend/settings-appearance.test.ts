import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const settingsPage = fs.readFileSync('src/components/SettingsPage.vue', 'utf8')

describe('Appearance settings', () => {
  it('exposes only one accessible toggle for the opt-in wallpaper effect', () => {
    const effectToggles = settingsPage.match(/v-model="store\.matrixRainEnabled"/g) ?? []

    expect(effectToggles).toHaveLength(1)
    expect(settingsPage).toContain('>Wallpaper effects</UiText>')
    expect(settingsPage).toContain('aria-label="Wallpaper effects (opt-in canvas)"')
    expect(settingsPage).not.toContain('>Matrix rain</UiText>')
  })
})
