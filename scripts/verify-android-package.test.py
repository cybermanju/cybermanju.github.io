#!/usr/bin/env python3
# CyberManju OS — Android package verifier tests (scripts/verify-android-package.test.py).
# Role: exercise ZIP structure, ABI, ELF alignment, and APK/AAB consistency.
# Exports: unittest suite for verify-android-package.py.
# Integrates: temporary ZIP fixtures and Python standard library only.
# Contracts: synthetic payload fixtures test structure, ELF loads, and native parity.
import sys
sys.dont_write_bytecode = True

import importlib.util
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify-android-package.py")
spec = importlib.util.spec_from_file_location("android_package_verifier", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

LIB = "lib/arm64-v8a/libcybermanju_os_lib.so"
AAB_LIB = "base/" + LIB
APK_REQUIRED = ("AndroidManifest.xml", "classes.dex")
AAB_REQUIRED = ("BundleConfig.pb", "base/manifest/AndroidManifest.xml", "base/dex/classes.dex")


def make_elf(machine=183, alignment=16384):
    data = bytearray(120)
    data[:16] = b"\x7fELF" + bytes((2, 1, 1)) + bytes(9)
    struct.pack_into("<HHI", data, 16, 3, machine, 1)
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<HHH", data, 52, 64, 56, 1)
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0, 0, 120, 120, alignment)
    return bytes(data)


def aligned_extra(current_size, name):
    required = (-(current_size + 30 + len(name.encode("utf-8")))) % 16384
    if not required:
        return b""
    if required < 4:
        required += 16384
    return struct.pack("<HH", 0xCAFE, required - 4) + bytes(required - 4)


def create_package(path, *, apk=True, libraries=None, stored=True, aligned=True,
                   required_overrides=None, extra_entries=(), duplicate=()):
    path.parent.mkdir(parents=True, exist_ok=True)
    required = APK_REQUIRED if apk else AAB_REQUIRED
    contents = {name: b"required" for name in required}
    if required_overrides:
        contents.update(required_overrides)
    libraries = { (LIB if apk else AAB_LIB): make_elf() } if libraries is None else libraries
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in contents.items():
            zf.writestr(name, data)
        for name, data in libraries.items():
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            if aligned and stored and apk:
                info.extra = aligned_extra(zf.fp.tell(), name)
            zf.writestr(info, data)
        for name, data in extra_entries:
            zf.writestr(name, data)
        for name, data in duplicate:
            zf.writestr(name, data)


class PackageVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.apk = self.root / "app.apk"
        self.aab = self.root / "app.aab"

    def tearDown(self):
        self.temp.cleanup()

    def packages(self, apk_lib=None, aab_lib=None, *, apk_libraries=None, aab_libraries=None,
                 stored=True, aligned=True):
        apk_map = apk_libraries if apk_libraries is not None else {LIB: make_elf() if apk_lib is None else apk_lib}
        aab_map = aab_libraries if aab_libraries is not None else {AAB_LIB: apk_map[LIB] if aab_lib is None else aab_lib}
        create_package(self.apk, libraries=apk_map, stored=stored, aligned=aligned)
        create_package(self.aab, apk=False, libraries=aab_map, stored=False)

    def assert_invalid(self, message):
        with self.assertRaisesRegex(verifier.VerificationError, message):
            verifier.verify(self.root)

    def test_valid_packages(self):
        self.packages()
        verifier.verify(self.root)

    def test_missing_native_library(self):
        create_package(self.apk, libraries={})
        create_package(self.aab, apk=False)
        self.assert_invalid("missing lib/arm64-v8a")

    def test_wrong_abi(self):
        create_package(self.apk, libraries={"lib/x86_64/libcybermanju_os_lib.so": make_elf()})
        create_package(self.aab, apk=False)
        self.assert_invalid("unexpected native ABI")

    def test_apk_rejects_bundle_native_prefix(self):
        create_package(self.apk, libraries={AAB_LIB: make_elf()})
        create_package(self.aab, apk=False)
        self.assert_invalid("wrong package prefix")

    def test_aab_rejects_apk_native_prefix(self):
        create_package(self.apk)
        create_package(self.aab, apk=False, libraries={LIB: make_elf()})
        self.assert_invalid("wrong package prefix")

    def test_missing_and_empty_apk_structural_entries(self):
        for entry, content, expected in [("classes.dex", None, "missing classes.dex"),
                                         ("AndroidManifest.xml", b"", "empty AndroidManifest.xml")]:
            with self.subTest(entry=entry):
                create_package(self.apk)
                create_package(self.aab, apk=False)
                if content is None:
                    with zipfile.ZipFile(self.apk, "r") as source:
                        rows = [(i.filename, source.read(i)) for i in source.infolist()
                                if i.filename != entry]
                    with zipfile.ZipFile(self.apk, "w") as target:
                        for name, data in rows:
                            target.writestr(name, data)
                else:
                    with zipfile.ZipFile(self.apk, "r") as source:
                        rows = [(i.filename, source.read(i)) for i in source.infolist()
                                if i.filename != entry]
                    with zipfile.ZipFile(self.apk, "w") as target:
                        for name, data in rows:
                            target.writestr(name, data)
                        target.writestr(entry, content)
                self.assert_invalid(expected)

    def test_aab_requires_all_nonempty_structure_entries(self):
        for entry in AAB_REQUIRED:
            with self.subTest(entry=entry):
                values = {entry: b""}
                create_package(self.apk)
                create_package(self.aab, apk=False, required_overrides=values)
                self.assert_invalid(f"empty {entry}")
                create_package(self.aab, apk=False)
                with zipfile.ZipFile(self.aab, "r") as source:
                    rows = [(i.filename, source.read(i)) for i in source.infolist() if i.filename != entry]
                with zipfile.ZipFile(self.aab, "w") as target:
                    for name, data in rows:
                        target.writestr(name, data)
                self.assert_invalid(f"missing {entry}")

    def test_duplicate_required_members_rejected(self):
        create_package(self.apk, duplicate=[("classes.dex", b"another")])
        create_package(self.aab, apk=False)
        self.assert_invalid("duplicate required entry classes.dex")

    def test_duplicate_native_library_rejected(self):
        create_package(self.apk, duplicate=[(LIB, make_elf())])
        create_package(self.aab, apk=False)
        self.assert_invalid("duplicate native library")

    def test_wrong_machine_and_alignment(self):
        for lib, pattern in [(make_elf(machine=62), "ET_DYN AArch64"),
                             (make_elf(alignment=4096), "below 16384")]:
            with self.subTest(pattern=pattern):
                self.packages(apk_lib=lib)
                self.assert_invalid(pattern)

    def test_truncated_and_incongruent_load_segment(self):
        truncated = bytearray(make_elf())
        struct.pack_into("<QQ", truncated, 64 + 32, len(truncated) + 1, len(truncated) + 1)
        incongruent = bytearray(make_elf())
        struct.pack_into("<Q", incongruent, 64 + 16, 1)
        for lib, pattern in [(bytes(truncated), "truncated or has invalid sizes"),
                             (bytes(incongruent), "incongruent")]:
            with self.subTest(pattern=pattern):
                self.packages(apk_lib=lib)
                self.assert_invalid(pattern)

    def test_misaligned_stored_library(self):
        self.packages(aligned=False)
        self.assert_invalid("data offset .* not 16384-byte aligned")

    def test_extra_library_validated_independently(self):
        apk_libs = {LIB: make_elf(), "lib/arm64-v8a/libextra.so": make_elf(alignment=4096)}
        aab_libs = {AAB_LIB: apk_libs[LIB], "base/lib/arm64-v8a/libextra.so": apk_libs["lib/arm64-v8a/libextra.so"]}
        self.packages(apk_libraries=apk_libs, aab_libraries=aab_libs)
        self.assert_invalid("below 16384")

    def test_extra_library_set_must_match(self):
        self.packages(apk_libraries={LIB: make_elf(), "lib/arm64-v8a/libextra.so": make_elf()})
        self.assert_invalid("set/bytes do not exactly match")

    def test_mismatched_native_bytes(self):
        changed = bytearray(make_elf())
        changed[9] ^= 1
        self.packages(aab_lib=bytes(changed))
        self.assert_invalid("set/bytes do not exactly match")

    def test_each_aab_must_match_an_apk_and_validate_extra_bundle(self):
        self.packages()
        create_package(self.root / "extra.aab", apk=False,
                       libraries={AAB_LIB: make_elf(alignment=4096)})
        self.assert_invalid("below 16384")

    def test_multiple_bundle_exact_matching(self):
        self.packages()
        create_package(self.root / "other.apk", libraries={LIB: make_elf()})
        create_package(self.root / "other.aab", apk=False, libraries={AAB_LIB: make_elf()})
        verifier.verify(self.root)

    def test_corrupt_zip_and_missing_aab(self):
        self.packages()
        self.apk.write_bytes(b"not a zip")
        self.assert_invalid("invalid ZIP container")
        self.apk.unlink()
        create_package(self.root / "replacement.apk")
        self.aab.unlink()
        self.assert_invalid("no AAB found")

    def test_compressed_library_needs_no_zip_local_alignment(self):
        self.packages(stored=False, aligned=False)
        verifier.verify(self.root)

    def test_library_only_aab_cannot_match_valid_apk(self):
        create_package(self.apk)
        with zipfile.ZipFile(self.aab, "w") as zf:
            zf.writestr(AAB_LIB, make_elf())
        self.assert_invalid("missing BundleConfig.pb")

    def test_all_required_entries_missing_empty_and_duplicate(self):
        for apk, required in ((True, APK_REQUIRED), (False, AAB_REQUIRED)):
            path = self.apk if apk else self.aab
            for entry in required:
                for mode in ("missing", "empty", "duplicate"):
                    with self.subTest(apk=apk, entry=entry, mode=mode):
                        self.packages(stored=False)
                        with zipfile.ZipFile(path) as source:
                            rows = [(i.filename, source.read(i)) for i in source.infolist()
                                    if i.filename != entry]
                        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as target:
                            for name, data in rows:
                                target.writestr(name, data)
                            if mode == "empty":
                                target.writestr(entry, b"")
                            elif mode == "duplicate":
                                target.writestr(entry, b"required")
                                target.writestr(entry, b"required")
                        self.assert_invalid(f"{mode} .*{entry}")

    def test_each_structurally_valid_aab_must_match_an_apk(self):
        self.packages()
        changed = bytearray(make_elf())
        changed[9] ^= 1
        create_package(self.root / "unmatched.aab", apk=False,
                       libraries={AAB_LIB: bytes(changed)})
        self.assert_invalid("unmatched.aab: native library set/bytes do not exactly match any APK")

    def test_aab_payload_is_checked_despite_another_matching_aab(self):
        for payload, message in ((b"not ELF", "not a complete ELF"),
                                 (make_elf(machine=62), "ET_DYN AArch64")):
            with self.subTest(message=message):
                self.packages()
                create_package(self.root / "invalid.aab", apk=False,
                               libraries={AAB_LIB: payload})
                self.assert_invalid(message)

    def test_explicit_native_directory_records_are_valid(self):
        create_package(self.apk, extra_entries=[("lib/", b""), ("lib/arm64-v8a/", b"")])
        create_package(self.aab, apk=False,
                       extra_entries=[("base/lib/", b""), ("base/lib/arm64-v8a/", b"")])
        verifier.verify(self.root)

    def test_malformed_native_paths_and_wrong_abi_directories(self):
        for name, message in (("base/lib/arm64-v8a/nested/extra.so", "malformed native"),
                              ("base/lib/x86/", "unexpected native ABI")):
            with self.subTest(name=name):
                self.packages()
                create_package(self.aab, apk=False, extra_entries=[(name, make_elf())])
                self.assert_invalid(message)


if __name__ == "__main__":
    unittest.main()
