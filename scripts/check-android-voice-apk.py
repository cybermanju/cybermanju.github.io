#!/usr/bin/env python3
"""Check actual Android native bridges in the release APK DEX.

Uses only the Python standard library. This packaging gate cannot replace
microphone, TTS, permissions and routing tests on an Android device.
"""
import re
import struct
import sys
import zipfile


def uleb(data, pos):
    """Read a DEX unsigned LEB128 value, bounded to its 32-bit encoding."""
    value = 0
    for shift in range(0, 35, 7):
        if pos >= len(data):
            raise ValueError("truncated DEX ULEB128")
        byte = data[pos]
        pos += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, pos
    raise ValueError("invalid DEX ULEB128")


def dex_symbols(data):
    if len(data) < 112 or not re.fullmatch(rb"dex\n0[0-9]{2}\x00", data[:8]):
        raise ValueError("invalid DEX header")
    string_count, string_offset = struct.unpack_from("<II", data, 56)
    type_count, type_offset = struct.unpack_from("<II", data, 64)
    proto_count, proto_offset = struct.unpack_from("<II", data, 72)
    method_count, method_offset = struct.unpack_from("<II", data, 88)
    class_count, class_offset = struct.unpack_from("<II", data, 96)
    for count, offset, width in (
        (string_count, string_offset, 4), (type_count, type_offset, 4),
        (proto_count, proto_offset, 12), (method_count, method_offset, 8),
        (class_count, class_offset, 32),
    ):
        if offset + count * width > len(data):
            raise ValueError("truncated DEX table")

    strings = []
    for index in range(string_count):
        offset = struct.unpack_from("<I", data, string_offset + 4 * index)[0]
        _, start = uleb(data, offset)
        end = data.index(b"\0", start)
        # DEX strings use modified UTF-8. JNI names here are ASCII; unrelated
        # MUTF-8 strings (including encoded NUL/surrogates) must not fail a gate.
        strings.append(data[start:end].decode("utf-8", errors="replace"))
    types = [strings[struct.unpack_from("<I", data, type_offset + 4 * i)[0]]
             for i in range(type_count)]
    protos = []
    for index in range(proto_count):
        _, result, params = struct.unpack_from("<III", data, proto_offset + 12 * index)
        args = ""
        if params:
            count = struct.unpack_from("<I", data, params)[0]
            if params + 4 + count * 2 > len(data):
                raise ValueError("truncated DEX parameter list")
            args = "".join(types[struct.unpack_from("<H", data, params + 4 + 2 * i)[0]]
                           for i in range(count))
        protos.append((types[result], args))
    method_ids = []
    for index in range(method_count):
        owner, proto, name = struct.unpack_from("<HHI", data, method_offset + 8 * index)
        result, args = protos[proto]
        method_ids.append((types[owner], strings[name], args, result))

    classes = []
    methods = []
    for index in range(class_count):
        offset = class_offset + 32 * index
        owner = types[struct.unpack_from("<I", data, offset)[0]]
        classes.append(owner)
        pos = struct.unpack_from("<I", data, offset + 24)[0]
        if not pos:
            continue
        static_fields, pos = uleb(data, pos)
        instance_fields, pos = uleb(data, pos)
        direct_methods, pos = uleb(data, pos)
        virtual_methods, pos = uleb(data, pos)
        for _ in range(static_fields + instance_fields):
            _, pos = uleb(data, pos)
            _, pos = uleb(data, pos)
        for count in (direct_methods, virtual_methods):
            method_index = 0
            for _ in range(count):
                delta, pos = uleb(data, pos)
                method_index += delta
                flags, pos = uleb(data, pos)
                code, pos = uleb(data, pos)
                method = method_ids[method_index]
                if method[0] != owner:
                    raise ValueError("DEX method owner does not match class definition")
                # JNI needs a real public static method. A method_id is only a
                # reference and can survive even when the implementation is gone.
                if flags & 0x9 != 0x9 or flags & 0x500 or not code:
                    continue
                if code + 16 > len(data):
                    raise ValueError("truncated DEX code item")
                instructions = struct.unpack_from("<I", data, code + 12)[0]
                if not instructions or code + 16 + 2 * instructions > len(data):
                    raise ValueError("missing or truncated DEX method bytecode")
                methods.append(method)
    return classes, methods, types


def main(path):
    with zipfile.ZipFile(path) as apk:
        dexes = [name for name in apk.namelist()
                 if re.fullmatch(r"classes(?:[0-9]+)?\.dex", name)]
        if not dexes:
            raise ValueError("APK contains no DEX files")
        classes, methods, types = set(), [], set()
        for name in dexes:
            defined, implemented, references = dex_symbols(apk.read(name))
            classes.update(defined)
            methods.extend(implemented)
            types.update(references)
    bridge = "Lcom/cybermanju/os/CybermanjuVoiceServices;"
    expected = (bridge, "dispatch",
                "Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;", "Ljava/lang/String;")
    if bridge not in classes:
        raise ValueError("missing JNI bridge class " + bridge)
    if expected not in methods:
        raise ValueError("missing exact JNI method dispatch(Activity,String,String):String with public static bytecode")
    home_bridge = "Lcom/cybermanju/os/CybermanjuHomeRole;"
    home_expected = (
        (home_bridge, "dispatch", "Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;", "Ljava/lang/String;"),
        (home_bridge, "onWebViewCreated", "Landroid/app/Activity;Landroid/webkit/WebView;", "V"),
        (home_bridge, "onResume", "Landroid/app/Activity;Landroid/webkit/WebView;", "V"),
        (home_bridge, "onPause", "Landroid/app/Activity;", "V"),
        (home_bridge, "onDestroy", "Landroid/app/Activity;", "V"),
    )
    if home_bridge not in classes:
        raise ValueError("missing JNI bridge class " + home_bridge)
    missing_home_methods = [method for method in home_expected if method not in methods]
    if missing_home_methods:
        raise ValueError("missing exact Home role JNI/lifecycle methods: " + repr(missing_home_methods))
    for engine in ("SpeechRecognizer", "tts/TextToSpeech"):
        if "Landroid/speech/" + engine + ";" not in types:
            raise ValueError(engine.split("/")[-1] + " type absent from DEX")
    print(f"Android voice APK OK: {path} ({len(dexes)} DEX files)")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("usage: check-android-voice-apk.py APK")
        main(sys.argv[1])
    except (OSError, ValueError, IndexError, zipfile.BadZipFile, struct.error) as error:
        print("check-android-voice-apk: " + str(error), file=sys.stderr)
        sys.exit(1)
