#!/usr/bin/env python3
"""Prepare a disposable, license-safe Ren'Py project copy for a local Web build."""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    project = args.project.resolve()
    game = project / "game"
    images = game / "images"
    story_path = game / "script.rpy"
    gallery_path = game / "technosutra_masters.rpy"
    story = story_path.read_text(encoding="utf-8")
    gallery = gallery_path.read_text(encoding="utf-8")

    expected_backgrounds = {
        f'image bg_ch{chapter:02d} = "images/optimized/bg_ch{chapter:02d}.jpg"'
        for chapter in range(1, 57)
    }
    found_backgrounds = set(re.findall(r'^image bg_ch\d{2} = "images/optimized/bg_ch\d{2}\.jpg"$', story, re.M))
    if found_backgrounds != expected_backgrounds:
        raise SystemExit("Generated story must reference all 56 optimized chapter backgrounds")
    prohibited_patterns = (
        r"(?m)^image master_ch\d{2}_provisional =",
        r"(?m)^image gallery_master_\d{2}_provisional =",
        r"(?m)^\s*show master_ch\d{2}_provisional\b",
        r"masters/sprites/",
        r"masters/source/",
        r"models/model\d+\.glb",
    )
    for pattern in prohibited_patterns:
        if re.search(pattern, story) or re.search(pattern, gallery):
            raise SystemExit(f"Upstream render reference remains in generated Ren'Py script: {pattern}")
    if not re.search(r"^label technosutra_master_gallery:", gallery, re.M):
        raise SystemExit("License-safe gallery notice label is missing")
    if "Os 54 renders brutos do upstream foram mantidos fora do pacote" not in gallery:
        raise SystemExit("Gallery stub does not explain the upstream-license exclusion")

    if not (images / "bg_intro_scene.jpg").is_file():
        raise SystemExit("The independent opening background is missing")
    optimized = images / "optimized"
    if len(list(optimized.glob("bg_ch*.jpg"))) != 56:
        raise SystemExit("Expected exactly 56 optimized chapter backgrounds")
    if not (optimized / "manifest.json").is_file():
        raise SystemExit("Optimized-art provenance manifest is missing")

    # Remove all raw captures, duplicate provisional sprites, and upstream
    # provenance from this disposable copy only. The source tree is untouched.
    masters = images / "masters"
    if masters.exists():
        shutil.rmtree(masters)
    for child in list(images.iterdir()):
        if child.name in {"optimized", "bg_intro_scene.jpg"}:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()

    if {path.name for path in images.iterdir()} != {"optimized", "bg_intro_scene.jpg"}:
        raise SystemExit("Unexpected images remain after upstream-render removal")
    if list(images.rglob("*.png")) or list(images.rglob("*.glb")):
        raise SystemExit("An upstream PNG/GLB remains in the disposable package staging tree")

    print("Prepared license-safe local build source: 56 optimized backgrounds + independent opening image.")
    print("Excluded all 54 upstream renders, raw captures, sprite copies, and their manifests from the package staging tree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
