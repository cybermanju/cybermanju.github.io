# Optional presentation-only bridge from CyberManju OS to the embedded Ren'Py game.
# The OS is the source of truth for glass mode and accent; failure never blocks play.
# The bridge is event-driven: the parent frame sets a dirty flag instead of the
# game re-reading and re-parsing the theme twice a second.

init -100 python:
    import json as _stem_theme_json
    import re as _stem_theme_re

    _STEM_THEME_BRIDGE_JS = r"""(() => {
        if (window.__stemArrayThemeBridgeInstalled || window.parent === window) return;
        let parentOrigin = "";
        try { parentOrigin = new URL(document.referrer).origin; } catch (_) { return; }
        if (!parentOrigin) return;

        window.addEventListener("message", (event) => {
            if (event.source !== window.parent || event.origin !== parentOrigin) return;
            const data = event.data;
            if (!data || data.type !== "stem-array:theme" || data.version !== 1) return;
            const glass = data.glass === "translucent" ? "glass" : (data.glass === "solid" ? "flat" : null);
            if (!glass) return;
            const theme = typeof data.theme === "string" && /^[a-z0-9-]{1,48}$/.test(data.theme) ? data.theme : "os-dark";
            const mode = data.mode === "light" ? "light" : "dark";
            const accent = typeof data.accent === "string" && /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : "#55edff";
            window.stemArrayOsTheme = { glass, theme, mode, accent };
            window.stemArrayThemeDirty = true;
        });

        window.__stemArrayThemeBridgeInstalled = true;
        window.parent.postMessage({ type: "stem-array:ready", version: 1 }, parentOrigin);
    })();"""

    # Reads the flag and the payload in a single JS crossing; evaluates to a
    # falsy value when nothing changed, so the JSON parse never runs idle.
    _STEM_THEME_READ_JS = (
        "window.stemArrayThemeDirty && "
        "(window.stemArrayThemeDirty = false, "
        "JSON.stringify(window.stemArrayOsTheme || null))"
    )

    def _stem_theme_start_bridge():
        try:
            if renpy.emscripten:
                renpy.emscripten.run_script(_STEM_THEME_BRIDGE_JS)
        except Exception:
            # The local/default theme remains usable if the browser bridge is unavailable.
            pass

    def stem_theme_sync_from_os():
        if not renpy.emscripten:
            return
        try:
            raw = renpy.emscripten.run_script_string(_STEM_THEME_READ_JS)
            if not raw or raw in ("false", "undefined", "null", ""):
                return
            data = _stem_theme_json.loads(raw)
            mode = data.get("glass")
            if mode in ("flat", "glass") and not store.stem_theme_override and store.stem_theme_mode != mode:
                store.stem_theme_mode = mode
            accent = data.get("accent")
            if isinstance(accent, str) and _stem_theme_re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
                if store.stem_theme_accent.lower() != accent.lower():
                    store.stem_theme_accent = accent.lower()
        except Exception:
            # Never let OS appearance synchronization affect narrative or saves.
            return

    _stem_theme_start_bridge()
    if "stem_theme_sync" not in config.overlay_screens:
        config.overlay_screens.append("stem_theme_sync")


screen stem_theme_sync():
    zorder -1000
    # Polling stays because the browser side cannot call into Ren'Py; the tick
    # is a single cheap flag read, and OS theme changes are user-initiated.
    timer 0.9 repeat True action Function(stem_theme_sync_from_os)
