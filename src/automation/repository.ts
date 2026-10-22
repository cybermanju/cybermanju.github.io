// CyberManju OS — Workflow repository (src/automation/repository.ts).
// Role: Atomic revisioned workflow persistence and immutable logical-run binding.
// Exports: WorkflowRepository, StorageExecutionJournal and repository contracts.
// Integrates: AutomationStorage, schema v1 and WorkflowRunner.
// Contracts: No inline credentials, ID reuse, silent storage fallback or non-atomic CAS.
import { identifier, LIMITS, record, validateWorkflow, type Json, type Workflow } from './schema'
import type { ExecutionJournal, RunResult } from './runner'
import type { AutomationStorage } from './storage'

export const AUTOMATION_REPOSITORY_VERSION = 1 as const
export type RepositoryErrorCode = 'invalid_workflow' | 'invalid_metadata' | 'invalid_revision' | 'invalid_id' |
  'not_found' | 'revision_conflict' | 'deleted_workflow' | 'corrupt_record' | 'run_conflict' | 'invalid_run' |
  'pending_run' | 'uncertain_run'
export class AutomationRepositoryError extends Error {
  constructor(readonly code: RepositoryErrorCode) { super(code); this.name = 'AutomationRepositoryError' }
}
export interface WorkflowRecord {
  recordVersion: 1
  workflow: Workflow
  name: string
  updatedAt: string
}
export interface SaveWorkflowOptions {
  /** null creates revision 1; updates require the previously read revision. */
  expectedRevision: number | null
  name: string
}
/** Safe, bounded metadata only. No action codes, payloads or provider correlation IDs. */
export interface PendingRun {
  workflowId: string
  workflowRevision: number
  runId: string
  status: 'running' | 'completed' | 'halted' | 'unknown'
  code: 'running' | 'completed' | 'denied' | 'interrupted' | 'uncertain' | 'accepted' | 'needs_confirmation' | 'failed'
  startedAt: string
  updatedAt: string
}
export interface AcknowledgePendingRunOptions { acceptUncertain?: boolean }
type ActiveWorkflow = WorkflowRecord & { pendingRun?: PendingRun }
type StoredWorkflow = ActiveWorkflow | { recordVersion: 1; deleted: true; revision: number }
const workflowKey = (id: string) => `workflow:${id}`
function requireId(id: string): void {
  if (!identifier(id)) throw new AutomationRepositoryError('invalid_id')
}
function requireRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new AutomationRepositoryError('invalid_revision')
}
function nameSnapshot(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new AutomationRepositoryError('invalid_metadata')
  }
  return name.trim()
}
function workflowSnapshot(value: unknown): Workflow {
  try { return validateWorkflow(value) } catch { throw new AutomationRepositoryError('invalid_workflow') }
}
function envelope(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error('invalid_envelope')
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor)) throw new Error('invalid_envelope')
    result[key] = descriptor.value
  }
  return result
}
function pendingTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function pendingSnapshot(value: unknown, workflow: Workflow): PendingRun {
  const p = envelope(value)
  if (Object.keys(p).sort().join(',') !== 'code,runId,startedAt,status,updatedAt,workflowId,workflowRevision' ||
    p.workflowId !== workflow.id || p.workflowRevision !== workflow.revision || !identifier(p.runId) ||
    !pendingTimestamp(p.startedAt) || !pendingTimestamp(p.updatedAt)) throw new Error('invalid_pending')
  const codes: Record<string, readonly string[]> = {
    running: ['running'], completed: ['completed'], halted: ['denied'],
    unknown: ['interrupted', 'uncertain', 'accepted', 'needs_confirmation', 'failed'],
  }
  if (typeof p.status !== 'string' || !Object.prototype.hasOwnProperty.call(codes, p.status) ||
    !codes[p.status].includes(p.code as string)) throw new Error('invalid_pending')
  // Older records treated a final denial as safe, but earlier nodes may already have written.
  // Normalize those records too so reload/ACK cannot retain the old implicit-unlock behavior.
  return { workflowId: workflow.id, workflowRevision: workflow.revision, runId: p.runId,
    status: p.status === 'halted' ? 'unknown' : p.status as PendingRun['status'],
    code: p.status === 'halted' ? 'uncertain' : p.code as PendingRun['code'],
    startedAt: p.startedAt, updatedAt: p.updatedAt }
}
function storedSnapshot(value: unknown): StoredWorkflow {
  try {
    // Validate workflow separately: a storage envelope must not consume its depth budget.
    const v = envelope(value)
    if (v.recordVersion !== 1) throw new Error()
    if (v.deleted === true) {
      if (Object.keys(v).sort().join(',') !== 'deleted,recordVersion,revision') throw new Error()
      requireRevision(v.revision as number)
      return { recordVersion: 1, deleted: true, revision: v.revision as number }
    }
    const keys = Object.keys(v).sort().join(',')
    if ((keys !== 'name,recordVersion,updatedAt,workflow' && keys !== 'name,pendingRun,recordVersion,updatedAt,workflow') ||
      typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt))) throw new Error()
    const workflow = validateWorkflow(v.workflow)
    return { recordVersion: 1, workflow, name: nameSnapshot(v.name as string), updatedAt: v.updatedAt,
      ...('pendingRun' in v ? { pendingRun: pendingSnapshot(v.pendingRun, workflow) } : {}) }
  } catch { throw new AutomationRepositoryError('corrupt_record') }
}
function isDeleted(value: StoredWorkflow): value is Extract<StoredWorkflow, { deleted: true }> { return 'deleted' in value }
function publicRecord(value: ActiveWorkflow): WorkflowRecord {
  return { recordVersion: 1, workflow: value.workflow, name: value.name, updatedAt: value.updatedAt }
}
function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}
function sameWorkflow(a: Workflow, b: Workflow): boolean {
  return canonical(a as unknown as Json) === canonical(b as unknown as Json)
}

/** One instance per owner/environment storage namespace. This is not an ownership/authentication boundary. */
export class WorkflowRepository {
  readonly executionJournal: ExecutionJournal
  readonly durability: AutomationStorage['durability']
  constructor(private readonly storage: AutomationStorage) {
    this.durability = storage.durability
    this.executionJournal = new StorageExecutionJournal(storage)
  }
  async get(id: string): Promise<WorkflowRecord | null> {
    requireId(id)
    const value = await this.storage.get(workflowKey(id))
    if (value === undefined) return null
    const result = storedSnapshot(value)
    if (isDeleted(result)) return null
    if (result.workflow.id !== id) throw new AutomationRepositoryError('corrupt_record')
    return publicRecord(result)
  }
  async list(): Promise<WorkflowRecord[]> {
    const records: WorkflowRecord[] = []
    for (const entry of await this.storage.list('workflow:')) {
      const result = storedSnapshot(entry.value)
      if (!isDeleted(result)) {
        if (entry.key !== workflowKey(result.workflow.id)) throw new AutomationRepositoryError('corrupt_record')
        records.push(publicRecord(result))
      }
    }
    return records.sort((a, b) => a.workflow.id.localeCompare(b.workflow.id))
  }
  async save(value: unknown, options: SaveWorkflowOptions): Promise<WorkflowRecord> {
    // Snapshot everything before the first await or host callback.
    const workflow = workflowSnapshot(value)
    const name = nameSnapshot(options?.name)
    const expected = options?.expectedRevision
    if (expected !== null) requireRevision(expected)
    if (workflow.revision !== (expected === null ? 1 : expected + 1)) throw new AutomationRepositoryError('revision_conflict')
    const result: WorkflowRecord = { recordVersion: 1, workflow, name, updatedAt: new Date().toISOString() }
    return this.storage.update(workflowKey(workflow.id), current => {
      if (current === undefined) {
        if (expected !== null) throw new AutomationRepositoryError('not_found')
      } else {
        const previous = storedSnapshot(current)
        if (isDeleted(previous)) throw new AutomationRepositoryError('deleted_workflow')
        if (previous.workflow.id !== workflow.id) throw new AutomationRepositoryError('corrupt_record')
        if (previous.pendingRun) throw new AutomationRepositoryError('pending_run')
        if (expected === null || previous.workflow.revision !== expected) throw new AutomationRepositoryError('revision_conflict')
      }
      return { value: result, result: storedSnapshot(result) as WorkflowRecord }
    })
  }
  async delete(id: string, expectedRevision: number): Promise<void> {
    requireId(id); requireRevision(expectedRevision)
    await this.storage.update(workflowKey(id), current => {
      if (current === undefined) throw new AutomationRepositoryError('not_found')
      const previous = storedSnapshot(current)
      if (isDeleted(previous)) throw new AutomationRepositoryError('deleted_workflow')
      if (previous.workflow.id !== id) throw new AutomationRepositoryError('corrupt_record')
      if (previous.pendingRun) throw new AutomationRepositoryError('pending_run')
      if (previous.workflow.revision !== expectedRevision) throw new AutomationRepositoryError('revision_conflict')
      // Tombstones preserve revision/idempotency history. Restoring requires a new workflow ID.
      return { value: { recordVersion: 1, deleted: true, revision: expectedRevision }, result: undefined }
    })
  }
  async importWorkflow(text: string, options: SaveWorkflowOptions): Promise<WorkflowRecord> {
    if (typeof text !== 'string' || text.length > LIMITS.jsonBytes || new TextEncoder().encode(text).byteLength > LIMITS.jsonBytes) {
      throw new AutomationRepositoryError('invalid_workflow')
    }
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new AutomationRepositoryError('invalid_workflow') }
    return this.save(parsed, options)
  }
  async exportWorkflow(id: string): Promise<string> {
    const result = await this.get(id)
    if (!result) throw new AutomationRepositoryError('not_found')
    return JSON.stringify(result.workflow)
  }
  /** Same-key CAS serializes claim/save/delete across IndexedDB connections, not just this host. */
  async claimRun(value: unknown, runId: string): Promise<void> {
    const workflow = workflowSnapshot(value)
    if (!identifier(runId)) throw new AutomationRepositoryError('invalid_run')
    await this.storage.update(workflowKey(workflow.id), current => {
      if (current === undefined) throw new AutomationRepositoryError('not_found')
      const saved = storedSnapshot(current)
      if (isDeleted(saved)) throw new AutomationRepositoryError('deleted_workflow')
      if (saved.workflow.id !== workflow.id) throw new AutomationRepositoryError('corrupt_record')
      if (saved.pendingRun) throw new AutomationRepositoryError('pending_run')
      if (!sameWorkflow(saved.workflow, workflow)) throw new AutomationRepositoryError('revision_conflict')
      const now = new Date().toISOString()
      const pendingRun: PendingRun = { workflowId: workflow.id, workflowRevision: workflow.revision, runId,
        status: 'running', code: 'running', startedAt: now, updatedAt: now }
      return { value: { ...saved, pendingRun }, result: undefined }
    })
  }
  /** Persist only an allowlisted projection; failure leaves the running claim uncertain and blocking. */
  async finishRun(id: string, runId: string, result: RunResult): Promise<void> {
    requireId(id)
    if (!identifier(runId)) throw new AutomationRepositoryError('invalid_run')
    // Do not persist arbitrary action error codes or accepted/confirmation payloads.
    // Any halt (including denial) may follow successful writes. Keep details transient;
    // the whole workflow remains uncertain and requires explicit risk acceptance to unlock.
    const terminal: Pick<PendingRun, 'status' | 'code'> = result.status === 'completed'
      ? { status: 'completed', code: 'completed' }
      : { status: 'unknown', code: 'uncertain' }
    await this.storage.update(workflowKey(id), current => {
      if (current === undefined) throw new AutomationRepositoryError('run_conflict')
      const saved = storedSnapshot(current)
      if (isDeleted(saved) || saved.workflow.id !== id || saved.pendingRun?.runId !== runId ||
        saved.pendingRun.status !== 'running') throw new AutomationRepositoryError('run_conflict')
      const pendingRun: PendingRun = { ...saved.pendingRun, ...terminal, updatedAt: new Date().toISOString() }
      return { value: { ...saved, pendingRun }, result: undefined }
    })
  }
  /** No liveness/lease assumptions: every persisted running snapshot is conservatively interrupted.
   * Even a live host may still be executing. ACK accepts this risk; it never cancels or resumes it.
   */
  async getPendingRun(id: string): Promise<PendingRun | null> {
    requireId(id)
    const current = await this.storage.get(workflowKey(id))
    if (current === undefined) return null
    const saved = storedSnapshot(current)
    if (isDeleted(saved)) return null
    if (saved.workflow.id !== id) throw new AutomationRepositoryError('corrupt_record')
    const pending = saved.pendingRun
    if (!pending) return null
    return pending.status === 'running' ? { ...pending, status: 'unknown', code: 'interrupted' } : pending
  }
  /** Only explicit exact-key ACK unlocks a workflow. No timeout, retry or automatic cleanup. */
  async acknowledgePendingRun(id: string, runId: string, options: AcknowledgePendingRunOptions = {}): Promise<void> {
    requireId(id)
    if (!identifier(runId)) throw new AutomationRepositoryError('invalid_run')
    const acceptUncertain = options.acceptUncertain === true
    await this.storage.update(workflowKey(id), current => {
      if (current === undefined) throw new AutomationRepositoryError('run_conflict')
      const saved = storedSnapshot(current)
      if (isDeleted(saved) || saved.workflow.id !== id || saved.pendingRun?.runId !== runId) {
        throw new AutomationRepositoryError('run_conflict')
      }
      if (saved.pendingRun.status !== 'completed' && !acceptUncertain) {
        throw new AutomationRepositoryError('uncertain_run')
      }
      const { pendingRun: _pending, ...unlocked } = saved
      return { value: unlocked, result: undefined }
    })
  }
  /** Bind before runner dispatch. Reusing an ID with different content/revision is never a retry. */
  async bindRun(value: unknown, runId: string): Promise<void> {
    const workflow = workflowSnapshot(value)
    if (!identifier(runId)) throw new AutomationRepositoryError('invalid_run')
    const key = `run:${JSON.stringify([workflow.id, runId])}`
    await this.storage.update(key, current => {
      if (current !== undefined) {
        let previous: Workflow
        try {
          const binding = envelope(current)
          if (Object.keys(binding).sort().join(',') !== 'bindingVersion,workflow' || binding.bindingVersion !== 1) throw new Error()
          previous = validateWorkflow(binding.workflow)
        } catch { throw new AutomationRepositoryError('corrupt_record') }
        if (!sameWorkflow(previous, workflow)) throw new AutomationRepositoryError('run_conflict')
      }
      return { value: { bindingVersion: 1, workflow }, result: undefined }
    })
  }
}

/** Atomic claims survive runner/service recreation when backed by the same persistent database. */
export class StorageExecutionJournal implements ExecutionJournal {
  constructor(private readonly storage: AutomationStorage) {}
  async claim(key: string): Promise<boolean> {
    if (typeof key !== 'string' || !key || key.length > 2048) throw new Error('invalid_claim')
    return this.storage.update(`claim:${key}`, current => ({ value: { claimVersion: 1, claimed: true }, result: current === undefined }))
  }
}
