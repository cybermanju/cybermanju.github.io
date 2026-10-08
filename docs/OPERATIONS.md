# CyberManju OS — Operations Runbook

How to run the decentralized OS in production: Docker/ZimaOS, backup, env, TLS, health, and the `cybsh` terminal.

## 1. Deploy

```bash
docker compose up -d
# dashboard: http://<nas-ip>:3456
```

Hardened compose: `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit`, LAN-only `3456`, healthcheck `GET /api/health` (readiness: `GET /api/readyz`).

## 2. Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3456` | Dashboard port |
| `DB_PATH` | `/data/cybermanju.db` | redb file (exclusive lock — one handle; app + dashboard share it) |
| `STATIC_DIR` | `/app/static` | Built Vue frontend |
| `RUST_LOG` | `info` | |
| `TZ` | `UTC` | |
| `CYBERMANJU_JWT_SECRET` | random/file | Persisted 0600 at `<data>/jwt_secret`; rotation logs out sessions |
| `CYBERMANJU_ADMIN_USERNAME/_PASSWORD` | unset | Headless bootstrap admin (bootstrap-only register otherwise) |
| `CYBERMANJU_MASTER_PASSPHRASE` | unset | Keystore + disk superblock seal fallback |
| `CYBERMANJU_DATA_DIR` | app dir | Disks, keystore, oauth side-store |
| `CYBERMANJU_OAUTH_REDIRECT_URI` | `http://127.0.0.1:{port}/callback` | Desktop loopback; server uses redirect |
| `CYBERMANJU_GITLAB_INSTANCE_URL` | `https://gitlab.com` | Self-hosted override |
| `ORT_CACHE_DIR` | `$HOME/.cache/ort` | **Required** before any cargo command (ort-sys panics without it) |

## 3. Disks & volume (the OS storage)

Each provider holds a sized `.cybermanju` disk (`CYBMJU1` sealed superblock). The volume merges all attached disks; `df` grows on attach.

```bash
# cybsh (Terminal panel, or POST /api/os/exec {"line":"…"})
disk create <config-id> 512M
disk attach <disk-id>
disk resize <disk-id> 10G
disk check <disk-id>
df
```

- Spanned placement fills disk A to its high-water mark before B; round-robin available as policy.
- Admission control refuses with `disk full:` **before** any upload — no partial objects.
- `PUT /api/volume/block/{lba}` (base64) / `GET` with `{"start","end"}` range is the portable block path (Termux/Docker/web). FUSE (`cybermanju mount`) is Linux-desktop only with `/dev/fuse` probe.

## 4. Sync runs (async by design)

`POST /api/sync/start → 202 {jobId}` (never blocks the 5s request thread), poll `GET /api/sync/jobs/{jobId}` or `GET /api/sync/progress`, `POST /api/sync/cancel {jobId?}`. `cybsh sync start [config] [files…]` runs the same detached job via `POST /api/os/exec` (intercepted lock-free, before the request lock); bare-library `execute()` without a worker still answers `unsupported:` honestly.

Error prefixes (AGENT-1 contract) → UI hints (`describeSyncError`): `auth: / rate_limited: / not_found: / unsupported: (→501) / too_large: / integrity: / network:`, plus `disk_full:` and `conflict:`.

Encrypt-before-upload (`compress → encrypt CYBE1`, keystore handle in `sync_files`) is default-on; striped placement (`whole|striped`, `parity:1` = one replica, RS `k+m` under the hood) needs ≥2 enabled configs.

Unified-disk placement: single-copy home is the default — a file lives on ONE provider (`sync_files.home_config_id`); `SyncConfig.mirror=true` opts a provider back into duplicate-everywhere. `POST /api/sync/move {fileId, fromConfigId, toConfigId}` (Tauri `move_sync_file`, `cybsh sync move <file> <from> <to>`, Sync panel Move form) relocates verified — download A → upload B → BLAKE3 verify → delete A → retarget record; `mv /providers/<a>/x /providers/<b>/y` moves namespace bytes the same way. Vault/secret paths (`*.cybermanju`, `cybermanju-up-*.cyb3`, `master.passphrase`, `keystore.json`) are never synced or moved. One-folder setup keeps `<picked>/vault.cybermanju` beside `<picked>/files/` (the `local` root). Key holder: one provider/disk unwraps the others (`SyncConfig.keyHolder`, `DiskRow.holdsKeys`, `POST /api/disk/key-holder`, single-holder invariant enforced server-side).

## 4b. Agent runs (same async contract)

`POST /api/agent/prompt {configId, sessionId?, prompt} → 202 {jobId}`, poll
`GET /api/agent/jobs/{jobId}` (turns, usage, `pending` approvals),
`POST /api/agent/jobs/{jobId}/approve {approved, answer?}`,
`POST /api/agent/jobs/{jobId}/abort`. Asks park up to 10 min then auto-deny;
`deny` rules always win, even with auto-approve.
`cybsh`: `ai ask "<prompt>" [--config <id>] [--session <id>]` (detached via
the same lock-free intercept), `ai status [job]`, `ai abort [job]`,
`ai sessions`. Provider keys live sealed in `sync_secrets`
(`agent:key:<config_id>`); configs/sessions are plain JSON rows. Transcripts
sync like any file via export → striped placement.

Agent tools: `read/write/edit/list/grep/glob/bash/task/question` (+
`mcp__*`). `grep` is real regex (invalid patterns search literally);
`glob` supports `**` across separators; permission patterns match the bare
argument too (`git *` matches the command, tool prefix not required).

Agent loop hardening (all on by default): rate-limit backoff (3 retries),
doom-loop guard (identical tool call ×3 denied), `length`-finish truncation
notes, abort-checked retries and post-call polling, Anthropic prompt-caching
markers, read-only depth-1 subagents. `POST …/compact` summarizes a session
into a fresh one (old kept for revert). MCP servers (`stdio` local commands,
`http` Streamable) attach per config behind admin role; tools appear as
`mcp__server__tool` under the same permission rules. Tool outputs are
secret-redacted before entering transcripts; crashed MCP children reconnect
once mid-run; project rules load from `AGENTS.md`, `SKILL.md`,
`.cybermanju/rules.md` (8 KiB each, 24 KiB total); approvals can store
"allow always" as an explicit config row; `ai init` runs repo analysis that
writes `AGENTS.md` with the agent's own tools.

Semantic memory (`docs/MEMORY.md`): curated facts + embedding vectors in the
`agent_memories` redb table (same DB file). `memory_recall` / `memory_remember`
tools (permission-gated, subagents denied on remember); pre-prompt auto-recall
injects a bounded 2200-char block; compaction handoffs auto-store; long
memory-less runs set a `memoryHint` nudge. Embeddings via `{base}/embeddings`
(OpenAI dialect; per-config `embeddingModel`, Ollama works offline);
Anthropic degrades to keyword recall, never fails. HTTP:
`GET|POST|DELETE /api/agent/memories`, `POST …/recall`, `GET …/export`
(Hermes-compatible `MEMORY.md` + vectors for sync restore).

## 4c. Static-site cybsh (Pages/WASM transport, no dashboard)

On a static host every `os_exec` line is offered to `src/utils/staticCybsh.ts`
first; chained lines and unknown verbs fall through to the wasm dispatcher
(`crates/os-wasm/src/os.rs`). Verbs answered locally from the local-pc vault
(`sync.secret` signs, `secret:cybsh:key:*` keys, the `.cybermanju` file):

- `quota` — shell volume + browser storage + live per-provider probes (same
  endpoints as `crates/sync/src/quota.rs`); provider push still needs `:3456`.
- `providers`, `oauth status|start`, `disk`, `sync status|list`, `mount`.
- `encrypt|decrypt|keygen` (ChaCha20-Poly1305, vault keys), `compress|decompress` (lz4/zstd/brotli/triple, same `{alg,data:b64}` envelope as the native shell).
- `cp|mv|rm|mkdir` across the merged namespace: plain paths hit the shell
  volume, `/providers/<mountId>/…` hits that mount (same-provider renames,
  cross-provider and provider↔local moves, `-r` for trees, `.keep` markers
  for empty dirs — git mounts cannot hold those natively).
- `grep|find|head|tail|wc|edit` across the merged namespace too (single files
  via provider reads, `find` lists provider dirs one level, `edit` is
  exact-once with `conflict:` on ambiguity).
- `write` runs in the wasm dispatcher (editor save path, 1 MiB cap).
- `scrub` (BLAKE3 snapshot vs `cache:cybsh:scrub`), `repair` (prunes the
  record), `gc` (dry-run default, `--apply` deletes), `lease`, `echo`, `kill`, `ai`.

`sync start|cancel`, the OAuth redirect dance and provider push refuse with
`unsupported:` pointing at the desktop app / Docker image / dashboard server.

## 4d. Interface verbs (cybsh customizes the whole UI)

`theme [<id>|get]` and `ui …` read/write the full interface settings mirror
(`/.cybermanju/theme.json` on the volume, `cybermanju_theme_v1` in the
browser) identically on desktop, Docker, and Pages — 17 themes
(`THEME_IDS` in `src/ui/tokens.ts`, mirrored in `crates/os/src/shell.rs`,
`crates/os-wasm/src/os.rs`, `src/utils/staticCybsh.ts`):

- `ui theme <id>` — switch theme (shape, typeface, elevation + palette).
- `ui accent <#hex|default> [--for <theme>]` — recolor everything, or one
  theme (`ui accent #ff2d78 --for cyberpunk-night`); general wins when set.
- `ui density <compact|comfortable>`, `ui glass <0|solid|1|light|2|default|3|rich>`,
  `ui motion <auto|full|reduced>`, `ui glow <on|off>` — every Settings knob.
- `ui get [--json]` — full interface state (also the drift-healer: its
  `ui:` lines re-converge the live UI to the mirror).
- `ui vars [filter] [--json]` — live computed `--ui-*` token values from the
  DOM (live-terminal only; scripts use `ui get`).
- `ui palette [theme] [--json]` — a theme's color table + design language.

Every mutation prints machine `ui: key=value` effect lines
(`ui: theme=…`, `ui: accent=…`, `ui: density|glass|motion|glow=…`,
`ui: accent-for=<theme>:<hex|system>`); the Terminal panel applies them via
`useTheme()`, and `.cybsh` scripts harvest the same keys as structured
effects. Implementations: `ui_cmd`/`theme_cmd` per shell, live application in
`TerminalPanel.applyCybshUiEffects`, tokens in `src/ui/tokens.ts`.

## 5. Durability: scrub / repair / gc / leases

| Task | Route | Notes |
|---|---|---|
| Scrub pass | `POST /api/scrub/run`, `GET /api/scrub/runs` | BLAKE3 re-verify, findings queued for repair |
| Repair | `POST /api/repair/run`, `GET /api/repair/status|tasks|health`, `POST /api/repair/rebuild` | 202 task; rebuild restores catalog after laptop loss |
| GC | `POST /api/repair/gc {dryRun}` | Refcount authority; never deletes referenced chunk |
| Lease | `POST /api/lease/acquire|release`, `GET /api/lease/status[/{scope}]` | Single writer TTL + steal-after-expiry; live lease → `conflict:` |

`cybsh`: `scrub`, `repair`, `gc [--dry]`, `lease status`.

## 6. Auth & TLS

- Register is bootstrap-only; role never self-`admin`. Every mutating route checks `Claims{role}` (default `Authenticated`, fail-closed; unknown route without creds → `401`, with creds but unknown → `404` via `is_known_route`).
- First run on Docker/web (every device): open `http://<nas-ip>:3456` — the
  login gate offers **Create the first account** while
  `GET /api/auth/status → { "registrationOpen": true }`, then plain sign-in
  afterwards. Each browser signs in once (JWT in its own localStorage); a 401
  anywhere re-opens the gate instead of spamming fetches.
- Multiple accounts: dashboard users are created by an `admin` in
  Accounts → Users (`POST /api/users`; headless: provision via
  `CYBERMANJU_ADMIN_USERNAME/_PASSWORD` or open registration temporarily
  with `CYBERMANJU_ALLOW_REGISTRATION=1`). Provider OAuth accounts
  (Google/GitHub/GitLab, Connections tab) are a separate system and
  unlimited — including several accounts on the same provider.
- `GET /api/sync/configs` never serializes `token` (absent, not null). Private keys sealed (Argon2id + ChaCha20Poly1305, `sealed:v1:`).
- No TLS in-app (hand-rolled HTTP/1.1). Terminate at Caddy/nginx (HSTS there, not in-app). See `docs/SECURITY.md` for threat model, rotation, OAuth PKCE, rate limits (100 req/60s), parser caps, `security_headers`.

## 7. Health, metrics, backup

- `GET /api/health` (compat shape) + `GET /api/readyz` (redb + index + disk writable) + `GET /api/metrics` (counters).
- Backup while running: `scripts/backup.sh` (redb + tantivy snapshot). Restore = stop, replace files, start, `POST /api/repair/rebuild` if the catalog is suspect, `disk check` each disk.

## 8. Transports

`tauri IPC` (desktop, but `os_*/disk/*` are `REST_FIRST` → `:3456`), `rest` (Docker/web), `wasm` (Pages: localStorage volume + BM25-lite, server ops answer `unsupported:`). Settings shows the active transport.

## 9. Honest limits (browser + crypto)

- **WASM caps:** the Pages pack runs `lz4` + `brotli` natively plus `zstd` and
  `triple` (LZ4→ZSTD→Brotli, the desktop `.cyb3` order) through the bundled
  `@dweb-browser/zstd-wasm` module — same standard frames as the desktop, so
  artifacts open both ways; the dashboard build has no compression endpoint
  at all. Editor + `write` op cap at 1 MiB.
- **ML-KEM label:** the wasm bundle ships X25519 + ML-DSA-65 + ChaCha20-Poly1305
  and no ML-KEM. Keygen for `kyber*`/`hybrid`/`frodokem*` mints X25519 material
  and file encryption is ChaCha20-Poly1305; the panel prints
  `X25519 + ChaCha20-Poly1305 (ML-KEM slot)` so the slot name never implies a
  lattice operation that did not run.
- **CORS:** provider canals only claim `github`, `gitlab`, `googleDrive`
  (anything else is refused up front with `unsupported:`) — live sync for
  remote providers needs the desktop app, Docker image, or dashboard server.
- **Faces:** every detection is engine-labeled (`onnx` / `heuristic-v2` /
  `none`) on all transports — desktop runs SCRFD+ArcFace where `ort` links
  (win/mac/linux + model files) and the labeled skin-segmentation heuristic
  everywhere else (incl. Android); Docker serves `POST /api/faces/detect*`;
  Pages runs the same heuristic in-browser with kv-backed groups. The
  heuristic needs eyes (a pair, or one eye plus a mouth — a bare skin blob
  is a hand, not a face) and says `HEURISTIC` in the panel; ONNX silence
  stays silence.
- **Folder attach:** Chromium remembers picked folders in IndexedDB and
  re-opens them with one click after reload (permission lapses are
  re-granted, never re-picked); desktop uses native dialogs (no permission
  model) and Docker/server paths persist in the DB. Plain-HTTP LAN has no
  File System Access API at all — the vault then lives on the server.
- **tree-sitter:** desktop `parse_text` runs real grammars
  (rust/python/js/ts/go/bash) and reports `"engine": "tree-sitter"`; every other
  language — and the whole Pages build — uses the heuristic parser and reports
  `"engine": "heuristic"`. The editor outline badge shows which one ran.
- **FSA:** the `.cybermanju` open/create/save path needs the File System Access
  API (Chromium). Firefox/Safari get Export/Import fallback instead, and the
  Accounts panel says so before the picker opens.
