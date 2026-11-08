# The Stem Array — ATL Particle System
# Role: lightweight, theme-aware particle effects using pure ATL (no JS/WASM overhead)
# Exports: particle transforms, emitters, and screen overlays
# Integrates: screens.rpy (stem_theme_mode), bg_camera_transforms.rpy (ken-burns sync)
# Contracts: zero WASM main-thread cost; respects prefers-reduced-motion; theme-color driven

init python:
    # Particle system configuration - all const for screen optimization
    define STEM_PARTICLE_COUNT = 32
    define STEM_PARTICLE_LIFETIME = 8.0
    define STEM_PARTICLE_SPAWN_INTERVAL = 0.25
    define STEM_PARTICLE_SIZE_RANGE = (4, 12)
    define STEM_PARTICLE_OPACITY_RANGE = (0.15, 0.45)
    define STEM_PARTICLE_SPEED_RANGE = (15, 45)  # pixels per second at 1920px
    define STEM_PARTICLE_DRIFT_RANGE = (-0.02, 0.02)  # xalign drift per second
    define STEM_PARTICLE_ROTATION_SPEED = (-180, 180)  # degrees per second

# Theme-aware particle color palettes
# Flat (pixel) theme: cyan accent with dark base
# Glass theme: cyan accent with lighter base
image stem_particle_flat = At(
    Solid("#0a0f1a"),
    Transform(zoom=0.5, rotate=0)
)

image stem_particle_glass = At(
    Solid("#1a2f3a"),
    Transform(zoom=0.5, rotate=0)
)

# Dynamic particle color based on theme
init python:
    @renpy.pure
    def stem_particle_color():
        """Return the current theme's particle base color."""
        return "#0a0f1a" if store.stem_theme_mode == "flat" else "#1a2f3a"

    @renpy.pure
    def stem_particle_accent():
        """Return the current theme's particle accent color."""
        return store.stem_theme_accent or "#55edff"

# Base particle transform - single particle behavior
transform stem_particle_base:
    # Start invisible
    alpha 0.0
    # Fade in quickly
    linear 0.3 alpha 1.0
    # Drift and rotate over lifetime
    parallel:
        linear 8.0 xalign 0.5 + STEM_PARTICLE_DRIFT_RANGE[1]
        linear 8.0 yalign 0.5 + STEM_PARTICLE_DRIFT_RANGE[1]
        linear 8.0 rotate 360 * (STEM_PARTICLE_ROTATION_SPEED[1] / 180)
    # Fade out
    linear 0.5 alpha 0.0

# Particle emitter - spawns multiple particles with staggered delays
transform stem_particle_emitter:
    pause 8.5
    repeat

# Screen-space particle overlay (for global ambient effects)
screen stem_particle_overlay():
    zorder -50
    # Respect reduced motion
    $ _reduced = renpy.variant("reduced-motion")
    if not _reduced:
        # Spawn particles across the screen
        python:
            import random
            for i in range(STEM_PARTICLE_COUNT):
                delay = i * STEM_PARTICLE_SPAWN_INTERVAL
                x = random.uniform(0.05, 0.95)
                y = random.uniform(0.05, 0.95)
                size = random.uniform(*STEM_PARTICLE_SIZE_RANGE)
                opacity = random.uniform(*STEM_PARTICLE_OPACITY_RANGE)
                speed = random.uniform(*STEM_PARTICLE_SPEED_RANGE)
                drift_x = random.uniform(*STEM_PARTICLE_DRIFT_RANGE)
                drift_y = random.uniform(*STEM_PARTICLE_DRIFT_RANGE)
                rotation = random.uniform(*STEM_PARTICLE_ROTATION_SPEED)
                renpy.show_layer_at(
                    Transform(
                        xalign=x,
                        yalign=y,
                        zoom=size / 1920,
                        alpha=opacity,
                        rotate=0,
                        subtransform=Transform(
                            linear 8.0 xalign x + drift_x,
                            linear 8.0 yalign y + drift_y,
                            linear 8.0 rotate rotation,
                            linear 0.5 alpha 0.0
                        )
                    ),
                    layer="particles",
                    delay=delay
                )

# Chapter-specific particle effects (subtle, thematic)
transform stem_chapter_ambient_particles:
    # Very subtle ambient particles that don't distract from reading
    alpha 0.0
    linear 0.3 alpha 0.08
    zoom 0.3
    alpha 0.08
    linear 16.0 xalign 0.5 + 0.01
    linear 16.0 yalign 0.5 + 0.01
    repeat

# Particle burst for special moments (quiz correct, chapter complete)
transform stem_particle_burst:
    xalign 0.5
    yalign 0.5
    zoom 0.1
    alpha 0.6
    parallel:
        linear 0.8 zoom 2.0
        linear 0.8 alpha 0.0
        linear 0.8 rotate 720
    pause 0.1
    repeat

# Register particle layer for burst effects
init python:
    config.layers.append("particles")
    config.layers.remove("particles")
    config.layers.insert(config.layers.index("master") + 1, "particles")

# Convenience transforms for specific effects
transform stem_dust_motes:
    """Subtle dust motes drifting in light shafts."""
    xalign 0.5
    yalign 0.5
    zoom 0.02
    alpha 0.1
    parallel:
        linear 12.0 xalign 0.52
        linear 12.0 yalign 0.48
        linear 12.0 rotate 180
    linear 1.0 alpha 0.0
    repeat

transform stem_light_sparkles:
    """Tiny sparkles for magical/mystical moments."""
    xalign 0.5
    yalign 0.5
    zoom 0.015
    alpha 0.4
    parallel:
        linear 0.6 xalign 0.5 + 0.1
        linear 0.6 yalign 0.5 - 0.1
        linear 0.6 rotate 360
    linear 0.3 alpha 0.0
    repeat

transform stem_falling_petals:
    """Slow falling petals/leaves for serene scenes."""
    xalign 0.5
    yalign -0.1
    zoom 0.05
    alpha 0.3
    parallel:
        linear 15.0 yalign 1.1
        linear 15.0 xalign 0.5 + 0.05
        linear 15.0 rotate 720
    linear 1.0 alpha 0.0
    repeat

# Screen to show chapter ambient particles (add to say screen or game_menu)
screen stem_chapter_particles():
    zorder -40
    $ _reduced = renpy.variant("reduced-motion")
    if not _reduced and config.developer is not True:
        # Only show in production, not in dev
        add Transform("stem_dust_motes") xalign 0.3 yalign 0.2
        add Transform("stem_dust_motes") xalign 0.7 yalign 0.6
        add Transform("stem_dust_motes") xalign 0.5 yalign 0.8

# Burst effect screen (triggered by actions)
screen stem_burst_particles():
    zorder 200
    $ _burst = store._stem_burst_trigger or 0
    if _burst > 0:
        python:
            store._stem_burst_trigger = 0
        add Transform("stem_particle_burst") xalign 0.5 yalign 0.5
        add Transform("stem_particle_burst") xalign 0.45 yalign 0.55
        add Transform("stem_particle_burst") xalign 0.55 yalign 0.45
        add Transform("stem_particle_burst") xalign 0.4 yalign 0.6
        add Transform("stem_particle_burst") xalign 0.6 yalign 0.4

# Action to trigger burst
init python:
    def stem_trigger_burst():
        """Call this from a button action to trigger particle burst."""
        store._stem_burst_trigger = 1
        renpy.restart_interaction()

default _stem_burst_trigger = 0