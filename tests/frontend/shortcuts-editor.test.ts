// CyberManju OS — Shortcuts editor tests (tests/frontend/shortcuts-editor.test.ts).
// Role: Verify pure workflow editor operations and their schema/security contracts.
// Exports: Vitest coverage for workflow creation, graph editing and host action metadata.
// Integrates: Shortcut editor helpers and automation schema validation.
// Contracts: Tests assert safe validation, branch integrity, and no invented registry entries.
import { describe, expect, it } from 'vitest'
import { validateWorkflow, type Workflow } from '../../src/automation/schema'
import { ActionRegistry } from '../../src/automation/runner'
import { actionCatalog, insertBefore, insertOnEdge, newWorkflow, removeNode, safeEditorError, updateNode } from '../../src/utils/shortcutEditor'

const action = (id: string, next: string) => ({ id, type: 'action' as const, actionId: 'core.script', input: {}, next })
const branching: Workflow = {
  schemaVersion: 1, id: 'workflow', revision: 7, entryNodeId: 'gate',
  nodes: [
    { id: 'gate', type: 'condition', predicate: { op: 'eq', left: true, right: true }, trueNext: 'left', falseNext: 'right' },
    action('left', 'end'), action('right', 'end'), { id: 'end', type: 'end' },
  ],
}

describe('shortcut workflow editor', () => {
  it('creates the minimal validated draft with a valid random id', () => {
    const workflow = newWorkflow()
    expect(workflow).toMatchObject({ schemaVersion: 1, revision: 1, entryNodeId: 'end', nodes: [{ id: 'end', type: 'end' }] })
    expect(() => validateWorkflow(workflow)).not.toThrow()
    expect(workflow.id).not.toBe('end')
  })

  it('inserts before target and reroutes incoming edges and entry', () => {
    const inserted = insertBefore(branching, 'gate', { type: 'condition' })
    expect(inserted.entryNodeId).not.toBe('gate')
    expect(inserted.nodes.find(n => n.id === inserted.entryNodeId)).toMatchObject({ type: 'condition', trueNext: 'gate', falseNext: 'gate' })
    expect(inserted.revision).toBe(7)
    expect(() => validateWorkflow(inserted)).not.toThrow()
  })

  it('inserts independently on either conditional branch', () => {
    const trueEdit = insertOnEdge(branching, 'gate', 'trueNext', { type: 'action', actionId: 'core.script', input: {} })
    const falseEdit = insertOnEdge(branching, 'gate', 'falseNext', { type: 'action', actionId: 'core.script', input: {} })
    const t = trueEdit.nodes.find(n => n.id === 'gate')!
    const f = falseEdit.nodes.find(n => n.id === 'gate')!
    expect(t).toMatchObject({ trueNext: expect.not.stringMatching(/^left$/), falseNext: 'right' })
    expect(f).toMatchObject({ trueNext: 'left', falseNext: expect.not.stringMatching(/^right$/) })
    expect(() => validateWorkflow(trueEdit)).not.toThrow()
    expect(() => insertOnEdge(branching, 'left', 'trueNext', { type: 'condition' })).toThrow()
  })

  it('removes ordinary nodes, reconverges condition removal, and prunes orphan branch', () => {
    const removedAction = removeNode(branching, 'left')
    expect(removedAction.nodes.some(n => n.id === 'left')).toBe(false)
    expect(removedAction.nodes.find(n => n.id === 'gate')).toMatchObject({ trueNext: 'end', falseNext: 'right' })
    const removedGate = removeNode(branching, 'gate')
    expect(removedGate.entryNodeId).toBe('left')
    expect(removedGate.nodes.some(n => n.id === 'right')).toBe(false)
    expect(() => validateWorkflow(removedGate)).not.toThrow()
    expect(() => removeNode(branching, 'end')).toThrow()
  })

  it('rejects cycles, invalid references, plaintext credentials, and invalid secret references', () => {
    const cyclic = { ...branching, nodes: [action('loop', 'loop')] , entryNodeId: 'loop' }
    expect(() => validateWorkflow(cyclic)).toThrow('cyclic_workflow')
    expect(() => insertBefore(branching, 'missing', { type: 'condition' })).toThrow()
    expect(() => insertBefore(branching, 'end', { type: 'action', actionId: 'core.script', input: { password: 'do-not-expose' } })).toThrow('plaintext_secret')
    expect(() => insertBefore(branching, 'end', { type: 'action', actionId: 'core.script', input: { password: { secretRef: 'bad ref' } } })).toThrow()
    expect(() => insertBefore(branching, 'end', { type: 'action', actionId: 'core.script', input: { password: { secretRef: 'credential-id' } } })).not.toThrow()
  })

  it('updates a node as a validated draft without changing revision', () => {
    const edited = updateNode(branching, { ...action('left', 'end'), input: { text: 'ok' } })
    expect(edited.revision).toBe(7)
    expect(edited.nodes.find(n => n.id === 'left')).toMatchObject({ input: { text: 'ok' } })
    expect(() => updateNode(branching, { ...action('left', 'missing') })).toThrow()
  })

  it('catalogs only host-supplied actions and uses fallback metadata for unknown IDs', () => {
    const registry = new ActionRegistry()
    const execute = async () => ({ status: 'succeeded' as const, output: null })
    registry.register({ id: 'core.http', effect: 'write', validateInput: () => true, execute })
    registry.register({ id: 'host.custom', effect: 'read', validateInput: () => true, execute })
    const catalog = actionCatalog(registry.list())
    expect(catalog.map(item => item.id)).toEqual(['core.http', 'host.custom'])
    expect(catalog[0]).toMatchObject({ title: 'Requisição HTTP', effect: 'write' })
    expect(catalog[1]).toMatchObject({ title: 'host.custom', description: expect.stringContaining('host.custom') })
    expect(actionCatalog(registry.list(), 'custom')).toHaveLength(1)
    expect(actionCatalog(registry.list(), 'core.ai.invoke')).toHaveLength(0)
  })

  it('uses canonical Android IDs and describes dial as a handoff, never a completed call', () => {
    const entries = [{ id: 'android.dial', effect: 'write' as const }, { id: 'android.open_url', effect: 'write' as const }]
    expect(actionCatalog(entries)[0]).toMatchObject({ title: 'Abrir discador' })
    expect(actionCatalog(entries)[0]?.description).toContain('depende da ação do usuário')
    expect(actionCatalog(entries).map(a => a.id)).toEqual(entries.map(a => a.id))
    expect(actionCatalog([], 'Android')).toEqual([])
  })

  it('returns fixed safe UI error text without exposing payload details', () => {
    expect(safeEditorError(new Error('secret payload: token=abc'))).not.toContain('abc')
    expect(safeEditorError(new Error('anything'))).toBe(safeEditorError(new Error('different')))
  })
})
