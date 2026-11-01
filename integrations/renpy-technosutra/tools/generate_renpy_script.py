#!/usr/bin/env python3
"""Generate the full 56-chapter Ren'Py VN from the detailed chapter manifest."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game"
MANIFEST = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))
CHAPTERS = MANIFEST["chapters"]
SPRITE_MANIFEST = json.loads((GAME / "images/masters/sprites/manifest.json").read_text(encoding="utf-8"))
if SPRITE_MANIFEST.get("status") != "provisional":
    raise SystemExit("Master sprite manifest must remain explicitly provisional")
EXPECTED_PROVISIONAL_CHAPTERS = list(range(1, 43)) + list(range(44, 52)) + list(range(53, 57))
PROVISIONAL_SPRITES = {
    int(asset["chapter"]): asset
    for asset in SPRITE_MANIFEST.get("assets", [])
    if asset.get("status") == "provisional"
}
if sorted(PROVISIONAL_SPRITES) != EXPECTED_PROVISIONAL_CHAPTERS or SPRITE_MANIFEST.get("availableCount") != 54:
    raise SystemExit(f"Expected the 54 verified provisional renders; found {sorted(PROVISIONAL_SPRITES)}")
for number, asset in PROVISIONAL_SPRITES.items():
    image_path = GAME / "images" / asset["file"]
    if not image_path.is_file():
        raise SystemExit(f"Missing provisional render for chapter slot {number}: {image_path}")

if len(CHAPTERS) != 56 or [c["number"] for c in CHAPTERS] != list(range(1, 57)):
    raise SystemExit("chapters.json must contain chapters 1–56 in order")
for chapter in CHAPTERS:
    for field in ("narrativePt", "scenes", "choice", "minigame"):
        if not chapter.get(field):
            raise SystemExit(f"Chapter {chapter['number']} has no {field}")
    if not chapter["scenes"]:
        raise SystemExit(f"Chapter {chapter['number']} has no scenes")
    if not chapter["choice"].get("options"):
        raise SystemExit(f"Chapter {chapter['number']} has no choice options")
    game = chapter["minigame"]
    if not game.get("options_pt") or not 0 <= game.get("correct_option_index", -1) < len(game["options_pt"]):
        raise SystemExit(f"Chapter {chapter['number']} has an invalid minigame")


def quoted(text: str) -> str:
    return json.dumps(str(text), ensure_ascii=False)


def title(chapter: dict) -> str:
    return f"Capítulo {chapter['number']} — {chapter['title']}"


speakers: list[str] = []
for chapter in CHAPTERS:
    for scene in chapter["scenes"]:
        for line in scene.get("dialogue", []):
            name = line.get("speaker", "Narrador").strip() or "Narrador"
            if name != "Narrador" and name not in speakers:
                speakers.append(name)
speaker_ids = {name: f"speaker_{index:03d}" for index, name in enumerate(speakers, 1)}

lines = [
    "# The Stem Array / Gaṇḍavyūha — Technosutra visual novel.",
    "# Generated from chapters.json by tools/generate_renpy_script.py.",
    "# Detailed, source-grounded Portuguese adaptation of all 56 chapters, based on the complete supplied PDF.",
    "# All VN dialogue is newly written adaptation, not a quotation or claim of canonical wording.",
    "# Player choices are optional reflections and reconverge; quizzes are original learning activities.",
    "# Translation: Peter Alan Roberts; editor: Emily Bower; source: 84000, Toh 44–45.",
    "# Adaptation permission was separately confirmed by the project owner.",
    "# Original chapter environments; no Google Street View imagery or derivatives are used.",
    "",
    'define narrator = Character("Narrador")',
]
for name in speakers:
    lines.append(f"define {speaker_ids[name]} = Character({quoted(name)})")
lines.extend(["", 'image bg_intro_scene = "images/bg_intro_scene.jpg"'])
for chapter in CHAPTERS:
    number = chapter["number"]
    lines.append(f'image bg_ch{number:02d} = "images/{chapter["background"]}"')
for number, asset in sorted(PROVISIONAL_SPRITES.items()):
    lines.append(f'image master_ch{number:02d}_provisional = "images/{asset["file"]}"')
lines.extend([
    "",
    "# Temporary static portraits from raw transparent captures; no animation or lip-sync.",
    "transform master_provisional_portrait:",
    "    xalign 0.84",
    "    yalign 1.0",
    "    zoom 0.8",
    "",
    "screen master_provisional_badge():",
    "    zorder 10",
    "    frame:",
    "        xalign 0.02",
    "        yalign 0.04",
    "        xpadding 18",
    "        ypadding 10",
    '        background Solid("#101326ee")',
    "        vbox:",
    "            spacing 3",
    '            text "PROVISÓRIO" size 24 color "#ffd35a" bold True',
    '            text "render frontal estático · sem fundo" size 16 color "#edf1ff"',
])

lines.extend([
    "",
    "label start:",
    "    hide screen master_provisional_badge",
    "    scene bg_intro_scene with fade",
    '    centered "The Stem Array — visual novel"',
    '    narrator "Esta abertura usa um cenário original independente. A imagem enviada pelo projeto não foi incluída porque sua origem ainda precisa ser confirmada."',
    '    narrator "As cenas recontam os capítulos com base no texto integral autorizado. As falas da VN são criações de adaptação, não citações da tradução."',
    "    menu:",
    '        "Galeria de renders provisórios":',
    "            jump technosutra_master_gallery",
    '        "Começar a jornada — capítulo 1":',
    "            jump chapter_01",
    '        "Abrir o índice de capítulos":',
    "            jump chapter_index",
    '        "Encerrar":',
    "            return",
    "",
    "label chapter_index:",
    "    hide screen master_provisional_badge",
    "    scene bg_ch01 with dissolve",
    '    centered "The Stem Array — índice de capítulos"',
    "    menu:",
])
for start in range(1, 57, 10):
    end = min(start + 9, 56)
    lines.extend([
        f'        "Capítulos {start}–{end}":',
        f"            jump chapter_group_{start:02d}",
    ])
lines.extend([
    '        "Começar do início":',
    "            jump chapter_01",
    '        "Voltar à abertura":',
    "            jump start",
    "",
])

for start in range(1, 57, 10):
    group = CHAPTERS[start - 1 : min(start + 9, 56)]
    group_title = f"Capítulos {group[0]['number']}–{group[-1]['number']}"
    lines.extend([
        f"label chapter_group_{start:02d}:",
        f"    scene bg_ch{group[0]['number']:02d} with dissolve",
        f"    centered {quoted(group_title)}",
        "    menu:",
    ])
    for chapter in group:
        lines.extend([
            f"        {quoted(title(chapter))}:",
            f"            jump chapter_{chapter['number']:02d}",
        ])
    lines.extend([
        '        "Voltar ao índice":',
        "            jump chapter_index",
        "",
    ])

for chapter in CHAPTERS:
    number = chapter["number"]
    quiz = chapter["minigame"]
    lines.extend([
        f"label chapter_{number:02d}:",
        "    hide screen master_provisional_badge",
        f"    scene bg_ch{number:02d} with dissolve",
    ])
    if number in PROVISIONAL_SPRITES:
        lines.append(f"    show master_ch{number:02d}_provisional at master_provisional_portrait with dissolve")
        lines.append("    show screen master_provisional_badge")
    lines.append(f"    centered {quoted(title(chapter))}")
    for scene_index, scene in enumerate(chapter["scenes"], 1):
        scene_title = scene.get("scene_title_pt", f"Cena {scene_index}")
        lines.extend([
            f"    centered {quoted(f'Cena {scene_index} — {scene_title}')}",
            f"    narrator {quoted(scene['narration_pt'])}",
        ])
        for dialogue in scene.get("dialogue", []):
            speaker = dialogue.get("speaker", "Narrador").strip() or "Narrador"
            speaker_id = "narrator" if speaker == "Narrador" else speaker_ids[speaker]
            lines.append(f"    {speaker_id} {quoted(dialogue['line_pt'])}")
    lines.extend([
        "    # Optional authored reflection; branches reconverge by design.",
        "    menu:",
        f"        {quoted(chapter['choice']['prompt_pt'])}",
    ])
    for option in chapter["choice"]["options"]:
        lines.extend([
            f"        {quoted(option['label_pt'])}:",
            f"            narrator {quoted(option['response_pt'])}",
        ])
    lines.extend([
        f"    call quiz_ch{number:02d}",
        "    menu:",
    ])
    if number < 56:
        lines.extend([
            f'        "Continuar — capítulo {number + 1}":',
            f"            jump chapter_{number + 1:02d}",
        ])
    else:
        lines.extend([
            '        "Voltar ao índice":',
            "            jump chapter_index",
            '        "Rever a dedicação final":',
            "            jump chapter_56",
        ])
    lines.extend([
        '        "Voltar ao índice":',
        "            jump chapter_index",
        "",
        f"label quiz_ch{number:02d}:",
        f"    centered {quoted(quiz['title_pt'])}",
        f"    narrator {quoted(quiz['instruction_pt'])}",
        "    while True:",
        "        menu:",
        f"            {quoted(quiz['question_pt'])}",
    ])
    correct = quiz["correct_option_index"]
    for option_index, option in enumerate(quiz["options_pt"]):
        lines.extend([
            f"            {quoted(option)}:",
            f"                if {option_index} == {correct}:",
            f"                    narrator {quoted(quiz['success_feedback_pt'])}",
            "                    return",
            "                else:",
            f"                    narrator {quoted(quiz['retry_feedback_pt'])}",
        ])
    lines.extend([
        "",
    ])

(GAME / "script.rpy").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
print(f"Wrote {GAME / 'script.rpy'}: {len(CHAPTERS)} chapters, {sum(len(c['scenes']) for c in CHAPTERS)} scenes, {len(speakers)} authored speakers, 56 choices, 56 quizzes.")
