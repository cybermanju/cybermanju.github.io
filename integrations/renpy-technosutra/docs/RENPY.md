# Ren'Py in The Stem Array — what we use and how

This is the project-level map of the VN's Ren'Py usage. The full upstream
reference is mirrored beside this file in [`renpy-docs/`](renpy-docs/index.html).

- **Engine:** Ren'Py **8.5.3** (`project.json` → `compactBuild.renpyVersion`;
  pinned by `tools/install_renpy_sdk.sh` and `.github/workflows/renpy-ci.yml`).
- **Project root:** `integrations/renpy-technosutra/`.
- **Story source:** `chapters.json` — 56 chapters, 246 scenes, 582 authored
  dialogue lines, 56 reflection choices, 56 quizzes, 94 named speakers.
- **Scripts:** `game/script.rpy` and `game/technosutra_masters.rpy` are
  **generated at build time** (gitignored); the committed logic is in
  `game/options.rpy`, `game/screens.rpy`, `game/bg_camera_transforms.rpy`,
  `game/stem_theme_bridge.rpy`, `game/ci_telemetry.rpy` and `tools/`.
- **Delivery:** Ren'Py WebAssembly bundle in `public/technosutra-vn/`, embedded
  by the Vue shell `src/components/TechnosutraStudio.vue`.

## 1. End-to-end flow

```
chapters.json ──► tools/generate_renpy_script.py ──► game/script.rpy
                tools/generate_master_sprite_script.py ──► game/technosutra_masters.rpy
game/*.rpy + generated scripts + images
        │
        ▼
tools/prepare_assets.py, validate_optimized_assets.py, prepare_local_build.py
        │
        ▼
Ren'Py SDK: `renpy.sh <project> lint --error-code`
        │
        ▼
Ren'Py SDK launcher: `web_build --destination <staging>`
        │
        ▼
service worker stamp + loading overlay + candidate validator + Playwright smoke
        │
        ▼
public/technosutra-vn/ ──► iframe ──► Vue TechnosutraStudio
```

`build_web.sh` is the entry point. It never writes to `public/`; it builds and
validates a candidate under `build/local/<BUILD_ID>/output/`. The checked-in
`public/technosutra-vn/` is the published bundle the app serves.

Upstream pages for this flow: [`quickstart.html`](renpy-docs/quickstart.html),
[`build.html`](renpy-docs/build.html), [`web.html`](renpy-docs/web.html),
[`cli.html`](renpy-docs/cli.html), [`downloader.html`](renpy-docs/downloader.html).

## 2. Project configuration — `game/options.rpy`

| What | Value | Why |
|---|---|---|
| `config.name` / `config.window_title` | "The Stem Array — Technosutra VN" / "The Stem Array · Gaṇḍavyūha" | Window and About title |
| `config.version` | `0.1.0` | Matches the repository version |
| `config.screen_width` / `screen_height` | 1920 × 1080 | Design grid; the UI responds below it |
| `config.default_text_cps` | 45 | Default reveal speed |
| `config.window` | `"auto"` | Dialogue window auto show/hide |
| `config.save_directory` | `technosutra-stem-array-1` | Isolated save location |
| `config.rollback_enabled` | `True` | Back/rollback support |
| `config.has_autosave` / `has_quicksave` | `True` | AUTO and RÁPIDOS save pages |
| `config.has_sound` / `has_music` / `has_voice` | `False` | This build ships no audio |
| `config.image_cache_size_mb` | 512 | Hold decoded 1920×1080 backgrounds instead of re-decoding on chapter change |
| `config.predict_statements` | 64 | Preload upcoming chapters on the single-threaded Web player |
| `config.mipmap` | `True` | Keep zoomed camera moves from aliasing |
| `config.overlay_screens` | `quick_menu`, `stem_theme_sync` | Always-on controls and OS theme sync |
| `config.default_textshader` | `"dissolve:u__duration=8.0"` | Built-in dissolve shader for slow text |
| `config.side_image_tag` | `"master"` | Side image follows master character |
| `config.side_image_only_not_showing` | `True` | Only show side image when master not on screen |
| `config.tts_voice` | `None` | Hook for future self-voicing/TTS |

`init python` also runs `build.classify(...)` to keep raw masters, source
backgrounds, previews, saves, tools and manifests out of the distributable.

Upstream: [`config.html`](renpy-docs/config.html),
[`screen_optimization.html`](renpy-docs/screen_optimization.html),
[`textshaders.html`](renpy-docs/textshaders.html),
[`side_image.html`](renpy-docs/side_image.html).

## 3. Story script — generated from `chapters.json`

`tools/generate_renpy_script.py` emits plain Ren'Py script, so the narrative is
data-driven while the engine stays a normal Ren'Py project.

| Ren'Py construct | Use in the VN |
|---|---|
| `define narrator = Character(...)` | ORBE narrator voice with `what_textshader="dissolve"` |
| `define speaker_NNN = Character("Name", image="master_chNN")` | One character per authored speaker (94), linked to master art |
| `image bg_chNN = "images/optimized/bg_chNN.jpg"` | 56 chapter backgrounds + original intro |
| `image master_chNN_provisional = ...` | 54 static cast renders (full-body) |
| `image side master_chNN = ...` | 54 side images for automatic side image system |
| `label start` | Opening scene and main menu hand-off |
| `label chapter_index`, `label chapter_group_NN` | Chapter index and 10-chapter groups |
| `label chapter_NN` | One label per chapter |
| `label quiz_NN` | One reading quiz per chapter |
| `menu:` / choice options | Opening menu, chapter navigation, reflection choice, quiz loop |
| `jump`, `call ... return`, `while True` | Navigation, quiz subroutine, retry loop |
| `scene bg_chNN at stem_bg_chNN_camera with dissolve` | Chapter scene + camera move |
| `show master_chNN_provisional at stem_stage_slot_N with dissolve` | Additive cast staging (multi-speaker) |
| `show screen master_provisional_badge` | "provisional art" label |
| `centered "..."` | Chapter and scene title cards |
| `$ renpy.start_predict("bg_chNN")` | Preload the next chapter background |

The generator splits long narration/dialogue into sentence-aware pages (290/250
characters) and marks a continued page with an ellipsis rather than clipping
text. Reflection choices reconverge by design; quizzes are `while True` menus
that `return` only on the correct option.

Upstream: [`language_basics.html`](renpy-docs/language_basics.html),
[`label.html`](renpy-docs/label.html), [`dialogue.html`](renpy-docs/dialogue.html),
[`menus.html`](renpy-docs/menus.html), [`cds.html`](renpy-docs/cds.html).

## 4. Dialogue, title cards and characters

`game/screens.rpy` replaces Ren'Py's stock `say` screen with a custom one:

- keeps the contract ids `"who"` and `"what"` (required by the engine and by
  accessibility/screen readers);
- draws a `window` with the pixel dialogue 9-slice, a nameplate frame, a
  narrator orb, and an optional mapped speaker portrait;
- **adds automatic side image display** via `SideImage()` when a speaking
  character has an `image=` parameter on their `Character()` definition;
- sets `stem_last_dialogue_text` so the `choice` screen can show the prompt that
  produced the menu;
- scales only the dialogue body through `persistent.stem_text_step`
  (`PADRÃO` / `MAIOR` / `MUITO MAIOR`), leaving menus stable.

Chapter/scene title cards use Ren'Py's built-in `centered` **Character**, not a
custom screen. The look comes from `centered_window` and `centered_text` styles.
(`screen centered(...)` would never be shown by `centered "..."`; the styles are
the supported hook.)

Upstream: [`dialogue.html`](renpy-docs/dialogue.html),
[`screens.html`](renpy-docs/screens.html), [`text.html`](renpy-docs/text.html),
[`side_image.html`](renpy-docs/side_image.html).

## 5. Images, sprites and ATL transforms

| Asset set | Count | Location |
|---|---:|---|
| Optimized chapter backgrounds | 56 | `game/images/optimized/` |
| Original opening background | 1 | `game/images/bg_intro_scene.jpg` |
| Provisional cast renders | 54 (chapters 43 and 52 absent) | `game/images/masters/sprites/provisional/` |
| Side images (auto from provisional) | 54 | `game/images/masters/sprites/provisional/` |
| Particle system assets | 3 base + transforms | `game/stem_particles.rpy` (ATL-only, no images) |
| Pixel UI 9-slice textures | 24 (+ `manifest.json`) | `game/images/pixel/` |
| Narrator orb / crowd silhouette | 2 assets | `game/images/narrator/`, `game/images/speakers/` |
| Legacy/velvet UI textures | 30 (+ provenance) | `game/images/ui/` (kept for classify/legacy rules) |

- `Frame("images/pixel/*.png", left, top)` is used for every panel; `Tile()` is
  deliberately avoided so borders are not repeated across a stretched panel.
- `stem_stage_slot_1..4` are ATL transforms that place up to four standing
  portraits along the dialogue box. A new `show` with its own image tag is
  additive, so entering speakers join the stage instead of replacing the last
  one. `scene` clears the stage at each chapter.
- `game/bg_camera_transforms.rpy` generates 56 `stem_bg_chNN_camera` transforms:
  slow `zoom` / `xalign` / `yalign` moves using `ease` and **explicit `pause` at end**,
  so the background settles to a static texture while the reader is on that chapter
  — no per-frame compositor work during dialogue, and no "stuck image" on scene change.
- `stem_title_drift` gives the main menu the same slow zoom as the loading art.
- **Particle system** (`game/stem_particles.rpy`): ATL-only, zero-WASM-cost ambient particles
  (`stem_dust_motes`, `stem_light_sparkles`, `stem_falling_petals`) and burst effects
  (`stem_particle_burst`) for quiz correct/chapter complete. Respects `prefers-reduced-motion`
  and `stem_theme_mode` (flat/glass color palettes). Layered between `master` and `screens`.

Upstream: [`displaying_images.html`](renpy-docs/displaying_images.html),
[`transforms.html`](renpy-docs/transforms.html),
[`transform_properties.html`](renpy-docs/transform_properties.html),
[`transitions.html`](renpy-docs/transitions.html),
[`displayables.html`](renpy-docs/displayables.html).

## 6. Screens and screen language

`game/screens.rpy` defines 23 screens:

| Screen | Purpose |
|---|---|
| `say(who, what)` | Custom dialogue box with narrator orb / portrait / side image / **ambient particles** |
| `choice(items)` | Modal choice card, numbered options, 1–9 shortcuts |
| `stem_choice_rows(items, small)` | Reusable option list |
| `quick_menu()` | MENU / HISTÓRICO / AUTO / PULAR overlay |
| `stem_controls()` | In-game pause panel |
| `main_menu()` | Title art, navigation, character panel |
| `navigation()` | Context-aware main-menu / in-game navigation |
| `game_menu(title, ...)` | Shared frame using `transclude` and a scrolling viewport |
| `save()` / `load()` | File slots |
| `file_slots(title)` / `stem_file_slot_card(...)` | Page input, 3×2 slot grid, page tabs |
| `preferences()` | Visual / text / audio / theme tabs |
| `stem_theme_controls(...)` | Pixel vs. glass appearance controls |
| `history()` | Last 120 history entries, newest first |
| `help()` | Keyboard and touch reference |
| `about()` | Credits and adaptation note |
| `confirm(...)`, `input(...)`, `notify(...)`, `skip_indicator()` | System overlays |
| `master_provisional_badge()` | Generated provisional-art badge |
| **`stem_particle_overlay()`** | Global ambient particle field (respects reduced-motion) |
| **`stem_chapter_particles()`** | Subtle per-chapter dust motes/sparkles |
| **`stem_burst_particles()`** | Quiz-correct / chapter-complete burst effect |

Screen-language features in use:

- layout: `frame`, `window`, `vbox`, `hbox`, `grid`, `viewport`, `use`,
  `transclude`, `null`, `add`;
- interaction: `textbutton`, `button`, `input`, `bar`, `key`, `key_events`,
  `timer`, `hover_background`;
- actions: `Start`, `ShowMenu`, `Return`, `MainMenu`, `Quit`, `Jump`, `Hide`,
  `Skip`, `FileAction`, `FilePage`, `FilePagePrevious`, `FilePageNext`,
  `FilePageNameInputValue`, `FileDelete`, `Preference`, `SetVariable`,
  `SetScreenVariable`, `SetField`, `InvertSelected`, `Function`;
- values: `FileLoadable`, `FileScreenshot`, `FileTime`, `FileSaveName`,
  `_history_list`;
- responsiveness: `renpy.variant("mobile" / "small" / "pc" / "web")`,
  `renpy.get_physical_size()`, `renpy.get_screen("choice")`;
- styles: named `style ... is ...`, `style_prefix`, 9-slice `Frame`
  backgrounds, `Solid(...)`, bundled fonts (DejaVu Sans and monospace faces).
- **screen optimization**: `define` constants for all style properties,
  `@renpy.pure` decorators on helper functions, const text patterns.
- **particle system**: ATL-only transforms, `renpy.show_layer_at()` for spawning,
  `config.layers` registration for `particles` layer, `prefers-reduced-motion` guard.

Upstream: [`screens.html`](renpy-docs/screens.html),
[`screen_actions.html`](renpy-docs/screen_actions.html),
[`screen_python.html`](renpy-docs/screen_python.html),
[`screen_special.html`](renpy-docs/screen_special.html),
[`style.html`](renpy-docs/style.html),
[`style_properties.html`](renpy-docs/style_properties.html),
[`screen_optimization.html`](renpy-docs/screen_optimization.html).

## 7. Save/load, preferences, history and persistence

- **Save/load:** six slots per page, `FileAction`, page name input, page 1–9
  tabs plus `AUTO` and `RÁPIDOS` pages (enabled by `config.has_autosave` /
  `has_quicksave`). `save_delete` deletes a slot.
- **Preferences:** display mode, skip mode, skip-after-choices, transitions,
  text speed and auto-forward bars; a persistent three-step dialogue text size;
  audio controls render only if an audio channel exists (it does not here); a
  theme tab switches pixel/glass or follows the OS.
- **History:** `_history_list` is rendered newest-first, bounded to the last 120
  entries, with `substitute False` so old text is not re-interpolated.
- **Persistent state:** `persistent.stem_text_step` (reader text size),
  `stem_theme_mode`, `stem_theme_accent`, `stem_theme_override`, plus the
  `quick_menu` flag. `default`/`define` values live in `screens.rpy`.

Upstream: [`save_load_rollback.html`](renpy-docs/save_load_rollback.html),
[`preferences.html`](renpy-docs/preferences.html),
[`history.html`](renpy-docs/history.html),
[`persistent.html`](renpy-docs/persistent.html),
[`store_variables.html`](renpy-docs/store_variables.html).

## 8. Python and Ren'Py API

`init python` / `init -100 python` / `init offset = -1` are used for definition
ordering (bridge and telemetry first, screens before defaults).

Runtime API calls used:

| API | Where / why |
|---|---|
| `Character`, `centered` | Generated characters and title cards |
| `renpy.variant`, `renpy.get_physical_size` | Responsive layout |
| `renpy.get_screen("choice")` | Hide quick menu under a choice |
| `renpy.start_predict`, `renpy.start_predict_screen` | Background and screen preloading |
| `renpy.profile_screen` | Developer-only say/choice profiling |
| `renpy.emscripten.run_script`, `run_script_string` | JS theme bridge and CI telemetry |
| `renpy.get_showing_tags`, `get_attributes`, `get_say_image_tag` | CI observation of the staged cast |
| `config.overlay_screens`, `config.all_character_callbacks` | Register overlays and the read-only observer |
| `_()`, `[config.version]`, `[message!tq]` | Minimal translation hook and text interpolation |
| `renpy.pure`, `renpy.const` | Screen optimization decorators |
| `SideImage()` | Automatic side image displayable |
| `config.default_textshader` | Built-in dissolve text shader |
| `config.side_image_tag` | Side image tracking config |

The theme bridge (`game/stem_theme_bridge.rpy`) installs a browser
`postMessage` listener once, marks the theme dirty, and a 0.9 s `timer` screen
polls one JS flag. Failure always falls back to the local/default theme. The CI
observer (`game/ci_telemetry.rpy`) registers a `show_done` character callback
only while `config.developer` is true, so shipped builds make no per-line
WASM↔JS calls.

**Particle system** (`game/stem_particles.rpy`):
- `renpy.show_layer_at()` — spawns particle transforms on `particles` layer
- `config.layers` — registers `particles` layer between `master` and `screens`
- `renpy.variant("reduced-motion")` — guards all particle effects
- `stem_trigger_burst()` — Python action for quiz-correct burst
- `_stem_burst_trigger` — store variable for burst state
- All transforms use `pause`/`repeat` for proper ATL lifecycle

Upstream: [`python.html`](renpy-docs/python.html),
[`screen_python.html`](renpy-docs/screen_python.html),
[`character_callbacks.html`](renpy-docs/character_callbacks.html),
[`developer_tools.html`](renpy-docs/developer_tools.html),
[`lifecycle.html`](renpy-docs/lifecycle.html),
[`transforms.html`](renpy-docs/transforms.html).

## 9. Web build, PWA and host integration

- `build_web.sh` runs `lint --error-code` and the SDK launcher's `web_build`.
  It copies the reviewed `progressive_download.txt`, service worker and loading
  overlay into the candidate before validation.
- `progressive_download.txt` pins UI chrome + narrator orb + speaker fallback +
  pixel frames to immediate load (`- image game/images/...`) and streams everything
  else (`+ image game/**`). **56 optimized backgrounds + 54 side images + 54 master
  sprites + particle system (ATL-only, no images) stream on demand.**
- `web/service-worker.js` precaches `index.html`, `manifest.json`,
  `renpy-pre.js`, `renpy.js`, `renpy.wasm`, `renpy.data`, `game.zip`,
  `web-presplash.jpg`, the loading overlay and icons. The 111 progressive
  chapter/sprite images are cached on first use, not at install. Navigation and
  `pwa_catalog.json` stay network-first; Range requests are never intercepted;
  the cache name is a content stamp written by `tools/stamp_service_worker.py`.
- `web/loading/` supplies the bootstrap overlay. `tools/inject_loading_overlay.py`
  splices it into the generated `index.html`; it mirrors Ren'Py's own
  `#statusDiv` / `#statusTextDiv` / `#statusProgress` download status.
- `tools/validate_web_candidate.py` checks ZIP integrity, the 111 full-size
  images, placeholder/download mappings and hashes. `tools/smoke_web_build.py`
  serves the candidate to Chromium via Playwright.
- `src/components/TechnosutraStudio.vue` loads `public/technosutra-vn/index.html`
  in an iframe, posts `stem-array:theme` messages, and listens for
  `stem-array:ready`. `src/data/technosutra-vn.ts` is the local fallback build
  metadata; main CI replaces it with same-run SHA metadata.

Upstream: [`web.html`](renpy-docs/web.html), [`build.html`](renpy-docs/build.html),
[`downloader.html`](renpy-docs/downloader.html),
[`screen_optimization.html`](renpy-docs/screen_optimization.html).

## 10. What the VN deliberately does **not** use

Keeping this list explicit prevents accidental scope creep:

- **No audio at all** — no music, sound, voice or audio channels
  (`config.has_* = False`); the preferences audio tab is hidden.
- **No default GUI** — there is no `game/gui/`; the pixel UI is hand-built in
  `screens.rpy` (see [`gui.html`](renpy-docs/gui.html) for the stock system we
  replace).
- **No NVL mode, layered images, Live2D, 3D Stage, shaders, `matrixcolor`,
  movies or drag-and-drop** — the VN is 2D stills plus ATL transforms.
- **No achievements, IAP, updater or mobile packaging** in this integration;
  the Web build is hosted by CyberManju OS and the desktop app embeds it.
- **No runtime translation framework** — UI and story are authored in
  Portuguese; `_()` is used only for the `confirm` message hook.

## 11. Feature → documentation quick index

| You want to change… | Read |
|---|---|
| Dialogue box, choice cards, any menu | [`screens.html`](renpy-docs/screens.html), [`screen_actions.html`](renpy-docs/screen_actions.html) |
| Story labels, jumps, menus, quizzes | [`label.html`](renpy-docs/label.html), [`menus.html`](renpy-docs/menus.html) |
| Generated script text | [`dialogue.html`](renpy-docs/dialogue.html), [`text.html`](renpy-docs/text.html) |
| Backgrounds/sprites and their paths | [`displaying_images.html`](renpy-docs/displaying_images.html) |
| Camera moves and portrait slots | [`transforms.html`](renpy-docs/transforms.html), [`transform_properties.html`](renpy-docs/transform_properties.html) |
| Saves, history, preferences | [`save_load_rollback.html`](renpy-docs/save_load_rollback.html), [`preferences.html`](renpy-docs/preferences.html), [`history.html`](renpy-docs/history.html) |
| Persistent text size / theme | [`persistent.html`](renpy-docs/persistent.html) |
| Performance and preloading | [`screen_optimization.html`](renpy-docs/screen_optimization.html) |
| Text shaders (dissolve, wave, jitter, etc.) | [`textshaders.html`](renpy-docs/textshaders.html) |
| Side images (auto character portraits) | [`side_image.html`](renpy-docs/side_image.html) |
| **Particle system (ATL-only, zero WASM cost)** | [`transforms.html`](renpy-docs/transforms.html), [`screens.html`](renpy-docs/screens.html) |
| Web build, PWA cache, progressive load | [`web.html`](renpy-docs/web.html), [`build.html`](renpy-docs/build.html), [`downloader.html`](renpy-docs/downloader.html) |
| Full API name lookup | [`genindex.html`](renpy-docs/genindex.html), [`py-function-class-index.html`](renpy-docs/py-function-class-index.html) |

## 12. Recent improvements (2026-11-08)

### Screen Language Optimization
- Added `define` constants for all style properties (BUTTON_XPAD, DIALOGUE_XMAX_PC, etc.)
- Added `@renpy.pure` decorators on `stem_compact_layout`, `stem_option_label`, `stem_body_size`
- Const text patterns using `[var]` interpolation instead of variable references
- **Impact:** Significant Web/WASM performance improvement — screen evaluation now reuses const displayables

### Text Shaders
- Enabled built-in `dissolve` text shader via `config.default_textshader`
- Narrator character uses `what_textshader="dissolve"` for distinctive voice
- Available built-ins: `dissolve`, `flip`, `jitter`, `linetexture`, `wave`, `rainbow`, `shimmer`
- **Usage:** Inline via `{shader=wave}text{/shader}` or per-style `textshader "wave"`

### Side Images
- Added `image side master_chNN` declarations for all 54 provisional renders
- Character definitions now include `image="master_chNN"` parameter
- `say` screen displays `SideImage()` automatically when speaker has linked image
- `config.side_image_tag = "master"` and `config.side_image_only_not_showing = True`
- **Impact:** Eliminates manual `show` statements for single-speaker scenes; automatic expression support

### ATL Particle System (NEW)
- **File:** `game/stem_particles.rpy` — pure ATL, zero WASM main-thread cost
- **Ambient particles:** `stem_dust_motes`, `stem_light_sparkles`, `stem_falling_petals` (subtle, thematic)
- **Burst effects:** `stem_particle_burst` for quiz correct / chapter complete
- **Screens:** `stem_particle_overlay`, `stem_chapter_particles`, `stem_burst_particles`
- **Theme-aware:** `flat` (dark cyan) vs `glass` (lighter cyan) color palettes via `stem_theme_mode`
- **Accessibility:** Respects `prefers-reduced-motion` via `renpy.variant("reduced-motion")`
- **Layering:** `particles` layer registered between `master` and `screens` via `config.layers`
- **Trigger:** `stem_trigger_burst()` action for quiz-correct feedback
- **Impact:** Atmospheric depth without performance cost; 0 JS/WASM overhead

### Camera Transform Fix
- Added explicit `pause` at end of all 56 `stem_bg_chNN_camera` transforms
- **Fixes:** "stuck image" on chapter change — transforms now properly settle to final state
- **Behavior:** Ken-burns move runs once, then `pause` holds final zoom/position until next `scene`
- **Performance:** No per-frame compositor work during dialogue (as designed)

### Accessibility Hooks
- Added `config.tts_voice = None` for future self-voicing/TTS integration
- Text size scaling (3 steps) already implemented via `persistent.stem_text_step`
- Keyboard navigation (1-9 shortcuts, arrow keys, Tab, Enter) fully supported
- Screen reader compatible `who`/`what` IDs maintained in `say` screen

---

*This document reflects Ren'Py 8.5.3 features as documented in the 8.5.4 docs mirror.*