# The Stem Array — custom cyberpunk UI for Ren'Py.
# Presentation-only screens: chapter text, choices, quizzes, jumps, and telemetry stay in script.rpy.

init offset = -1

init python:
    if "quick_menu" not in config.overlay_screens:
        config.overlay_screens.append("quick_menu")
    if "stem_ascii_root" not in config.overlay_screens:
        config.overlay_screens.append("stem_ascii_root")

    import hashlib as _stem_hashlib

    def stem_compact_layout():
        if renpy.variant("mobile") or renpy.variant("small"):
            return True
        try:
            width, height = renpy.get_physical_size()
            return width < config.screen_width or height < config.screen_height
        except Exception:
            return False

    def stem_ascii_garden(seed, width=164):
        motifs = (
            "~o~--/\\--~(@)~--/\\--~o~",
            "~--{*}--\\_/\\_/--(@)--~",
            ".~\\/\\~o~(@)~o~\\/\\~.",
            "~\\_/*\\_/@/\\_/*\\_/~",
            "--<@>--o--/\\--{*}--o--<@>--",
        )
        digest = _stem_hashlib.sha256(str(seed).encode("utf-8")).digest()
        line = ""
        index = 0
        while len(line) < width:
            line += motifs[digest[index % len(digest)] % len(motifs)]
            index += 1
        return line[:width]

default quick_menu = True
default stem_last_dialogue_text = ""
default stem_theme_mode = "flat"
default stem_theme_accent = "#55edff"

image stem_ui_panel = ConditionSwitch(
    "stem_theme_mode == 'glass'",
    Frame("images/ui/glass-frost.png", 0, 0, 0, 0, tile=True),
    True,
    Frame("images/ui/velvet-night.png", 0, 0, 0, 0, tile=True)
)

image stem_ui_panel_hover = ConditionSwitch(
    "stem_theme_mode == 'glass'",
    Frame("images/ui/glass-frost-hover.png", 0, 0, 0, 0, tile=True),
    True,
    Frame("images/ui/velvet-night-hover.png", 0, 0, 0, 0, tile=True)
)

image stem_ui_button = ConditionSwitch(
    "stem_theme_mode == 'glass'",
    Frame("images/ui/paper-glass.png", 0, 0, 0, 0, tile=True),
    True,
    Frame("images/ui/paper-vellum.png", 0, 0, 0, 0, tile=True)
)

image stem_ui_button_hover = ConditionSwitch(
    "stem_theme_mode == 'glass'",
    Frame("images/ui/paper-glass-hover.png", 0, 0, 0, 0, tile=True),
    True,
    Frame("images/ui/paper-vellum-hover.png", 0, 0, 0, 0, tile=True)
)


################################################################################
## Core palette and controls
################################################################################

style default:
    font "DejaVuSans.ttf"
    color "#edf5ff"
    size 26
    line_spacing 4

style button:
    background "stem_ui_button"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    insensitive_background "stem_ui_button"
    xpadding 20
    ypadding 12
    yminimum 58
    focus_mask True

style button_text:
    font "DejaVuSans.ttf"
    size 24
    color "#1b2632"
    hover_color "#073d4b"
    selected_color "#073d4b"
    insensitive_color "#5c6269"
    yalign 0.5

style button_text:
    variant "small"
    size 30

style say_label:
    font "DejaVuSans.ttf"
    size 25
    color "#55edff"
    bold True

style say_dialogue:
    font "DejaVuSans.ttf"
    size 29
    color "#eff5ff"
    line_spacing 6
    adjust_spacing False

style choice_button is button
style choice_button_text is button_text
style choice_button:
    xfill True
    yminimum 56
    xpadding 20
    ypadding 7
style choice_button:
    variant "small"
    yminimum 72
    xpadding 18
    ypadding 8
style choice_button_text:
    size 23
    color "#1b2632"
    hover_color "#073d4b"
    text_align 0.0
style choice_button_text:
    variant "small"
    size 28

style navigation_button is button
style navigation_button_text is button_text
style navigation_button:
    xfill True
    yminimum 62
style navigation_button_text:
    size 23
    color "#1b2632"
    hover_color "#073d4b"
    text_align 0.0
style navigation_button_text:
    variant "small"
    size 27

style stem_control_button is button
style stem_control_button_text is button_text
style stem_control_button:
    xfill True
    yminimum 72
    xpadding 18
    ypadding 12
style stem_control_button:
    variant "small"
    yminimum 84
    xpadding 18
    ypadding 10
style stem_control_button_text:
    size 22
    color "#102d3a"
    hover_color "#073d4b"
    bold True
style stem_control_button_text:
    variant "small"
    size 30

style quick_button is button
style quick_button_text is button_text
style quick_button:
    background "stem_ui_panel"
    hover_background "stem_ui_panel_hover"
    xpadding 13
    ypadding 7
    yminimum 48
style quick_button_text:
    size 17
    color "#edf5ff"
    hover_color "#ffffff"
style quick_button_text:
    variant "small"
    size 25

style stem_ascii:
    font "DejaVuSans.ttf"
    size 12
    color "#74bfc2"
style stem_ascii:
    variant "small"
    size 10

style cyber_slider:
    xsize 520
    ysize 24
    left_bar Solid("#38e9f7")
    right_bar Solid("#1b2a3e")
    thumb Solid("#f2fbff")


################################################################################
## Dialogue, interstitial cards, and story choices
################################################################################

screen say(who, what):
    $ store.stem_last_dialogue_text = str(what)
    $ _stem_choice_open = renpy.get_screen("choice") is not None
    $ _stem_message_length = len(str(what))
    $ _stem_small = stem_compact_layout()
    $ _stem_orb_narrator = who is None or who == "ORBE // NARRADOR"
    $ _stem_avatar_size = (112 if _stem_message_length > 600 else 148) if _stem_small else (112 if _stem_message_length > 600 else 128)
    $ _stem_short_ratio = 0.36 if _stem_small else 0.27
    $ _stem_medium_ratio = 0.46 if _stem_small else 0.38
    $ _stem_long_ratio = 0.64 if _stem_small else 0.52
    $ _stem_height_ratio = _stem_short_ratio if _stem_message_length <= 160 else (_stem_medium_ratio if _stem_message_length <= 600 else _stem_long_ratio)
    $ _stem_panel_height = min(config.screen_height - (80 if _stem_small else 50), 580 if _stem_small else 500, max(300 if _stem_small else 260, int(config.screen_height * _stem_height_ratio)))
    $ _stem_text_view_height = _stem_panel_height - (158 if _stem_small else 124)
    $ _stem_font_size = (26 if _stem_message_length > 600 else 34) if _stem_small else (20 if _stem_message_length > 850 else (24 if _stem_message_length > 600 else 30))
    $ _stem_garden = stem_ascii_garden(str(what), 62 if _stem_small else 138)

    if not _stem_choice_open:
        window:
            id "window"
            xalign 0.5
            yalign 1.0
            xfill True
            xmaximum 1800
            ysize _stem_panel_height
            padding (3, 3)
            background Solid(stem_theme_accent)

            frame:
                xfill True
                yfill True
                padding (22 if _stem_small else 28, 12 if _stem_small else 14)
                background "stem_ui_panel"

                vbox:
                    spacing (6 if _stem_small else 7)
                    if _stem_small:
                        if _stem_orb_narrator:
                            text "~o~--(@)--~o~  ORBE // NARRADOR  ~o~--(@)--~o~" style "stem_ascii" color stem_theme_accent xalign 0.5 xfill True text_align 0.5
                        else:
                            text "~o~--(@)--~o~  //  NARRATIVA  //  ~o~--(@)--~o~" style "stem_ascii" color stem_theme_accent xalign 0.5 xfill True text_align 0.5
                    else:
                        text _stem_garden style "stem_ascii" color stem_theme_accent size 14 xalign 0.5 xfill True text_align 0.5

                    hbox:
                        spacing 12
                        text "CANAL //" size 17 color stem_theme_accent yalign 0.5
                        frame:
                            padding (2, 2)
                            background Solid(stem_theme_accent)
                            frame:
                                padding (12, 4)
                                background "stem_ui_button"
                                if who is not None:
                                    text who id "who" style "say_label" color "#073d4b" xmaximum (900 if _stem_small else 1150)
                                else:
                                    text "NARRADOR" id "who" style "say_label" color "#073d4b" xmaximum (900 if _stem_small else 1150)
                        null width 1 xfill True
                        if not _stem_small:
                            text "CLIQUE / ENTER" size 16 color "#8faac0" xalign 1.0 yalign 0.5

                    if _stem_small:
                        text "TOQUE OU ENTER PARA AVANÇAR" size 17 color "#a8bbce" xalign 0.5

                    hbox:
                        xfill True
                        yalign 0.0
                        spacing (18 if _stem_small else 24)
                        if _stem_orb_narrator:
                            vbox:
                                spacing -5
                            add "narrator_orb":
                                xsize _stem_avatar_size
                                ysize _stem_avatar_size
                            text "~o~(@)~o~" style "stem_ascii" color stem_theme_accent size (15 if _stem_small else 14) xalign 0.5
                            text "ARQUIVISTA" size (15 if _stem_small else 13) color stem_theme_accent xalign 0.5
                        text what id "what" style "say_dialogue" size _stem_font_size xalign 0.0 yalign 0.0 text_align 0.0 xfill True xmaximum (config.screen_width - (520 if _stem_orb_narrator else 240)) ymaximum _stem_text_view_height

                    if not _stem_small:
                        text _stem_garden style "stem_ascii" color stem_theme_accent size 14 xalign 0.5 xfill True text_align 0.5


screen centered(message):
    tag centered
    zorder 25
    $ _stem_small = stem_compact_layout()

    frame:
        xalign 0.5
        yalign 0.14
        xfill True
        xmaximum (config.screen_width - 120 if _stem_small else 1500)
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            padding (24, 16)
            background "stem_ui_panel"

            vbox:
                spacing 5
                if _stem_small:
                    text "~o~--(@)--~o~  //  ARQUIVO  //  ~o~--(@)--~o~" style "stem_ascii" xalign 0.5 xfill True text_align 0.5
                else:
                    text stem_ascii_garden(message, 126) style "stem_ascii" xalign 0.5 xfill True text_align 0.5
                if message.startswith("Capítulo"):
                    text "ARQUIVO // CAPÍTULO" size (23 if _stem_small else 17) color stem_theme_accent xalign 0.5
                elif message.startswith("Cena"):
                    text "TRANSMISSÃO // CENA" size (23 if _stem_small else 17) color stem_theme_accent xalign 0.5
                else:
                    text "SINAL // REGISTRO" size (23 if _stem_small else 17) color stem_theme_accent xalign 0.5

                text message size (46 if _stem_small else 38) color "#f0f7ff" xalign 0.5 text_align 0.5 xmaximum (config.screen_width - 180 if _stem_small else 1420)
                if not _stem_small:
                    text stem_ascii_garden(message, 126) style "stem_ascii" xalign 0.5 xfill True text_align 0.5


screen stem_choice_content(items, small, question_size, garden):
    style_prefix "choice"

    vbox:
        xfill True
        spacing (5 if small else 9)
        text garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5 color stem_theme_accent

        hbox:
            spacing 12
            text "ROTA //" size (22 if small else 18) color stem_theme_accent yalign 0.5
            text "Selecione uma opção" size (22 if small else 18) color "#a8bbce" yalign 0.5

        if "?" in stem_last_dialogue_text or "？" in stem_last_dialogue_text:
            frame:
                xfill True
                padding (12 if small else 14, 8 if small else 9)
                background "stem_ui_button"

                vbox:
                    spacing (5 if small else 7)
                    text "PERGUNTA //" size (20 if small else 15) color stem_theme_accent bold True
                    text stem_last_dialogue_text size question_size color "#182631" xalign 0.0 text_align 0.0 xfill True xmaximum 1480

        vbox:
            xfill True
            spacing (8 if small else 7)
            for i in items:
                frame:
                    xfill True
                    padding (2, 2)
                    background Solid(stem_theme_accent)
                    textbutton i.caption action i.action:
                        yminimum (48 if small and len(items) > 8 else (72 if small else 58))

        text garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5 color stem_theme_accent


screen choice(items):
    style_prefix "choice"
    zorder 80
    modal True

    add Solid("#02050d99")
    $ _stem_small = stem_compact_layout()
    $ _stem_question_size = 26 if _stem_small else 26
    $ _stem_has_prompt = "?" in stem_last_dialogue_text or "？" in stem_last_dialogue_text
    $ _stem_prompt_chars_per_line = 80 if _stem_small else 98
    $ _stem_prompt_lines = max(1, (len(stem_last_dialogue_text) + _stem_prompt_chars_per_line - 1) // _stem_prompt_chars_per_line) if _stem_has_prompt else 0
    $ _stem_prompt_height = (_stem_prompt_lines * (32 if _stem_small else 34) + (48 if _stem_small else 50)) if _stem_has_prompt else 0
    $ _stem_option_height = 48 if _stem_small and len(items) > 8 else (72 if _stem_small else 58)
    $ _stem_option_gap = 8 if _stem_small else 7
    $ _stem_content_height = 110 + len(items) * _stem_option_height + max(0, len(items) - 1) * _stem_option_gap + _stem_prompt_height
    $ _stem_choice_max_height = min(config.screen_height - (24 if _stem_small else 80), 740 if _stem_small else 900, max(360 if _stem_small else 340, _stem_content_height))
    $ _stem_garden = stem_ascii_garden(stem_last_dialogue_text or "choice", 70 if _stem_small else 146)

    if _stem_small:
        frame:
            xalign 0.5
            yalign 0.5
            xfill True
            xmaximum (config.screen_width - 100)
            ysize _stem_choice_max_height
            padding (3, 3)
            background Solid(stem_theme_accent)

            frame:
                xfill True
                yfill True
                padding (22, 14)
                background "stem_ui_panel"

                use stem_choice_content(items, _stem_small, _stem_question_size, _stem_garden)
    else:
        frame:
            xalign 0.5
            yalign 0.5
            xfill True
            xmaximum 1600
            ymaximum _stem_choice_max_height
            padding (3, 3)
            background Solid(stem_theme_accent)

            frame:
                xfill True
                yfill True
                padding (22, 14)
                background "stem_ui_panel"

                use stem_choice_content(items, _stem_small, _stem_question_size, _stem_garden)


################################################################################
## In-game quick controls
################################################################################

screen quick_menu():
    zorder 100

    if quick_menu and not main_menu:
        $ _stem_small = stem_compact_layout()
        key "game_menu" action ShowMenu("stem_controls")
        frame:
            xalign 0.99
            yalign 0.025
            padding (2, 2)
            background Solid(stem_theme_accent)

            if _stem_small:
                hbox:
                    style_prefix "quick"
                    spacing 7
                    textbutton "MENU" action ShowMenu("stem_controls"):
                        yminimum 124
                    textbutton "AUTO" action Preference("auto-forward", "toggle"):
                        yminimum 124
                    textbutton "PULAR" action Skip() alternate Skip(fast=True, confirm=True):
                        yminimum 124
            else:
                hbox:
                    style_prefix "quick"
                    spacing 5
                    text ("GLASS" if stem_theme_mode == "glass" else "FLAT") size 14 color stem_theme_accent yalign 0.5
                    textbutton "LOG" action ShowMenu("history")
                    textbutton "SALVAR" action ShowMenu("save")
                    textbutton "CARREGAR" action ShowMenu("load")
                    textbutton "AJUSTES" action ShowMenu("preferences")
                    textbutton "AUTO" action Preference("auto-forward", "toggle")
                    textbutton "PULAR" action Skip() alternate Skip(fast=True, confirm=True)


screen stem_controls():
    tag menu
    modal True
    zorder 150
    style_prefix "stem_control"
    $ _stem_small = stem_compact_layout()

    add Solid("#020713e8")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 120 if _stem_small else 1360)
        ymaximum (config.screen_height - 80 if _stem_small else 920)
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            yfill True
            padding (28 if _stem_small else 38, 20 if _stem_small else 28)
            background "stem_ui_panel"

            vbox:
                xfill True
                yfill True
                spacing (14 if _stem_small else 18)

                hbox:
                    xfill True
                    vbox:
                        spacing 3
                        text "CYBERMANJU  //  THE STEM ARRAY" size (19 if _stem_small else 15) color stem_theme_accent
                        text "MENU DO JOGO" size (39 if _stem_small else 34) color "#f2f7ff" bold True
                    null width 1 xfill True
                    textbutton "RETOMAR" action Return():
                        xfill False
                        xminimum (220 if _stem_small else 180)
                        yminimum (84 if _stem_small else 62)

                text stem_ascii_garden("stem-controls", 76 if _stem_small else 134) style "stem_ascii" color stem_theme_accent xalign 0.5 xfill True text_align 0.5

                frame:
                    xfill True
                    yfill True
                    padding (16, 12)
                    background "stem_ui_panel"

                    vbox:
                        xfill True
                        yfill True
                        spacing (12 if _stem_small else 15)
                        text "SISTEMA  //  FERRAMENTAS DA PARTIDA" size (19 if _stem_small else 16) color stem_theme_accent

                        if _stem_small:
                            grid 2 3:
                                xfill True
                                spacing 12
                                textbutton "HISTÓRICO" action ShowMenu("history")
                                textbutton "SALVAR PARTIDA" action ShowMenu("save")
                                textbutton "CARREGAR PARTIDA" action ShowMenu("load")
                                textbutton "PREFERÊNCIAS" action ShowMenu("preferences")
                                textbutton "ÍNDICE DE CAPÍTULOS" action Jump("chapter_index")
                                textbutton "MENU INICIAL" action MainMenu()
                        else:
                            grid 3 2:
                                xfill True
                                spacing 14
                                textbutton "HISTÓRICO" action ShowMenu("history")
                                textbutton "SALVAR PARTIDA" action ShowMenu("save")
                                textbutton "CARREGAR PARTIDA" action ShowMenu("load")
                                textbutton "PREFERÊNCIAS" action ShowMenu("preferences")
                                textbutton "ÍNDICE DE CAPÍTULOS" action Jump("chapter_index")
                                textbutton "MENU INICIAL" action MainMenu()

    key "game_menu" action Return()


screen stem_ascii_root():
    zorder 300
    $ _stem_small = stem_compact_layout()
    $ _stem_seed = stem_last_dialogue_text or config.name
    text stem_ascii_garden(str(_stem_seed) + "|root-top", 72 if _stem_small else 170) style "stem_ascii" xalign 0.5 ypos 3 xmaximum (config.screen_width - 90 if _stem_small else 1880) text_align 0.5 color stem_theme_accent
    text stem_ascii_garden(str(_stem_seed) + "|root-bottom", 72 if _stem_small else 170) style "stem_ascii" xalign 0.5 yalign 1.0 yoffset -3 xmaximum (config.screen_width - 90 if _stem_small else 1880) text_align 0.5 color stem_theme_accent
    if not _stem_small:
        text "~\n|\n@\n|\n~" style "stem_ascii" xalign 0.003 yalign 0.5 color stem_theme_accent
        text "~\n|\n*\n|\n~" style "stem_ascii" xalign 0.997 yalign 0.5 color stem_theme_accent


################################################################################
## Main menu and reusable game menu
################################################################################

screen main_menu():
    tag menu

    add "bg_intro_scene"
    add Solid("#020712a8")
    $ _stem_small = stem_compact_layout()

    if _stem_small:
        vbox:
            xalign 0.5
            yalign 0.5
            xfill True
            xmaximum 1660
            spacing 14

            frame:
                xfill True
                ymaximum 430
                padding (3, 3)
                background Solid(stem_theme_accent)

                frame:
                    xfill True
                    yfill True
                    padding (30, 24)
                    background "stem_ui_panel"

                    vbox:
                        spacing 12
                        text "ARQUIVO NEURAL  //  56 CAPÍTULOS" size 20 color stem_theme_accent
                        text "THE STEM ARRAY" size 62 color "#f2f7ff" bold True
                        text "GAṆḌAVYŪHA  ·  VISUAL NOVEL CYBERPUNK" size 25 color "#73eaf4"
                        text "Uma jornada interativa por 56 capítulos: encontros, ensinamentos e escolhas de reflexão. As decisões e os quizzes acompanham a leitura sem substituir a narrativa." size 29 color "#d5e2ef" xmaximum 1560
                        text "NARRATIVA  //  PORTUGUÊS" size 20 color "#a8bbce"

            frame:
                xfill True
                ymaximum 620
                padding (3, 3)
                background Solid(stem_theme_accent)

                frame:
                    xfill True
                    yfill True
                    padding (28, 20)
                    background "stem_ui_panel"

                    vbox:
                        spacing 10
                        text "ENTRADA DO SISTEMA" size 22 color "#f27df4"
                        use navigation
                        text "Toque / Enter para iniciar. Setas e Tab navegam pelas opções." size 19 color "#a8bbce" xmaximum 1520
                        text "Versão [config.version]" size 17 color "#879db4"
    else:
        hbox:
            xalign 0.5
            yalign 0.5
            spacing 28

            frame:
                xsize 1050
                ymaximum 760
                padding (3, 3)
                background Solid(stem_theme_accent)

                frame:
                    xfill True
                    yfill True
                    padding (48, 42)
                    background "stem_ui_panel"

                    vbox:
                        spacing 18
                        text "ARQUIVO NEURAL  //  56 CAPÍTULOS" size 19 color stem_theme_accent
                        null height 18
                        text "THE STEM ARRAY" size 68 color "#f2f7ff" bold True
                        text "GAṆḌAVYŪHA  ·  VISUAL NOVEL CYBERPUNK" size 23 color "#73eaf4"
                        null height 12
                        text "Uma jornada interativa por 56 capítulos: encontros, ensinamentos e escolhas de reflexão. As decisões e os quizzes acompanham a leitura sem substituir a narrativa." size 27 color "#d5e2ef" xmaximum 940
                        null height 20
                        text "NARRATIVA  //  PORTUGUÊS" size 18 color "#a8bbce"

            frame:
                xsize 560
                ymaximum 760
                padding (3, 3)
                background Solid(stem_theme_accent)

                frame:
                    xfill True
                    yfill True
                    padding (34, 34)
                    background "stem_ui_panel"

                    vbox:
                        spacing 17
                        text "ENTRADA DO SISTEMA" size 20 color "#f27df4"
                        null height 8
                        use navigation
                        null height 18
                        text "Clique ou pressione Enter para avançar." size 18 color "#9eb0c2" xmaximum 460
                        text "Versão [config.version]" size 17 color "#71869b"


screen navigation():
    style_prefix "navigation"
    $ _stem_nav_small = renpy.variant("mobile") or renpy.variant("small")

    vbox:
        xfill True
        spacing 10

        if main_menu:
            textbutton "INICIAR JORNADA" action Start():
                yminimum (120 if _stem_nav_small else 62)
            textbutton "CARREGAR JOGO" action ShowMenu("load"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "SOBRE" action ShowMenu("about"):
                yminimum (120 if _stem_nav_small else 62)
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help"):
                    yminimum (120 if _stem_nav_small else 62)
            if renpy.variant("pc"):
                textbutton "SAIR" action Quit(confirm=True):
                    yminimum (120 if _stem_nav_small else 62)
        else:
            textbutton "RETOMAR JOGO" action Return():
                yminimum (120 if _stem_nav_small else 62)
            textbutton "HISTÓRICO" action ShowMenu("history"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "SALVAR" action ShowMenu("save"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "CARREGAR" action ShowMenu("load"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences"):
                yminimum (120 if _stem_nav_small else 62)
            textbutton "SOBRE" action ShowMenu("about"):
                yminimum (120 if _stem_nav_small else 62)
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help"):
                    yminimum (120 if _stem_nav_small else 62)
            textbutton "MENU INICIAL" action MainMenu():
                yminimum (120 if _stem_nav_small else 62)


screen game_menu(title, scroll=None, yinitial=0.0, spacing=0):
    tag menu
    modal True
    zorder 150

    add Solid("#020713e8")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum 1740
        ymaximum 1000
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            yfill True
            padding (26, 22)
            background "stem_ui_panel"

            vbox:
                spacing 16
                $ _stem_small = stem_compact_layout()

                hbox:
                    xfill True
                    vbox:
                        spacing 3
                        text "CYBERMANJU  //  STEM ARRAY" size (20 if _stem_small else 17) color stem_theme_accent
                        text title size (34 if _stem_small else 38) color "#f1f7ff" bold True
                    null width 1 xfill True
                    textbutton "VOLTAR" action Return():
                        yminimum 58

                frame:
                    xfill True
                    yfill True
                    padding (12, 12)
                    background "stem_ui_panel"

                    if _stem_small:
                        frame:
                            xfill True
                            yfill True
                            padding (14, 12)
                            background "stem_ui_panel"
                            transclude
                    else:
                        hbox:
                            spacing 16

                            frame:
                                xsize 350
                                yfill True
                                padding (20, 18)
                                background "stem_ui_panel"

                                vbox:
                                    spacing 12
                                    text "NAVEGAÇÃO" size 17 color stem_theme_accent
                                    use navigation

                            frame:
                                xfill True
                                yfill True
                                padding (22, 18)
                                background "stem_ui_panel"
                                transclude

    key "game_menu" action Return()


################################################################################
## Save/load, preferences, history, help, and about
################################################################################

screen save():
    tag menu
    use file_slots("SALVAR JOGO")


screen load():
    tag menu
    use file_slots("CARREGAR JOGO")


screen stem_file_slot_card(slot, small=False):
    button:
        xsize 350
        ysize (150 if small else 255)
        padding (8 if small else 12, 6 if small else 10)
        background (Solid("#071523ee") if small else "stem_ui_panel")
        hover_background "stem_ui_panel_hover"
        action FileAction(slot)

        has vbox
        spacing (3 if small else 7)
        if FileLoadable(slot):
            add FileScreenshot(slot) xalign 0.5 xsize (310 if small else 320) ysize (58 if small else 160)
        else:
            frame:
                xfill True
                ysize (58 if small else 160)
                background Solid("#10243a")
                text "＋" size (30 if small else 38) color stem_theme_accent xalign 0.5 yalign 0.5
        text FileTime(slot, format="%d/%m/%Y %H:%M", empty="SLOT VAZIO") size (16 if small else 17) color "#b8c9d9" xalign 0.5
        if FileLoadable(slot):
            text FileSaveName(slot) size (17 if small else 18) color "#e8f3ff" xalign 0.5
        elif not small:
            text "NOVO REGISTRO" size 16 color "#748ca3" xalign 0.5

        key "save_delete" action FileDelete(slot)


screen file_slots(title):
    default page_name_value = FilePageNameInputValue(pattern="PÁGINA {}", auto="AUTOMÁTICOS", quick="RÁPIDOS")
    $ _stem_small = stem_compact_layout()

    use game_menu(title, scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 18)

            button:
                xalign 0.5
                xmaximum (1100 if _stem_small else 520)
                yminimum (48 if _stem_small else 58)
                padding (12 if _stem_small else 18, 6 if _stem_small else 10)
                background "stem_ui_panel"
                hover_background "stem_ui_panel_hover"
                action page_name_value.Toggle()
                key_events True

                input value page_name_value:
                    xalign 0.5
                    size (20 if _stem_small else 21)
                    color "#e8f4ff"
                    text_align 0.5

            if _stem_small:
                grid 3 2:
                    xalign 0.5
                    xfill True
                    spacing 8
                    for i in range(6):
                        use stem_file_slot_card(i + 1, True)
            else:
                grid 3 2:
                    xalign 0.5
                    spacing 14
                    for i in range(6):
                        use stem_file_slot_card(i + 1, False)

            hbox:
                xalign 0.5
                spacing (4 if _stem_small else 8)
                textbutton "‹" action FilePagePrevious():
                    yminimum 58
                if config.has_autosave:
                    textbutton "AUTO" action FilePage("auto"):
                        yminimum 58
                if config.has_quicksave:
                    textbutton "RÁPIDOS" action FilePage("quick"):
                        yminimum 58
                for page in range(1, 10):
                    textbutton "[page]" action FilePage(page):
                        yminimum 58
                textbutton "›" action FilePageNext():
                    yminimum 58


screen preferences():
    tag menu
    default _stem_pref_tab = 0
    $ _stem_small = stem_compact_layout()

    use game_menu("PREFERÊNCIAS", scroll="viewport"):
        vbox:
            xfill True
            spacing (12 if _stem_small else 26)

            if _stem_small:
                hbox:
                    xfill True
                    spacing 8
                    textbutton "VISUAL" action SetScreenVariable("_stem_pref_tab", 0) style "quick_button":
                        yminimum 54
                    textbutton "TEXTO" action SetScreenVariable("_stem_pref_tab", 1) style "quick_button":
                        yminimum 54
                    textbutton "ÁUDIO" action SetScreenVariable("_stem_pref_tab", 2) style "quick_button":
                        yminimum 54

                if _stem_pref_tab == 0:
                    vbox:
                        xfill True
                        spacing 8
                        text "TELA E ACESSIBILIDADE" size 22 color stem_theme_accent bold True
                        text "Modo de exibição" size 18 color "#a9bed0"
                        hbox:
                            spacing 8
                            textbutton "JANELA" action Preference("display", "window"):
                                yminimum 54
                            textbutton "TELA CHEIA" action Preference("display", "fullscreen"):
                                yminimum 54
                        text "Leitura" size 18 color "#a9bed0"
                        hbox:
                            spacing 6
                            textbutton "PULAR NÃO LIDO" action Preference("skip", "toggle") style "quick_button":
                                yminimum 52
                            textbutton "APÓS ESCOLHAS" action Preference("after choices", "toggle") style "quick_button":
                                yminimum 52
                            textbutton "TRANSIÇÕES" action InvertSelected(Preference("transitions", "toggle")) style "quick_button":
                                yminimum 52

                elif _stem_pref_tab == 1:
                    vbox:
                        xfill True
                        spacing 10
                        text "LEITURA E AVANÇO" size 22 color stem_theme_accent bold True
                        text "Velocidade do texto" size 18 color "#a9bed0"
                        bar value Preference("text speed") style "cyber_slider" xfill True ysize 48
                        text "Avanço automático" size 18 color "#a9bed0"
                        bar value Preference("auto-forward time") style "cyber_slider" xfill True ysize 48

                else:
                    vbox:
                        xfill True
                        spacing 8
                        text "VOLUME // ÁUDIO" size 22 color stem_theme_accent bold True
                        text "Canais de áudio disponíveis nesta build." size 18 color "#f0f7ff"
                        if config.has_music:
                            text "Música" size 18 color "#a9bed0"
                            bar value Preference("music volume") style "cyber_slider" xfill True ysize 44
                        if config.has_sound:
                            text "Efeitos" size 18 color "#a9bed0"
                            bar value Preference("sound volume") style "cyber_slider" xfill True ysize 44
                        if config.has_voice:
                            text "Voz" size 18 color "#a9bed0"
                            bar value Preference("voice volume") style "cyber_slider" xfill True ysize 44
            else:
                text "TELA E ACESSIBILIDADE" size 24 color stem_theme_accent bold True
                grid 2 1:
                    xfill True
                    spacing 28
                    vbox:
                        spacing 10
                        text "Modo de exibição" size 20 color "#a9bed0"
                        textbutton "JANELA" action Preference("display", "window")
                        textbutton "TELA CHEIA" action Preference("display", "fullscreen")
                    vbox:
                        spacing 10
                        text "Leitura" size 20 color "#a9bed0"
                        textbutton "PULAR TEXTO NÃO LIDO" action Preference("skip", "toggle")
                        textbutton "PULAR APÓS ESCOLHAS" action Preference("after choices", "toggle")
                        textbutton "TRANSIÇÕES" action InvertSelected(Preference("transitions", "toggle"))

                null height 8
                text "Velocidade do texto" size 20 color "#a9bed0"
                bar value Preference("text speed") style "cyber_slider" xsize 520 ysize 24
                text "Avanço automático" size 20 color "#a9bed0"
                bar value Preference("auto-forward time") style "cyber_slider" xsize 520 ysize 24

                if config.has_music or config.has_sound or config.has_voice:
                    null height 10
                    text "ÁUDIO" size 24 color stem_theme_accent bold True
                    if config.has_music:
                        text "Música" size 20 color "#a9bed0"
                        bar value Preference("music volume") style "cyber_slider" xsize 520 ysize 24
                    if config.has_sound:
                        text "Efeitos" size 20 color "#a9bed0"
                        bar value Preference("sound volume") style "cyber_slider" xsize 520 ysize 24
                    if config.has_voice:
                        text "Voz" size 20 color "#a9bed0"
                        bar value Preference("voice volume") style "cyber_slider" xsize 520 ysize 24


screen history():
    tag menu
    predict False
    default _stem_history_index = 0
    $ _stem_small = stem_compact_layout()

    use game_menu("HISTÓRICO", scroll="viewport", yinitial=1.0, spacing=14):
        vbox:
            xfill True
            spacing 14

            if _history_list:
                $ _stem_history_index = min(_stem_history_index, len(_history_list) - 1)
                $ _stem_history_item = _history_list[_stem_history_index]
                frame:
                    xfill True
                    ymaximum (config.screen_height - 280)
                    padding (16, 12)
                    background "stem_ui_panel"
                    vbox:
                        xfill True
                        spacing 8
                        if _stem_history_item.who:
                            text _stem_history_item.who size (18 if _stem_small else 20) color "#55eefa" bold True substitute False
                        text _stem_history_item.what size (18 if _stem_small else 23) color "#e5eff8" substitute False xmaximum (config.screen_width - 240 if _stem_small else 1180)

                hbox:
                    xalign 0.5
                    spacing 12
                    textbutton "‹ ANTERIOR" action SetScreenVariable("_stem_history_index", max(0, _stem_history_index - 1)):
                        yminimum 58
                    text "[_stem_history_index + 1] / [len(_history_list)]" size (18 if _stem_small else 20) color stem_theme_accent yalign 0.5
                    textbutton "PRÓXIMO ›" action SetScreenVariable("_stem_history_index", min(len(_history_list) - 1, _stem_history_index + 1)):
                        yminimum 58
            else:
                text "Ainda não há diálogo registrado." size (20 if _stem_small else 22) color "#a9bed0" xalign 0.5


screen help():
    tag menu
    $ _stem_small = stem_compact_layout()

    use game_menu("CONTROLES", scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 18)
            text "TECLADO" size (21 if _stem_small else 24) color "#55eefa" bold True
            text "Clique / Enter — avançar diálogo e ativar botões" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Espaço — avançar sem selecionar escolhas" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Setas — navegar entre opções" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Esc / botão direito — abrir o menu do jogo" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Ctrl — acelerar enquanto pressionado; Tab — alternar pulo" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Page Up / roda para cima — voltar ao diálogo anterior" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "H — ocultar interface; S — capturar a tela" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            null height (5 if _stem_small else 18)
            text "TOQUE" size (21 if _stem_small else 24) color "#55eefa" bold True
            text "Toque na caixa de diálogo para avançar. Os botões de escolha mantêm a navegação acessível por teclado." size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)


screen about():
    tag menu
    $ _stem_small = stem_compact_layout()

    use game_menu("SOBRE", scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 16)
            text "[config.name]" size (24 if _stem_small else 30) color "#55eefa" bold True
            text "Versão [config.version]" size (18 if _stem_small else 21) color "#a9bed0"
            text "Adaptação narrativa em português dos 56 capítulos. As escolhas são reflexões opcionais; os quizzes são atividades originais de leitura e não alteram a narrativa." size (18 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Roteiro baseado no texto integral autorizado. As falas da VN são uma adaptação, não citações da tradução." size (18 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Retratos marcados como provisórios são imagens estáticas e não representam animações ou variações de expressão." size (18 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Feito com Ren’Py." size (18 if _stem_small else 20) color "#a9bed0"


################################################################################
## Confirmations and system overlays
################################################################################

screen confirm(message, yes_action, no_action):
    $ _stem_small = stem_compact_layout()
    modal True
    zorder 200
    add Solid("#020713dd")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 120 if _stem_small else 1050)
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            padding (36, 30)
            background "stem_ui_panel"

            vbox:
                spacing 24
                text _(message) size (36 if _stem_small else 28) color "#f0f7ff" xalign 0.5 text_align 0.5 xmaximum (config.screen_width - 180 if _stem_small else 930)
                hbox:
                    xalign 0.5
                    spacing 18
                    textbutton "CONFIRMAR" action yes_action:
                        yminimum (120 if _stem_small else 58)
                    textbutton "CANCELAR" action no_action:
                        yminimum (120 if _stem_small else 58)

    key "game_menu" action no_action


screen input(prompt):
    $ _stem_small = stem_compact_layout()
    modal True
    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 120 if _stem_small else 1100)
        padding (28, 24)
        background "stem_ui_panel"
        vbox:
            spacing 15
            text prompt size (30 if _stem_small else 24) color stem_theme_accent
            input id "input" size (31 if _stem_small else 25) color "#f0f7ff"


screen notify(message):
    zorder 180
    frame:
        xalign 0.5
        yalign 0.08
        padding (18, 12)
        background "stem_ui_panel"
        text "[message!tq]" size 20 color "#55eefa"
    timer 3.25 action Hide("notify")


screen skip_indicator():
    zorder 180
    frame:
        xalign 0.02
        yalign 0.13
        padding (16, 10)
        background "stem_ui_panel"
        text "MODO DE LEITURA RÁPIDA ATIVO" size 18 color "#55eefa"
