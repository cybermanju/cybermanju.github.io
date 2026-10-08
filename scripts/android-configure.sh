#!/usr/bin/env bash
# Android post-init configuration for CyberManju OS.
#
# Applies every in-tree Android setting that `tauri android init` does NOT
# generate, so CI never relies on Tauri template defaults silently:
#
#   0. launcher icons — NOT here: `scripts/android-icons.sh` (`tauri icon`
#      from `public/icon-512.png` into `gen/…/res/mipmap-*`; the template's
#      DEFAULT icons otherwise ship in every APK). Run it BEFORE this script.
#
#   1. versionCode audit — `tauri.conf.json > bundle.android.versionCode` must
#      equal `major*1000000 + minor*1000 + patch` from `package.json`
#      (Tauri auto-derives the same formula when the key is absent; pinning
#      it in-tree makes upgrades auditable and Play-compatible).
#      0.1.1 -> 1001. Bump alongside the release (check-version.sh enforces).
#   2. AndroidManifest patch — INTERNET + optional hardware permissions,
#      `usesCleartextTraffic` (LAN dashboard is plain http), explicit
#      `allowBackup=false` (fail-closed: reinstall wipes the vault; manual
#      export is the backup path — see docs/ANDROID.md), `.cyb3`
#      file-association + `cybermanju://` deep link.
#   3. ABI / artifact notes — arm64-v8a is the only shipped ABI (ort-sys
#      prebuilts); x86_64 is emulator-smoke only. AAB is built alongside APK
#      (`--apk --aab --split-per-abi`, see CI).
#
# Usage: bash scripts/android-configure.sh [gen/android-dir]
# Idempotent: every patch is guarded by a marker comment.
set -euo pipefail

cd "$(dirname "$0")/.."

ANDROID_DIR="${1:-src-tauri/gen/android}"
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
MARK="CyberManju OS (scripts/android-configure.sh)"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "::error::$ANDROID_DIR not found — run \`tauri android init\` first" >&2
  exit 1
fi

# ─── 1. versionCode audit ──────────────────────────────────────────
version="$(node -p "require('./package.json').version")"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"
patch="${rest#*.}"
expected=$((major * 1000000 + minor * 1000 + patch))
pinned="$(node -p "require('./src-tauri/tauri.conf.json').bundle?.android?.versionCode ?? 'unpinned'" 2>/dev/null || echo unpinned)"
if [ "$pinned" != "unpinned" ] && [ "$pinned" != "$expected" ]; then
  echo "::error::tauri.conf.json bundle.android.versionCode=$pinned but package.json $version needs $expected (major*1000000+minor*1000+patch)" >&2
  exit 1
fi
echo "versionCode ok: package.json $version -> $expected (pinned: $pinned)"

# ─── 2. AndroidManifest patch ──────────────────────────────────────
if [ ! -f "$MANIFEST" ]; then
  echo "::error::$MANIFEST not found — unexpected Tauri template layout" >&2
  exit 1
fi

if grep -q "$MARK" "$MANIFEST"; then
  echo "AndroidManifest already configured — leaving it alone"
else
  python3 - "$MANIFEST" "$MARK" <<'PYEOF'
import re
import sys
import xml.dom.minidom

path, mark = sys.argv[1], sys.argv[2]
src = open(path).read()

# 2a. Permissions (before <application>): INTERNET is required for the LAN
# REST transport / OAuth; location/camera/mic are optional hardware features
# (GPS MapView, voice input) — declared here so the WebView permission
# bridge and the Permissions-Policy override (docs/ANDROID.md) have manifest
# backing. Scoped storage is the default: no MANAGE_EXTERNAL_STORAGE, the
# app only writes its app-private files dir.
perms = """
    <!-- %s: network + optional hardware (MapView GPS, voice). No
         MANAGE_EXTERNAL_STORAGE by design — app-private files dir only. -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
""" % mark
anchor = "<application"
assert anchor in src, "no <application> in AndroidManifest"
src = src.replace(anchor, perms + "    " + anchor, 1)

# 2b. application attributes: cleartext for http://nas:3456 LAN servers +
# explicit backup policy (fail-closed; manual export is the backup path).
# The Tauri template pins android:usesCleartextTraffic="${usesCleartextTraffic}"
# (a manifestPlaceholder); prepending ours without removing it yields a
# duplicate attribute — not well-formed XML — and manifest merging fails.
# Strip any template-set copies first, then set ours exactly once.
m = re.search(r"<application\b[^>]*>", src)
assert m, "no <application> tag in AndroidManifest"
tag = m.group(0)
for attr in ("android:usesCleartextTraffic", "android:allowBackup", "android:fullBackupOnly"):
    tag = re.sub(r'\s+' + attr + r'="[^"]*"', "", tag)
tag = tag.replace(
    "<application",
    "<application "
    'android:usesCleartextTraffic="true" '
    'android:allowBackup="false" '
    'android:fullBackupOnly="false"',
    1,
)
src = (
    src[: m.start()]
    + "<!-- %s: cleartext=LAN http dashboard, allowBackup=false (manual export only) -->\n    " % mark
    + tag
    + src[m.end():]
)

# 2c. Deep link + .cyb3 association inside the main activity.
intent = """
            <!-- %s: cybermanju:// deep link + .cyb3 payload association. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="cybermanju" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" android:mimeType="*/*" android:pathPattern=".*\\.cyb3" />
                <data android:scheme="file" android:mimeType="*/*" android:pathPattern=".*\\.cyb3" />
            </intent-filter>
""" % mark
close = "</activity>"
assert close in src, "no </activity> in AndroidManifest"
src = src.replace(close, intent + "        " + close, 1)

# Fail fast: the merger's "Error parsing" surfaces after minutes of Gradle.
# Well-formedness here keeps a broken patch from ever reaching the build.
try:
    xml.dom.minidom.parseString(src)
except Exception as e:
    sys.exit("AndroidManifest.xml is not well-formed after patching: %s" % e)

open(path, "w").write(src)
print("patched " + path)
PYEOF
fi

# ─── 3. ABI / artifact policy note ─────────────────────────────────
# ort-sys ships prebuilt ONNX Runtime only for aarch64-linux-android, so
# release artifacts are arm64-v8a-only. x86_64 exists for the emulator smoke
# test only (scripts/android-smoke.sh). Tracked debt: docs/ANDROID.md §ABI.
echo "ABI policy: release=arm64-v8a only (ort-sys), emulator=x86_64 smoke only"
echo "android configure complete"
