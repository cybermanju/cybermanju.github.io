#!/usr/bin/env python3
"""Verify the Android clipboard JNI bridge survived APK packaging and R8."""
import importlib.util
import re
import struct
import sys
import zipfile
from pathlib import Path

VOICE_CHECKER = Path(__file__).with_name("check-android-voice-apk.py")
_spec = importlib.util.spec_from_file_location("check_android_voice_apk", VOICE_CHECKER)
_voice = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_voice)


def main(path):
    with zipfile.ZipFile(path) as apk:
        dexes = [name for name in apk.namelist()
                 if re.fullmatch(r"classes(?:[0-9]+)?\.dex", name)]
        if not dexes:
            raise ValueError("APK contains no DEX files")
        classes, methods, types = set(), [], set()
        for name in dexes:
            defined, implemented, references = _voice.dex_symbols(apk.read(name))
            classes.update(defined)
            methods.extend(implemented)
            types.update(references)
    bridge = "Lcom/cybermanju/os/CybermanjuClipboard;"
    expected = (bridge, "dispatch",
                "Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;",
                "Ljava/lang/String;")
    if bridge not in classes:
        raise ValueError("missing JNI bridge class " + bridge)
    if expected not in methods:
        raise ValueError("missing exact JNI method dispatch(Activity,String,String):String with public static bytecode")
    if "Landroid/content/ClipboardManager;" not in types:
        raise ValueError("ClipboardManager type absent from DEX")
    print(f"Android clipboard APK OK: {path} ({len(dexes)} DEX files)")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("usage: check-android-clipboard-apk.py APK")
        main(sys.argv[1])
    except (OSError, ValueError, IndexError, zipfile.BadZipFile, struct.error) as error:
        print("check-android-clipboard-apk: " + str(error), file=sys.stderr)
        sys.exit(1)
