# CONTROL — `.cybermanju` file, OAuth-only accounts, browser crypto

Living task tracker. Updated as each task lands. Status legend:
`[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped/deferred

**Constraints (locked in):**
- **NEVER install a local Rust toolchain** (no rustup, no cargo, no wasm-pack on the dev box).
  All `cargo`/`wasm-pack` build + check + test runs in **GitHub CI** on manual push
  (`.github/workflows/ci.yml` → `rust-check`, `wasm-build` → `cargo check --target wasm32`,
  `wasm-pack build`, `npm run build:wasm:frontend`, Pages deploy).
  Rust changes are therefore written against docs.rs/CI and verified only on push.
- Local verification loop = `npm run typecheck` + `npx vitest run`.
- Accounts login: **removed entirely** — OAuth only (Supabase broker).
- **MEGA dropped** (not a sync backend, not a Supabase Auth provider).

**Baseline before work started:** `npm run typecheck` ✅ · `npx vitest run` 8/8 ✅

---

## Phase 1 — `.cybermanju` as a real file on the user's disk

- [x] 1.1 `src/utils/container.ts` — container codec: `CYBMJ01` header, lz4-compress,
      ChaCha20-Poly1305 encrypt (pkg exports), key from passphrase via iterated
      PBKDF2-HMAC-SHA512 (100k, `hmac_sha512`), legacy raw-redb pass-through.
      Pluggable primitives for tests. + `isEncryptedContainer()` header probe.
- [x] 1.2 `tests/frontend/container.test.ts` — round-trip, legacy image, wrong passphrase,
      no-passphrase, compression-skip. (10 tests, green)
- [x] 1.3 `src/utils/idb.ts` — IndexedDB store for the `FileSystemFileHandle`.
- [x] 1.4 `src/workers/db-worker.ts` — `_attach {handle, bytes, passphrase}` → decode →
      `db_restore`, `_save` → `db_snapshot` → encode → `createWritable`, `_export`,
      `_detach`, status folded into `_status.disk`, debounced autosave (2 s),
      `pagehide` flush.
- [x] 1.5 `src/composables/useWasmBackend.ts` — `wasmAttachDisk/wasmSaveDisk/wasmDiskStatus/
      wasmExportDisk/wasmDetachDisk` + explicit "needs the worker" errors in the
      main-thread fallback.
- [x] 1.6 `src/composables/useCyberManjuFile.ts` — open/create picker, re-attach from IDB with
      permission re-request, passphrase prompt for encrypted files, save now,
      export/import fallback (Firefox/Safari have no FSA API), boot restore.

## Phase 2 — config + secrets + file content live inside the file

- [x] 2.1 Rust `crates/db/src/database.rs` — `KV_TABLE` (`kv`) + `get_kv_table()`, opened in
      `Database::new`.
- [x] 2.2 Rust `crates/os-wasm/src/db.rs` — `kv` opened in `open_all_tables`;
      ops `kv.get` / `kv.set` (64 MiB cap) / `kv.delete` / `kv.list` (keys+sizes only);
      `files.create` (node + optional `content:` body); `files.patch` (whitelisted fields
      + `modifiedAt`). Compiles in CI (`rust-check`).
- [x] 2.3 `src/composables/useVault.ts` — kv-backed secrets, localStorage fallback under
      `cybermanju.vault.*`, `vaultBackend()` status, `migrateVaultFromLocalStorage()` one-shot
      migration (old `pkg/` has no `kv.*` until CI rebuilds → degrades silently).
- [x] 2.4 `useSupabase.ts` — `hydrateSupabaseConfig()` at boot reads `config:supabase.*` from
      the vault; `set/clearSupabaseConfig` write through to both stores.
- [x] 2.5 Volume mirror: `src/composables/useVolumeMirror.ts` — diff localStorage
      `cybermanju.os.volume` → `kv volume:*` on a debounced os/* dispatch hook
      (`addOsDispatchHook` in useWasmBackend), replay `volume:*` → `os write` at boot
      (fill-missing) and after opening a file (file wins). Flushes on `pagehide`.
- [x] 2.6 File content: `read_file_content` / `write_file_content` routes on `kv content:<fileId>`
      (base64 uploads decoded, node size/modified patched) + `upload_file` static handler
      (`files.create` + `encoding:<id>` marker). No more "needs the dashboard" for these.

## Phase 3 — Accounts window: OAuth pickers + disk, no password

- [x] 3.1 Delete `src/components/LoginPopup.vue` + `App.vue` import/render.
- [x] 3.2 Remove `showLoginPopup` from `stores/app.ts` (+ 401 auto-popup →
      `cybermanju:open-accounts` event) and from `CommandPalette.vue` /
      `TopMenuBar.vue` actions (both now `wm.open('accounts')`).
- [x] 3.3 `useSupabase.ts` — `startSupabaseSignIn(provider)` + `signInWithPopup`
      (3-min poll, no implicit session stealing) + `refreshIdentity()` /
      `signOutIdentity()`; identity published on `finishSupabaseReturn()`.
- [x] 3.4 `AccountManagerPanel.vue` — `[IDENTITY] OAUTH SIGN-IN` (avatar / provider
      badge / Google+GitHub+GitLab / sign out) + `[DISK] THIS MACHINE (.CYBERMANJU FILE)`
      (open / create / save / export / import / detach, passphrase + permission
      unlock blocks); old APP LOGIN + DEVICE ACCOUNTS sections gone.
- [x] 3.5 Provider connect + per-provider `.cybermanju` size slider kept (now
      `CLOUD + LOCAL CONNECTIONS` / `ADD PROVIDER` with the range + APPLY SIZE).

## Phase 4 — encryption + compression actually work in the WASM build

- [x] 4.1 `src/composables/useWasmCrypto.ts` — keypair gen (X25519 / ML-DSA-65 / ChaCha20 key),
      file encrypt/decrypt, compress/decompress over pkg exports; one
      encode/decode pipeline (`encodeStored` = compress → sign → seal →
      `content:` + `encoding:` + `meta:` + node patch, `decodeStored` reverses it),
      passphrase-derived key (`hkdf_derive`, never persisted), honest
      `algorithmDisplay` strings, `compressionCapable()` capability probe.
- [x] 4.2 `src/composables/useTauri.ts` — static handlers for `generate_keypair`,
      `list_keys`, `get_encryption_status` (takes `fileId`), `encrypt_file`,
      `decrypt_file`, `compress_file`, `decompress_file`; `write_file_content`
      moved onto the pipeline handler; `read_file_content` now unwinds via
      `readContentText` (base64 uploads + compression + encryption in one place).
- [x] 4.3 `EncryptionPanel.vue` / `CompressionPanel.vue` — `webLocked` is now
      `!isStaticHost()` (capability, not "am I a browser"), panels explain the
      difference (dashboard build has no crypto/compression endpoint; offline
      wasm build does), `zstd`/`triple` disabled when `!compressionCapable()`,
      CompressionPanel defaults to `lz4` on static, "NEEDS THE TAURI APP /
      FOR REFERENCE" copy gone.
- [x] 4.4 Add `brotli` to `CompressionType` + `COMPRESSION_INFO` (desktop
      `compress_file` already accepts it; wasm `compress_brotli` backs it).

## Phase 5 — Rust-wasm provider canal (`B`, read path) → one virtual FS

Goal: **Rust compiled to wasm is one of the canals** that reads provider
artifacts (encrypted/compressed `.cybermanju` + `CYBE1` sync payloads) and
renders them as a single virtual filesystem under `providers/`.

**Decisions locked in (user, 2026-10-06):**
- **B — fully Rust-wasm canal**: transport (list/fetch/probe) + artifact
  unwrap (Argon2id → ChaCha20-Poly1305 → Brotli/ZSTD/LZ4) live in
  `crates/os-wasm`, not TypeScript fetch. TS only orchestrates.
- **Ships inside the `.cybermanju`**: mount registry + directory cache +
  master passphrase live in the redb `kv` table, so `_save`/`_attach` of the
  container carries the whole provider namespace with it. No new redb table.
- **Namespace**: single virtual root `providers/<mountId>/<remotePath>` —
  mounts are read-only lower layers (never merged into `/`).
- **CORS-OK providers only**: `github`, `gitlab`, `googleDrive`.
  `telegram` / `googlePhotos` are refused up front with an honest `cors:`
  error (they send no `Access-Control-Allow-Origin`, so no browser can read
  them — desktop/Docker/dashboard server remains their canal).

**Research — Rust VFS ecosystem (task 4), what we take from each:**

| Repo | Insight applied here |
|---|---|
| `manuel-woelker/rust-vfs` (vfs crate) | Trait-based FS with `OverlayFS` = read-only lower layers + one upper. Our mounts are exactly read-only lowers under `providers/`; no merged overlay yet. |
| `dphilla/wasm-vfs`, `ternbusty/monaka-fs` | Wasm-first VFS + **sync-core split** (`vfs-sync-core` separate from host adapters) — confirms canal B's shape: pure core, transport behind a trait, one impl per platform. |
| `wnfs-wg/rs-wnfs` | `BlockStore` trait: storage behind an async, content-addressed interface, **no system calls in core**. `CanalTransport` is our `BlockStore` equivalent (probe/list/fetch as `Vec<u8>`), so no `std::fs` ever enters the wasm path. |
| `bare-vfs` | Inode-based memfs that targets `wasm32-unknown-unknown` and snapshots via serde — validates "build the tree in memory, persist by snapshot"; we snapshot through redb instead. |
| `MrElectrify/virtual-fs`, `wasi_virt_layer` | Confirms the two standard layers: a path-resolving VFS over pluggable backends, plus (for us) a TS-side path mapper at the `invoke()` choke point. |

- [x] 5.1 `crates/os-wasm/src/canal.rs` — exports: `canal_dispatch(op,
      args_json)` async (`probe` / `list`, envelope like `db_dispatch`) +
      `canal_fetch(config_json, locator) -> Uint8Array` (binary out, no
      base64). Transport over `web_sys::fetch` (window **or** worker global
      scope — the db-worker has no `window()`), house error prefixes
      (`auth:` `not_found:` `rate_limited:` `too_large:` `network:` `cors:`
      `unsupported:`), provider adapters GitHub (git/trees + contents raw),
      GitLab (repository/tree + `/-/repository/files/…/raw` with
      `PRIVATE-TOKEN`), Drive (`files.list` + `alt=media`, folder-id walk
      like `folder_chain`), refuse `telegram` / `googlePhotos` with `cors:`.
      Pure parsers (`entries_from_*`, `status_error`, `urlencode`, prefix
      folding) are natively `cargo test`-covered; `CanalConfig` accepts a
      raw `SyncConfig` JSON (`backendType` alias, null-tolerant fields,
      casing-normalised backend names).
- [x] 5.2 `crates/os-wasm/src/artifact.rs` — `artifact_magic()` +
      `artifact_open()`: `CYBE1` → Argon2id (m=19456,t=2,p=1 — byte-identical
      to `crypto/keystore.rs::derive_key`) → ChaCha20-Poly1305 → triple
      decompress Brotli→ZSTD→LZ4; ZSTD via pure-Rust `ruzstd`
      (`cybermanju-compression` is unbuildable on wasm — `zstd-sys` is C).
      `CYBMJ01` / `CYBMJU1` pass through for the TS container codec.
- [x] 5.3 `crates/os-wasm/Cargo.toml` — added `ruzstd = "0.9"` (std on by
      default) and `web-sys` features `Window, WorkerGlobalScope, Request,
      RequestInit, Response, Headers`; `lib.rs` wires `pub mod artifact;
      pub mod canal;`, `db::envelope_json` is `pub(crate)` so both
      dispatchers share one envelope shape. "Pure Rust, no C" kept.
- [ ] 5.4 `src/composables/useWasmBackend.ts` — `wasmCanalDispatch`,
      `wasmArtifactMagic`, `wasmArtifactOpen` (main thread, same load path
      as `wasmAgentPrompt`), honest error when `pkg/` predates the exports.
- [ ] 5.5 `src/composables/useProviderCanal.ts` — mount CRUD in `kv`
      (`vfs:mount:*`), dir cache (`vfs:cache:*`, TTL), path mapping
      `/providers/<id>/…` ↔ `(configId, remotePath)`, `listDir` / `readFile`
      orchestration (token from `sync.secret`, decode via 5.2, `CYBMJ01`
      handed to `decodeContainer`).
- [ ] 5.6 `src/composables/useTauri.ts` — static-host routes for
      `vfs_list_mounts` / `vfs_save_mount` / `vfs_delete_mount` (db `kv` ops)
      and `vfs_list_dir` / `vfs_read_file` (async canal composite) so the
      `[WASM Mode] needs the dashboard` error no longer fires for reads.
- [ ] 5.7 UI: `providers/` root in `Sidebar.vue` + lazy `TreeNode` children +
      read-only `FileGrid` browse through `store.fetchFiles('/providers/…')`.
- [ ] 5.8 `.cybermanju` ship test: mounts + cache + master passphrase
      survive `_save` → `_attach` round trip (kv is inside the redb image).
- [ ] 5.9 Tests: vitest for path mapping / canal orchestration with a mocked
      wasm module; `npm run typecheck` green.

## Verification

- [x] 6.1 `npm run typecheck` green (local `vue-tsc --noEmit`).
- [x] 6.2 `npx vitest run` green — 18 tests / 3 files.
- [x] 6.3 `npm run build:wasm:frontend` → `dist-wasm/` builds (locally through the
      `vite-plugin-wasm-stub` fallback since `pkg/` is a CI artifact).
- [ ] 6.4 CI green on push: rust-check, clippy, wasm32 check, wasm-pack, dist-wasm, Pages.

---

## Notes / decisions

- **Persistence without Rust:** `db_restore(bytes)` (`db.rs:897`) loads a whole redb image and
  `db_snapshot()` (`db.rs:863`) returns one (256 MiB cap) — so open/save of a user-picked file is
  pure TypeScript + File System Access API. `FileSystemFileHandle` is structured-cloneable →
  posted to `db-worker`, where redb already runs (OPFS sync handle).
- **Container encryption is JS-side**, using pkg exports (`chacha20_*`, `hkdf_derive`, `blake3_hash`,
  `compress_lz4`) — no new Rust crypto.
- **`kv.*` is the one hard Rust requirement** (secrets/content cannot reach redb otherwise).
  Until CI builds it, `useVault` falls back to localStorage so every phase stays testable.
- **Honest scope:** FSA API is Chromium-only (export/import fallback elsewhere); provider *network
  sync* for CORS-blocked providers (`telegram`, `googlePhotos`) still needs the desktop app /
  Docker / dashboard server — that message stays, and Phase 5 canals only claim the CORS-OK three.
- **Browser crypto honesty:** the wasm pkg has X25519 + ML-DSA-65 + ChaCha20-Poly1305 but no
  ML-KEM (Kyber). Keygen for `kyber*`/`hybrid`/`frodokem*` produces X25519 material and file
  encryption is ChaCha20-Poly1305 with a keypair-derived key; the panel says so.
