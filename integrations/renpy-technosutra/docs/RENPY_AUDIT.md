# Ren'Py Feature Audit — The Stem Array VN
**Date:** 2026-11-08  
**Current SDK:** 8.5.3 (pinned)  
**Latest Available:** 8.5.4  
**Docs Mirror:** `docs/renpy-docs/` (8.5.4 snapshot)

---

## Executive Summary

The VN currently uses Ren'Py 8.5.3 with a solid but conservative feature set. The mirrored docs are for 8.5.4. This audit identifies gaps between the implementation and modern Ren'Py capabilities, with priority recommendations for upgrading to 8.5.4 and adopting new features.

---

## 1. Version Upgrade Required

| File | Current | Target | Action |
|------|---------|--------|--------|
| `project.json` | `"renpyVersion": "8.5.3"` | `"renpyVersion": "8.5.4"` | Update |
| `tools/install_renpy_sdk.sh` | `SDK_VERSION="8.5.3"` | `SDK_VERSION="8.5.4"` | Update + new SHA256 |
| `tools/install_renpy_sdk.sh` | `SDK_URL` (8.5.3) | 8.5.4 URL | Update |
| `tools/install_renpy_sdk.sh` | `WEB_URL` (8.5.3) | 8.5.4 URL | Update |
| `.github/workflows/renpy-ci.yml` | 8.5.3 references | 8.5.4 | Update |

**8.5.4 Changes:** Live2D Bezier curve fix (Cardano interpretation), textshader cps respect fix. No breaking changes for our use case (no Live2D, no complex textshaders yet).

---

## 2. Feature Gap Analysis

### 2.1 Screen Language Optimization (HIGH PRIORITY)

**Current State:** No `renpy.const()`, `renpy.pure()`, or `define` for const values used in screens.

**Docs Reference:** [`screen_optimization.html`](renpy-docs/screen_optimization.html#const-expressions-and-pure-functions)

**Missing:**
- `renpy.const()` / `renpy.pure()` decorators for pure functions
- `define` statements for constants used in screen properties
- Const text patterns (`text "[var]"` vs `text var`)
- Pure function annotations for screen helpers

**Impact:** Significant performance gains on Web/WASM where screen evaluation runs on main thread.

**Files to Update:**
- `game/screens.rpy` — all style definitions, screen definitions, helper functions
- `game/options.rpy` — config values used in screens

**Example Migration:**
```renpy
# Before
style button:
    xpadding 26
    ypadding 16

# After
define BUTTON_XPAD = 26
define BUTTON_YPAD = 16
style button:
    xpadding BUTTON_XPAD
    ypadding BUTTON_YPAD

# For functions
init python:
    @renpy.pure
    def stem_compact_layout():
        ...
```

---

### 2.2 Text Shaders (MEDIUM PRIORITY)

**Current State:** No text shaders used. Default text rendering only.

**Docs Reference:** [`textshaders.html`](renpy-docs/textshaders.html#built-in-text-shaders)

**Available Built-ins:**
| Shader | Effect | Use Case |
|--------|--------|----------|
| `dissolve` | Slow fade-in by character | Narrator/orbe voice |
| `flip` | Horizontal flip-in | Quiz feedback |
| `jitter` | Random position shake | Glitch/distress scenes |
| `linetexture` | Texture overlay per line | Title cards, emphasis |
| `wave` | Sine wave motion | Dream/memory sequences |
| `rainbow` | Color cycling | Mystical/special text |
| `shimmer` | Subtle glow pulse | Important terms |

**Implementation:**
```renpy
# In options.rpy
define config.default_textshader = "dissolve:u__duration=8.0"

# Per-character
define narrator = Character("ORBE // NARRADOR", what_textshader="dissolve")

# Per-style
style say_dialogue:
    textshader "dissolve"

# Inline via text tag
"Normal {shader=wave:u__duration=5}wave{/shader} normal"
```

**Files to Update:** `game/options.rpy`, `game/screens.rpy`, generated `script.rpy`

---

### 2.3 Side Images (HIGH PRIORITY)

**Current State:** Custom portrait staging via `stem_stage_slot_N` transforms and manual `show` statements. No automatic side image system.

**Docs Reference:** [`side_image.html`](renpy-docs/side_image.html)

**Gap:** We manually manage 4 portrait slots. Ren'Py's side image system:
- Automatically shows/hides based on speaking character
- Supports expression attributes (happy, concerned, etc.)
- Handles transitions automatically
- Works with `config.side_image_tag` for player character

**Current Workaround:** `stem_speaker_portraits` dict + manual `show` in generated script.

**Migration Path:**
1. Add `image` parameter to `Character()` definitions in generator
2. Define `side` images for each master (54 provisional renders)
3. Use `config.side_image_tag = "master"` for protagonist
4. Keep `stem_stage_slot_N` for multi-speaker scenes (side images are single)

**Files to Update:**
- `tools/generate_renpy_script.py` — add `image="master_ch{NN:02d}"` to Character defs
- `game/screens.rpy` — add side image display to `say` screen
- Add `image side master_ch{NN:02d} = "images/masters/sprites/provisional/..."` declarations

---

### 2.4 Speech Bubbles (LOW PRIORITY — Optional)

**Current State:** Custom dialogue box (`say` screen) with narrator orb and nameplate.

**Docs Reference:** [`bubble.html`](renpy-docs/bubble.html)

**Gap:** Speech bubbles provide comic-style positioning with interactive editor (Shift+B). Not compatible with current ADV-style box.

**Decision:** Keep current dialogue box. Speech bubbles are a different UX paradigm. Revisit if design changes.

---

### 2.5 Layered Images (LOW PRIORITY)

**Current State:** Static provisional renders (full-body). No expression layers.

**Docs Reference:** [`layeredimage.html`](renpy-docs/layeredimage.html)

**Gap:** Layered images would allow:
- Base body + expression + pose + outfit layers
- Dynamic composition at runtime
- Smaller asset size (shared base)

**Decision:** Not applicable with current provisional art pipeline. Document for future art upgrade.

---

### 2.6 Custom Text Tags (MEDIUM PRIORITY)

**Current State:** Basic text tags only (`{nw}`, `{b}`, `{i}`, `{color=...}`).

**Docs Reference:** [`custom_text_tags.html`](renpy-docs/custom_text_tags.html)

**Missing:** Register custom tags for:
- `{ruby}` / `{rt}` for furigana/gloss (Sanskrit terms)
- `{shader=...}` for inline text shaders
- `{image=...}` for inline icons
- `{speed=...}` for per-segment text speed

**Files to Update:** `game/options.rpy` (init python register tags)

---

### 2.7 Web Build Improvements (HIGH PRIORITY)

**Current State:** Custom progressive download, service worker, loading overlay.

**Docs Reference:** [`web.html`](renpy-docs/web.html#progressive-downloading), [`downloader.html`](renpy-docs/downloader.html)

**Gaps:**
| Area | Current | Recommended |
|------|---------|-------------|
| Progressive download | Manual `progressive_download.txt` | Use `build.classify` + auto-generate |
| Service worker | Hand-written | Use Ren'Py's built-in SW generation + extend |
| Loading overlay | Custom injection | Use Ren'Py's `presplash` + custom HTML |
| Audio | Disabled | Keep disabled (design choice) |
| Fetch/Network | `renpy.emscripten.run_script` | Use `renpy.fetch()` for async HTTP |

**Files to Update:**
- `tools/prepare_local_build.py` — integrate with `build.classify`
- `tools/stamp_service_worker.py` — extend Ren'Py's generated SW
- `web/loading/` — migrate to Ren'Py's presplash system
- `game/stem_theme_bridge.rpy` — use `renpy.fetch()` for theme sync

---

### 2.8 ATL Transform Improvements (MEDIUM PRIORITY)

**Current State:** 56 camera transforms with `ease` interpolation.

**Docs Reference:** [`transforms.html`](renpy-docs/transforms.html), [`transform_properties.html`](renpy-docs/transform_properties.html)

**New in 8.x:**
- `anchor` property (replaces `xanchor`/`yanchor`)
- `radius` for circular motion
- `perspective` for 3D-like transforms
- `matrixtransform` for arbitrary 4x4 matrices
- `renpy.transform.apply()` for programmatic transforms

**Opportunity:** Refactor camera transforms to use newer properties, add subtle perspective to ken-burns moves.

---

### 2.9 Save/Load Enhancements (MEDIUM PRIORITY)

**Current State:** 6 slots/page, AUTO/RÁPIDOS pages, file screenshot, time, name.

**Docs Reference:** [`save_load_rollback.html`](renpy-docs/save_load_rollback.html)

**Missing:**
- `FileJson` / `FileNewest` / `FileOldest` values
- Save compression (Ren'Py 8.5+)
- Thumbnail customization beyond screenshot
- Cloud sync hooks (for future CyberManju OS integration)

---

### 2.10 Accessibility (HIGH PRIORITY)

**Current State:** Text size scaling (`persistent.stem_text_step`), basic keyboard nav.

**Docs Reference:** [`self_voicing.html`](renpy-docs/self_voicing.html), [`text.html`](renpy-docs/text.html#accessibility)

**Missing:**
- Self-voicing / TTS support (`config.tts_voice`, `renpy.say()`)
- High contrast mode
- Screen reader announcements for choices
- `config.voice_filename_format` for voice (not used)

**Action:** Add `config.tts_voice` and self-voicing hooks even without audio.

---

## 3. Implementation Priority Matrix

| Priority | Feature | Effort | Impact | Files |
|----------|---------|--------|--------|-------|
| **P0** | Upgrade to 8.5.4 | Low | Security, bug fixes | `project.json`, `install_renpy_sdk.sh`, CI |
| **P0** | Screen optimization (const/pure) | Medium | **High (Web perf)** | `screens.rpy`, `options.rpy` |
| **P1** | Side images | Medium | **High (code reduction)** | `generate_renpy_script.py`, `screens.rpy` |
| **P1** | Text shaders (dissolve default) | Low | **Medium (polish)** | `options.rpy`, `screens.rpy` |
| **P1** | Custom text tags (ruby, shader) | Medium | Medium | `options.rpy` |
| **P2** | Web build modernization | Medium | **High (load time)** | `prepare_local_build.py`, `stamp_service_worker.py` |
| **P2** | ATL transform modernization | Low | Low | `bg_camera_transforms.rpy` |
| **P2** | Accessibility (self-voicing hooks) | Medium | High (a11y) | `options.rpy`, `screens.rpy` |
| **P3** | Save/Load enhancements | Low | Low | `screens.rpy` |
| **P3** | Layered images | High | Low | Future art pipeline |

---

## 4. Specific Code Changes Required

### 4.1 `game/options.rpy` — Add Const Defines
```renpy
# Screen optimization constants
define BUTTON_XPAD = 26
define BUTTON_YPAD = 16
define DIALOGUE_XMAX_PC = 1720
define DIALOGUE_XMAX_MOBILE = config.screen_width - 48
define CHOICE_CARD_MAX_PC = config.screen_height - 240
define CHOICE_CARD_MAX_MOBILE = config.screen_height - 160

# Text shader
define config.default_textshader = "dissolve:u__duration=8.0"

# Accessibility
define config.tts_voice = None  # Hook for future
define config.self_voicing = True

# Side images
define config.side_image_tag = "master"
define config.side_image_only_not_showing = True

# Save/Load
define config.has_autosave = True
define config.has_quicksave = True
define config.save_json_callback = None  # Hook for cloud sync
```

### 4.2 `game/screens.rpy` — Apply Const/Pure
```renpy
init python:
    @renpy.pure
    def stem_compact_layout():
        ...

    @renpy.pure
    def stem_body_size(compact):
        ...

    @renpy.const
    def STEM_TEXT_STEPS():
        return (0, 4, 9)

# In styles - use define'd constants
style button:
    xpadding BUTTON_XPAD
    ypadding BUTTON_YPAD

# Say screen - add side image display
screen say(who, what):
    ...
    # Add side image frame before dialogue text
    if not _stem_narrator and _stem_speaker:
        add SideImage() xalign 0.0 yalign 1.0
    ...
```

### 4.3 `tools/generate_renpy_script.py` — Side Image Integration
```python
# In character definitions
for name in speakers:
    chapter_num = cast_chapter(name)
    if chapter_num:
        lines.append(f'define {speaker_ids[name]} = Character({quoted(name)}, image="master_ch{chapter_num:02d}")')
    else:
        lines.append(f'define {speaker_ids[name]} = Character({quoted(name)})')

# Add side image declarations
for number, asset in sorted(PROVISIONAL_SPRITES.items()):
    lines.append(f'image side master_ch{number:02d} = "images/{asset["file"]}"')
```

### 4.4 `tools/install_renpy_sdk.sh` — Update to 8.5.4
```bash
SDK_VERSION="8.5.4"
SDK_URL="https://www.renpy.org/dl/8.5.4/renpy-8.5.4-sdk.tar.bz2"
SDK_SHA256="<new-sha256>"
WEB_URL="https://www.renpy.org/dl/8.5.4/renpy-8.5.4-web.zip"
WEB_SHA256="<new-sha256>"
DEST="${1:-$HOME/.cache/renpy/8.5.4/renpy-8.5.4-sdk}"
```

---

## 5. Testing Checklist

After each change:
- [ ] `renpy.sh <project> lint --error-code` passes
- [ ] `build_web.sh` completes successfully
- [ ] Playwright smoke test passes (`tools/smoke_web_build.py`)
- [ ] All 56 chapters load without decode stalls
- [ ] Save/load/rollback works across chapter boundaries
- [ ] Text size scaling (3 steps) works in all screens
- [ ] Theme sync (OS → VN) works in iframe
- [ ] CI telemetry still reports (dev mode only)

---

## 6. Rollback Plan

If 8.5.4 introduces regressions:
1. Revert `project.json` and `install_renpy_sdk.sh` to 8.5.3
2. Re-run `tools/install_renpy_sdk.sh`
3. Rebuild web: `build_web.sh`
4. Docs remain at 8.5.4 (backward compatible)

---

## 7. Next Steps

1. **Immediate:** Update to 8.5.4 SDK (P0)
2. **Week 1:** Screen optimization const/pure (P0) + Text shader default (P1)
3. **Week 2:** Side image integration (P1) + Custom text tags (P1)
4. **Week 3:** Web build modernization (P2) + Accessibility hooks (P2)
5. **Ongoing:** Update `RENPY.md` to reflect new features

---

*This audit is based on the offline docs mirror at `docs/renpy-docs/` (Ren'Py 8.5.4 snapshot 2026-11-08).*