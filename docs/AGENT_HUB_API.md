# Agent Hub API — native v1, protocol revision 3

**Recipient-targeted, tool-less, one recipient per run.** Group conversations are containers for explicit messages, not group fan-out, multi-agent collaboration, or autonomy. There is no recursive delegation, automatic recipient selection, swarm, or tool execution. The runtime now requires compact typed JSON for profile-to-profile coordination; this is a serialization contract, not a secret or universally optimal LLM language. Facts can retain task-specific human-language values. User-facing replies remain concise natural language.

The Hub is native Tauri IPC backed by a separate `agent-hub.redb` in the application data directory. The trusted owner is the host principal `local`; clients cannot supply owners. This release has no Hub REST/WASM surface. Profiles share the native host process and existing provider configurations; they are not remote agent servers or independent sandboxes.

## Commands

Existing command signatures remain unchanged:

```ts
hub_list_profiles(): AgentProfile[]
hub_save_profile({ input: ProfileInput }): AgentProfile
hub_create_conversation({ input: CreateConversation }): Conversation
hub_list_conversations(): Conversation[]
hub_send_message({ input: SendMessage }): SendReceipt
hub_list_events({ conversationId: string, afterSeq?: number, limit?: number }): HubEvent[]
hub_list_transcript({ conversationId: string, afterSeq?: number, limit?: number }): HubTranscriptEvent[]
hub_get_run({ runId: string }): DelegatedRun
```

For native clients use `invoke<T>('hub_send_message', { input })`. Fields serialize as camelCase except the deliberately compact coordination envelope/reference keys below. The authoritative DTOs are `crates/types/src/agent_hub.rs` and `crates/types/src/coordination.rs`; machine-readable definitions are in `docs/agent-hub.schema.json`, `$id: urn:cybermanju:agent-hub:v1:r3`.

`hub_list_events` remains a legacy event-feed command and returns `HubEvent[]`; it is not the transcript DTO. `hub_list_transcript` returns the dedicated `HubTranscriptEvent[]` projection and defaults to `afterSeq: 0`, `limit: 100` (accepted/clamped range 1–500). Sequence numbers are conversation-local; advance the cursor to the highest returned sequence. `HubTranscriptEvent` has exactly these required fields: `id: string`, `conversationId: string`, `seq: u64`, `visibility: "user"`, `kind: HubEventKind`, `senderId: string | null`, `text: string`, and `createdAt: string`. It has no recipient, run, owner, provider, or other private fields. The DTO rejects unknown fields (`serde(deny_unknown_fields)`). The backend facade `agent_hub_api::list_transcript(db, hub, owner, conversation_id, after_seq, limit)` explicitly filters for `visibility == User`; it sanitizes every String field, including identifiers and timestamp, using `known_keys` plus `scrub_known_secrets` before serialization and never re-redacts serialized JSON. Missing/unknown visibility causes a closed decode error without payload; internal, migrated, and quarantined rows are omitted without recovery or inference. Sequence numbers may have gaps. Scan work may grow across internal rows. The older `hub_list_events`, `hub_get_run`, and `SendReceipt` are not transcript DTOs. The UI remains `available: false` and is not changed by this contract.

## Disclosure contract for the UI

Every durable `HubEvent` and `DelegatedRun` has a required **`visibility: "user" | "internal"`**. Never infer visibility from `kind`, sender identity, or the shape of `text`. Unknown/missing visibility must not be rendered as public chat. The same `assistant` kind can carry either visibility.

A normal user send has no `senderId` and is assigned `user` by the host. Its assistant/error event retains `user`. An owner-initiated profile-targeted delegation supplies a member `senderId` label and a different member `recipientId`; the host assigns `internal` to both its delegation and terminal event/run. **Every send is initiated by the authenticated owning user/host, not by an authenticated agent actor. `senderId` is a routing/persona label, not verifiable agent authorship.** This API does not provide autonomous or cryptographically authenticated agent-to-agent sending. Clients cannot set the visibility field. Internal failures are typed `blocked` envelopes. The host does not authorize a model to choose routes, visibility, memberships, tools, or recipients.

**UI integration requirement:** render only `visibility === "user"` as user conversation. Do not show internal `text`/`run.result` as ordinary assistant bubbles, do not infer collaboration, and keep the label “recipient-targeted, tool-less, one recipient per run.” No UI or Android changes are included in this backend slice.

New run output also includes `profileSnapshot: AgentProfile | null`: the public recipient descriptor fixed at send time, never a generated prompt or system/private instructions. A null legacy snapshot cannot be dispatched through the new projection path. It is not automatic learning or private agent memory.

## User-visible sends stay natural language

```ts
const receipt = await invoke<SendReceipt>('hub_send_message', { input: {
  conversationId, idempotencyKey: crypto.randomUUID(),
  recipientId, text: 'Summarize these notes.',
  selectedContext: ['Explicitly selected public task data'], toolGrants: [],
} })
```

No `senderId` means the owning user. Without `recipientId` this records a user message without dispatch. The output policy requests a concise natural-language user reply, not an envelope. User chat text is not compressed or rewritten to save tokens; existing credential redaction and size validation still apply. The runtime is not a semantic verifier of arbitrary natural-language model claims.

## Internal coordination envelopes

An owner-initiated delegation carrying a profile sender label must use bare JSON in the existing `SendMessage.text` field:

```json
{"v":1,"op":"task","data":[{"k":"goal","v":"Extract the city"}],"refs":[]}
```

The existing sender/recipient routing remains outside the model-generated envelope. `op` is exactly `task`, `result`, or `blocked`. Internal ingress requires `task`; internal provider output requires `result` or `blocked`:

```json
{"v":1,"op":"result","data":[{"k":"answer","v":"São Paulo"}],"refs":[]}
```

The host rejects unknown fields, unknown versions/operations, empty data, duplicate fact keys, Markdown fences, prose, malformed JSON, tool calls, and caller/model-supplied nonempty `refs`. Each operation requires a nonblank fact value: `task` requires `goal`, `result` requires `answer`, and `blocked` requires `reason`. Additional unique bounded facts are allowed. These are strict required-field rules, not a claim that arbitrary domain facts are semantically verified. There is no lossy repair, automatic prose acceptance, second provider call, or schema-downgrading retry. An invalid provider response fails the run with a fixed error and a host-authored internal `blocked` event, without persisting rejected output.

Bounds are 32 facts; nonempty unique keys ≤64 UTF-8 bytes; each value ≤2,048 UTF-8 bytes; aggregate key/value bytes ≤16,384; parsed JSON ≤65,536 bytes. Public send input remains ≤16,384 UTF-8 bytes, so that smaller ingress bound also applies to serialized internal tasks. **These are resource/byte limits, not token estimates.** JSON Schema string lengths cannot replace Rust's UTF-8 byte checks.

## Canonical events versus prompt projection

The canonical event is append-only task/audit data, not a prompt transcript. Sending atomically persists its event, run, immutable public recipient snapshot, source-event sequence index, and idempotency receipt. Dispatch reads the source via an owner/run-scoped constant-key index; it never scans/imports conversation history. Terminal event and run status commit together.

The ephemeral `PromptProjection` is built separately and never saved/logged as a prompt. It contains:

```ts
type EventReference = { e: string; s: number; f: string; b: number; h: string }
type PublicRecipientDescriptor = { name: string; personality: string; goals: string[]; interests: string[]; knowledge: string[] }
type CoordinationEnvelope = { v: 1; op: "task" | "result" | "blocked"; data: { k: string; v: string }[]; refs: [] }
type ProjectionItem = { ref: EventReference; value?: string | CoordinationEnvelope | PublicRecipientDescriptor }
type PromptProjection = {
  v: 1; recipientId: string; sourceEventId: string; sourceSeq: number;
  items: ProjectionItem[];
}
```

`e` is the source event id, `s` its sequence, `f` the field namespace, `b` the UTF-8 length of the marker-redacted value, and `h` its lowercase BLAKE3 digest. `f: "text"` refers to the source delegation task. `contextN` refers through that event's `runId` to the immutable run's `selectedContext[N]`. `profile` refers through the same link to the descriptor (`name`, `personality`, `goals`, `interests`, `knowledge`) derived from its immutable public `profileSnapshot`. No reference authorizes fetching other history, files, secrets, or private memory. There is no reference-resolution tool/API in v1.

Projection construction is deterministic for the saved run/source and profile route. It reserves all references, then fits complete values in fixed order: task, selected context, public recipient descriptor. It never truncates or paraphrases values. Internal tasks are nested typed envelope objects, not JSON strings inside JSON; public recipient descriptors are typed objects as well. Only natural-language user tasks and explicitly selected context remain strings. Reference-only items omit `value` explicitly. The maximum serialized projection is **32,768 UTF-8 bytes**, at most 24 items. The dispatch boundary refuses a reference-only essential task or selected-context item; it never silently asks the model to solve a task without the selected input. A large public descriptor can remain reference-only, and policy forbids inventing its contents. It may be safer to keep personas small.

Exact backend signatures:

```rust
hub_protocol::parse_envelope(text: &str) -> Result<CoordinationEnvelope, String>
hub_protocol::canonical_envelope(text: &str) -> Result<String, String>
hub_protocol::project(profile: &AgentProfile, run: &DelegatedRun,
    source: &HubEvent, max_bytes: usize) -> Result<PromptProjection, String>
hub_prompt::build_projected_messages(profile: &AgentProfile,
    run: &DelegatedRun, source: &HubEvent) -> Result<Vec<ChatMessage>, String>
hub_prompt::output_policy(dialect: LlmDialect,
    visibility: EventVisibility) -> &'static str
hub_prompt::scrub_envelope(text: &str, secrets: &[&str]) -> Result<String, String>
AgentHubStore::audit_events(&self, owner: &str, conversation_id: &str,
    after_seq: u64, limit: usize) -> Result<Vec<HubEvent>, String>
AgentHubStore::source_event(&self, owner: &str,
    run: &DelegatedRun) -> Result<HubEvent, String>
```

`build_messages` is retained only as the pre-projection test/benchmark baseline; production Hub dispatch uses `build_projected_messages`.

## Providers, fallback, isolation, and credentials

Only the existing OpenAI- and Anthropic-dialect adapters are supported. A dialect is not proof that a model/gateway supports native JSON Schema or JSON mode. Both use the conservative portable **text transport + strict local envelope validation** path; unsupported vendor schema fields are not sent. There is no provider/model failover or request retry in Hub runs. Schema-invalid output fails closed. This fallback preserves validation, not guaranteed model accuracy.

The platform/output policy is constant system text. Saved persona, task, and selected context are untrusted user-message data and cannot grant permissions. Each run projects only its addressed recipient's immutable public descriptor and explicitly selected task data. No sender transcript, sender persona/knowledge, tools, private memory, sessions, classic fallback chain, or arbitrary history is inherited. Current owner/profile/provider routing is rechecked before I/O. Editing a profile later does not change the saved run's descriptor.

Credentials remain in the original sealed provider storage (`agent:key:<configId>`) and go only into auth headers. Known credentials and marker patterns are scrubbed at public-data ingress and output. For coordination JSON, parsing decodes escapes first; the host sanitizes each decoded `Fact.k`/`Fact.v` before semantic revalidation, canonicalization, or persistence. Unicode escapes therefore cannot hide an exact sealed key from the scrubber. Redaction-induced key collisions reject the envelope before persistence. If a rotated/current credential is found in the already-hashed request, dispatch refuses rather than silently changing projection content/hashes. The outbound guard is a read-only recursive visitor over the structured request `serde_json::Value`: it checks decoded strings and object keys for exact nonempty known current provider credentials, including quote/backslash and multiline PEM values. Because message content contains a serialized projection, valid embedded JSON strings are inspected recursively too, with an explicit 128-level inspection bound. JSON-looking malformed strings fail closed; ordinary prose stays literal except for the bounded JSON/Unicode inspection described below. This is not generalized decoding of arbitrary obfuscation. The guard never redacts, mutates, or reserializes the request, and runs before provider I/O. Projection and baseline rendering sanitize individual decoded fields before serialization; reference hashes cover the exact sanitized values, never a second redaction of serialized JSON. Query-string authentication remains unsupported. Built request bodies, private/system prompts, credential values, provider diagnostic bodies, and rejected output are not persisted or logged. Public error messages use fixed descriptions; exact full policy echoes are suppressed on output. These controls do not constitute a semantic guarantee against every paraphrased model disclosure or every possible unknown secret inside caller-selected task text.

**Security blocker for any future tools:** Sys identified a separate permission bypass in the classic browser/Rust tool executors. Those executors are outside this change and remain untouched. That issue must be resolved and independently reviewed before enabling any Hub grants, tool dispatch, or tool-enabled A2A. Every nonempty `toolGrants` remains rejected at ingress and execution; the request contains no tools, and provider tool calls are refused.

The outbound guard checks strict JSON fragments and bare `\uXXXX` escapes in prose only when a backslash or a bounded leading marker/placeholder makes further inspection necessary; ordinary unescaped prose without such a token is checked for exact known credentials but is not recursively decoded. Unicode decoding uses inspection-only copies and the same shared depth/byte/value budgets; nested escapes are rechecked, surrogate pairs are validated, and invalid surrogate sequences fail closed. JSON-looking candidates with duplicate decoded keys, numeric range failures (such as `1e400`), malformed syntax, or parser recursion exhaustion are **rejected**, not silently treated as ordinary prose. Standalone `[REDACTED]` markers in prose (including trailing punctuation) and word-only placeholders such as `{schema example}` are not JSON candidates, so unrelated Windows paths do not abort scrubbed tasks; the remaining suffix is still inspected. Marker prefixes/suffixes are not exempted; exact credential checks and budget charging precede every exception. This protection covers exact known current provider credentials and the inspected JSON/Unicode escape forms, **not arbitrary reversible encodings**, unknown secrets, or semantic model disclosures.

The visitor keeps the parser's recursion guard enabled and additionally bounds cumulative inspected string/key bytes to 1 MiB and visited values to 65,536 across nested decodes; exceeding either budget fails before provider I/O. These are inspection safety limits, not token or latency measurements. Private-key PEM sanitization removes complete blocks (including multiline LF/CRLF and ANSI-wrapped forms) on decoded fields, independently of exact saved-key matching; unterminated blocks fail closed rather than preserving their trailing material. Canonical envelopes and projections are serialized only after field sanitization.

## Delivery, idempotency, and resource bounds

A receipt proves persistence, not provider completion. Poll `hub_get_run` and/or `hub_list_events`; terminal status is `completed` or `failed`. A returned original receipt may still contain a `pending` snapshot after execution: use `hub_get_run` for current state.

Same owner/conversation/idempotency key and canonicalized payload returns the original receipt without another provider request. A changed payload returns `conflict:`. Exactly one worker can claim a pending run. If completion is rejected during the store transaction, the worker uses a new transaction to mark the run failed with a fixed error; it does not strand a running run on a validation rejection. If storage itself is unavailable, durable terminal persistence cannot be guaranteed and restart recovery remains necessary. OpenAI `length` and Anthropic `max_tokens` finishes are rejected even when the partial text is valid JSON; non-normal finish reasons cannot become successful text replies. The runtime allows 8 host-wide workers, one provider turn, a 120-second HTTP timeout, a 256 KiB provider response, and 64 KiB user output. It does not retry ambiguous interrupted provider calls. Host restart marks pending/running runs failed; use a new idempotency key for an explicit retry.

Errors retain the established prefixes including `not_found:`, `invalid:`, `unsupported:`, `conflict:`, `auth:`, `rate_limited:`, `network:`, `too_large:`, `limit:`, and `integrity:`. Arbitrary provider error prose never enters the durable failure event.

## Legacy migration

On opening an existing Hub file, one transaction adds explicit `internal` visibility to every event/run/receipt snapshot missing it, regardless of kind. This intentionally fails closed: **legacy user chat is not automatically reclassified as visible**, and legacy payloads may remain prose. Such rows are quarantined legacy audit data, not new validated coordination messages. New events always carry an explicit disclosure class. The migration does not infer safety from event kind, rewrite old task text, or replay a provider request. Missing legacy profile snapshots cannot be used for new dispatch. Keep the existing database backup/export discipline before integration.

### Separate owner-only quarantine listing

`AgentHubStore::quarantined_legacy_events(owner, conversation_id, after_seq, limit)` is implemented in the backend and returns only `QuarantinedLegacyEvent { seq, reason }`. It authorizes the conversation against the host-assigned owner before even handling an exhausted cursor. It never returns text, kind, sender, event/run IDs, timestamps, persona or provider data; never changes visibility; and never invokes a provider. Entries live in a separate durable `hub_legacy_quarantine` index, committed atomically with the migration and its version marker. Reopening is idempotent.

`reason: "missingVisibility"` means the row had no visibility at migration. **Already-v2 databases have irreversibly lost that provenance:** their existing internal rows are conservatively listed once as `"legacyProvenanceUnavailable"` candidates. Some candidates may have been intentionally internal all along; neither backend nor UI may label them definitely user-authored or safe to publish. No kind/text heuristic is used. Explicit internal events created after the quarantine upgrade are not added. Existing visible records remain visible and are not listed.

Exact contract for Housaky and the native host integrator (**proposed command, NOT wired by this backend-only patch**):

```ts
type QuarantinedLegacyEvent = {
  seq: number;
  reason: "missingVisibility" | "legacyProvenanceUnavailable";
};
hub_list_quarantined_legacy_events({
  conversationId: string, afterSeq?: number, limit?: number
}): QuarantinedLegacyEvent[]
```

The future command must derive `owner` from the trusted host principal (currently `local`), accept no caller owner, default `afterSeq` to 0 and `limit` to 100, and delegate only to the metadata listing, **never `audit_events`**. Limit is clamped to 1–500, ascending conversation-local `seq`; advance a separate quarantine cursor to the last returned `seq`, and an empty page means no more entries at that instant. Cross-owner/missing conversations return `not_found:`; invalid identifiers return `invalid:`; storage/index mismatch returns fixed `integrity:` without raw values.

UI: use a separate explicit owner action such as “Check hidden legacy history,” show only sequence and reason with an uncertainty warning, and keep these entries out of the normal transcript, run details and provider context. Do not offer “Restore to chat” or fetch raw audit contents. **Content recovery/publication is intentionally unavailable** until there is a reviewed owner-confirmed, current-secret-aware export/recovery path. This safe discovery fallback is not content restoration. Housaky owns UI; the host integrator owns command registration; neither layer is changed here, and agreement/wiring remains an integration gate.

The separate redb file has Unix mode 0600 where applicable, but is not claimed encrypted at rest or automatically included in the main vault's sync/export. Provider configurations still live in the shared legacy database and are not owner-bound: this API remains trusted-native `local` only, and is not REST-ready until provider ownership/authorization exists.

## Token, latency, and accuracy gates

Compact JSON is not claimed to be the fastest, most accurate, or most token-efficient language for all models. Reference metadata can cost more tokens on short tasks. Byte limits do not demonstrate token savings.

Rust tests cover strict envelopes, duplicate/unknown keys, version/operation rejection, UTF-8 bounds, route/source/visibility matching, immutable snapshots, deterministic projections, lossless essential input, owner isolation, replay, restart, schema-invalid output, and tool-less requests. Mock-provider tests cover recipient routing and exclusion of sender history/knowledge. Rust compilation/tests must run in CI; repository rules prohibit local Cargo/rustfmt here.

The optional Rust test `hub_prompt::tests::export_runtime_benchmark_cases_when_requested` writes synthetic public arithmetic, Unicode extraction, and abstention tasks using the actual Rust baseline/projection builders when `HUB_BENCHMARK_CASES` is set. In the approved CI Rust environment:

```sh
HUB_BENCHMARK_CASES=/tmp/hub-cases.json cargo test -p cybermanju-agent export_runtime_benchmark_cases_when_requested
HUB_BENCHMARK_CASES=/tmp/hub-cases.json python3 -m unittest discover -s tests/protocol -p 'test_*.py' -v
python3 scripts/benchmark-hub-protocol.py /tmp/hub-cases.json --tokenizer tiktoken --tokenizer-model gpt-4o --iterations 5
# Only with explicit authorization for provider traffic and a selected model:
OPENAI_MODEL=<selected-model> python3 scripts/benchmark-hub-protocol.py /tmp/hub-cases.json --live --iterations 20
```

The exporter writes `runtimeBodies: true` cases containing actual `AgentTurn::build_request` OpenAI request bodies, with the same current internal output policy held constant for baseline and projection. The harness sends those bodies without its generic `prompt_for` wrapper and changes only the explicitly selected adapter model. It uses actual `usage.prompt_tokens` when available, otherwise a real named tokenizer over each actual text-content part, never bytes/token ratios. Content-only tokenizer totals exclude chat framing; source/mixed-source reporting distinguishes them from provider usage. String-only cases remain a synthetic harness path and are not runtime evidence. Unsupported dialect/multimodal request bodies are not converted or estimated. Paired randomized samples report provider-round-trip latency p50/p95 and exact typed golden correctness. These are provider request experiments, not APK end-to-end timings. Unavailable tokenizer/usage, offline latency, and offline semantic accuracy are explicitly `indisponivel`. Synthetic/fake-adapter test success proves the harness, not LLM accuracy. No live-model speed, cost reduction, or accuracy result is claimed by this implementation.

Local non-Rust gates:

```sh
python3 -m unittest discover -s tests/protocol -p 'test_*.py' -v
python3 scripts/benchmark-hub-protocol.py --self-test
bash scripts/check-version.sh
bash scripts/check-file-headers.sh
git diff --check
```

Membership is fixed at conversation creation. There are no member-edit/delete, streaming, attachments, voice, remote-host A2A, group scheduler, or autonomous collaboration commands in this revision.
