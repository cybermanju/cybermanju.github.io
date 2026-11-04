# The Stem Array — Ren'Py project configuration.
# The adaptation uses the full source chapters (PDF pages 59–915); pages 31–58 contain the detailed summary only.

define config.name = "The Stem Array — Technosutra VN"
define config.window_title = "The Stem Array · Gaṇḍavyūha"
define config.version = "0.1.0"
define config.screen_width = 1920
define config.screen_height = 1080
define config.default_text_cps = 45
define config.window = "auto"
define config.save_directory = "technosutra-stem-array-1"
define config.rollback_enabled = True
# Auto and quick saves are part of the save-menu contract in screens.rpy
# (file_slots renders the AUTO / RÁPIDOS pages only when these are true), so
# declare them rather than inheriting version-dependent defaults.
define config.has_autosave = True
define config.has_quicksave = True
define config.main_menu_music = None

# Keep the distributable lean even when the launcher is run against the full
# source tree instead of the minimal staging project used by build_web.sh.
init python:
    build.classify("game/images/bg_ch*.png", None)
    build.classify("game/images/bg_ch*.jpg", None)
    build.classify("game/images/bg_intro_generic.png", None)
    build.classify("game/images/masters/source/model_*.png", None)
    build.classify("game/images/assets-manifest.json", None)
    build.classify("game/previews/**", None)
    build.classify("game/saves/**", None)
    build.classify("build/**", None)
    build.classify("**.zip", None)
    build.classify("tools/**", None)
    build.classify("chapters.json", None)
    build.classify("project.json", None)
    build.classify("**.md", None)

define config.has_sound = False
define config.has_music = False
define config.has_voice = False

# Screen profiler is a developer tool: it writes profile_screen.txt beside the
# game and costs measurable time, so it must never run in a shipped Web build.
# It exists so the next performance decision can be made from numbers.
init python:
    if config.developer is True:
        renpy.profile_screen("say", show=True, update=True, time=True)
        renpy.profile_screen("choice", show=True, time=True)

# Distinct local Ren'Py project; no networking, external services, or Street View media.

# Keep every decoded background and UI texture resident instead of thrashing the
# default ~40 MB image cache. 56 chapters at 1920x1080 decode to ~8 MB of
# texture each (~464 MB total), so on the Web (WASM) build the cache default
# forced a full 2 MP JPEG re-decode on the main thread at every chapter change,
# which dropped the renderer to near-0 fps. 512 MB holds the whole VN plus UI,
# so scene switches are a texture bind, not a decode stall. Expressed in MB so
# Ren'Py actively evicts when the limit is reached instead of growing without
# bound.
init python:
    config.image_cache_size_mb = 512

# Web builds decode images serially on the main thread (no background threads),
# so raise the look-ahead window so Ren'Py can preload upcoming chapter
# backgrounds before the reader reaches them.
init python:
    config.predict_statements = 64

# Linear texture filtering keeps zoomed backgrounds (ken-burns camera moves)
# from turning pixelated when the camera scales past 100%.
init python:
    config.gl_filter = "linear"

# Mipmaps are always generated so downscaled backgrounds (camera zooms past
# 100% in ken-burns moves) stay crisp instead of aliasing. Applies to every
# image in the VN, including all 56 chapter backgrounds.
init python:
    config.mipmap = True

# Predize telas de diálogo e escolha para que a primeira linha de cada capítulo
# e a primeira escolha não pisquem ou carreguem atrasadas.
init python:
    renpy.start_predict_screen("say")
    renpy.start_predict_screen("choice")

