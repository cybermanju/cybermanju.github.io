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
             defined=True, include_apis=True):
    """Build just enough valid DEX tables for the checker's symbol parser."""
    descriptors = [BRIDGE, ACTIVITY, STRING]
    if include_apis:
        descriptors += [SPEECH, TTS]
    name = method[0] if method else "dispatch"
    args = method[1] if method else [ACTIVITY, STRING, STRING]
    result = method[2] if method else STRING
    descriptors += args + [result]
    types = list(dict.fromkeys(descriptors))
    string_values = list(dict.fromkeys(types + [name]))
    string_index = {s: i for i, s in enumerate(string_values)}
    type_index = {s: i for i, s in enumerate(types)}
    # Header, string_ids, type_ids, proto_ids, method_ids, class_defs, then data.
    string_off = 112
    type_off = string_off + 4 * len(string_values)
    proto_off = type_off + 4 * len(types)
    method_off = proto_off + 12
    class_off = method_off + 8
    data_off = class_off + 32
    buf = bytearray(data_off)
    string_data = bytearray()
    string_offsets = []
    for value in string_values:
        string_offsets.append(data_off + len(string_data))
        encoded = value.encode("utf-8")
        string_data += uleb(len(value)) + encoded + b"\0"
    param_off = data_off + len(string_data)
    type_list = struct.pack("<I", len(args)) + b"".join(struct.pack("<H", type_index[x]) for x in args)
    class_data_off = param_off + len(type_list)
    # class_data_item: zero static/instance fields, one direct method, zero virtual methods.
    method_idx = 0
    def encode_class_data(offset):
        data = uleb(0) + uleb(0) + uleb(1 if defined else 0) + uleb(0)
        if defined:
            data += uleb(method_idx) + uleb(access) + uleb(offset)
        return data
    class_data = encode_class_data(code_off)
    if defined and code_off:
        actual_code_off = class_data_off + len(class_data)
        while True:
            updated = encode_class_data(actual_code_off)
            next_offset = class_data_off + len(updated)
            class_data = updated
            if next_offset == actual_code_off:
                break
            actual_code_off = next_offset
        # One-instruction body: return-void. A real implementation body is required.
        code_item = struct.pack("<HHHHIIH", 1, 0, 0, 0, 0, 1, 0x000e)
    else:
        code_item = b""
    buf.extend(string_data)
    buf.extend(type_list)
    buf.extend(class_data)
    buf.extend(code_item)
    file_size = len(buf)
    struct.pack_into("<8sI", buf, 0, b"dex\n035\0", 0)
    struct.pack_into("<I", buf, 32, file_size)
    struct.pack_into("<I", buf, 36, 112)
    struct.pack_into("<I", buf, 40, 0x12345678)
    struct.pack_into("<II", buf, 52, 0, 0)
    struct.pack_into("<II", buf, 56, len(string_values), string_off)
    struct.pack_into("<II", buf, 64, len(types), type_off)
    struct.pack_into("<II", buf, 72, 1, proto_off)
    struct.pack_into("<II", buf, 80, 0, 0)
    struct.pack_into("<II", buf, 88, 1, method_off)
    struct.pack_into("<II", buf, 96, 1, class_off)
    struct.pack_into("<II", buf, 104, file_size - data_off, data_off)
    for i, off in enumerate(string_offsets):
        struct.pack_into("<I", buf, string_off + 4 * i, off)
    for i, value in enumerate(types):
        struct.pack_into("<I", buf, type_off + 4 * i, string_index[value])
    struct.pack_into("<III", buf, proto_off, string_index[result], type_index[result], param_off)
    struct.pack_into("<HHI", buf, method_off, type_index[BRIDGE], 0, string_index[name])
    struct.pack_into("<8I", buf, class_off, type_index[BRIDGE], 1, 0xffffffff, 0, 0, 0, class_data_off, 0)
    return bytes(buf)


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

    def test_absent_and_malformed_dex_are_rejected(self):
        self.assert_rejected(apk_kind="no-dex")
        self.assert_rejected(apk_kind="malformed-zip")
        self.assert_rejected(dex=b"dex\n")


if __name__ == "__main__":
    unittest.main()
