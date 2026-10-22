// CyberManju OS — Shortcuts host composition (src/composables/useShortcutsAutomationHost.ts).
// Role: Bind UI requests to owner-scoped workflow persistence and guarded execution.
// Exports: useShortcutsAutomationHost and composition contracts.
// Integrates: IndexedDB WorkflowService, runner authorization and the native action bridge.
// Contracts: No memory fallback, broad integrations, secret resolution or background execution.
import { computed, nextTick, onScopeDispose, shallowRef, watch, toValue, type MaybeRefOrGetter } from 'vue'
import {
  createShortcutsAutomationHost, copyJson, identifier, validateWorkflow,
  type AcknowledgePendingRunOptions, type Json, type NativeActionBridge,
  type NativeActionRequest, type PendingRun, type ShortcutsAutomationHost,
  type ShortcutsAutomationHostOptions, type Workflow, type WorkflowRecord,
  type WorkflowServiceRunResult,
} from '@/automation'
import { parseAuthorizationRequest, type AuthorizationDecision, type AuthorizationRequest } from '@/utils/shortcutAuthorization'
import { shortcutsLocalIdentity } from '@/utils/shortcutsLocalIdentity'

export interface ShortcutSaveRequest { requestId: string; name: string; expectedRevision: number | null }
export type ShortcutResultContext = Pick<PendingRun, 'workflowId' | 'workflowRevision' | 'runId'>
export interface ShortcutsCompositionOptions {
  userId: MaybeRefOrGetter<string | null | undefined>
  /** Explicit opt-in for native/static hosts without dashboard authentication. Never an auth boundary. */
  allowLocalIdentity?: MaybeRefOrGetter<boolean>
  /** Stable origin/platform namespace, not a token, workflow ID or run ID. */
  environment: string
  android: boolean
  nativeBridge?: NativeActionBridge
  /** Dependency seams for tests; production always uses IndexedDB. */
  createHost?: (options: ShortcutsAutomationHostOptions) => ShortcutsAutomationHost
  indexedDBAvailable?: () => boolean
}
// Runner's default per-action deadline is 30s; deny before it, including after suspension.
export const SHORTCUT_HOST_AUTHORIZATION_MS = 25_000
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const v = value as Record<string, unknown>
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}
const context = (p: ShortcutResultContext): ShortcutResultContext => ({
  workflowId: p.workflowId, workflowRevision: p.workflowRevision, runId: p.runId,
})

export function useShortcutsAutomationHost(options: ShortcutsCompositionOptions) {
  const modelValue = shallowRef<Workflow>()
  const savedWorkflow = shallowRef<Workflow>()
  const records = shallowRef<WorkflowRecord[]>([])
  const selectedWorkflowId = shallowRef<string | null>(null)
  const saveComplete = shallowRef<{ requestId: string; record: WorkflowRecord } | null>(null)
  const saveFailed = shallowRef<string | null>(null)
  const authorizationRequest = shallowRef<AuthorizationRequest | null>(null)
  const result = shallowRef<WorkflowServiceRunResult | null>(null)
  const resultContext = shallowRef<ShortcutResultContext | null>(null)
  const pendingRun = shallowRef<PendingRun | null>(null)
  const acknowledgeFailedContext = shallowRef<ShortcutResultContext | null>(null)
  const running = shallowRef(false)
  const ready = shallowRef(false)
  const saving = shallowRef(false)
  const acknowledging = shallowRef(false)
  const connected = shallowRef(false)
  const notice = shallowRef('Carregando armazenamento de automações…')
  const actions = shallowRef<ReturnType<ShortcutsAutomationHost['registry']['list']>>([])
  let host: ShortcutsAutomationHost | null = null
  let generation = 0
  let loadSequence = 0
  let disposed = false
  let active: { snapshot: Workflow; runId: string; control: AbortController; generation: number; consumed: Set<string> } | null = null
  type Consent = {
    request: NativeActionRequest; fingerprint: string; published: AuthorizationRequest
    expires: number; monotonicExpires: number; signal: AbortSignal
    finish: (decision: 'allow' | 'deny') => void
  }
  let consent: Consent | null = null
  const grants = new Map<string, Consent>()
  const usable = () => !disposed && !!host && ready.value
  const runMatches = (request: NativeActionRequest) => {
    const run = active
    if (!run || run.generation !== generation || run.control.signal.aborted || !connected.value || !usable()) return false
    const snapshot = run.snapshot
    const node = snapshot.nodes.find(n => n.id === request.nodeId)
    const key = JSON.stringify([snapshot.id, snapshot.revision, run.runId, request.nodeId])
    const definition = host!.registry.get(request.actionId)
    return request.protocolVersion === 1 && request.requestId === key && request.idempotencyKey === key &&
      request.workflowId === snapshot.id && request.workflowRevision === snapshot.revision &&
      node?.type === 'action' && node.actionId === request.actionId && node.expectedRevision === request.expectedRevision &&
      equal(modelValue.value, snapshot) && equal(savedWorkflow.value, snapshot) &&
      !!definition && definition.validateInput(copyJson(request.input)) === true
  }
  const live = (c: Consent) => !c.signal.aborted && Date.now() < c.expires &&
    performance.now() < c.monotonicExpires && runMatches(c.request) && canonical(c.request) === c.fingerprint
  function denyConsent() { consent?.finish('deny'); grants.clear() }
  function disconnect() {
    connected.value = false
    denyConsent()
    active?.control.abort()
  }
  function connect() { if (!disposed) connected.value = true }
  async function authorize(request: NativeActionRequest, effect: 'read' | 'write', signal: AbortSignal): Promise<'allow' | 'deny'> {
    try {
      // Runner owns binding resolution and path traversal; capture its exact resolved request.
      const captured = frozen(copyJson(request) as unknown as NativeActionRequest)
      if (signal.aborted || !runMatches(captured) || consent || active!.consumed.has(captured.requestId)) return 'deny'
      const definition = host!.registry.get(captured.actionId)!
      if (definition.effect !== effect) return 'deny'
      const published = frozen(parseAuthorizationRequest({
        requestId: captured.requestId, workflowId: captured.workflowId, workflowRevision: captured.workflowRevision,
        nodeId: captured.nodeId, actionId: captured.actionId, input: captured.input,
      }))
      // runMatches binds the tuple to this execution and a node in its bounded snapshot.
      // Drop the set with the run; old tuples still cannot match a future execution.
      active!.consumed.add(captured.requestId)
      // The only non-effectful capability installed by this composition is the data pipeline.
      if (effect === 'read') return captured.actionId === 'core.script' ? 'allow' : 'deny'
      if (!options.android || !captured.actionId.startsWith('android.') || !options.nativeBridge) return 'deny'
      return await new Promise<'allow' | 'deny'>(resolve => {
        let settled = false
        const c: Consent = {
          request: captured, fingerprint: canonical(captured), published,
          expires: Date.now() + SHORTCUT_HOST_AUTHORIZATION_MS,
          monotonicExpires: performance.now() + SHORTCUT_HOST_AUTHORIZATION_MS, signal,
          finish(decision) {
            if (settled) return
            settled = true
            const allowed = decision === 'allow' && consent === c && authorizationRequest.value === c.published && live(c)
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            if (consent === c) { consent = null; authorizationRequest.value = null }
            if (allowed) grants.set(c.request.requestId, c)
            resolve(allowed ? 'allow' : 'deny')
          },
        }
        const abort = () => c.finish('deny')
        const timer = setTimeout(abort, SHORTCUT_HOST_AUTHORIZATION_MS)
        consent = c
        signal.addEventListener('abort', abort, { once: true })
        authorizationRequest.value = c.published
        if (signal.aborted || !connected.value) abort()
      })
    } catch { return 'deny' }
  }
  function authorizationDecision(value: AuthorizationDecision) {
    const c = consent
    if (!c) return
    // A stale/mismatching response cannot approve the active request.
    if (!value || value.requestId !== c.request.requestId || !['allow', 'deny'].includes(value.decision)) {
      c.finish('deny'); return
    }
    c.finish(value.decision)
  }
  const bridge: NativeActionBridge = async (request, signal) => {
    const grant = grants.get(request.requestId)
    grants.delete(request.requestId)
    if (!grant || signal.aborted || !live(grant) || canonical(request) !== grant.fingerprint ||
      !options.android || !options.nativeBridge) throw new Error('authorization_denied')
    // Compare again at the actual effect boundary, after the runner's durable journal claim.
    return options.nativeBridge(frozen(copyJson(request) as unknown as NativeActionRequest), signal)
  }
  function clearView() {
    modelValue.value = undefined; savedWorkflow.value = undefined; records.value = []
    selectedWorkflowId.value = null; saveComplete.value = null; saveFailed.value = null
    result.value = null; resultContext.value = null; pendingRun.value = null
    acknowledgeFailedContext.value = null; actions.value = []
    running.value = false; saving.value = false; acknowledging.value = false
  }
  async function select(id: string) {
    if (!usable() || running.value || saving.value || acknowledging.value || result.value || pendingRun.value || !identifier(id)) return
    const current = host!, epoch = generation, sequence = ++loadSequence
    ready.value = false
    try {
      const record = await current.repository.get(id)
      if (!record) throw new Error('not_found')
      const pending = await current.service.getPendingRun(id)
      if (disposed || epoch !== generation || sequence !== loadSequence) return
      selectedWorkflowId.value = id; savedWorkflow.value = frozen(validateWorkflow(record.workflow))
      modelValue.value = validateWorkflow(record.workflow)
      pendingRun.value = pending; resultContext.value = pending ? context(pending) : null
      notice.value = ''; ready.value = true
    } catch {
      if (epoch === generation && sequence === loadSequence) { ready.value = false; notice.value = 'Não foi possível restaurar o atalho e sua pendência. Execução bloqueada.' }
    }
  }
  const stopIdentity = watch(() => [toValue(options.userId), toValue(options.allowLocalIdentity)] as const, async ([owner, allowLocal]) => {
    const epoch = ++generation
    ++loadSequence
    ready.value = false; denyConsent(); active?.control.abort(); active = null; host = null
    clearView()
    const local = owner == null && allowLocal === true
    if (!local && (typeof owner !== 'string' || !owner.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(owner))) {
      notice.value = 'Entre em uma conta para salvar e executar automações.'; return
    }
    if (!(options.indexedDBAvailable?.() ?? typeof indexedDB !== 'undefined')) {
      notice.value = 'IndexedDB persistente indisponível. Salvar e executar estão bloqueados.'; return
    }
    try {
      // Separate local and account namespaces; the random ID is not an authentication credential.
      const namespace = local ? `local:${shortcutsLocalIdentity()}` : encodeURIComponent(owner as string)
      const current = (options.createHost ?? createShortcutsAutomationHost)({
        databaseName: `cybermanju:shortcuts:v1:${encodeURIComponent(options.environment)}:${namespace}`,
        authorize, ...(options.android && options.nativeBridge ? { nativeBridge: bridge } : {}),
      })
      if (current.durability !== 'persistent') throw new Error('persistent_storage_required')
      const list = await current.repository.list()
      if (disposed || epoch !== generation) return
      host = current; records.value = list; actions.value = current.registry.list()
      ready.value = true; notice.value = ''
      if (list[0]) await select(list[0].workflow.id)
    } catch {
      if (epoch === generation) { ready.value = false; notice.value = 'Armazenamento persistente indisponível. Salvar e executar estão bloqueados.' }
    }
  }, { immediate: true, flush: 'sync' })
  function updateModel(workflow: Workflow) {
    if (running.value || pendingRun.value || result.value) return
    try { modelValue.value = validateWorkflow(workflow) } catch { ready.value = false }
  }
  async function pendingWarning(pending: PendingRun | null, attempted: ShortcutResultContext, epoch: number) {
    // Let the panel consume the service response and release its request-in-flight latch.
    // The transient warning never owns the persisted run's result context or durable ACK.
    result.value = { status: 'rejected', code: 'pending_run' }
    pendingRun.value = pending
    resultContext.value = pending ? null : attempted
    notice.value = 'Já existe uma execução pendente. Nenhum efeito novo foi autorizado.'
    await nextTick()
    if (disposed || epoch !== generation || !pending) return
    result.value = null; resultContext.value = context(pending)
  }
  async function save(workflow: Workflow, request: ShortcutSaveRequest) {
    const id = request?.requestId
    if (typeof id !== 'string') return
    if (!usable() || saving.value || running.value || pendingRun.value || result.value) { saveFailed.value = id; return }
    const epoch = generation, current = host!
    saving.value = true; saveFailed.value = null; saveComplete.value = null
    try {
      const original = validateWorkflow(workflow)
      const metadata = { ...request }
      if (metadata.expectedRevision !== null && (!Number.isSafeInteger(metadata.expectedRevision) || metadata.expectedRevision < 1)) throw new Error('invalid_revision')
      const next = validateWorkflow({ ...original, revision: metadata.expectedRevision === null ? 1 : metadata.expectedRevision + 1 })
      const validation = current.service.validate(next)
      if (!validation.valid) throw new Error('invalid_workflow')
      const record = await current.repository.save(next, { name: metadata.name, expectedRevision: metadata.expectedRevision })
      if (disposed || epoch !== generation) return
      // Do not discard edits made while save was in flight; the panel reconciles its ACK.
      if (modelValue.value === undefined || equal(modelValue.value, original)) modelValue.value = validateWorkflow(record.workflow)
      savedWorkflow.value = frozen(validateWorkflow(record.workflow))
      records.value = [...records.value.filter(r => r.workflow.id !== record.workflow.id), record]
      selectedWorkflowId.value = record.workflow.id
      saveComplete.value = { requestId: id, record }
      notice.value = ''
    } catch {
      if (epoch === generation) { saveFailed.value = id; notice.value = 'Não foi possível salvar. Revise o atalho ou tente novamente sem descartar o rascunho.' }
    } finally { if (epoch === generation) saving.value = false }
  }
  async function run(workflow: Workflow) {
    if (!usable() || !connected.value || running.value || saving.value || acknowledging.value || pendingRun.value || result.value || active) return
    const epoch = generation, current = host!
    let snapshot: Workflow
    try {
      snapshot = frozen(validateWorkflow(workflow))
      if (!equal(snapshot, savedWorkflow.value) || !equal(snapshot, modelValue.value) || !current.service.validate(snapshot).valid) return
    } catch { return }
    const runId = crypto.randomUUID()
    const runState = { snapshot, runId, control: new AbortController(), generation: epoch, consumed: new Set<string>() }
    active = runState; running.value = true; acknowledgeFailedContext.value = null
    try {
      const record = await current.repository.get(snapshot.id)
      if (disposed || epoch !== generation || runState.control.signal.aborted) return
      if (!record || !equal(record.workflow, snapshot)) {
        result.value = { status: 'rejected', code: 'revision_conflict' }
        resultContext.value = { workflowId: snapshot.id, workflowRevision: snapshot.revision, runId }; return
      }
      const restored = await current.service.getPendingRun(snapshot.id)
      if (disposed || epoch !== generation || runState.control.signal.aborted) return
      if (restored) {
        await pendingWarning(restored, { workflowId: snapshot.id, workflowRevision: snapshot.revision, runId }, epoch)
        return
      }
      const outcome = await current.service.run(snapshot.id, { runId, expectedWorkflowRevision: snapshot.revision, signal: runState.control.signal })
      if (disposed || epoch !== generation) return
      // Restore metadata even on service rejection; pending_run is not a new durable result.
      const pending = await current.service.getPendingRun(snapshot.id)
      if (disposed || epoch !== generation) return
      if (outcome.status === 'rejected' && outcome.code === 'pending_run') {
        await pendingWarning(pending, { workflowId: snapshot.id, workflowRevision: snapshot.revision, runId }, epoch)
        return
      }
      result.value = outcome; pendingRun.value = pending
      resultContext.value = pending ? context(pending) : { workflowId: snapshot.id, workflowRevision: snapshot.revision, runId }
    } catch {
      if (epoch === generation) { ready.value = false; notice.value = 'Não foi possível confirmar o estado durável. Execução bloqueada; reabra para reconciliar.' }
    } finally {
      if (active === runState) { denyConsent(); active = null }
      if (epoch === generation) running.value = false
    }
  }
  async function acknowledge(value: ShortcutResultContext, ackOptions?: AcknowledgePendingRunOptions) {
    if (!usable() || running.value || acknowledging.value || !resultContext.value || !equal(value, resultContext.value)) return
    const expected = frozen(context(value)), epoch = generation, current = host!
    const localPending = pendingRun.value
    if (localPending && !equal(context(localPending), expected)) return
    // Dismiss only the transient warning, never a durable gate or its context.
    if (result.value?.status === 'rejected' && result.value.code === 'pending_run') {
      result.value = null
      if (!localPending) resultContext.value = null
      return
    }
    const acceptUncertain = ackOptions?.acceptUncertain === true
    if (localPending && localPending.status !== 'completed' && !acceptUncertain) return
    acknowledging.value = true; acknowledgeFailedContext.value = null
    try {
      const persisted = await current.service.getPendingRun(expected.workflowId)
      if (disposed || epoch !== generation) return
      if (persisted) {
        if (!localPending || !equal(context(persisted), expected)) throw new Error('run_conflict')
        if (persisted.status !== 'completed' && !acceptUncertain) throw new Error('uncertain_run')
        await current.service.acknowledgePendingRun(expected.workflowId, expected.runId, acceptUncertain ? { acceptUncertain: true } : undefined)
      }
      if (await current.service.getPendingRun(expected.workflowId) !== null) throw new Error('pending_run')
      if (disposed || epoch !== generation) return
      pendingRun.value = null; result.value = null; resultContext.value = null
      acknowledgeFailedContext.value = null; notice.value = ''
    } catch {
      if (epoch === generation) { acknowledgeFailedContext.value = context(expected); notice.value = 'Reconhecimento não confirmado no armazenamento. A pendência foi preservada; tente novamente.' }
    } finally { if (epoch === generation) acknowledging.value = false }
  }
  onScopeDispose(() => { disposed = true; ++generation; stopIdentity(); disconnect(); host = null })
  // Any unexpected model mutation during a run revokes the active request immediately.
  watch([modelValue, savedWorkflow], () => { if (active && (!equal(modelValue.value, active.snapshot) || !equal(savedWorkflow.value, active.snapshot))) { denyConsent(); active.control.abort() } }, { flush: 'sync' })
  const canSave = computed(() => ready.value && !running.value && !saving.value && !acknowledging.value && !pendingRun.value && !result.value)
  const canRun = computed(() => canSave.value && connected.value)
  return {
    modelValue, savedWorkflow, records, selectedWorkflowId, saveComplete, saveFailed, actions,
    canSave, canRun, authorizationConnected: connected, authorizationRequest, result, resultContext,
    pendingRun, acknowledgeFailedContext, running, notice,
    updateModel, save, select, run, authorizationDecision, acknowledge, connect, disconnect,
  }
}
