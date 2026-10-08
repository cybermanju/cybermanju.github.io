# docs/ANDROID.md — Android runbook (CyberManju OS)

> `com.cybermanju.os` on Android: local vault (Tauri IPC), arm64-v8a,
> APK + AAB, `minSdk 24`, `targetSdk 36`. Generated project lives in
> gitignored `src-tauri/gen/` — everything below is applied by
> `scripts/android-configure.sh` after `tauri android init`.

## 1. Packaging

| Item | Value |
|---|---|
| Formats | `--apk --aab` (direct-install APK + Play upload bundle), `--split-per-abi` |
| ABI (release) | `arm64-v8a` only — `ort-sys` ships prebuilt ONNX Runtime only for `aarch64-linux-android` |
| ABI (smoke) | `x86_64` emulator supported by `scripts/android-smoke.sh` (install skipped on ABI mismatch, never fails the build) |
| `minSdkVersion` | 24 (pinned in `tauri.conf.json > bundle.android`) |
| `versionCode` | pinned in `tauri.conf.json > bundle.android.versionCode` = `major*1000000 + minor*1000 + patch` (0.1.1 → 1001). Bump with the release; enforced by `check-version.sh` + `android-configure.sh` |
| Play track | manual upload of the `.aab` (internal track first). No auto-publish yet |

ABI debt: `armv7`/`i686` targets are NOT installed in CI (waste) and not
shipped. If `ort-sys` ever publishes other Android ABIs, re-add the target
+ extend the `--split-per-abi` matrix here.

## 2. Signing parity

* `release.yml` / GitLab: `REQUIRE_SIGNING=1` — missing keystore secrets is a
  hard failure (never publish an uninstallable APK).
* `ci.yml` PRs/forks (no secrets): build continues but the artifact is
  renamed `CyberManju-OS-<ver>-arm64-v8a-unsigned.apk` — **unsigned artifacts
  always say `unsigned` in the file name** (TASKS P2-8).
* `scripts/android-signing.sh cleanup` shreds `cybermanju-release.keystore` +
  `release-signing.properties` before artifact upload (self-hosted hygiene).

## 3. Manifest (applied by `android-configure.sh`)

* Permissions: `INTERNET`, `ACCESS_NETWORK_STATE` (LAN REST + OAuth),
  `ACCESS_FINE/COARSE_LOCATION` (GPS MapView), `CAMERA` (face capture),
  `RECORD_AUDIO` (voice input), `POST_NOTIFICATIONS`. All optional-hardware
  permissions are runtime-requested by the WebView bridge; declaring them is
  what makes the `Permissions-Policy` override below effective.
* `android:usesCleartextTraffic="true"` — the LAN dashboard is plain
  `http://nas:3456`; without this Android 9+ blocks the REST transport.
* `android:allowBackup="false"` (fail-closed): auto-backup of `cybermanju.db`
  + keys to Google cloud is a key-exfiltration risk. Backup path = manual
  encrypted export (Settings → Export), verified by restore test.
* Intents: `cybermanju://` deep link + `.cyb3` payload `VIEW` association.

## 4. Storage model (scoped storage)

* Database + Tantivy index + keys live in the app-private files dir
  (`/data/data/com.cybermanju.os/files`, override `CYBERMANJU_DATA_DIR` /
  `DB_PATH`). No `MANAGE_EXTERNAL_STORAGE`, no shared-storage writes.
* `capabilities/mobile.json` mirrors desktop permissions for that dir only.
* Import from shared storage goes through the system picker
  (`dialog:allow-open`), never raw filesystem paths.

## 5. Runtime differences from desktop

* Web Dashboard is **not started** on mobile (`#[cfg(mobile)]` in `lib.rs`):
  no localhost server, no battery drain, no Play-policy localhost-server
  review. Dashboard IPC commands stay registered and report `unsupported:`.
* Startup failures `panic!` (logcat + backtrace) instead of
  `process::exit(1)`.
* Tantivy index is `mmap`'d — large restores should run on Wi-Fi/charger.

## 6. Frontend on phones

* `viewport-fit=cover` + `theme-color` + safe-area padding on
  `.cybermanju-shell` (`env(safe-area-inset-*)`), `100dvh` height.
* System back gesture → `popstate` → close transient UI, else path-history
  back (same as desktop `go_back`).
* `body.cybermanju-offline` (from `online`/`offline` events) dims
  `.server-only` controls instead of hanging.
* CSP covers both WebView asset schemes: `asset: http://asset.localhost
  https://asset.localhost`.

## 7. Update channel

* Direct APK: manual download + install (unknown sources); `versionCode`
  increments every release so upgrades apply cleanly.
* Play: upload the `.aab`; staged rollout via internal → production tracks.

## 8. Verification

1. `bash scripts/check-version.sh` (versionCode pinned + derived).
2. CI `android-build`: configure → sign → `--apk --aab --split-per-abi` →
   `apksigner verify` → on-device smoke (`continue-on-error`, skips without
   an arm64 emulator) → shred secrets → upload APK+AAB.
3. Manual: `adb install CyberManju-OS-<ver>-arm64-v8a.apk` or
   `bash scripts/android-smoke.sh <apk>`.
