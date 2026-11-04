#!/usr/bin/env python3
"""Prepare a disposable Ren'Py project copy with approved sprites and no raw captures."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from PIL import Image

EXPECTED_IDS = list(range(1, 43)) + list(range(44, 52)) + list(range(53, 57))
MISSING_IDS = [43, 52]

EXPECTED_UI_ASSETS = {
    "velvet-night.png",
    "velvet-night-hover.png",
    "glass-frost.png",
    "glass-frost-hover.png",
    "paper-vellum.png",
    "paper-vellum-hover.png",
    "paper-glass.png",
    "paper-glass-hover.png",
    "velvet_dialogue_flat.png",
    "velvet_dialogue_glass.png",
    "velvet_panel_flat.png",
    "velvet_panel_glass.png",
    "velvet_choice_flat.png",
    "velvet_choice_glass.png",
    "velvet_question_flat.png",
    "velvet_question_glass.png",
    "velvet_button_flat.png",
    "velvet_button_glass.png",
    "velvet_tabs_flat.png",
    "velvet_tabs_glass.png",
    "velvet_slots_flat.png",
    "velvet_slots_glass.png",
    "velvet_controls_flat.png",
    "velvet_controls_glass.png",
    "velvet_menu_flat.png",
    "velvet_menu_glass.png",
    "velvet_interstitial_flat.png",
    "velvet_interstitial_glass.png",
    "velvet_nameplate_flat.png",
    "velvet_nameplate_glass.png",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fallback_capture_manifest(sprite_manifest: dict) -> dict:
    """Copy only provenance facts already recorded in the sprite manifest."""
    return {
        "schemaVersion": sprite_manifest.get("schemaVersion", 1),
        "title": "Technosutra source-capture provenance (derived from sprite manifest)",
        "sourceRepository": sprite_manifest.get("sourceRepository"),
        "sourceCommit": sprite_manifest.get("sourceCommit"),
        "renderMethod": sprite_manifest.get("renderMethod"),
        "availableCount": sprite_manifest.get("availableCount"),
        "missingChapters": sprite_manifest.get("missingChapters"),
        "assets": [
            {
                "chapter": asset.get("chapter"),
                "upstreamFile": asset.get("upstreamFile"),
                "sourceCapture": asset.get("sourceCapture"),
                "runtimeFile": asset.get("file"),
                "sha256": asset.get("sha256"),
            }
            for asset in sprite_manifest.get("assets", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    project = args.project.resolve()
    game = project / "game"
    images = game / "images"
    narrator_dir = images / "narrator"
    narrator_manifest_path = narrator_dir / "manifest.json"
    if not narrator_manifest_path.is_file():
        raise SystemExit(f"Missing narrator asset manifest: {narrator_manifest_path}")
    narrator_asset = json.loads(narrator_manifest_path.read_text(encoding="utf-8"))
    if (
        narrator_asset.get("file") != "orb.png"
        or narrator_asset.get("relativePath") != "images/narrator/orb.png"
        or narrator_asset.get("format") != "PNG"
        or narrator_asset.get("width") != 512
        or narrator_asset.get("height") != 512
    ):
        raise SystemExit("Narrator orb manifest must describe the approved 512x512 PNG at images/narrator/orb.png")
    narrator_path = narrator_dir / "orb.png"
    if (
        not narrator_path.is_file()
        or narrator_path.stat().st_size != narrator_asset.get("sizeBytes")
        or sha256(narrator_path) != narrator_asset.get("sha256")
        or {path.name for path in narrator_dir.iterdir()} != {"manifest.json", "orb.png"}
    ):
        raise SystemExit("Narrator orb files differ from the dedicated asset manifest")
    with Image.open(narrator_path) as orb:
        if orb.format != "PNG" or orb.size != (512, 512):
            raise SystemExit("Narrator orb image format or dimensions differ from its manifest")
    story_path = game / "script.rpy"
    gallery_path = game / "technosutra_masters.rpy"

    sprite_root = images / "masters" / "sprites"
    sprite_manifest_path = sprite_root / "manifest.json"
    source_root = images / "masters" / "source"
    capture_manifest_path = source_root / "capture_manifest.json"
    if not sprite_manifest_path.is_file():
        raise SystemExit(f"Missing sprite provenance manifest: {sprite_manifest_path}")
    manifest = json.loads(sprite_manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("status") != "provisional"
        or manifest.get("temporaryUseApprovedByOwner") is not True
        or manifest.get("publicDistributionApprovedByOwner") is not True
        or manifest.get("availableCount") != 54
    ):
        raise SystemExit("Expected an explicitly owner-approved 54-render provisional sprite manifest")
    assets = manifest.get("assets", [])
    ids = sorted(int(asset["chapter"]) for asset in assets)
    if ids != EXPECTED_IDS or manifest.get("missingChapters") != MISSING_IDS:
        raise SystemExit(f"Expected 54 sprites and absent slots {MISSING_IDS}; found IDs {ids}")

    # Verify all approved runtime files and any raw captures that were copied
    # into this disposable project. The original source tree is never changed.
    for asset in assets:
        runtime_path = images / asset["file"]
        expected_hash = asset.get("sha256")
        if not runtime_path.is_file() or not expected_hash or sha256(runtime_path) != expected_hash:
            raise SystemExit(f"Runtime sprite SHA-256 failed for chapter {asset['chapter']}")
        source_capture = asset.get("sourceCapture")
        if source_capture:
            source_path = images / source_capture
            if source_path.is_file() and sha256(source_path) != expected_hash:
                raise SystemExit(f"Raw source capture SHA-256 failed for chapter {asset['chapter']}")

    story = story_path.read_text(encoding="utf-8")
    story, redirected = re.subn(
        r'(?m)^(image bg_ch\d{2} = )"images/(bg_ch\d{2}\.jpg)"( mipmap true)?$',
        r'\1"images/optimized/\2"\3',
        story,
    )
    if redirected != 56:
        raise SystemExit(f"Expected to redirect 56 chapter backgrounds, changed {redirected}")
    story_path.write_text(story, encoding="utf-8")
    if len(re.findall(r"^image master_ch\d{2}_provisional =", story, re.M)) != 54:
        raise SystemExit("Generated story must reference all 54 approved provisional runtime sprites")
    if "jump technosutra_master_gallery" not in story:
        raise SystemExit("Generated story must retain the 54-image gallery")
    if len(re.findall(r"^image bg_ch\d{2} = \"images/optimized/bg_ch\d{2}\.jpg\"( mipmap true)?$", story, re.M)) != 56:
        raise SystemExit("Generated story must use all 56 optimized backgrounds")

    gallery = gallery_path.read_text(encoding="utf-8")
    if not re.search(r"^label technosutra_master_gallery:", gallery, re.M):
        raise SystemExit("Generated source gallery label is missing")
    if len(re.findall(r"^image gallery_master_\d{2}_provisional =", gallery, re.M)) != 54:
        raise SystemExit("Gallery must define exactly the 54 available renders")
    if re.search(r"gallery_master_(43|52)_provisional", gallery):
        raise SystemExit("Missing upstream slots 43 and 52 must not be invented")

    optimized = images / "optimized"
    if not (images / "bg_intro_scene.jpg").is_file():
        raise SystemExit("The opening background is missing")
    if len(list(optimized.glob("bg_ch*.jpg"))) != 56:
        raise SystemExit("Expected exactly 56 optimized runtime backgrounds")
    ui_dir = images / "ui"
    ui_assets = {path.name for path in ui_dir.glob("*.png")} if ui_dir.is_dir() else set()
    if ui_assets != EXPECTED_UI_ASSETS:
        raise SystemExit(f"Expected exactly {len(EXPECTED_UI_ASSETS)} approved UI image assets; found {sorted(ui_assets)}")
    speaker_asset = images / "speakers" / "generic_speaker_shadow.png"
    speaker_provenance = images / "speakers" / "provenance.json"
    if not speaker_asset.is_file() or not speaker_provenance.is_file():
        raise SystemExit("The generic speaker silhouette or its provenance record is missing")
    speaker_record = json.loads(speaker_provenance.read_text(encoding="utf-8"))
    if speaker_record.get("runtimeSha256") != sha256(speaker_asset):
        raise SystemExit("Generic speaker silhouette SHA-256 differs from its provenance record")
    with Image.open(speaker_asset) as portrait:
        if portrait.mode != "RGBA" or portrait.size != (512, 512):
            raise SystemExit(f"Generic speaker silhouette must be a 512x512 RGBA PNG; found {portrait.mode} {portrait.size}")
        pixels = portrait.getdata()
        alpha = portrait.getchannel("A")
        if alpha.getextrema() != (0, 255) or any(r or g or b for r, g, b, a in pixels):
            raise SystemExit("Generic speaker silhouette must retain transparency and use only black RGB pixels")

    # Preserve only capture provenance, never the raw source-capture PNGs.
    source_root.mkdir(parents=True, exist_ok=True)
    raw_pngs = list(source_root.glob("*.png"))
    if raw_pngs and len(raw_pngs) != 54:
        raise SystemExit(f"Expected 54 raw source captures before staging cleanup; found {len(raw_pngs)}")
    for path in raw_pngs:
        path.unlink()
    for child in list(source_root.iterdir()):
        if child.name != "capture_manifest.json":
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
    if not capture_manifest_path.is_file():
        capture_manifest_path.write_text(
            json.dumps(fallback_capture_manifest(manifest), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    provisional_dir = sprite_root / "provisional"
    runtime_files = list(provisional_dir.glob("*.png"))
    expected_names = {Path(asset["file"]).name for asset in assets}
    if len(runtime_files) != 54 or {path.name for path in runtime_files} != expected_names:
        raise SystemExit("Runtime sprite inventory differs from the 54-entry provenance manifest")
    for child in list(sprite_root.iterdir()):
        if child.name not in {"manifest.json", "provisional"}:
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()

    for child in list(images.iterdir()):
        if child.name in {"optimized", "bg_intro_scene.jpg", "masters", "ui", "narrator", "speakers", "pixel"}:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()

    expected_top_level = {"optimized", "bg_intro_scene.jpg", "masters", "ui", "narrator", "speakers", "pixel"}
    if {path.name for path in images.iterdir()} != expected_top_level:
        raise SystemExit("Unexpected game/images files remain after local-build preparation")
    if list(source_root.glob("*.png")):
        raise SystemExit("Raw source captures remain in the local package staging tree")
    if len(list(provisional_dir.glob("*.png"))) != 54:
        raise SystemExit("Expected exactly 54 approved runtime sprites after staging cleanup")
    opening_background = images / "bg_intro_scene.jpg"
    web_presplash = project / "web-presplash.jpg"
    shutil.copy2(opening_background, web_presplash)
    if sha256(web_presplash) != sha256(opening_background):
        raise SystemExit("Web presplash must be an exact copy of the approved opening landscape")
    print("Prepared web presplash from the approved opening landscape; SHA-256 verified.")
    print(f"Prepared disposable local build: 56 optimized backgrounds + opening image + 54 approved runtime sprites + narrator orb + {len(ui_assets)} approved UI texture tiles + 9 pixel-art frames + generic speaker fallback.")
    print("Retained sprite/capture provenance manifests; excluded raw source-capture PNGs from the package.")
    print("Slots 43 and 52 remain absent; no missing renders were generated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
