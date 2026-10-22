"""Clipboard APK gate and Android installer contract tests."""
import importlib.util
import struct
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST_FIXTURE = ROOT / "tests/python/test_android_voice_apk.py"
spec = importlib.util.spec_from_file_location("voice_apk_fixtures", TEST_FIXTURE)
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)
CHECKER = ROOT / "scripts/check-android-clipboard-apk.py"
INSTALLER = ROOT / "scripts/android-voice-services.py"
BRIDGE = "Lcom/cybermanju/os/CybermanjuClipboard;"
ACTIVITY = "Landroid/app/Activity;"
STRING = "Ljava/lang/String;"
CLIPBOARD = "Landroid/content/ClipboardManager;"
EXPECTED = ("dispatch", [ACTIVITY, STRING, STRING], STRING)
ANDROID = "http://schemas.android.com/apk/res/android"


def make_clipboard_dex(method=EXPECTED, access=voice.ACC_PUBLIC | voice.ACC_STATIC,
                       code_off=1, defined=True, include_clipboard=True):
    """Adapt the shared DEX builder's tables for the clipboard bridge's symbols."""
    descriptors = [BRIDGE, ACTIVITY, STRING]
    if include_clipboard:
        descriptors.append(CLIPBOARD)
    name, args, result = method or ("dispatch", [ACTIVITY, STRING, STRING], STRING)
    descriptors += args + [result]
    types = list(dict.fromkeys(descriptors))
    string_values = list(dict.fromkeys(types + [name]))
    string_index = {s: i for i, s in enumerate(string_values)}
    type_index = {s: i for i, s in enumerate(types)}
    string_off = 112
    type_off = string_off + 4 * len(string_values)
    proto_off = type_off + 4 * len(types)
    method_off = proto_off + 12
    class_off = method_off + 8
    data_off = class_off + 32
    buf = bytearray(data_off)
    string_data, string_offsets = bytearray(), []
    for value in string_values:
        string_offsets.append(data_off + len(string_data))
        encoded = value.encode("utf-8")
        string_data += voice.uleb(len(value)) + encoded + b"\0"
    param_off = data_off + len(string_data)
    type_list = struct.pack("<I", len(args)) + b"".join(struct.pack("<H", type_index[x]) for x in args)
    class_data_off = param_off + len(type_list)
    method_idx = 0
    def class_data(offset):
        item = voice.uleb(0) + voice.uleb(0) + voice.uleb(1 if defined else 0) + voice.uleb(0)
        return item + (voice.uleb(method_idx) + voice.uleb(access) + voice.uleb(offset) if defined else b"")
    encoded_class = class_data(code_off)
    if defined and code_off:
        actual = class_data_off + len(encoded_class)
        while True:
            encoded_class = class_data(actual)
            next_offset = class_data_off + len(encoded_class)
            if next_offset == actual:
                break
            actual = next_offset
        code = struct.pack("<HHHHIIH", 1, 0, 0, 0, 0, 1, 0x000e)
    else:
        code = b""
    buf.extend(string_data + type_list + encoded_class + code)
    file_size = len(buf)
    struct.pack_into("<8sI", buf, 0, b"dex\n035\0", 0)
    struct.pack_into("<I", buf, 32, file_size)
    struct.pack_into("<I", buf, 36, 112)
    struct.pack_into("<I", buf, 40, 0x12345678)
    struct.pack_into("<II", buf, 56, len(string_values), string_off)
    struct.pack_into("<II", buf, 64, len(types), type_off)
    struct.pack_into("<II", buf, 72, 1, proto_off)
    struct.pack_into("<II", buf, 88, 1, method_off)
    struct.pack_into("<II", buf, 96, 1, class_off)
    for i, offset in enumerate(string_offsets):
        struct.pack_into("<I", buf, string_off + 4 * i, offset)
    for i, value in enumerate(types):
        struct.pack_into("<I", buf, type_off + 4 * i, string_index[value])
    struct.pack_into("<III", buf, proto_off, string_index[result], type_index[result], param_off)
    struct.pack_into("<HHI", buf, method_off, type_index[BRIDGE], 0, string_index[name])
    struct.pack_into("<8I", buf, class_off, type_index[BRIDGE], 1, 0xffffffff, 0, 0, 0, class_data_off, 0)
    return bytes(buf)


class AndroidClipboardTests(unittest.TestCase):
    def run_checker(self, dex=None, apk_kind="valid"):
        with tempfile.TemporaryDirectory(prefix="clipboard-apk-") as temp:
            apk = Path(temp) / "fixture.apk"
            if apk_kind == "valid":
                with zipfile.ZipFile(apk, "w") as archive:
                    archive.writestr("classes.dex", dex if dex is not None else make_clipboard_dex())
            elif apk_kind == "no-dex":
                with zipfile.ZipFile(apk, "w") as archive:
                    archive.writestr("not-dex.txt", "fixture")
            elif apk_kind == "malformed-zip":
                apk.write_bytes(b"not a zip archive")
            return subprocess.run(["python3", str(CHECKER), str(apk)], cwd=ROOT,
                                  text=True, capture_output=True, check=False)

    def rejected(self, **kwargs):
        result = self.run_checker(**kwargs)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("check-android-clipboard-apk:", result.stderr)

    def make_android_project(self, root):
        main = root / "app/src/main/java/com/cybermanju/os"
        main.mkdir(parents=True)
        (main / "MainActivity.kt").write_text("package com.cybermanju.os\nclass MainActivity\n", encoding="utf-8")
        (root / "app/src/main/AndroidManifest.xml").write_text(
            '<manifest xmlns:android="%s"><application /></manifest>' % ANDROID, encoding="utf-8")
        (root / "app/build.gradle.kts").write_text(
            'android { buildTypes { release { isMinifyEnabled = true } } }\n', encoding="utf-8")

    def test_installer_adds_clipboard_source_and_r8_keep_idempotently(self):
        with tempfile.TemporaryDirectory(prefix="clipboard-install-") as temp:
            project = Path(temp)
            self.make_android_project(project)
            first = subprocess.run(["python3", str(INSTALLER), str(project)], cwd=ROOT,
                                   text=True, capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            gradle = (project / "app/build.gradle.kts").read_text(encoding="utf-8")
            rules_path = project / "app/cybermanju-voice.pro"
            rules = rules_path.read_text(encoding="utf-8")
            expected_rule = "-keep class com.cybermanju.os.CybermanjuClipboard { public static java.lang.String dispatch(android.app.Activity,java.lang.String,java.lang.String); }"
            self.assertIn('proguardFiles("cybermanju-voice.pro")', gradle)
            self.assertIn(expected_rule, rules)
            self.assertTrue((project / "app/src/main/java/com/cybermanju/os/CybermanjuClipboard.kt").is_file())
            snapshot = {path: path.read_bytes() for path in project.rglob("*") if path.is_file()}
            second = subprocess.run(["python3", str(INSTALLER), str(project)], cwd=ROOT,
                                    text=True, capture_output=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(snapshot, {path: path.read_bytes() for path in project.rglob("*") if path.is_file()})

    def test_exact_defined_public_static_method_and_clipboard_type_pass(self):
        result = self.run_checker(dex=make_clipboard_dex())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Android clipboard APK OK", result.stdout)

    def test_signature_bytecode_and_clipboard_type_are_required(self):
        self.rejected(dex=make_clipboard_dex(method=("dispatch", [STRING], STRING)))
        self.rejected(dex=make_clipboard_dex(defined=False))
        self.rejected(dex=make_clipboard_dex(access=voice.ACC_PUBLIC))
        self.rejected(dex=make_clipboard_dex(code_off=0))
        self.rejected(dex=make_clipboard_dex(include_clipboard=False))

    def test_no_dex_malformed_apk_and_malformed_dex_rejected(self):
        self.rejected(apk_kind="no-dex")
        self.rejected(apk_kind="malformed-zip")
        self.rejected(dex=b"dex\n")


if __name__ == "__main__":
    unittest.main()
