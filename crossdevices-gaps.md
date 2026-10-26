# Cross-device implementation plan

This file tracks the cross-device audit and implementation. “Done” means the
feature is connected end-to-end across supported transports, has explicit
failure behavior, and has regression coverage. Existing helpers or endpoints
alone do not count as a user-visible implementation.

## Scope

Targets: desktop Tauri, Android/iOS Tauri, REST dashboard, and browser/WASM.
Cross-device means data deliberately shared between separately installed app
instances, with clear ownership, authentication, encryption, conflict handling,
and offline/retry behavior. It does not mean pretending host-only features are
available in a browser sandbox.

## Implemented paths and platform state

| Path | Current implementation | State |
|---|---|---|
| Local mutation → journal | Shared REST/Tauri create, duplicate, move, rename, tag, delete, restore, editor metadata and native import paths now commit file row/index/trash state with the op row in one redb transaction. Stars remain browser-profile-local; loose-group, face-group, and todo rows remain best-effort. | Partial; host bytes are separate and incoming ops are not replayed |
| Local journal → signed batch | `pendingLocalOps` → Tauri `sign_peer_ops_for_device` → `POST /api/oplog/push` locally and `POST /api/peers/{deviceId}/sync` to peer. | Native Tauri only |
| Remote batch → local proof store | `GET /api/oplog/batches` → verify registered ML-DSA key → `oplog_merge_batch` / `POST /api/oplog/batches` → immutable proof + conflict index transaction → save profile cursor. | REST + Tauri; browser signer unavailable |
| Peer enrollment | Copy a public-only invitation from a local seeded identity; import on the other side; compare full SHA-256 fingerprint; configure peer URL and peer-specific sealed token. | Manual reciprocal flow; no signed challenge |
| Peer configuration | `src/utils/peerConnections.ts` stores URL, ids, pin, secret reference and cursor in profile storage; token bytes live in the sealed secret vault. | Tauri supported; browser may store config but cannot sync |
| File bytes / file state replay | No peer chunk endpoint or deterministic reducer consumes signed metadata rows. Configured provider sync and bounded bundles remain separate paths. | Not implemented |
| WebRTC relay | Offerer/answerer helpers handle bounded handshake, candidate ordering, acknowledgements, and cleanup; relay mailbox validates account-owned device ids but not per-message device signatures. | Library helpers only; no product data channel UI |
| QUIC/iroh | Address grammar refuses unsupported transport; UI says unavailable. Relay mailbox is HTTPS signaling only. | Not shipped |
| Static WASM | OPFS/localStorage is profile-local; no native signer command, mDNS, or signed op journal is wired into the static database. | Browser peer sync disabled |

### Target capability and shared-data boundary

| Target | Direct signed metadata exchange | File bytes | Discovery / reachability | State that remains local |
|---|---|---|---|---|
| Desktop Tauri | Supported between explicitly configured peers with peer token + pinned ML-DSA key; currently proof exchange only, not replay. | Provider sync and bounded encrypted bundle paths; peer chunks are not implemented. | LAN discovery plus explicit HTTPS/LAN URL; HTTPS relay is signaling only. | Master keys, private signing keys, window state, browser profile state. |
| Android / iOS Tauri | Same native commands as desktop where the platform build exposes them; physical-device behavior still needs validation. | Provider sync / bounded bundle; no peer chunk channel. | Explicit URL and server presence; multicast is not assumed. | Private keys, OS permissions, local UI preferences and app sandbox paths. |
| REST dashboard | Owner-authenticated signed batch push/pull and immutable proof storage. | Existing provider endpoints; direct peer chunk endpoint absent. | Dashboard origin and API auth; raw web API must remain behind TLS/reverse proxy when remote. | Server-side private device keys, browser profile data and local agent sessions. |
| Static WASM / Pages | Disabled: browser signer/enrollment is absent. Search can fan out only when explicit credentials/CORS/mixed-content policy permit. | OPFS/localStorage profile only; user backup path is separate. | No mDNS; browser-origin CORS and mixed-content rules apply. | Everything in that browser profile unless user exports a backup. |

The current signed exchange shares proof-carrying operation history only. It does
not replicate `FileNode` state, file contents, settings, layouts, or agent
transcripts. A visible unsigned-op count is a local backlog estimate, not a
remote acknowledgement count.

## Audit findings

- [x] Transport foundation exists: Tauri IPC, REST, and WASM have separate
  dispatch paths and platform-specific `unsupported:` behavior.
- [x] Provider-backed file sync exists; secrets are stored separately and
  files are encrypted before remote upload.
- [x] Device identity, ML-DSA signing, owner-bound peer endpoints, LAN discovery,
  presence, relay mailbox, federated search, and bounded sneakernet bundles
  exist as infrastructure.
- [x] Shared REST/Tauri file create/duplicate/move/rename/tag/delete/restore,
  editor metadata and three native import paths append versioned rows. The
  listed DB-backed file state/index/trash changes share one transaction with
  the journal. Stars still live in profile storage; loose/face groups and todos
  remain best-effort, external bytes are not in redb, and incoming rows are
  not applied to file state.
- [x] Immutable signed batches are retained and paged separately from the
  legacy op-log; peer exchange verifies/merges those proofs and advances a
  durable per-peer cursor only after each page succeeds.
- [x] Devices-panel sync requires an explicit peer connection and reports
  progress/errors; no caller bearer is forwarded.
- [ ] Pairing uses manually exchanged public identity invitations and a
  confirmed full fingerprint. A signed challenge flow and browser/WASM signing
  are still absent, so automatic pairing and browser sync are unavailable.
- [ ] P2P file sync does not move normal file contents. Bundles are capped at
  5 MiB/file, 100 files, 50 MiB total; larger file transfer uses provider
  backends, not the peer exchange.
- [ ] App settings, window/layout state, and local agent sessions stored in
  independent local databases/browser profiles do not generally replicate.
- [ ] WebRTC relay now has library-level offerer and answerer helpers, installs
  ICE handling before local descriptions, acknowledges consumed messages, and
  bounds session lifetime. The answerer is not wired into product UI, and
  relay sender identity is still a claimed mailbox field rather than a signed
  per-message proof.
- [ ] QUIC/i​​roh transport is not shipped. Live remote paths are direct
  HTTP(S) and server-assisted HTTPS relay; the API itself has no TLS and must
  not be exposed directly to the public internet.
- [ ] Federated search needs explicit per-peer credentials; static WASM cannot
  use mDNS and is subject to browser CORS/mixed-content restrictions.
- [ ] Device/build parity is not the same as state parity. WASM storage is
  browser-profile-local; unsupported native host APIs remain unavailable.

## Implementation tasks

### P0 — Make the current Sync action correct

- [x] Signed exchange probes, publishes local batches, pulls bounded pages,
  verifies/merges remote batches, refreshes conflicts, and reports progress.
- [x] Peer URL, peer-only credential, local identity, key-pin confirmation,
  and manual public identity invitation are wired in the Devices panel.
- [x] Peer credential is stored in the existing sealed secret vault; HTTP
  omits browser credentials and sends only the configured peer token.
- [x] Per-peer cursor advances only after full page verification and merge;
  retry is idempotent and cursor movement is monotonic.
- [x] Signed pull uses preserved immutable signed batches with origin rows.
- [x] Forwarded batches retain origin owner, timestamp, algorithm, signature,
  hash and source rows; receiver authorization uses a separate local storage
  owner. Reused operation IDs with changed source sequence or content fail.
- [ ] Complete browser/WASM key enrollment, sealed key persistence, and
  ML-DSA signing before enabling browser peer sync.
- [x] Remove or relabel Sync buttons that cannot satisfy the above flow.

### P1 — Replicate actual user data

- [ ] Finish the versioned mutation journal for file create/edit/rename/tag/star,
  trash/restore, and relevant metadata changes. Shared native/REST DB-backed
  create/duplicate/move/rename/tag/delete/restore/editor-metadata and import
  paths now write versioned rows atomically with file/index/trash rows. Close
  direct-writer gaps (including browser stars and best-effort group/todo/face
  paths), define byte-edit crash recovery, and bind every operation to stable
  file/device IDs, causal base, and BLAKE3 content identity.
- [ ] Apply verified operations atomically, preserve conflicts, and expose
  explicit conflict resolution in the UI. Do not infer operation success from
  transport acceptance.
- [ ] Transfer content-addressed encrypted file chunks peer-to-peer with size
  caps, integrity checks, resume cursors, and a fallback to configured provider
  sync. Retain bundles as a bounded offline/import path.
- [ ] Ensure desktop, mobile, REST, and WASM mutations enter equivalent journal
  semantics or clearly label the unsupported operation. Shared native/REST
  file paths and imports now atomically journal the DB state; browser stars are
  profile-local, grouping/todo rows remain best-effort, and WASM has no signed
  peer journal. Additional direct mutation paths and cross-target parity are open.

## Research and design direction

- Keep the existing append-only op-log for audit and compatibility, but do not
  treat a raw `OpRow` as proof. Add an immutable `SignedOpBatch` journal that
  stores the exact origin rows + signature + algorithm + owner + batch hash;
  never rewrite a batch's rows. Its receiver-local `batch_seq` is only a paging
  cursor and is never included in the sender's signed bytes. Incoming batches
  verify against the enrolled non-revoked device key, then atomically persist
  the unchanged origin envelope under a separate receiver-local owner scope
  and idempotently merge rows into the legacy conflict log. The
  envelope's `ownerId` is provenance from the authenticated source, not a
  signature field; authorization comes from the enrolled device key and the
  receiver's authenticated local owner scope.
  pulling client persists a cursor only after every batch in the page verifies
  and merges. Retry uses stable batch hashes and is idempotent. A signed
  Merkle-root checkpoint is a future scale-up; it adds inclusion/consistency
  proofs and key-rotation/revocation semantics not needed for bounded pages.
- Separate *created*, *signed*, *published*, and *received* states. Mutations
  first append unsigned local rows; an enrolled device signs a bounded batch
  with its sealed ML-DSA key, stores/publishes that proof, and may retry the
  same batch. A receiver never re-signs a foreign row. Rows whose device id has
  no active local signing key stay local-only and are never forwarded.
- Peer config is a versioned record: peer device id, normalized base URL,
  user-supplied peer token sealed by the existing secret store, pinned public
  key fingerprint, and cursor. The current account bearer is never reused for
  outbound peer requests. Enrollment is mutual: compare/pin the key fingerprint
  out-of-band or verify a signed challenge; registry display names are not
  identity proof.
- Conflict detection is informational until replay semantics exist. The first
  safe release can merge verified journal history and surface conflicts; it
  must not mutate FileNode state by guessing how an arbitrary op payload should
  apply. The next versioned mutation schema defines deterministic reducers,
  with content fetched and verified before a content-referencing op applies.
- File metadata and file bytes should have separate protocols. Metadata replay
  needs versioned operations, stable IDs, causal bases, idempotency, and
  explicit fork preservation. Content transfer should address encrypted
  chunks by BLAKE3 hash, verify every chunk and the reconstructed whole-file
  hash, and resume by acknowledged offsets/chunk indexes. The current
  sneakernet bundle remains the bounded fallback.
- A future CRDT-backed metadata document is a plausible v2, not a drop-in fix:
  Automerge provides transport-agnostic per-peer sync state and merges
  concurrent document changes, but adopting it means defining migrations and
  materializing current FileNode rows without changing ownership/security
  checks. Do not add a second source of truth casually.
- Browser portability should reuse the existing versioned, passphrase-sealed
  full-vault backup path for user-controlled export/import. Selected-state
  replication should be a separately versioned, encrypted allowlist; browser
  profile storage, private keys, and device-only preferences remain local.
- Implementation order: (1) batch schema/store/verify endpoints and tests;
  (2) bounded batch paging and stable per-peer cursors; (3) client signer and
  peer config/enrollment UX; (4) end-to-end direct peer exchange, then relay
  signaling; (5) complete mutation coverage and deterministic conflict UI;
  (6) encrypted resumable content chunks; (7) selected-state policy and
  portable encrypted export/import; (8) status/transport capability matrix and
  device/platform validation. Each stage updates this file and worklog before
  moving to the next stage.
- Current research points: Automerge's sync state/message loop is per document
  and peer, and assumes a reliable in-order transport; persist separate sync
  state per peer/document if adopted. It can merge concurrent document edits,
  but does not supply device enrollment, authorization, or ownership policy.
  iroh-blobs demonstrates BLAKE3-verified range streaming with 1 KiB hash
  chunks and batched blob requests, but current docs warn that the latest
  release is not production quality (they point production users to 0.35);
  treat it as a protocol reference until version/API maturity and endpoint
  identity are re-audited. tus is resumable HTTP: HEAD/PATCH offsets detect
  mismatches, and its optional checksum extension detects bad chunks. It leaves
  authentication/authorization to the server and does not provide peer
  discovery, end-to-end encryption, or a content-addressed whole-object proof.
  Any tus-style path still needs sealed-content semantics, authorization,
  final BLAKE3 verification, quotas/expiry, and idempotent finalize. WebRTC
  perfect negotiation handles simultaneous offers with polite/impolite roles;
  it improves signaling correctness but does not authenticate signaling claims
  or make the relay a data transport.
- Research-driven next design decision: specify a transport-neutral encrypted
  chunk manifest (file/version ID, ciphertext hash and size, chunk size/index,
  whole-ciphertext BLAKE3, and key-envelope reference), then evaluate HTTP
  resumable transfer against hash-addressed P2P ranges. The journal remains the
  authority for metadata causality and may reference a manifest only after the
  receiver verifies the complete ciphertext. Before adopting Automerge,
  prototype mapping one bounded file metadata document to existing redb rows
  and test concurrent rename/tag/trash edits, tombstones, ownership changes,
  and migration; do not add a second write authority without a materialization
  transaction and rollback plan. Browser signing should reuse the versioned
  WASM crypto path where possible, but enrollment must explain that browser
  origin compromise can access key material available to the page; capability
  support is not native key isolation.
- Primary references: [Automerge Rust sync protocol](https://docs.rs/automerge/latest/automerge/sync/),
  [Automerge concepts and pluggable network/storage](https://automerge.org/docs/reference/concepts/),
  [iroh-blobs protocol](https://docs.rs/iroh-blobs/latest/iroh_blobs/protocol/),
  [tus protocol](https://github.com/tus/tus-resumable-upload-protocol/blob/main/protocol.md),
  [WebRTC perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation),
  [W3C cryptography usage draft](https://www.w3.org/TR/security-guidelines-cryptography/),
  [Certificate Transparency Merkle consistency proofs](https://datatracker.ietf.org/doc/html/rfc9162).

### Research update (2026-10-25)

- Automerge Rust docs explicitly require reliable, in-order delivery and one
  `State` per peer; its JS docs describe transport-agnostic per-document sync.
  This supports using it behind an adapter with persisted peer/document state,
  not as a replacement for signed batch provenance or authorization.
- Current iroh-blobs docs describe BLAKE3-verified streaming, ranges, and blob
  collections, but the crate page flags the latest version as not production
  quality and points production users to 0.35. Recheck before selecting a
  dependency; verified range transfer is a stronger design insight than the
  current API choice.
- tus 1.0.x provides HTTP `HEAD` offset probes and offset-checked `PATCH`, with
  optional per-request checksums and upload expiry. The protocol leaves
  authentication/authorization to the server, so use requires application
  authorization, encrypted content, and final-object verification.
- MDN recommends WebRTC perfect negotiation to handle simultaneous offers
  using polite/impolite collision roles. This resolves offer glare only; relay
  device identity still needs cryptographic proof bound to the session.
- The W3C cryptography document currently surfaced by search is a 2026 Group
  Note Draft and explicitly not W3C-endorsed. Treat it as informative, not a
  normative product requirement; keep algorithm choices anchored to adopted
  standards and the existing versioned crypto design.
- References: [Automerge Rust sync](https://automerge.org/automerge/automerge/sync/index.html),
  [Automerge concepts](https://automerge.org/docs/reference/concepts/),
  [iroh-blobs crate status and protocol](https://docs.rs/iroh-blobs/latest/iroh_blobs/),
  [tus 1.0.x protocol](https://tus.io/protocols/resumable-upload),
  [WebRTC perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation),
  [W3C cryptography guidance draft](https://www.w3.org/TR/security-guidelines-cryptography/).

### P2 — Replicate selected app state safely

- [ ] Add an explicit sync policy for settings/layouts and agent sessions; keep
  device-only preferences and private keys local by default.
- [ ] Add opt-in, versioned export/import or sync for selected state with
  encryption, owner binding, size limits, and conflict behavior.
- [ ] Make browser/WASM state portable through user-controlled encrypted
  backup/restore; do not claim browser storage is shared across devices.

### P3 — Complete reachability and UX

- [x] Add library-level WebRTC answerer, install ICE handlers before local
  description, acknowledge consumed messages, and bound session cleanup.
- [ ] Wire offerer/answerer negotiation into product UI, authenticate relay
  messages with device proofs (mailbox account ownership alone is not sender
  proof), and clean up data channels on timeout/cancel.
- [x] Show a per-peer unsigned-operation backlog count (capped at 500+) with
  an unavailable state if the bounded history scan fails. The count is local
  unsigned work, not a remote acknowledgement.
- [x] Keep peer HTTP limited to local/LAN origins, require HTTPS remotely, and
  surface actionable CORS/mixed-content/TLS errors.
- [x] Label QUIC/iroh as unavailable in peer sync UI and distinguish the HTTPS
  relay mailbox from a bulk data transport.
- [x] Document target-specific capabilities, transport constraints, and the
  exact data categories that currently do and do not cross devices.
- [x] Show per-peer unsigned-operation backlog when it can be read; report
  “pending unavailable” if the bounded local history scan fails and “500+” at
  the result cap. This is a local unsigned backlog estimate, not remote ACKs.
- [x] Commit shared file metadata, parent-index and trash changes with their
  versioned journal rows in one redb transaction for create/duplicate/move,
  rename/tags/delete/restore/editor metadata and native import paths. File-byte
  replacement remains an external filesystem step with a crash window.

## Validation gate

- [ ] Add focused frontend tests for connection setup, credential isolation,
  page/cursor retry, malformed peer responses, WebRTC offer/answer/ICE, and
  UI disabled/error states.
- [ ] Add Rust tests for journal creation/application, signature/owner checks,
  idempotent replay, bounded chunk resume, and conflict preservation.
- [ ] Lock the recovery invariants with fault-injection cases: a failed page
  leaves the peer cursor unchanged; retrying an already merged batch is a
  no-op; reusing an operation ID with different content fails closed; an
  interrupted chunk upload resumes only at a verified offset/hash; and a
  mutation transaction failure leaves both file state and journal unchanged.
- [ ] Exercise the credential boundary: outbound peer requests use only that
  peer's sealed token, never the dashboard bearer; relay messages with a
  mismatched device/session proof are rejected before acknowledgement; browser
  CORS/mixed-content failures remain visible and do not advance cursors.
- [ ] Run repository-approved local checks; Rust checks remain CI-only per
  `AGENTS.md`. Validate Android/iOS behavior on real devices before claiming
  native parity.

## Progress log

- 2026-10-25: audit captured. Confirmed the existing peer Sync buttons do not
  supply signatures or call the signed exchange helpers; confirmed ordinary
  file mutation paths do not append op-log rows.
- 2026-10-25: protocol review found a second hard blocker: received op-log
  pages are unsigned raw rows, while local merge requires an ML-DSA proof and
  stored rows do not retain the sender's signed batch. Signed-pull format and
  durable mutation journal are now explicit prerequisites; no insecure merge
  shortcut was added.
- 2026-10-25: Devices panel Sync buttons now report unavailable until signed
  pull proofs and peer-scoped credentials exist. The relay WebRTC helper now
  registers offerer ICE before local description, acknowledges consumed
  answer/ICE messages, and includes an answerer helper with sender/recipient
  checks and bounded cleanup. The answerer is not connected to the product UI;
  no cross-device sync completion is claimed. Local header validation passed;
  frontend typecheck/test commands could not run because local dependencies are
  unavailable/incompatible (`vue-tsc` resolves an incompatible cached TypeScript;
  `vitest` is not installed).
- 2026-10-25: Implemented immutable `SignedOpBatch` storage, atomic verified
  merge to the compatibility op-log, hash-idempotent replay, owner/device
  filtered bounded paging, and REST/Tauri/WASM command mappings. Added peer URL,
  sealed peer credential, key fingerprint pin, persisted per-peer cursor,
  signed exchange, and manual public identity invitation/import. Imported keys
  cannot silently replace an existing registered identity. This remains partial:
  browser signing is not wired and op rows are not yet deterministic file-state
  reducers or content transfer.
- 2026-10-25: Research supports retaining the append-only journal while defining
  deterministic reducers before file replay. Automerge is a candidate for a
  separately versioned metadata model; resumable chunks or tus-style offsets
  are candidates for content transfer. No new dependency was added.
- 2026-10-25: Extended journal coverage to three direct Tauri import paths and
  batch trash deletion. Added a native command that exposes only active local
  device identities whose sealed seed matches the registered public key; the
  invitation and signer pickers use this list. Browser sync is visibly disabled
  and the store rejects direct calls until browser signing exists. Same batch
  hashes now accept a newly timestamped/re-signed retry, while reused operation
  IDs with differing content fail with `integrity:`.
- 2026-10-25: Added per-peer unsigned-op backlog visibility (capped at `500+`,
  with an unavailable state on scan failure), documented exact target/data
  boundaries, and made shared rename/tag/editor metadata writes atomic with
  their journal row. The host-byte write remains outside redb; journal replay,
  other mutation paths, content transfer, selected-state portability, relay UI,
  and native device validation remain open.
- 2026-10-25: Extended atomic DB mutation+journal commits to shared file/folder
  creation, duplication, move, trash/restore, and all three native import
  paths. Added rollback regression cases proving a rejected op kind leaves the
  file/index/trash state unchanged. Stars remain profile-local; group/todo
  mutations are still best-effort; bytes and deterministic remote replay are
  not implemented.
- 2026-10-25: Audited remaining `record_mutation_op` callers. Shared filesystem
  create/move/delete/restore/import paths no longer use a separate append;
  remaining best-effort paths are todos, loose groups, collections, and face
  operations. Browser stars remain in localStorage/WASM profile KV and have no
  remote journal or replay path.
- 2026-10-25: Continued protocol research against current primary docs. Tightened
  the journal task to reflect completed atomic DB-backed paths and explicit
  remaining writers/byte recovery; corrected relay task status for the existing
  library answerer; added transport selection criteria distinguishing Automerge
  sync state, iroh verified ranges, tus server-side resumability, and WebRTC
  signaling from product authentication/encryption guarantees. No dependency
  adoption or capability claim changed.
