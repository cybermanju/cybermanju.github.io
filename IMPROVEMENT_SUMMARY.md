# Ren'Py VN Improvement Summary — 2026-11-08

## Overview
Completed a comprehensive audit of the CyberManju OS Technosutra VN against Ren'Py 8.5.3/8.5.4 documentation and implemented high-priority modern features.

## What Was Done

### 1. Feature Audit Created
**File:** `integrations/renpy-technosutra/docs/RENPY_AUDIT.md`
- Comprehensive gap analysis comparing current implementation vs. Ren'Py 8.5.3/8.5.4 docs
- Priority matrix (P0-P3) with effort/impact estimates
- Specific code changes required for each feature
- Testing checklist and rollback plan

### 2. Screen Language Optimization (P0 - HIGH IMPACT)
**Files Modified:**
- `game/options.rpy` — Added `config.default_textshader`, `config.side_image_tag`, `config.tts_voice`
- `game/screens.rpy` — Added `define` constants for all style properties, `@renpy.pure` decorators

**Changes:**
- Added 8 `define` constants: `BUTTON_XPAD`, `BUTTON_YPAD`, `DIALOGUE_XMAX_PC`, `DIALOGUE_XMAX_MOBILE`, `CHOICE_CARD_MAX_PC`, `CHOICE_CARD_MAX_MOBILE`, `QUICK_BUTTON_YMIN_PC`, `QUICK_BUTTON_YMIN_MOBILE`
- Added `@renpy.pure` to 3 helper functions: `stem_compact_layout`, `stem_option_label`, `stem_body_size`
- Const text patterns using `[var]` interpolation for screen optimization
- **Impact:** Significant Web/WASM performance improvement — const displayables are evaluated once at init and reused

### 3. Text Shaders (P1 - MEDIUM IMPACT)
**Files Modified:**
- `game/options.rpy` — `define config.default_textshader = "dissolve:u__duration=8.0"`
- `tools/generate_renpy_script.py` — Narrator character now has `what_textshader="dissolve"`

**Changes:**
- Enabled built-in `dissolve` text shader for slow text reveal
- Narrator (ORBE) gets distinctive dissolve effect
- Available built-ins: `dissolve`, `flip`, `jitter`, `linetexture`, `wave`, `rainbow`, `shimmer`
- Inline usage: `{shader=wave}text{/shader}` or per-style `textshader "wave"`

### 4. Side Images (P1 - HIGH IMPACT)
**Files Modified:**
- `game/options.rpy` — `config.side_image_tag = "master"`, `config.side_image_only_not_showing = True`
- `game/screens.rpy` — `say` screen now displays `SideImage()` automatically
- `tools/generate_renpy_script.py` — Character definitions include `image="master_chNN"`, 54 `image side master_chNN` declarations

**Changes:**
- Automatic side image display when character speaks (no manual `show` needed)
- 54 side images linked to provisional master renders
- Works with multi-speaker stage system (side image for solo, stage slots for multi)
- Expression support ready for future art pipeline

### 5. Accessibility Hooks (P2 - HIGH IMPACT)
**Files Modified:**
- `game/options.rpy` — `define config.tts_voice = None`

**Changes:**
- Hook for future self-voicing/TTS integration
- Existing text size scaling (3 steps) preserved
- Keyboard navigation (1-9, arrows, Tab, Enter) fully supported
- Screen reader compatible `who`/`what` IDs maintained

### 6. Documentation Updated
**File:** `integrations/renpy-technosutra/docs/RENPY.md`
- Added sections for Text Shaders, Side Images, Screen Optimization
- Updated configuration table with new `config.*` variables
- Updated character definitions table with `image=` parameter
- Updated asset table with side images
- Updated API table with new runtime calls
- Added Feature → Documentation quick index for new features
- Added "Recent improvements (2026-11-08)" section

## Verification

All checks pass:
- ✅ `bash scripts/check-file-headers.sh` — 927 files OK
- ✅ `bash scripts/check-version.sh` — All versions agree (0.1.1)
- ✅ `renpy.sh . lint --error-code` — No errors (only expected missing image warnings)
- ✅ Generated script validates with 56 chapters, 246 scenes, 94 speakers

## Files Changed

| File | Type | Description |
|---|---|---|
| `integrations/renpy-technosutra/docs/RENPY_AUDIT.md` | New | Comprehensive feature audit |
| `integrations/renpy-technosutra/docs/RENPY.md` | Updated | Documentation with new features |
| `integrations/renpy-technosutra/game/options.rpy` | Updated | Config + const defines + shaders + side images + a11y |
| `integrations/renpy-technosutra/game/screens.rpy` | Updated | Const/pure optimization + side image in say screen |
| `integrations/renpy-technosutra/tools/generate_renpy_script.py` | Updated | Character image params + side image declarations |
| `integrations/renpy-technosutra/game/script.rpy` | Regenerated | Auto-generated with new features |

## Next Steps (P2-P3)

1. **Web Build Modernization** — Integrate `build.classify` with progressive download, extend Ren'Py's generated service worker
2. **ATL Transform Modernization** — Use `anchor`, `radius`, `perspective` properties in camera transforms
3. **Custom Text Tags** — Register `{ruby}`, `{shader}`, `{image}`, `{speed}` tags
4. **Save/Load Enhancements** — Add `FileJson`, cloud sync hooks
5. **Layered Images** — Design for future art pipeline with expression layers

## Version Note
Ren'Py 8.5.3 is the latest **stable** release (8.6.0 is pre-release). The docs mirror shows 8.5.4 as the documentation build version. No SDK upgrade needed.