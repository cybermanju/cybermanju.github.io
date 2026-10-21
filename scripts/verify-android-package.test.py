#!/usr/bin/env python3
# CyberManju OS — Android package verifier tests (scripts/verify-android-package.test.py).
# Role: exercise archive, ABI, ELF alignment, and APK/AAB consistency checks.
# Exports: unittest suite for verify-android-package.py.
# Integrates: temporary ZIP fixtures and Python standard library only.
# Contracts: fixtures synthesize minimal valid ELF and aligned ZIP local entries.
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


def make_elf(machine=183, alignment=16384):
    data = bytearray(120)
    data[:16] = b"\x7fELF" + bytes((2, 1, 1)) + bytes(9)
    struct.pack_into("<HHI", data, 16, 3, machine, 1)
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<HHH", data, 52, 64, 56, 1)
    # PT_LOAD: offset 0, vaddr 0, filesz/memsz 120, p_align.
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0, 0, 120, 120, alignment)
    return bytes(data)


def aligned_extra(current_size, name):
    required = (-(current_size + 30 + len(name.encode("utf-8")))) % 16384
    if not required:
        return b""
    if required < 4:
        required += 16384
    return struct.pack("<HH", 0xCAFE, required - 4) + bytes(required - 4)


def create_package(path, *, apk=True, library=None, stored=True, aligned=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        if apk:
            zf.writestr("AndroidManifest.xml", b"manifest")
            zf.writestr("classes.dex", b"dex")
            name = LIB
        else:
            name = "base/" + LIB
        if library is not None:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            if aligned and stored:
                info.extra = aligned_extra(zf.fp.tell(), name)
            zf.writestr(info, library)


class PackageVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.apk = self.root / "app.apk"
        self.aab = self.root / "app.aab"

    def tearDown(self):
        self.temp.cleanup()

    def packages(self, apk_lib=None, aab_lib=None, *, stored=True, aligned=True):
        lib = make_elf() if apk_lib is None else apk_lib
        bundle = lib if aab_lib is None else aab_lib
        create_package(self.apk, library=lib, stored=stored, aligned=aligned)
        create_package(self.aab, apk=False, library=bundle, stored=False)

    def assert_invalid(self, message):
        with self.assertRaisesRegex(verifier.VerificationError, message):
            verifier.verify(self.root)

    def test_valid_packages(self):
        self.packages()
        verifier.verify(self.root)

    def test_missing_native_library(self):
        create_package(self.apk, library=None)
        create_package(self.aab, apk=False, library=make_elf(), stored=False)
        self.assert_invalid("missing lib/arm64-v8a")

    def test_wrong_abi(self):
        create_package(self.apk, library=None)
        with zipfile.ZipFile(self.apk, "a") as zf:
            zf.writestr("lib/x86_64/libcybermanju_os_lib.so", make_elf())
        create_package(self.aab, apk=False, library=make_elf(), stored=False)
        self.assert_invalid("unexpected native ABI")

    def test_wrong_machine(self):
        self.packages(apk_lib=make_elf(machine=62))
        self.assert_invalid("ET_DYN AArch64")

    def test_four_kib_elf_alignment(self):
        self.packages(apk_lib=make_elf(alignment=4096))
        self.assert_invalid("below 16384")

    def test_truncated_load_segment(self):
        lib = bytearray(make_elf())
        struct.pack_into("<QQ", lib, 64 + 32, len(lib) + 1, len(lib) + 1)
        self.packages(apk_lib=bytes(lib))
        self.assert_invalid("truncated or has invalid sizes")

    def test_incongruent_load_segment(self):
        lib = bytearray(make_elf())
        struct.pack_into("<Q", lib, 64 + 16, 1)
        self.packages(apk_lib=bytes(lib))
        self.assert_invalid("incongruent")

    def test_misaligned_stored_library(self):
        self.packages(aligned=False)
        self.assert_invalid("data offset .* not 16384-byte aligned")

    def test_missing_aab(self):
        create_package(self.apk, library=make_elf())
        self.assert_invalid("no AAB found")

    def test_mismatched_native_bytes(self):
        self.packages(aab_lib=make_elf()[:-1] + b"x")
        self.assert_invalid("do not match any AAB")

    def test_corrupt_zip(self):
        self.packages()
        self.apk.write_bytes(b"not a zip")
        self.assert_invalid("invalid ZIP container")

    def test_compressed_library_does_not_require_local_alignment(self):
        self.packages(stored=False, aligned=False)
        verifier.verify(self.root)


if __name__ == "__main__":
    unittest.main()
