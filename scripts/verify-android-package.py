#!/usr/bin/env python3
# CyberManju OS — Android package verifier (scripts/verify-android-package.py).
# Role: validate built APK/AAB contents and Android arm64 native-library packaging.
# Exports: command-line verification of Android build output archives.
# Integrates: Python standard library only; reads APK and AAB ZIP containers.
# Contracts: requires installable APK plus Play-upload AAB, arm64-v8a ELF64
#   ET_DYN libraries, 16 KiB ELF loads, and byte-identical APK/AAB native libs.

import argparse
import struct
import sys
import zipfile
from pathlib import Path

ALIGNMENT = 16_384
EXPECTED_ABI = "arm64-v8a"
EXPECTED_LIBRARY = "libcybermanju_os_lib.so"


class VerificationError(Exception):
    """A package is missing, malformed, or violates an Android packaging rule."""


def fail(message):
    raise VerificationError(message)


def archive(path):
    try:
        zf = zipfile.ZipFile(path)
        bad = zf.testzip()
        if bad is not None:
            zf.close()
            fail(f"{path}: corrupt ZIP member {bad}")
        return zf
    except (OSError, zipfile.BadZipFile, EOFError, RuntimeError) as exc:
        fail(f"{path}: invalid ZIP container: {exc}")


def native_entries(zf, path):
    result = {}
    for name in zf.namelist():
        library_path = name[5:] if name.startswith("base/lib/") else name
        if library_path.startswith("lib/"):
            parts = library_path.split("/")
            if len(parts) >= 2 and parts[1] and parts[1] != EXPECTED_ABI:
                fail(f"{path}: unexpected native ABI/path {name}")
            if len(parts) != 3 or not parts[2].endswith(".so"):
                continue
            if parts[2] in result:
                fail(f"{path}: duplicate native library {name}")
            result[parts[2]] = zf.getinfo(name)
    return result


def verify_elf(data, label):
    if len(data) < 64 or data[:4] != b"\x7fELF":
        fail(f"{label}: not a complete ELF file")
    if data[4] != 2 or data[5] != 1:
        fail(f"{label}: expected 64-bit little-endian ELF")
    try:
        e_type, machine = struct.unpack_from("<HH", data, 16)
        phoff = struct.unpack_from("<Q", data, 32)[0]
        ehsize, phentsize, phnum = struct.unpack_from("<HHH", data, 52)
    except struct.error:
        fail(f"{label}: truncated ELF header")
    if e_type != 3 or machine != 183:
        fail(f"{label}: expected ET_DYN AArch64 ELF (type={e_type}, machine={machine})")
    if ehsize < 64 or phentsize < 56 or phnum == 0 or phoff + phentsize * phnum > len(data):
        fail(f"{label}: invalid or truncated ELF program-header table")
    loads = 0
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type, = struct.unpack_from("<I", data, off)
        if p_type != 1:  # PT_LOAD
            continue
        loads += 1
        p_offset, p_vaddr = struct.unpack_from("<QQ", data, off + 8)
        p_filesz, p_memsz = struct.unpack_from("<QQ", data, off + 32)
        p_align = struct.unpack_from("<Q", data, off + 48)[0]
        if p_offset + p_filesz > len(data) or p_filesz > p_memsz:
            fail(f"{label}: PT_LOAD segment {i} is truncated or has invalid sizes")
        if p_align < ALIGNMENT or p_align & (p_align - 1):
            fail(f"{label}: PT_LOAD segment {i} alignment {p_align} is below {ALIGNMENT} or not a power of two")
        if p_offset % p_align != p_vaddr % p_align:
            fail(f"{label}: PT_LOAD segment {i} file offset and virtual address are incongruent")
    if not loads:
        fail(f"{label}: ELF has no PT_LOAD segments")


def stored_data_offset(zf, info, label):
    try:
        with open(zf.filename, "rb") as header:
            header.seek(info.header_offset)
            fixed = header.read(30)
            if len(fixed) != 30 or fixed[:4] != b"PK\x03\x04":
                fail(f"{label}: invalid ZIP local-file header")
            name_len, extra_len = struct.unpack_from("<HH", fixed, 26)
            return info.header_offset + 30 + name_len + extra_len
    except (OSError, zipfile.BadZipFile, AttributeError) as exc:
        fail(f"{label}: cannot inspect ZIP local-file header: {exc}")


def verify_apk(path, zf):
    for required in ("AndroidManifest.xml", "classes.dex"):
        try:
            data = zf.read(required)
        except KeyError:
            fail(f"{path}: missing {required}")
        if not data:
            fail(f"{path}: empty {required}")
    libs = native_entries(zf, path)
    if EXPECTED_LIBRARY not in libs:
        fail(f"{path}: missing lib/{EXPECTED_ABI}/{EXPECTED_LIBRARY}")
    for name, info in libs.items():
        if info.file_size <= 0:
            fail(f"{path}: empty native library {name}")
        data = zf.read(info)
        verify_elf(data, f"{path}: {name}")
        if info.compress_type == zipfile.ZIP_STORED:
            offset = stored_data_offset(zf, info, f"{path}: {name}")
            if offset % ALIGNMENT:
                fail(f"{path}: stored native library {name} data offset {offset} is not {ALIGNMENT}-byte aligned")
    return {name: zf.read(info) for name, info in libs.items()}


def verify(outputs):
    apks = sorted(outputs.rglob("*.apk"))
    aabs = sorted(outputs.rglob("*.aab"))
    if not apks:
        fail(f"{outputs}: no APK found (build must produce APK and AAB)")
    if not aabs:
        fail(f"{outputs}: no AAB found (build must produce APK and AAB)")
    opened = []
    try:
        apk_contents = []
        for path in apks:
            zf = archive(path)
            opened.append(zf)
            apk_contents.append((path, verify_apk(path, zf)))
        bundle_data = []
        for path in aabs:
            zf = archive(path)
            opened.append(zf)
            libs = native_entries(zf, path)
            bundle_data.append((path, {name: zf.read(info) for name, info in libs.items()}))
        for apk_path, apk_libs in apk_contents:
            matched = [path for path, libs in bundle_data if all(libs.get(name) == data for name, data in apk_libs.items())]
            if not matched:
                fail(f"{apk_path}: native library bytes do not match any AAB base/lib entry")
        for path in apks + aabs:
            print(f"{path}: {path.stat().st_size} bytes")
        print("Install the .apk; .aab is a Play upload bundle, not directly installable.")
    finally:
        for zf in opened:
            zf.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outputs_dir", nargs="?", default="src-tauri/gen/android/app/build/outputs", type=Path,
                        help="Android outputs directory (default: %(default)s)")
    args = parser.parse_args(argv)
    try:
        verify(args.outputs_dir)
    except VerificationError as exc:
        print(f"Android package verification failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
