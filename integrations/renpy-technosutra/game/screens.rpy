# The Stem Array — custom cyberpunk UI for Ren'Py.
# Presentation-only screens: chapter text, choices, quizzes, jumps, and telemetry stay in script.rpy.

init offset = -1

init python:
    if "quick_menu" not in config.overlay_screens:
        config.overlay_screens.append("quick_menu")
    if "stem_ascii_root" not in config.overlay_screens:
        config.overlay_screens.append("stem_ascii_root")

    import hashlib as _stem_hashlib

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
style choice_button_text:
    size 23
    color "#1b2632"
    hover_color "#073d4b"
    text_align 0.0

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

style quick_button is button
style quick_button_text is button_text
style quick_button:
    background "stem_ui_panel"
    hover_background "stem_ui_panel_hover"
    xpadding 13
    ypadding 7
    yminimum 42
style quick_button_text:
    size 17
    color "#edf5ff"
    hover_color "#ffffff"

style stem_ascii:
    font "DejaVuSans.ttf"
    size 12
    color "#74bfc2"

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
    $ _stem_panel_height = 400 if _stem_message_length > 850 else (360 if _stem_message_length > 600 else 300)
    $ _stem_font_size = 23 if _stem_message_length > 850 else (25 if _stem_message_length > 600 else 29)
    $ _stem_garden = stem_ascii_garden(str(what), 150)
    $ _stem_small = renpy.variant("mobile") or renpy.variant("small")
    if _stem_small:
        $ _stem_font_size = max(19, _stem_font_size - 3)
        $ _stem_panel_height = int(_stem_panel_height * 0.92)

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
                padding (28, 14)
                background "stem_ui_panel"

                vbox:
                    spacing 7
                    text _stem_garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5

                    hbox:
                        spacing 12
                        text "CANAL //" size 17 color stem_theme_accent yalign 0.5
                        if who is not None:
                            text who id "who" style "say_label"
                        else:
                            text "NARRADOR" id "who" style "say_label"
                        null width 1 xfill True
                        text "AVANÇAR  ·  CLIQUE / ENTER" size 16 color "#8faac0" xfill True xalign 1.0 yalign 0.5

                    text what id "what" style "say_dialogue" size _stem_font_size xfill True xmaximum 1724
                    text _stem_garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5


screen centered(message):
    tag centered
    zorder 25

    frame:
        xalign 0.5
        yalign 0.14
        xfill True
        xmaximum 1500
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            padding (24, 16)
            background "stem_ui_panel"

            vbox:
                spacing 5
                text stem_ascii_garden(message, 126) style "stem_ascii" xalign 0.5 xfill True text_align 0.5
                if message.startswith("Capítulo"):
                    text "ARQUIVO // CAPÍTULO" size 17 color "#54eefe" xalign 0.5
                elif message.startswith("Cena"):
                    text "TRANSMISSÃO // CENA" size 17 color "#54eefe" xalign 0.5
                else:
                    text "SINAL // REGISTRO" size 17 color "#54eefe" xalign 0.5

                text message size 38 color "#f0f7ff" xalign 0.5 text_align 0.5 xmaximum 1420
                text stem_ascii_garden(message, 126) style "stem_ascii" xalign 0.5 xfill True text_align 0.5


screen choice(items):
    style_prefix "choice"
    zorder 80
    modal True

    add Solid("#02050d99")
    $ _stem_small = renpy.variant("mobile") or renpy.variant("small")
    $ _stem_question_size = 21 if _stem_small else 26
    $ _stem_choice_max_height = 660 if _stem_small else 900
    $ _stem_garden = stem_ascii_garden(stem_last_dialogue_text or "choice", 146)

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
            padding (22, 14)
            background "stem_ui_panel"

            vbox:
                spacing 9
                text _stem_garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5

                hbox:
                    spacing 12
                    text "ROTA //" size 18 color stem_theme_accent yalign 0.5
                    text "Selecione uma opção" size 18 color "#a8bbce" yalign 0.5

                if stem_last_dialogue_text.strip().endswith("?") or stem_last_dialogue_text.strip().endswith("？"):
                    frame:
                        xfill True
                        padding (14, 9)
                        background "stem_ui_button"

                        vbox:
                            spacing 5
                            text "PERGUNTA //" size 15 color stem_theme_accent bold True
                            text stem_last_dialogue_text size _stem_question_size color "#182631" xalign 0.0 text_align 0.0 xfill True xmaximum 1480

                if _stem_small and len(items) > 6:
                    viewport:
                        xfill True
                        ymaximum 390
                        scrollbars "vertical"
                        mousewheel True
                        draggable True
                        pagekeys True
                        vbox:
                            xfill True
                            spacing 7
                            for i in items:
                                frame:
                                    xfill True
                                    padding (2, 2)
                                    background Solid(stem_theme_accent)
                                    textbutton i.caption action i.action
                else:
                    vbox:
                        xfill True
                        spacing 7
                        for i in items:
                            frame:
                                xfill True
                                padding (2, 2)
                                background Solid(stem_theme_accent)
                                textbutton i.caption action i.action

                text _stem_garden style "stem_ascii" xalign 0.5 xfill True text_align 0.5


################################################################################
## In-game quick controls
################################################################################

screen quick_menu():
    zorder 100

    if quick_menu and not main_menu:
        frame:
            xalign 0.99
            yalign 0.025
            padding (2, 2)
            background Solid(stem_theme_accent)

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


screen stem_ascii_root():
    zorder 300
    $ _stem_seed = stem_last_dialogue_text or config.name
    text stem_ascii_garden(str(_stem_seed) + "|root-top", 170) style "stem_ascii" xalign 0.5 ypos 3 xmaximum 1880 text_align 0.5
    text stem_ascii_garden(str(_stem_seed) + "|root-bottom", 170) style "stem_ascii" xalign 0.5 yalign 1.0 yoffset -3 xmaximum 1880 text_align 0.5
    text "~\n|\n@\n|\n~" style "stem_ascii" xalign 0.003 yalign 0.5
    text "~\n|\n*\n|\n~" style "stem_ascii" xalign 0.997 yalign 0.5


################################################################################
## Main menu and reusable game menu
################################################################################

screen main_menu():
    tag menu

    add "bg_intro_scene"
    add Solid("#020712a8")

    frame:
        xalign 0.055
        yalign 0.5
        xfill True
        xmaximum 1010
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
                text "ARQUIVO NEURAL  //  56 CAPÍTULOS" size 19 color "#52eefd"
                null height 18
                text "THE STEM ARRAY" size 68 color "#f2f7ff" bold True
                text "GAṆḌAVYŪHA  ·  VISUAL NOVEL CYBERPUNK" size 23 color "#73eaf4"
                null height 12
                text "Uma jornada interativa por 56 capítulos: encontros, ensinamentos e escolhas de reflexão. As decisões e os quizzes acompanham a leitura sem substituir a narrativa." size 27 color "#d5e2ef" xmaximum 880
                null height 20
                text "NARRATIVA  //  PORTUGUÊS" size 18 color "#879db4"

    frame:
        xalign 0.94
        yalign 0.5
        xfill True
        xmaximum 570
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

    vbox:
        xfill True
        spacing 10

        if main_menu:
            textbutton "INICIAR JORNADA" action Start()
            textbutton "CARREGAR JOGO" action ShowMenu("load")
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences")
            textbutton "SOBRE" action ShowMenu("about")
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help")
            if renpy.variant("pc"):
                textbutton "SAIR" action Quit(confirm=True)
        else:
            textbutton "RETOMAR JOGO" action Return()
            textbutton "HISTÓRICO" action ShowMenu("history")
            textbutton "SALVAR" action ShowMenu("save")
            textbutton "CARREGAR" action ShowMenu("load")
            textbutton "PREFERÊNCIAS" action ShowMenu("preferences")
            textbutton "SOBRE" action ShowMenu("about")
            if renpy.variant("pc") or (renpy.variant("web") and not renpy.variant("mobile")):
                textbutton "CONTROLES" action ShowMenu("help")
            textbutton "MENU INICIAL" action MainMenu()


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

                hbox:
                    xfill True
                    vbox:
                        spacing 3
                        text "CYBERMANJU  //  STEM ARRAY" size 17 color "#51edf8"
                        text title size 38 color "#f1f7ff" bold True
                    null width 1 xfill True
                    textbutton "VOLTAR" action Return()

                frame:
                    xfill True
                    yfill True
                    padding (12, 12)
                    background "stem_ui_panel"

                    hbox:
                        spacing 16

                        frame:
                            xsize 350
                            yfill True
                            padding (20, 18)
                            background "stem_ui_panel"

                            vbox:
                                spacing 12
                                text "NAVEGAÇÃO" size 17 color "#55eefa"
                                use navigation

                        frame:
                            xfill True
                            yfill True
                            padding (22, 18)
                            background "stem_ui_panel"

                            if scroll == "viewport":
                                viewport:
                                    xfill True
                                    yfill True
                                    yinitial yinitial
                                    scrollbars "vertical"
                                    mousewheel True
                                    draggable True
                                    pagekeys True

                                    vbox:
                                        xfill True
                                        spacing spacing
                                        transclude
                            else:
                                vbox:
                                    xfill True
                                    yfill True
                                    spacing spacing
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


screen file_slots(title):
    default page_name_value = FilePageNameInputValue(pattern="PÁGINA {}", auto="AUTOMÁTICOS", quick="RÁPIDOS")

    use game_menu(title, scroll="viewport"):
        vbox:
            xfill True
            spacing 18

            button:
                xalign 0.5
                xmaximum 520
                padding (18, 10)
                background "stem_ui_panel"
                hover_background "stem_ui_panel_hover"
                action page_name_value.Toggle()
                key_events True

                input value page_name_value:
                    xalign 0.5
                    size 21
                    color "#e8f4ff"
                    text_align 0.5

            grid 3 2:
                xalign 0.5
                spacing 14

                for i in range(6):
                    $ slot = i + 1

                    button:
                        xsize 350
                        ysize 255
                        padding (12, 10)
                        background "stem_ui_panel"
                        hover_background "stem_ui_panel_hover"
                        action FileAction(slot)

                        has vbox
                        spacing 7
                        add FileScreenshot(slot) xalign 0.5 xsize 320 ysize 160
                        text FileTime(slot, format="%d/%m/%Y %H:%M", empty="SLOT VAZIO") size 17 color "#8fa5bb" xalign 0.5
                        text FileSaveName(slot) size 18 color "#e8f3ff" xalign 0.5

                        key "save_delete" action FileDelete(slot)

            hbox:
                xalign 0.5
                spacing 8
                textbutton "‹" action FilePagePrevious()
                if config.has_autosave:
                    textbutton "AUTO" action FilePage("auto")
                if config.has_quicksave:
                    textbutton "RÁPIDOS" action FilePage("quick")
                for page in range(1, 10):
                    textbutton "[page]" action FilePage(page)
                textbutton "›" action FilePageNext()


screen preferences():
    tag menu

    use game_menu("PREFERÊNCIAS", scroll="viewport"):
        vbox:
            xfill True
            spacing 26

            text "TELA E ACESSIBILIDADE" size 24 color "#55eefa" bold True

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
            bar value Preference("text speed") style "cyber_slider"
            text "Avanço automático" size 20 color "#a9bed0"
            bar value Preference("auto-forward time") style "cyber_slider"

            if config.has_music or config.has_sound or config.has_voice:
                null height 10
                text "ÁUDIO" size 24 color "#55eefa" bold True
                if config.has_music:
                    text "Música" size 20 color "#a9bed0"
                    bar value Preference("music volume") style "cyber_slider"
                if config.has_sound:
                    text "Efeitos" size 20 color "#a9bed0"
                    bar value Preference("sound volume") style "cyber_slider"
                if config.has_voice:
                    text "Voz" size 20 color "#a9bed0"
                    bar value Preference("voice volume") style "cyber_slider"


screen history():
    tag menu
    predict False

    use game_menu("HISTÓRICO", scroll="viewport", yinitial=1.0, spacing=14):
        vbox:
            xfill True
            spacing 14

            for h in _history_list:
                frame:
                    xfill True
                    padding (16, 12)
                    background "stem_ui_panel"
                    vbox:
                        spacing 6
                        if h.who:
                            text h.who size 20 color "#55eefa" bold True substitute False
                        text h.what size 23 color "#e5eff8" substitute False

            if not _history_list:
                text "Ainda não há diálogo registrado." size 22 color "#a9bed0" xalign 0.5


screen help():
    tag menu

    use game_menu("CONTROLES", scroll="viewport"):
        vbox:
            spacing 18
            text "TECLADO" size 24 color "#55eefa" bold True
            text "Clique / Enter — avançar diálogo e ativar botões" size 22
            text "Espaço — avançar sem selecionar escolhas" size 22
            text "Setas — navegar entre opções" size 22
            text "Esc / botão direito — abrir o menu do jogo" size 22
            text "Ctrl — acelerar enquanto pressionado; Tab — alternar pulo" size 22
            text "Page Up / roda para cima — voltar ao diálogo anterior" size 22
            text "H — ocultar interface; S — capturar a tela" size 22
            null height 18
            text "TOQUE" size 24 color "#55eefa" bold True
            text "Toque na caixa de diálogo para avançar. Os botões de escolha mantêm a navegação acessível por teclado." size 22


screen about():
    tag menu

    use game_menu("SOBRE", scroll="viewport"):
        vbox:
            spacing 16
            text "[config.name]" size 30 color "#55eefa" bold True
            text "Versão [config.version]" size 21 color "#a9bed0"
            text "Adaptação narrativa em português dos 56 capítulos. As escolhas são reflexões opcionais; os quizzes são atividades originais de leitura e não alteram a narrativa." size 23
            text "Roteiro baseado no texto integral autorizado. As falas da VN são uma adaptação, não citações da tradução." size 23
            text "Retratos marcados como provisórios são imagens estáticas e não representam animações ou variações de expressão." size 23
            text "Feito com Ren’Py." size 20 color "#a9bed0"


################################################################################
## Confirmations and system overlays
################################################################################

screen confirm(message, yes_action, no_action):
    modal True
    zorder 200
    add Solid("#020713dd")

    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum 1050
        padding (3, 3)
        background Solid(stem_theme_accent)

        frame:
            xfill True
            padding (36, 30)
            background "stem_ui_panel"

            vbox:
                spacing 24
                text _(message) size 28 color "#f0f7ff" xalign 0.5 text_align 0.5 xmaximum 930
                hbox:
                    xalign 0.5
                    spacing 18
                    textbutton "CONFIRMAR" action yes_action
                    textbutton "CANCELAR" action no_action

    key "game_menu" action no_action


screen input(prompt):
    modal True
    frame:
        xalign 0.5
        yalign 0.5
        xfill True
        xmaximum 1100
        padding (28, 24)
        background "stem_ui_panel"
        vbox:
            spacing 15
            text prompt size 24 color "#55eefa"
            input id "input" size 25 color "#f0f7ff"


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
