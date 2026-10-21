// CyberManjuOS — Native widget UI contract tests.
// Role: guard the separation between first-party previews and Android-owned widget views.
// Exports: none.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const bridge = readFileSync('src/composables/useAndroidWidgets.ts', 'utf8')
const coordinator = readFileSync('src/composables/useHomeNativeWidgets.ts', 'utf8')
const studio = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
const catalog = readFileSync('src/data/homeWidgetCatalog.ts', 'utf8')
const bridgeCode = bridge.replace(/^\/\/.*$/gm, '')

describe('native widget UI contracts', () => {
  it('routes host work through the direct android_widget_command bridge, not REST', () => {
    expect(bridgeCode).toContain("invoke<NativeWidgetReply>('android_widget_command', { action, payload })")
    expect(bridgeCode).not.toMatch(/\bfetch\s*\(/)
  })

  it('hides native hit regions before scheduling settled layout outside animation frames', () => {
    expect(coordinator).toMatch(/function schedule\(force = false\)\s*\{\s*void suspend\(force\);[^}]*setTimeout\(\(\) => \{ void settle\(\) \}, 420\)/)
    expect(coordinator).toContain('await requestHide()')
    expect(coordinator).not.toMatch(/requestAnimationFrame\s*\(/)
    expect(coordinator).toContain("bridge.layout({ appWidgetId: record.appWidgetId, visible: true")
  })

  it('maps geometry through the native dp helper and only lays out ready, available records', () => {
    expect(coordinator).toContain('nativeWidgetBounds(')
    expect(coordinator).toMatch(/record\.state !== 'ready' \|\| !record\.providerAvailable/)
    expect(coordinator).toContain('widthDp: viewport.widthDp')
    expect(coordinator).toContain('heightDp: viewport.heightDp')
  })

  it('represents binding/configuring/ready host states and keeps native views out of Eagle previews', () => {
    expect(bridge).toContain("state: 'binding' | 'configuring' | 'ready'")
    expect(studio).toContain('No live DOM preview.')
    expect(studio).toContain('Hidden during scrolling, menus and Eagle view.')
    expect(studio).toContain("item.kind === 'widget' && item.ref.startsWith('native:')")
    expect(catalog).toMatch(/kind:\s*'native'/)
    expect(studio).toContain('widget.kind === \'native\'')
    const eagleTemplate = studio.slice(studio.indexOf('<template v-if="overview">'), studio.indexOf('</template>', studio.indexOf('<template v-if="overview">')))
    expect(eagleTemplate).not.toContain('native-widget-slot')
  })
})
