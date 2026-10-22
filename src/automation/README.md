# Automation engine v1

Isolated TypeScript execution module for one shared CyberManju Shortcuts-style app. It does not add UI, Android/JNI code, scheduled execution or an ambient shell. Public imports come from `src/automation/index.ts`. No integration is activated on import.

## Workflow contract

```ts
interface Workflow {
  schemaVersion: 1
  id: string
  revision: number // safe integer >= 1
  entryNodeId: string
  nodes: WorkflowNode[]
}
```

Nodes have one of these exact shapes:

```ts
{ id, type: 'action', actionId, input, next, expectedRevision? }
{ id, type: 'condition', predicate, trueNext, falseNext }
{ id, type: 'end' }
```

All paths terminate: cycles, unreachable nodes, duplicate IDs, dangling edges, unsupported versions and unknown fields are rejected. IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Limits: 128 nodes/steps, 24 JSON nesting levels, 256 KiB workflow JSON, 64 KiB serialized action input/output. JSON must contain finite numbers, no accessors, custom prototypes, dangerous property names or sparse arrays. Validation makes a detached snapshot.

Inputs and predicates can bind a previous action output with `{ "$output": { "nodeId": "fetch", "path": ["status"] } }`. Paths are own properties only. Missing values deny an action or fail a condition; `exists` is the explicit missing-value test. A reference to a branch that did not execute is not silently null. IDs referenced in bindings must name action nodes.

Predicates: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains` with `left`/`right`; `exists` with `value`; `all`/`any` with `predicates`; `not` with `predicate`. Equality is structural and order-independent for object keys. Comparisons never coerce types. No regex, expression strings, arbitrary loops or `eval`.

## Native request and result: shared contract

```ts
interface NativeActionRequest {
  protocolVersion: 1
  requestId: string
  workflowId: string
  workflowRevision: number
  nodeId: string
  actionId: string
  input: Json
  idempotencyKey: string
  expectedRevision?: number
}

type ActionResult =
  | { status: 'succeeded'; output: Json }
  | { status: 'accepted'; jobId: string }
  | { status: 'needs_confirmation'; confirmationId: string; summary: string; expiresAt: string }
  | { status: 'denied'; code: string }
  | { status: 'failed'; code: string; retryable: boolean }
  | { status: 'unknown'; idempotencyKey: string }

type NativeActionResponse = Pick<NativeActionRequest,
  'protocolVersion' | 'requestId' | 'workflowId' | 'workflowRevision' |
  'nodeId' | 'actionId' | 'idempotencyKey'> & ActionResult
```

`requestId` and `idempotencyKey` currently equal the JSON tuple string `[workflowId, workflowRevision, runId, nodeId]`; native code must treat it as opaque, not constrain it to the shorter identifier format. Job/confirmation IDs are opaque nonempty strings of up to 512 UTF-16 code units, without C0/C1 control characters (U+0000–001F, U+007F–009F); `external:<requestId>` is accepted. Error codes still use the short identifier format. `expiresAt` must parse as a future timestamp.

Every native status must echo all seven correlation fields exactly, including `protocolVersion: 1`. `registerNativeActions` takes a `NativeActionBridge` returning `NativeActionResponse`, validates bounded detached JSON and every echo against the original request, then strips the envelope and validates the exact generic result fields. The full native response is capped at 64 KiB. Missing, mismatched, malformed or additional fields cause `unknown` after dispatch, never success or automatic replay. For `unknown`, the single envelope `idempotencyKey` is also the generic result key. Local scripts, HTTP, AI and cybsh adapters keep returning plain `ActionResult`; the runner's strict generic-result validation is unchanged.

Android action IDs are not guessed or automatically registered. `registerNativeActions(registry, specs, bridge)` registers only the host's actual IDs, with per-action input validators and read/write classification. `expectedRevision` is forwarded verbatim for native compare-and-set; enforcement belongs to native storage.

## Running and authorization

```ts
const registry = createAutomationRegistry() // core.script only
registerNativeActions(registry, implementedNativeSpecs, nativeBridge)
const runner = new WorkflowRunner({
  registry,
  journal: durableAtomicClaimJournal,
  authorize: async (request, effect, signal) => hostPolicy(request, effect, signal),
})
const result = await runner.run(workflow, {
  runId: explicitLogicalRunId,
  expectedWorkflowRevision: workflow.revision,
  signal,
})
```

The full graph is checked for unregistered actions before the first effect. Each actual action validates its resolved input and passes through host authorization. There is no permissive default policy. Authorization and dispatch receive separate detached envelopes so a permission hook cannot rewrite the operation.

A journal atomically claims the key **before dispatch**. Duplicate/concurrent attempts and uncertain claims return `unknown`, never replay. `MemoryExecutionJournal` is session-only and NOT crash-safe; production Android use requires host-supplied durable claims shared across all runners, with atomic persistence before effects. Native code must enforce the same idempotency key. This provides at-most-one runner dispatch per claimed key, NOT exactly-once completion. A crash after claiming but before dispatch can also leave an unknown outcome.

Only a literal boolean `true` from the journal permits dispatch; truthy malformed responses remain `unknown`. Run options are shallow-snapshotted before callbacks so caller mutations cannot change the logical run ID between nodes or swap the cancellation signal used for cleanup.

`runId` names a user-authorized logical execution, not an automatically regenerated retry token. Host persistence must bind a run ID to its immutable workflow revision/content. Revision monotonicity, ownership and authorization freshness are host responsibilities. Running with a new ID deliberately allows another operation and must not be used to conceal an uncertain previous result.

Only `succeeded` advances the graph. Every other result halts it. `accepted` is not completed; the host owns job observation. `needs_confirmation` is not approval; the host/native bridge owns expiry, approval binding and execution. There is deliberately no approval token parameter or implicit resume/retry API. Re-running a claimed node does not resume it. Persistent continuation after jobs/approvals requires a separately reviewed host checkpoint protocol.

Action timeout defaults to 30 seconds (max 60); total run defaults to 120 seconds (max 300). Cancellation/timeout races bound non-cooperative promises but cannot undo already-dispatched native effects. Exceptions, cancellation and invalid responses after dispatch become `unknown`. Adapters must cooperate with cancellation and must not run CPU-blocking code in the JS main thread; synchronous trusted callbacks cannot be forcibly preempted here. The engine does not automatically retry even when `retryable: true`.

## Available adapters

- **`core.script`**: deterministic pipelines, 1–32 steps, each `{id, op, args}`. Operations: `value`, `text.concat/upper/lower/trim`, `math.add/subtract/multiply/divide`, `json.parse/stringify`. Args are scalars or `{from: earlierStepId}`. Total intermediate storage is capped at 64 KiB. No JavaScript, filesystem, network, variables with executable text or shell evaluation.
- **`core.http`**, opt-in via `http` options: structured URL/method/headers/body, not a command-line cURL parser. HTTPS exact-origin allowlist, fixed header policy, no redirects/retries, streaming response caps, cancellation and bounded timeouts. HTTP is conservatively write-classified, including GET, since servers can implement effects. HTTP transport hard ceilings are 30 seconds, 64 KiB request body and 1 MiB response body; the runner's 64 KiB serialized action-output cap is additionally enforced, so select smaller response limits when integrating. Non-2xx HTTP statuses remain returned data for workflow predicates; they are not automatically retried.
- **`core.cybsh`**, opt-in: `{commandId, args}`. Only host-provided command IDs register. The bridge MUST dispatch an approved command directly with data arguments; never concatenate them into `os.exec`, a shell, pipes or command strings. Permission enforcement and allowed argument semantics remain the host validator's responsibility.
- **`core.ai.invoke`**, opt-in: `{agentId, prompt, context}`. Named host agent IDs only. Host owns provider credentials, approval requirements and agent tool permissions. Agent output is untrusted data; it cannot register actions or replace workflow code. Network/paid/side-effect-capable agent invocation is conservatively write-classified.

AI and cybsh adapters must return the same result union. Unknown integrations are absent rather than advertised as implemented. This module is not a claim of access to every Android API or third-party app. Android capabilities, permission prompts, intents, background execution restrictions, scheduling, app availability and JNI wiring belong to Sys's separate native implementation.

## Secrets and trust boundaries

Credential-shaped fields such as `password`, `token`, `api_key`, `authorization` and `private_key` must be `{secretRef: 'vault.id'}`, never literal credentials. The HTTP adapter resolves authorization only at the transport boundary. Secret references are identifiers, not substituted strings; include any required authorization scheme in the vault value. Generic action adapters must similarly keep plaintext credentials outside saved workflows.

The same credential-key policy applies recursively to generic/native results before publishing outputs or resolving downstream references. A secret-bearing or otherwise malformed result after dispatch becomes `unknown`, without exposing the rejected payload. Direct script calls snapshot and bound input before execution and cap the final result, including the duplicated `last` value, at 64 KiB.

Direct HTTP calls also snapshot bounded JSON before reading fields or awaiting secret resolution, rejecting getters/custom prototypes and preventing mutation of pending vault references. Fetch explicitly uses `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`: browser cookies, ambient HTTP authentication and referrer URLs are not implicit authority. Cancellation is rechecked inside deferred fetch/vault callbacks before invoking them. Resolved authorization values (and Bearer/Basic credential payloads) must not appear literally in returned body/content-type; such echoes throw the fixed `secret_response` error and become `unknown` through the runner. This is literal echo detection, not general information-flow tracking or protection against encoded/transformed leaks.

This check cannot recognize a credential hidden in arbitrary text, a URL query, a script string or an innocuously named field. Import/editor validators and trusted bridge adapters must enforce service-specific credential schemas and forbid secret interpolation into bodies/prompts/URLs. This engine has no logger and does not log inputs, outputs, resolved credentials, request bodies or raw exceptions. Returned outputs are private data, not automatically safe telemetry. Host UI/storage/logging must redact appropriately; adapters must not put secret material into codes or confirmation summaries.

Allowed origins are an explicit trust boundary, not DNS pinning. Native/network transport must prevent DNS rebinding/private destination access where required. Browser fetch is also subject to CORS and cannot promise arbitrary cross-origin access.

Sources reviewed: [MDN Fetch options](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit), [MDN Fetch response streaming](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch), [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted), [OWASP sensitive data excluded from logs](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

## Verification

```sh
npx vitest run tests/frontend/automation-*.test.ts
npx vue-tsc --noEmit
```

No package/dependency changes are required. No files outside `src/automation/` and the new `tests/frontend/automation-*.test.ts` files are part of this module's implementation.

## Canonical editor repository/service contract v1

The editor and native host share the exports from `src/automation/index.ts`; do not create a second workflow schema, mock repository, parallel execution adapter or UI-owned execution journal. `AUTOMATION_REPOSITORY_VERSION` is `1`, independent of the unchanged workflow `schemaVersion: 1` and native `protocolVersion: 1`.

```ts
import {
  IndexedDBAutomationStorage, WorkflowRepository, WorkflowService,
  createAutomationRegistry, registerNativeActions,
} from './automation'

// Host supplies a stable authenticated owner/environment namespace. Never use the
// existing handles database. A separate name prevents development/owner mixing.
const storage = new IndexedDBAutomationStorage({
  databaseName: hostAutomationDatabaseName,
})
const repository = new WorkflowRepository(storage)
const registry = createAutomationRegistry(hostOptionalAdapters)
registerNativeActions(registry, implementedNativeSpecs, nativeBridge)
const service = new WorkflowService({
  repository, registry, authorize: hostPolicy,
  // journal: nativeDurableJournal, // optional stronger native implementation
})

const validation = service.validate(editorWorkflow)
if (!validation.valid) showValidationIssues(validation.issues)
else {
  const saved = await repository.save(validation.workflow, {
    name: 'My shortcut', expectedRevision: null, // creation must be revision 1
  })
  const result = await service.run(saved.workflow.id, {
    runId: userAuthorizedLogicalRunId,
    expectedWorkflowRevision: saved.workflow.revision,
    signal,
  })
}
```

Concrete repository signatures:

```ts
interface WorkflowRecord {
  recordVersion: 1
  workflow: Workflow
  name: string // trimmed, 1–160 code units; no control characters
  updatedAt: string // informational ISO timestamp, not the CAS token
}
interface SaveWorkflowOptions { expectedRevision: number | null; name: string }

new WorkflowRepository(storage: AutomationStorage)
repository.durability: 'persistent' | 'session'
repository.executionJournal: ExecutionJournal
repository.get(id: string): Promise<WorkflowRecord | null>
repository.list(): Promise<WorkflowRecord[]>
repository.save(workflow: unknown, options: SaveWorkflowOptions): Promise<WorkflowRecord>
repository.delete(id: string, expectedRevision: number): Promise<void>
repository.importWorkflow(json: string, options: SaveWorkflowOptions): Promise<WorkflowRecord>
repository.exportWorkflow(id: string): Promise<string>
repository.bindRun(workflow: unknown, runId: string): Promise<void> // called by service
```

Creation requires `expectedRevision: null` and workflow revision `1`. An update requires the stored revision as `expectedRevision` and a workflow revision exactly one greater, even for a name-only update. CAS happens inside one IndexedDB read/write transaction, not via `vault_kv_get/set`. Concurrent creators/updaters cannot both win. On `AutomationRepositoryError`, use its fixed `code`; do not expose raw storage errors. A stale revision is `revision_conflict`. Deleted IDs remain tombstoned and cannot be recreated: copy to a **new workflow ID**, starting at revision 1. This prevents reusing prior revision/idempotency identities. Lists omit tombstones and fail closed on malformed records rather than silently hiding corruption. Imports are bounded workflow JSON only; exports contain the workflow schema, not metadata, credentials or execution output. Saving/importing enforces structural schema/secrets, while the service additionally checks the active action registry.

Concrete service signatures:

```ts
new WorkflowService(options: WorkflowServiceOptions)
// Options: repository, registry, mandatory authorize, optional journal and runner limits.
service.listActions(): ReadonlyArray<{ id: string; effect: 'read' | 'write' }>
service.validate(value: unknown): WorkflowValidation
// { valid: true, workflow: Workflow, issues: WorkflowValidationIssue[] }
// | { valid: false, issues: WorkflowValidationIssue[] }
// issue: { code, severity: 'error' | 'info', nodeId?: string }
service.run(id: string, options: {
  runId: string; expectedWorkflowRevision: number; signal?: AbortSignal
}): Promise<WorkflowServiceRunResult>
// Existing RunResult, OR { status: 'rejected', code, issues? }
// rejection codes: not_found, revision_conflict, invalid_run, validation_failed,
// run_conflict, storage_unavailable.
```

Validation does not authorize, dispatch, resolve vault references or claim execution keys. It checks every registered action, validates literal inputs with the same registered validators, and conservatively rejects action bindings whose source is not definitely available on **every** incoming path (`binding_not_available`). It does not infer branch predicate implications. Dynamic inputs carry informational `input_deferred`; resolved values and their exact paths/types remain checked by the existing runner immediately before authorization. Predicate missing-output/`exists` behavior is unchanged. Registered input validators must be pure host functions; a valid preflight is not permission or a guarantee that a later dynamic/native operation succeeds.

`run` loads and captures a **saved** revision; it cannot execute an unsaved editor object. The required expected revision is checked against that snapshot. Later edits/deletion do not cancel already captured or dispatched executions; cancellation requires the supplied signal and cannot undo effects. Before passing the snapshot to the unchanged runner, the repository atomically binds `[workflowId, runId]` to its complete immutable workflow. Reusing that logical ID with another revision/content returns `run_conflict`, including after service recreation. Repeating it with identical content is still subject to the original per-node claim journal and returns `unknown` for previously claimed effects, not replay or resume. No automatic retry, approval submission or checkpoint continuation has been added. `accepted`, `needs_confirmation`, `denied`, `failed`, `unknown` retain exactly the existing runner/native meanings. The host must not regenerate a run ID to bypass an ambiguous result.

Storage exports: `AutomationStorage` (`get`, prefix `list`, atomic synchronous-callback `update`, `durability`), `MemoryAutomationStorage`, `IndexedDBAutomationStorage`, `IndexedDBAutomationStorageOptions`, and `StorageExecutionJournal`. The memory store is explicitly **session-only**, suitable for tests/previews, and is never selected as a silent fallback. IndexedDB uses a dedicated version-1 database/store `automation`, requests strict-durability write transactions, and resolves writes/claims only on transaction completion. A runtime that rejects those transactions fails closed. Storage failures are `storage_unavailable`/`storage_failure`; repository callback errors retain their typed codes. Database namespace selection, owner authentication, account switching and database lifecycle belong to the host; use one stable owner-specific name per environment, and discard the old service on logout. This namespace is not an access-control or encryption boundary.

Persistent claims and bindings are never automatically purged. Storage quota/eviction, database clearing, profile loss or a different namespace can erase browser-side history; IndexedDB is **not** a substitute for native idempotency enforcement or a native crash-proof journal. Production Android must keep Sys's native duplicate/permission safeguards and supply a stronger journal when required. Only workflows/secret references, bounded metadata, immutable run bindings and claims are stored; action inputs after secret resolution, results, prompts generated at runtime, approval tokens and raw errors are not persisted. Arbitrary text can still conceal credentials beyond schema detection: service-specific adapters/editors must enforce their credential policies. No plaintext credential store or non-atomic vault fallback is introduced.
