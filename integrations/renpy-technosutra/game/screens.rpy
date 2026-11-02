# The Stem Array — custom cyberpunk UI for Ren'Py.
# Presentation-only screens: chapter text, choices, quizzes, jumps, and telemetry stay in script.rpy.

init offset = -1

init python:
    if "quick_menu" not in config.overlay_screens:
        config.overlay_screens.append("quick_menu")

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
default stem_theme_override = False
define stem_speaker_portraits = {}

image stem_ui_panel = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_panel_glass.png"), True, Tile("images/ui/velvet_panel_flat.png"))
image stem_ui_panel_hover = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_menu_glass.png"), True, Tile("images/ui/velvet_menu_flat.png"))
image stem_ui_button = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_button_glass.png"), True, Tile("images/ui/velvet_button_flat.png"))
image stem_ui_button_hover = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_tabs_glass.png"), True, Tile("images/ui/velvet_tabs_flat.png"))
image stem_ui_dialogue = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_dialogue_glass.png"), True, Tile("images/ui/velvet_dialogue_flat.png"))
image stem_ui_interstitial = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_interstitial_glass.png"), True, Tile("images/ui/velvet_interstitial_flat.png"))
image stem_ui_choice = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_choice_glass.png"), True, Tile("images/ui/velvet_choice_flat.png"))
image stem_ui_question = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_question_glass.png"), True, Tile("images/ui/velvet_question_flat.png"))
image stem_ui_quick = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_controls_glass.png"), True, Tile("images/ui/velvet_controls_flat.png"))
image stem_ui_slots = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_slots_glass.png"), True, Tile("images/ui/velvet_slots_flat.png"))
image stem_ui_tabs = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_tabs_glass.png"), True, Tile("images/ui/velvet_tabs_flat.png"))
image stem_ui_controls = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_controls_glass.png"), True, Tile("images/ui/velvet_controls_flat.png"))
image stem_ui_menu = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_menu_glass.png"), True, Tile("images/ui/velvet_menu_flat.png"))
image stem_ui_nav = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_panel_glass.png"), True, Tile("images/ui/velvet_panel_flat.png"))
image stem_ui_frame = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_interstitial_glass.png"), True, Tile("images/ui/velvet_interstitial_flat.png"))
image stem_ui_nameplate = ConditionSwitch("stem_theme_mode == 'glass'", Tile("images/ui/velvet_nameplate_glass.png"), True, Tile("images/ui/velvet_nameplate_flat.png"))
image stem_generic_speaker = "images/speakers/generic_speaker_shadow.png"


################################################################################
## Core palette and controls
################################################################################

style default:
    font "DejaVuSans.ttf"
    color "#edf1ec"
    size 25
    line_spacing 5

style button:
    background "stem_ui_button"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    insensitive_background "stem_ui_button"
    xpadding 22
    ypadding 10
    yminimum 56
    focus_mask True

style button_text:
    font "DejaVuSans.ttf"
    size 22
    color "#edf3ef"
    hover_color "#ffffff"
    selected_color "#ffffff"
    insensitive_color "#829099"
    yalign 0.5

style button_text:
    variant "small"
    size 32

style say_label:
    font "DejaVuSans.ttf"
    size 24
    color "#effff9"
    bold True
    outlines [(1, "#07131d", 1, 1)]
style say_label:
    variant "small"
    size 28

style say_dialogue:
    font "DejaVuSans.ttf"
    size 28
    color "#f2f2ec"
    line_spacing 5
    adjust_spacing False

style choice_button is button
style choice_button_text is button_text
style choice_button:
    xfill True
    yminimum 58
    xpadding 22
    ypadding 10
style choice_button:
    variant "small"
    yminimum 64
    xpadding 20
    ypadding 10
style choice_button_text:
    size 21
    color "#edf3ef"
    hover_color "#ffffff"
    text_align 0.0
style choice_button_text:
    variant "small"
    size 32

style navigation_button is button
style navigation_button_text is button_text
style navigation_button:
    background "stem_ui_nav"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    xfill True
    yminimum 56
style navigation_button_text:
    size 21
    color "#edf3ef"
    hover_color "#ffffff"
    text_align 0.0
style navigation_button_text:
    variant "small"
    size 32

style stem_tab_button is button
style stem_tab_button_text is button_text
style stem_tab_button:
    background "stem_ui_tabs"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    xfill True
    yminimum 68
    xpadding 14
style stem_tab_button_text:
    size 17
    bold True
    text_align 0.5
style stem_tab_button_text:
    variant "small"
    size 24

style stem_tab_selected is stem_tab_button
style stem_tab_selected:
    background "stem_ui_question"
    hover_background "stem_ui_question"
    selected_background "stem_ui_question"
style stem_tab_selected_text is stem_tab_button_text
style stem_tab_selected_text:
    color "#ffffff"
    hover_color "#ffffff"
    bold True

style stem_control_button is button
style stem_control_button_text is button_text
style stem_control_button:
    xfill True
    yminimum 68
    xpadding 20
    ypadding 10
style stem_control_button:
    variant "small"
    yminimum 88
    xpadding 18
    ypadding 10
style stem_control_button_text:
    size 20
    color "#edf3ef"
    hover_color "#ffffff"
    bold True
style stem_control_button_text:
    variant "small"
    size 34

style quick_button is button
style quick_button_text is button_text
style quick_button:
    background "stem_ui_quick"
    hover_background "stem_ui_button_hover"
    xpadding 16
    ypadding 7
    yminimum 48
style quick_button_text:
    size 16
    color "#edf3ef"
    hover_color "#ffffff"
style quick_button_text:
    variant "small"
    size 28

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
    left_bar Solid("#8ad9c4")
    right_bar Solid("#293943")
    thumb Solid("#f3e4c8")


################################################################################
## Dialogue, interstitial cards, and story choices
################################################################################

screen say(who, what):
    $ store.stem_last_dialogue_text = str(what)
    $ _stem_choice_open = renpy.get_screen("choice") is not None
    $ _stem_message_length = len(str(what))
    $ _stem_small = stem_compact_layout()
    $ _stem_orb_narrator = who is None or who == "ORBE // NARRADOR"
    $ _stem_has_speaker = who is not None and not _stem_orb_narrator
    $ _stem_speaker_displayable = stem_speaker_portraits.get(str(who), "stem_generic_speaker") if _stem_has_speaker else None
    $ _stem_has_avatar = _stem_orb_narrator or _stem_has_speaker
    $ _stem_ratio = 0.31 if _stem_message_length <= 180 else 0.38
    $ _stem_panel_height = min(config.screen_height - 32, 470 if _stem_small else 410, max(250 if _stem_small else 230, int(config.screen_height * _stem_ratio)))
    $ _stem_avatar_size = 88 if _stem_small else 112
    $ _stem_text_height = _stem_panel_height - (112 if _stem_has_avatar else 82)
    $ _stem_font_size = 30 if _stem_small else 27
    $ _stem_name_size = 20 if len(str(who or "NARRADOR")) > 32 else (22 if _stem_small else 24)

    if not _stem_choice_open:
        window:
            id "window"
            xalign 0.5
            yalign 1.0
            xfill True
            xmaximum (config.screen_width - 56 if _stem_small else 1600)
            ysize _stem_panel_height
            padding (20 if _stem_small else 32, 16 if _stem_small else 22)
            background "stem_ui_dialogue"

            vbox:
                xfill True
                yfill True
                spacing (10 if _stem_small else 14)

                hbox:
                    xfill True
                    spacing 10
                    frame:
                        padding (12, 6)
                        background "stem_ui_controls"
                        text ("ORBE · ARQUIVISTA" if _stem_orb_narrator else "A JORNADA") size (16 if _stem_small else 14) color "#e0eee6" bold True
                    frame:
                        yminimum (46 if _stem_small else 50)
                        xmaximum (config.screen_width - (570 if _stem_small else 640))
                        padding (12, 6)
                        background "stem_ui_nameplate"
                        hbox:
                            spacing 8
                            fixed:
                                xsize 16
                                ysize 16
                                yalign 0.5
                                add Solid("#20dbd0") xsize 6 ysize 6 xpos 0 ypos 0
                                add Solid("#f252d0") xsize 6 ysize 6 xpos 8 ypos 0
                                add Solid("#f2cd5f") xsize 6 ysize 6 xpos 0 ypos 8
                                add Solid("#7af08b") xsize 6 ysize 6 xpos 8 ypos 8
                            if who is not None:
                                text who id "who" style "say_label" size _stem_name_size xmaximum (config.screen_width - (720 if _stem_small else 800))
                            else:
                                text "NARRADOR" id "who" style "say_label" size _stem_name_size xmaximum (config.screen_width - 720)
                    null width 1 xfill True
                    text ("TOQUE · REVELAR / AVANÇAR" if _stem_small else "CLIQUE / ENTER · REVELAR E AVANÇAR") size (14 if _stem_small else 13) color "#d3b4cc" yalign 0.5

                hbox:
                    xfill True
                    yfill True
                    spacing (18 if _stem_small else 24)
                    if _stem_orb_narrator:
                        frame:
                            xsize _stem_avatar_size + 18
                            ysize _stem_avatar_size + 18
                            padding (8, 8)
                            background "stem_ui_panel"
                            add "narrator_orb":
                                xsize _stem_avatar_size
                                ysize _stem_avatar_size
                                xalign 0.5
                                yalign 0.5
                    elif _stem_has_speaker:
                        frame:
                            xsize _stem_avatar_size + 18
                            ysize _stem_avatar_size + 18
                            padding (6, 6)
                            background "stem_ui_interstitial"
                            frame:
                                xsize _stem_avatar_size
                                ysize _stem_avatar_size
                                background Solid("#c9d6cd")
                                add _stem_speaker_displayable:
                                    xsize _stem_avatar_size
                                    ysize _stem_avatar_size
                                    xalign 0.5
                                    yalign 0.5
                    text what id "what" style "say_dialogue" size _stem_font_size xalign 0.0 yalign 0.0 text_align 0.0 xfill True xmaximum (config.screen_width - (260 if _stem_has_avatar else 180)) ymaximum _stem_text_height

    key "dismiss" action Return()


screen centered(message):
    tag centered
    zorder 25
    $ _stem_small = stem_compact_layout()

    frame:
        xalign 0.5
        yalign 0.14
        xfill True
        xmaximum (config.screen_width - 100 if _stem_small else 1320)
        padding (34 if _stem_small else 42, 22 if _stem_small else 30)
        background "stem_ui_interstitial"

        vbox:
            xfill True
            spacing 8
            if message.startswith("Capítulo"):
                text "CAPÍTULO" size (17 if _stem_small else 14) color stem_theme_accent xalign 0.5
            elif message.startswith("Cena"):
                text "CENA" size (17 if _stem_small else 14) color stem_theme_accent xalign 0.5
            else:
                text "ARQUIVO DA JORNADA" size (17 if _stem_small else 14) color stem_theme_accent xalign 0.5
            text message size (43 if _stem_small else 42) color "#f3f2ec" xalign 0.5 text_align 0.5 xmaximum (config.screen_width - 180 if _stem_small else 1240)


screen stem_choice_content(items, small, question_size, garden):
    style_prefix "choice"
    $ _stem_option_height = 92 if small and len(items) <= 8 else (72 if small else 64)
    $ _stem_option_spacing = 10 if small else 12
    $ _stem_has_question = "?" in stem_last_dialogue_text or "？" in stem_last_dialogue_text

    vbox:
        xfill True
        spacing (12 if small else 16)
        hbox:
            xfill True
            spacing 10
            text ("ESCOLHA" if _stem_has_question else "NAVEGAÇÃO") size (18 if small else 14) color stem_theme_accent yalign 0.5 bold True
            null width 1 xfill True
            text "[len(items)] opções" size (16 if small else 14) color "#c2b2cf" yalign 0.5

        if _stem_has_question:
            frame:
                xfill True
                padding (18 if small else 22, 12 if small else 16)
                background "stem_ui_question"

                vbox:
                    spacing 5
                    text "PERGUNTA / PONTO DE REFLEXÃO" size (16 if small else 13) color "#d6eee0" bold True
                    text stem_last_dialogue_text size question_size color "#f5eee9" xalign 0.0 text_align 0.0 xfill True xmaximum (config.screen_width - 180 if small else 1240)

        viewport:
            xfill True
            ymaximum (config.screen_height - (400 if small else 420))
            scrollbars "vertical"
            mousewheel True
            draggable True
            pagekeys True
            vbox:
                xfill True
                spacing _stem_option_spacing
                for i in items:
                    textbutton i.caption action i.action:
                        xfill True
                        yminimum _stem_option_height


screen choice(items):
    style_prefix "choice"
    zorder 80
    modal True

    add Solid("#09060ec8")
    $ _stem_small = stem_compact_layout()
    $ _stem_question_size = 27 if _stem_small else 22
    $ _stem_choice_height = min(config.screen_height - (72 if _stem_small else 120), 930 if _stem_small else 880)

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 72 if _stem_small else 1320)
        ymaximum _stem_choice_height
        padding (22 if _stem_small else 36, 20 if _stem_small else 30)
        background "stem_ui_choice"

        use stem_choice_content(items, _stem_small, _stem_question_size, "")


################################################################################
## In-game quick controls
################################################################################

screen quick_menu():
    zorder 100

    if quick_menu and not main_menu:
        $ _stem_small = stem_compact_layout()
        key "game_menu" action ShowMenu("stem_controls")
        frame:
            xalign 0.985
            yalign 0.025
            padding (8, 6)
            background "stem_ui_quick"
            hbox:
                style_prefix "quick"
                spacing 6
                textbutton "MENU" action ShowMenu("stem_controls"):
                    yminimum (82 if _stem_small else 50)
                textbutton "AUTO" action Preference("auto-forward", "toggle"):
                    yminimum (82 if _stem_small else 50)
                textbutton "PULAR" action Skip() alternate Skip(fast=True, confirm=True):
                    yminimum (82 if _stem_small else 50)


screen stem_controls():
    tag menu
    modal True
    zorder 150
    style_prefix "stem_control"
    $ _stem_small = stem_compact_layout()

    add Solid("#050a10e8")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 80 if _stem_small else 1280)
        padding (28 if _stem_small else 40, 24 if _stem_small else 34)
        background "stem_ui_menu"

        vbox:
            xfill True
            spacing (18 if _stem_small else 22)

            hbox:
                xfill True
                vbox:
                    spacing 4
                    text "THE STEM ARRAY" size (20 if _stem_small else 14) color stem_theme_accent
                    text "Pausa e navegação" size (34 if _stem_small else 38) color "#f3f2ec" bold True
                null width 1 xfill True
                textbutton "CONTINUAR" action Return():
                    xfill False
                    xminimum (210 if _stem_small else 180)
                    yminimum (66 if _stem_small else 58)

            frame:
                xfill True
                padding (18, 16)
                background "stem_ui_controls"

                vbox:
                    xfill True
                    spacing (12 if _stem_small else 16)
                    text "FERRAMENTAS DA JORNADA" size (21 if _stem_small else 14) color "#a9cbbd" bold True

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
    add Solid("#050a10b5")
    $ _stem_small = stem_compact_layout()

    if _stem_small:
        vbox:
            xalign 0.5
            yalign 0.5
            xfill True
            xmaximum (config.screen_width - 72)
            spacing 14

            frame:
                xfill True
                ymaximum 340
                padding (24, 20)
                background "stem_ui_menu"
                hbox:
                    xfill True
                    spacing 18
                    vbox:
                        xfill True
                        yalign 0.5
                        spacing 7
                        text "UMA LEITURA INTERATIVA · 56 CAPÍTULOS" size 18 color stem_theme_accent
                        text "THE STEM\nARRAY" size 48 color "#f5f2e9" bold True
                        text "Gaṇḍavyūha · uma jornada de encontros e ensinamentos." size 25 color "#d0ddd7" xmaximum 1120
                    add "master_ch01_provisional":
                        xsize 160
                        ysize 214
                        yalign 0.5

            frame:
                xfill True
                padding (24, 20)
                background "stem_ui_menu"
                vbox:
                    xfill True
                    spacing 10
                    hbox:
                        xfill True
                        text "COMECE OU RETOME" size 18 color "#b7d6c9" bold True
                        null width 1 xfill True
                        text "PORTUGUÊS" size 17 color "#98aaa7"
                    use navigation
                    text "Retrato de referência · render estático provisório do repositório Technosutra." size 16 color "#98aaa7" xmaximum (config.screen_width - 160)
    else:
        hbox:
            xalign 0.5
            yalign 0.5
            spacing 26

            frame:
                xsize 1010
                ymaximum 780
                padding (52, 46)
                background "stem_ui_menu"
                vbox:
                    xfill True
                    spacing 14
                    text "LEITURA INTERATIVA · 56 CAPÍTULOS" size 16 color stem_theme_accent
                    text "THE STEM ARRAY" size 78 color "#f5f2e9" bold True
                    text "GAṆḌAVYŪHA  ·  A JORNADA DE SUDHANA" size 21 color "#b9d9ce"
                    text "Uma visual novel em português sobre encontros, ensinamentos e escolhas de reflexão. Os quizzes acompanham a leitura sem substituir a narrativa." size 25 color "#d3ddd7" xmaximum 880
                    null height 5
                    text "COMECE OU RETOME" size 15 color "#b7d6c9" bold True
                    use navigation
                    text "Versão [config.version] · Narrativa em português" size 14 color "#98aaa7"

            frame:
                xsize 470
                ymaximum 780
                padding (34, 28)
                background "stem_ui_menu"
                vbox:
                    xfill True
                    yfill True
                    spacing 10
                    text "ARQUIVO DE PERSONAGENS" size 14 color "#b7d6c9" bold True
                    add "master_ch01_provisional":
                        xsize 330
                        ysize 440
                        xalign 0.5
                    null height 1
                    text "MESTRE · CAPÍTULO 01" size 16 color "#e8eee8" xalign 0.5
                    text "Render de referência estático e provisório." size 13 color "#9badaa" xalign 0.5 text_align 0.5


screen navigation():
    style_prefix "navigation"
    $ _stem_nav_small = renpy.variant("mobile") or renpy.variant("small")

    vbox:
        xfill True
        spacing 10

        if main_menu:
            textbutton "INICIAR JORNADA" action Start():
                yminimum (64 if _stem_nav_small else 56)
            textbutton "CARREGAR JOGO" action ShowMenu("load"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "SOBRE" action ShowMenu("about"):
                yminimum (64 if _stem_nav_small else 56)
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help"):
                    yminimum (64 if _stem_nav_small else 56)
            if renpy.variant("pc"):
                textbutton "SAIR" action Quit(confirm=True):
                    yminimum (64 if _stem_nav_small else 56)
        else:
            textbutton "RETOMAR JOGO" action Return():
                yminimum (64 if _stem_nav_small else 56)
            textbutton "HISTÓRICO" action ShowMenu("history"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "SALVAR" action ShowMenu("save"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "CARREGAR" action ShowMenu("load"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences"):
                yminimum (64 if _stem_nav_small else 56)
            textbutton "SOBRE" action ShowMenu("about"):
                yminimum (64 if _stem_nav_small else 56)
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help"):
                    yminimum (64 if _stem_nav_small else 56)
            textbutton "MENU INICIAL" action MainMenu():
                yminimum (64 if _stem_nav_small else 56)


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
        background "stem_ui_frame"

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
                                background "stem_ui_nav"

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


screen stem_theme_controls(small=False):
    frame:
        xfill True
        padding (18 if small else 24, 16 if small else 20)
        background "stem_ui_question"
        vbox:
            xfill True
            spacing (8 if small else 12)
            text "APARÊNCIA · VELUDO E VIDRO" size (20 if small else 24) color "#e6f1e9" bold True
            text "Cada superfície usa um padrão próprio. O modo vidro mantém a cena visível por trás dos painéis." size (17 if small else 20) color "#e1d7df" xmaximum (config.screen_width - 220 if small else 1180)
            hbox:
                xfill True
                spacing 10
                if stem_theme_mode == "flat":
                    textbutton "VELUDO · ATIVO" action [SetVariable("stem_theme_mode", "flat"), SetVariable("stem_theme_override", True)] style "stem_tab_selected":
                        yminimum (82 if small else 62)
                else:
                    textbutton "VELUDO" action [SetVariable("stem_theme_mode", "flat"), SetVariable("stem_theme_override", True)] style "stem_tab_button":
                        yminimum (82 if small else 62)
                if stem_theme_mode == "glass":
                    textbutton "VIDRO · ATIVO" action [SetVariable("stem_theme_mode", "glass"), SetVariable("stem_theme_override", True)] style "stem_tab_selected":
                        yminimum (82 if small else 62)
                else:
                    textbutton "VIDRO" action [SetVariable("stem_theme_mode", "glass"), SetVariable("stem_theme_override", True)] style "stem_tab_button":
                        yminimum (82 if small else 62)
            if stem_theme_override:
                textbutton "SEGUIR APARÊNCIA DO APP" action SetVariable("stem_theme_override", False) style "quick_button":
                    yminimum (76 if small else 58)


screen stem_file_slot_card(slot, small=False):
    button:
        xsize 350
        ysize (150 if small else 255)
        padding (8 if small else 12, 6 if small else 10)
        background "stem_ui_slots"
        hover_background "stem_ui_button_hover"
        action FileAction(slot)

        has vbox
        spacing (3 if small else 7)
        if FileLoadable(slot):
            add FileScreenshot(slot) xalign 0.5 xsize (310 if small else 320) ysize (58 if small else 160)
        else:
            frame:
                xfill True
                ysize (58 if small else 160)
                background "stem_ui_slots"
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
                textbutton "‹" action FilePagePrevious() style "stem_tab_button":
                    yminimum (82 if _stem_small else 58)
                if config.has_autosave:
                    textbutton "AUTO" action FilePage("auto") style "stem_tab_button":
                        yminimum (82 if _stem_small else 58)
                if config.has_quicksave:
                    textbutton "RÁPIDOS" action FilePage("quick") style "stem_tab_button":
                        yminimum (82 if _stem_small else 58)
                for page in range(1, 10):
                    textbutton "[page]" action FilePage(page) style "stem_tab_button":
                        yminimum (82 if _stem_small else 58)
                textbutton "›" action FilePageNext() style "stem_tab_button":
                    yminimum (82 if _stem_small else 58)


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
                    spacing 6
                    if _stem_pref_tab == 0:
                        textbutton "VISUAL" action SetScreenVariable("_stem_pref_tab", 0) style "stem_tab_selected":
                            yminimum 82
                    else:
                        textbutton "VISUAL" action SetScreenVariable("_stem_pref_tab", 0) style "stem_tab_button":
                            yminimum 82
                    if _stem_pref_tab == 1:
                        textbutton "TEXTO" action SetScreenVariable("_stem_pref_tab", 1) style "stem_tab_selected":
                            yminimum 82
                    else:
                        textbutton "TEXTO" action SetScreenVariable("_stem_pref_tab", 1) style "stem_tab_button":
                            yminimum 82
                    if _stem_pref_tab == 2:
                        textbutton "ÁUDIO" action SetScreenVariable("_stem_pref_tab", 2) style "stem_tab_selected":
                            yminimum 82
                    else:
                        textbutton "ÁUDIO" action SetScreenVariable("_stem_pref_tab", 2) style "stem_tab_button":
                            yminimum 82
                    if _stem_pref_tab == 3:
                        textbutton "TEMA" action SetScreenVariable("_stem_pref_tab", 3) style "stem_tab_selected":
                            yminimum 82
                    else:
                        textbutton "TEMA" action SetScreenVariable("_stem_pref_tab", 3) style "stem_tab_button":
                            yminimum 82

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

                elif _stem_pref_tab == 2:
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
                    use stem_theme_controls(True)
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

                null height 12
                use stem_theme_controls(False)


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
                    background "stem_ui_interstitial"
                    vbox:
                        xfill True
                        spacing 8
                        if _stem_history_item.who:
                            text _stem_history_item.who size (18 if _stem_small else 20) color stem_theme_accent bold True substitute False
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
            text "TECLADO" size (21 if _stem_small else 24) color stem_theme_accent bold True
            text "Clique / Enter — avançar diálogo e ativar botões" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Espaço — avançar sem selecionar escolhas" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Setas — navegar entre opções" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Esc / botão direito — abrir o menu do jogo" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Ctrl — acelerar enquanto pressionado; Tab — alternar pulo" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Page Up / roda para cima — voltar ao diálogo anterior" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "H — ocultar interface; S — capturar a tela" size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            null height (5 if _stem_small else 18)
            text "TOQUE" size (21 if _stem_small else 24) color stem_theme_accent bold True
            text "Toque na caixa de diálogo para avançar. Os botões de escolha mantêm a navegação acessível por teclado." size (18 if _stem_small else 22) xmaximum (config.screen_width - 220 if _stem_small else 1180)


screen about():
    tag menu
    $ _stem_small = stem_compact_layout()

    use game_menu("SOBRE", scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 16)
            text "[config.name]" size (24 if _stem_small else 30) color stem_theme_accent bold True
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
    $ _stem_confirm_text = _(message)
    if "return to the main menu" in str(message).lower():
        $ _stem_confirm_text = "Voltar ao menu inicial?\nO progresso não salvo será perdido."
    modal True
    zorder 200
    add Solid("#050a10dd")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 120 if _stem_small else 1050)
        padding (32 if _stem_small else 40, 28 if _stem_small else 34)
        background "stem_ui_question"

        vbox:
            xfill True
            spacing 18
            text "CONFIRMAÇÃO" size (16 if _stem_small else 14) color stem_theme_accent bold True xalign 0.5
            text _stem_confirm_text size (26 if _stem_small else 28) color "#f0f1eb" xalign 0.5 text_align 0.5 xmaximum (config.screen_width - 180 if _stem_small else 930)
            hbox:
                xalign 0.5
                spacing 12
                textbutton "CONFIRMAR" action yes_action:
                    yminimum (62 if _stem_small else 58)
                textbutton "CANCELAR" action no_action:
                    yminimum (62 if _stem_small else 58)

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
        background "stem_ui_tabs"
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
        background "stem_ui_quick"
        text "[message!tq]" size 20 color "#b4e5d7"
    timer 3.25 action Hide("notify")


screen skip_indicator():
    zorder 180
    frame:
        xalign 0.02
        yalign 0.13
        padding (16, 10)
        background "stem_ui_quick"
        text "MODO DE LEITURA RÁPIDA ATIVO" size 18 color "#b4e5d7"
