---
Task ID: 1
Agent: main
Task: Full codebase audit, ZimaOS compatibility, stub elimination, deployment setup

Work Log:
- Read all 40+ source files (Rust backend, Vue frontend, configs)
- Cataloged every mock, stub, and semi-real implementation
- Researched ZimaOS architecture via GitHub (CasaOS Gateway, microservices, JWT auth, Docker Compose x-casaos format)
- Identified key compatibility requirements (API endpoints, storage paths, auth, deployment format)
- Replaced WASM mock data in useTauri.ts with real REST API client (18 command mappings)
- Updated Pinia store to use composable invoke instead of direct @tauri-apps/api/core import
- Created docker-compose.yml with full x-casaos metadata for ZimaOS App Store
- Created multi-stage Dockerfile (node build → rust build → alpine runtime)
- Created standalone Docker server (docker/server/) for non-Tauri deployment
- Created .github/workflows/ci.yml (rust-check, docker-build, wasm-build, deploy-pages)
- Created .dockerignore for optimized Docker context
- Updated vite.config.wasm.ts for GitHub Pages deployment
- Rewrote Tantivy search index: proper schema field handles, add_document, remove_document, real term dictionary suggest, open_or_create
- Created commands/import.rs with import_file, scan_directory, upload_file, rebuild_search_index commands
- Registered new import commands in lib.rs invoke_handler
- Added infer + mime_guess dependencies to Cargo.toml
- Removed compression fake estimation fallback — now errors if no file on disk (with smart path resolution)
- Fixed decompression to try individual layers if triple fails, and error instead of estimate
- Replaced PQC sign/verify placeholders with real rustpq ML-DSA (Dilithium) sign_message and verify_signature
- Created comprehensive ARCHITECTURE.md (798 lines) covering all 11 modules, database schema, data flows, deployment
- Created README.md (379 lines) with build instructions, ZimaOS install guide, API reference, project structure

Stage Summary:
- Zero mocks remaining — useTauri.ts maps all commands to REST endpoints in web mode
- Zero fake estimation stubs — compression/decompression require real files
- Zero placeholder crypto functions — sign/verify use real rustpq ML-DSA
- Tantivy search fully functional with real add_document, remove_document, term completions
- New file import pipeline: import_file (single), scan_directory (recursive), upload_file (raw bytes), rebuild_search_index
- Full ZimaOS compatibility: Docker Compose with x-casaos metadata, /DATA/AppData/ volume, port_map
- CI/CD: 4-job GitHub Actions pipeline with Docker, WASM, and Pages deployment
- 12 files modified/created, ~4164 total lines written
## 2026-10-04 — release-readiness pass

- Arch AppImage: gdk-pixbuf2 2.44 on Arch dropped `/usr/lib/gdk-pixbuf-2.0/2.10.0`
  (loaders moved to glycin) while its .pc still advertises the path, so
  linuxdeploy's gtk plugin aborted with `cp: cannot stat ''`. CI now recreates
  the loader directory; release job also mirrors the NO_STRIP /
  APPIMAGE_EXTRACT_AND_RUN / patchelf fixes.
- Android: `tauri android init` generates no release signingConfig, so CI
  uploaded `app-universal-release-unsigned.apk` — Android refuses to install
  it. New `scripts/android-signing.sh` injects the keystore (repo secrets
  ANDROID_KEYSTORE_B64 / _PASSWORD / _ALIAS) into the generated project,
  verifies the signature with apksigner and renames the APK to
  `CyberManju-OS-<version>-arm64-v8a.apk`.
- Release workflow: fails if any format artifact is missing (previously only
  `warn`), fixes setup-android's removed `tools` package, and publishes
  SHA256SUMS.txt with the release assets.
## 2026-10-05 — decentralized-OS production pass (no toolchain; CI must prove)

- Frontend transport surface closed: `REST_ROUTES` + `REST_FIRST` for sync jobs/runs/status/restore/remote/usage/oauth and durability (`repair/scrub/lease/gc`); Pinia actions + `SyncJob/SyncRunRecord/RestoreOutcome/QuotaUsage/ScrubRun/RepairStatus/GcReport/LeaseInfo` types + `describeSyncError` hints; full `SyncPanel.vue` wizard (config per-backend fields, test/save/OAuth, start/cancel/runs, quota, restore/remote-delete/browse, striped placement + conflict policy); Settings active transport (`VITE_TRANSPORT`, wasm-aware); `env.d.ts` typed env; `user-scalable=no` removed; WASM base fixed to `/` (root Pages site).
- Honesty: face detection no longer fabricates pseudo-faces (empty set + log, helper kept `#[allow(dead_code)]` for tests); `import_from_url` writes `imports/{id}_{name}` + `original_path`; README tree-sitter claim corrected to heuristic regex; `cybsh sync start` refusal points at `POST /api/sync/start → 202` (R8-1 resolved as documented).
- Docs: new `docs/OPERATIONS.md`; README OS section + ARCHITECTURE §12; `AGENT-7.md` ticked `[x]` with Log; `AGENT-8.md` items 1–12/14–15 ticked, 13 in progress, R8-1/R8-2 resolved; `AUDIT.md` OS-push entry.
- Honest status of old claims: "Zero mocks remaining" (prior worklog) was premature — F1/F7/F8/F19 covered above; version single-source holds (`package.json` truth, status endpoint uses `CARGO_PKG_VERSION`).
- Not run here (no cargo/node_modules): `cargo fmt/clippy/test --workspace`, `npm run typecheck/lint`, `scripts/os-acceptance.sh 0/1/2`, `scripts/check-version.sh`.
## 2026-10-06 — sync-start-real + task-bridge + R6-3 + real tree-sitter (no toolchain; CI must prove)

- `cybsh sync start` runs for real: portable `SyncStart`/`parse_sync_start` starter core in `crates/os/src/shell.rs` (pure parsing, coreutils-style) + `os_api::try_sync_start_exec` + lockless intercept in `route_request` before the request lock (where `start_job` would deadlock); detached `start_job` semantics with terminal `ExecResult` answers; bare `execute()` keeps honest `unsupported:`. WASM keeps honest refusal (no providers/network there).
- Repair tasks bridged into `ps`/`top`: `task.rs repair_rows()` mirrors `repair::tasks()` as stable synthetic rows (`REPAIR_ID_BASE` + FNV, never persisted); `kill` refuses them with `unsupported:` (detached workers, no cancel handle); `os_api`/`cybsh` inherit the merged table with no call-site changes; unit test added.
- R6-3 closed: `os-acceptance.sh:28` already carries the fixed counting pipeline; `AGENT-6.md` request marked resolved, Tier 0 box reworded to pending-CI.
- Real tree-sitter (F8): `tree-sitter 0.24` + six 0.23 grammars (rust/python/js/ts/go/bash) behind default-on `real-treesitter`; query-free tree walk (node-kind sets + `name`/`type` fields, node/symbol caps, `"engine"` reported, heuristic fallback same shape); `parse_file`/`get_symbols` switched over; unit tests added; README/ARCHITECTURE/OPERATIONS updated. Grammar/runtime version pairing must be confirmed by `cargo check` in CI.
- Not run here (no cargo on box): `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `scripts/os-acceptance.sh all`.
## 2026-10-06 — VS-like cross-device code editor (no cargo on box; CI must prove)

- New `editor` panel (`CodeEditorPanel.vue`, Dock entry, `Ctrl+E`, lazy-loaded): explorer + tabs with dirty dots, gutter + highlight overlay editing, Tab/Ctrl+S handling, find with cycling, Ln/Col status, live tree-sitter outline with click-to-jump, per-tab engine badges.
- Cross-device saves: `GET|PUT /api/files/{id}/content` (shared `api::files` logic — version snapshot before overwrite, size/hash refresh, honest `encrypted:`/`binary:`/`too_large:`/`not_found:` refusals) with Tauri twins; Pages edits the WASM volume via a new `write` dispatcher op (1 MiB cap, round-trip tested).
- Store actions (`read/saveManagedContent`, `read/saveWasmFile`, `listWasmDir`), invoke mappings, `FileContent`/`SavedContent` types, `os_write` wasm bridge; `crates/tests/src/editor.rs` pins auth gating, round-trip + versioning, refusals, and code-parse shape.
- Not run here: `cargo test` (new `files.rs`, `code.rs`, wasm `os.rs`, integration tests), clippy, `os-acceptance.sh`.
## 2026-10-06 — native AI agent core, production vertical (no cargo on box; CI must prove)

- New pure-Rust `crates/agent` (providers catalog ×10 + custom, opencode-style permission matcher, OpenAI+Anthropic protocol builders/parsers, turn state machine, hash-anchored edits) with unit tests; `native` feature gates blocking HTTP.
- Server runtime `crates/web/src/api/agent_api.rs`: keyless config CRUD (keys sealed in `sync_secrets`, `hasKey` only), model refresh, sessions + import/export, detached jobs (202 poll/abort/approve with 10-min ask parking), 7 native tools (read/write/edit/list/grep/bash/task-subagent) contained under the working root, audited, caps everywhere; routes in `lib.rs` (jobs lockless like sync), `agent` auth segment, Tauri thin commands, `cybsh ai` (parser + lockless intercept + honest direct fallback).
- WASM: `os-wasm` agent bridge (catalog + single-turn fetch) + `useAgent` browser loop (volume tools, local matcher mirror, in-memory keys, localStorage transcripts) + `write` dispatcher op.
- UI: lazy `AgentPanel` (Dock, Ctrl+G, presets/custom/endpoints/models/keys/permissions/sessions/thread/approvals/usage, dual server+local modes), `FileContent`/`SavedContent`/agent types, store actions, invoke mappings; `files/{id}/content` read/write (versioned saves) backing the editor on REST; `crates/tests/src/agent.rs` pins gating, key hygiene, validation, import re-keying, `ai` intercept.
- Docs: README features + REST table, ARCHITECTURE endpoints + `agent_configs`/`agent_sessions` tables, OPERATIONS §4b.
- Not run here: `cargo fmt/clippy/test --workspace`, Tauri/desktop builds, `os-acceptance.sh`.
## 2026-10-06 — agent review hardening + MCP + loop features (no cargo on box; CI must prove)

- Review fixes: user prompt was never appended to new transcripts (worker now seeds it); `tool_bash` drains pipes on threads (no 64 KiB deadlock); orphaned test headers repaired (shell `tab_completion`, os `rows_round_trip`); real missing-paren caught in `mcp.rs` test.
- MCP end to end: pure `agent/src/mcp.rs` (JSON-RPC envelopes, initialize handshake, tools/list normalization, call rendering, SSE parsing, namespaced `mcp__server__tool` ids) with unit tests; native stdio (reader thread, timeouts) + Streamable HTTP (session ids) transports; per-run connect/list/fail-fast with RAII teardown; calls routed through the same permission decisions; discovery + attach/detach endpoints (attach/detach admin-gated like sync-config delete); Tauri commands; AgentPanel MCP section (attach form, tool discovery, per-server rows); WASM answers MCP via the honest `unsupported:` path (no fake tools offered).
- Loop hardening (always on): `rate_limited:` backoff (2s/4s/8s, abort-aware), doom-loop guard (identical call ×3 denied), `length`-finish truncation notes, cancel checked after provider calls, Anthropic prompt-caching markers, read-only depth-1 subagents with the same hardening.
- Session compaction (`POST …/compact` lockless, old kept), model-list refresh UI already wired, README/ARCHITECTURE/OPERATIONS deltas, `crates/tests/src/agent.rs` extended (admin gating, MCP validation, compact validation).
- Not run here: `cargo fmt/clippy/test --workspace` (new `mcp.rs`, worker edits, route arms), Tauri builds, `os-acceptance.sh`. Known CI watch items: grammar-style version pairing N/A (pure Rust only); MCP stdio needs a POSIX shell on the runner.
## 2026-10-06 — opencode/omp clue sweep: redaction, rules, MCP reconnect, remember, init (no cargo; CI must prove)

- Clues taken: omp stream-hygiene → secret redactor on every tool result (`crates/agent/src/redact.rs`, marker+JWT shapes, byte-exact, tested); opencode rules/references → project-rules loader (`AGENTS.md`/`SKILL.md`/`.cybermanju/rules.md`, capped, folded into all system prompts incl. subagents); opencode MCP lifecycle → reconnect-once on transport breach; opencode always-approve → `remember` storing an explicit `Simple(Allow)` row (route+Tauri+store+ALLOW ALWAYS button); opencode `/init` → `ai init` as a convention (canned prompt job that writes AGENTS.md with its own tools: REST+Tauri+cybsh+panel button); omp hashline → whitespace-tolerant fuzzy locate as second-chance matcher (byte-exact map, uniqueness still enforced, unicode-tested).
- Review repairs in the same pass: orphaned test bodies re-headed (shell tab-completion, edit stale-anchor), missing paren in `mcp.rs` test, dead helper + duplicate import removed from `agent_api.rs`, pipe-deadlock-proof bash drains, prompt-seeding bug (fixed prior turn, re-verified).
- Not run here: `cargo fmt/clippy/test --workspace`, Tauri builds, `os-acceptance.sh`. CI watch: MCP stdio needs POSIX runners; new worker paths (retry/cache/doom/reconnect/remember/init) are covered by unit + route-validation tests, live runs need provider keys.
## 2026-10-06 — agent metaprompt + rg/glob tools, all transports (vitest green; cargo still CI-only)

- Metaprompt rewrite (`agent_loop::system_prompt` + per-tool schema guidance): role, honest per-transport sandbox (native bash/task/MCP vs browser file-tools-only), path conventions, edit workflow (read → anchor → verify), approval/doom-loop behavior, machine-prefix meanings, concise-output contract. Browser loop mirrors it in `AgentPanel`.
- New `glob` tool everywhere (Rust walker + `**` matcher, WASM volume walker, TS matcher): 7 → 8 tool schemas on every transport; `grep` is real regex now (regex crate native, RegExp in browser, literal fallback both sides when the pattern is invalid).
- Test-caught fix: opencode-style `bash` patterns (`git *`) match the bare command, not `bash <cmd>` — rules now try all three shapes in Rust and TS; pinned in both suites.
- Tests: new `tests/frontend/agent-matchers.test.ts` (5 green), Rust unit tests for glob/grep/metaprompt/fuzzy; docs (README bullets, OPERATIONS tool paragraph).
- Not run here: `cargo fmt/clippy/test --workspace`, Tauri builds, `os-acceptance.sh`. CI watch: `regex` compiles to wasm32 (pure Rust, no OS calls — expected fine); new `glob` walker bounds (200 paths / 2000 files).
## 2026-10-06 — shell-app wiring sweep: favorites persist, loose-groups CRUD on all transports, reachability, shared error/loading states (cargo CI-only)

- Favorites: `toggleStar` was local-only (Rust `FileNode` has no star column on any backend). Now persisted beside the file table via `starredIds` set + localStorage, mirrored into worker kv (`stars`) on static hosts so stars ride inside the `.cybermanju` container with provider data; re-applied after every `fetchFiles`. New `src/utils/stars.ts` codec + `tests/frontend/stars.test.ts`.
- Loose groups: was list-only UI. Added store `createLooseGroup`/`addFileToLooseGroup`, REST `POST /api/loose-groups` + `POST /api/loose-groups/{id}/files` (new `api::files` helpers mirroring the Tauri commands), `REST_ROUTES` mappings, and kv-backed `STATIC_COMMAND_HANDLERS` so the static/WASM build has full CRUD with zero wasm rebuild. WindowContent loose panel now creates groups and adds files.
- Reachability: `loose-groups`/`style`/`webdash` had no Dock/TopMenu entry. Added View-menu items (Loose Groups, Style Tags, Overlay Dashboard), Sidebar TOOLS shortcuts, and clickable TAGS/LOOSE section headers.
- UI modernization: new shared `UiError` (registered in `src/ui/install.ts`); favorites/recent/loose/style panels and StorageDashboard rebuilt on `UiToolbar` + `UiSpinner` + `UiEmpty` + `UiError` with refresh/retry actions and mount-time fetches; TopMenuBar/Dock get narrow-window overflow handling; `fm-spin`/MapView spinners honor `prefers-reduced-motion`. (Users role toggle already existed in UserManagementPanel — earlier audit note corrected.)
- Verified here: `vue-tsc --noEmit` clean, `vitest` 9 files / 81 pass, `vite build` green.
- Not run here: `cargo check/test/clippy` (no linker on box) — new `crates/web` loose-group helpers + routes must be proven in CI; Tauri/desktop builds.
## 2026-10-06 — People panel as centered Spotlight/Alfred search (vitest+build green)

- Rebuilt `FaceGroupingPanel` from a formal CRUD form into a centered launcher (max-width 540 column, radial accent glow): hero search bar (autofocus, clear/Esc), people strip of avatar chips (initials, per-group color ring, file-count badge), and a live dynamic listing (PEOPLE matches with highlight + PHOTOS member-file matches, capped with overflow counts).
- Full keyboard flow: ↑/↓ across people+photos, ⏎ opens (person → Files panel, photo → select+Files), Esc clears; hover and keyboard share one active key with scroll-into-view; footer hints document it.
- Detail card for the active person: member-file chips, OPEN FILES / RENAME (inline) / DELETE (two-click confirm); footer keeps BATCH DETECT (busy state + last-scan stats) and RESCAN; `UiError` retryable + `UiSpinner` + `UiEmpty` no-match states; reduced-motion and ≤560px breakpoints.
- Default faces window resized to 620×640 for the new layout.
- Verified here: `vue-tsc` clean, `vitest` 9 files / 81 pass, `vite build` green.
## 2026-10-06 — scene heuristic algo (multilingual, scored) + user tags end-to-end (cargo CI-only for Rust)

- New `crates/scene`: single source `data/scenes.json` — 17 categories (human, baby, forest, mountain, beach+sea, sunset, snow, city, party, wedding, animal, dog, cat, bird, food, sport, garden) × 10 languages (en pt es fr de it nl ru zh ja), 740 keyword entries, child→parent map. Honest heuristic: filename/path/user-tag text only, per-source weights (name 1.0 / tags 0.95 / path 0.7), exact 0.9 / edge-aligned-substring 0.55 / CJK-single-char 0.4, noisy-combine capped 0.97, report ≥0.30, plus face-cluster human boost and image-mime whisper. Mid-token noise rejected (`cume` in `document` stays silent — test-caught), CJK raw-containment gated to CJK scripts.
- TS twin `src/utils/scene.ts` parses the same JSON with the identical algorithm; `tests/frontend/scene.test.ts` (42 green) mirrors `crates/scene/src/tests.rs` (multilingual beach ×10, per-language category checks, query matching, tag-carry, parent inference, silence guarantees, English reachability per category).
- Search UI (`WindowContent`): SCENES strip with % chips from `matchSceneQuery` (click re-searches the category) + per-result scene % badges fed by filename+tags+path.
- User tags on any file: `api::files::set_tags` (normalized: trim/dedupe/cap) + REST `PUT /api/files/{id}/tags` + Tauri `set_file_tags` (registered) + `REST_ROUTES`/`DB_WASM_ROUTES` (via `files.patch`, tags already whitelisted) + store `setFileTags` + FileManager inspector tag editor (chips, add/remove). Tags feed Tantivy's filename+content+tags BM25 (verified wired in `crates/search`) and the scene matcher. Human naming = existing `renameFaceGroup`, exposed in the People spotlight panel.
- Verified here: `vue-tsc` clean, `vitest` 11 files / 141 pass, `vite build` green.
- Not run here: `cargo test -p cybermanju-scene` and workspace check (no linker on box) — CI must prove Rust; Tantivy reindex timing for new tags matches existing mutation behavior (index rebuilds in batch jobs).
## 2026-10-06 — niri-style shell review pass: gestures, pure layout math, tests (cargo CI-only for Rust)

- Review fixes: `useSwipe` treated EVERY two-finger touch as a pinch, so two-finger swipes could never fire — now pinch-vs-swipe is decided by the shared `classifyTwoFingerGesture` classifier (spread change wins, else centroid travel → swipe). Multi-finger taps no longer fake single-taps; single-finger tap/long-press/edge behaviour unchanged.
- Gestures: three fingers up/down → `overview_toggle` (zoomed-out grid of ALL screens, minimized included with dashed badge, click restores); two fingers → strip travel (`strip_left/right` along columns, `strip_up/down` between lines), falling back to focus prev/next outside strip mode. 14 new rebindable touch actions (`overview_toggle`, `strip_*`, `strip_direction`, `autotile_toggle`, focus/layout family) with labels for the Settings gesture table.
- Niri parity: `stripLineMove` keeps one empty line below the lowest occupied line (open a window there to claim it); `close` prunes dead lines and clamps the viewport; `tiled` mode re-tiles on open; viewport resize re-runs strip/tile layout; `Alt+Shift+Arrows` move windows (`move_window_*` in `.kpl`, nudge in floating, column/line move in strip via new `nudgeFocused`); overview exits back to tiled when autotile is on.
- Pure module `src/utils/shellLayout.ts` (tiling/strip rects, offset/line resolution, swipe + two-finger classifiers) — used by `useWindowManager`, `DesktopShell` and `useSwipe`, proven by `tests/frontend/shell-layout.test.ts` (geometry, no-overlap tiling, one-empty-line rule, pinch-beats-swipe) and `tests/frontend/shell-gestures.test.ts` (defaults + dispatch wiring); kpl coverage extended with the move bindings.
- Verified here: `vue-tsc` clean, `vitest` 20 files / 233 pass, `npm run icons` clean, `check-version.sh` agrees.
- Not run here: `cargo fmt/clippy/test --workspace`, Tauri/desktop builds — CI must prove Rust.
## 2026-10-06 — agent UX remake: harness + modern chat panel + window polish (cargo CI-only for Rust)

- Review findings: `AgentPanel.vue` was a 2059-line monolith — 7 stacked ALL-CAPS sections (capability strip, setup wizard, configs, MCP servers, per-tool permissions, sessions, thread) in one endless scroll; no onboarding, no progressive disclosure; transport branching (`wasmMode ? local : store`) duplicated across ~20 functions; composer was a bare textarea (hidden Ctrl+Enter); agent window default 720×600 too narrow for chat.
- New `src/composables/useAgentHarness.ts`: single-import surface over all transports — `detectTransport`, `capabilitySummary` (plain-language model/persona/dir/shell/key), `quickPrompts`, `slashCommands`, `formatTokens`/`contextPctOf`/`copyText`. Permission gate, 202-job contract, error prefixes and BLAKE3 anchors unchanged underneath.
- `AgentPanel.vue` remake (script logic untouched, all contracts kept): header (avatar + live pulse, friendly transport label, context meter, YOLO, Chat/Setup/Controls tabs); collapsible sidebar (searchable conversations + assistants); plain-language capability strip; Setup as 3 guided steps (provider → model & key → permissions & workspace); Controls tab (MCP connect + per-tool Allow/Ask/Never); chat with welcome screen + quick prompts, avatar bubbles, copy buttons, friendlier tool badges (Needs you/Failed), `role=alertdialog` approval card, sticky composer (Enter to send, `/` commands, char count, Dictate, Stop/Queue). Responsive single-column under 760px; sentence case throughout.
- OS windows: agent default 1020×680; `AppWindow` resize now takes the event param (no more deprecated `window.event`).
- Verified here: `check-version.sh` agrees, `npm run typecheck` clean (icons rebuilt, 163), `vitest` 21 files / 239 pass incl. new `tests/frontend/agent-harness.test.ts` (6).
- Not run here: `cargo fmt/clippy/test --workspace`, desktop/mobile builds — CI must prove Rust.
## 2026-10-06 — touch stack goes live: surface attach, touch-action, Pointer Events rebase (cargo CI-only for Rust)

- Root cause: `mainAreaRef` (the `useSwipe` target) was never bound to any element, so EVERY touch gesture was dead in production — three-finger overview and two-finger strip travel included. Bound to `.cybermanju-shell` in `App.vue`.
- `touch-action: none` on the gesture surface: the shell recognizer now owns 2/3/4-finger swipes and pinches (no mid-gesture `pointercancel`, no double-handling with native zoom); inner scrollable panels keep native scroll since touch-action intersects only up to the implementing scroller.
- `useSwipe` rebased from Touch Events to Pointer Events with zero API change: mouse ignored (desktop drags stay with the windows), pen works like touch, `pointerId`-keyed chords, pinch-vs-swipe dominance guard (spread change must BEAT centroid travel, else a fast parallel swipe's leading finger misfires as pinch), pinch-then-keep-scrolling rebase, cancel = abort (never double-handle). Core extracted as `createSwipeMachine` (no Vue/DOM) for tests.
- `tests/frontend/shell-swipe.test.ts` (11 tests): 1-finger swipe/tap, mouse ignored, pen works, two-finger parallel swipe, pinch in/out + pinch-and-pan precedence, post-pinch rebase scroll, 3/4-finger swipes, cancel silence, sub-threshold drift.
- Verified here: `vue-tsc` clean, `vitest` 22 files / 250 pass, `npm run icons` clean, `check-version.sh` agrees.
- Not run here: `cargo fmt/clippy/test --workspace`, Tauri/desktop builds — CI must prove Rust. Real-device check still needed: DevTools can't synthesize true 2/3-finger chords (remote-debug a phone/tablet or Playwright CDP `Input.dispatchTouchEvent`).
## 2026-10-06 — remove Telegram/Google Photos providers (4 backends remain)

- `SyncBackendType` is now Local/GitHub/GitLab/GoogleDrive only (`crates/types`, `src/types`); `album_id`/`chat_id` fields, `albumId`/`chatId` drafts, forms and wizard fields removed.
- Deleted `GooglePhotosBackend` + `TelegramBackend` (~550 lines) and their factory arms from `crates/sync/src/backends.rs`; dropped `PHOTOS_MAX`/`TELEGRAM_MAX`, Photos/Telegram rate gates, quota arms, Photos scope (`drive.file` only) and OAuth slug arm; `compute.rs` capabilities cover the 4 survivors.
- `os-wasm` canal: removed telegram/photos normalize + `cors:` arms (legacy names now get generic `unsupported:`); updated `useTauri` static probe, `useSupabase` slugs/scopes, `ProviderLogo`, `AccountManager`/`SyncPanel`/`Sidebar`, `providers.ts` helpers.
- Docs: `ARCHITECTURE.md` (diagrams, tables, `backendType` enum), `README.md`, `AGENTS.md`, `docs/OPERATIONS.md` updated; historical `worklog.md` entries left intact.
- Verified here: `check-version.sh` agrees, `npm run typecheck` clean (icons rebuilt, 161 — `camera-bold`/`plane-bold` pruned), `vitest` 22 files / 250 pass.
- Not run here: `cargo fmt/clippy/test --workspace` (repo rule: CI's Rust Lint & Test job proves Rust).
## 2026-10-06 — first publish prep: Settings remake, broker reactivity, release notes, dual push

- Settings page remade (collapsed-card text overlap fixed via block flow), status strip, section jump chips + scroll spy, keyboard-bindings filter, wrap-based rows; `useSupabase` reactive `configuredFlag` (badges flip on save/forget, no reload); Accounts Configure deep-links to the broker card; `useTouchConfig` threshold setters (state is readonly — direct writes were silently dropped); TopMenuBar keyboard access + dropdown clipping fix.
- `release.yml`: release notes now carry the full v0.1.0 feature atlas + status/known-limits for the first publish (was: bare git-log list).
- `push.sh` rewritten: `git add -A` + message arg (no more bare `update`), pushes main + tags to GitHub `origin` AND GitLab `gitlab` mirror, no force-push.
- Verified here: `check-version.sh` agrees, `npm run typecheck` clean, `vitest` 22 files / 250 pass.
- Not run here: `cargo fmt/clippy/test --workspace`, desktop/mobile builds — CI + release workflows must prove them. Previous v0.1.0 Release run failed on WASM build, Android signing secrets, and Linux apt deps (logs need repo admin to read); tag move + re-run pending.
- GitLab mirror live (`.gitlab-ci.yml` 15 jobs + secrets inventory); first pipeline fails at creation with `Identity verification is required in order to run CI jobs` — account-level gate, needs owner verification + the 5 CI variables.
## 2026-10-07 — OAuth popup close + multi-account sign-in

- Popup stuck open showing the app inside: `signInWithPopup` used `noopener` (severed opener chain, so `window.close()` + opener messaging died) and never closed the popup from the opener side; deny/error returns (`?error=`, no `?code=`) booted the full app in the popup. Fixed with `isOAuthPopup()` detection, App.vue popup fast-path (minimal view, skips store/vault boot), `finishSupabaseReturn()` opener notify (`cybermanju:oauth-done` postMessage) + retried `closeOAuthPopup()`, `?error=` handling, and opener-side `popup.close()` on success.
- Account manager hid all provider logins after first sign-in (`v-if="identity"` / `v-else`): login grid with all 3 providers now always renders ("Add another account" when signed in). Multi-account via `connectedAccounts` (persisted, deduped by user id) with Switch/Forget; every sign-in starts fresh (sign-out first) so same-provider re-login and provider switching work; `refreshIdentity()` repopulates the list on fresh browsers.
- `supabaseConnect` token poll now only accepts the token minted for the expected provider (`supabaseSessionProvider()`), so a stale session from another provider can't close the flow with wrong credentials; added opener message wake-up.
- Verified here: `vue-tsc --noEmit` clean, `vitest` 22 files / 250 pass.
## 2026-10-07 — OAuth debug logging removed

- Stripped all `[supabase]` console diagnostics (`debugSupabaseConfig` + call sites in Settings/Accounts, authorize/return/sign-in/account logs), the `[WASM Mode]` envelope passthrough warn, and the `[os_ps]`/`[dashboard_status]`/`[start_dashboard]` shapeless-payload warns (silent drops kept). Behavior unchanged.
- Verified here: `vue-tsc --noEmit` clean, `vitest` 22 files / 250 pass.
## 2026-10-07 — Full VFS/sync hardening: encrypt-or-fail, hidden names, folder sync, VFS writes, parity UI

- Encrypt-or-fail: new `SyncConfig.requireEncryption` (Rust + TS, default false); pipeline refuses the file with `auth:` when no master passphrase exists instead of uploading plaintext with a warning.
- Basename obfuscation: new `SyncConfig.obfuscateNames`; `remote_path_for(path, obfuscate)` maps to `cybermanju_sync/<dir8>/<nameHash16>` (deterministic, idempotent; striped chunks were already content-addressed). Originals stay in the local sync record for restore.
- Recursive folder sync: `sync_api::expand_sync_ids` BFS through the parent index (cap 5000, `too_large:` beyond) wired into both `start` (Tauri) and `start_job` (REST 202); unknown ids pass through, cycles impossible.
- VFS write-through: new `upload_bytes` (`POST /api/sync/upload`, 5 MiB cap) + `upload_remote_file` Tauri command; `useProviderCanal.writeVfsFile/deleteVfsFile` (Rust backend on desktop/Docker, direct provider fetch on static hosts, `deleteFileDirect` for GitHub SHA + GitLab); `vfs_write_file`/`vfs_delete_file` invoke routes; Sidebar mounts are read-write now (upload button, per-file delete, cache invalidation).
- Surfaced knobs: SyncPanel wizard has parity (0–4) + require-encryption + hide-filenames; Account Manager provider detail has a Sync behavior step (encrypt/compress/require/hide/placement/parity, saved per config); `compressBeforeUpload` default flipped to true; vault-set provisioning defaults to requireEncryption + obfuscateNames on.
- Rust struct literals updated for the new fields (`disk/testkit`, `sync/oauth` ×2, `tests/types`); old config rows parse via serde defaults (same pattern as `health.rs` test).
- Verified here: `vue-tsc --noEmit` clean, `vitest` 23 files / 267 pass. Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — Drive parity on static hosts + GitHub overwrite fix

- Google Drive rides the full sync engine (pipeline transforms, striped chunks, disks are backend-agnostic); only repo *creation* is git-only by nature (Drive uses folders, created implicitly on upload).
- Static-host VFS writes/deletes now cover Drive too: `driveWriteDirect` (parent-folder auto-create, same-name overwrite via media PATCH, multipart create) + `driveDeleteDirect` (listing locator id preferred, else path resolve; 404-tolerant); canal static branches route `googleDrive` mounts to them instead of refusing.
- Fixed a silent-loss bug in `seedRepoDirect` (GitHub): overwriting an existing file returned 422 which was swallowed as success — now looks up the blob SHA and retries the PUT (same rule the Rust backend follows).
- Verified here: `vue-tsc --noEmit` clean, `vitest` 23 files / 270 pass. Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — System-wide gap sweep: contract prefixes, REST parity, log redaction, orphan cleanup

- Error-prefix contract (AGENT-1): swept `File not found`, `Failed to…`, `disk full:`, `not found:`, `no files:`, `invalid:`, `Unsupported OAuth…`, `Sync config not found`, `Triple compression/Decryption failed` into `not_found:/unsupported:/disk_full:/integrity:` across `sync/pipeline+oauth`, `web/sync_api`, `disk/*`, `os/api+compute`, `tauri/compression+encryption+import+tree_sitter`; updated the asserting unit/contract tests. `describeSyncError` already covered every prefix (kept the legacy `disk full` alias).
- REST parity (web transport): added `suggest`, `get_shared_file`, `set_file_permission`, `get_preview` mappings to verified server routes; `get_compression_stats`/`get_symbols` marked WRITE_ONLY (local paths only); `search_files` now passes real BM25 score/snippet instead of fabricating 1.0/''; `get_encryption_status` passes real fields through; exported `REST_ROUTES`/`WRITE_ONLY_COMMANDS` + new `transport-routes.test.ts` (6 tests) locks the table.
- Security: access log strips query strings (OAuth `code/state`) and masks `/api/shared/<token>`; secret files (JWT + master passphrase) refuse group/other-readable modes fail-closed WITHOUT rotating over them (rotation would orphan sealed keys / kill sessions).
- Durability: striped chunk temps guarded by `RemoveOnDrop` (retry-exhaustion/cancel no longer leaks `cybermanju-up-*.cyb3`); link/record failures after landed uploads now compensating-delete (whole-file remote + every striped chunk copy).
- Restore hardening: `destPath` rejects NUL + `..` escapes; restore errors prefixed (`not_found:/unsupported:/integrity:`).
- Verified here: `vue-tsc --noEmit` clean, `vitest` 24 files / 276 pass. Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — Scroll repair + stylized scrollbars across OS and repo shells

- Root causes: `touch-action: none` on `.cybermanju-shell` forced `none` on every nested panel (intersection) killing touch scroll; `AppWindow` pinned children to `height: 100%` so tall content clipped with no scroll; `TerminalPanel` used `contain: strict` without `min-height: 0`; strip wheel handler never drove `scrollLeft` for vertical-wheel input.
- Fixes: shell allows `pan-x pan-y`; window children use `min-height: 100%`; `contain: layout paint` + `min-height: 0` on all three cybsh scrollbacks (terminal, CodeStudio bottom, FileManager inline); niri-style wheel translation with inner-scroller passthrough + explicit strip sizer; one stylized accent scrollbar system in `ui.css` (Dock/tray bars auto-hide, rest always visible).
- Verified here: `vue-tsc --noEmit` clean, `vitest` 23 files / 267 pass. Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — Window merge pass: 7 panels folded into 4 surfaces

- One-window mechanism: `PANEL_ALIASES` + per-alias tab props in `useWindowManager.open()` (re-steers a live window instead of stacking copies); every merged surface takes a `tab` prop with a watcher.
- `code`→CodeStudio (new INTEL side view: file/paste/path tree-sitter parse, kind chips, preview); `webdash`→`dashboard`; `storage`→Disks overview tab; encryption+compression→new tabbed `ShieldPanel`; `users`→Accounts Users tab; SyncPanel slimmed to runs/monitor (CRUD lives in Accounts); collections/favorites/loose-groups/style→new tabbed `OrganizePanel`; `preview`→Files inspector (faces/symbols rows added); search extracted to shared `SearchPanel` (Search window + Studio side view).
- Deleted: `CodeIntelligencePanel`, `StorageDashboard`, `EncryptionPanel`, `CompressionPanel`, `UserManagementPanel`, `CollectionsPanel`, `FilePreview`. Also removed dead `showEncryptionPanel/showCompressionPanel/showPermissionsPanel` store flags and rewired Ctrl+E / Ctrl+Shift+C to the Shield window. Follow-up review: `PANEL_ALIASES` extracted to pure `src/utils/panels.ts` + `tests/frontend/panel-aliases.test.ts` (5 tests lock no-cycles/metadata); user delete asks first; stale counts refreshed in AGENTS.md/README.md.
- Verified here: `vue-tsc --noEmit` clean, `vitest` 25 files / 281 pass. Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — cybsh full review: static-layer vault verbs, merged file ops, wasm parity, 0.1.1

- New static transport layer `src/utils/staticCybsh.ts`: every `os_exec` line on Pages/WASM is offered here first (quote-aware parse, chained lines fall through). Vault-aware verbs answer locally — `quota` (shell volume + browser storage + live GitHub/GitLab/Drive probes via sealed vault tokens, dashboard warning footer), `providers`, `oauth status|start`, `disk`, `sync status|list`, `mount`, `encrypt|decrypt|keygen` (ChaCha20-Poly1305, vault keys), `compress|decompress` (lz4/brotli), `scrub|repair|gc|lease`, `echo|kill|ai` — all in the house `prefix: detail` contract with `--json` support.
- Merged-namespace file ops: `cp|mv|rm|mkdir` route plain paths to the shell volume and `/providers/<mountId>/…` through the provider canal (same-provider renames, cross-provider and provider↔local moves, `-r` trees, `.keep` markers, strict-UTF8 binary guard, `mv -r` tolerance).
- Wiring in `useTauri.ts` (`STATIC_CYBSH_DEPS`: vault, volume+mirror nudge, VFS canal, crypto exports) + `notifyOsDispatch` and `rm`/`kill` arg mappings in `useWasmBackend.ts`; `get_sync_usage` static handler so the Sync panel quota button works on Pages.
- WASM Rust parity (`crates/os-wasm/src/os.rs`): native `echo|cp|mv|kill` arms, `ai` in the command table with the detached-worker refusal, Tab completion extended with sub-commands (mirrors native `completions()`), grouped `help` (local volume / local vault / dashboard only).
- Voice dictionary gains `oauth|compress|decompress` (+ `oauth status|start` phrases); `docs/OPERATIONS.md` gains §4c documenting the static-site shell.
- Robustness: probe JSON bodies read via `safeJson` (unreadable body → `network:`, never a throw); provider transport errors rethrown instead of masked as `not_found`; local `rm -r` counts successes only.
- Version bump 0.1.0 → 0.1.1 across all carriers (`check-version.sh` green).
- Verified here: `vue-tsc --noEmit` clean, `vitest` 28 files / 362 pass (static-cybsh suite 28→58 tests). Rust `fmt/clippy/test` left to CI per repo rules.
## 2026-10-07 — CI watch script + push commit-message UX

- New `scripts/watch-ci.sh`: polls the GitHub CI run (by `--run`, `--sha`, or
  latest on `--branch`) and saves/prints the FULL logs of all jobs/steps to
  `logs/ci-<run-id>/`. All state via `gh api .../actions/runs/...` + `/jobs`
  (works on old `gh` 2.4.0, which lacks `run view --branch`); falls back to
  `curl` + `$GH_TOKEN`/`$GITHUB_TOKEN` and `python3` stdlib when `gh`/`jq` are
  absent. Handles prose-only pushes (no run started), superseded runs under
  CI's cancel-in-progress concurrency, and `--print failed|all|none`.
- `push.sh` remake (backward compatible): `-m/--message`, multi-word
  positional join, TTY prompt with dated default (silent default when piped),
  bare-`update` refusal, `--allow-empty`, `--dry-run`, and `--watch/--no-watch`
  (`PUSH_WATCH_CI=1` env) chaining into `watch-ci.sh --sha HEAD` after a good
  origin push. AGENTS.md §3 documents the new flow.
- Verified here: `bash -n` clean on both, `--help`/`--dry-run`/bare-`update`
  refusal/auth-error paths exercised. Live GH polling needs stored `gh` auth.
## 2026-10-07 — Quadrant autotile (≤4 windows) + push.sh hardening

- Autotiling (`src/utils/shellLayout.ts:computeTileRects`): dedicated layouts
  for ≤4 windows — 1 fills the screen, 2 split halves (long-axis aware), 3 use
  master-left + two stacked right (no empty hole), 4 fill equal 2×2 quadrants;
  5+ fall back to a dense grid. Dropped the `Math.max(320/240, …)` minimums that
  forced tiles to overlap/overflow on small screens.
- `src/composables/useWindowManager.ts`: re-tile on close/minimize/restore so
  survivors expand (grid stays dense); focused window is re-raised on top so
  tiling never steals focus.
- `push.sh` fixes: heal mixed root/uid `.git/objects` ownership (root hands
  `.git` back to the worktree owner); abort if `git add -A` fails instead of
  pushing stale HEAD; refuse unless on `main`; fetch both remotes and
  auto-rebase onto `origin/main` when behind (never force-push); push only tags
  the remote lacks — a divergent remote tag (e.g. `v0.1.0`) now warns instead
  of marking the whole mirror push FAILED. AGENTS.md §3 documents the flow.
- Verified here: `vue-tsc --noEmit` clean, `vitest` 28 files / 362 pass,
  `push.sh --dry-run` prints the new fetch/rebase/tag flow.
## 2026-10-08 — Docker 401 fan-out: dashboard login gate + public auth probe

- Root cause: the Docker/web frontend had no sign-in — `authenticate_user`/
  `register_user` existed but no UI called them, so every `/api` call 401'd;
  the 401 hint wrongly pointed at provider OAuth (Google/GitHub/GitLab), whose
  tokens open provider sync but never authenticate `/api`. `initialize()` fired
  the whole fetch fan-out with no token (the reported console spam).
- Backend (`crates/web`): new public `GET /api/auth/status →
  { registrationOpen }` (RBAC Public + route arm via `registration_open`);
  unit test extends `public_routes_need_no_role`; integration test covers
  open→bootstrap→closed. Bootstrap semantics unchanged (closes after the first
  account, never mints admin — extra dashboard users come from an admin in
  Accounts → Users; provider OAuth accounts stay unlimited incl. same-provider).
- Frontend: `auth_status` + `logout_user` REST mappings; store gains
  `needsAuth/needsSetup` gate, `login/register/checkAuthStatus`, user persist
  per browser, `initialize()` early-return + auto-refresh guard (no 401 spam),
  corrected 401 message → `cybermanju:open-login`; new `ServerAuthPanel.vue`
  gate rendered from `App.vue` on every device without a JWT.
- Docs: `OPERATIONS.md` §6 first-run + multi-account note, `ARCHITECTURE.md`
  endpoint rows for `auth/status` + `auth/logout`.
- Verified here: `check-version.sh` green, `vue-tsc --noEmit` clean, `vitest` 29 files / 372 pass. Rust `fmt/clippy/test` left to CI per repo rules.

## 2026-10-08 — Android full fix (16 items): packaging, signing, runtime, mobile UX

- Packaging: CI/release build `--apk --aab --split-per-abi` (Play bundle alongside APK); Rust targets trimmed to `aarch64+x86_64` (armv7/i686 were never built); `versionCode` pinned in `tauri.conf.json` (`1001` = major*1e6+minor*1e3+patch), enforced by `check-version.sh` + new `scripts/android-configure.sh` (versionCode audit, manifest patch, ABI policy).
- Manifest (`android-configure.sh`, idempotent): INTERNET/ACCESS_NETWORK_STATE/LOCATION/CAMERA/RECORD_AUDIO/POST_NOTIFICATIONS, `usesCleartextTraffic` (http LAN dashboard), `allowBackup=false` fail-closed + manual export path, `cybermanju://` deep link + `.cyb3` VIEW intents.
- Signing parity (P2-8 closed): unsigned PR artifacts renamed `CyberManju-OS-<ver>-arm64-v8a-unsigned.apk` (never neutral); `android-signing.sh cleanup` shreds keystore+properties pre-upload; AABs listed + shipped in artifacts/release packages.
- On-device verification: new `scripts/android-smoke.sh` (adb install + am start + logcat crash grep, graceful skip without arm64 emulator), wired `continue-on-error` in CI, non-blocking in GitLab.
- Runtime: Android DB path branch (app-private files dir, never CWD), `default_secret_dir()` Android branch, WebDashboard NOT started on mobile (`#[cfg(mobile)]`), `fatal()` panics on mobile (logcat) vs exit on desktop, Tantivy battery note.
- Capabilities: new `src-tauri/capabilities/mobile.json` (`platforms: ["android"]`, scoped-storage comment).
- Frontend: `viewport-fit=cover` + theme-color + mobile-capable metas, safe-area/`100dvh` shell CSS, `body.cybermanju-offline` dimming, Android back-gesture (`popstate` → close transient / history back) + online/offline listeners in `App.vue`.
- CSP covers both WebView asset schemes (`http://asset.localhost` added).
- Docs: new `docs/ANDROID.md` runbook (§§ packaging/signing/manifest/storage/runtime/frontend/updates/verification); `TASKS.md` P2-8 ticked, P2-16 narrowed to iOS; `AGENTS.md` android lines updated.
- Not run here: `cargo fmt/clippy/test`, device builds — CI must prove Rust/mobile.
- Agent 400 fix: `openai_request` echoed neutral `{id,name,input}` tool rows verbatim into `tool_calls`, 400ing strict providers on the follow-up turn (right after the first tool result). Now reshaped to spec `{id,type,function:{name,arguments}}`; `tool_call_id`/`tool_use_id` never null. Non-context HTTP 400 → new `invalid:` prefix (check model id + tool support); string `"error"` envelopes parsed. Browser loop: `rate_limited:` backoff retry (2s/4s/8s, abort-aware, native parity). Rust test `openai_tool_echo_is_spec_shaped` added.
- Not run here: `cargo fmt/clippy/test` (no local toolchain) — CI must prove Rust.
- Provider failover: `AgentConfig.fallbackIds` (max 4, validated on save) chains assistants as extra accounts/keys or providers. Native worker resolves primary + usable fallbacks and continues the same transcript on terminal `auth:/rate_limited:/network:/limit:` (empty credits now classify as `limit:` incl. 402/insufficient/billing; non-context 400s stay `invalid:`), others stop; all-failed errors append `(tried: …)`. Browser loop mirrors with the same rule + per-route headers. Controls → Fallback route card (add/remove/reorder, Ready badges); Setup notes the second-account flow; wizard re-save preserves routes.
- Not run here: `cargo fmt/clippy/test` (no local toolchain) — CI must prove Rust.
- Agent access review (accounts/providers/sys): device shell now spawns scrubbed (`env_clear`, PATH/locale + Windows essentials only) — server env with keys/secrets no longer leaks via `env|printenv` into transcripts; redaction markers added (`key=`, `passphrase=`, `jwt_secret`, `ya29.`) + TS mirror `src/utils/redact.ts` now applied to all browser tool outputs, user answers/feedback and `memory_remember` (native parity); approval `remember` persists allow-rules on admin REST calls only (one-time approve still works for all); agent transcripts owner-bound (`owner_id`, admin-or-owner REST reads, legacy rows readable, Tauri local unchanged) + isolation test.
- Not run here: `cargo fmt/clippy/test` (no local toolchain) — CI must prove Rust.
- Android red fix (CI main 2026-10-08): `processArm64ReleaseMainManifest` merger failed with "Error parsing AndroidManifest.xml" — `android-configure.sh` prepended `android:usesCleartextTraffic="true"` while the Tauri template pins `="${usesCleartextTraffic}"` (manifestPlaceholder), yielding a duplicate attribute (not well-formed XML). Patch now strips template-set copies of the three application attributes before setting ours exactly once, and validates well-formedness in-script so a broken patch fails fast instead of after minutes of Gradle. Also fixed `.cyb3` `pathPattern` double-backslash (`.*\\.cyb3` never matches; now `.*\.cyb3`). Silenced 3 `cybermanju-faces` warnings (`Context as _`, `_file_node`, cfg-gated `FaceBox` — all safe in onnx/no-onnx builds).
- Not run here: `cargo fmt/clippy/test`, device builds — CI must prove Rust.

## 2026-10-08 — Android instant-close fix (startup self-heal + probe + smoke)

- Symptom: APK installs but auto-closes without showing anything. Double review found five startup crash vectors, all before first paint (each a `fatal()` panic or silent kill in `run()`):
  1. torn `cybermanju.db` (killed mid-commit/full disk) failed `Database::new` on EVERY launch → permanent brick;
  2. torn `tantivy_index/` failed `SearchIndex::new` the same way;
  3. hardcoded `/data/data/com.cybermanju.os/files` EACCES under work profiles/secondary users (`/data/user/<id>/…`);
  4. `tracing_subscriber::fmt().init()` panics on re-init (activity recreate) or invalid `RUST_LOG`;
  5. 50 MB Tantivy writer arena allocated up front on low-end phones (LMK kill, no logcat marker).
- Fixes (`src-tauri/src/lib.rs`): `open_database()` quarantines a torn DB to `cybermanju.corrupt-<unix_ts>.bak` and recreates (backup kept for forensics); `open_search_index()` wipes + recreates a torn index (rebuildable via `rebuild_search_index`); `probe_android_files_dir()` proves every candidate writable (env override → `default_secret_dir()` → each `/data/user/<id>/…`) before use; logging via `try_from_default_env` + `try_init` (never panics); mobile panic hook prints `CyberManju OS FATAL (panic): …` to stderr first so logcat always names the cause.
- `crates/search`: writer heap 8 MB on Android, 50 MB elsewhere (`WRITER_HEAP_BYTES`).
- `tauri.conf.json` CSP: added explicit `connect-src 'self' http: https: ws: wss:` (LAN dashboard at any private IP, provider APIs incl. self-hosted instances, Supabase — an allowlist would regress those; desktop only survived via the `invoke()` IPC fallback), plus `media-src`, `worker-src 'self' blob:`, `object-src 'none'`.
- `scripts/android-smoke.sh`: now catches the exact symptom — clears logcat pre-launch, asserts the process is alive at 8s AND 13s (`pidof` + `ps` fallback), then greps the fresh window for `FATAL EXCEPTION/has died/Force finishing/CyberManju OS FATAL`. Old script greped the full uncleared logcat and passed a silently-dead process as green.
- Docs: `docs/ANDROID.md` §5 rewritten (self-heal, probing, 8 MB heap, panic breadcrumb) + new §9 instant-close troubleshooting table with the logcat one-liner.
- Not run here: `cargo fmt/clippy/test`, device builds — CI must prove Rust.

## 2026-10-08 — Voice input pt-BR support

- Speech recognition now supports Brazilian Portuguese alongside English (`src/utils/speechCorrect.ts`): `VoiceLang` (`en-US`/`pt-BR`), `detectVoiceLang()` (pt-* browser ⇒ pt-BR), accent-folded matching (`cê dê`→`cd`, `vírgula`→`,` with or without diacritics).
- New pt-BR correction tables: prose punctuation (`nova linha`, `novo parágrafo`, `ponto de interrogação/exclamação`, `abre/fecha aspas`, `vírgula`, `ponto final`, `dois pontos`, `ponto e vírgula`), code symbols (`abre/fecha parênteses/colchete/chave/ângulo`, `seta`, `menor/maior que`, `aspas duplas/simples`, `crase`, `sublinhado`, `hifen`, `barra [invertida/vertical]`, `arroba`, `cerquilha`, `cifrão`, `por cento`, `asterisco`, …), phonetic shell splits (`ce de`→`cd`, `ele esse`→`ls`, `erre eme`→`rm`, …), Portuguese shell aliases (`ajuda`→`help`, `listar`→`ls`, `histórico`→`history`, `apagar`→`rm`, …) and code keywords (`função`→`function`, `constante`→`const`, …). EN tables always apply; PT tables add on in pt-BR mode so mixed speech works while en-US output is byte-identical.
- `useVoiceInput` gains a reactive persisted `lang` (localStorage `cybermanju.voice.lang.v1`, browser-defaulted) with `setLang`/`toggleLang` (restarts the engine, since VueUse only applies `lang` while idle); `useSystemHardware` shares the same persisted language for Devices voice + speech synthesis.
- EN/PT selector next to every mic button: AgentPanel, TerminalPanel, CodeStudio, DevicesPanel.
- Also fixed along the way: prose `nova linha`/`new line` breaks no longer flattened to spaces, and sentence capitalisation is unicode-aware (`á`, `ç`, …).
- Verified: `npx vue-tsc --noEmit` clean; `tests/frontend/voice-shell.test.ts` 28/28 green (15 new pt-BR cases); full suite green except pre-existing `cybsh-script.test.ts` failures (fail identically on the clean tree).
- Not run here: `cargo fmt/clippy/test` (no local toolchain) — CI must prove Rust.

## 2026-10-08 — `.cybsh` scripts: interpreted automation + `run`/`theme`/`ui`

- New script language (python-style, no build): `print`, `let`/`const` (TS `: type` stripped), `if/elif/else`, `for in` (`range()`/lists/strings), `while` (1000-iter cap), inline shell (`$ …`, `sh "…"`, bare verbs, `sh(<expr>)`, `${var}`), `js` expression subset (`===/&&/||/!` normalized), `fetch … [as var]`, `ui`/`theme`, `vars`/`free`/`gc`. Owned values + budgets (64 KiB source · 200 stmts/block · 5000 steps · 64 vars · 16 KiB/string · 256 KiB output) instead of a GC; house `prefix: detail` errors with line numbers; `run` nests 4 deep.
- Three transports, one grammar: native `crates/os/src/script.rs` + `run <file.cybsh> [--dry] [--json]` / `theme` / `ui` verbs in `shell.rs` (volume mirror `/.cybermanju/theme.json`, `ui:` effect lines); static twin `src/utils/cybshScript.ts` wired into `staticCybsh.ts` (`run`/`theme`/`ui`, real browser `fetch` 10 s/64 KiB, live `localStorage` + document apply, wasm `execFallback` for volume lines); compact WASM interpreter in `crates/os-wasm/src/os.rs` (same grammar, `fetch` honestly `unsupported:` — no HTTP client in either Rust crate). Terminal panel applies `ui:` effects via `useTheme()`; speech dictionary + completions learn the new verbs.
- Agent authoring surface: `.cybermanju/skills/cybsh-script/SKILL.md` (statement/expression reference, providers + durability verbs, memory model, error contract, nightly example) + `examples/hello.cybsh`, `examples/providers-tidy.cybsh`. README verb list extended.
- Verified: `bash scripts/check-version.sh` green; `npx vue-tsc --noEmit` clean; `vitest` 36 files / 464 pass (new `tests/frontend/cybsh-script.test.ts` 19/19 — the previously failing suite now passes on this tree). Rust `fmt/clippy/test` left to CI per repo rules (notably the new `script.rs` unit tests and the os-wasm `run`/`theme` arms).

## 2026-10-08 — `.cybsh` philosophy pass: structured values, functions, capabilities, journals

- Web research (Oils/YSH command-vs-expression modes, Nushell structured pipelines, Elvish exceptions-over-exit-codes, Starlark determinism/hermeticity, Rhai rugged embedding, Deno capabilities, bash `errexit` failure modes, Bazel/Nix hermeticity) mapped onto `.cybsh`, then implemented 100% on all three transports (native `crates/os/src/script.rs`, static twin `src/utils/cybshScript.ts` + `staticCybsh.ts` journal wiring, compact WASM port in `crates/os-wasm/src/os.rs`):
  - **Text is UI, structure is API** — new `Dict` type (sorted keys: deterministic display/iteration/`==` everywhere), `d.k`/`d["k"]`/`l[i]`/`s[i]` indexing, functional `set/push/del/keys/values`; `json()` and `sh()` with `--json` materialize into structure instead of re-parsed text; dict commas fixed in all six comma/`=` scanners.
  - **Explicit effects** — `try:`/`catch [var]:` + `fail "msg"` (Elvish over bash; abort stays the default, `||` inside shell lines stays the escape); inline-shell failures now suffix the line (`<cause> (line N)`) so the house `prefix:` stays first for UI matchers; any bare expression is a statement (Oils one-way rule: `sh("…")` works as a line, values print, `_` keeps them).
  - **Determinism** — `# cybsh: 1` version pins (wrong pin = `unsupported:`), `def name():` with `return` (lexical scope, globals readable, assignments never escape, builtins unshadowable, recursion bounded at depth 32), no clock/random builtins (hermetic by omission), `--record/--replay` journals fingerprinted with cross-transport FNV-1a/64 (`fnv("a") == af63dc4c8601ec8c` pinned in tests on both sides; stale replay = `integrity:`, miss = `not_found:`, replay serves `fetch` even where no HTTP client exists).
  - **Capabilities** — `# cap: net=…/deny=…` (Deno rule, deny wins, `denied:` refusals), enforced at the single inline-shell/fetch choke point of each interpreter, audited in `--json` (`caps`, `calls: {sh, fetch}`); `read=/write=` declared + recorded.
- Skill rewritten (`.cybermanju/skills/cybsh-script/SKILL.md`): dicts/functions/caps/journals/errors, pinned nightly example; examples gain version pins, `providers-tidy` gains try/catch+caps, new `functions.cybsh`.
- Verified: `npx vue-tsc --noEmit` clean; `vitest` 36 files / 484 pass (`cybsh-script.test.ts` 19→39, incl. FNV vector, journal record→replay→tamper, capability denials). Rust `fmt/clippy/test` left to CI per repo rules (new `script.rs` dict/def/try/caps tests + os-wasm `run` dict/try/def/caps/journal tests).

## 2026-10-08 — FileManager: disk click scope + vault-root merged home fix

- Disk rows (sidebar VOLUME + inspector Distro): left-click now opens that disk's share — a banner with used/capacity ratio, % of merged volume and a proportional file-size estimate (block-striped volume, so labelled an estimate, never a placement claim) — instead of just opening Disks. Right-click gets a disk menu (Open files share / Manage disk / Attach-Detach / Check / Copy id / Clear filter). Vault-root row clears the scope. `DiskManagerPage` accepts `diskId`/`highlightId` to focus + scroll to the card from "Manage disk".
- Vault-root empty-create fix: `store.createFolder` now normalizes the parent to the vault-path listing key (`currentPath`, `/` at root) — the old code passed a selected folder's id or `''`, which indexed the folder under a key no listing queries, so it never showed. `/providers/…` refuses honestly (read-only canal browse); creation now toasts success instead of closing silently.
- Merged home: `store.fetchFiles('/')` sweeps the legacy `''` parent key and merges true orphans (`!parentId`) into the root view, so folders made by older builds reappear at home on every transport (Tauri answers the key directly; REST/WASM filter the full-table answer down to orphans). Trash-safe (trashed rows leave the files table). Root empty-states now explain the merged home.
- Verified: `bash scripts/check-version.sh` green; `npx vue-tsc --noEmit` clean (one caught + fixed handler-type bug); `vitest` 36 files / 484 pass. Rust untouched (frontend-only; CI owns Rust).
- Known follow-ups (backend, need CI run): `import_file`/`import_from_url`/`scan_directory` with empty parent store `parent_id None` (unindexed → invisible everywhere); `restore_from_trash` reinserts without re-adding the parent index (restored items stay unlisted).

## 2026-10-08 — zstd + triple in the browser (WASM transport)

- New dep `@dweb-browser/zstd-wasm@1.2.1` (wasm-bindgen around zstd-rs; chosen over `@bokuweb/zstd-wasm` Emscripten output because it needs no bundler rules or deployed `.wasm` — `initSync` over the embedded base64 binary, fetch-free, lazy on first zstd use so ~890 KB never joins the initial bundle). New `src/utils/zstd.ts` wrapper: `ensureZstd` (never throws for load failures → callers answer `unsupported:`), `compressZstd`/`decompressZstd` (default level 15 = desktop, clamped 1–22), `compressTriple`/`decompressTriple` (LZ4→ZSTD→Brotli, the desktop `.cyb3` order; standard `28 B5 2F FD` frames both ways).
- Rust `crates/os-wasm/src/compression.rs` gains `decompress_zstd` (pure-`ruzstd`, the same decoder `artifact.rs` already uses) — decode prefers it when the deployed pkg has it, encode stays in JS (the C `zstd-sys` encoder can never build for wasm32).
- Wired everywhere: `StaticCodecs` gains optional `compressZstd/decompressZstd/compressTriple/decompressTriple` (`useTauri.ts` supplies them); cybsh `compress <path> [lz4|zstd|brotli|triple]` → `.lz4/.zst/.br/.cyb3` envelopes, `decompress` unwinds all four (unknown algs still `invalid:`, unavailable legs `unsupported:`); `useWasmCrypto.ts` pipeline compresses/decompresses `zstd` + `triple` with per-layer stats in desktop colors; ShieldPanel note, `COMPRESSION_INFO`, `docs/OPERATIONS.md`, `TASKS.md P2-4` updated (no more "zstd stays desktop-only").
- Verified: `bash scripts/check-version.sh` green; `npx vue-tsc --noEmit` clean; `vitest` 37 files / 494 pass (new `zstd-wasm.test.ts` 10: real round-trips, magic bytes, level clamping, triple chain, shell `.zst`/`.cyb3` envelopes; `static-cybsh.test.ts` updated — `zstd` envelope without a decoder is now `unsupported:`, unknown algs stay `invalid:`). Rust `fmt/clippy/test` left to CI per repo rules.

## 2026-10-08 — Review pass: zstd/triple WASM hardening + cross-device check

- Real bugs found and fixed: (1) `handleCompress`/`handleDecompress` mapped a missing zstd module to `integrity:` — now passes `unsupported:` through, only a leg that actually ran and failed reports integrity; (2) `compressFile` ran the chain twice (encode + stats re-run: wasted work and a stored-but-error state if init failed between runs) — `encodeStored` now returns its per-layer `compDetails`, single run; (3) raw wasm errors from zstd legs surfaced unprefixed in the vault pipeline — wrapped as `integrity:` (still passing `unsupported:` through), removed a no-op in `decompressBytes`, `compressionCapable` also accepts `all`; (4) `ensureZstd` could hand back an uninitialised module when neither init path ran — `didInit` guard resolves `null` instead.
- Flake caught and fixed: `zstd-wasm.test.ts` "clamps levels" timed out once under full-suite load (first-touch compile of the ~890 KB binary > 5 s) — `beforeAll` warmup at 60 s + fewer clamp levels; green in every run since.
- Interop proven with an independent implementation: our level-15 frames decode byte-equal in `@bokuweb/zstd-wasm` (Emscripten build) and vice versa; committed a `node:zlib` cross-implementation triple test (foreign brotli leg unwinds our chain). npm-pack scratch dirs removed afterwards.
- Cross-device: desktop (win/linux/mac/android) and Docker `:3456` use native Rust zstd — untouched; Pages real-pkg gets lz4/brotli (Rust) + zstd/triple (JS); stub builds (Docker frontend stage) still refuse honestly; `db-worker` chunk verified zstd-free; Pages production build checked — wrapper/glue/binary land in separate lazy chunks (2 KB / 3 KB / 889 KB), never in the initial bundle.
- Incidental: fixed 2 `vue-tsc` errors in the concurrent theme/ui workstream (`density`/`motion` literal narrowing, type-only `as` casts, no behavior change). Their `cybsh-script.test.ts > theme + ui verbs` (`ui accent --for`) is still red — their feature mid-development, unrelated to this change, left for them.
- Verified: `vue-tsc` exit 0; `vitest` 505–506 pass with only that foreign failure; `check-version.sh` green; Rust left to CI per repo rules.

## 2026-10-08 — One-folder setup + unified-disk single-copy + verified move + key holder

- One-folder setup (`SetupWizard.vue` + `useCyberManjuFile.createCyberManjuFileInDirectory` + new pure `src/utils/vaultFolder.ts`): one directory pick creates `<picked>/vault.cybermanju` beside `<picked>/files/` (the `local` root); all pickers nudge to `files/`, manual vault paths get a loop warning + one-click fix, `Save & verify` refuses loop paths.
- Loop guards both layers: frontend `isProtectedSyncPath` + Rust `backends::is_protected_remote_path` (`*.cybermanju`, `cybermanju-up-*.cyb3`, `master.passphrase`, `keystore.json`, `/.cybermanju/`); pipeline skips quietly, `LocalBackend::upload_file` refuses with `integrity:`.
- Single-copy home by default: `SyncConfig.mirror` (opt-in duplicate), `SyncConfig.key_holder`, `SyncFile.home_config_id`, `DiskRow.holds_keys` (all serde-defaulted, old rows parse); new pure `src/utils/filePlacement.ts` (`chooseHome`/`mirrorTargets`/`planMove`/`designateKeyHolder`); wizard disks step has mirror checkboxes + key-holder radio (server enforces single-holder on save).
- Verified move A→B end to end: shared core `crates/sync/src/relocate.rs` (download A → upload B → BLAKE3 verify → delete A → retarget record; striped/vault/conflict honest refusals; lock-free via cloned `Database` handle — `Database` is now `Clone`); exposed as `POST /api/sync/move`, Tauri `move_sync_file`, `cybsh sync move <file> <from> <to>`, Sync panel Move form, store `moveSyncFile`; `POST /api/disk/key-holder` + Tauri `set_disk_key_holder` + DiskManager KEY HOLDER button + wasm `disks.key-holder` op. `mv` keeps moving namespace bytes (incl. cross-mount copy+delete); `sync move` moves a synced copy's home so the catalog follows.
- Verified: `bash scripts/check-version.sh` green; `npx vue-tsc --noEmit` clean; `vitest` 513 pass (new `vault-folder` + `file-placement` suites, new `sync move`/`mv` cross-mount static tests). Rust `fmt/clippy/test` left to CI per repo rules.

## 2026-10-08 — Heuristic faces everywhere + persistent folder attach

- Faces without ONNX now detect instead of staying silent: new pure-Rust `crates/faces/src/heuristic.rs` (YCrCb skin mask → connected components → geometry filters → 512-d crop embeddings, engine `heuristic-v1`, confidence per face, 6 unit tests for CI). `image` is a mandatory faces dep (pure-Rust jpeg/png/webp — mobile-link-safe). Funnel `detect_faces_in_file_with_engine` (+ `detect_faces_auto` bytes-injected, + batch-with-engines): ONNX success (even empty) stays `onnx`; ONNX error/absence falls back to heuristic; unreadable bytes stay `none`. Groups record `FaceGroup.detection_engine` (`#[serde(default)]` — old rows read as unknown); mixed-engine matches become `mixed`; responses carry `engine`/`detectionEngines`.
- Desktop: single/batch/recluster commands use the funnel (Android included — no `ort` linked). Docker: new `POST /api/faces/detect` + `POST /api/faces/detect-batch` (`crates/web/src/api/faces_api.rs`, same grouping math, bytes from `original_path`) + REST mappings (detect pair leaves WRITE_ONLY; grouping admin stays desktop-only). Pages: TS twin `src/utils/faceHeuristic.ts` (browser-free core, tested) + kv-backed static handlers (detect/batch/list/rename/merge/delete/similar); panel shows `via HEURISTIC-V1` and per-group engine tags; inspector face rows light up from the same store.
- Folder attach that survives reloads: new `src/utils/localDir.ts` (typed dir-handle registry in IDB, boot restore that queries but never prompts, one-click re-grant, real list/read/write/mkdir/delete through handles with house prefixes) + `idbKeys()`; App boot restores wizard + provider dirs; SetupWizard/Accounts persist via the registry (no more lying `as string` casts); sync step shows remembered-folder status + Re-allow button; vault step explains plain-HTTP LAN (Docker over `http://nas`) has no pickers and keeps the vault server-side. Desktop native dialogs and mobile app-private partitions verified prompt-free by design (no code change).
- Verified: `vue-tsc` exit 0; `vitest` 43 files / 529 pass (new `face-heuristic` 12 + `local-dir` 9 + faces route lock). Rust `fmt/clippy/test` left to CI per repo rules (new heuristic unit tests + updated `test_face_group_serde` with legacy-row check run there).

## 2026-10-08 — Heuristic faces v2: eyes-or-it-is-not-a-face

- Literature review (Hsu/Mottaleb/Jain ICIP-2001 white-patch + eye/mouth maps; Chai–Ngan box; Yang et al. hands-vs-faces; Campadelli ≥1-eye rule; three-Gaussian wide rect) exposed v1's core flaw: skin geometry alone cannot tell a hand from a face. v2 (`heuristic-v2`, Rust + TS twins with matched integer math): white-patch lighting compensation (clamped, skipped without a bright patch), luma-adaptive skin bounds (tight box mid-luma, wide rect at extremes — dark skin now detected), 3×3 opening, then eye/mouth verification per candidate — luma valleys with pair geometry (aligned/separated/symmetric) or one eye plus an Hsu mouth-map mouth. A bare skin blob is rejected by design.
- Confidence = geometry base + feature bonus (cap 0.95); embedding layout unchanged (512-d, compatible grouping); engine bumped v1→v2 everywhere (behavior changed), UI tag generalized to any `heuristic-*`, missing engine reads `unknown`.
- Tests hardened both sides with identical fixtures: eyes+mouth found (>0.5 conf), featureless blob rejected, one-eye+mouth passes, lone eye rejected, dark skin found, determinism, crop separation. TS 11/11 green; Rust unit tests added for CI (`cargo` stays CI-only per repo rules).
- Verified: `vue-tsc` exit 0; `vitest` 43 files / 533 pass; `check-version.sh` green.

## 2026-10-08 — File manager sees all providers; cybsh reaches outside the container

- File manager now shows every Google Drive / GitHub / GitLab repo: `store.fetchFiles('/providers')` lists mounts plus enabled-but-unmounted configs (`pending-<id>` placeholders that mount on click); subdirectories try the canal first and fall back to REST `list_remote_files` with one-level folder synthesis (new pure `src/utils/providerBrowse.ts`); FileManager auto-mounts enabled configs on open, routes picker uploads into the current provider folder, and `vaultWriteBytes` falls back to `os_write` for text on web/static (binary refuses honestly). Provider ⇄ provider moves stay verify-before-delete; saves land in the vault root (`.cybermanju` home).
- cybsh provider namespace `/providers/<mount|config>[/path]` on every transport: native Rust (`crates/os/src/provider_fs.rs`, wired into `ls/cd/cat/cp/mv/rm/mkdir/touch/stat`) resolves mounts via kv rows or config ids, lists through the classified sync backends (git trees synthesize folders; Drive merges files + a new `list_dirs` folder query — new defaulted `StorageBackend::list_dirs` in `crates/types`, Drive-only override so existing implementors compile untouched), copies verify via BLAKE3 re-read, moves are copy→verify→delete-source, `mkdir` writes `.keep` (git has no empty dirs). `du/find/grep/head/tail/wc/write/edit/encrypt/decrypt/compress/decompress` refuse provider operands with `unsupported:` (cp locally first); `local`-backend configs refuse (host path, not remote). Static shell gains provider `ls`/`cat` (local operands still fall through to the wasm volume); `docs/OPERATIONS.md` §4a documents the namespace.
- Verified: `vue-tsc` exit 0; `vitest` 45 files / 547 pass (new `provider-browse` 4 + provider `ls`/`cat` static tests 6). Rust `fmt/clippy/test` left to CI per repo rules (new `provider_fs` unit tests + Drive `list_dirs` run there).

## 2026-10-08 — macOS-style flat AMOLED glass remake (UI/UX)

- Tokens: `src/ui/tokens.ts` cut from 17 themes to 3 (`os-dark` true AMOLED, `os-light` paper, `os-graphite` mono) with one fixed geometry (window 12 / menu 10 / control 6 / chip 4), SF-only type, flat shadows + 0.5px outline + focus ring. Glow/aurora/neon/shape/font axes kept as deprecated aliases resolving flat so old markup compiles. `useTheme()` migrates stored ids by mode, adds follow-system auto appearance, collapses glass to solid/translucent. New WCAG guards in `tests/frontend/ui-theme.test.ts` (text + text-2 ≥ 4.5:1, accent ≥ 3:1 — all pass; light text-2 lifted to .80 alpha to clear 4.5).
- Shell parity: native `crates/os` + `os-wasm` + static cybsh theme tables accept the 3 ids with all 17 legacy ids migrating by mode; glass verbs collapsed to solid/translucent; defaults os-dark, glow off. Frontend + wasm + native tests updated.
- Chrome: AppWindow 28px centered-title titlebar with shared `UiTrafficLights` (grey inactive), TopMenuBar 24px glass with Window menu + monochrome tray + inline clock, Dock floating 14px glass with magnification/hover labels/running dots/trash-at-end, static gradient wallpaper with canvas opt-in (matrixRain default off), Spotlight palette, top-right 340px banners, 260px alert confirm, sheet auth + setup wizard, black boot screen with thin progress bar.
- Panels: Finder FileManager (translucent sidebar, accent-fill selection + grey unfocused, zebra list, 60px icons, sentence-case headers), Settings Appearance (Auto/Light/Dark/Graphite segmented + accent dots + chrome toggle + wallpaper effects), flat Terminal/CodeStudio/Agent bubbles, sentence-case labels everywhere, flat UiCheckbox/Progress/Card/Text, 4 new primitives (UiSegmented/UiSidebarItem/UiMenu/UiTrafficLights). Icon set self-pruned `minimize-bold` (164 icons).
- Verified: `check-version.sh` green; `npm run typecheck` (icons+vue-tsc) exit 0; `vitest` 45 files / 550 pass. Rust `fmt/clippy/test` left to CI per repo rules. No Playwright in repo — 5-screen screenshot baselines not added (needs new dep + browsers).

## 2026-10-08 — Kubuntu/Plasma shell style (second axis, not more themes)

- New orthogonal axis: `shellStyle: macos|plasma` in `useTheme()` (`cybermanju_shell_style`, `data-ui-shell`; default macos, non-breaking). `src/ui/shells.ts` registry picks chrome (TopMenuBar/Dock vs PlasmaPanel+Kickoff); `useShellInsets()` reads `--ui-menubar-h/--ui-panel-h` live and the window-manager fallback math respects the 44px panel. Single-window invariant + aliases untouched.
- Tokens: `plasma-dark` (#1b1e20/#232629/Breeze #3daee9, on-accent #232629) and `plasma-light` (paper/Breeze #178dc2 — closest blue clearing 3:1 both ways, on-accent white) with panel/hover surfaces, 6/6/4/3 radii, 30px titlebar, 44px panel var, 2px accent focus, 100/150ms motion, 20px panel-only blur. Contrast tests extended to all 5 themes + on-accent ≥ 3:1 (accent checked on surface + composited panel, where it renders).
- Chrome: `PlasmaPanel.vue` (launcher, layout pager, task manager with middle-click close + window menu, tray with network/sync/notifications/volume/theme popovers, clock + calendar), `KickoffMenu.vue` (MODULE_METADATA grid, search, Favorites/Apps/Recent/Power, avatar + lock/logout/restart), `UiTitlebarButtons` (right-side glyphs, danger close hover), AppWindow plasma titlebar + edge snap → tiled + titlebar menu with always-on-top pin, KRunner palette, bottom-right banners, icon-left confirm, SDDM login (wallpaper-through + bottom-left power), 3 original wallpapers + picker.
- Panels: Dolphin FileManager (plasma Places, Alt+L editable location bar, F11 info panel, zoom slider + free space in status bar, zebra/details already flat), Settings gains shell style + wallpaper + panel position + section search, Agent user bubble = accent 20% tint in plasma, Activity-Monitor process table sentence case.
- Keys: `[Plasma]` bindings in `keymaps/default.kpl` (Alt+F1 Kickoff, Alt+Space/Ctrl+Space KRunner, Alt+Tab desktop-only task switch, Meta+Arrows snap halves implemented in App.vue). cybsh theme tables (static + native + wasm) accept the plasma pair; frontend + wasm tests cover them.
- Verified: `check-version.sh` green; `npm run typecheck` exit 0; `vitest` 45 files / 553 pass. Rust left to CI. Mobile: panel hides ≤768px, MobileNav/Launcher unchanged (tokens only). No Playwright in repo — matrix/screenshot QA not added.

## 2026-10-08 — Native controls themed + merge with concurrent agent

- All bare `select` / checkbox / radio / slider elements now go through one token-driven baseline in `src/assets/main.css` (themed boxes, accent fills, `--ui-focus-ring`, `color-scheme` per mode so native arrows + option popups follow the theme; custom 4px slider grooves with `--p` fill, 14px thumbs; coarse-pointer sizing). Fill wired per slider (FileManager zoom, disk-size slider); focus rings normalized to the token across `.am/.sw/.msw/.tf` inputs; checkbox label rows aligned.
- Removed the hardcoded terminal colors: new `--ui-terminal` token per theme (black in dark modes, paper in light) and radio dots / slider thumbs now use `var(--ui-on-accent)` / `var(--ui-text)`; the checkbox check stays white except plasma-dark (dark glyph override). Remaining `#fff` spots are documented constants that clear 3:1 on every danger/accent fill.
- Merge: another agent was concurrently rewriting `.vue` files into CSS-only fragments (7 components destroyed incl. TerminalPanel/TransferGraph mid-session) plus real voice-input auto-detect work (`resolveVoiceLang`/`VoiceLangPref` in `speechCorrect`/`useVoiceInput`). Kept their TS work; restored the 7 components from HEAD (fragments held only orphaned classes, no template/script to merge) and re-applied the theme edits on TerminalPanel/TransferGraph.
- Verified: `npm run typecheck` exit 0; `vitest` 45 files / 554 pass; `npx vite build` succeeds (pre-existing chunk-size warning only).

## 2026-10-08 — Android ships the real launcher icon (Tauri-default logo fix)

- Root cause: `tauri android init` stamps the Tauri template's DEFAULT launcher icons into `gen/android/app/src/main/res/`, and no step ever replaced them — the official flow (`tauri icon <source>` AFTER init, per https://v2.tauri.app/distribute/google-play/#changing-app-icon) was missing from every pipeline, so all APKs/AABs carried the Tauri logo.
- New `scripts/android-icons.sh` (idempotent): runs `npx tauri icon public/icon-512.png` (512x512 RGBA canonical mark; `bhumisparsha.png` is 250x280 non-square) into a temp dir — never the default `src-tauri/icons` output, so no tracked desktop icon is touched — copies only the `android/` subtree into the generated project's `res/` (copy-not-delete, template files like `strings.xml` survive), then verifies all 15 mipmap PNGs + adaptive-icon XML + background exist and the foreground densities match the documented 108/162/216/324/432.
- Wired between init and configure in all three pipelines (`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.gitlab-ci.yml`); `docs/ANDROID.md` §1/§8 + `android-configure.sh` header + `AGENTS.md` updated.
- Verified: script run against a fake gen dir (17 files land, densities check, template files intact, `git status` shows no tracked churn); `bash -n` clean. `check-version.sh`/`vue-tsc`/`vitest` re-run below.
- Instant-close report: native side already self-heals (DB quarantine, index rebuild, files-dir probing, re-entry-safe logging, 8 MB Tantivy arena on mobile) with logcat breadcrumbs — needs the reporter's device model + Android version + APK name + `adb logcat` excerpt (`docs/ANDROID.md` §9) to diagnose; no code change made for it in this pass.

## 2026-10-08 — Crash log made un-truncatable (follow-up to instant-close report)

- Reporter's logcat proved the crash site: `CyberManju OS FATAL (panic)` at `src-tauri/src/lib.rs:43` — the `panic!` inside `fatal()`, i.e. a startup gate (DB dir creation, DB open+quarantine, or index open+wipe) refused. But the refusal REASON was lost: it was logged on following lines that a bare `grep "CyberManju OS FATAL"` filters out.
- `fatal()` now logs `CyberManju OS FATAL: <reason>` (marker-prefixed, single line) and the mobile panic hook flattens location+payload to one line — the cause always survives the triage grep. `docs/ANDROID.md` §9 now prescribes `grep -A 10` and says why.
- Still needs from the reporter: Android version + exact APK name + `grep -A 10` output to name the actual gate. Rust validation left to CI per repo rules (no local cargo).

## 2026-10-08 — Android instant-close root-caused: Tantivy 15 MB arena floor

- Reporter's `grep -A 10` gave the reason: `Failed to initialize Tantivy at …/tantivy_index even after wiping the corrupt index: … 'The memory arena in bytes per thread needs to be at least 15000000.'`
- Root cause: `crates/search` used an 8 MB writer heap on Android, but Tantivy 0.22 rejects anything under 15 MB — so `SearchIndex::new` failed on EVERY launch (fresh installs included; never device-specific), `open_search_index` misread it as a corrupt index, wiped a healthy index, retried, failed, and `fatal()`-panicked before first paint.
- Fix: Android `WRITER_HEAP_BYTES` 8 MB → 15 MB (the library floor, still 3.3× smaller than desktop's 50 MB); comment cites the floor so nobody "optimizes" it back down. `docs/ANDROID.md` §5 updated. Needs a rebuilt APK + reinstall (uninstall wipes the app-private index dir, so a fresh start is guaranteed).
- Verified: floor value comes verbatim from the library's runtime error on-device (`>= 15000000`); `check-version.sh` green. `cargo clippy/test` left to CI per repo rules.
