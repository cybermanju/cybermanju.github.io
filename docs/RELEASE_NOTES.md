## Features in this release (first publish)

**One vault everywhere.** Tauri v2 desktop (1400x900) · Docker/ZimaOS dashboard (:3456) · WASM static build on GitHub Pages. The UI auto-detects its transport (tauri IPC / REST / local WASM) and Settings always shows which one is live.

- **Post-quantum vault** — ML-KEM-1024 (FIPS 203) · ML-DSA-65 (FIPS 204) · SLH-DSA-128f (FIPS 205) · hybrid ML-KEM+X25519 · ChaCha20Poly1305 AEAD · BLAKE3 integrity · Argon2id hashing.
- **Triple-layer compression** — LZ4 → Zstandard-15 → Brotli-11 cascade with per-layer stats in every `.cyb3` payload.
- **Search that finds things** — Tantivy BM25 over filename + content + tags (phrases, booleans, wildcards, fuzzy, faceted filters, autocomplete) + scene heuristic (17 categories x 10 languages, receipts on every badge).
- **Faces · Map · Code** — 128-dim embedding clustering into person groups (empty, never fabricated, without the ONNX model) · EXIF GPS → MapLibre markers + clustering · tree-sitter for Rust/Python/JS/TS/Go/Bash with heuristic fallback, every parse reports its engine, plus a tabbed editor with version-snapshotted saves.
- **People & sharing** — RBAC (admin/user/viewer), per-file grants, JWT sessions, collections, loose groups, style tags.
- **Sync backends** — Local · GitHub · Google Drive · GitLab. Async by design (`POST /api/sync/start → 202 {jobId}`, poll for progress), live ETA + cancel, machine-prefix error contract (`auth:` … `conflict:`).
- **OAuth broker** — Supabase (GitHub/Google/GitLab) so static builds sign in and sync without your own server; Settings shows live broker state, Accounts deep-links straight to the broker card.
- **Native AI agent, zero new runtimes** — pure-Rust core on desktop/server/WASM · 10 provider presets + custom · opencode-style allow/ask/deny permissions (deny wins, 10-min parked asks) · MCP servers · SSE streaming · doom-loop guard · secret redaction · BLAKE3 hash-anchored edits · two-layer memory (transcripts + semantic, Hermes-compatible).
- **Decentralized OS layer** — `cybsh` shell (same on desktop/web/Pages, JSON mode, pipes, history, completion) · sized `.cybermanju` disks merged into one spanned volume · Reed-Solomon durability with scrub → repair, rebuild-from-remote, refcount GC and single-writer leases.
- **Remade Settings** — section jump chips with scroll spy, keyboard-bindings filter (98 bindings) with live count, gesture matrix that actually saves, inline broker validation.

## Status & known limits

- Android build is **arm64-v8a only**; the APK is release-signed (keystore secrets required in CI).
- WASM `sync` needs the dashboard; the content API caps at 1 MiB with versioned saves and `encrypted:` / `binary:` / `too_large:` refusals.
- Faces returns empty without the ONNX model — on purpose, never fabricated.
- Auth is fail-closed (404-before-401, RBAC, bootstrap-only register, 0600 secrets).
- Every artifact below passed the full CI gates: `cargo fmt --check` → `clippy -D warnings` → `cargo test --workspace` · `vue-tsc` · `vitest` · checksums in `SHA256SUMS.txt`.
