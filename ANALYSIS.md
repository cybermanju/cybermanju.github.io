# ANALYSIS.md — CyberManju OS: what could be different, improved, new

> Thought-piece / ideation doc — not a commitment or a task tracker (that's
> `TASKS.md`). Written from a full pass over the tree on 2026-10-09 (v0.1.1):
> 49 components · 31 composables · 47 utils · 15 crates · 152 Tauri commands ·
> ~150 REST route arms · 34 redb tables · 3 transports.
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

- **Breadth > depth everywhere.** 49 components, 51 shell verbs, 10 agent
  providers, 8 build families — yet no scheduler that runs the `.cybsh`
  scripts whose `# schedule:` frontmatter you already parse
  (`crates/os/src/script.rs`), no notification center, and no recovery story
  for a vault that promises "lose nothing."
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

1. **Device identity** — one ML-DSA keypair per device + a `devices` registry
   table. You own the crypto (`crates/crypto`); this is wiring, not research.
2. **LAN sync (mDNS discovery)** — desktop ↔ phone on the same Wi-Fi with *no
   internet and no server*. Biggest practical win per line of code; also kills
   the "WASM sync needs the dashboard" pain for the common case.
3. **Real CAS leases** — server-side compare-and-swap so `conflict:` means
   something (closes `P0-19`/`P0-20` honestly instead of "document
   single-writer").
4. **Sneakernet bundles** — `sync bundle export|import`: a delta of
   content-addressed chunks on a USB stick. Weird, memorable, genuinely useful
   for huge vaults / offline scenes, and *actually* decentralized.
5. Only then consider **iroh** (Rust, BLAKE3+QUIC+NAT traversal) for
   NAT-traversed WAN sync — a new dependency, so last, not first.

### C. Ship the op-log (P3-2) — the highest-leverage single change

Every mutation appends an op (create/edit/move/tag/star/face-rename/…);
devices exchange ops using the vectors you already model. One change fixes:

- offline queue-and-replay (P3-3),
- the triple-writer volume race (`P1-16` — whole-blob JSON vs Rust vs mirror),
- conflict UI (show the ops, let the user pick),
- cross-device latency (push ops, don't rescan files).

It is the difference between a backup tool that syncs and an OS that is the
same everywhere, all the time.

---

## 3. Missing OS primitives — build once, multiply everything

| Missing | Why it matters | What already exists to build on |
|---|---|---|
| **Cron/scheduler service** | `# schedule:` frontmatter parses but *nothing runs it* — only sync has a 10-min tick (`crates/sync/src/scheduler.rs`) | `task.rs`, `compute.rs`, sync scheduler pattern → a `jobs` table + `cron add/ls/rm/run` verbs + a Schedules panel |
| **Notification center** | Toasts (`NotificationStack.vue`) vanish; no history, no digests, no "what happened while I was away" | store events, agent job one-shots (`stores/app.ts` 1.10) |
| **Recovery / key escrow** | Lose the passphrase → lose everything. Undermines the core promise | Argon2id keystore + `set_disk_key_holder` → extend to **Shamir m-of-n recovery** of the master key |
| **Backup as a *feature*** | `scripts/backup.sh` + `snapshot_bytes()` (≤256 MiB consistent export) are buried | Ship "Export vault" / "Restore wizard" UI + *scheduled* encrypted backup to any provider (scheduler + sync = done) |
| **TLS story** | `P2-15`: you ship ML-KEM while JWTs/bearer tokens are sniffable in cleartext on the LAN — credibility hole | Commit the documented Caddy/nginx compose + HSTS + `X-Forwarded-*` trust policy |
| **i18n** | Zero. UI strings are hard-coded English (no `vue-i18n`, no `src/locales/`) — yet voice input already ships pt-BR (`speechCorrect`) | — |
| **Contract parity test** | Three transports drift silently (`os_write` missing route `P1-6`, `isTauri` truthiness `P1-1`, split-brain `REST_FIRST` `P1-5`) | One test booting real `crates/web` asserting every mapped path + shape + the AGENT-1 prefix matrix beats 336 unit tests (P3-5 — do it) |

---

## 4. New tools, ranked by leverage (reuse ÷ novelty)

1. **Secrets manager** — keystore (`seal`/`open_sealed`), secret redaction
   (`crates/agent/src/redact.rs`), and sealed side-tables exist *today*;
   1Password/Bitwarden CSV import is straightforward; passkey/WebAuthn is
   already detected in `DevicesPanel.vue`. Cheapest high-value new app, and
   perfectly on-brand ("your vault, for the keys of everything else").
2. **Notes / knowledge base** — markdown files in the vault, indexed by the
   Tantivy index you already run, bridgeable to agent memory
   (`memory_remember` / `agent_memories`). The agent gets a notepad; you get
   a wiki. Backlinks are pure frontend.
3. **Timeline / "On this day"** — face groups + GPS + timestamps are all
   already in the DB (`files`, `locations`, `face_groups`). A date-slider
   timeline over the archive is pure frontend with enormous emotional payoff
   for a personal OS.
4. **Contacts = FaceGroups++** — face groups *are* people; add a contact
   record (medoid photo, aliases, links to files/places). Merge/dedupe already
   exists (`merge_face_groups`).
5. **Storage diet / dedup report** — BLAKE3 hashes on every node; show
   "1,243 duplicates · 4.2 GB reclaimable → Reclaim". Trust-builder for
   "lose nothing"; GC/refcount logic already exists on the sync side.
6. **Proactive agent watchers** — "new file synced → classify, tag,
   summarize, notify". Needs the scheduler + an event bus; makes the OS feel
   *attended* rather than inert.
7. **Agent as UI pilot** — every action is already a typed command
   (Tauri IPC, REST arms, 51 cybsh verbs, `wm.open` panel map). Expose an
   `os.*`/`ui.*` tool family so the agent can drive the actual app, not just
   files: *"collect my Lisbon photos into an encrypted collection and sync
   it."*
8. **Skills as shareable apps** — `.cybermanju/skills/*/SKILL.md` + the sync
   layer → `skill install <url>`; skills ship prompts + `.cybsh` scripts (+
   panels later, via the `panels.ts` alias table). Your "app store," zero
   marketplace infrastructure needed on day one.
9. **Round-out daily use** — tasks/todos (small table + panel; agent can
   add/complete), bookmarks via `import_from_url` (already a command!), and a
   CSV/TSV dataset view (cheap, and the agent can then operate on tables).

---

## 5. Quality floors worth fixing before more surface

- **Dead code**: `Sidebar.vue`, `TreeNode.vue` (only used by Sidebar),
  `FileTooltip.vue`, `DashboardOverlay.vue`, `MatrixRain.vue`,
  `PrayerFlags.vue` unused; `LoadingSpinner` is a dead import in `App.vue`.
- **Stale counts** in `README.md`/`AGENTS.md` (42 vs 49 components,
  35 vs 152 handlers, 114 vs ~150 route arms) — undermines the "verified"
  tone the repo otherwise earns.
- **`P0` security backlog is severe** — object ACL never wired on REST
  (`P0-1`), viewer role can write (`P0-2`), per-user job/approval scoping
  missing (`P0-10`), MCP/auto-approve gating (`P0-8`). Fix before any second
  user or exposure beyond the LAN.
- **iOS is at zero** (`P2-16`) — for a personal OS, phone parity is half the
  story; Android landed, iOS has no target at all.

---

## 6. Suggested sequencing

**Five phases (each independently shippable):**

1. **Stop the silent drift** — contract parity test (P3-5) + the P0 auth
   cluster (`P0-1`, `P0-2`, `P0-8`, `P0-10`) + stale-count/doc fixes.
2. **Make everything compound** — scheduler service + notification center +
   scheduled backup UI. Suddenly every script, sync, and agent run can run
   unattended.
3. **Make "decentralized" honest** — device identity → LAN sync → CAS leases
   (+ TLS compose, since LAN is exactly where cleartext hurts).
4. **Daily-driver depth** — secrets manager + notes/knowledge base (+ i18n
   foundation, since new UI strings are cheapest to extract early).
5. **The architecture leap** — op-log + offline queue-and-replay + conflict
   UI; then agent-as-UI-pilot and skills-as-app-store on top.

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
