#!/usr/bin/env python3
"""Verify optimized artwork and owner-authorized progressive sprites in a Web candidate."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

from PIL import Image

EXPECTED_SPRITE_IDS = list(range(1, 43)) + list(range(44, 52)) + list(range(53, 57))


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

    for name in ("index.html", "game.zip", "renpy.js", "renpy.wasm", "renpy.data", "service-worker.js"):
        path = candidate / name
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"missing required web runtime file {name}")

    worker_source = project / "web" / "service-worker.js"
    worker_candidate = candidate / "service-worker.js"
    if not worker_source.is_file() or not worker_candidate.is_file():
        fail("service worker source or candidate is missing")
    source_text = worker_source.read_text(encoding="utf-8")
    worker_text = worker_candidate.read_text(encoding="utf-8")
    if "__STEM_CACHE_VERSION__" not in source_text:
        fail("service worker source must keep the __STEM_CACHE_VERSION__ placeholder for the build stamp")
    # The reviewed source and the shipped worker may differ by exactly one thing:
    # the content stamp written by tools/stamp_service_worker.py.
    if re.sub(r"var CACHE_VERSION = '[0-9a-f]{16}';", "var CACHE_VERSION = '__STEM_CACHE_VERSION__';", worker_text) != source_text:
        fail("candidate service worker differs from the reviewed project source beyond the cache-version stamp")
    # The source comment also names the placeholder, so only an unstamped
    # CACHE_VERSION assignment proves the candidate skipped the stamp step.
    if "var CACHE_VERSION = '__STEM_CACHE_VERSION__';" in worker_text:
        fail("candidate service worker was not stamped with a content version")
    # The engine must be precached: re-downloading 37 MB of wasm/engine data on
    # every visit is the regression this worker exists to prevent.
    for required in ("renpy.wasm", "renpy.data", "game.zip", "PRECACHE", "cacheFirst", "networkFirst"):
        if required not in worker_text:
            fail(f"service worker must keep precaching the engine and start-up assets ({required} missing)")

    opening_background = images / "bg_intro_scene.jpg"
    presplash_source = project / "web-presplash.jpg"
    presplash_candidate = candidate / "web-presplash.jpg"
    if (
        not opening_background.is_file()
        or not presplash_source.is_file()
        or not presplash_candidate.is_file()
        or sha256_file(presplash_source) != sha256_file(opening_background)
        or sha256_file(presplash_candidate) != sha256_file(presplash_source)
    ):
        fail("Web presplash must preserve the opening landscape from staging through the candidate")
    index_text = (candidate / "index.html").read_text(encoding="utf-8")
    if "web-presplash.jpg" not in index_text:
        fail("Web index does not reference the custom opening-landscape presplash")

    # Custom loading overlay: shipped, wired, injected before the canvas, and its
    # art is actually deliverable (a loader pointing at a missing image is a black
    # screen with a dead progress bar).
    for asset in ("loading/loading.css", "loading/loading.js", "loading/art.json"):
        path = candidate / asset
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"custom loading overlay asset missing: {asset}")
    if 'id="stem-loader"' not in index_text or "loading/loading.js" not in index_text:
        fail("index.html must carry the custom loading overlay and its script")
    if index_text.index('id="stem-loader"') > index_text.index("<canvas"):
        fail("the loading overlay must be injected before the Ren'Py canvas")
    if "Os Bodhisattvas" not in index_text and "loading/loading.js" not in index_text:
        fail("the loading overlay has no in-story loading copy")
    art_manifest = json.loads((candidate / "loading" / "art.json").read_text(encoding="utf-8"))
    art_name = str(art_manifest.get("art") or "").strip()
    if not art_name:
        fail("loading/art.json must name the art file")
    art_candidates = [candidate / "loading" / art_name, candidate / art_name]
    if not any(path.is_file() and path.stat().st_size > 0 for path in art_candidates):
        fail(f"loading art named by art.json is not shipped: {art_name}")
    if art_name not in index_text:
        fail(f"index.html does not reference the loading art: {art_name}")

    sprite_manifest_path = images / "masters" / "sprites" / "manifest.json"
    capture_manifest_path = images / "masters" / "source" / "capture_manifest.json"
    optimized_manifest_path = images / "optimized" / "manifest.json"
    narrator_manifest_path = images / "narrator" / "manifest.json"
    sprite_manifest = json.loads(sprite_manifest_path.read_text(encoding="utf-8"))
    capture_manifest = capture_manifest_path.read_bytes()
    optimized_manifest = json.loads(optimized_manifest_path.read_text(encoding="utf-8"))
    narrator_manifest = json.loads(narrator_manifest_path.read_text(encoding="utf-8"))
    if (
        sprite_manifest.get("status") != "provisional"
        or sprite_manifest.get("temporaryUseApprovedByOwner") is not True
        or sprite_manifest.get("publicDistributionApprovedByOwner") is not True
        or sprite_manifest.get("availableCount") != 54
        or sprite_manifest.get("missingChapters") != [43, 52]
    ):
        fail("sprite manifest must record owner-approved 54-render distribution with slots 43/52 absent")
    sprite_assets = sprite_manifest.get("assets", [])
    if len(sprite_assets) != 54 or sorted(int(item["chapter"]) for item in sprite_assets) != EXPECTED_SPRITE_IDS:
        fail("sprite manifest IDs differ from the 54 available renders")
    if optimized_manifest.get("count") != 56 or len(optimized_manifest.get("assets", [])) != 56:
        fail("optimized-image manifest must list exactly 56 chapter backgrounds")

    expected_files: dict[str, tuple[str | None, int | None, str, int, int]] = {}
    for asset in optimized_manifest["assets"]:
        relative = f"images/optimized/{asset['file']}"
        expected_files[relative] = (asset["sha256"], asset["sizeBytes"], "JPEG", 1920, 1080)
    for asset in sprite_assets:
        relative = f"images/{asset['file']}"
        expected_files[relative] = (asset["sha256"], asset["sizeBytes"], "PNG", asset["width"], asset["height"])
    intro = images / "bg_intro_scene.jpg"
    if not intro.is_file():
        fail("independent opening background is missing")
    with Image.open(intro) as opening:
        expected_files["images/bg_intro_scene.jpg"] = (
            sha256_file(intro), intro.stat().st_size, "JPEG", opening.width, opening.height
        )
    narrator_file = images / "narrator" / "orb.png"
    if (
        narrator_manifest.get("file") != "orb.png"
        or narrator_manifest.get("relativePath") != "images/narrator/orb.png"
        or narrator_manifest.get("format") != "PNG"
        or narrator_manifest.get("width") != 512
        or narrator_manifest.get("height") != 512
        or not narrator_file.is_file()
        or narrator_file.stat().st_size != narrator_manifest.get("sizeBytes")
        or sha256_file(narrator_file) != narrator_manifest.get("sha256")
    ):
        fail("narrator orb differs from its dedicated asset manifest")
    with Image.open(narrator_file) as orb:
        if orb.format != "PNG" or orb.size != (512, 512):
            fail("narrator orb format or dimensions differ from its manifest")
    expected_files["images/narrator/orb.png"] = (
        narrator_manifest["sha256"], narrator_manifest["sizeBytes"], "PNG", 512, 512
    )

    runtime_sprite_dir = packaged_images / "masters" / "sprites" / "provisional"
    runtime_sprite_files = sorted(runtime_sprite_dir.glob("*.png"))
    expected_sprite_names = {Path(asset["file"]).name for asset in sprite_assets}
    if len(runtime_sprite_files) != 54 or {path.name for path in runtime_sprite_files} != expected_sprite_names:
        fail("progressive output must contain exactly the 54 manifest-listed runtime sprites")
    if len(list((packaged_images / "optimized").glob("bg_ch*.jpg"))) != 56:
        fail("progressive output must contain exactly 56 optimized chapter backgrounds")

    for relative, (expected_hash, expected_size, expected_format, width, height) in expected_files.items():
        path = candidate / "game" / relative
        if not path.is_file() or (expected_size is not None and path.stat().st_size != expected_size):
            fail(f"progressive asset missing or wrong size: {relative}")
        if sha256_file(path) != expected_hash:
            fail(f"progressive asset SHA-256 mismatch: {relative}")
        with Image.open(path) as image:
            if image.format != expected_format or image.size != (width, height):
                fail(f"progressive asset format/dimensions mismatch: {relative}")

    source_capture_dir = packaged_images / "masters" / "source"
    if list(source_capture_dir.glob("*.png")):
        fail("raw source-capture PNGs were copied into the progressive package")
    if any(path.suffix.lower() == ".glb" for path in candidate.rglob("*")):
        fail("an upstream GLB model was included in the Web candidate")

    remote_list_name = "game/renpyweb_remote_files.txt"
    with ZipFile(zip_path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            fail(f"ZIP CRC failure in member {corrupt}")
        names = archive.namelist()
        if len(names) < 100:
            fail(f"ZIP has only {len(names)} entries")
        raw_sources = [
            name for name in names
            if re.search(r"(?:^|/)masters/source/[^/]+\.png$", name)
        ]
        if raw_sources:
            fail("raw source-capture PNGs are in game.zip: " + ", ".join(raw_sources[:5]))
        if any(name.lower().endswith(".glb") for name in names):
            fail("an upstream GLB model is in game.zip")

        manifest_members = {
            "game/images/masters/sprites/manifest.json": sprite_manifest_path.read_bytes(),
            "game/images/masters/source/capture_manifest.json": capture_manifest,
            "game/images/optimized/manifest.json": optimized_manifest_path.read_bytes(),
            "game/images/narrator/manifest.json": narrator_manifest_path.read_bytes(),
        }
        for member, expected_bytes in manifest_members.items():
            if member not in names or archive.read(member) != expected_bytes:
                fail(f"provenance manifest missing or differs inside game.zip: {member}")

        try:
            lines = archive.read(remote_list_name).decode("utf-8").splitlines()
        except KeyError:
            fail("game/renpyweb_remote_files.txt is missing")
        if len(lines) % 2:
            fail("remote-file list has an incomplete path/metadata pair")
        remote = dict(zip(lines[0::2], lines[1::2]))
        for relative, (_digest, _size, _fmt, width, height) in expected_files.items():
            if remote.get(relative) != f"image {width},{height}":
                fail(f"progressive-file list lacks expected {relative}")

        placeholder_names = {
            name.removeprefix("_placeholders/")
            for name in names
            if name.startswith("_placeholders/images/")
        }
        for relative in expected_files:
            if relative not in placeholder_names:
                fail(f"Ren'Py placeholder is missing for progressive image {relative}")
        for name in names:
            if re.fullmatch(r"_placeholders/images/masters/sprites/provisional/master_ch(43|52)_provisional\.png", name):
                fail("a placeholder was generated for absent sprite slot 43 or 52")

        # Screen scripts reference textures by path. A bundle that omits them
        # renders empty buttons and empty dialogue boxes, so every referenced
        # UI/narrator/speaker texture must be delivered by this candidate.
        texture_refs: set[str] = set()
        for script in sorted((project / "game").glob("*.rpy")):
            texture_refs.update(
                re.findall(r'"(images/(?:ui|narrator|speakers)/[^"]+\.(?:png|jpg|jpeg|webp))"', script.read_text(encoding="utf-8"))
            )
        undelivered = [
            relative
            for relative in sorted(texture_refs)
            if f"game/{relative}" not in names and not (candidate / "game" / relative).is_file()
        ]
        if undelivered:
            fail("UI textures referenced by the screens are not shipped: " + ", ".join(undelivered[:6]))

        # First-match-wins: a catch-all "+ image game/**" placed before the UI
        # rules streams the dialogue box and choice card instead of loading them,
        # which shows pixellated placeholders exactly where the buttons belong.
        try:
            rules = archive.read("progressive_download.txt").decode("utf-8").splitlines()
        except KeyError:
            fail("progressive_download.txt is missing from game.zip")
        ordered = [
            line.split()
            for line in rules
            if line.strip() and not line.lstrip().startswith("#") and len(line.split()) >= 3
        ]

        def first_match(path: str) -> str | None:
            for flag, kind, pattern in ((row[0], row[1], row[2]) for row in ordered):
                if kind != "image":
                    continue
                if pattern.endswith("/**"):
                    prefix = pattern[:-2]
                    if path.startswith(prefix) or path == prefix.rstrip("/"):
                        return flag
                elif pattern == path:
                    return flag
            return None

        streamed_ui = [
            relative
            for relative in sorted(texture_refs)
            if relative.startswith("images/ui/") and first_match(f"game/{relative}") != "-"
        ]
        if streamed_ui:
            fail(
                "UI chrome must load before play; these are streamed by progressive_download.txt: "
                + ", ".join(streamed_ui[:6])
            )

    sprite_bytes = sum(path.stat().st_size for path in runtime_sprite_files)
    print("PASS: ZIP integrity and all three manifests; no raw source-capture PNGs or GLB files in package")
    print(f"PASS: {len(texture_refs)} screen textures referenced by the game scripts are shipped")
    print("PASS: 56 optimized JPEGs and 54 authorized runtime sprites match progressive SHA-256/size/dimensions")
    print("PASS: remote-file list and Ren'Py placeholders map all 112 runtime images; slots 43/52 absent")
    print(f"Payloads: optimized backgrounds {optimized_manifest['optimizedBytes']:,} bytes; sprites {sprite_bytes:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
