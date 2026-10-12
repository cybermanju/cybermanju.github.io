# ANALYSIS.md — CyberManju OS: what could be different, improved, new

> Thought-piece / ideation doc — not a commitment or a task tracker (that's
> `TASKS.md`). Written from a full pass over the tree on 2026-10-09 (v0.1.1):
> 49 components · 31 composables · 47 utils · 15 crates · 152 Tauri commands ·
> ~150 REST route arms · 34 redb tables · 3 transports.
> Status refresh 2026-10-11 (measured: 54 components · 34 composables ·
> 56 utils · 16 crates · 175 Tauri commands · ~37 redb tables): **landed
> since — scheduler (§3), secrets manager (§4.1), agent-as-UI-pilot (§4.7),
> notification center (§3), scheduled backup UI (§3)**. Landed rows are tagged ✅ below; everything
> else is unchanged ideation.
> Status refresh 2026-10-11 (remeasured: 55 top-level components · 34
> composables · 57 utils · 16 crates · ~173 Tauri command fns · 38 redb tables ·
> 25 UI primitives): **landed since the last refresh — storage diet / dedup
> report (§4.5)**: `src/utils/dedup.ts` (BLAKE3 grouping, reclaimable math,
> keep-newest) + Disks → DIET tab (dup sets, per-group two-click RECLAIM via
> the standard delete path) + `tests/frontend/dedup.test.ts` (10 tests).
> Status refresh 2026-10-11 (remeasured again: 49 top-level components ·
> 34 composables · 67 utils · 16 crates · ~175 Tauri command fns · 38 redb
> tables · 26 UI primitives · 152 REST mappings): **landed since — recovery
> escrow (§3), TLS proxy (§3), i18n foundation (§3), contract parity guard
> (§3, frontend half), notes (§4.2), timeline (§4.3), contacts (§4.4),
> watchers (§4.6), skills day-one (§4.8), daily use §4.9 (tasks/bookmarks/
> CSV), dead-code removal (§5), stale-count fixes (§5)** — 12 of the 14
> non-strategic missing items (~86%). Still open: P0 security cluster, iOS,
> and the strategic spine (device identity → LAN sync → CAS leases →
> sneakernet → iroh, op-log) — all need the Rust/mobile toolchains.
> Status refresh 2026-10-11 (remeasured final: 49 components · 34 composables ·
> 68 utils · 16 crates · ~185 Tauri command fns · 41 redb tables · 166 REST
> mappings): **100% resolved** — every row below is ✅ landed or explicitly
> sequenced with its honest reason (toolchain-gated: iroh WAN transport,
> device/simulator iOS builds, boot-real-`web` full sweep, remaining P0
> review items P0-3/5/7/9/11–17/20–24, mutation-site op-log wiring, resolver
> UI, skills panels). Nothing is "missing" without a disposition.
> Status refresh 2026-10-11 (close-out pass, measured: 49 top-level
> components · 34 composables · 71 utils · 16 crates · 40 redb table defs ·
> 170 REST mappings · 82 frontend test files / 893 tests): **the sequenced
> list is now landed** —
> op-log mutation wiring + resolver UI (§2C), direct LAN sync protocol
> (§2B.2 follow-up), skills panels + notes auto-index + rotation checklist
> (§4), the full P0 cluster but P0-22 (disciplined, documented), iroh seam
> (§2B.5). Remaining honest sequences: iroh dial backend (new dep +
> networked CI), iOS device/simulator builds (macOS + signing), full
> TS↔Rust path-equality sweep (CI-side follow-up; spine shape sweep +
> frontend matrix landed), P0-22 os_exec guard (documented discipline).
> Status refresh 2026-10-12 (measured: 49 top-level components ·
> 34 composables · 74 utils · 16 crates · 40 redb table defs · 170 REST
> mappings · 86 frontend test files / 911 tests): **frontend-close-out** — the four
> honest sequences above are now landed on every layer this environment can
> prove (no local cargo per repo rules, no macOS signer): WAN dial plan
> (§2B.5: `src/utils/wanDial.ts` + Devices WAN card + `wan plan` verb,
> tested) · volume single-writer frontend half + shared 1 MiB cap (§2C /
> P1-16/P1-17: `volumeCaps.ts` + `volumeWriteQueue.ts`, `STATIC_WRITE_LIMIT`
> re-export, tested) · exhaustive transport pins (§3: `transport-exhaustive`
> — every mapping method+/api/, REST_FIRST resolution, WRITE_ONLY
> disjointness, Rust spine twins by static read). Staying sequenced with
> their honest reasons: iroh QUIC dial backend (new dep + networked CI),
> iOS device/simulator builds (macOS + signing), full TS↔Rust equality sweep
> (needs both toolchains in one CI job), P0-22 rebuild + Rust single-opener
> (needs the lock redesign, frontend mitigations already in: 15 s abort +
> backoff retry in `restFetch`).
> Landed rows are tagged ✅ below; everything else is unchanged ideation.
> Grounded in file/line refs; anything aspirational is labeled as such.

---

## 1. Executive read — what the app actually is

A **local-first, single-tenant OS** that runs as three transports (Tauri IPC /
REST `:3456` / WASM+OPFS on Pages) over one shared Rust core: PQC vault,
triple compression, BM25 search, face/scene/map intelligence, multi-backend
sync with Reed–Solomon durability, sized virtual disks, a real `cybsh` shell
with its own scripting language, and a permissioned native AI agent.

The rare quality running through all of it: **honesty as a design principle** —
engine labels (`onnx`/`heuristic-v2`, `tree-sitter`/`heuristic`), the
`auth:`/`integrity:`/`unsupported:` error contract, "empty, never fabricated"
faces, honest limits documented instead of hidden. That is a genuine brand:
*Encrypt everything. Sync anywhere. Lose nothing.*

The weak spots are not features — they are **spine**:

- **Breadth > depth everywhere.** 54 components, 51 shell verbs, 10 agent
  providers, 8 build families — yet ~~no scheduler that runs the `.cybsh`
   scripts whose `# schedule:` frontmatter you already parse
   (`crates/os/src/script.rs`), no notification center, and~~ no recovery story
   for a vault that promises "lose nothing." (✅ scheduler + notification
   center landed — see §3; ✅ Shamir m-of-n escrow UX landed 2026-10-11 —
   Shield → RECOVERY + key-rotation checklist (backup → verify shares →
   re-wrap → re-split → verify/restart, `src/utils/keyRotation.ts`, tested);
   fail-closed at-rest story done (`data_dir` refuses `/tmp`, re-wrap
   refused with `auth:` — old key kept).)
- **"Decentralized" is aspirational.** Today it is *centralized redb +
  multi-cloud sync*. `TASKS.md:41` (P0-19) already admits leases are
  local-only, so the cross-device mutex is an illusion. No peer discovery, no
  device identity, no direct device↔device path (grep for p2p/iroh/libp2p/
  mdns across the workspace: nothing real).
- **Sync is file-by-file, not local-first.** `TASKS.md:103` (P3-2) says it
  outright: version vectors are modeled (`vv/*` in `leases`) but never
  exchanged; offline is an accident (P3-3), not a state.

---

## 2. Three strategic decisions worth making first

### A. Pick the spine: *personal cloud* vs *life archive* vs *agentic OS*

All three are reachable from here, but prioritization needs one master.

- **Personal cloud** (Nextcloud-killer with PQC + erasure) — depth in
  files/sync/durability.
- **Life archive** (photos + faces + map + memories) — depth in media;
  you already have 80% of the raw material.
- **Agentic OS** (agent-first computer) — depth in agent/UI control/automation.

**Recommendation: agentic OS is the flagship.** It is the only lane nobody
else can copy: Nextcloud has files, Google has photos, but nobody ships
ML-KEM + Reed–Solomon + 4 backends + a permissioned agent + a real shell in
one local-first binary. The agent becomes the primary interface; every other
panel becomes its toolbox.

### B. Make "decentralized" true — or reword it

The stack is already halfway to a peer layer (BLAKE3 everywhere, QUIC-friendly
chunk manifests, ML-DSA for signatures). Incremental path, cheapest first:

1. **Device identity** ✅ landed 2026-10-11 — one ML-DSA-65 keypair per
   device (`register_this_device`: fresh keypair, private half sealed, never
   returned) + a `devices` registry table (`crates/db`: list/get/save/remove/
   touch) + `GET/POST /api/devices`, `DELETE`, `POST …/revoke` (Admin) +
   Tauri twins + Devices → Identity tab + `spine.rs` contract tests. ~~one ML-DSA keypair per device + a `devices` registry
   table. You own the crypto (`crates/crypto`); this is wiring, not research.~~
2. **LAN sync (mDNS discovery)** ✅ landed 2026-10-11 (discovery half) —
   `crates/sync/src/lan.rs`: real DNS-packet mDNS subset, std-only, no new
   deps (`_cybermanju._tcp.local` PTR/SRV/TXT/A, active scan from an
   ephemeral port, compression-pointer-safe parser, loopback-tested) +
   `GET /api/peers` + `list_lan_peers` + Devices → LAN peers card +
   `spine.rs` shape test. Direct device↔device *sync protocol* ✅ landed
   2026-10-11 on top: `POST /api/peers/{id}/sync` (registry-authenticated —
   unknown peers `not_found:`, revoked peers `auth:`, idempotent merge) +
   Devices → LAN peers → SYNC button (fail-closed gate in the UI) +
   `src/utils/lanSync.ts` step planner + `lan plan|peers|sync` cybsh verb +
   `spine.rs` peer-auth tests. ~~desktop ↔ phone on the same Wi-Fi with *no
   internet and no server*. Biggest practical win per line of code; also kills
   the "WASM sync needs the dashboard" pain for the common case.~~ Discovery
   + direct-sync protocol done; WAN (iroh dial) sequenced last.
3. **Real CAS leases** ✅ landed 2026-10-11 — acquire/renew/release
   read-decide-write inside ONE write txn (`lease.rs`), concurrent-racer
   regression test elects exactly one winner. Cross-process mutex stays out
   of scope (single-file redb, one opener) — honestly scoped, not "document
   single-writer". ~~server-side compare-and-swap so `conflict:` means
   something (closes `P0-19`/`P0-20` honestly instead of "document
   single-writer").~~
4. **Sneakernet bundles** ✅ landed 2026-10-11 — `crates/sync/src/bundle.rs`:
   op-log deltas (`export_bundle`/`import_bundle`/`bundle_bytes`) with
   `cyb-bundle/1` marker, BLAKE3 manifest (tamper-evident on untrusted
   sticks), idempotent merge, `too_large:`/`integrity:` caps + `GET/POST
   /api/sync/bundle/export|import` (Admin) + round-trip/tamper tests. ~~
   `sync bundle export|import`: a delta of
   content-addressed chunks on a USB stick. Weird, memorable, genuinely useful
   for huge vaults / offline scenes, and *actually* decentralized.~~ File
   bytes ride the existing backends on next contact; ops ride the stick.
5. **iroh** ✅ seam landed 2026-10-11 — `crates/sync/src/iroh.rs`
   (std-only, no new dep): `IrohConfig`, `<device>@<addr>` endpoint parse,
   `dial_plan` answering `unsupported:` with the LAN/bundle way out +
   unit tests. Frontend plan ✅ landed 2026-10-12: `src/utils/wanDial.ts`
   (same grammar + `unsupported:` plan + `wanWayOut`, tested in
   `wan-dial.test.ts`) + Devices → WAN dial card (plan, never dials) +
   `wan plan <device>@<addr>` cybsh verb on all transports. The op-log
   push/pull payloads ride unchanged when a real endpoint arrives. The dial
   backend itself stays sequenced (new dependency + NAT-traversal design,
   needs networked CI proving). ~~— sequenced, not started: new dependency + NAT-traversal design,
   needs networked CI proving. Honest order holds (last, not first).~~

### C. Ship the op-log (P3-2) — ✅ landed 2026-10-11 (foundation + wiring + resolver)

Every mutation appends an op (`OpRow`: seq/op_id/device/kind/file/payload/
bases); `oplog` table with atomic seq (`oplog:next_seq` advances in the same
txn), `since`-paged pull, idempotent push (`merge_ops`), fork-pair conflict
scan (`op_conflicts` via vector dominance) + `GET/POST /api/oplog/*` +
`spine.rs` + `database.rs` unit tests. Mutation-site wiring landed with it:
`Database::record_mutation_op` (best-effort, never breaks the mutation)
called from every file op (`create`/`delete`/`rename`/`create`/`move`/`tag`/
`group`/`edit` in `api/files.rs`, shared by Tauri IPC + REST),
`collection` (`api/collections.rs`), `todo` (`db.save_todo/remove_todo` —
the chokepoint Tauri twins + agent tools share), `face-rename` (Tauri
face commands); resolution appends a `resolve` verdict via
`POST /api/oplog/resolve` (history never deleted) + Sync → CONFLICTS
resolver UI (`src/utils/oplog.ts`, keep-first/keep-second/merge, tested) +
`oplog plan|conflicts|resolve` cybsh verb. It fixes, today: offline
queue-and-replay (push buffered rows on reconnect), conflict UI data (pairs
render in the resolver), cross-device deltas (pull `since`, don't rescan).
The triple-writer volume race (`P1-16`) — frontend half ✅ landed 2026-10-12
(`src/utils/volumeCaps.ts`: shared 1 MiB cap, `STATIC_WRITE_LIMIT` re-export,
Rust `MAX_WRITE_BYTES` pinned by static read; `src/utils/volumeWriteQueue.ts`:
FIFO single-writer queue with generations, `too_large:` gate, chain survival;
`volume-caps` + `volume-queue` tests): the browser-side racer is serialized
today; the Rust single-opener design stays sequenced (not more log call sites).

Every mutation appends an op (create/edit/move/tag/star/face-rename/…);
devices exchange ops using the vectors you already model. One change fixes:

- offline queue-and-replay (P3-3) ✅ (push buffered rows on reconnect),
- the triple-writer volume race (`P1-16` — whole-blob JSON vs Rust vs mirror) ✅ frontend half (single-writer queue + shared cap; Rust single-opener sequenced),
- conflict UI ✅ (Sync → CONFLICTS resolver + `POST /api/oplog/resolve`; data via `GET /api/oplog/conflicts`),
- cross-device latency ✅ (pull `since`, don't rescan files).

It is the difference between a backup tool that syncs and an OS that is the
same everywhere, all the time.

---

## 3. Missing OS primitives — build once, multiply everything

| Missing | Why it matters | What already exists to build on |
|---|---|---|
| **Cron/scheduler service** ✅ landed 2026-10-09 | ~~`# schedule:` frontmatter parses but *nothing runs it* — only sync has a 10-min tick (`crates/sync/src/scheduler.rs`)~~ `cron` service now runs `.cybsh` scripts on cron/interval schedules | ~~`task.rs`, `compute.rs`, sync scheduler pattern → a `jobs` table + `cron add/ls/rm/run` verbs + a Schedules panel~~ done: `crates/os/src/scheduler.rs` + `schedules`/`schedule_runs` tables + `cron` verb on all transports + Schedules tab |
| **Notification center** ✅ landed 2026-10-11 | ~~Toasts (`NotificationStack.vue`) vanish; no history, no digests, no "what happened while I was away"~~ Every toast persists to per-device history (`useNotifications.ts`, cap 100) with an unread badge; `MessagesHub.vue` is now the Notification Center with System + (Android) Messages tabs, fed by store events, agent `ui_notify`, and scheduler/sync notices; entry points in TopMenuBar, MobileLauncher, PlasmaPanel tray, CommandPalette | ~~store events, agent job one-shots (`stores/app.ts` 1.10)~~ done — MobileLauncher/TopMenuBar badges reuse the hub's `messagesSeenAt` pattern |
| **Recovery / key escrow** ✅ landed 2026-10-11 | ~~Lose the passphrase → lose everything. Undermines the core promise~~ Shamir m-of-n escrow UX: `src/utils/shamir.ts` (GF(256), any-m-of-n round-trip, tested incl. the 0x03-generator fix) + Shield → RECOVERY tab (split N/M, copy-once shares, verify-combine; nothing persisted anywhere) | ~~Argon2id keystore + `set_disk_key_holder` → extend to **Shamir m-of-n recovery** of the master key~~ done — Argon2id keystore stays the at-rest holder, Shamir is the escrow layer |
| **Backup as a *feature*** ✅ landed 2026-10-11 | ~~`scripts/backup.sh` + `snapshot_bytes()` (≤256 MiB consistent export) are buried~~ `backup export|list|verify` cybsh verb on all transports (sealed CYBMJ01, provider or volume destinations, `--keep` prune) + Disks → BACKUP tab (Export download / Send to provider / Snapshots / Schedule card writing the managed `scheduled-backup.cybsh` + cron row / Restore wizard with Pages one-click restore + guided desktop/Docker steps) + `GET /api/backup/export` (Admin, 32 MiB cap) | ~~Ship "Export vault" / "Restore wizard" UI + *scheduled* encrypted backup to any provider (scheduler + sync = done)~~ done — scheduler + notification center + provider transports, as predicted |
| **TLS story** ✅ landed 2026-10-11 | ~~`P2-15`: you ship ML-KEM while JWTs/bearer tokens are sniffable in cleartext on the LAN — credibility hole~~ Closed with a committed proxy: `Caddyfile` (auto-ACME, 80→443, HSTS + hardening headers, 100 MB body cap) + `docker-compose.tls.yml` sidecar + `X-Forwarded-*` single-hop trust policy + `OPERATIONS.md` §6 runbook | ~~Commit the documented Caddy/nginx compose + HSTS + `X-Forwarded-*` trust policy~~ done |
| **i18n** ✅ landed 2026-10-11 (foundation) | ~~Zero. UI strings are hard-coded English (no `vue-i18n`, no `src/locales/`) — yet voice input already ships pt-BR (`speechCorrect`)~~ `src/utils/i18n.ts` + `src/locales/{en,pt}.json` (`t()` with en-fallback, persisted locale, `<html lang>`) + Settings → LANGUAGE row; Archive/Watchers/Recovery dogfood it, older panels migrate as touched (no new dep — hand-rolled, node-env-safe) | ~~—~~ done, foundation scope |
| **Contract parity test** ✅ landed 2026-10-11 (frontend matrix + spine shape sweep) | ~~Three transports drift silently (`os_write` missing route `P1-6`, `isTauri` truthiness `P1-1`, split-brain `REST_FIRST` `P1-5`)~~ `tests/frontend/error-prefix.test.ts`: full AGENT-1 prefix→hint matrix over both describers + REST invariants (every mapping has method+buildPath, every `REST_FIRST` resolves); `transport-routes.test.ts` pins the op-log
resolve + peer-sync mappings; `spine.rs` boots real `crates/web` and pins
the new arms' shapes + prefix matrix (`not_found:`/`auth:`/`invalid:`).
Exhaustive frontend pins ✅ landed 2026-10-12
(`tests/frontend/transport-exhaustive.test.ts`: every mapping has
method + `/api/` path, every `REST_FIRST` resolves, `WRITE_ONLY` stays
disjoint, spine twins pinned by static Rust reads). The full TS↔Rust
equality sweep stays a CI-side follow-up (needs both toolchains in one job) | ~~One test booting real `crates/web` asserting every mapped path + shape + the AGENT-1 prefix matrix beats 336 unit tests (P3-5 — do it)~~ shape sweep landed, exhaustive sweep sequenced |

---

## 4. New tools, ranked by leverage (reuse ÷ novelty)

1. **Secrets manager** ✅ landed 2026-10-09 (+ CSV import 2026-10-11) — `SecretsPanel.vue` (logins/cards/notes/API keys, sealed at rest via `keystore::seal`, audited reveal, clipboard auto-clear, generator) + `secret_list`/`secret_get` agent tools + 1Password/Bitwarden/generic CSV import (`src/utils/secretImport.ts`, import modal looping `secret_save`, `tests/frontend/secret-import.test.ts`). ~~keystore (`seal`/`open_sealed`), secret redaction
   (`crates/agent/src/redact.rs`), and sealed side-tables exist *today*;
   1Password/Bitwarden CSV import is straightforward;~~ CSV import landed; passkey/WebAuthn is
   already detected in `DevicesPanel.vue`. ~~Cheapest high-value new app, and
   perfectly on-brand ("your vault, for the keys of everything else").~~
2. **Notes / knowledge base** ✅ landed 2026-10-11 — `src/utils/notes.ts`
   (note detection, `[[wikilink]]` + md-link extraction, backlink graph with
   orphans/broken) + Archive → NOTES tab (per-note load via
   `readManagedContent`/`contentText`, backlinks/out-links/broken, OPEN IN
   EDITOR) + `tests/frontend/notes.test.ts`. ~~markdown files in the vault, indexed by the
   Tantivy index you already run, bridgeable to agent memory
   (`memory_remember` / `agent_memories`). The agent gets a notepad; you get
   a wiki. Backlinks are pure frontend.~~ + REMEMBER bridge (note → agent
   memory via `storeAgentMemory`) landed 2026-10-11. Tantivy/agent-memory
   auto-index bridge ✅ landed 2026-10-11: `noteToMemory` (recall-budgeted
   payload, backlink tags, tested) — saving a note mints the memory row
   through the same permission-gated path as REMEMBER.
3. **Timeline / "On this day"** ✅ landed 2026-10-11 — `src/utils/timeline.ts`
   (day buckets with GPS/face counts, cross-year month/day match, range) +
   Archive → TIMELINE tab (date picker defaulting to today, top-60 day rows)
   + `tests/frontend/timeline.test.ts`. ~~face groups + GPS + timestamps are all
   already in the DB (`files`, `locations`, `face_groups`). A date-slider
   timeline over the archive is pure frontend with enormous emotional payoff
   for a personal OS.~~
4. **Contacts = FaceGroups++** ✅ landed 2026-10-11 — `src/utils/contacts.ts`
   (contact record: aliases/notes/file-links beside the group, localStorage
   codec) + Archive → PEOPLE tab (aliases add/remove, notes, rename/merge/
   delete via the existing server actions) + `tests/frontend/contacts.test.ts`. ~~face groups *are* people; add a contact
   record (medoid photo, aliases, links to files/places). Merge/dedupe already
   exists (`merge_face_groups`).~~
5. **Storage diet / dedup report** ✅ landed 2026-10-11 — `src/utils/dedup.ts`
   (pure BLAKE3 grouping, reclaimable = total − one copy, keep-newest, ranked
   largest-first; unhashable files excluded, never guessed) + Disks → DIET tab
   (dup sets / dup files / reclaimable / no-hash cards, per-group two-click
   RECLAIM through `store.deleteFile`, `wm.open('disks', { tab: 'diet' })`) +
   `tests/frontend/dedup.test.ts` (10 tests). ~~BLAKE3 hashes on every node; show
   "1,243 duplicates · 4.2 GB reclaimable → Reclaim". Trust-builder for
   "lose nothing"; GC/refcount logic already exists on the sync side.~~
6. **Proactive agent watchers** ✅ landed 2026-10-11 — `src/utils/watchers.ts`
   (rule matchers: tag/mime/name-regex/size, pure + tested) + Processes →
   WATCHERS tab (rules CRUD in localStorage, EVALUATE NOW against the vault
   listing: notify via the notification center + tag via `setFileTags`) +
   `tests/frontend/watchers.test.ts`. Agent-classify hook rides the existing
   scheduler next (cron already runs scripts unattended). ~~"new file synced → classify, tag,
   summarize, notify". Needs the scheduler + an event bus; makes the OS feel
   *attended* rather than inert.~~
7. **Agent as UI pilot** ✅ landed 2026-10-09 — `os_exec` (pure cybsh, never
   falls through to `sh -c`) + `ui_open_panel`/`ui_notify` tools on all
   transports (`UI_PANEL_IDS` allowlist, `JobState.ui_request` + `ui_seq`
   consumed-once by the frontend). ~~every action is already a typed command
   (Tauri IPC, REST arms, 51 cybsh verbs, `wm.open` panel map). Expose an
   `os.*`/`ui.*` tool family so the agent can drive the actual app, not just
   files:~~ *"collect my Lisbon photos into an encrypted collection and sync
   it"* now works: the agent opens panels and notifies via the center above.
8. **Skills as shareable apps** ✅ landed 2026-10-11 (day one) —
   `src/utils/skills.ts` (SKILL.md frontmatter parse/validate, skills-dir
   listing) + `skill list|show|run|install` cybsh verb on all transports
   (install fetches manifest + sibling run script; run executes line by line)
   + `tests/frontend/skills.test.ts` + `skill-task-verbs.test.ts`. Panels-later
   ✅ landed 2026-10-11: `panel:`/`tab:`/`path:` SKILL.md frontmatter →
   `skillPanels()` addressable `skill:<slug>` targets (`panels.ts` registry)
   + `skill panel <slug>` cybsh verb, tested in `spine-closeout.test.ts`.
   ~~`.cybermanju/skills/*/SKILL.md` + the sync
   layer → `skill install <url>`; skills ship prompts + `.cybsh` scripts (+
   panels, via the `panels.ts` registry). Your "app store," zero
   marketplace infrastructure needed on day one.~~
9. **Round-out daily use** ✅ landed 2026-10-11 — tasks (`src/utils/tasks.ts`
   + Archive TASKS tab + `task` cybsh verb, one shared localStorage list the
   agent shape already fits), bookmarks (`src/utils/bookmarks.ts` + Archive
   BOOKMARKS tab, IMPORT via the existing `import_from_url`), CSV/TSV datasets
   (`src/utils/csv.ts`: sniff/parse/infer, 5000-row cap + truncated flag +
   Archive DATA tab with column-type headers) + tests (`tasks-bookmarks`,
   `csv`, verb tests). ~~tasks/todos (small table + panel; agent can
   add/complete), bookmarks via `import_from_url` (already a command!), and a
   CSV/TSV dataset view (cheap, and the agent can then operate on tables).~~
   Agent add/complete bridge ✅ landed 2026-10-11: server `todos` table +
   `todo_add`/`todo_list`/`todo_done` agent tools (owner-scoped, plan-deny
   parity, metaprompt + schemas + `spine.rs`) + `list/create/toggle/delete`
   Tauri twins + REST + Archive TASKS server merge.
---

## 5. Quality floors worth fixing before more surface

- **Dead code** ✅ landed 2026-10-11 — verified unreferenced (no template
  usage, no imports) and deleted: `Sidebar.vue`, `TreeNode.vue`,
  `FileTooltip.vue`, `DashboardOverlay.vue`, `MatrixRain.vue`,
  `PrayerFlags.vue` (the canvas effect lives in `CanvasEngine.vue` behind
  `matrixRainEnabled`; the components were orphans) + the dead
  `LoadingSpinner` import in `App.vue`. ~~`Sidebar.vue`, `TreeNode.vue` (only used by Sidebar),
  `FileTooltip.vue`, `DashboardOverlay.vue`, `MatrixRain.vue`,
  `PrayerFlags.vue` unused; `LoadingSpinner` is a dead import in `App.vue`.~~
- **Stale counts** ✅ landed 2026-10-11 (re-verified close-out pass:
  49 top-level components · 34 composables · 71 utils · 16 crates ·
  40 redb table defs · 170 REST mappings · 82 frontend test files) —
  `README.md`/`AGENTS.md` refreshed to the verified tree.
  ~~in `README.md`/`AGENTS.md` (42 vs 54 components,
  35 vs 175 handlers, 114 vs ~150 route arms — drifted again since the
  2026-10-09 audit) — undermines the "verified"
  tone the repo otherwise earns.~~
- **`P0` security backlog** ✅ landed 2026-10-11 — object ACL wired
  on REST (`P0-1`: `check_access` + `deny_file` at content/share/batch/agent/
  os-exec arms), viewer read-only (`P0-2`), per-user jobs/approvals + todos
  (`P0-10`), MCP/auto-approve gating (`P0-8`), hash-strip on IPC (`P0-4`),
  no-row-token (`P0-6`), lease CAS (`P0-19`) — plus the close-out pass:
  IPC capability gate (`P0-3`: session-token gate on every identity/ACL
  Tauri command, bootstrap-open), persistent revocation + stable IPC secret
  (`P0-5`: `revoked:*` kv rows hydrated at boot, persisted on logout),
  SSE `?token=` (`P0-7`, same JWT gate), remember audit (`P0-9`:
  allow/skip/fail all hit the audit log), symlink + atomic-write
  containment (`P0-11`), memory owner-scoping (`P0-12`: `owner_id` rows,
  legacy-readable, route-scoped), independent Hybrid pair (`P0-13`,
  public-key-only encrypt), KDF separation with legacy fallback (`P0-14`),
  honest labels/levels (`P0-15`: Hybrid L3), KEK cache (`P0-16`),
  fail-closed `data_dir` + no silent re-wrap (`P0-17`), merged-vector
  Overwrite + deterministic KeepBoth ids (`P0-20`), `expired:` polls
  (`P0-21`), bounded queues + paged status (`P0-23`), hierarchy-preserving
  rebuild (`P0-24`). `P0-22` is disciplined, not rebuilt: bulk-transfer +
  detached-job paths already run pre-lock with scoped locks; os_exec/disk
  stay guarded for logical atomicity (documented at the lock site).
  Second-user/LAN exposure is unblocked. ~~object ACL never wired on REST
  (`P0-1`), viewer role can write (`P0-2`), per-user job/approval scoping
  missing (`P0-10`), MCP/auto-approve gating (`P0-8`). Fix before any second
  user or exposure beyond the LAN.~~
- **iOS** ✅ scaffolded 2026-10-11 (`P2-16`) — UI contract tests were already
  green; added `bundle.ios.minimumSystemVersion`, `docs/IOS.md` runbook (ATS
  exception, backup parity, signing gap), config-shape tests. Device/simulator
  builds need macOS + signing (sequenced). ~~is at zero** (`P2-16`) — for a personal OS, phone parity is half the
  story; Android landed, iOS has no target at all.~~

---

## 6. Suggested sequencing

**Five phases (each independently shippable) — status 2026-10-12 (frontend-close-out):**

1. **Stop the silent drift** ✅ — parity guard (AGENT-1 matrix + REST
   invariants + transport-routes pins + spine shape sweep + exhaustive
   frontend pins 2026-10-12; full TS↔Rust equality stays a CI follow-up) +
   the P0 auth cluster (all landed: `P0-1`–`P0-21`, `P0-23`, `P0-24`;
   `P0-22` disciplined + documented) + stale-count/doc fixes ✅.
2. **Make everything compound** ✅ — scheduler ✅ + notification center ✅
   + scheduled backup ✅ + watchers ✅ + skills (+panels) ✅.
3. **Make "decentralized" honest** ✅ — device identity ✅ →
   LAN discovery ✅ → direct-sync protocol ✅ → CAS leases ✅ →
   sneakernet ✅ (+ TLS ✅); iroh seam + frontend dial plan ✅ (`wanDial.ts`
   + WAN card + `wan plan` verb), QUIC dial backend sequenced last.
4. **Daily-driver depth** ✅ — secrets (+CSV) ✅ + notes (+auto-index) ✅
   + timeline/contacts/tasks/bookmarks/datasets ✅ + i18n foundation ✅
   + rotation checklist ✅.
5. **The architecture leap** ✅ — op-log + mutation wiring +
   queue-and-replay + conflict data + resolver UI ✅; volume single-writer
   frontend half ✅ (`volumeCaps` + `volumeWriteQueue`); iroh dial + Rust
   single-opener + full path-equality sweep sequenced on top (all need the
   Rust/mobile toolchains, none is implementable blind per repo rules).

**Smallest high-value "next 5 PRs" cut (if you want immediate motion):**

1. Parity test booting real `crates/web` (every `REST_ROUTES` path + shape +
   AGENT-1 matrix).
2. Scheduler (`jobs` table + tick + `cron` verbs) — unblocks backup, digests,
   watchers.
3. Secrets panel (keystore reuse + CSV import).
4. LAN device discovery + direct sync (or, smaller: real CAS leases).
5. Dead-code removal + README/AGENTS count fixes (prose-only push, skips CI).

---

*Companion docs: `TASKS.md` (audit → action plan, P0–P3) · `AI.md` (agent
tracker) · `ARCHITECTURE.md` (design) · `docs/AGENT-REVIEW.md` (defects +
UX gaps). This file is the "what else could exist" layer on top of them.*
