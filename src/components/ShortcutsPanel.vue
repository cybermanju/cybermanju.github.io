<script setup lang="ts">
// CyberManju OS — Shortcuts app (src/components/ShortcutsPanel.vue).
// Role: Responsive action library and visual workflow draft editor.
// Exports: Props/events UI boundary; request-save and request-run require a connected host.
// Integrates: Public automation schema, registry listing and presentation-only run status.
// Contracts: No repository/runtime invented; no retries, native calls, storage or background jobs.
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { createAutomationRegistry, validateWorkflow, LIMITS, type ActionRegistry, type AcknowledgePendingRunOptions, type PendingRun, type Json, type Workflow, type WorkflowNode } from '@/automation'
import { actionCatalog, insertBefore, insertOnEdge, newWorkflow, removeNode, updateNode } from '@/utils/shortcutEditor'
import ShortcutNodeEditor from '@/components/shortcuts/ShortcutNodeEditor.vue'
import ShortcutRunStatus from '@/components/shortcuts/ShortcutRunStatus.vue'
import type { ShortcutRunResult } from '@/utils/shortcutStatus'
import { AUTHORIZATION_TIMEOUT_MS, parseAuthorizationRequest, type AuthorizationRequest, type AuthorizationDecision } from '@/utils/shortcutAuthorization'
import { identifier } from '@/automation'

// Structural UI views of host-owned records; no repository dependency in this branch.
interface WorkflowRecordView { recordVersion: 1; workflow: Workflow; name: string; updatedAt: string }
interface SaveRequest { requestId: string; name: string; expectedRevision: number | null }
interface SaveComplete { requestId: string; record: WorkflowRecordView }
type ResultContext = Pick<PendingRun, 'runId' | 'workflowId' | 'workflowRevision'>
const props = withDefaults(defineProps<{
  modelValue?: Workflow
  savedWorkflow?: Workflow
  records?: WorkflowRecordView[]
  selectedWorkflowId?: string | null
  saveComplete?: SaveComplete | null
  saveFailed?: string | null
  actions?: ReturnType<ActionRegistry['list']>
  canSave?: boolean
  canRun?: boolean
  authorizationConnected?: boolean
  authorizationRequest?: AuthorizationRequest | null
  running?: boolean
  result?: ShortcutRunResult | null
  resultContext?: ResultContext | null
  acknowledgeFailedContext?: ResultContext | null
  pendingRun?: PendingRun | null
}>(), { records: () => [], selectedWorkflowId: null, saveComplete: null, saveFailed: null, actions: () => createAutomationRegistry().list(), canSave: false, canRun: false, authorizationConnected: false, authorizationRequest: null, running: false, result: null, resultContext: null, acknowledgeFailedContext: null, pendingRun: null })
const emit = defineEmits<{
  'update:modelValue': [workflow: Workflow]
  'request-save': [workflow: Workflow, request: SaveRequest]
  'update:selectedWorkflowId': [id: string]
  'request-run': [workflow: Workflow]
  'authorization-decision': [decision: AuthorizationDecision]
  'acknowledge-result': [context: ResultContext, options?: AcknowledgePendingRunOptions]
}>()
const uid = useId()
const instance = getCurrentInstance()!
// An explicit host attestation AND an event consumer are mandatory, even for read-only runs.
function authorizationGuardConnected() {
  return props.authorizationConnected && typeof instance.vnode.props?.['onAuthorization-decision'] === 'function'
}
const draft = shallowRef<Workflow>(newWorkflow())
const confirmedSaved = shallowRef<Workflow | null>(null)
const baseRevision = ref<number | null>(null)
const workflowName = ref('')
const pendingSave = shallowRef<{ workflow: Workflow; request: SaveRequest } | null>(null)
let saveSequence = 0
const incomingWorkflow = shallowRef<Workflow | null>(null)
const selectedId = ref(draft.value.entryNodeId)
const query = ref('')
const activeView = ref<'library' | 'workflow'>('workflow')
const error = ref('')
const notice = ref('')
const hostInvalid = ref(false)
const dirty = ref(false)
const inspectorDirty = ref(false)
const resetPending = ref(false)
const removalPending = ref(false)
const reviewPending = ref(false)
const reviewWorkflow = shallowRef<Workflow | null>(null)
const requestPending = ref(false)
const runSnapshot = shallowRef<Workflow | null>(null)
type PendingAuthorization = { request: AuthorizationRequest; fingerprint: string; allow: () => void; deny: () => void }
const authorizationPending = shallowRef<PendingAuthorization | null>(null)
const authorizationState = ref('')
type ResultReview = { confirm: () => void }
const resultReview = shallowRef<ResultReview | null>(null)
const resultAcknowledged = ref(false)
const pendingAcknowledgement = shallowRef<ResultContext | null>(null)
const resultGate = ref(!!props.result || props.pendingRun != null)
const acknowledgedCorrelations = new Set<string>()
function correlationKey(value: ResultContext) { return JSON.stringify([value.runId, value.workflowId, value.workflowRevision]) }
function validResultContext(value: ResultContext | null): value is ResultContext {
  return !!value && identifier(value.runId) && identifier(value.workflowId) && Number.isSafeInteger(value.workflowRevision) && value.workflowRevision >= 1
}
// PendingRun supplies its own correlation; a separate stale host context must never override it.
const acknowledgementContext = computed<ResultContext | null>(() => {
  const pending = props.pendingRun
  if (pending != null) {
    if (!validResultContext(pending) || !['running', 'completed', 'halted', 'unknown'].includes(pending.status) ||
      !['running', 'completed', 'denied', 'interrupted', 'uncertain', 'accepted', 'needs_confirmation', 'failed'].includes(pending.code) ||
      typeof pending.startedAt !== 'string' || !Number.isFinite(Date.parse(pending.startedAt)) ||
      typeof pending.updatedAt !== 'string' || !Number.isFinite(Date.parse(pending.updatedAt))) return null
    if (props.resultContext != null && (!validResultContext(props.resultContext) || correlationKey(props.resultContext) !== correlationKey(pending))) return null
    return { runId: pending.runId, workflowId: pending.workflowId, workflowRevision: pending.workflowRevision }
  }
  return validResultContext(props.resultContext) ? props.resultContext : null
})
const pendingRunning = computed(() => props.pendingRun?.status === 'running')
const requiresUncertainAcceptance = computed(() => props.pendingRun?.status === 'unknown' ||
  props.pendingRun?.code === 'interrupted' || props.pendingRun?.code === 'uncertain')
function beginResultReview() {
  if ((!props.result && props.pendingRun == null) || !validResultContext(acknowledgementContext.value) || resultAcknowledged.value || acknowledgedCorrelations.size >= 4096 || props.running || pendingRunning.value || authorizationPending.value) return
  const fingerprint = JSON.stringify(props.result)
  const pendingFingerprint = JSON.stringify(props.pendingRun)
  const source = acknowledgementContext.value!
  const context: ResultContext = { runId: source.runId, workflowId: source.workflowId, workflowRevision: source.workflowRevision }
  const options: AcknowledgePendingRunOptions | undefined = requiresUncertainAcceptance.value ? { acceptUncertain: true } : undefined
  const contextKey = correlationKey(context)
  const contextFingerprint = JSON.stringify(props.resultContext)
  const review: ResultReview = { confirm: () => {
    if (resultReview.value !== review || resultAcknowledged.value || props.running || authorizationPending.value || JSON.stringify(props.result) !== fingerprint || JSON.stringify(props.pendingRun) !== pendingFingerprint || JSON.stringify(props.resultContext) !== contextFingerprint || acknowledgedCorrelations.has(contextKey)) return
    resultReview.value = null; resultAcknowledged.value = true
    acknowledgedCorrelations.add(contextKey)
    pendingAcknowledgement.value = context
    if (options) emit('acknowledge-result', context, options)
    else emit('acknowledge-result', context)
  } }
  resultReview.value = review
}
watch(() => [props.result, props.pendingRun, props.resultContext], () => {
  resultReview.value = null
  if (!props.result && props.pendingRun == null) {
    // Host clearing state is reconciliation only after the user's correlated ACK.
    if (resultAcknowledged.value) { resultGate.value = false; pendingAcknowledgement.value = null }
  } else {
    resultGate.value = true
    resultAcknowledged.value = validResultContext(acknowledgementContext.value) && acknowledgedCorrelations.has(correlationKey(acknowledgementContext.value))
  }
}, { deep: true, flush: 'post' })
// Only the host's exact pending-ACK failure can re-enable confirmation. Never clear run state here.
watch(() => props.acknowledgeFailedContext, failed => {
  const pending = pendingAcknowledgement.value
  const current = acknowledgementContext.value
  if (!validResultContext(failed) || !pending || !validResultContext(current) ||
    correlationKey(failed) !== correlationKey(pending) || correlationKey(current) !== correlationKey(pending)) return
  acknowledgedCorrelations.delete(correlationKey(pending))
  pendingAcknowledgement.value = null
  resultAcknowledged.value = false
  resultReview.value = null
}, { deep: true, flush: 'sync' })
const decidedRequests = new Set<string>()
let authorizationTimer: ReturnType<typeof setTimeout> | undefined
function emitDecision(requestId: string, decision: 'allow' | 'deny') {
  if (decidedRequests.has(requestId)) return
  if (decidedRequests.size < 4096) decidedRequests.add(requestId)
  else decision = 'deny'
  emit('authorization-decision', { requestId, decision })
}
function denyPendingAuthorization() {
  const pending = authorizationPending.value
  authorizationPending.value = null
  clearTimeout(authorizationTimer)
  if (pending) emitDecision(pending.request.requestId, 'deny')
}
function validAuthorization(request: AuthorizationRequest) {
  const snapshot = runSnapshot.value
  if (!authorizationGuardConnected() || !snapshot || (!requestPending.value && !props.running) || props.result || hostInvalid.value || incomingWorkflow.value || dirty.value || unapplied.value) return false
  const serialized = JSON.stringify(snapshot)
  try {
    if (!props.modelValue || !props.savedWorkflow || JSON.stringify(validateWorkflow(props.modelValue)) !== serialized || JSON.stringify(validateWorkflow(props.savedWorkflow)) !== serialized || JSON.stringify(draft.value) !== serialized) return false
  } catch { return false }
  const node = snapshot.nodes.find(node => node.id === request.nodeId)
  return snapshot.id === request.workflowId && snapshot.revision === request.workflowRevision && node?.type === 'action' && node.actionId === request.actionId && props.actions.some(action => action.id === request.actionId && action.effect === 'write')
}
function decideAuthorization(pending: PendingAuthorization, decision: 'allow' | 'deny') {
  // A stale button never approves a newer request, even if its requestId was reused.
  if (authorizationPending.value !== pending) return
  let unchanged = false
  try { unchanged = JSON.stringify(parseAuthorizationRequest(props.authorizationRequest)) === pending.fingerprint } catch { /* deny */ }
  const allowed = decision === 'allow' && unchanged && validAuthorization(pending.request)
  authorizationPending.value = null
  clearTimeout(authorizationTimer)
  authorizationState.value = allowed ? 'Permissão enviada ao host; aguardando validação e estado.' : 'Ação negada; aguardando estado do host.'
  emitDecision(pending.request.requestId, allowed ? 'allow' : 'deny')
}
onBeforeUnmount(denyPendingAuthorization)
const jsonOpen = ref(false)
const jsonText = ref('')
const jsonDirty = ref(false)
const insertion = ref('before')
const selectedButton = ref<HTMLElement | null>(null)
const inspectorVersion = ref(0)
const catalog = computed(() => actionCatalog(props.actions, query.value))
const allCatalog = computed(() => actionCatalog(props.actions))
const available = computed(() => new Set(props.actions.map(a => a.id)))
const unsupported = computed(() => draft.value.nodes.filter(n => n.type === 'action' && !available.value.has(n.actionId)))
const actionCount = computed(() => draft.value.nodes.filter(n => n.type === 'action').length)
const reviewActionCount = computed(() => reviewWorkflow.value?.nodes.filter(n => n.type === 'action').length ?? 0)
const reviewWriteCount = computed(() => reviewWorkflow.value?.nodes.filter(n => n.type === 'action' && props.actions.some(a => a.id === n.actionId && a.effect === 'write')).length ?? 0)
const selected = computed(() => draft.value.nodes.find(n => n.id === selectedId.value) ?? draft.value.nodes[0]!)
const busy = computed(() => props.running || requestPending.value)
const unresolved = computed(() => props.result?.status === 'halted' && ['accepted', 'needs_confirmation', 'unknown'].includes(props.result.result.status))
const locked = computed(() => busy.value || reviewPending.value || unresolved.value || !!props.authorizationRequest || !!resultReview.value)
const unapplied = computed(() => inspectorDirty.value || jsonDirty.value)
const displayedNodes = computed(() => {
  const nodes = new Map(draft.value.nodes.map(node => [node.id, node]))
  const incoming = new Map(draft.value.nodes.map(node => [node.id, 0]))
  const edges = (node: WorkflowNode): string[] => node.type === 'action' ? [node.next] : node.type === 'condition' ? [node.trueNext, node.falseNext] : []
  for (const node of nodes.values()) for (const target of edges(node)) incoming.set(target, incoming.get(target)! + 1)
  const queue = [draft.value.entryNodeId], ordered: WorkflowNode[] = []
  while (queue.length) {
    const node = nodes.get(queue.shift()!)!; ordered.push(node)
    for (const target of edges(node)) { const count = incoming.get(target)! - 1; incoming.set(target, count); if (count === 0) queue.push(target) }
  }
  return ordered
})
// modelValue is a draft echo, not proof of persistence. Only the host's saved snapshot is authoritative.
const savedSnapshot = computed(() => {
  try { return confirmedSaved.value ? validateWorkflow(confirmedSaved.value) : null }
  catch { return null }
})
const matchesSaved = computed(() => !!savedSnapshot.value && JSON.stringify(draft.value) === JSON.stringify(savedSnapshot.value))
const canRequestRun = computed(() => props.canRun && authorizationGuardConnected() && !props.authorizationRequest && !pendingSave.value && !dirty.value && matchesSaved.value && !busy.value && !hostInvalid.value && !incomingWorkflow.value && !props.result && !resultGate.value && props.pendingRun == null && !unapplied.value && unsupported.value.length === 0 && actionCount.value > 0)
const canRequestSave = computed(() => props.canSave && !!workflowName.value.trim() && !pendingSave.value && !locked.value && !hostInvalid.value && !incomingWorkflow.value && !unapplied.value)
function loadIncoming(valid: Workflow) {
  draft.value = valid; selectedId.value = valid.entryNodeId
  baseRevision.value = [props.savedWorkflow, confirmedSaved.value].some(saved => saved && JSON.stringify(validateWorkflow(saved)) === JSON.stringify(valid)) ? valid.revision : null
  workflowName.value = props.records.find(record => record.workflow.id === valid.id)?.name ?? ''
  hostInvalid.value = false; dirty.value = false; inspectorDirty.value = false
  jsonDirty.value = false; jsonText.value = JSON.stringify(valid, null, 2); error.value = ''
  incomingWorkflow.value = null; inspectorVersion.value++
}
watch(() => props.modelValue, value => {
  if (!value) return
  try {
    const valid = validateWorkflow(value)
    if (JSON.stringify(valid) === JSON.stringify(draft.value)) { hostInvalid.value = false; return }
    if (dirty.value || inspectorDirty.value || jsonDirty.value || locked.value) { incomingWorkflow.value = valid; return }
    loadIncoming(valid)
  } catch { hostInvalid.value = true; error.value = 'O workflow recebido é inválido. Solicite uma versão válida ao host antes de salvar ou executar.' }
}, { immediate: true, deep: true })
watch(() => props.savedWorkflow, value => {
  try { confirmedSaved.value = value ? validateWorkflow(value) : null }
  catch { confirmedSaved.value = null }
  // Save ACKs, not draft echoes or arbitrary saved-prop changes, clear local dirty state.
}, { immediate: true, deep: true, flush: 'sync' })
watch(() => props.saveComplete, ack => {
  const pending = pendingSave.value
  if (!ack || !pending || ack.requestId !== pending.request.requestId) return
  try {
    const saved = validateWorkflow(ack.record.workflow)
    const expected = validateWorkflow({ ...pending.workflow, revision: pending.request.expectedRevision === null ? 1 : pending.request.expectedRevision + 1 })
    if (JSON.stringify(saved) !== JSON.stringify(expected) || ack.record.name !== pending.request.name || ack.record.recordVersion !== 1) throw new Error('save_ack_mismatch')
    pendingSave.value = null
    confirmedSaved.value = saved
    const remoteConflict = incomingWorkflow.value && JSON.stringify(incomingWorkflow.value) !== JSON.stringify(saved)
    if (remoteConflict || JSON.stringify(draft.value) !== JSON.stringify(pending.workflow) || workflowName.value.trim() !== pending.request.name || unapplied.value || busy.value || unresolved.value) {
      if (!remoteConflict) incomingWorkflow.value = saved
      notice.value = 'Salvamento confirmado para o snapshot enviado; edições posteriores foram preservadas e precisam de reconciliação.'
      return
    }
    loadIncoming(saved)
    baseRevision.value = saved.revision
    workflowName.value = ack.record.name
    notice.value = 'Salvamento confirmado pelo host para o snapshot solicitado.'
    emit('update:modelValue', validateWorkflow(saved))
  } catch { error.value = 'Confirmação de salvamento não corresponde ao snapshot solicitado. Rascunho preservado.' }
}, { deep: true })
watch(() => props.saveFailed, requestId => {
  if (requestId && pendingSave.value?.request.requestId === requestId) {
    pendingSave.value = null
    error.value = 'O host recusou o salvamento. Rascunho preservado; reconcilie a revisão antes de tentar novamente.'
  }
})
watch(draft, () => { reviewPending.value = false; reviewWorkflow.value = null })
watch(canRequestRun, allowed => { if (!allowed) { reviewPending.value = false; reviewWorkflow.value = null } })
watch(() => props.result, value => { if (value) { requestPending.value = false; reviewPending.value = false } })
watch(selectedId, () => { insertion.value = 'before'; inspectorDirty.value = false; removalPending.value = false })
// Flush synchronously: prop changes invalidate authorization before any captured click can run.
watch(() => [props.authorizationRequest, props.authorizationConnected, props.running, props.result, props.modelValue, props.savedWorkflow, props.actions], () => {
  const previous = authorizationPending.value
  let request: AuthorizationRequest | null = null
  try { if (props.authorizationRequest) request = parseAuthorizationRequest(props.authorizationRequest) } catch { /* never display malformed payloads */ }
  if (previous && request && JSON.stringify(request) === previous.fingerprint && validAuthorization(request)) return
  denyPendingAuthorization()
  if (!props.authorizationRequest) { authorizationState.value = ''; return }
  if (!request || decidedRequests.has(request.requestId) || decidedRequests.size >= 4096 || !validAuthorization(request)) {
    authorizationState.value = 'Pedido de autorização recusado. O host deve reconciliar a execução.'
    const id = props.authorizationRequest?.requestId
    if (identifier(id)) emitDecision(id, 'deny')
    return
  }
  const pending: PendingAuthorization = { request, fingerprint: JSON.stringify(request), allow: () => decideAuthorization(pending, 'allow'), deny: () => decideAuthorization(pending, 'deny') }
  authorizationPending.value = pending
  authorizationState.value = 'Aguardando sua decisão explícita para esta ação.'
  authorizationTimer = setTimeout(() => { if (authorizationPending.value === pending) { denyPendingAuthorization(); authorizationState.value = 'Autorização expirada; ação negada.' } }, AUTHORIZATION_TIMEOUT_MS)
}, { deep: true, flush: 'sync', immediate: true })

function label(node: WorkflowNode) {
  return node.type === 'end' ? 'Fim' : node.type === 'condition' ? 'Se / Senão' : allCatalog.value.find(a => a.id === node.actionId)?.title ?? node.actionId
}
function fail() { error.value = 'Alteração recusada: confira os valores, referências e conexões. Não são aceitos ciclos, nós órfãos ou credenciais inline.' }
function commit(workflow: Workflow) {
  if (locked.value || hostInvalid.value) return
  draft.value = validateWorkflow(workflow); dirty.value = true; error.value = ''; notice.value = 'Rascunho atualizado nesta janela. Ainda não foi salvo.'
  jsonText.value = JSON.stringify(draft.value, null, 2); jsonDirty.value = false
  emit('update:modelValue', validateWorkflow(draft.value))
}
function canChangeSelection() {
  if (!unapplied.value) return true
  error.value = 'Aplique a configuração ou descarte a edição pendente antes de selecionar outro nó.'; return false
}
function selectNode(id: string) { if (!locked.value && canChangeSelection()) { selectedId.value = id; insertion.value = 'before' } }
function keepLocal() {
  if (locked.value) return
  incomingWorkflow.value = null
  emit('update:modelValue', validateWorkflow(draft.value))
  notice.value = 'Rascunho local preservado. O host deve reconciliar a revisão antes de persistir ou executar.'
}
function acceptIncoming() {
  if (locked.value || !incomingWorkflow.value) return
  loadIncoming(incomingWorkflow.value)
  notice.value = 'Versão do host carregada por sua escolha; alterações locais anteriores foram descartadas.'
}
async function add(kind: { type: 'action'; actionId: string; input: Json } | { type: 'condition' }) {
  if (locked.value || !canChangeSelection()) return
  if (kind.type === 'action' && !available.value.has(kind.actionId)) return
  try {
    const before = new Set(draft.value.nodes.map(n => n.id))
    const next = insertion.value === 'before' ? insertBefore(draft.value, selected.value.id, kind) : insertOnEdge(draft.value, selected.value.id, insertion.value as 'next' | 'trueNext' | 'falseNext', kind)
    commit(next)
    selectedId.value = next.nodes.find(n => !before.has(n.id))?.id ?? selectedId.value
    activeView.value = 'workflow'; await nextTick(); selectedButton.value?.focus()
  } catch { fail() }
}
function addAction(id: string) {
  const input: Json = id === 'core.script' ? { steps: [{ id: 'text', op: 'text.upper', args: ['Olá, mundo'] }] } : {}
  void add({ type: 'action', actionId: id, input })
}
function applyNode(node: WorkflowNode) {
  if (locked.value) return
  try { commit(updateNode(draft.value, node)); inspectorDirty.value = false }
  catch { fail() }
}
function discardFields() {
  if (locked.value) return
  inspectorDirty.value = false; jsonDirty.value = false
  // A fresh detached node remounts the inspector and discards only unapplied field edits.
  inspectorVersion.value++; jsonText.value = JSON.stringify(draft.value, null, 2); error.value = ''
}
function removeSelected() {
  if (locked.value || !canChangeSelection() || selected.value.type === 'end') return
  try { const next = removeNode(draft.value, selected.value.id); commit(next); selectedId.value = next.entryNodeId }
  catch { fail() }
  finally { removalPending.value = false }
}
function changeEdge(node: WorkflowNode, edge: 'next' | 'trueNext' | 'falseNext', event: Event) {
  if (locked.value || !canChangeSelection()) return
  try { commit(updateNode(draft.value, { ...node, [edge]: (event.target as HTMLSelectElement).value } as WorkflowNode)) }
  catch { fail(); (event.target as HTMLSelectElement).value = String((node as unknown as Record<string, unknown>)[edge]) }
}
function reset() {
  if (locked.value || pendingSave.value) return
  draft.value = newWorkflow(); selectedId.value = draft.value.entryNodeId
  incomingWorkflow.value = null; baseRevision.value = null; workflowName.value = ''; pendingSave.value = null
  dirty.value = false; inspectorDirty.value = false; jsonDirty.value = false; error.value = ''; resetPending.value = false
  jsonText.value = JSON.stringify(draft.value, null, 2); notice.value = 'Novo rascunho. Nada foi salvo.'
  emit('update:modelValue', validateWorkflow(draft.value))
}
function applyJson() {
  if (locked.value || inspectorDirty.value) return
  try {
    if (jsonText.value.length > LIMITS.jsonBytes) throw new Error('too_large')
    const next = validateWorkflow(JSON.parse(jsonText.value)); commit(next); selectedId.value = next.entryNodeId
  } catch { fail() }
}
function toggleJson() {
  if (!jsonOpen.value) jsonText.value = JSON.stringify(draft.value, null, 2)
  jsonOpen.value = !jsonOpen.value
}
function selectWorkflow(event: Event) {
  const select = event.target as HTMLSelectElement
  if (!locked.value && !dirty.value && !unapplied.value && !pendingSave.value && props.records.some(record => record.workflow.id === select.value)) emit('update:selectedWorkflowId', select.value)
  select.value = props.selectedWorkflowId ?? ''
}
function renameWorkflow() {
  if (!locked.value) dirty.value = true
}
function requestSave() {
  if (!canRequestSave.value) return
  const workflow = validateWorkflow(draft.value)
  const request: SaveRequest = { requestId: `${uid}-save-${++saveSequence}`, name: workflowName.value.trim(), expectedRevision: baseRevision.value }
  pendingSave.value = { workflow, request }
  emit('request-save', validateWorkflow(workflow), { ...request }); notice.value = 'Salvamento solicitado ao host. Aguarde a confirmação dele; o editor não persiste dados.'
}
function beginReview() {
  if (!authorizationGuardConnected() || !canRequestRun.value) return
  reviewWorkflow.value = validateWorkflow(savedSnapshot.value)
  reviewPending.value = true
}
function requestRun() {
  if (!authorizationGuardConnected() || !canRequestRun.value || dirty.value || !matchesSaved.value || !reviewPending.value || !reviewWorkflow.value) return
  if (JSON.stringify(reviewWorkflow.value) !== JSON.stringify(draft.value)) return
  runSnapshot.value = validateWorkflow(reviewWorkflow.value)
  requestPending.value = true; reviewPending.value = false
  emit('request-run', validateWorkflow(reviewWorkflow.value)); notice.value = 'Execução solicitada. Aguardando estado do host; não envie novamente.'
}
</script>

<template>
  <section class="shortcuts-shell" aria-label="Shortcuts — editor de ações" :aria-busy="busy" data-shell-gesture-exclude>
    <div class="shortcuts-app">
      <header class="shortcuts-header">
        <div class="app-heading"><span class="shortcuts-mark" aria-hidden="true">⌘</span><div><p class="eyebrow">CYBERMANJU · AÇÕES CONECTADAS</p><h1>Shortcuts</h1><p>Pequenas ações. Fluxos que fazem sentido.</p></div></div>
        <button type="button" :disabled="locked || !!pendingSave" @click="resetPending = true">Novo atalho</button>
      </header>
      <aside v-if="!canRun || !canSave || !authorizationGuardConnected()" class="connection-note" aria-label="Conexão com o host">
        <strong>Editor disponível · conexão com o host pendente</strong>
        <p>O rascunho vive só nesta janela. {{ !canSave ? 'Salvar ainda não está conectado.' : '' }} {{ !canRun ? 'Executar ainda não está conectado.' : '' }} {{ !authorizationGuardConnected() ? 'Guard de autorização por ação ainda não está conectado.' : '' }} Sem agendamento ou execução em segundo plano.</p>
      </aside>
      <div v-if="incomingWorkflow" class="inline-confirm" role="group" :aria-labelledby="`${uid}-conflict`"><h3 :id="`${uid}-conflict`">Nova versão recebida do host</h3><p role="status">Suas alterações locais foram preservadas. Resolva o conflito antes de salvar ou executar. Versão recebida: {{ incomingWorkflow.id }} · v{{ incomingWorkflow.revision }}.</p><button type="button" :disabled="locked" @click="keepLocal">Manter rascunho local</button><button type="button" :disabled="locked" @click="acceptIncoming">Carregar versão do host e descartar rascunho local</button></div>
      <div v-if="resetPending" class="inline-confirm" role="group" aria-label="Confirmar novo rascunho">
        <p>Criar um novo atalho descarta o rascunho e as configurações não aplicadas desta janela.</p>
        <button type="button" :disabled="locked" @click="resetPending = false">Manter rascunho</button><button type="button" :disabled="locked || !!pendingSave" @click="reset">Descartar e criar</button>
      </div>
      <div class="record-controls">
        <label :for="`${uid}-records`">Atalhos salvos</label>
        <select :id="`${uid}-records`" :value="selectedWorkflowId ?? ''" :disabled="locked || dirty || unapplied || !!pendingSave" @change="selectWorkflow"><option value="" disabled>Selecione um atalho salvo</option><option v-for="record in records" :key="record.workflow.id" :value="record.workflow.id">{{ record.name }} · v{{ record.workflow.revision }}</option></select>
        <label :for="`${uid}-name`">Nome do atalho</label>
        <input :id="`${uid}-name`" v-model="workflowName" :disabled="locked" maxlength="160" autocomplete="off" placeholder="Dê um nome ao atalho para salvar" @input="renameWorkflow" />
        <p v-if="dirty || unapplied" class="subtle">Salve ou descarte o rascunho antes de selecionar outro atalho.</p>
      </div>
      <div class="mobile-switch" aria-label="Área do editor"><button type="button" :aria-pressed="activeView === 'workflow'" @click="activeView = 'workflow'">Workflow · {{ actionCount }}</button><button type="button" :aria-pressed="activeView === 'library'" @click="activeView = 'library'">Biblioteca · {{ actions.length }}</button></div>
      <div class="shortcuts-layout" :class="`view-${activeView}`">
        <aside class="action-library" :aria-labelledby="`${uid}-library`">
          <p class="eyebrow">CONSTRUA COM BLOCOS</p><h2 :id="`${uid}-library`">Biblioteca de ações</h2>
          <label :for="`${uid}-search`">Buscar nas ações registradas</label>
          <input :id="`${uid}-search`" v-model="query" type="search" placeholder="Texto, HTTP, agente…" autocomplete="off" />
          <p class="subtle">{{ actions.length }} {{ actions.length === 1 ? 'ação registrada' : 'ações registradas' }} neste host. Nenhuma integração é ativada pelo editor.</p>
          <ul class="catalog-list">
            <li v-for="action in catalog" :key="action.id" class="catalog-card">
              <div class="catalog-title"><strong>{{ action.title }}</strong><span class="effect-badge">{{ action.effect === 'write' ? 'Efeito externo' : 'Leitura' }}</span></div>
              <p>{{ action.description }}</p><code>{{ action.id }}</code>
              <button type="button" :disabled="locked || unapplied || hostInvalid || draft.nodes.length >= LIMITS.nodes" :aria-label="`Adicionar ${action.title}`" @click="addAction(action.id)">+ Adicionar ação</button>
            </li>
          </ul>
          <p v-if="!catalog.length" class="empty-library">Nenhuma ação encontrada. O host precisa registrar explicitamente cada integração.</p>
          <div class="logic-card"><strong>Controle de fluxo</strong><p>Divida o caminho em verdadeiro e falso, com predicados declarativos.</p><button type="button" :disabled="locked || unapplied || hostInvalid || draft.nodes.length >= LIMITS.nodes" @click="add({ type: 'condition' })">+ Se / Senão</button></div>
          <details class="library-help"><summary>Integrações e permissões</summary><p>HTTP, cybsh, agentes e ações Android só aparecem quando o host entrega seus adapters e os registra. Ações externas exigem autorização do host; uma intenção pública pode abrir outro app, sem provar que a tarefa foi concluída.</p><p>Não há controle genérico de todos os apps ou APIs. HTTP usa uma lista explícita de origens HTTPS; cybsh aceita comandos aprovados, não shell livre.</p></details>
        </aside>
        <main class="workflow-area" :aria-labelledby="`${uid}-workflow`">
          <div class="workflow-heading"><div><p class="eyebrow">SEU RASCUNHO</p><h2 :id="`${uid}-workflow`">Workflow visual</h2></div><span class="draft-badge">{{ dirty ? 'Não salvo' : 'Rascunho' }} · v{{ draft.revision }}</span></div>
          <p class="subtle workflow-id"><strong>ID:</strong> {{ draft.id }} · {{ draft.nodes.length }}/{{ LIMITS.nodes }} nós</p>
          <p class="subtle">Cada cartão mostra seu destino. Selecione um nó para configurar ou inserir uma ação antes dele; selecione um ramo para criar caminhos diferentes.</p>
          <div class="insert-controls"><label :for="`${uid}-insert`">Adicionar a partir de <strong>{{ selected.id }}</strong></label><select :id="`${uid}-insert`" v-model="insertion" :disabled="locked || unapplied"><option value="before">Antes deste nó</option><option v-if="selected.type === 'action'" value="next">Depois desta ação</option><template v-if="selected.type === 'condition'"><option value="trueNext">No ramo verdadeiro</option><option value="falseNext">No ramo falso</option></template></select><button class="mobile-library-button" type="button" @click="activeView = 'library'">Escolher ação</button></div>
          <p v-if="unsupported.length" role="alert" class="form-error">Há ações não registradas neste host. A execução está bloqueada; edite ou remova os nós indisponíveis.</p>
          <ol class="workflow-nodes" aria-label="Nós e destinos do workflow">
            <li v-for="node in displayedNodes" :key="node.id" class="workflow-node" :class="{ selected: node.id === selectedId, condition: node.type === 'condition', unavailable: node.type === 'action' && !available.has(node.actionId) }">
              <div class="node-heading"><button :ref="el => { if (node.id === selectedId) selectedButton = el as HTMLElement }" type="button" class="node-select" :aria-pressed="node.id === selectedId" :disabled="locked" @click="selectNode(node.id)"><span class="node-symbol" aria-hidden="true">{{ node.type === 'condition' ? '⑂' : node.type === 'end' ? '■' : '◆' }}</span><span><strong>{{ label(node) }}</strong><small>{{ node.id }}{{ node.id === draft.entryNodeId ? ' · início' : '' }}</small></span></button><span v-if="node.type === 'action' && !available.has(node.actionId)" class="effect-badge">Indisponível</span></div>
              <div v-if="node.type === 'condition'" class="branch-summary"><span>Se verdadeiro → <strong>{{ node.trueNext }}</strong></span><span>Senão → <strong>{{ node.falseNext }}</strong></span></div>
              <p v-else-if="node.type === 'action'" class="node-route">Próximo → {{ node.next }} <span v-if="actions.some(a => a.id === node.actionId && a.effect === 'write')">· autorização necessária</span></p>
              <p v-else class="node-route">Encerra este caminho.</p>
              <template v-if="node.id === selectedId && node.type !== 'end'">
                <ShortcutNodeEditor :key="`${node.id}-${inspectorVersion}`" :node="node" :disabled="locked || hostInvalid" @apply="applyNode" @dirty="inspectorDirty = $event" />
                <div class="edge-editor">
                  <template v-for="edge in node.type === 'action' ? ['next'] as const : ['trueNext', 'falseNext'] as const" :key="edge">
                    <label :for="`${uid}-${node.id}-${edge}`">{{ edge === 'next' ? 'Próximo nó' : edge === 'trueNext' ? 'Destino verdadeiro' : 'Destino falso' }}</label>
                    <select :id="`${uid}-${node.id}-${edge}`" :value="(node as unknown as Record<string, string>)[edge]" :disabled="locked || unapplied || hostInvalid" @change="changeEdge(node, edge, $event)"><option v-for="target in draft.nodes.filter(n => n.id !== node.id)" :key="target.id" :value="target.id">{{ target.id }} · {{ label(target) }}</option></select>
                  </template>
                </div>
                <button type="button" class="remove-node" :disabled="locked || unapplied || hostInvalid" @click="removalPending = true">Remover nó…</button>
                <div v-if="removalPending" class="inline-confirm" role="group" aria-label="Confirmar remoção de nó"><p>{{ node.type === 'condition' ? 'A remoção preserva o caminho verdadeiro e descarta os nós exclusivos do ramo falso. Referências inválidas impedem a alteração.' : 'A remoção reconecta os caminhos ao próximo nó. Se houver referências a esta saída, a alteração será recusada.' }}</p><button type="button" :disabled="locked" @click="removalPending = false">Manter nó</button><button type="button" :disabled="locked" @click="removeSelected">Confirmar remoção</button></div>
              </template>
            </li>
          </ol>
          <p v-if="actionCount === 0" class="start-hint">Comece pela biblioteca: adicione uma transformação de texto ou uma condição. Nada será executado enquanto você edita.</p>
          <div v-if="unapplied" class="pending-note"><p>Há configurações não aplicadas. Aplique-as antes de salvar, executar ou mudar de nó.</p><button type="button" :disabled="locked" @click="discardFields">Descartar edição pendente</button></div>
          <p class="form-error" role="alert">{{ error }}</p><p class="editor-notice" role="status" aria-live="polite">{{ notice }}</p>
          <p v-if="canRun && (dirty || !matchesSaved)" class="editor-notice" role="status">Salve o rascunho e aguarde o snapshot salvo do host antes de revisar e executar.</p>
          <div class="workflow-toolbar"><button type="button" :disabled="!canRequestSave" :title="!canSave ? 'Service de salvamento ainda não conectado' : 'Solicitar salvamento ao host'" @click="requestSave">Solicitar salvamento</button><button type="button" class="primary" :disabled="!canRequestRun || reviewPending" :title="!canRun ? 'Runtime ainda não conectado' : result ? 'O host precisa reconciliar o resultado antes de outra execução' : 'Revisar antes de solicitar execução'" @click="beginReview">Revisar e executar</button></div>
          <div v-if="reviewPending && reviewWorkflow" class="inline-confirm run-review" role="group" :aria-labelledby="`${uid}-review`">
            <h3 :id="`${uid}-review`">Revisar execução</h3>
            <p class="workflow-id"><strong>Workflow ID:</strong> <code>{{ reviewWorkflow.id }}</code> · <strong>Revisão:</strong> {{ reviewWorkflow.revision }}</p>
            <p>{{ reviewActionCount }} ações no grafo, {{ reviewWriteCount }} com possível efeito externo. Só o caminho escolhido pelas condições será percorrido. Permissões e validação de entradas pertencem ao host.</p>
            <p>Confira cada actionId e o input JSON exato do snapshot enviado ao host. Referências de segredo permanecem referências; valores secretos não são resolvidos aqui. Bindings de saída serão resolvidos e revalidados pelo host antes da autorização de cada ação.</p>
            <ol class="review-actions" aria-label="Ações e inputs JSON enviados ao host">
              <template v-for="node in reviewWorkflow.nodes" :key="node.id">
                <li v-if="node.type === 'action'"><p><strong>Nó:</strong> <code>{{ node.id }}</code> · <strong>actionId:</strong> <code>{{ node.actionId }}</code> <span v-if="actions.some(action => action.id === node.actionId && action.effect === 'write')" class="effect-badge">Efeito externo · autorização no host</span></p><pre class="review-input">{{ JSON.stringify(node.input, null, 2) }}</pre></li>
              </template>
            </ol>
            <p>Esta revisão não autoriza ações. O host vincula cada autorização ao conteúdo e à revisão confirmados e revalida antes do dispatch.</p>
            <p>Uma ação aceita não significa concluída. Confirmação pendente ou resultado incerto interrompem o fluxo, sem retomada ou repetição automática.</p>
            <button type="button" @click="reviewPending = false">Voltar à edição</button><button type="button" :disabled="!canRequestRun" @click="requestRun">Enviar solicitação ao host</button>
          </div>
          <p v-if="unresolved" class="editor-notice">Rascunho bloqueado até o host reconciliar a ação pendente. Não há retomada ou repetição por aqui.</p>
          <p v-if="requestPending && !running" class="editor-notice" role="status">Solicitação enviada; aguardando o host informar o estado. A execução ainda não foi confirmada.</p>
          <section v-for="pending in authorizationPending ? [authorizationPending] : []" :key="pending.request.requestId" class="inline-confirm action-authorization" role="group" :aria-labelledby="`${uid}-authorization`">
            <h3 :id="`${uid}-authorization`">Autorizar esta ação?</h3>
            <p>Workflow: <code>{{ pending.request.workflowId }}</code> · revisão {{ pending.request.workflowRevision }}</p>
            <p>Nó: <code>{{ pending.request.nodeId }}</code> · actionId: <code>{{ pending.request.actionId }}</code></p>
            <p>Confira o input JSON exato após os bindings resolvidos. Secret refs permanecem referências. Esta permissão vale só para esta ação; o host valida o vínculo com a execução antes do dispatch. Sem decisão em até 60 segundos, a ação é negada.</p>
            <pre class="review-input">{{ JSON.stringify(pending.request.input, null, 2) }}</pre>
            <button type="button" @click="pending.deny">Negar ação</button><button type="button" @click="pending.allow">Permitir ação</button>
          </section>
          <p v-if="authorizationState" role="status" aria-live="polite">{{ authorizationState }}</p>
          <ShortcutRunStatus :running="running" :result="result" />
          <div v-if="result || pendingRun != null || resultGate" class="result-acknowledgement">
            <p v-if="pendingRun != null" role="status">Execução pendente restaurada pelo host. Nenhum payload ou log da pendência é exibido.</p>
            <p v-if="pendingRunning" role="status">Execução ainda em andamento. Aguarde o host reconciliar o estado antes de reconhecer.</p>
            <p v-if="requiresUncertainAcceptance" role="status">A execução foi interrompida ou seu resultado é incerto; repetir pode duplicar o efeito. A confirmação aceita explicitamente essa incerteza.</p>
            <p>Outra execução continua bloqueada até sua confirmação explícita e a reconciliação do host. Trocar de atalho ou fechar a janela não dispensa este resultado.</p>
            <p v-if="unresolved">Não há conclusão certa. Uma ação aceita ou pendente pode ainda produzir efeito; repetir pode duplicá-lo. Reconhecer este aviso não conclui nem repete a ação.</p>
            <p v-if="!validResultContext(acknowledgementContext)" role="status">O host precisa fornecer a correlação da execução para confirmar este resultado.</p>
            <button type="button" :disabled="(!result && pendingRun == null) || !validResultContext(acknowledgementContext) || resultAcknowledged || acknowledgedCorrelations.size >= 4096 || running || pendingRunning || !!authorizationPending || !!resultReview" @click="beginResultReview">{{ result?.status === 'completed' ? 'Dispensar resultado concluído' : 'Revisar reconhecimento do resultado' }}</button>
            <div v-for="review in resultReview ? [resultReview] : []" :key="'result-review'" class="inline-confirm" role="group" aria-label="Confirmar reconhecimento do resultado">
              <p>{{ unresolved || requiresUncertainAcceptance ? 'Entendo que não há conclusão certa e que repetir pode duplicar o efeito. Solicitar somente reconciliação ao host?' : 'Dispensar a apresentação deste resultado e solicitar reconciliação ao host? Isso não executa nada.' }}</p>
              <button type="button" @click="resultReview = null">Manter resultado</button><button type="button" @click="review.confirm">Confirmar reconhecimento</button>
            </div>
            <p v-if="resultAcknowledged" role="status">Reconhecimento enviado. Aguardando o host reconciliar e limpar explicitamente o resultado.</p>
          </div>
          <div class="json-section"><button type="button" :aria-expanded="jsonOpen" :aria-controls="`${uid}-workflow-json`" @click="toggleJson">{{ jsonOpen ? 'Fechar' : 'Abrir' }} JSON do workflow</button><div v-if="jsonOpen" :id="`${uid}-workflow-json`"><label :for="`${uid}-raw`">Edição avançada · schema v1</label><textarea :id="`${uid}-raw`" v-model="jsonText" :disabled="locked || inspectorDirty || hostInvalid" :maxlength="LIMITS.jsonBytes" rows="12" spellcheck="false" autocapitalize="off" autocomplete="off" @input="jsonDirty = true" /><p class="subtle">Validação estrutural do core: rejeita ciclos, referências inválidas e credenciais inline. A validade de entradas e as permissões de cada ação são verificadas pelo host, não pela lista de ações.</p><button type="button" :disabled="locked || !jsonDirty || inspectorDirty || hostInvalid" @click="applyJson">Validar e aplicar JSON</button></div></div>
        </main>
      </div>
    </div>
  </section>
</template>

<style scoped>
.shortcuts-shell { container-type: inline-size; height: 100%; overflow: auto; background: var(--ui-bg, #12151c); color: var(--ui-text, #f1f3fa); }
.shortcuts-app { padding: clamp(12px, 2.5cqi, 26px); max-width: 1280px; margin: 0 auto; font-size: 14px; line-height: 1.5; }
.shortcuts-header, .app-heading, .workflow-heading, .catalog-title, .node-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.shortcuts-header { flex-wrap: wrap; padding-bottom: 20px; }
.app-heading { justify-content: flex-start; }
.shortcuts-mark { display: grid; place-items: center; width: 48px; height: 48px; flex-shrink: 0; border-radius: 15px; background: var(--ui-accent, #4468d5); color: var(--ui-on-accent, #fff); font-size: 30px; }
h1 { font-size: clamp(24px, 4cqi, 32px); line-height: 1.2; letter-spacing: -.035em; margin: 3px 0 5px; } h2 { font-size: 19px; margin: 3px 0 12px; letter-spacing: -.02em; } h3 { font-size: 16px; }
.eyebrow { color: var(--ui-text-2, #c2cad8); font-size: 10px; font-weight: 700; letter-spacing: .12em; }
.app-heading p:last-child, .subtle, .catalog-card p, .logic-card p, .library-help { color: var(--ui-text-2, #c2cad8); font-size: 12px; line-height: 1.6; }
.connection-note { border: 1px solid var(--ui-border, #454c5c); border-left: 3px solid var(--ui-accent, #9fb4ff); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; background: var(--ui-surface-2, #1e2431); font-size: 12px; }
.connection-note strong { display: block; margin-bottom: 4px; font-size: 13px; }
.shortcuts-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.action-library, .workflow-area { min-width: 0; }
.action-library { display: none; }
.view-library .action-library { display: block; }.view-library .workflow-area { display: none; }
.mobile-switch { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.mobile-switch button[aria-pressed=true] { border-color: var(--ui-accent, #9fb4ff); background: var(--ui-surface-2, #242f49); }
input, select, textarea { min-width: 0; max-width: 100%; width: 100%; padding: 10px; border: 1px solid var(--ui-border, #606979); border-radius: 9px; background: var(--ui-bg, #141822); color: inherit; font: inherit; }
label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
button { font: inherit; line-height: 1.4; color: inherit; background: var(--ui-surface-2, #242b3a); border: 1px solid var(--ui-border, #606979); border-radius: 9px; padding: 10px 13px; min-height: 44px; cursor: pointer; overflow-wrap: anywhere; }
button:disabled { opacity: .5; cursor: not-allowed; } button:not(:disabled):hover { border-color: var(--ui-accent, #9fb4ff); }
:where(button, input, select, textarea, summary):focus-visible { outline: 3px solid var(--ui-accent, #9fb4ff); outline-offset: 3px; }
.catalog-list, .workflow-nodes { list-style: none; margin: 14px 0; padding: 0; display: grid; gap: 12px; }
.catalog-card, .logic-card { background: var(--ui-surface-2, #1c2230); border: 1px solid var(--ui-border, #454c5c); border-radius: 14px; padding: 14px; }
.catalog-title { align-items: flex-start; flex-wrap: wrap; margin-bottom: 8px; }
.catalog-card code { display: block; margin: 8px 0 12px; color: var(--ui-text-2, #c2cad8); font-size: 11px; overflow-wrap: anywhere; }
.catalog-card button, .logic-card button { width: 100%; margin-top: 8px; }
.effect-badge, .draft-badge { display: inline-block; font-size: 10px; font-weight: 650; padding: 4px 7px; border: 1px solid var(--ui-border, #606979); border-radius: 6px; white-space: normal; }
.draft-badge { flex-shrink: 0; }
.library-help { margin-top: 18px; } summary { cursor: pointer; min-height: 44px; padding: 10px 0; font-weight: 600; }
.library-help p { margin-bottom: 9px; }
.workflow-heading { align-items: flex-start; }.workflow-id { overflow-wrap: anywhere; margin-bottom: 8px; }
.insert-controls { display: grid; gap: 8px; margin: 16px 0; background: var(--ui-surface-2, #1e2431); border: 1px solid var(--ui-border, #454c5c); padding: 12px; border-radius: 12px; }.insert-controls label { margin: 0; overflow-wrap: anywhere; }
.workflow-node { border: 1px solid var(--ui-border, #454c5c); border-radius: 14px; padding: 12px; background: var(--ui-surface-2, #1c2230); min-width: 0; }
.workflow-node.selected { border-color: var(--ui-accent, #9fb4ff); box-shadow: inset 3px 0 0 var(--ui-accent, #9fb4ff); }
.workflow-node.condition { border-style: dashed; }.workflow-node.unavailable { border-style: dotted; }
.node-select { display: flex; align-items: center; gap: 10px; text-align: left; width: 100%; border: 0; padding: 4px 0; background: transparent; min-width: 0; }
.node-select strong, .node-select small { display: block; overflow-wrap: anywhere; }.node-select small { color: var(--ui-text-2, #c2cad8); font-size: 11px; margin-top: 4px; }
.node-symbol { color: var(--ui-accent, #9fb4ff); padding: 8px; font-size: 21px; flex-shrink: 0; }
.node-route { font-size: 12px; color: var(--ui-text-2, #c2cad8); margin-top: 9px; overflow-wrap: anywhere; }
.branch-summary { display: grid; gap: 7px; margin-top: 10px; font-size: 12px; overflow-wrap: anywhere; }.branch-summary span { border-left: 2px solid var(--ui-border, #606979); padding-left: 10px; }
.edge-editor { margin-top: 12px; display: grid; gap: 7px; }.edge-editor label { margin: 0; }.remove-node { margin-top: 12px; }
.start-hint { text-align: center; color: var(--ui-text-2, #c2cad8); padding: 20px 10px; font-size: 13px; }
.form-error, .editor-notice { overflow-wrap: anywhere; font-size: 12px; margin: 12px 0; }.form-error { color: var(--ui-danger, #ff9f9f); }.form-error:empty, .editor-notice:empty { display: none; }
.workflow-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }.primary { background: var(--ui-accent, #4468d5); color: var(--ui-on-accent, #fff); }
.inline-confirm, .pending-note { border: 1px solid var(--ui-border, #606979); border-radius: 12px; padding: 14px; margin-bottom: 16px; font-size: 13px; }.inline-confirm p, .pending-note p { margin-bottom: 12px; }.inline-confirm button { margin: 4px 8px 0 0; }
.record-controls { display: grid; gap: 8px; margin-bottom: 18px; }.record-controls label { margin: 0; }
.review-actions { padding-left: 20px; }.review-actions li, .run-review code { overflow-wrap: anywhere; }.review-input { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; padding: 10px; border: 1px solid var(--ui-border, #606979); border-radius: 8px; }
.json-section { margin-top: 20px; border-top: 1px solid var(--ui-border, #454c5c); padding-top: 16px; }.json-section > div { margin-top: 12px; }.json-section textarea { font-family: ui-monospace, monospace; line-height: 1.5; resize: vertical; }.json-section .subtle { margin: 10px 0; }
@container (min-width: 700px) { .shortcuts-layout { grid-template-columns: minmax(220px, .8fr) minmax(0, 1.5fr); }.action-library, .view-library .workflow-area { display: block; }.mobile-switch, .mobile-library-button { display: none; }.action-library { border-right: 1px solid var(--ui-border, #454c5c); padding-right: 22px; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
@media (forced-colors: active) { .workflow-node.selected { outline: 2px solid Highlight; } }
</style>
