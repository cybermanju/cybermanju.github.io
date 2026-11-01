# The Stem Array — Ren'Py project configuration.
# The adaptation uses the full source chapters (PDF pages 59–915); pages 31–58 contain the detailed summary only.

define config.name = "The Stem Array — Technosutra VN"
define config.version = "0.1.0"
define config.screen_width = 1920
define config.screen_height = 1080
define config.window = "auto"
define config.save_directory = "technosutra-stem-array-1"
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

# Distinct local Ren'Py project; no networking, external services, or Street View media.
