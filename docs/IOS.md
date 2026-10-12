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

Signing: Apple Developer certificate + provisioning profile via the
ephemeral CI keychain (`scripts/ios-signing.sh prepare`, secrets
`APPLE_CERTIFICATE_*` / provisioning alongside `ANDROID_KEYSTORE_*`),
verified after the build (`verify`: `codesign --verify` on the `.ipa`,
fail-closed when signing was expected) and shredded before artifact upload
(`cleanup`) — mirroring `scripts/android-signing.sh`
(prepare/verify/cleanup). CI (`ios-build` job) never requires signing
(`REQUIRE_SIGNING=0`) so the unsigned simulator IPA for sideload always ships
green; when Apple secrets exist the device `.ipa` builds and verifies in the
same job. Release sets `REQUIRE_SIGNING=1` so an uninstallable IPA never
publishes.

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
- [x] `scripts/ios-configure.sh` audits (version/floor/identifier/ATS)
- [x] `scripts/ios-signing.sh` prepare/verify/cleanup (ephemeral keychain)
- [x] `ios-build` CI job on macos-latest (simulator `.app` every run + device `.ipa` when secrets exist)
- [x] `tauri ios init` regenerates `gen/apple` per run (gitignored, like Android's `gen/`)
- [ ] Device build with real Apple secrets + TestFlight track (needs `APPLE_CERTIFICATE_P12_B64` / `APPLE_PROVISIONING_PROFILE_B64` in repo secrets — sequenced, honest reason: Apple Developer account + signing, not code)
