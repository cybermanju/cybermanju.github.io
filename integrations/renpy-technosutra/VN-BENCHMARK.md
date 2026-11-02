# Ren'Py benchmark — what the strongest open-source VNs actually do

Measured 2026-11-02 against live GitHub data, not memory. Method: five repository
searches through the GitHub API (`topic:renpy`, `topic:renpy-game`,
`topic:renpy-visual-novels`, `topic:visual-novel language:Ren'Py`,
`renpy game in:name,description`), 100 unique repositories, then raw
`game/screens.rpy` + `game/options.rpy` pulled from the highest-signal projects
and profiled mechanically. Engine behaviour cross-checked against
[Screen Language Optimization](https://www.renpy.org/doc/html/screen_optimization.html)
and [Web / HTML5](https://www.renpy.org/doc/html/web.html).

Sample caveat: almost all commercial and well-known Ren'Py VNs ship closed
sources, so GitHub stars measure *tooling* more than *games*. Treat this as a
pressure test of patterns, not a popularity contest.

## 1. Star landscape (unique repos, 2026-11-02)

| stars | repo | what it is |
|---:|---|---|
| 6965 | `renpy/renpy` | the engine |
| 1138 | `freeCodeCamp/LearnToCodeRPG` | largest open VN game |
| 772 | `Lattyware/unrpa` | RPA archive extractor (tooling) |
| 384 | `methanoliver/awesome-renpy` | link list (tooling) |
| 301 | `anonymousException/renpy-translator` | translation tooling |
| 283 | `MewX/cross-channel_…` | CROSS†CHANNEL localisation port |
| 204 | `SecondThundeR/DokiDoki-RenPy` | decompiled DDLC |
| 150 | `RuolinZheng08/renpy-rhythm` | rhythm engine on Ren'Py |
| 125 | `fleetingheart/ksre` | Katawa Shoujo Re-Engineered mirror |
| 104 | `RuolinZheng08/renpy-template` | starter template (feather GUI) |
| 100 | `saber-nyan/ddlc-android` | DDLC Android port |

The lesson is in the top ten: **the stars belong to tooling and templates**, so
the useful comparison set is the three projects that are real, long-form,
maintained VN codebases — `LearnToCodeRPG`, `renpy-template` (same lineage, both
the stock-GUI evolved shape) and `ksre` (mature narrative VN with a huge script
tree: 309 `.rpy` files).

## 2. Technique profile of the reference games

Mechanical counts from each project's `game/screens.rpy`:

| project | lines | screens | styles | `Frame(` | `Tile(` | viewport | `variant` | `key` | `Preference(` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| LearnToCodeRPG | 1631 | 24 | 196 | 25 | 0 | 11 | 19 | 2 | 16 |
| renpy-template | 1524 | 23 | 195 | 25 | 0 | 11 | 19 | 3 | 16 |
| ddlc-android | 1617 | – | – | 15 | 0 | 9 | – | 5 | 13 |
| ksre | 1296 | 23 | – | – | – | 5 | – | 14 | 15 |

Project shape:

| project | `.rpy` files | `gui/` textures | `progressive_download.txt` |
|---|---:|---:|---|
| ksre | 309 | 79 | yes (reviewed) |
| LearnToCodeRPG | 60 | 82 | no (defaults) |
| renpy-template | 11 | 78 | no (defaults) |
| ddlc-android | 35 | 100 | no (defaults) |
| CROSS†CHANNEL port | 302 | 0 | no (defaults) |

## 3. Findings, strongest first

**F1 — `Tile(` is used zero times across every benchmarked game; `Frame(` 15–25
times each.** Stretching a panel is always a nine-quad `Frame`, never a repeated
tile. This VN was tiling all 16 panel textures, which repeated each border and
corner ornament across every dialogue box and choice card. Fixed: all surfaces
now use `Frame()`.

**F2 — UI chrome is force-loaded before play.** Ren'Py's default
`progressive_download.txt` starts with `- image game/gui/**` and only then
`+ image game/**`, so interface textures are resident before the first
interaction; everything else streams. This project ships **no `gui/`** — its
chrome lives in `images/ui/` — so all 17 chrome textures fell through to
`+ image game/**` and were streamed *mid-interaction*. That is a direct
mechanism for a first choice screen showing pixellated placeholders or nothing.
Fixed: reviewed `progressive_download.txt` now marks `images/ui/**` and
`images/speakers/**` immediate, and `validate_web_candidate.py` fails a candidate
that lets UI chrome stream.

**F3 — Responsive layout is done with `variant`, not with runtime conditionals.**
Both 1600-line reference screen files carry 19 `variant "small"` blocks, and
`style` blocks outnumber screens ~8:1 (196 styles / 24 screens). Our
`screens.rpy` was computing sizes through `$` locals and `stem_compact_layout()`
at show time — the same information, but re-evaluated instead of baked into
styles. Directionally aligned (15 `variant` blocks now); the remaining
`$`-computed sizes are the next cleanup.

**F4 — Web has no background image loading, so prediction is the only smoothing
tool.** The engine docs are explicit: no threads on the web port, "image loading
may cause framerate glitches". `ddlc-android` raises `config.predict_statements`
to 50 for this reason. Our 56 backgrounds decode to ~8.3 MB of RGBA each, so
prediction is doing real work; worth profiling with `renpy.profile_screen`
before changing the number.

**F5 — `window_show_transition`/`window_hide_transition` stay at the engine
default `Dissolve(.2)` in all four projects that set them.** An earlier change in
this repo disabled them on the theory that they re-composite the full frame on
every line; that was wrong — the transition applies to the window layer on
show/hide events, not to each line. Reverted to engine defaults.

**F6 — Long-form VNs separate chrome from story by scale of *files*, not of
*statements*.** ksre ships 309 `.rpy` files and 79 `gui/` textures; the interface
layer is 23 screens and ~1300 lines. Our single `screens.rpy` is 700+ lines and
21 screens — inside the reference band, so splitting it is not a priority;
keeping it style-driven is.

**F7 — Preferences are the most-touched surface (13–16 `Preference(` calls per
project).** Ours has 12 and, on the small variant, hides them behind tabs. No
action needed beyond what shipped, but it explains why the small-variant tab
layout matters more than it looks.

**F8 — Keyboard bindings are a differentiator for the mature project.** ksre
binds 14 `key` statements; the template/derived projects bind 2–3. Our screens
bind `game_menu` (pause), `dismiss`, page keys in viewports and arrow-key focus
by default. Adding explicit `key` bindings for `h` (hide UI), `v` (skip) and
`history` is cheap accessibility.

**F9 — `layeredimage` is absent from all of these (0 occurrences).** Sprite
expression systems are built with ATL transforms and `if`-switched `show`
statements at this scale. Our static 600×800 renders + a provisional badge sit
fine inside that norm; the "no mouth/posture variants" limitation is a content
decision, not an engine one.

**F10 — Engine-version hygiene: all samples pin a `gui/` tree and rely on the
stock GUI generator.** We deliberately do not, which is why F1/F2 bit us: the
project depends on conventions (`gui/**` immediate, tiled panels replaced by
frames) that only exist when you keep the stock GUI. Any future texture work
should follow the stock conventions or extend the validator, as done here.

## 4. Prioritised next steps

**P0 — done in this pass**
`Frame` instead of `Tile`; no focus masks on text buttons; UI chrome preloaded;
title cards moved onto `centered_window`/`centered_text`; dialogue sized to
content instead of clipped; validator gates for undelivered and streamed UI.

**P1 — highest expected value next**
1. Move the remaining `$`-computed sizes in `say`/`choice` into `variant` style
   blocks (F3) so Ren'Py's const/displayable-reuse optimisation can skip
   re-evaluation (the docs call this out as the largest screen-language win).
2. Profile before tuning: `renpy.profile_screen("say", show=True, time=True)` and
   `("choice", show=True, time=True)` in a dev build, then decide on
   `config.image_cache_size` / `config.predict_statements` from numbers (F4).
3. Explicit keyboard keys for hide-UI / history / skip (F8).

**P2 — content and reach**
4. Sprite expression variants via ATL (`show` + `at`) once art exists (F9).
5. A display face for titles next to DejaVuSans for the body — every reference
   project ships custom fonts under `game/fonts/`; ours uses the engine font for
   a 56-chapter literary text.
6. Translation scaffolding: `game/tl/` exists in `LearnToCodeRPG`; the engine's
   `translate` pipeline would let this VN ship an English pass without forking
   the script.

## 5. What this benchmark cannot tell us

Star counts rank tooling, not craft. Render-time cost cannot be read off source;
it needs `renpy.profile_screen` output from a real Web build, which this
environment cannot produce (the SDK is CI-only per `AGENTS.md` §2). Every claim
above about *layout correctness* is structural and checkable; every claim about
*speed* is a hypothesis with a stated way to measure it.
