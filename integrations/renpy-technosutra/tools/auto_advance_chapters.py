#!/usr/bin/env python3
"""
Transforma os menus "Continuar — capítulo X" no final de cada capítulo
em transição automática (renpy.pause + jump), removendo a necessidade de
clique do usuário para avançar.

Padrão antigo:
    menu:
        "Continuar — capítulo X":
            jump chapter_X
        "Voltar ao índice":
            jump chapter_index

Novo padrão:
    $ renpy.pause(4.0)
    jump chapter_X

O "Voltar ao índice" permanece acessível via menu do jogo (Esc → Índice de Capítulos).
"""

import re
from pathlib import Path

SCRIPT = Path("integrations/renpy-technosutra/game/script.rpy")

# 4 spaces before menu:, 8 spaces before each option line.
# We don't depend on the exact option text (which contains accented chars).
CONTINUATION_BLOCK = re.compile(
    r"\n    menu:\n"
    r"        \"[^\"]*\":\n"
    r"            jump (chapter_\d{2})\n"
    r"        \"[^\"]*\":\n"
    r"            jump chapter_index",
    re.MULTILINE,
)

REPLACEMENT_TEMPLATE = '\n    $ renpy.pause(4.0)\n    jump {target}'


def transform_script(path: Path) -> int:
    text = path.read_text(encoding="utf-8")

    def repl(m):
        target = m.group(1)
        return REPLACEMENT_TEMPLATE.format(target=target)

    new_text, count = CONTINUATION_BLOCK.subn(repl, text)
    path.write_text(new_text, encoding="utf-8")
    return count


if __name__ == "__main__":
    count = transform_script(SCRIPT)
    print(f"Transformed {count} continuation blocks in {SCRIPT}")
