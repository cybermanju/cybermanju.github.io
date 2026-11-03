# The Stem Array — custom UI for the Technosutra Ren'Py visual novel.
# Role: presentation only. Dialogue box, choice card, title cards, menus and overlays;
#       narrative state, quizzes and telemetry stay in script.rpy.
# Exports: screens (say, choice, title cards, main_menu, game_menu, save, load,
#       preferences, history, help, about, confirm, input, notify, quick_menu,
#       stem_controls) and their styles.
# Integrates: generated game/script.rpy (image names such as narrator_orb, the
#       built-in `centered` character) and stem_theme_bridge.rpy (stem_theme_*).
# Contracts: never mutates story state; keeps the say screen ids "who"/"what";
#       every panel texture lives under images/ui/ and must ship in game.zip.
#       Panels use Frame(), not Tile(): tiling a bordered 256x256 texture
#       repeats its edge and corner ornaments across every stretched panel.

init offset = -1

init python:
    if "quick_menu" not in config.overlay_screens:
        config.overlay_screens.append("quick_menu")

    def stem_compact_layout():
        """True when the viewport is smaller than the 1920x1080 design grid."""
        if renpy.variant("mobile") or renpy.variant("small"):
            return True
        try:
            width, height = renpy.get_physical_size()
            return width < config.screen_width or height < config.screen_height
        except Exception:
            return False

    def stem_option_label(index, caption):
        """Number the option so keyboard/screen-reader order is visible."""
        return "%02d   %s" % (index, caption)

    def stem_body_size(compact):
        """Dialogue type size: responsive base plus the reader's step."""
        base = 32 if compact else 34
        step = max(0, min(len(STEM_TEXT_STEPS) - 1, int(getattr(persistent, "stem_text_step", 0) or 0)))
        return base + STEM_TEXT_STEPS[step]


default quick_menu = True
default stem_last_dialogue_text = ""
default stem_theme_mode = "flat"
default stem_theme_accent = "#55edff"
default stem_theme_override = False
define stem_speaker_portraits = {}

# Reader-controlled dialogue type scale (persistent). Only the dialogue body
# scales; nameplates, buttons and menus keep their layout metrics.
default persistent.stem_text_step = 0
define STEM_TEXT_STEPS = (0, 4, 9)
define STEM_TEXT_LABELS = ("PADRÃO", "MAIOR", "MUITO MAIOR")

# One texture per surface, two finishes (velvet / glass). Frame borders keep the
# corner ornaments intact and cost nine quads instead of a repeated tile grid.
image stem_ui_panel = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_panel_glass.png", 26, 26), True, Frame("images/ui/velvet_panel_flat.png", 26, 26))
image stem_ui_panel_hover = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_menu_glass.png", 26, 26), True, Frame("images/ui/velvet_menu_flat.png", 26, 26))
image stem_ui_button = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_button_glass.png", 22, 22), True, Frame("images/ui/velvet_button_flat.png", 22, 22))
image stem_ui_button_hover = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_tabs_glass.png", 22, 22), True, Frame("images/ui/velvet_tabs_flat.png", 22, 22))
image stem_ui_dialogue = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_dialogue_glass.png", 30, 30), True, Frame("images/ui/velvet_dialogue_flat.png", 30, 30))
image stem_ui_interstitial = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_interstitial_glass.png", 26, 26), True, Frame("images/ui/velvet_interstitial_flat.png", 26, 26))
image stem_ui_choice = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_choice_glass.png", 28, 28), True, Frame("images/ui/velvet_choice_flat.png", 28, 28))
image stem_ui_question = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_question_glass.png", 24, 24), True, Frame("images/ui/velvet_question_flat.png", 24, 24))
image stem_ui_quick = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_controls_glass.png", 18, 18), True, Frame("images/ui/velvet_controls_flat.png", 18, 18))
image stem_ui_slots = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_slots_glass.png", 20, 20), True, Frame("images/ui/velvet_slots_flat.png", 20, 20))
image stem_ui_tabs = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_tabs_glass.png", 20, 20), True, Frame("images/ui/velvet_tabs_flat.png", 20, 20))
image stem_ui_controls = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_controls_glass.png", 20, 20), True, Frame("images/ui/velvet_controls_flat.png", 20, 20))
image stem_ui_menu = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_menu_glass.png", 30, 30), True, Frame("images/ui/velvet_menu_flat.png", 30, 30))
image stem_ui_nav = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_panel_glass.png", 24, 24), True, Frame("images/ui/velvet_panel_flat.png", 24, 24))
image stem_ui_frame = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_interstitial_glass.png", 24, 24), True, Frame("images/ui/velvet_interstitial_flat.png", 24, 24))
image stem_ui_nameplate = ConditionSwitch("stem_theme_mode == 'glass'", Frame("images/ui/velvet_nameplate_glass.png", 14, 10), True, Frame("images/ui/velvet_nameplate_flat.png", 14, 10))
image stem_generic_speaker = "images/speakers/generic_speaker_shadow.png"

# Title screen: pixel-art chrome generated by tools/generate_pixel_ui.py, so the
# frames are hard-edged bevels with 2 px stepped corners instead of soft velvet.
# Frame() borders match the manifest's frameBorder, keeping corners unscaled.
image stem_pixel_panel = Frame("images/pixel/pixel_panel.png", 24, 24)
image stem_pixel_button = Frame("images/pixel/pixel_button.png", 16, 16)
image stem_pixel_button_hover = Frame("images/pixel/pixel_button_hover.png", 16, 16)
image stem_pixel_start = Frame("images/pixel/pixel_start.png", 22, 22)
image stem_pixel_start_hover = Frame("images/pixel/pixel_start_hover.png", 22, 22)
# build_web.sh always materialises this file: the converted 02.png art when
# available, the opening landscape otherwise.
image bg_stem_title = "images/title/bg_title.jpg"


################################################################################
## Design tokens
################################################################################

style default:
    font "DejaVuSans.ttf"
    color "#edf1ec"
    size 30
    line_spacing 5

# Text buttons: no focus_mask. A focus mask is built from the background's alpha,
# and the velvet textures have rounded translucent corners, so masked buttons
# lose their clickable area (and cost a full-size mask render each).
style button:
    background "stem_ui_button"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    insensitive_background "stem_ui_button"
    xpadding 22
    ypadding 12
    yminimum 60

style button_text:
    font "DejaVuSans.ttf"
    size 27
    color "#e6efea"
    hover_color "#ffffff"
    selected_color "#ffffff"
    insensitive_color "#9fb2be"
    yalign 0.5

style button_text:
    variant "small"
    size 32

style say_label:
    font "DejaVuSans.ttf"
    size 26
    color "#f0fff9"
    bold True
    outlines [(1, "#06121b", 1, 1)]

style say_label:
    variant "small"
    size 30

style say_dialogue:
    font "DejaVuSans.ttf"
    size 34
    color "#f4f4ee"
    line_spacing 7
    adjust_spacing False
    text_align 0.0

style say_dialogue:
    variant "small"
    size 32

# Chapter / scene cards. The built-in `centered` character renders through these
# two style names; a `screen centered` would never be shown, so the card design
# lives here.
style centered_window:
    xalign 0.5
    yalign 0.44
    xmaximum 1560
    background "stem_ui_interstitial"
    padding (48, 32)

style centered_text:
    font "DejaVuSans.ttf"
    size 42
    color "#f5f3ec"
    text_align 0.5
    xalign 0.5
    line_spacing 10

style centered_text:
    variant "small"
    size 40

style choice_button is button
style choice_button_text is button_text
style choice_button:
    xfill True
    yminimum 70
    xpadding 26
    ypadding 14
style choice_button:
    variant "small"
    yminimum 88
    xpadding 20
style choice_button_text:
    size 27
    color "#e9f1ec"
    hover_color "#ffffff"
    text_align 0.0
    xfill True
style choice_button_text:
    variant "small"
    size 30

style navigation_button is button
style navigation_button_text is button_text
style navigation_button:
    background "stem_ui_nav"
    hover_background "stem_ui_button_hover"
    selected_background "stem_ui_button_hover"
    xfill True
    yminimum 62
style navigation_button_text:
    size 26
    color "#e6efea"
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
    selected_background "stem_ui_question"
    xfill True
    yminimum 64
    xpadding 14
style stem_tab_button_text:
    size 20
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
    yminimum 70
    xpadding 20
style stem_control_button:
    variant "small"
    yminimum 92
    xpadding 18
style stem_control_button_text:
    size 24
    color "#e6efea"
    hover_color "#ffffff"
    bold True
style stem_control_button_text:
    variant "small"
    size 32

style quick_button is button
style quick_button_text is button_text
style quick_button:
    background "stem_ui_quick"
    hover_background "stem_ui_button_hover"
    xpadding 16
    ypadding 8
    yminimum 52
style quick_button_text:
    size 18
    color "#e2ece6"
    hover_color "#ffffff"
    bold True
style quick_button_text:
    variant "small"
    size 26

style cyber_slider:
    xsize 560
    ysize 26
    left_bar Solid("#8ad9c4")
    right_bar Solid("#293943")
    thumb Solid("#f3e4c8")


# Pixel-art title screen. Flat colour, hard bevels, wide tracking: the look holds
# at any scale and needs no filter, so it costs nine quads per panel.
style stem_pixel_panel is frame:
    background "stem_pixel_panel"
    padding (40, 34)

style stem_pixel_button is button:
    background "stem_pixel_button"
    hover_background "stem_pixel_button_hover"
    selected_background "stem_pixel_button_hover"
    insensitive_background "stem_pixel_button"
    xfill True
    xpadding 20
    ypadding 12
    yminimum 66

style stem_pixel_button_text is button_text:
    size 24
    bold True
    kerning 1.6
    color "#dff3ef"
    hover_color "#ffffff"
    text_align 0.5

style stem_pixel_button_text:
    variant "small"
    size 29

# The one primary action on the title screen. Gold accent and a taller frame so
# it reads as the thing to press before the housekeeping buttons.
style stem_start_button is stem_pixel_button:
    background "stem_pixel_start"
    hover_background "stem_pixel_start_hover"
    selected_background "stem_pixel_start_hover"
    xpadding 28
    ypadding 20
    yminimum 104

style stem_start_button_text is stem_pixel_button_text:
    size 38
    kerning 2.4
    color "#ffe9a8"
    hover_color "#fff6d8"

style stem_start_button_text:
    variant "small"
    size 34

# Slow drift that continues the DOM loader's zoom after the overlay fades. No
# alpha: a screen re-render (any hover) would restart the animation and flash the
# title back in, so the reveal is owned by the overlay's own fade.
transform stem_title_drift:
    subpixel True
    zoom 1.02
    linear 42.0 zoom 1.075
    linear 42.0 zoom 1.02
    repeat


################################################################################
## Dialogue box
################################################################################

screen say(who, what):
    $ store.stem_last_dialogue_text = str(what)
    $ _stem_small = stem_compact_layout()
    $ _stem_narrator = who is None or who == "ORBE // NARRADOR"
    $ _stem_speaker = None if _stem_narrator else who
    # A portrait appears only when one is explicitly mapped. Repeating the same
    # generic silhouette beside 94 different names implies an identity the art
    # does not have; unmapped speakers get their full width back for text.
    $ _stem_portrait = stem_speaker_portraits.get(str(_stem_speaker)) if _stem_speaker else None
    $ _stem_avatar = 104 if _stem_small else 128
    $ _stem_body = stem_body_size(_stem_small)

    window:
        id "window"
        xalign 0.5
        yalign 1.0
        xfill True
        xmaximum (config.screen_width - 48 if _stem_small else 1640)
        # Size to the text instead of a fixed panel height: a fixed height plus a
        # ymaximum on the text silently clips long narration pages.
        ymaximum (config.screen_height - 120)
        padding (20 if _stem_small else 30, 16 if _stem_small else 22)
        background "stem_ui_dialogue"

        vbox:
            xfill True
            spacing (8 if _stem_small else 12)

            hbox:
                xfill True
                spacing 10
                frame:
                    padding (14, 7)
                    background "stem_ui_nameplate"
                    xmaximum (config.screen_width - 160 if _stem_small else 1100)
                    text (who if who else "NARRADOR") id "who" style "say_label" size (22 if _stem_small else 26)
                null width 1 xfill True
                text ("TOQUE · AVANÇAR" if _stem_small else "CLIQUE / ENTER · AVANÇAR") size (15 if _stem_small else 14) color "#a9b9c4" yalign 0.5

            hbox:
                xfill True
                spacing (16 if _stem_small else 22)
                if _stem_narrator:
                    frame:
                        xsize _stem_avatar
                        ysize _stem_avatar
                        padding (8, 8)
                        background "stem_ui_panel"
                        add "narrator_orb":
                            xsize _stem_avatar - 18
                            ysize _stem_avatar - 18
                            xalign 0.5
                            yalign 0.5
                elif _stem_portrait:
                    frame:
                        xsize _stem_avatar
                        ysize _stem_avatar
                        padding (6, 6)
                        background "stem_ui_interstitial"
                        add _stem_portrait:
                            xsize _stem_avatar - 14
                            ysize _stem_avatar - 14
                            xalign 0.5
                            yalign 0.5
                text what id "what" style "say_dialogue" size _stem_body xfill True text_align 0.0 yalign 0.0


################################################################################
## Story choices and quizzes
################################################################################

screen stem_choice_rows(items, small):
    style_prefix "choice"

    vbox:
        xfill True
        spacing (12 if small else 14)
        for index, item in enumerate(items, 1):
            textbutton stem_option_label(index, item.caption) action item.action:
                xfill True
                yminimum (86 if small else 70)


screen choice(items):
    style_prefix "choice"
    zorder 80
    modal True

    add Solid("#05070fe0")
    $ _stem_small = stem_compact_layout()
    $ _stem_many = len(items) > 6
    $ _stem_yalign = 0.36 if _stem_many else 0.44
    $ _stem_card_max = (config.screen_height - 140) if _stem_small else (config.screen_height - 200)
    $ _stem_question = "?" in stem_last_dialogue_text or "？" in stem_last_dialogue_text

    # Number keys pick the matching numbered option. Bounded to nine so the
    # binding never runs past the end of a long chapter list.
    for _stem_index, _stem_item in enumerate(items[:9], 1):
        key str(_stem_index) action _stem_item.action

    frame:
        xalign 0.5
        yalign _stem_yalign
        xfill True
        xmaximum (config.screen_width - 56 if _stem_small else 1180)
        ymaximum _stem_card_max
        padding (20 if _stem_small else 32, 18 if _stem_small else 26)
        background "stem_ui_choice"

        vbox:
            xfill True
            spacing (10 if _stem_small else 14)

            hbox:
                xfill True
                text ("PERGUNTA" if _stem_question else "ESCOLHA") size (18 if _stem_small else 15) color stem_theme_accent bold True yalign 0.5
                null width 1 xfill True
                text (("%d opções · teclas 1–%d" % (len(items), len(items))) if len(items) <= 9 else ("%d opções" % len(items))) size (17 if _stem_small else 15) color "#a9b9c4" yalign 0.5

            frame:
                xfill True
                padding (16 if _stem_small else 22, 10 if _stem_small else 16)
                background "stem_ui_question"
                text stem_last_dialogue_text size (24 if _stem_small else 23) color "#f6efe9" xfill True text_align 0.0

            if _stem_many:
                viewport:
                    xfill True
                    ymaximum _stem_card_max - 190
                    mousewheel True
                    draggable True
                    pagekeys True
                    scrollbars "vertical"
                    use stem_choice_rows(items, _stem_small)
            else:
                use stem_choice_rows(items, _stem_small)


################################################################################
## In-game quick controls
################################################################################

screen quick_menu():
    zorder 100

    if quick_menu and not main_menu and renpy.get_screen("choice") is None:
        $ _stem_small = stem_compact_layout()
        key "game_menu" action ShowMenu("stem_controls")
        frame:
            xalign 0.985
            yalign 0.02
            padding (6, 5)
            background "stem_ui_quick"
            hbox:
                style_prefix "quick"
                spacing 6
                textbutton "MENU" action ShowMenu("stem_controls"):
                    yminimum (80 if _stem_small else 52)
                textbutton "HISTÓRICO" action ShowMenu("history"):
                    yminimum (80 if _stem_small else 52)
                textbutton "AUTO" action Preference("auto-forward", "toggle"):
                    yminimum (80 if _stem_small else 52)
                textbutton "PULAR" action Skip() alternate Skip(fast=True, confirm=True):
                    yminimum (80 if _stem_small else 52)


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
        xmaximum (config.screen_width - 60 if _stem_small else 1280)
        padding (26 if _stem_small else 40, 22 if _stem_small else 34)
        background "stem_ui_menu"

        vbox:
            xfill True
            spacing (18 if _stem_small else 22)

            hbox:
                xfill True
                vbox:
                    spacing 4
                    text "THE STEM ARRAY" size (20 if _stem_small else 15) color stem_theme_accent bold True
                    text "Pausa e navegação" size (34 if _stem_small else 40) color "#f3f2ec" bold True
                null width 1 xfill True
                textbutton "CONTINUAR" action Return():
                    xfill False
                    xminimum (210 if _stem_small else 190)
                    yminimum (68 if _stem_small else 60)

            frame:
                xfill True
                padding (18, 16)
                background "stem_ui_controls"

                vbox:
                    xfill True
                    spacing (12 if _stem_small else 16)
                    text "FERRAMENTAS DA JORNADA" size (21 if _stem_small else 15) color "#a9cbbd" bold True

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


################################################################################
## Main menu and reusable game menu
################################################################################

screen main_menu():
    tag menu

    # Same artwork the Web loading overlay zooms on, so the hand-off after that
    # overlay fades is a continuation of the same image rather than a jump cut.
    add "bg_stem_title" at stem_title_drift
    add Solid("#050a10a6")
    $ _stem_small = stem_compact_layout()

    if _stem_small:
        vbox:
            xalign 0.5
            yalign 0.5
            xfill True
            xmaximum (config.screen_width - 64)
            spacing 14

            frame:
                xfill True
                padding (26, 22)
                background "stem_pixel_panel"
                hbox:
                    xfill True
                    spacing 18
                    vbox:
                        xfill True
                        yalign 0.5
                        spacing 6
                        text "UMA LEITURA INTERATIVA · 56 CAPÍTULOS" size 16 color stem_theme_accent bold True kerning 2.2
                        text "THE STEM\nARRAY" size 46 color "#f7f3e6" bold True kerning 2.6
                        text "Gaṇḍavyūha · uma jornada de encontros e ensinamentos." size 23 color "#cfdcd6"
                    add "master_ch01_provisional":
                        xsize 150
                        ysize 200
                        yalign 0.5

            frame:
                xfill True
                padding (26, 22)
                background "stem_pixel_panel"
                vbox:
                    xfill True
                    spacing 10
                    hbox:
                        xfill True
                        text "COMECE OU RETOME" size 16 color "#b7d6c9" bold True kerning 2.0
                        null width 1 xfill True
                        text "PORTUGUÊS" size 16 color "#98aaa7"
                    use navigation
                    text "Retrato de referência · render estático provisório." size 16 color "#98aaa7"
    else:
        hbox:
            xalign 0.5
            yalign 0.5
            spacing 26

            frame:
                xsize 1010
                ymaximum 830
                padding (46, 40)
                background "stem_pixel_panel"
                vbox:
                    xfill True
                    spacing 14
                    text "LEITURA INTERATIVA · 56 CAPÍTULOS" size 15 color stem_theme_accent bold True kerning 2.4
                    text "THE STEM ARRAY" size 78 color "#f7f3e6" bold True kerning 3.0
                    text "GAṆḌAVYŪHA  ·  A JORNADA DE SUDHANA" size 20 color "#b9d9ce" kerning 1.6
                    text "Uma visual novel em português sobre encontros, ensinamentos e escolhas de reflexão. Os quizzes acompanham a leitura sem substituir a narrativa." size 25 color "#d3ddd7" xmaximum 880
                    null height 4
                    text "COMECE OU RETOME" size 14 color "#b7d6c9" bold True kerning 2.2
                    use navigation
                    text "Versão [config.version] · Narrativa em português" size 15 color "#98aaa7"

            frame:
                xsize 470
                ymaximum 830
                padding (30, 26)
                background "stem_pixel_panel"
                vbox:
                    xfill True
                    yfill True
                    spacing 10
                    text "ARQUIVO DE PERSONAGENS" size 15 color "#b7d6c9" bold True
                    add "master_ch01_provisional":
                        xsize 330
                        ysize 440
                        xalign 0.5
                    null height 1
                    text "MESTRE · CAPÍTULO 01" size 17 color "#e8eee8" xalign 0.5
                    text "Render de referência estático e provisório." size 14 color "#9badaa" xalign 0.5 text_align 0.5


screen navigation():
    style_prefix "navigation"
    $ _stem_nav_small = renpy.variant("mobile") or renpy.variant("small")
    $ _stem_nav_min = 70 if _stem_nav_small else 62

    vbox:
        xfill True
        spacing 10

        if main_menu:
            # One primary action, the rest subordinate: the title screen answers
            # "what do I do here?" before it offers housekeeping.
            textbutton "INICIAR JORNADA" action Start() style "stem_start_button":
                yminimum (112 if _stem_nav_small else 104)
            null height 2
            textbutton "CARREGAR JOGO" action ShowMenu("load") style "stem_pixel_button":
                yminimum _stem_nav_min
            textbutton "SALVAR JOGO" action ShowMenu("save") style "stem_pixel_button":
                yminimum _stem_nav_min
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences") style "stem_pixel_button":
                yminimum _stem_nav_min
            textbutton "SOBRE" action ShowMenu("about") style "stem_pixel_button":
                yminimum _stem_nav_min
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help") style "stem_pixel_button":
                    yminimum _stem_nav_min
            if renpy.variant("pc"):
                textbutton "SAIR" action Quit(confirm=True) style "stem_pixel_button":
                    yminimum _stem_nav_min
        else:
            textbutton "RETOMAR JOGO" action Return():
                yminimum _stem_nav_min
            textbutton "HISTÓRICO" action ShowMenu("history"):
                yminimum _stem_nav_min
            textbutton "SALVAR" action ShowMenu("save"):
                yminimum _stem_nav_min
            textbutton "CARREGAR" action ShowMenu("load"):
                yminimum _stem_nav_min
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences"):
                yminimum _stem_nav_min
            textbutton "SOBRE" action ShowMenu("about"):
                yminimum _stem_nav_min
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help"):
                    yminimum _stem_nav_min
            textbutton "MENU INICIAL" action MainMenu():
                yminimum _stem_nav_min


screen game_menu(title, scroll=None, yinitial=0.0, spacing=0):
    tag menu
    modal True
    zorder 150
    $ _stem_small = stem_compact_layout()

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

                hbox:
                    xfill True
                    vbox:
                        spacing 3
                        text "CYBERMANJU  //  STEM ARRAY" size (20 if _stem_small else 17) color stem_theme_accent
                        text title size (34 if _stem_small else 40) color "#f1f7ff" bold True
                    null width 1 xfill True
                    textbutton "VOLTAR" action Return():
                        yminimum 60

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
                                xsize 360
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
            text "Cada superfície usa um padrão próprio. O modo vidro mantém a cena visível por trás dos painéis." size (17 if small else 21) color "#ddd8de" xmaximum (config.screen_width - 220 if small else 1180)
            hbox:
                xfill True
                spacing 10
                if stem_theme_mode == "flat":
                    textbutton "VELUDO · ATIVO" action [SetVariable("stem_theme_mode", "flat"), SetVariable("stem_theme_override", True)] style "stem_tab_selected":
                        yminimum (80 if small else 64)
                else:
                    textbutton "VELUDO" action [SetVariable("stem_theme_mode", "flat"), SetVariable("stem_theme_override", True)] style "stem_tab_button":
                        yminimum (80 if small else 64)
                if stem_theme_mode == "glass":
                    textbutton "VIDRO · ATIVO" action [SetVariable("stem_theme_mode", "glass"), SetVariable("stem_theme_override", True)] style "stem_tab_selected":
                        yminimum (80 if small else 64)
                else:
                    textbutton "VIDRO" action [SetVariable("stem_theme_mode", "glass"), SetVariable("stem_theme_override", True)] style "stem_tab_button":
                        yminimum (80 if small else 64)
            if stem_theme_override:
                textbutton "SEGUIR APARÊNCIA DO APP" action SetVariable("stem_theme_override", False) style "quick_button":
                    yminimum (76 if small else 58)


screen stem_file_slot_card(slot, small=False):
    button:
        xsize 350
        ysize (156 if small else 258)
        padding (8 if small else 12, 6 if small else 10)
        background "stem_ui_slots"
        hover_background "stem_ui_button_hover"
        action FileAction(slot)

        has vbox
        spacing (3 if small else 7)
        if FileLoadable(slot):
            add FileScreenshot(slot) xalign 0.5 xsize (310 if small else 320) ysize (60 if small else 160)
        else:
            frame:
                xfill True
                ysize (60 if small else 160)
                background "stem_ui_slots"
                text "+" size (34 if small else 42) color stem_theme_accent xalign 0.5 yalign 0.5
        text FileTime(slot, format="%d/%m/%Y %H:%M", empty="SLOT VAZIO") size (16 if small else 18) color "#c3d2dd" xalign 0.5
        if FileLoadable(slot):
            text FileSaveName(slot) size (17 if small else 19) color "#e8f3ff" xalign 0.5
        elif not small:
            text "NOVO REGISTRO" size 17 color "#7e95a9" xalign 0.5

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
                xmaximum (1100 if _stem_small else 560)
                yminimum (52 if _stem_small else 62)
                padding (12 if _stem_small else 18, 6 if _stem_small else 10)
                background "stem_ui_panel"
                hover_background "stem_ui_panel_hover"
                action page_name_value.Toggle()
                key_events True

                input value page_name_value:
                    xalign 0.5
                    size (22 if _stem_small else 24)
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
                textbutton "<" action FilePagePrevious() style "stem_tab_button":
                    yminimum (80 if _stem_small else 60)
                if config.has_autosave:
                    textbutton "AUTO" action FilePage("auto") style "stem_tab_button":
                        yminimum (80 if _stem_small else 60)
                if config.has_quicksave:
                    textbutton "RÁPIDOS" action FilePage("quick") style "stem_tab_button":
                        yminimum (80 if _stem_small else 60)
                for page in range(1, 10):
                    textbutton "[page]" action FilePage(page) style "stem_tab_button":
                        yminimum (80 if _stem_small else 60)
                textbutton ">" action FilePageNext() style "stem_tab_button":
                    yminimum (80 if _stem_small else 60)


screen preferences():
    tag menu
    default _stem_pref_tab = "visual"
    $ _stem_small = stem_compact_layout()
    $ _stem_audio = config.has_music or config.has_sound or config.has_voice
    $ _stem_step = max(0, min(len(STEM_TEXT_STEPS) - 1, int(getattr(persistent, "stem_text_step", 0) or 0)))

    use game_menu("PREFERÊNCIAS", scroll="viewport"):
        vbox:
            xfill True
            spacing (12 if _stem_small else 26)

            if _stem_small:
                hbox:
                    xfill True
                    spacing 6
                    if _stem_pref_tab == "visual":
                        textbutton "VISUAL" action SetScreenVariable("_stem_pref_tab", "visual") style "stem_tab_selected":
                            yminimum 80
                    else:
                        textbutton "VISUAL" action SetScreenVariable("_stem_pref_tab", "visual") style "stem_tab_button":
                            yminimum 80
                    if _stem_pref_tab == "text":
                        textbutton "TEXTO" action SetScreenVariable("_stem_pref_tab", "text") style "stem_tab_selected":
                            yminimum 80
                    else:
                        textbutton "TEXTO" action SetScreenVariable("_stem_pref_tab", "text") style "stem_tab_button":
                            yminimum 80
                    # The ÁUDIO tab only exists when this build actually has an
                    # audio channel; an empty tab is worse than no tab.
                    if _stem_audio:
                        if _stem_pref_tab == "audio":
                            textbutton "ÁUDIO" action SetScreenVariable("_stem_pref_tab", "audio") style "stem_tab_selected":
                                yminimum 80
                        else:
                            textbutton "ÁUDIO" action SetScreenVariable("_stem_pref_tab", "audio") style "stem_tab_button":
                                yminimum 80
                    if _stem_pref_tab == "theme":
                        textbutton "TEMA" action SetScreenVariable("_stem_pref_tab", "theme") style "stem_tab_selected":
                            yminimum 80
                    else:
                        textbutton "TEMA" action SetScreenVariable("_stem_pref_tab", "theme") style "stem_tab_button":
                            yminimum 80

                if _stem_pref_tab == "visual":
                    vbox:
                        xfill True
                        spacing 8
                        text "TELA E ACESSIBILIDADE" size 22 color stem_theme_accent bold True
                        text "Modo de exibição" size 19 color "#a9bed0"
                        hbox:
                            spacing 8
                            textbutton "JANELA" action Preference("display", "window"):
                                yminimum 56
                            textbutton "TELA CHEIA" action Preference("display", "fullscreen"):
                                yminimum 56
                        text "Leitura" size 19 color "#a9bed0"
                        hbox:
                            spacing 6
                            textbutton "PULAR NÃO LIDO" action Preference("skip", "toggle") style "quick_button":
                                yminimum 54
                            textbutton "APÓS ESCOLHAS" action Preference("after choices", "toggle") style "quick_button":
                                yminimum 54
                            textbutton "TRANSIÇÕES" action InvertSelected(Preference("transitions", "toggle")) style "quick_button":
                                yminimum 54

                elif _stem_pref_tab == "text":
                    vbox:
                        xfill True
                        spacing 10
                        text "LEITURA E AVANÇO" size 22 color stem_theme_accent bold True
                        text "Velocidade do texto" size 19 color "#a9bed0"
                        bar value Preference("text speed") style "cyber_slider" xfill True ysize 48
                        text "Avanço automático" size 19 color "#a9bed0"
                        bar value Preference("auto-forward time") style "cyber_slider" xfill True ysize 48
                        null height 4
                        text "Tamanho do texto" size 19 color "#a9bed0"
                        hbox:
                            spacing 6
                            for _step in range(len(STEM_TEXT_STEPS)):
                                if _stem_step == _step:
                                    textbutton STEM_TEXT_LABELS[_step] action SetField(persistent, "stem_text_step", _step) style "stem_tab_selected":
                                        yminimum 56
                                else:
                                    textbutton STEM_TEXT_LABELS[_step] action SetField(persistent, "stem_text_step", _step) style "stem_tab_button":
                                        yminimum 56

                elif _stem_pref_tab == "audio":
                    vbox:
                        xfill True
                        spacing 8
                        text "VOLUME // ÁUDIO" size 22 color stem_theme_accent bold True
                        text "Esta build não inclui faixas de áudio." size 19 color "#f0f7ff"
                        if config.has_music:
                            text "Música" size 19 color "#a9bed0"
                            bar value Preference("music volume") style "cyber_slider" xfill True ysize 44
                        if config.has_sound:
                            text "Efeitos" size 19 color "#a9bed0"
                            bar value Preference("sound volume") style "cyber_slider" xfill True ysize 44
                        if config.has_voice:
                            text "Voz" size 19 color "#a9bed0"
                            bar value Preference("voice volume") style "cyber_slider" xfill True ysize 44
                else:
                    use stem_theme_controls(True)
            else:
                text "TELA E ACESSIBILIDADE" size 26 color stem_theme_accent bold True
                grid 2 1:
                    xfill True
                    spacing 28
                    vbox:
                        spacing 10
                        text "Modo de exibição" size 22 color "#a9bed0"
                        textbutton "JANELA" action Preference("display", "window")
                        textbutton "TELA CHEIA" action Preference("display", "fullscreen")
                    vbox:
                        spacing 10
                        text "Leitura" size 22 color "#a9bed0"
                        textbutton "PULAR TEXTO NÃO LIDO" action Preference("skip", "toggle")
                        textbutton "PULAR APÓS ESCOLHAS" action Preference("after choices", "toggle")
                        textbutton "TRANSIÇÕES" action InvertSelected(Preference("transitions", "toggle"))

                null height 8
                text "TEXTO" size 26 color stem_theme_accent bold True
                text "Velocidade do texto" size 22 color "#a9bed0"
                bar value Preference("text speed") style "cyber_slider" xsize 560 ysize 26
                text "Avanço automático" size 22 color "#a9bed0"
                bar value Preference("auto-forward time") style "cyber_slider" xsize 560 ysize 26
                text "Tamanho do texto" size 22 color "#a9bed0"
                hbox:
                    spacing 10
                    for _step in range(len(STEM_TEXT_STEPS)):
                        if _stem_step == _step:
                            textbutton STEM_TEXT_LABELS[_step] action SetField(persistent, "stem_text_step", _step) style "stem_tab_selected"
                        else:
                            textbutton STEM_TEXT_LABELS[_step] action SetField(persistent, "stem_text_step", _step) style "stem_tab_button"

                if config.has_music or config.has_sound or config.has_voice:
                    null height 10
                    text "ÁUDIO" size 26 color stem_theme_accent bold True
                    if config.has_music:
                        text "Música" size 22 color "#a9bed0"
                        bar value Preference("music volume") style "cyber_slider" xsize 560 ysize 26
                    if config.has_sound:
                        text "Efeitos" size 22 color "#a9bed0"
                        bar value Preference("sound volume") style "cyber_slider" xsize 560 ysize 26
                    if config.has_voice:
                        text "Voz" size 22 color "#a9bed0"
                        bar value Preference("voice volume") style "cyber_slider" xsize 560 ysize 26

                null height 12
                use stem_theme_controls(False)


screen history():
    tag menu
    predict False
    $ _stem_small = stem_compact_layout()

    use game_menu("HISTÓRICO", scroll="viewport", yinitial=1.0, spacing=14):
        vbox:
            xfill True
            spacing (8 if _stem_small else 12)

            if _history_list:
                # Newest first: the line just read is visible without scrolling.
                # Bounded to the recent log, because every entry becomes a
                # displayable each time the log is opened.
                for _stem_entry in reversed(_history_list[-120:]):
                    frame:
                        xfill True
                        padding (16, 12)
                        background "stem_ui_interstitial"
                        vbox:
                            xfill True
                            spacing 6
                            if _stem_entry.who:
                                text _stem_entry.who size (19 if _stem_small else 20) color stem_theme_accent bold True substitute False
                            text _stem_entry.what size (20 if _stem_small else 23) color "#e5eff8" substitute False xfill True text_align 0.0
            else:
                text "Ainda não há diálogo registrado. Volte à leitura para encher este arquivo." size (21 if _stem_small else 23) color "#a9bed0" xalign 0.5


screen help():
    tag menu
    $ _stem_small = stem_compact_layout()

    use game_menu("CONTROLES", scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 18)
            text "TECLADO" size (21 if _stem_small else 24) color stem_theme_accent bold True
            text "Clique / Enter — avançar diálogo e ativar botões" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Espaço — avançar sem selecionar escolhas" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Setas — navegar entre opções; Enter — confirmar" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "1–9 — escolher direto a opção com aquele número" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Esc / botão direito — abrir o menu do jogo" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Ctrl — acelerar enquanto pressionado; Tab — alternar pulo" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Page Up / roda para cima — voltar ao diálogo anterior" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "H — ocultar interface; S — capturar a tela" size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            null height (5 if _stem_small else 18)
            text "TOQUE" size (21 if _stem_small else 24) color stem_theme_accent bold True
            text "Toque na caixa de diálogo para avançar. As opções são numeradas e mantêm navegação por teclado." size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)


screen about():
    tag menu
    $ _stem_small = stem_compact_layout()

    use game_menu("SOBRE", scroll="viewport"):
        vbox:
            xfill True
            spacing (8 if _stem_small else 16)
            text "[config.name]" size (24 if _stem_small else 30) color stem_theme_accent bold True
            text "Versão [config.version]" size (19 if _stem_small else 21) color "#a9bed0"
            text "Adaptação narrativa em português dos 56 capítulos. As escolhas são reflexões opcionais; os quizzes são atividades originais de leitura e não alteram a narrativa." size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Roteiro baseado no texto integral autorizado. As falas da VN são uma adaptação, não citações da tradução." size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Retratos marcados como provisórios são imagens estáticas e não representam animações ou variações de expressão." size (19 if _stem_small else 23) xmaximum (config.screen_width - 220 if _stem_small else 1180)
            text "Feito com Ren'Py." size (19 if _stem_small else 20) color "#a9bed0"


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
        xmaximum (config.screen_width - 100 if _stem_small else 1050)
        padding (32 if _stem_small else 40, 28 if _stem_small else 34)
        background "stem_ui_question"

        vbox:
            xfill True
            spacing 18
            text "CONFIRMAÇÃO" size (17 if _stem_small else 15) color stem_theme_accent bold True xalign 0.5
            text _stem_confirm_text size (26 if _stem_small else 30) color "#f0f1eb" xalign 0.5 text_align 0.5 xmaximum (config.screen_width - 180 if _stem_small else 930)
            hbox:
                xalign 0.5
                spacing 12
                textbutton "CONFIRMAR" action yes_action:
                    yminimum (64 if _stem_small else 60)
                textbutton "CANCELAR" action no_action:
                    yminimum (64 if _stem_small else 60)

    key "game_menu" action no_action


screen input(prompt):
    $ _stem_small = stem_compact_layout()
    modal True
    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum (config.screen_width - 110 if _stem_small else 1100)
        padding (28, 24)
        background "stem_ui_tabs"
        vbox:
            spacing 15
            text prompt size (30 if _stem_small else 26) color stem_theme_accent
            input id "input" size (31 if _stem_small else 27) color "#f0f7ff"


screen notify(message):
    zorder 180
    frame:
        xalign 0.5
        yalign 0.08
        padding (18, 12)
        background "stem_ui_quick"
        text "[message!tq]" size 22 color "#b4e5d7"
    timer 3.25 action Hide("notify")


screen skip_indicator():
    zorder 180
    frame:
        xalign 0.02
        yalign 0.13
        padding (16, 10)
        background "stem_ui_quick"
        text "MODO DE LEITURA RÁPIDA ATIVO" size 19 color "#b4e5d7"
