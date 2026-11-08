#!/usr/bin/env python3
"""
Fix menu option lines missing trailing colons in script.rpy.

Lines like:
        "Que reflexão...?"          <-- missing colon, no body

Should become:
        "Que reflexão...?":
            pass                    <-- empty body so Ren'Py accepts the menu

These were valid in the original file only because Ren'Py reported the
``pause`` error first and stopped parsing. Now that ``pause`` statements are
removed, the menu errors surface.
"""

from pathlib import Path

SCRIPT = Path("integrations/renpy-technosutra/game/script.rpy")


def fix_missing_colons(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    new_lines = []
    fixed = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Menu option at 8-space indent, starts with quote, ends with quote
        # but NOT with ':".' (no colon after closing quote)
        if (
            line.startswith("        ")
            and stripped.startswith('"')
            and stripped.endswith('"')
            and not stripped.endswith('":')
        ):
            # Add colon
            new_lines.append(line.rstrip() + ":")
            # Insert empty body (pass) at 12-space indent
            new_lines.append("            pass")
            fixed += 1
        else:
            new_lines.append(line)
        i += 1

    path.write_text("\n".join(new_lines), encoding="utf-8")
    return fixed


if __name__ == "__main__":
    count = fix_missing_colons(SCRIPT)
    print(f"Fixed {count} menu option lines missing colons in {SCRIPT}")
