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
#   2b. Launcher bridge (`cybermanju-launcher` crate, Gaveta de Apps):
#      `<queries>` for ACTION_MAIN/CATEGORY_LAUNCHER so
#      `queryIntentActivities` sees every launchable app on Android 11+
#      WITHOUT the Play-restricted QUERY_ALL_PACKAGES permission, plus a
#      HOME/DEFAULT intent-filter so the app can be picked as the device
#      Home (digital-OS mode). Both are idempotent marker-guarded.
#   2c. Messages hub (top-right icon): a `NotificationListenerService`
#      (`CybermanjuMessages.kt`, written by §4 below) mirrors mail/chat/
#      social notifications into `cybermanju-messages.json` in the
#      app-private files dir (ring buffer, 200 entries); the Rust crate only
#      reads that file. Manifest gets the `<service>` declaration plus
#      explicit `<package>` queries for the top social apps (visibility for
#      labels/icons on Android 11+). The user still grants notification
#      access in system settings (runtime, per-device).
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

# 2c. Deep link + .cyb3 association inside the main activity. Tauri's
# deep-link plugin may already add the scheme filter from tauri.conf.json.
link_intent = ""
if 'android:scheme="cybermanju"' not in src:
    link_intent = """
            <!-- %s: cybermanju:// deep link. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="cybermanju" />
            </intent-filter>
""" % mark
file_intent = """
            <!-- %s: .cyb3 payload association. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" android:mimeType="*/*" android:pathPattern=".*\\.cyb3" />
                <data android:scheme="file" android:mimeType="*/*" android:pathPattern=".*\\.cyb3" />
            </intent-filter>
""" % mark
intent = link_intent + file_intent
close = "</activity>"
assert close in src, "no </activity> in AndroidManifest"
src = src.replace(close, intent + "        " + close, 1)

# 2d. Launcher bridge: package-visibility <queries> (Android 11+) + HOME
# filter so the app can serve as the device Home. The <queries> block is
# what makes queryIntentActivities(MAIN/LAUNCHER) return the full Gaveta
# without QUERY_ALL_PACKAGES (Play-restricted, deliberately not requested).
if "android.intent.category.LAUNCHER" not in src or "<queries>" not in src:
    queries = """
    <!-- %s: launcher bridge — see every MAIN/LAUNCHER activity (Android 11+ visibility). -->
    <queries>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
    </queries>
""" % mark
    if "<queries>" not in src:
        src = src.replace(anchor, queries + "    " + anchor, 1)
home_intent = """
            <!-- %s: Home intent — offer CyberManju OS as the device launcher. -->
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
""" % mark
if 'android.intent.category.HOME' not in src:
    src = src.replace(close, home_intent + "        " + close, 1)

# 2e. Messages hub: explicit <package> visibility for the top mail/chat/
# social apps (labels/icons on Android 11+) + the notification-mirror
# <service>. Single <queries> element only — merge into the existing one.
social_pkgs = [
    "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
    "org.signal.private.messenger", "com.instagram.android",
    "com.instagram.barcelona", "com.facebook.orca", "com.facebook.katana",
    "com.google.android.gm", "com.microsoft.office.outlook",
    "com.yahoo.mobile.client.android.mail", "ch.protonmail.android",
    "eu.faircode.email", "com.fsck.k9", "com.discord", "com.slack",
    "com.microsoft.teams", "com.twitter.android", "com.snapchat.android",
    "com.linkedin.android", "com.reddit.frontpage", "com.pinterest",
    "com.skype.raider", "com.viber.voip", "jp.naver.line.android",
    "com.tencent.mm", "com.kakao.talk", "com.google.android.apps.messaging",
    "com.tumblr", "xyz.blueskyweb.app", "org.joinmastodon.android",
]
pkg_lines = "".join(
    '        <package android:name="%s" />\n' % p
    for p in social_pkgs
    if ('<package android:name="%s"' % p) not in src
)
if pkg_lines and "</queries>" in src:
    src = src.replace(
        "</queries>",
        "        <!-- %s: messages hub — social package visibility. -->\n" % mark
        + pkg_lines
        + "    </queries>",
        1,
    )
service = """
        <!-- %s: messages hub — notification mirror (user grants access in settings). -->
        <service
            android:name=".CybermanjuMessages"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
            android:exported="false">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
""" % mark
if "CybermanjuMessages" not in src:
    assert "</application>" in src, "no </application> in AndroidManifest"
    src = src.replace("</application>", service + "    </application>", 1)

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

# ─── 4. Messages-hub listener service (§2c) ────────────────────────
# `gen/` is gitignored and regenerated by `tauri android init`, so the
# Kotlin service lives here as a heredoc and is (re)written on every
# configure run. Marker-guarded: an existing file WITHOUT our marker is a
# foreign file and is never touched; a file WITH it is refreshed in place.
APP_ID="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
KOTLIN_PKG="${APP_ID}"
KOTLIN_DIR="$ANDROID_DIR/app/src/main/java/${APP_ID//.//}"
SERVICE_FILE="$KOTLIN_DIR/CybermanjuMessages.kt"
SERVICE_MARK="CyberManju OS messages hub (scripts/android-configure.sh)"

if [ ! -d "$KOTLIN_DIR" ]; then
  echo "::error::$KOTLIN_DIR not found — unexpected Tauri template layout (identifier $APP_ID)" >&2
  exit 1
fi

if [ -f "$SERVICE_FILE" ] && ! grep -q "$SERVICE_MARK" "$SERVICE_FILE"; then
  echo "::error::$SERVICE_FILE exists without our marker — refusing to overwrite a foreign file" >&2
  exit 1
fi

cat > "$SERVICE_FILE" <<KTEOF
package $KOTLIN_PKG

// $SERVICE_MARK: mirrors mail/chat/social notifications into
// cybermanju-messages.json (app-private files dir, 200-entry ring).
// The Rust launcher crate only READS that file; notification access itself
// is granted by the user in system settings (see launcher hub prompt).

import android.app.Notification
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class CybermanjuMessages : NotificationListenerService() {

    override fun onListenerConnected() {
        try {
            for (sbn in activeNotifications) record(sbn)
        } catch (_: Exception) {
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        record(sbn)
    }

    // Hub "Clear all": the Rust bridge fires an explicit intent at this
    // running service (no intent-filter needed for explicit intents).
    // Dismisses the live shade AND wipes the mirror file together.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            if (intent?.action == ACTION_CLEAR) {
                try {
                    cancelAllNotifications()
                } catch (_: Exception) {
                }
                synchronized(LOCK) {
                    try {
                        File(filesDir, "cybermanju-messages.json").writeText("[]")
                    } catch (_: Exception) {
                    }
                }
            }
        } catch (_: Exception) {
        }
        return START_NOT_STICKY
    }

    private fun isSocial(pkg: String, n: Notification): Boolean {
        if (pkg == packageName) return false
        val p = pkg.lowercase()
        if (p in SOCIAL) return true
        for (t in TOKENS) if (p.contains(t)) return true
        val c = n.category
        return c == Notification.CATEGORY_MESSAGE || c == Notification.CATEGORY_EMAIL
    }

    private fun record(sbn: StatusBarNotification) {
        try {
            val pkg = sbn.packageName ?: return
            val n = sbn.notification ?: return
            if (!isSocial(pkg, n)) return
            val ex = n.extras ?: return
            val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            var text = ex.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
            if (text.isBlank()) {
                text = ex.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
            }
            if (title.isBlank() && text.isBlank()) return
            val label = try {
                val ai = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getApplicationInfo(
                        pkg, PackageManager.ApplicationInfoFlags.of(0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getApplicationInfo(pkg, 0)
                }
                packageManager.getApplicationLabel(ai)?.toString() ?: pkg
            } catch (_: Exception) {
                pkg
            }
            synchronized(LOCK) {
                val file = File(filesDir, "cybermanju-messages.json")
                val arr = try {
                    if (file.exists()) JSONArray(file.readText()) else JSONArray()
                } catch (_: Exception) {
                    JSONArray()
                }
                var updated = false
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    if (o.optString("key") == sbn.key) {
                        o.put("title", title)
                        o.put("text", text)
                        o.put("timestamp", sbn.postTime)
                        updated = true
                        break
                    }
                }
                if (!updated) {
                    val o = JSONObject()
                    o.put("key", sbn.key)
                    o.put("packageName", pkg)
                    o.put("appLabel", label)
                    o.put("title", title)
                    o.put("text", text)
                    o.put("timestamp", sbn.postTime)
                    o.put("category", n.category ?: "")
                    arr.put(o)
                }
                while (arr.length() > 200) arr.remove(0)
                try {
                    file.writeText(arr.toString())
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
    }

    companion object {
        private val LOCK = Any()
        const val ACTION_CLEAR = "com.cybermanju.os.action.CLEAR_NOTIFICATIONS"
        private val SOCIAL = setOf(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
            "org.signal.private.messenger", "com.instagram.android",
            "com.instagram.barcelona", "com.facebook.orca", "com.facebook.katana",
            "com.google.android.gm", "com.microsoft.office.outlook",
            "com.discord", "com.twitter.android", "com.snapchat.android",
            "jp.naver.line.android", "com.tencent.mm", "com.kakao.talk",
            "com.google.android.apps.messaging", "eu.faircode.email", "com.fsck.k9"
        )
        private val TOKENS = listOf(
            "whatsapp", "telegram", "messenger", "instagram", "facebook",
            "snapchat", "discord", "signal", "viber", "kakao", "wechat",
            "outlook", "reddit", "skype", "teams", "slack", "twitter", "tiktok"
        )
    }
}
KTEOF
echo "messages service ok: $SERVICE_FILE"

# ─── 3. ABI / artifact policy note ─────────────────────────────────
# ort-sys ships prebuilt ONNX Runtime only for aarch64-linux-android, so
# release artifacts are arm64-v8a-only. x86_64 exists for the emulator smoke
# test only (scripts/android-smoke.sh). Tracked debt: docs/ANDROID.md §ABI.
echo "ABI policy: release=arm64-v8a only (ort-sys), emulator=x86_64 smoke only"
echo "android configure complete"
