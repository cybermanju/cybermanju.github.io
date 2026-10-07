# TASKS.md — CyberManju OS Full Audit → Action Plan

Source: full repo analyze 2026-10-07 (v0.1.1, `com.cybermanju.os`).
Scope: bugs, problems, philosophical improvements for the cross-device app
(Tauri desktop | Docker REST `:3456` | Pages WASM+OPFS).

Legend: `[P0]` critical/security-data-loss · `[P1]` cross-device parity · `[P2]` robustness/ops · `[P3]` philosophy/debt.
Checkboxes are intentional — tick as you land.

---

## P0 — Auth / AuthZ (fail-closed is currently fail-open on objects)

- [ ] `P0-1` Enforce object-level file access on REST — `verify_file_access` exists in `src-tauri/.../users.rs:369-411` but `grep verify_file_access crates/web` = 0 hits. Call it in `crates/web/src/api/files.rs`, `api/share.rs`, `lib.rs:1218-1290` (`GET/PUT/DELETE /api/files/:id/content`, share, sync, agent, os/exec).
- [ ] `P0-2` Fix `RequiredRole::is_satisfied_by security.rs:106-112` — returns `true` for `Authenticated` regardless of role, so `viewer` writes. Make viewer read-only.
- [ ] `P0-3` Authenticate Tauri IPC — `register/create/update/delete/list_users`, `set/grant/revoke_permission` take only `State<AppState>`. `LocalIpc` mode allows arbitrary `admin` creation. Add local auth / capability gate.
- [ ] `P0-4` Strip `password_hash` on Tauri — `list_users:250-265` returns full `User`; web `list_users_safe:2375-2402` strips it. Mirror stripping on IPC.
- [ ] `P0-5` Unify token systems — web persistent JWT vs Tauri `OsRng`-fresh `hmac_secret` per boot (`lib.rs:66-69`). Desktop sessions die on restart, JWT lives. Shared revocation needed; move revocation/backoff/rate out of in-memory `AuthState` (restart wipes `revoke()`, multi-replica shares nothing).
- [ ] `P0-6` Fix `restore_config_token lib.rs:2581-2602` writing `token` back into `sync_configs` JSON — defeats `#[skip_serializing]` + `sync_secrets` side-table (`db/database.rs:415-429`). Never persist secrets in listable rows.
- [ ] `P0-7` Close SSE auth gap — `lib.rs:433-441` intercepts SSE pre-`handle_request`; EventSource can't send `Authorization`. Enforce query-token in `handle_sse_connection` or remove live tail.

## P0 — Agent RCE / permission bypass

- [ ] `P0-8` Gate `save_config` MCP servers — only `POST/DELETE .../mcp` is `Admin`-gated (`security.rs:202-204`), but `save_config:169-208` reachable as `Authenticated` embeds `mcp_servers` unchecked + `auto_approve` + `allow bash` → unattended `tool_bash:1150-1259` (`sh -c`, root cwd). Require `Admin` for `mcp_servers` / `auto_approve` / `allow bash`.
- [ ] `P0-9` Re-auth `remember:true` — `approve_job:2063-2085 remember_allow(tool)` persists `Allow` with no re-auth, silent fail. One approved `ask` becomes permanent. Require explicit confirm + audit log.
- [ ] `P0-10` Scope jobs/approvals per-user — `JOBS/APPROVALS:765-774` global `Mutex<HashMap>`, `wait_approval:2089-2105` 600s, no `user_id` binding. Guessable `job_id` → approve чужой job. Same for `RunRegistry` global `run-<ts>-<seq>` + `cancel_job(None)` cancels `latest` irrespective of owner. Bind `job_id → user_id`, random IDs.
- [ ] `P0-11` Fix containment TOCTOU — `normalize_join/join_contained:840-874` explicitly no symlink resolution, `..` popped lexically, `read_raw→apply_edit→tool_write` non-atomic (`agent_api.rs:1337-1347`). Add symlink resolution + file lock / atomic write.
- [ ] `P0-12` Scope `POST /api/agent/memories{,/recall}` per-`config_id` — `recall` without `configId` scans all configs keyword-only.

## P0 — Crypto / data-loss

- [ ] `P0-13` Fix hybrid encrypt needing private key — `encrypt_data:420-455` derives X25519 static from ML-KEM SK. Public-key-only encryption impossible; ML-KEM compromise kills both halves. Independent classical keypair.
- [ ] `P0-14` Key separation — `encrypt_with_symmetric_key:486-523` uses `private_key[..32]` raw (no KDF) for `MlDsa44/65/87, ClassicalSign, Aes256`. ML-DSA seed doubles as signing seed + enc key. Per-purpose KDF.
- [ ] `P0-15` Fix algorithm labels — `algorithm_from_str:762-775`: `kyber768|kyber512→Hybrid`, `sphincs+→ClassicalSign` (HMAC, not PQ), `Aes256` is ChaCha20Poly1305. UI `nist_level Hybrid=5` overstates (768=L3).
- [ ] `P0-16` Bulk-restore CPU DoS — `seal/open_sealed` fresh Argon2id per blob; `restore:815-821` derives per-file. Cache derived key / streaming restore.
- [ ] `P0-17` `data_dir()` fallback to `temp_dir()/cybermanju` when `HOME` unset — predictable world-readable `/tmp`. Fail-closed instead. `get_or_derive:190-220` silently re-wraps on passphrase change — warn loudly, keep old key.
- [x] `P0-18` Hash-anchor minimum — `agent/edit.rs:21-30 actual.starts_with(anchor)` with no minimum; 4-hex-char (16-bit) passes despite “64+ bits” comment. Enforce `anchor.len()>=16`. Fix `strip_anchor` dropping legitimate trailing `[blake3:64hex]` lines.

## P0 — Sync / lease / repair correctness

- [ ] `P0-19` Lease CAS — `lease.rs:159-189` read-then-write in separate redb txns, no CAS. `leases` + `vv/*` local-only, never synced — cross-device mutex is illusion. `default_holder()` falls back to `device-<pid>` (pid reuse). Needs server CAS or document single-writer.
- [ ] `P0-20` `decide_write` Overwrite loses history — `332-351` comment says “vectors merged” but code just `Apply`. `suggested_id` uses `process::id()` — cross-device collision. Real merge or rename.
- [ ] `P0-21` Durable job poll — `MAX_LIVE_RUNS=16 (state.rs:198)`, `SYNC_RUN_HISTORY_LIMIT=20 (db/database.rs:95)`. Old `jobId` → `not_found` after eviction/restart. Persist runs, or return `expired:` not `not_found:`.
- [ ] `P0-22` Write-lock serialization — every `POST/PUT/DELETE` holds process `RwLockWriteGuard (lib.rs:1174-1179)` + `disk/repair/os` handlers run under `db.write()`. Long download/upload stalls all writes + starves readers. Spawn long work (per existing `Long work must be spawned` comment).
- [ ] `P0-23` Unbounded growth — `PENDING:226` flush only “at top of any request holding write lock” (idle server holds repair/scrub in RAM); `FINDINGS:86` uncapped; `GET /api/repair/status:1296-1319` clones all rows. Cap + paginate.
- [ ] `P0-24` Rebuild flattens hierarchy — `write_rebuild_records:1234-1276` creates `FileNode{parent_id:None}` — all recovered at root. Preserve parent paths.

## P1 — Frontend transport parity (`src/composables/useTauri.ts`)

- [ ] `P1-1` `isTauri():99-101` truthiness — `'__TAURI__' in window` is true even when `vite.config.wasm.ts:53-58` defines it `false`. Check truthiness. Same fix in `SettingsPage.vue:319`, `StatusBar.vue:80`.
- [ ] `P1-2` Shared `useTransport()` — replace binary `isWebMode()/isStaticHost()` labels with one 3-state helper `(label/short/tone/backend: tauri|rest|wasm)`. Fix `StatusBar.vue:80`, `KeyboardShortcutsHelp`, `ShellShortcutDock` (currently `WEB/TAURI`); `CodeStudio.vue:380` 3-way is the pattern to keep.
- [ ] `P1-3` Static-host health probe — `isStaticHost():115-119` has no probe: bare `https://host` → `wasm` even if user expected REST; stale `_serverUrl` → forced REST + `ERR_CONNECTION_REFUSED`. Probe `_serverUrl`/`/api/readyz` with fallback.
- [ ] `P1-4` WASM first-paint flash — `wasmBackendActive() useWasmBackend.ts:159-161` null until async load; `SettingsPage:299-313`, `ShellShortcutDock:141-146`, `LandingPage:169` flash `Web→WASM`. Use `isStaticHost()` for initial label, reactive ref after `loadWasm()`.
- [ ] `P1-5` `REST_FIRST:1147-1165` split-brain — `get_sync_job/list_runs/...` REST but `list/create/start/cancel/progress/test_connection` IPC on desktop. Job started via IPC invisible to REST poll. One side per domain + `restFetch→core.invoke` fallback (or `dashboard_status` health gate) when dashboard down.
- [ ] `P1-6` Missing `os_write` REST route — `OS_WASM_COMMANDS:1168-1171` has it, `REST_ROUTES`/`REST_FIRST` don't. `stores/app.ts:791-805 saveWasmFile` → `Unknown command` on desktop/REST. Add `PUT /api/os/write` + `REST_FIRST`, or branch to `write_file_content`.
- [ ] `P1-7` Encode OS paths — `os_stat/ls/du:1055-1066` concat `'/api/os/stat'+path` unencoded (`/foo bar`, `..`). Use `?path=` + `encodeURIComponent` like `os_complete:1053`.
- [ ] `P1-8` `search_files_paginated` wasm route — REST-only, no `DB_WASM_ROUTES`; static path `throw [WASM Mode]` then accidental fallback via `search_files` (BM25-lite, score `1.0`, no snippet, `fileId=path`). Add `files.search_paginated` db op or explicit wasm unwrap.
- [ ] `P1-9` Rename `WRITE_ONLY_COMMANDS:1115-1139` → `DESKTOP_ONLY` — `generate_keypair/encrypt/decrypt/compress/parse_file` have `STATIC_COMMAND_HANDLERS:1667-1680` on wasm. Document override; `ShieldPanel.vue:61,92,125 webLocked` disables crypto on pure REST with no REST endpoint — add or document gap.
- [ ] `P1-10` `restFetch:146-185` hardening — add `network:` prefix on catch (AGENT-1), preserve prefix when server sends plain text, `AbortController` timeout (hangs offline), retry `network:/rate_limited:` with backoff. `probeStaticConnection:1776-1840 default:return false` misreports `s3/webdav/...` as wrong-token — `throw unsupported:` instead.
- [ ] `P1-11` `pathExists:2167-2175` bypasses wasm — raw `restFetch GET /api/files`, always false offline. Use `invoke('list_files')`.
- [ ] `P1-12` `notifyError stores/app.ts:248-259` — suppresses `[WASM Mode]` (null, no toast/console), hides parity gaps. Log + counter. Centralize `notifyError → describeSyncError|agentErrorHint → toast(detail+hint)`; merge `types:545-570` missing `invalid:/context:/limit:`.
- [ ] `P1-13` Store loading/errors — single `lastError` string + shared `isLoading` races (`fetchFiles:327-379` parallel in `initialize:275-284`). Per-domain `loading{}` / error queue. `initialize:270-289` omits `fetchOsPs/dashboard/disks/agent`; `startAutoRefresh` omits `disks/os/agent`; gate `StatusBar:128-133` 4s `fetchOsPs` poll on `!isStaticHost()||document.visible`.
- [ ] `P1-14` Agent SSE — `subscribeAgentJob:1685-1738` hardcodes `getServerUrl()||localhost:3456` SSE — breaks Tauri-IPC-only and wasm (no `/events`). Poll `invoke('agent_job_status')` on those transports.
- [ ] `P1-15` Settings display — `SettingsPage.vue:295-339`: `VITE_TRANSPORT` undocumented; `effectiveApiUrl:335-339 .toUpperCase()` breaks copy-paste (`HTTPS://…`); `serverUrlDraft:334` non-reactive (reload covers, fine). Preserve case, document env, reuse `useTransport()`.

## P1 — Offline / OPFS / volume

- [ ] `P1-16` Single volume writer — triple writers to `cybermanju.os.volume`: `useTauri.ts:1391-1418` whole-blob JSON, `crates/os-wasm/src/os.rs:34,95-144`, `useVolumeMirror.ts:21`. Read-modify-write race + 5MiB quota. Rust `save_volume` silently drops return. Add locking/dirty-merge, surface quota (`disk_full:` already correct on TS side).
- [ ] `P1-17` Shared 1MiB cap — `os.rs:39 MAX_WRITE_BYTES` vs `staticCybsh.ts:28 STATIC_WRITE_LIMIT` duplicated. Extract shared const + test.
- [ ] `P1-18` Pipe refusal UX — `os.rs:386-390` refuses `|` with `unsupported:` but `staticCybsh` intercept (`useTauri.ts:1971-1978`) swallows throw; chained `quota && ls` fails confusingly. Log interceptor decision.
- [ ] `P1-19` WASM load resilience — `loadWasm:143-156` rejection cached forever, no retry. `wasmDbBackend:308-317` caches `opfs|memory` forever — never upgrades if OPFS appears. `dbWorker:502-542` 30s/120s timeouts, no `navigator.onLine` fast-fail. Retry + upgrade path.
- [ ] `P1-20` Vault boot — `useVault.ts:64-93 kvKnownBroken` flips permanently on one `unsupported:` (correct for old pkg) but `vaultBackend()` stays `unknown` until first call. Call `wasmDbBackend()` at boot so `AccountManagerPanel.vue:905` warning is accurate. `migrateVaultFromLocalStorage:146-165` good — keep.

## P2 — Tests (28 files / ~336 tests, not 25/281)

- [ ] `P2-1` Fix AGENTS.md counts + add contract tests: `POST /api/sync/start→202{jobId}` + poll `/jobs/{id}`/progress/cancel; `POST /api/agent/prompt→202` + approve/abort, 10-min auto-deny, `deny`-beats-auto-approve.
- [ ] `P2-2` Lease/repair/GC tests: `POST /api/lease/acquire|release`, `GET /api/lease/status`, TTL + steal-after-expiry, live-lease → `conflict:`; `POST /api/scrub/run`, `GET /api/scrub/runs`, `POST /api/repair/run|rebuild|gc`, refcount-GC `dryRun`, `PUT|GET /api/volume/block/{lba}`, RS `k+m` placement, two-device concurrent-write / offline-reconnect / admit-before-upload `disk_full:`.
- [ ] `P2-3` Transport parity test: boot real `crates/web` (claimed 135+ routes in `lib.rs`), assert every `REST_ROUTES.buildPath()` served + `tauri/rest/wasm` shape equality (`snake→camel`, `_key` stripping) + full AGENT-1 prefix→hint matrix (`auth:/rate_limited:/not_found:/unsupported:→501/too_large:/integrity:/network:/disk_full:/conflict:` + `invalid:/context:/limit:`).
- [ ] `P2-4` WASM twin tests: compression (`lz4/brotli` vs desktop-only `zstd`/`triple`), `X25519 (ML-KEM slot)` label, `tree-sitter` vs `heuristic engine` flag, FSA-Chromium vs Firefox/Safari Export/Import fallback — currently documented honest limits with no regression test (`container.test.ts` injects Node primitives to avoid wasm bundle).

## P2 — CI / versions / deploy

- [ ] `P2-5` Gate audits — `cargo audit` + `npm audit` both `continue-on-error` (GitLab `allow_failure`). Decide: gate or explicitly accept.
- [ ] `P2-6` Docker smoke — `ci:docker-build` only `build push:false + docker images`. Add `compose up` + `GET /api/readyz` + one `POST /api/...` smoke (same GitLab). Assert `read_only/cap_drop/no-new-privs/mem_limit` hardening.
- [ ] `P2-7` Fix flaky artifact chain — `rpm/flatpak download-artifact continue-on-error:true` then `upload-artifact if-no-files-found:error` (misleading late failure). Fail fast with clear message. `arch-build` deliberately `needs:` nothing, rebuilds full Tauri (~11min) — wire deps or document.
- [ ] `P2-8` Android signing parity — `release.yml REQUIRE_SIGNING=1` hard-fails, but `ci.yml android-build` publishes **unsigned `-release-unsigned.apk` as green**. Sign or mark `unsigned`. No emulator install/run; aarch64 only (documented `ort-sys` reason) — track x86_64/AAB/Play/update-channel.
- [ ] `P2-9` Pages preview on PRs — `deploy-pages needs:wasm-build, push-main-only`. PRs never verify `dist-wasm/index.html`. Add preview artifact. GitLab `pages:` only `cp dist-wasm → public/` + `test -f index.html`, artifact expires 1 week, no publish config.
- [ ] `P2-10` Release parity — GitHub `create-release` hard-fails if any of `windows/linux/rpm/flatpak/arch/macos/android/wasm` missing; GitLab `windows/macOS manual+allow_failure, OPTIONAL=1` routinely ships without exe/msi/dmg. Align policy.
- [x] `P2-11` Version script hardening — green today (`0.1.1` everywhere) but `check-version.sh` + AGENTS.md comments still say `0.1.0`; matchers break on `version.workspace`/indent/README reformat; misses Android `versionCode` (gitignored `src-tauri/gen/`), iOS (no target), Flatpak version, Docker `:latest`, `Cargo.lock`; tag only checked with `--tag` (release time, not `main`). Fix comments, loosen matchers, add carriers or explicit exclusions.
- [x] `P2-12` Compose/docs unification — `docker-compose.yml` hardened vs `ARCHITECTURE §9` stale insecure (`3456:3456`, no hardening, `healthcheck /api/health` vs `OPERATIONS:12` + compose `/api/readyz`). Copy-paste opens WAN + wrong probe. Single source + CI `diff` check. Pin `x-casaos.icon` URL or CI-check it. Assert `vite.config.wasm.ts base:/` + `port_map/index:/` consistency.
- [ ] `P2-13` Pages identity — `ARCHITECTURE §11` (read-only demo / remote REST) vs `OPERATIONS §4c+§8` (local vault: localStorage+BM25-lite, server ops → `unsupported:`). Pick one. Document Pages→NAS CORS breakage (`https://<user>.github.io` → `http://nas:3456` gets no `ACAO`): proxy/CORS allowlist procedure.
- [ ] `P2-14` Dockerfile vs CI wasm parity — `Dockerfile` Stage-1 `DOCKER_BUILD=true build:wasm:frontend` (stub plugin, no `wasm-pack`) vs CI real `wasm-pack build crates/os-wasm`. Docker-static vs Pages differ in exactly the documented caps (`zstd/triple`, ML-KEM label, compression endpoint). Parity test or single build path.

## P2 — TLS / mobile

- [ ] `P2-15` Ship the proxy — `crates/web` no-TLS by design (`SECURITY §2`); documented next step (`HOST_IP=192.168.1.50`, `0.0.0.0` behind proxy) is cleartext LAN (JWT/Bearer/file bytes sniffable). Commit Caddy/nginx compose + HSTS + `80→443` + `client_max_body_size 100m` aligned to app 100MB cap. Document `X-Forwarded-For/Proto` trust policy (else one-IP false 429s @ `100 req/60s` or spoofing). OAuth `redirect_uri` defaults `http://127.0.0.1` exact-match — preflight check for `https://...` behind TLS.
- [ ] `P2-16` Mobile story — Android: arm64-v8a only, no AAB, no `versionCode` bump, no Play, no on-device DB/keystore backup, no FSA/volume-block story, no Tantivy/ONNX battery budget. iOS: zero (`tauri ios init`, `Info.plist`/entitlements, ATS exception for `http://nas:3456` blocked by default, universal-links, CI job, Safari Export/Import fallback test for FSA-less path). `Permissions-Policy: camera=(), microphone=(), geolocation=()` + `frame-ancestors 'none'` kill voice-mic, GPS MapView, OAuth popups in WebViews — documented override needed.
- [x] `P2-17` Doc drift — `generate_handler!` ~100 handlers not “35”; `commands/mod.rs` 19 modules not 20; `Cargo.toml` 16 members not 15 (`+docker/server`); `ROUTED_SEGMENTS security.rs:119-156` coarse L2 only. Fix AGENTS.md or CI-assert counts.

## P3 — Philosophical (what “better/different” looks like)

- [ ] `P3-1` **One Backend interface, not three apps.** Define `Backend` (files/search/os/disk/sync/agent/db/kv) with capability flags (`supportsStreaming`, `maxWriteBytes`, `engine`); `unsupported:` as typed result, not exception string. Gate by capability + permission, not `isTauri/isStaticHost`.
- [ ] `P3-2` **Local-first log, not server-first files.** `redb` single-file (exclusive lock forbids double-open Docker+desktop on same `/data`) + file-bytes sync (not DB deltas) + local-only leases = split-brain. Ship op-log / CRDT deltas (sync the `vv` vectors you already model), content-addressed blocks (BLAKE3 + RS `k+m` already there), CAS leases.
- [ ] `P3-3` **Offline as a state.** OPFS R-M-W + quota + `[WASM Mode]` suppression + localhost-hardcoded SSE make offline an accident. Explicit `offline/readonly/degraded` UI states with queue-and-replay, dirty-merge, quota surfacing.
- [ ] `P3-4` **AuthZ before features.** Object ACL + per-config agent ACL + per-user jobs + viewer-read-only + persistent revocation. Fail-closed means nothing without it.
- [ ] `P3-5` **Test the contract.** One parity test booting real `crates/web` asserting every mapped path + shape equality + AGENT-1 matrix beats 336 unit tests. Add sync/agent lifecycle, lease TTL/steal, GC dryRun, RS placement, offline-reconnect.

---

### Smallest high-value order (if you want 5 PRs)
1. `P1-1 + P1-2 + P1-15` — truthy `isTauri` + `useTransport()`, 3-state StatusBar, `effectiveApiUrl` case.
2. `P1-10 + P1-12` — `restFetch network:` + timeout + 401; `notifyError` hints + `[WASM Mode]` logging.
3. `P1-6 + P1-7 + P1-8 + P1-5` — `os_write` + `search_files_paginated` routes, encoded OS paths, unified sync `REST_FIRST`.
4. `P0-1 + P0-2 + P0-8 + P0-10` — object ACL, viewer read-only, `save_config` gating, per-user jobs.
5. `P0-18 + P2-11 + P2-17 + P2-12` — anchor `len>=16`, version comments/matchers, AGENTS.md counts, compose/healthcheck unification.
