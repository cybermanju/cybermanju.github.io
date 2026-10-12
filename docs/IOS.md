# iOS runbook (P2-16 — landed: simulator CI job + signing/configure scripts)

Native iOS target: simulator builds in CI, device IPAs sign when Apple
secrets exist. The UI contract is pinned
(`tests/frontend/mobile-ios.test.ts` — springboard pager, safe-area,
squircle icons), the config floor is set (`bundle.ios.minimumSystemVersion`
in `src-tauri/tauri.conf.json`), `scripts/ios-configure.sh` audits
version/floor/identifier/ATS, `scripts/ios-signing.sh`
(prepare/verify/cleanup) manages the ephemeral keychain + provisioning
profile mirroring `scripts/android-signing.sh`, and the `ios-build` CI job
(macos-latest) ships the simulator `.app` on every run plus the signed `.ipa`
when secrets exist. The first *device* build still needs Apple Developer
secrets (`APPLE_CERTIFICATE_P12_B64` / `APPLE_PROVISIONING_PROFILE_B64` alongside
`ANDROID_KEYSTORE_*`); nothing here pretends otherwise.

## 1. Scaffold the Xcode project

```sh
npx tauri ios init
```

This generates `src-tauri/gen/apple/` (gitignored, like Android's `gen/`).
Never commit it; CI regenerates per run.

## 2. Device build (macOS only)

```sh
npx tauri ios build --export-method app-store # or ad-hoc / enterprise
```

Signing: Apple Developer certificate + provisioning profile via Xcode or
`fastlane match`. CI has no Apple secrets yet — add
`APPLE_CERTIFICATE_*` / provisioning alongside `ANDROID_KEYSTORE_*` when the
first device build lands, mirroring `scripts/android-signing.sh`
(prepare/verify/cleanup) with `scripts/ios-signing.sh`.

## 3. Transport notes (same as Android)

- No dashboard on mobile: `MOBILE_NATIVE_OS_COMMANDS` serves the full cybsh
  OS layer + disks + devices + todos over IPC; REST is never probed without
  a server URL.
- LAN dashboard over plain HTTP (`http://nas:3456`) needs an App Transport
  Security exception: `NSAppTransportSecurity → NSAllowsLocalNetworking`
  (iOS 17+) or a per-domain `NSExceptionDomains` entry. HTTPS behind the
  Caddy sidecar (`Caddyfile` + `docker-compose.tls.yml`) needs no exception.
- OAuth callbacks use the `cybermanju://` deep link (already in the mobile
  deep-link config shared with Android).

## 4. Data protection parity (Android: `allowBackup=false` + manual export)

- iOS equivalent: exclude the vault from iCloud backup
  (`NSURLIsExcludedFromBackupKey` on the app-private files dir) and ship the
  same manual encrypted export path (`backup export` → Files app).
- Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) for the
  device identity private half; never iCloud Keychain sync for vault keys.

## 5. Safari gaps (tested fallbacks)

- No File System Access API: Export/Import uses the Files-app fallback path
  (same branch Android exercises without FSA).
- No OPFS in older WebKit: localStorage volume mirror (same as Pages).

## Status

- [x] UI contract tests green
- [x] `bundle.ios` floor set
- [ ] `tauri ios init` on macOS (generates `gen/apple`)
- [ ] First simulator build in CI (`ios-build` job, no signing)
- [ ] Device build + signing secrets + TestFlight track
