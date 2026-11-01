#!/usr/bin/env python3
"""Verify a Ren'Py Web candidate contains optimized art but no upstream renders."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

from PIL import Image


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"Invalid Ren'Py Web candidate: {message}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--project", type=Path, required=True, help="prepared Ren'Py project root")
    args = parser.parse_args()
    candidate = args.candidate.resolve()
    project = args.project.resolve()
    images = project / "game" / "images"
    packaged_images = candidate / "game" / "images"
    zip_path = candidate / "game.zip"

    for name in ("index.html", "game.zip", "renpy.js", "renpy.wasm", "renpy.data"):
        path = candidate / name
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"missing required web runtime file {name}")
    if (images / "masters").exists() or (packaged_images / "masters").exists():
        fail("upstream masters/renders remain in the prepared project or progressive output")
    if list(packaged_images.rglob("*.png")) or list(packaged_images.rglob("*.glb")):
        fail("PNG/GLB assets remain under game/images in the progressive output")

    story = (project / "game" / "script.rpy").read_text(encoding="utf-8")
    gallery = (project / "game" / "technosutra_masters.rpy").read_text(encoding="utf-8")
    if re.search(r"image\s+(?:master_ch|gallery_master)_\d{2}_provisional", story + gallery):
        fail("generated scripts still declare upstream render images")
    if re.search(r"models/model\d+\.glb|masters/(?:sprites|source)/", story + gallery):
        fail("generated scripts still reference upstream paths")

    manifest_path = images / "optimized" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assets = manifest.get("assets", [])
    if manifest.get("count") != 56 or len(assets) != 56:
        fail("optimized-image manifest must list exactly 56 chapter backgrounds")
    if len(list((packaged_images / "optimized").glob("bg_ch*.jpg"))) != 56:
        fail("progressive output must contain exactly 56 optimized backgrounds")

    expected: dict[str, tuple[str, int, int, int]] = {}
    for asset in assets:
        relative = f"images/optimized/{asset['file']}"
        expected[relative] = (asset["sha256"], asset["sizeBytes"], 1920, 1080)
    intro = images / "bg_intro_scene.jpg"
    if not intro.is_file():
        fail("independent opening background is missing from prepared project")
    with Image.open(intro) as opening:
        if opening.format != "JPEG":
            fail("opening background must remain JPEG")
        intro_width, intro_height = opening.size
    expected["images/bg_intro_scene.jpg"] = (sha256_file(intro), intro.stat().st_size, intro_width, intro_height)

    for relative, (expected_hash, expected_size, width, height) in expected.items():
        path = candidate / "game" / relative
        if not path.is_file() or path.stat().st_size != expected_size:
            fail(f"progressive asset missing or wrong size: {relative}")
        if sha256_file(path) != expected_hash:
            fail(f"progressive asset SHA-256 mismatch: {relative}")
        with Image.open(path) as image:
            if image.format not in {"JPEG", "JPG"} or image.size != (width, height):
                fail(f"progressive image format/dimensions mismatch: {relative}")

    remote_list_name = "game/renpyweb_remote_files.txt"
    with ZipFile(zip_path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            fail(f"ZIP CRC failure in member {corrupt}")
        names = archive.namelist()
        if len(names) < 100:
            fail(f"ZIP has only {len(names)} entries")
        prohibited = [
            name for name in names
            if re.search(r"(?:^|/)masters/(?:source|sprites)/", name)
            or re.search(r"(?:^|/)master_ch\d{2}_provisional\.png$", name)
            or name.lower().endswith(".glb")
        ]
        if prohibited:
            fail("upstream renders/captures or GLB files are in game.zip: " + ", ".join(prohibited[:5]))
        if "game/images/optimized/manifest.json" not in names:
            fail("optimized-art manifest is missing from game.zip")
        if archive.read("game/images/optimized/manifest.json") != manifest_path.read_bytes():
            fail("optimized-art manifest in game.zip differs from the validated manifest")
        try:
            lines = archive.read(remote_list_name).decode("utf-8").splitlines()
        except KeyError:
            fail("game/renpyweb_remote_files.txt is missing")
        if len(lines) % 2:
            fail("remote-file list has an incomplete path/metadata pair")
        remote = dict(zip(lines[0::2], lines[1::2]))
        for relative, (_digest, _size, width, height) in expected.items():
            if remote.get(relative) != f"image {width},{height}":
                fail(f"remote-file list lacks expected optimized image: {relative}")
        if any("masters/" in path or "master_ch" in path for path in remote):
            fail("remote-file list still exposes upstream render paths")
        if any(name.startswith("_placeholders/images/masters/") for name in names):
            fail("Ren'Py generated placeholders for excluded upstream render assets")

    print("PASS: ZIP integrity; no upstream render, capture, sprite, placeholder, GLB, or provenance files in package")
    print("PASS: 56 optimized backgrounds plus independent opening image match progressive-file hashes and dimensions")
    print(f"Payload: optimized backgrounds {manifest['optimizedBytes']:,} bytes; upstream render assets packaged: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
