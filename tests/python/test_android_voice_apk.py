"""Deterministic contract tests for scripts/check-android-voice-apk.py."""
import os
import struct
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/check-android-voice-apk.py"
BRIDGE = "Lcom/cybermanju/os/CybermanjuVoiceServices;"
ACTIVITY = "Landroid/app/Activity;"
STRING = "Ljava/lang/String;"
SPEECH = "Landroid/speech/SpeechRecognizer;"
TTS = "Landroid/speech/tts/TextToSpeech;"
EXPECTED = ("dispatch", [ACTIVITY, STRING, STRING], STRING)
ACC_PUBLIC = 0x1
ACC_STATIC = 0x8


def uleb(value):
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7f) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def make_dex(method=EXPECTED, access=ACC_PUBLIC | ACC_STATIC, code_off=1,
             defined=True, include_apis=True, include_home=True,
             home_methods=None, home_access=None, home_code=True):
    """Build DEX symbol tables with VoiceServices and HOME JNI methods."""
    home_bridge = "Lcom/cybermanju/os/CybermanjuHomeRole;"
    webview = "Landroid/webkit/WebView;"
    # Each class record keeps method-id references separately from code bodies:
    # defined controls membership in class_data; has_code controls code_off.
    home = home_methods if home_methods is not None else [
        ("dispatch", [ACTIVITY, STRING, STRING], STRING),
        ("onWebViewCreated", [ACTIVITY, webview], "V"),
        ("onResume", [ACTIVITY, webview], "V"),
        ("onPause", [ACTIVITY], "V"), ("onDestroy", [ACTIVITY], "V")]
    voice = method or EXPECTED
    class_methods = [(BRIDGE, [voice], [access], [defined], [bool(code_off)])]
    if include_home:
        home_access_flags = home_access or [ACC_PUBLIC | ACC_STATIC] * len(home)
        class_methods.append((home_bridge, home, home_access_flags,
                              [True] * len(home), [home_code] * len(home)))

    # DEX tables: types, prototypes, method IDs, class definitions, and data.
    types = list(dict.fromkeys(
        [BRIDGE, home_bridge, ACTIVITY, STRING, webview, "V"]
        + ([SPEECH, TTS] if include_apis else [])
        + [descriptor for _, methods, _, _, _ in class_methods
           for _, args, result in methods for descriptor in args + [result]]
    ))
    prototypes = list(dict.fromkeys(
        (tuple(args), result)
        for _, methods, _, _, _ in class_methods
        for _, args, result in methods
    ))
    method_specs = sorted(
        (owner, name, tuple(args), result)
        for owner, methods, _, _, _ in class_methods
        for name, args, result in methods
    )
    strings = list(dict.fromkeys(
        types + [name for _, name, _, _ in method_specs]
    ))
    string_index = {value: index for index, value in enumerate(strings)}
    type_index = {value: index for index, value in enumerate(types)}
    proto_index = {value: index for index, value in enumerate(prototypes)}
    method_index = {value: index for index, value in enumerate(method_specs)}

    string_ids_off = 112
    type_ids_off = string_ids_off + 4 * len(strings)
    proto_ids_off = type_ids_off + 4 * len(types)
    method_ids_off = proto_ids_off + 12 * len(prototypes)
    class_defs_off = method_ids_off + 8 * len(method_specs)
    data_off = class_defs_off + 32 * len(class_methods)

    data = bytearray()
    string_data_offsets = []
    for value in strings:
        string_data_offsets.append(data_off + len(data))
        data += uleb(len(value)) + value.encode() + b"\0"

    # Parameter type lists referenced from prototypes.
    type_list_offsets = {}
    for args, result in prototypes:
        type_list_offsets[(args, result)] = data_off + len(data) if args else 0
        if args:
            data += struct.pack("<I", len(args))
            data += b"".join(struct.pack("<H", type_index[arg]) for arg in args)

    # Emit code items independently of class_data method definitions.
    code_items = bytearray()
    code_offsets = {}
    for owner, methods, _, _, code_flags in class_methods:
        for (name, args, result), has_code in zip(methods, code_flags):
            if has_code:
                key = (owner, name, tuple(args), result)
                code_offsets[key] = data_off + len(data) + len(code_items)
                code_items += struct.pack("<HHHHIIH", 1, 0, 0, 0, 0, 1, 0x000e)
    data += code_items

    class_data_offsets = []
    for owner, methods, access_flags, defined_flags, _ in class_methods:
        class_data_offsets.append(data_off + len(data))
        entries = sorted(
            (method_index[(owner, name, tuple(args), result)], access, code_offsets.get((owner, name, tuple(args), result), 0))
            for (name, args, result), access, is_defined
            in zip(methods, access_flags, defined_flags) if is_defined
        )
        # static_fields_size, instance_fields_size, direct_methods_size,
        # virtual_methods_size; method_idx values are encoded as deltas.
        data += uleb(0) + uleb(0) + uleb(len(entries)) + uleb(0)
        previous_method_index = 0
        for index, access, code_offset in entries:
            data += uleb(index - previous_method_index) + uleb(access) + uleb(code_offset)
            previous_method_index = index

    dex = bytearray(data_off) + data
    file_size = len(dex)
    struct.pack_into("<8sI", dex, 0, b"dex\n035\0", 0)
    struct.pack_into("<I", dex, 32, file_size)
    struct.pack_into("<I", dex, 36, 112)
    struct.pack_into("<I", dex, 40, 0x12345678)
    # Header size/count/offset pairs for each relevant DEX identifier table.
    header_tables = [
        (52, 0, 0), (56, len(strings), string_ids_off),
        (64, len(types), type_ids_off), (72, len(prototypes), proto_ids_off),
        (80, 0, 0), (88, len(method_specs), method_ids_off),
        (96, len(class_methods), class_defs_off),
        (104, file_size - data_off, data_off),
    ]
    for position, count, offset in header_tables:
        struct.pack_into("<II", dex, position, count, offset)
    for index, offset in enumerate(string_data_offsets):
        struct.pack_into("<I", dex, string_ids_off + 4 * index, offset)
    for index, descriptor in enumerate(types):
        struct.pack_into("<I", dex, type_ids_off + 4 * index, string_index[descriptor])
    for index, (args, result) in enumerate(prototypes):
        struct.pack_into("<III", dex, proto_ids_off + 12 * index,
                         string_index[result], type_index[result],
                         type_list_offsets[(args, result)])
    for index, (owner, name, args, result) in enumerate(method_specs):
        struct.pack_into("<HHI", dex, method_ids_off + 8 * index,
                         type_index[owner], proto_index[(args, result)], string_index[name])
    for index, (owner, _, _, _, _) in enumerate(class_methods):
        struct.pack_into("<8I", dex, class_defs_off + 32 * index,
                         type_index[owner], 1, 0xffffffff, 0, 0, 0,
                         class_data_offsets[index], 0)
    return bytes(dex)


class AndroidVoiceApkTests(unittest.TestCase):
    def run_checker(self, dex=None, apk_kind="valid"):
        with tempfile.TemporaryDirectory(prefix="voice-apk-") as temp:
            apk = Path(temp) / "fixture.apk"
            if apk_kind == "valid":
                with zipfile.ZipFile(apk, "w") as zf:
                    zf.writestr("classes.dex", dex if dex is not None else make_dex())
            elif apk_kind == "no-dex":
                with zipfile.ZipFile(apk, "w") as zf:
                    zf.writestr("not-dex.txt", "fixture")
            elif apk_kind == "malformed-zip":
                apk.write_bytes(b"not a zip archive")
            return subprocess.run(["python3", str(CHECKER), str(apk)], cwd=ROOT,
                                  text=True, capture_output=True, check=False)

    def assert_rejected(self, **kwargs):
        result = self.run_checker(**kwargs)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("check-android-voice-apk:", result.stderr)

    def test_exact_defined_public_static_method_and_apis_pass(self):
        result = self.run_checker(dex=make_dex())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Android voice APK OK", result.stdout)

    def test_wrong_signature_is_rejected(self):
        self.assert_rejected(dex=make_dex(method=("dispatch", [STRING], STRING)))

    def test_method_id_reference_without_definition_is_rejected(self):
        self.assert_rejected(dex=make_dex(defined=False))

    def test_requires_public_and_static_access_flags(self):
        self.assert_rejected(dex=make_dex(access=ACC_PUBLIC))
        self.assert_rejected(dex=make_dex(access=ACC_STATIC))

    def test_requires_nonzero_code_offset(self):
        self.assert_rejected(dex=make_dex(code_off=0))

    def test_required_speech_apis_must_be_present(self):
        self.assert_rejected(dex=make_dex(include_apis=False))

    def test_missing_home_bridge_is_rejected(self):
        self.assert_rejected(dex=make_dex(include_home=False))

    def test_home_wrong_signature_is_rejected(self):
        home = [("dispatch", [ACTIVITY, STRING], STRING)] + [
            ("onWebViewCreated", [ACTIVITY, "Landroid/webkit/WebView;"], "V"),
            ("onResume", [ACTIVITY, "Landroid/webkit/WebView;"], "V"),
            ("onPause", [ACTIVITY], "V"), ("onDestroy", [ACTIVITY], "V")]
        self.assert_rejected(dex=make_dex(home_methods=home))

    def test_home_requires_public_static_and_implemented_methods(self):
        access = [ACC_PUBLIC | ACC_STATIC] * 5
        access[0] = ACC_PUBLIC
        self.assert_rejected(dex=make_dex(home_access=access))
        access[0] = ACC_STATIC
        self.assert_rejected(dex=make_dex(home_access=access))
        self.assert_rejected(dex=make_dex(home_code=False))

    def test_absent_and_malformed_dex_are_rejected(self):
        self.assert_rejected(apk_kind="no-dex")
        self.assert_rejected(apk_kind="malformed-zip")
        self.assert_rejected(dex=b"dex\n")


if __name__ == "__main__":
    unittest.main()
