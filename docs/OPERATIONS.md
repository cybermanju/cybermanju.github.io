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
- `GET /api/sync/configs` never serializes `token` (absent, not null). Private keys sealed (Argon2id + ChaCha20Poly1305, `sealed:v1:`).
- No TLS in-app (hand-rolled HTTP/1.1). Terminate at Caddy/nginx (HSTS there, not in-app). See `docs/SECURITY.md` for threat model, rotation, OAuth PKCE, rate limits (100 req/60s), parser caps, `security_headers`.

## 7. Health, metrics, backup

- `GET /api/health` (compat shape) + `GET /api/readyz` (redb + index + disk writable) + `GET /api/metrics` (counters).
- Backup while running: `scripts/backup.sh` (redb + tantivy snapshot). Restore = stop, replace files, start, `POST /api/repair/rebuild` if the catalog is suspect, `disk check` each disk.

## 8. Transports

`tauri IPC` (desktop, but `os_*/disk/*` are `REST_FIRST` → `:3456`), `rest` (Docker/web), `wasm` (Pages: localStorage volume + BM25-lite, server ops answer `unsupported:`). Settings shows the active transport.
