// CyberManju OS — Read-only overview preview regressions.
// Role: validate own-content miniatures, persistent canvases and visual fallbacks.
// Integrates: Vue SFC compiler and Home workspace components.
import { readFileSync } from 'node:fs'
import { parse as parseSfc, compileStyle } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import { describe, expect, it } from 'vitest'

const previewSource = readFileSync('src/components/HomeWorkspacePreview.vue', 'utf8')
const studioSource = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
const preview = parseSfc(previewSource).descriptor
const studio = parseSfc(studioSource).descriptor
function walk(node: any, visit: (n: any) => void) { visit(node); for (const child of node.children || []) walk(child, visit) }
function hasDirective(node: any, name: string) { return (node.props || []).some((p: any) => p.type === 7 && p.name === name) }

describe('Home overview read-only miniature contract', () => {
  it('compiles the actual preview and overview templates', () => {
    expect(preview.template?.ast).toBeTruthy(); expect(studio.template?.ast).toBeTruthy()
    expect(preview.template!.content.trim()).toBeTruthy(); expect(studio.template!.content.trim()).toBeTruthy()
  })
  it('compiles efficient effects with accessible motion/transparency fallbacks', () => {
    const result = compileStyle({ source: studio.styles[0].content, filename: 'HomeWorkspaceStudio.vue', id: 'test-home', scoped: true })
    expect(result.errors).toEqual([])
    for (const rule of ['@supports', 'prefers-reduced-motion:reduce', 'prefers-reduced-transparency:reduce', 'forced-colors:active', 'backdrop-filter: none', 'background: var(--hw-bg)']) expect(result.code).toContain(rule)
    expect(studio.scriptSetup!.content).not.toMatch(/WebGL|requestAnimationFrame|MediaProjection|getDisplayMedia/)
  })
  it('renders preview data only and never mounts interactive/native host content', () => {
    const ast = baseParse(preview.template!.content)
    const nodes: any[] = []; walk(ast, n => nodes.push(n))
    const tags = nodes.filter(n => n.type === 1).map(n => n.tag)
    expect(tags).not.toContain('button'); expect(tags).not.toContain('input'); expect(tags).not.toContain('iframe')
    expect(preview.template!.content).not.toMatch(/HomeLocalWidget|HostView|native-widget-slot|widget instance/i)
    expect(preview.scriptSetup?.content).toContain('defineProps<{ items: HomeItem[]')
    expect(preview.scriptSetup?.content).not.toMatch(/localStorage|fetch\(|createApp|HostView/)
    expect(preview.template!.content).toContain('item.data?.text'); expect(preview.template!.content).toContain('item.data?.count')
    expect(preview.template!.content).toContain('item.data?.energy')
  })
  it('uses only the miniature in the overview card and keeps actual canvas pages visited with v-show', () => {
    const ast = baseParse(studio.template!.content)
    const all: any[]=[]; walk(ast,n=>all.push(n))
    const previewComponents = all.filter(n => n.type===1 && n.tag==='HomeWorkspacePreview')
    expect(previewComponents).toHaveLength(1)
    const previewNode = previewComponents[0]
    expect(studio.template!.content).toMatch(/<HomeWorkspacePreview\s+:items=\"page\.items\"/)
    expect(studio.template!.content).toContain('class="eagle-card"')
    expect(studio.template!.content).toContain('class="native-widget-slot"')
    expect(studio.template!.content).toContain('<HomeLocalWidget')
    expect(studio.template!.content).toContain('v-for="page in visitedPages" v-show="page.id === state.activeId"')
    expect(studio.scriptSetup!.content).toContain('const visitedIds = ref(new Set([state.value.activeId]))')
    expect(studio.scriptSetup!.content).toContain('const visitedPages = computed(() => state.value.pages.filter(page => visitedIds.value.has(page.id)))')
    expect(studio.template!.content).toContain(':inert="page.id !== state.activeId"')
  })
})
