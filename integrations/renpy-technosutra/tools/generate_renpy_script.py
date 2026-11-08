#!/usr/bin/env python3
"""Generate the full 56-chapter Ren'Py VN from the detailed chapter manifest."""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game"
MANIFEST = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))
CHAPTERS = MANIFEST["chapters"]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--exclude-upstream-renders",
    action="store_true",
    help="omit all upstream render declarations and references from this generated game",
)
ARGS = parser.parse_args()
EXCLUDE_UPSTREAM_RENDERS = ARGS.exclude_upstream_renders
PROVISIONAL_SPRITES: dict[int, dict] = {}
if not EXCLUDE_UPSTREAM_RENDERS:
    SPRITE_MANIFEST = json.loads((GAME / "images/masters/sprites/manifest.json").read_text(encoding="utf-8"))
    if (
        SPRITE_MANIFEST.get("status") != "provisional"
        or SPRITE_MANIFEST.get("temporaryUseApprovedByOwner") is not True
        or SPRITE_MANIFEST.get("publicDistributionApprovedByOwner") is not True
    ):
        raise SystemExit("Master sprite manifest must record owner-approved public distribution")
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


# --- Cast staging -----------------------------------------------------------
# The 54 verified chapter-slot renders are the only character art that exists.
# Each master's own chapter title names them, so a speaker receives a portrait
# only when their normalized name resolves to a real, staged slot. Crowd voices,
# mascots and the absent slots 43/52 stay without art instead of borrowing a
# face the manifest does not claim.
MISSING_SPRITE_SLOTS = {43, 52}
CAST_ALIASES = {
    # Chapter 1 ("The Setting") is the Buddha's assembly; the narration and the
    # dialogue use three names for the same master.
    "buddha": 1,
    "bhagavat": 1,
    "tathagata": 1,
    "manjusri kumarabhuta": 3,
}
# The stage keeps room for four standing portraits along the left edge of the
# dialogue box. screens.rpy owns the matching stem_stage_slot_N transforms.
STAGE_SLOTS = 4


def _cast_key(value: str) -> str:
    """Fold case, diacritics and quotes so speaker names match chapter titles."""
    folded = unicodedata.normalize("NFKD", str(value))
    folded = "".join(char for char in folded if not unicodedata.combining(char))
    folded = folded.replace("“", '"').replace("”", '"').replace("’", "'")
    return re.sub(r"[^a-z0-9]+", " ", folded.lower()).strip()


CAST_CHAPTER_BY_NAME: dict[str, int] = {}
if not EXCLUDE_UPSTREAM_RENDERS:
    for _chapter in CHAPTERS:
        if _chapter["number"] in MISSING_SPRITE_SLOTS:
            continue
        for _part in re.split(r"\s+and\s+", _chapter["title"]):
            _part = _part.strip()
            # Chapter 56 is a name plus a prayer title: "Samantabhadra and
            # “The Prayer for Completely Good Conduct”". Only the leading name
            # is a character; quoted titles never become cast entries.
            if not _part or _part[0] in "“\"":
                continue
            CAST_CHAPTER_BY_NAME.setdefault(_cast_key(_part), _chapter["number"])
    CAST_CHAPTER_BY_NAME.update(CAST_ALIASES)
    CAST_CHAPTER_BY_NAME = {
        name: number
        for name, number in CAST_CHAPTER_BY_NAME.items()
        if number in PROVISIONAL_SPRITES
    }

SCREENS_SOURCE = (GAME / "screens.rpy").read_text(encoding="utf-8")
for _slot in range(1, STAGE_SLOTS + 1):
    if f"transform stem_stage_slot_{_slot}:" not in SCREENS_SOURCE:
        raise SystemExit(
            f"screens.rpy is missing transform stem_stage_slot_{_slot}; "
            f"the cast stage expects {STAGE_SLOTS} left-side slots"
        )


def cast_chapter(speaker: str) -> int | None:
    """Chapter slot whose approved render depicts this speaker, if any."""
    return CAST_CHAPTER_BY_NAME.get(_cast_key(speaker))


NARRATION_PAGE_CHARS = 290
DIALOGUE_PAGE_CHARS = 250


def _sentence_units(text: str, limit: int) -> list[str]:
    """Keep sentence beats intact; fall back to clause/word boundaries if needed."""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?…])\s+", text.strip()) if part.strip()]
    units: list[str] = []
    for sentence in sentences:
        if len(sentence) <= limit:
            units.append(sentence)
            continue
        clauses = [part.strip() for part in re.split(r"(?<=[;:—–,])\s+", sentence) if part.strip()]
        if len(clauses) > 1 and all(len(part) <= limit for part in clauses):
            units.extend(clauses)
            continue
        # An unusually long sentence is wrapped at a word boundary as the last
        # resort. Content is never clipped or discarded.
        current = ""
        for word in sentence.split():
            candidate = f"{current} {word}".strip()
            if current and len(candidate) > limit:
                units.append(current)
                current = word
            else:
                current = candidate
        if current:
            units.append(current)
    return units


def _pack(units: list[str], limit: int) -> list[str]:
    pages: list[str] = []
    current = ""
    for unit in units:
        candidate = f"{current} {unit}".strip()
        if current and len(candidate) > limit:
            pages.append(current)
            current = unit
        else:
            current = candidate
    if current:
        pages.append(current)
    return pages


def narrative_segments(text: str) -> list[str]:
    """Page at blank paragraphs and sentence beats, targeting 3–4 rendered lines."""
    pages: list[str] = []
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text.strip()) if part.strip()]
    for paragraph in paragraphs:
        pages.extend(_pack(_sentence_units(paragraph, NARRATION_PAGE_CHARS), NARRATION_PAGE_CHARS))
    return pages or [text.strip()]


def dialogue_segments(text: str) -> list[str]:
    """Keep spoken lines compact without splitting words or losing dialogue."""
    return _pack(_sentence_units(text, DIALOGUE_PAGE_CHARS), DIALOGUE_PAGE_CHARS) or [text.strip()]


def continued(text: str) -> str:
    """Use one ellipsis as an explicit next-page cue, avoiding doubled periods."""
    value = text.rstrip()
    if value.endswith("…"):
        return value
    if value.endswith("."):
        value = value[:-1]
    return value + "…"


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
gallery_choice = (
    "Galeria Technosutra (renders upstream excluídos)"
    if EXCLUDE_UPSTREAM_RENDERS
    else "Galeria de renders provisórios"
)

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
    'define narrator = Character("ORBE // NARRADOR", what_textshader="dissolve")',
]
for name in speakers:
    chapter_num = cast_chapter(name)
    if chapter_num:
        lines.append(f'define {speaker_ids[name]} = Character({quoted(name)}, image="master_ch{chapter_num:02d}")')
    else:
        lines.append(f"define {speaker_ids[name]} = Character({quoted(name)})")
lines.extend([
    "",
    'image narrator_orb = "images/narrator/orb.png"',
    'image stem_crowd_silhouette = "images/speakers/generic_speaker_shadow.png"',
    'image bg_intro_scene = "images/bg_intro_scene.jpg"',
])
for chapter in CHAPTERS:
    number = chapter["number"]
    lines.append(f'image bg_ch{number:02d} = "images/{chapter["background"]}"')
for number, asset in sorted(PROVISIONAL_SPRITES.items()):
    lines.append(f'image master_ch{number:02d}_provisional = "images/{asset["file"]}"')
# Side image declarations for automatic side image system
for number, asset in sorted(PROVISIONAL_SPRITES.items()):
    lines.append(f'image side master_ch{number:02d} = "images/{asset["file"]}"')
lines.extend([
    "",
    "# Temporary static portraits from raw transparent captures; no animation or lip-sync.",
    "# Stage placement lives in screens.rpy (stem_stage_slot_1..%d): the chapter" % STAGE_SLOTS,
    "# master stands at slot 1 and every mapped speaker who enters keeps their own",
    "# image tag, so a new portrait joins the stage instead of replacing the last one.",
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
    '            text "ARTE DE REFERÊNCIA" size 24 color "#ffd35a" bold True',
    '            text "render provisório · não indica presença na cena" size 16 color "#edf1ff"',
])

lines.extend([
    "",
    "label start:",
    "    hide screen master_provisional_badge",
    "    scene bg_intro_scene with dissolve",
    '    narrator "Um arquivo se abre."',
    '    narrator "Este prólogo usa um cenário original"',
    '    narrator "Percorreremos os 56 capítulos"',
    "    menu:",
    '        "Rever a abertura":',
    "            jump start",
    '        "Começar a jornada — capítulo 1":',
    "            jump chapter_01",
    '        "Galeria de renders provisórios":',
    "            jump technosutra_master_gallery",
    '        "Índice de capítulos":',
    "            jump chapter_index",
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

split_narration_blocks = 0
split_narration_parts = 0
split_dialogue_blocks = 0
split_dialogue_parts = 0
cast_shows = 0
for chapter in CHAPTERS:
    number = chapter["number"]
    quiz = chapter["minigame"]
    lines.extend([
        f"label chapter_{number:02d}:",
        "    hide screen master_provisional_badge",
        # Predize o fundo do capítulo antes de exibi-lo: no Web a decodificação
        # JPEG é serial na main thread, então iniciar a predição aqui evita o
        # stall de decode na primeira cena de cada capítulo.
        f"    $ renpy.start_predict(\"bg_ch{number:02d}\")",
        # `scene` limpa todos os retratos em pé do capítulo anterior. O
        # transform de câmera vivo faz o cenário real respirar (zoom lento
        # entrada/saída + olhar ao redor) enquanto os retratos ficam parados.
        f"    scene bg_ch{number:02d} at stem_bg_ch{number:02d}_camera with dissolve",
    ])
    # Cast stage for this chapter, in show order. The chapter's own master waits
    # at slot 1 from the first line; mapped speakers join in later slots. Any
    # speaker without a dedicated render falls back to the shared crowd silhouette,
    # shown once per chapter and kept standing beside the mapped masters.
    stage: list[int] = []
    silhouette_shown = False
    if number in PROVISIONAL_SPRITES:
        stage.append(number)
        lines.append(f"    show master_ch{number:02d}_provisional at stem_stage_slot_1 with dissolve")
        lines.append("    show screen master_provisional_badge")
    lines.append(f"    centered {quoted(title(chapter))}")
    for scene_index, scene in enumerate(chapter["scenes"], 1):
        scene_title = scene.get("scene_title_pt", f"Cena {scene_index}")
        lines.extend([
            f"    centered {quoted(f'Cena {scene_index} — {scene_title}')}",
        ])
        segments = narrative_segments(scene["narration_pt"])
        if len(segments) > 1:
            split_narration_blocks += 1
            split_narration_parts += len(segments)
        for segment_index, segment in enumerate(segments):
            if segment_index < len(segments) - 1:
                segment = continued(segment)
            lines.append(f"    narrator {quoted(segment)}")
        for dialogue in scene.get("dialogue", []):
            speaker = dialogue.get("speaker", "Narrador").strip() or "Narrador"
            speaker_id = "narrator" if speaker == "Narrador" else speaker_ids[speaker]
            # Render the speaking master when the manifest has their art; speakers
            # without a dedicated render fall back to the shared crowd silhouette.
            # A new `show` uses its own image tag, so earlier portraits stay standing.
            portrait = cast_chapter(speaker)
            if speaker == "Narrador":
                pass
            elif portrait is not None and portrait not in stage:
                if len(stage) >= STAGE_SLOTS:
                    raise SystemExit(
                        f"Chapter {number} needs more than {STAGE_SLOTS} standing "
                        f"portraits; add a stem_stage_slot_N transform in screens.rpy"
                    )
                stage.append(portrait)
                cast_shows += 1
                lines.append(
                    f"    show master_ch{portrait:02d}_provisional at stem_stage_slot_{len(stage)} with dissolve"
                )
            elif portrait is None and not silhouette_shown:
                if len(stage) >= STAGE_SLOTS:
                    raise SystemExit(
                        f"Chapter {number} needs more than {STAGE_SLOTS} standing "
                        f"portraits; add a stem_stage_slot_N transform in screens.rpy"
                    )
                stage.append(0)
                silhouette_shown = True
                cast_shows += 1
                lines.append(
                    f"    show stem_crowd_silhouette at stem_stage_slot_{len(stage)} with dissolve"
                )
            spoken = dialogue_segments(dialogue["line_pt"])
            if len(spoken) > 1:
                split_dialogue_blocks += 1
                split_dialogue_parts += len(spoken)
            for spoken_index, segment in enumerate(spoken):
                if spoken_index < len(spoken) - 1:
                    segment = continued(segment)
                lines.append(f"    {speaker_id} {quoted(segment)}")
    lines.extend([
        "    # Optional authored reflection; branches reconverge by design.",
        "    menu:",
        f"        {quoted(chapter['choice']['prompt_pt'])}:",
        "            pass",
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
            "    $ renpy.pause(4.0)",
            f"    jump chapter_{number + 1:02d}",
        ])
    else:
        lines.extend([
            '        "Voltar ao índice":',
            "            jump chapter_index",
            '        "Rever a dedicação final":',
            "            jump chapter_56",
        ])
    lines.extend([
        "",
        f"label quiz_ch{number:02d}:",
        f"    centered {quoted(quiz['title_pt'])}",
        f"    narrator {quoted(quiz['instruction_pt'])}",
        "    while True:",
        "        menu:",
        f"            {quoted(quiz['question_pt'])}:",
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
print(f"Paged {split_narration_blocks} scene narrations into {split_narration_parts} pages and {split_dialogue_blocks} long dialogue lines into {split_dialogue_parts} pages.")
print(
    f"Staged {cast_shows} additional cast portraits across "
    f"{len(CAST_CHAPTER_BY_NAME)} mapped speaker names; {STAGE_SLOTS} left-side slots."
)
