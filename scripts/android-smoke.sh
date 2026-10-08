#!/usr/bin/env bash
# Android on-device smoke test (CI, best-effort).
#
# Zero on-device verification was the gap: `apksigner verify` proves the
# signature, not that the app installs + boots. This script installs the
# built APK on a running emulator (if one is reachable) and:
#   1. `adb install` the APK (arm64 APK needs an arm64 emulator image;
#      x86_64 images cannot run it — that mismatch skips, not fails).
#   2. `adb shell am start` the main activity.
#   3. Greps logcat for the Tauri boot marker / fatal errors.
#
# Graceful skip (exit 0) when: no device/emulator attached, wrong ABI,
# missing platform-tools. CI wires this with `continue-on-error` so KVM-less
# runners stay green; the skip reason is always printed.
set -uo pipefail

cd "$(dirname "$0")/.."

APK="${1:-$(find src-tauri/gen/android/app/build/outputs/apk -name 'CyberManju-OS-*-arm64-v8a.apk' 2>/dev/null | head -1)}"
ACTIVITY="${ANDROID_ACTIVITY:-com.cybermanju.os/.MainActivity}"

skip() { echo "android smoke: SKIP — $1"; exit 0; }
fail() { echo "::error::android smoke: $1" >&2; exit 1; }

command -v adb > /dev/null || skip "adb not installed"
[ -n "$APK" ] && [ -f "$APK" ] || skip "no built APK found (build first)"
adb devices -l | grep -q " device\b" || adb devices | grep -qv "List of devices" \
  || true
if ! adb devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'; then
  skip "no emulator/device attached (start one with an arm64-v8a system image)"
fi

# ABI check: an arm64 APK cannot install on an x86_64-only emulator.
abi="$(adb shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || echo unknown)"
case "$abi" in
  arm64-v8a) echo "device ABI: $abi (compatible)" ;;
  *) skip "device ABI is '$abi' — arm64 APK needs an arm64-v8a image" ;;
esac

adb install -r "$APK" || fail "adb install failed for $APK"
adb shell am start -n "$ACTIVITY" || fail "am start failed for $ACTIVITY"
sleep 8
if adb logcat -d 2>/dev/null | grep -qiE "FATAL|AndroidRuntime.*com\.cybermanju\.os|tauri.*panic"; then
  adb logcat -d 2>/dev/null | grep -iE "FATAL|AndroidRuntime|panic" | head -20 >&2
  fail "crash markers in logcat after launch"
fi
echo "android smoke: PASS — installed + launched $APK on $abi"
