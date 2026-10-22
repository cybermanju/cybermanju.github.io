// CyberManju OS — Shortcut editor helpers (src/utils/shortcutEditor.ts).
// Role: Pure, validated workflow editing helpers for the shortcuts UI.
// Exports: Workflow creation, node insertion/removal/update, action catalog, safe UI errors.
// Integrates: Automation schema and host-provided action registry metadata.
// Contracts: No runtime, persistence, policy or action registration; revision is host-owned.
import { copyJson, validateWorkflow, type ActionRegistry, type Json, type Workflow, type WorkflowNode } from '../automation'

type InsertKind = { type: 'action'; actionId: string; input: Json } | { type: 'condition' }

function freshId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
function nodeId(): string {
  let id = freshId()
  while (id === 'end' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) id = freshId()
  return id
}

/** Construct the minimal valid draft workflow. */
export function newWorkflow(): Workflow {
  return validateWorkflow({ schemaVersion: 1, id: nodeId(), revision: 1, entryNodeId: 'end', nodes: [{ id: 'end', type: 'end' }] })
}

function freshNodeId(workflow: Workflow): string {
  const ids = new Set(workflow.nodes.map(node => node.id))
  let id = nodeId()
  while (ids.has(id)) id = nodeId()
  return id
}

function createInsertedNode(id: string, targetId: string, kind: InsertKind): WorkflowNode {
  return kind.type === 'action'
    ? { id, type: 'action', actionId: kind.actionId, input: copyJson(kind.input, undefined, true), next: targetId }
    : { id, type: 'condition', predicate: { op: 'eq', left: true, right: true }, trueNext: targetId, falseNext: targetId }
}

/** Insert a new step immediately before target, preserving all existing incoming routes. */
export function insertBefore(workflow: Workflow, targetId: string, kind: InsertKind): Workflow {
  const valid = validateWorkflow(workflow)
  if (!valid.nodes.some(node => node.id === targetId)) throw new Error('invalid_workflow')
  const id = freshNodeId(valid)
  const nextNode = createInsertedNode(id, targetId, kind)
  const nodes = valid.nodes.map(node => {
    if (node.type === 'action' && node.next === targetId) return { ...node, next: id }
    if (node.type === 'condition') return {
      ...node,
      trueNext: node.trueNext === targetId ? id : node.trueNext,
      falseNext: node.falseNext === targetId ? id : node.falseNext,
    }
    return node
  })
  const entryNodeId = valid.entryNodeId === targetId ? id : valid.entryNodeId
  return validateWorkflow({ ...valid, entryNodeId, nodes: [...nodes, nextNode] })
}

/** Insert on exactly one outgoing edge; sibling branches remain untouched. */
export function insertOnEdge(workflow: Workflow, sourceId: string, edge: 'next' | 'trueNext' | 'falseNext', kind: InsertKind): Workflow {
  const valid = validateWorkflow(workflow)
  const source = valid.nodes.find(node => node.id === sourceId)
  if (!source || (source.type === 'action' && edge !== 'next') || (source.type !== 'condition' && source.type !== 'action')) {
    throw new Error('invalid_workflow')
  }
  if (source.type === 'condition' && edge === 'next') throw new Error('invalid_workflow')
  const targetId = edge === 'next'
    ? (source as Extract<WorkflowNode, { type: 'action' }>).next
    : (source as Extract<WorkflowNode, { type: 'condition' }>)[edge]
  const id = freshNodeId(valid)
  const replacement = createInsertedNode(id, targetId, kind)
  const nodes = valid.nodes.map(node => node.id !== sourceId ? node : edge === 'next'
    ? { ...(node as Extract<WorkflowNode, { type: 'action' }>), next: id }
    : { ...(node as Extract<WorkflowNode, { type: 'condition' }>), [edge]: id })
  return validateWorkflow({ ...valid, nodes: [...nodes, replacement] })
}

/** Remove a node, reconverging its incoming edges and pruning disconnected branches. */
export function removeNode(workflow: Workflow, id: string): Workflow {
  const valid = validateWorkflow(workflow)
  const removed = valid.nodes.find(node => node.id === id)
  if (!removed || removed.type === 'end') throw new Error('invalid_workflow')
  const replacement = removed.type === 'condition' ? removed.trueNext : removed.next
  const rewritten = valid.nodes.filter(node => node.id !== id).map(node => {
    if (node.type === 'action' && node.next === id) return { ...node, next: replacement }
    if (node.type === 'condition') return {
      ...node,
      trueNext: node.trueNext === id ? replacement : node.trueNext,
      falseNext: node.falseNext === id ? replacement : node.falseNext,
    }
    return node
  })
  const entryNodeId = valid.entryNodeId === id ? replacement : valid.entryNodeId
  const reachable = new Set<string>()
  const byId = new Map(rewritten.map(node => [node.id, node]))
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    const node = byId.get(nodeId)
    if (node?.type === 'action') visit(node.next)
    else if (node?.type === 'condition') { visit(node.trueNext); visit(node.falseNext) }
  }
  visit(entryNodeId)
  return validateWorkflow({ ...valid, entryNodeId, nodes: rewritten.filter(node => reachable.has(node.id)) })
}

/** Replace a draft node without changing its host-owned workflow revision. */
export function updateNode(workflow: Workflow, node: WorkflowNode): Workflow {
  const valid = validateWorkflow(workflow)
  if (!valid.nodes.some(existing => existing.id === node.id)) throw new Error('invalid_workflow')
  const detached = copyJson(node, undefined, true) as unknown as WorkflowNode
  return validateWorkflow({ ...valid, nodes: valid.nodes.map(existing => existing.id === node.id ? detached : existing) })
}

export interface ActionCatalogItem { id: string; effect: 'read' | 'write'; title: string; description: string }
const knownActions: Record<string, { title: string; description: string }> = {
  'core.script': { title: 'Transformar dados', description: 'Texto, matemática e JSON em até 32 passos declarativos. Sem JavaScript ou shell.' },
  'core.http': { title: 'Requisição HTTP', description: 'Método, URL, headers e corpo estruturados. Apenas origens HTTPS aprovadas; sujeito a CORS.' },
  'core.ai.invoke': { title: 'Consultar agente de IA', description: 'Agente nomeado pelo host, com prompt e contexto. Saída tratada como dados não confiáveis.' },
  'core.cybsh': { title: 'Comando cybsh', description: 'Comando aprovado pelo host e argumentos de dados. Sem pipes ou shell livre.' },
  'android.open_url': { title: 'Abrir URL', description: 'Encaminhar uma URL para um aplicativo compatível. Abrir não confirma a conclusão.' },
  'android.open_map': { title: 'Abrir mapa', description: 'Buscar um local ou coordenadas em um aplicativo de mapas.' },
  'android.dial': { title: 'Abrir discador', description: 'Preparar um número no discador. A ligação depende da ação do usuário.' },
  'android.share_text': { title: 'Compartilhar texto', description: 'Abrir o compartilhamento do Android; você escolhe o aplicativo e confirma o envio.' },
  'android.create_calendar_event': { title: 'Preparar evento', description: 'Encaminhar título e horários para o calendário, com revisão no aplicativo de destino.' },
}

/** Describe only actions explicitly supplied by the host registry. */
export function actionCatalog(entries: ReturnType<ActionRegistry['list']>, query = ''): ActionCatalogItem[] {
  const needle = query?.trim().toLocaleLowerCase()
  return entries.filter(entry => !needle || `${entry.id} ${knownActions[entry.id]?.title ?? entry.id} ${knownActions[entry.id]?.description ?? ''}`.toLocaleLowerCase().includes(needle))
    .map(({ id, effect }) => {
      const meta = knownActions[id]
      return { id, effect, title: meta?.title ?? id, description: meta?.description ?? `Ação registrada pelo host: ${id}. Consulte o schema fornecido por ele.` }
    })
}

/** Convert internal validation failures to fixed UI-safe text; never expose workflow/payload details. */
export function safeEditorError(_error: unknown): string {
  return 'Não foi possível atualizar o workflow. Confira os passos e as conexões.'
}
