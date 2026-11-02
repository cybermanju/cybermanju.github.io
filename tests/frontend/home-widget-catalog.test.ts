// CyberManju OS — Home widget catalog contracts.
// Role: validate readiness, panel references and accessible alternatives.
import { describe, expect, it } from 'vitest'
import { homeWidgetCatalog } from '../../src/data/homeWidgetCatalog'
import fs from 'node:fs'
describe('Home widget library', () => {
  it('has unique identifiers and only the six implemented local renderers', () => {
    expect(new Set(homeWidgetCatalog.map(w => w.id)).size).toBe(homeWidgetCatalog.length)
    expect(homeWidgetCatalog.filter(w => w.kind === 'local').map(w => w.id).sort()).toEqual(['checklist','clock','counter','focus','notes','pixel-pet'])
  })
  it('uses real panel IDs for app cards and keeps native/concept capabilities explicit', () => {
    const panels = ['files','search','agent','storage','accounts','terminal','editor','sync','map','collections','settings','trash','notes','archive']
    for (const widget of homeWidgetCatalog.filter(w => w.kind === 'app-link')) expect(panels).toContain(widget.appId)
    expect(homeWidgetCatalog.some(w => w.kind === 'native')).toBe(true)
    expect(homeWidgetCatalog.some(w => w.kind === 'concept')).toBe(true)
    const ui = fs.readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
    expect(ui).toContain('Installed Android widgets')
    expect(ui).toContain('Reference · find installed providers above')
    expect(ui).toContain('native.status.value')
    expect(ui).toContain('Concept · not connected')
    expect(ui).toContain(':disabled="!widgetReady(widget)')
    expect(ui).not.toMatch(/invoke\(/)
  })
  it('keeps accessible alternatives and reduced-motion support', () => {
    const ui = fs.readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
    for (const marker of ['aria-modal="true"','dialogKeys','<OrbNavigator','prefers-reduced-motion','Overview of home screens']) expect(ui).toContain(marker)
  })
  it('backs Notes with managed Markdown files and shares tasks between the widget and Archive', () => {
    const widget = fs.readFileSync('src/components/HomeLocalWidget.vue', 'utf8')
    const notes = fs.readFileSync('src/components/NotesApp.vue', 'utf8')
    const archive = fs.readFileSync('src/components/ArchivePanel.vue', 'utf8')
    const todos = fs.readFileSync('src/composables/useTodos.ts', 'utf8')
    expect(widget).toContain("useTodos()")
    expect(widget).toContain("write_file_content")
    expect(notes).toContain("'upload_file'")
    expect(notes).toContain("'write_file_content'")
    expect(notes).toContain('store.startSync')
    expect(notes).toContain('container itself is not a sync target')
    expect(notes).toContain('Overwrite with draft')
    expect(archive).toContain('const todos = todoState.todos')
    expect(todos).toContain("cybermanju.todos.v1")
  })
})
