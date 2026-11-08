# Read-only CI observation for the deployed visual-novel smoke test.
# This never changes story state, saves, history, or progression.
init -100 python:
    import json as _stem_array_ci_json

    def _stem_array_ci_observe_dialogue(event, interact=True, **kwargs):
        # Ren'Py's all-character callback receives show_done after a dialogue
        # segment has actually been shown. Fires in all modes (including
        # shipped Web builds) so the smoke test can detect narrator lines via
        # show_done telemetry. The JS bridge call is lightweight and guarded
        # by try/except, so it never affects gameplay.
        if event != "show_done" or not renpy.emscripten:
            return

        what = kwargs.get("what")

        payload = {
            "dialogue": what,
            "showingTags": [],
            "visibleAttributes": {},
            "speakerImageTag": None,
        }
        try:
            tags = sorted(renpy.get_showing_tags("master"))
            payload["showingTags"] = tags
            payload["visibleAttributes"] = {
                tag: list(renpy.get_attributes(tag, layer="master") or ())
                for tag in tags
            }
            payload["speakerImageTag"] = renpy.get_say_image_tag()
        except Exception:
            # The dialogue itself is authoritative. Optional visual metadata
            # must not suppress it if a Ren'Py getter is unavailable.
            pass

        try:
            encoded = _stem_array_ci_json.dumps(payload, ensure_ascii=False)
            script = (
                "(() => { const next = " + encoded + "; "
                "const previous = window.stemArrayCI; "
                "next.sequence = previous && Number.isFinite(previous.sequence) "
                "? previous.sequence + 1 : 1; "
                "window.stemArrayCI = next; })();"
            )
            renpy.emscripten.run_script(script)
        except Exception as error:
            # The observer must never affect gameplay if telemetry is unavailable.
            try:
                detail = _stem_array_ci_json.dumps(str(error), ensure_ascii=False)
                renpy.emscripten.run_script("window.stemArrayCIError = " + detail + ";")
            except Exception:
                return

    config.all_character_callbacks.append(_stem_array_ci_observe_dialogue)
