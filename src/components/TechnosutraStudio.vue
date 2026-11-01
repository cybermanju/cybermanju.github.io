<!-- CyberManju OS — The Stem Array immersive Ren'Py player. -->
<template>
  <main
    ref="stage"
    class="stem-immersive"
    :class="{ 'is-immersive': isImmersive, 'stem-immersive--glass': isGlass, 'stem-immersive--flat': !isGlass }"
    :style="rootAccentStyle"
    aria-label="The Stem Array visual novel"
  >
    <iframe
      class="stem-immersive__game ts-game-frame"
      ref="gameFrame"
      :src="gameUrl"
      title="The Stem Array — Ren’Py visual novel"
      allow="fullscreen; autoplay; gamepad"
      allowfullscreen
      loading="eager"
      referrerpolicy="strict-origin-when-cross-origin"
      @load="publishOsTheme"
    />

    <div class="stem-ascii-garden" aria-hidden="true">
      <span class="stem-ascii-garden__edge stem-ascii-garden__edge--top">{{ asciiGarden.top }}</span>
      <span class="stem-ascii-garden__edge stem-ascii-garden__edge--bottom">{{ asciiGarden.bottom }}</span>
      <span class="stem-ascii-garden__side stem-ascii-garden__side--left">{{ asciiGarden.left }}</span>
      <span class="stem-ascii-garden__side stem-ascii-garden__side--right">{{ asciiGarden.right }}</span>
    </div>

    <!-- Invisible first-gesture surface: fullscreen requires user activation in many browsers. -->
    <button
      v-if="needsGesture"
      class="stem-immersive__activation-surface"
      type="button"
      aria-label="Ativar tela cheia para The Stem Array"
      @click.stop.prevent="enterImmersive(true)"
    />

    <div
      class="stem-window-controls-trigger"
      :class="{ 'is-visible': controlsVisible }"
      role="group"
      aria-label="Controles da janela"
      @pointerenter="onControlsPointerEnter"
      @pointermove="onControlsPointerMove"
      @pointerleave="onControlsPointerLeave"
      @pointerdown="onControlsPointerDown"
      @focusin="revealWindowControls(false)"
    >
      <div class="stem-window-controls" :class="{ 'is-visible': controlsVisible }">
        <button
          class="stem-traffic-light stem-traffic-light--close"
          type="button"
          aria-label="Fechar janela"
          title="Fechar"
          @click.stop="closeWindow"
        ><span aria-hidden="true">×</span></button>
        <button
          class="stem-traffic-light stem-traffic-light--minimize"
          type="button"
          aria-label="Minimizar janela"
          title="Minimizar"
          @click.stop="minimizeWindow"
        ><span aria-hidden="true">−</span></button>
        <button
          class="stem-traffic-light stem-traffic-light--fullscreen"
          type="button"
          aria-label="Alternar tela cheia"
          title="Tela cheia"
          @click.stop="toggleFullscreen"
        ><span aria-hidden="true">↗</span></button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { TECHNOSUTRA_VN_BUILD } from '@/data/technosutra-vn'

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'minimize'): void
}>()

const stage = ref<HTMLElement | null>(null)
const gameFrame = ref<HTMLIFrameElement | null>(null)
const isImmersive = ref(false)
const needsGesture = ref(true)
const controlsVisible = ref(false)
const themeState = useTheme()
const isGlass = computed(() => themeState.glass.value !== 0)
const stemAccent = computed(() => themeState.cssVars.value['--ui-accent'] || '#55edff')
const rootAccentStyle = computed(() => ({ '--stem-accent': stemAccent.value } as Record<string, string>))
const gameUrl = new URL(
  `${import.meta.env.BASE_URL}${TECHNOSUTRA_VN_BUILD.assetBasePath}index.html`,
  window.location.origin,
).href
const gameOrigin = new URL(gameUrl).origin

const gardenMotifs = [
  '~o~--/\\--~(@)~--/\\--~o~',
  '~--{*}--\\_/\\_/--(@)--~',
  '.~\\/\\~o~(@)~o~\\/\\~.',
  '~\\_/*\\_/@/\\_/*\\_/~',
  '--<@>--o--/\\--{*}--o--<@>--',
]

function makeAsciiGarden(seed: string, width: number) {
  let state = 2166136261
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0
  let line = ''
  while (line.length < width) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    line += gardenMotifs[state % gardenMotifs.length]
  }
  return line.slice(0, width)
}

const gardenSeed = `${Date.now()}-${Math.random()}`
const asciiGarden = {
  top: makeAsciiGarden(`${gardenSeed}:top`, 188),
  bottom: makeAsciiGarden(`${gardenSeed}:bottom`, 188),
  left: '~\n|\n@\n|\n*\n|\n~',
  right: '~\n|\n*\n|\n@\n|\n~',
}

function publishOsTheme() {
  const child = gameFrame.value?.contentWindow
  if (!child) return
  child.postMessage({
    type: 'stem-array:theme',
    version: 1,
    theme: themeState.themeId.value,
    mode: themeState.mode.value,
    glass: themeState.glass.value === 0 ? 'solid' : 'translucent',
    accent: stemAccent.value,
  }, gameOrigin)
}

function onGameThemeMessage(event: MessageEvent) {
  if (event.origin !== gameOrigin || event.source !== gameFrame.value?.contentWindow) return
  const data = event.data as { type?: unknown; version?: unknown } | null
  if (data?.type === 'stem-array:ready' && data.version === 1) publishOsTheme()
}

watch(
  () => [themeState.themeId.value, themeState.mode.value, themeState.glass.value, stemAccent.value] as const,
  publishOsTheme,
  { flush: 'post' },
)

let controlsTimer: number | undefined
let pointerInsideControls = false

type OrientationControls = {
  lock?: (orientation: string) => Promise<void> | void
  unlock?: () => void
}

function orientationControls(): OrientationControls | undefined {
  return (window.screen as unknown as { orientation?: OrientationControls }).orientation
}

function requestLandscape() {
  try {
    const result = orientationControls()?.lock?.('landscape')
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => {})
    }
  } catch {
    // Orientation lock is best-effort; never add UI over the game when unsupported.
  }
}

function clearControlsTimer() {
  if (controlsTimer !== undefined) {
    window.clearTimeout(controlsTimer)
    controlsTimer = undefined
  }
}

function revealWindowControls(autoHide: boolean) {
  clearControlsTimer()
  controlsVisible.value = true
  if (autoHide) {
    controlsTimer = window.setTimeout(() => {
      if (!pointerInsideControls) controlsVisible.value = false
    }, 2600)
  }
}

function onControlsPointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    pointerInsideControls = true
    revealWindowControls(false)
  }
}

function onControlsPointerMove(event: PointerEvent) {
  if (event.pointerType === 'mouse' && !controlsVisible.value) {
    pointerInsideControls = true
    revealWindowControls(false)
  }
}

function onControlsPointerLeave(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    pointerInsideControls = false
    clearControlsTimer()
    controlsTimer = window.setTimeout(() => { controlsVisible.value = false }, 700)
  }
}

function onControlsPointerDown(event: PointerEvent) {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    pointerInsideControls = false
    revealWindowControls(true)
  } else {
    pointerInsideControls = true
    revealWindowControls(false)
  }
}

function syncFullscreenState() {
  const nativeFullscreen = !!stage.value && document.fullscreenElement === stage.value
  if (nativeFullscreen) {
    isImmersive.value = true
    needsGesture.value = false
  } else if (document.fullscreenElement === null) {
    const exitedByUser = isImmersive.value
    isImmersive.value = false
    if (exitedByUser) orientationControls()?.unlock?.()
  }
}

async function enterImmersive(fromGesture = false) {
  const element = stage.value
  if (!element) return

  let enteredNativeFullscreen = document.fullscreenElement === element
  if (!enteredNativeFullscreen && typeof element.requestFullscreen === 'function') {
    try {
      await element.requestFullscreen({ navigationUI: 'hide' })
      enteredNativeFullscreen = document.fullscreenElement === element
    } catch {
      // Some mobile browsers and embedded webviews reject element fullscreen.
    }
  }

  if (enteredNativeFullscreen) {
    isImmersive.value = true
    needsGesture.value = false
    requestLandscape()
  } else if (fromGesture) {
    // The focused OS window is already CSS-maximized; keep game-only fallback.
    isImmersive.value = true
    needsGesture.value = false
    requestLandscape()
  }
}

async function exitImmersive() {
  const element = stage.value
  if (element && document.fullscreenElement === element) {
    try {
      await document.exitFullscreen()
    } catch {
      // The browser may already have exited fullscreen.
    }
  }
  isImmersive.value = false
  needsGesture.value = false
  orientationControls()?.unlock?.()
}

async function toggleFullscreen() {
  if (stage.value && document.fullscreenElement === stage.value) {
    await exitImmersive()
  } else {
    await enterImmersive(true)
  }
}

async function closeWindow() {
  clearControlsTimer()
  await exitImmersive()
  emit('close')
}

async function minimizeWindow() {
  clearControlsTimer()
  await exitImmersive()
  emit('minimize')
}

onMounted(() => {
  window.addEventListener('message', onGameThemeMessage)
  document.addEventListener('fullscreenchange', syncFullscreenState)
  syncFullscreenState()
  publishOsTheme()
  // The app-opening tap may still carry transient activation. If not, the
  // invisible full-surface gesture retries on the user's first game tap.
  void enterImmersive(false)
})

onBeforeUnmount(() => {
  clearControlsTimer()
  window.removeEventListener('message', onGameThemeMessage)
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  if (stage.value && document.fullscreenElement === stage.value) {
    void document.exitFullscreen().catch(() => {})
  }
  orientationControls()?.unlock?.()
})
</script>

<style scoped>
.stem-immersive {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #03050c;
  --stem-accent: #55edff;
  touch-action: manipulation;
}

.stem-immersive::before,
.stem-immersive::after {
  content: '';
  position: absolute;
  inset: 8px;
  z-index: 3;
  pointer-events: none;
}

.stem-immersive::before {
  z-index: 1;
  opacity: .025;
  background-image:
    repeating-linear-gradient(0deg, rgba(255,255,255,.14) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(90deg, rgba(96,220,230,.10) 0 1px, transparent 1px 7px);
  mix-blend-mode: screen;
}

.stem-immersive::after {
  border: 1px solid color-mix(in srgb, var(--stem-accent) 58%, transparent);
  box-shadow: inset 0 0 16px color-mix(in srgb, var(--stem-accent) 9%, transparent);
}

.stem-immersive--glass::before { opacity: .045; }
.stem-immersive--glass::after {
  border-color: color-mix(in srgb, var(--stem-accent) 42%, transparent);
  box-shadow: inset 0 0 24px color-mix(in srgb, var(--stem-accent) 13%, transparent);
}

.stem-ascii-garden {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  color: var(--stem-accent);
  font: 10px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .06em;
  opacity: .3;
  pointer-events: none;
  text-shadow: 0 0 7px color-mix(in srgb, var(--stem-accent) 48%, transparent);
}

.stem-immersive--glass .stem-ascii-garden { opacity: .48; }

.stem-ascii-garden__edge {
  position: absolute;
  left: max(18px, env(safe-area-inset-left));
  right: max(18px, env(safe-area-inset-right));
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-align: center;
}

.stem-ascii-garden__edge--top { top: 3px; }
.stem-ascii-garden__edge--bottom { bottom: 3px; }

.stem-ascii-garden__side {
  position: absolute;
  top: 42px;
  bottom: 42px;
  display: flex;
  align-items: center;
  white-space: pre;
  text-align: center;
}

.stem-ascii-garden__side--left { left: max(3px, env(safe-area-inset-left)); }
.stem-ascii-garden__side--right { right: max(3px, env(safe-area-inset-right)); }

.stem-immersive:fullscreen,
.stem-immersive.is-immersive {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  border: 0;
  border-radius: 0;
  background: #03050c;
}

.stem-immersive__game {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #03050c;
}

.stem-immersive__activation-surface {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  appearance: none;
  color: transparent;
  background: transparent;
  box-shadow: none;
  font-size: 0;
  cursor: default;
  touch-action: manipulation;
}

.stem-immersive__activation-surface:focus-visible {
  outline: 2px solid #49efff;
  outline-offset: -4px;
}

.stem-window-controls-trigger {
  position: absolute;
  top: max(4px, env(safe-area-inset-top));
  left: max(4px, env(safe-area-inset-left));
  z-index: 6;
  width: 168px;
  height: 52px;
  touch-action: manipulation;
}

.stem-window-controls {
  position: absolute;
  top: 5px;
  left: 7px;
  display: flex;
  gap: 7px;
  opacity: 0;
  transform: translateY(-5px);
  visibility: hidden;
  pointer-events: none;
  transition: opacity 220ms ease, transform 220ms ease, visibility 220ms ease;
}

.stem-window-controls.is-visible,
.stem-window-controls-trigger:focus-within .stem-window-controls {
  opacity: 1;
  transform: translateY(0);
  visibility: visible;
  pointer-events: auto;
}

.stem-traffic-light {
  position: relative;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: rgba(22, 30, 40, .9);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .18), 0 1px 5px rgba(0, 0, 0, .28);
  cursor: pointer;
  transition: transform 160ms ease, filter 160ms ease;
  -webkit-tap-highlight-color: transparent;
}

.stem-traffic-light > span {
  opacity: 0;
  font: 700 14px/1 system-ui, sans-serif;
  transition: opacity 120ms ease;
}

.stem-traffic-light:hover { transform: scale(1.08); filter: brightness(1.08); }
.stem-traffic-light:hover > span,
.stem-traffic-light:focus-visible > span { opacity: 1; }
.stem-traffic-light:focus-visible { outline: 2px solid #effaff; outline-offset: 3px; }
.stem-traffic-light--close { background: #ff5f57; }
.stem-traffic-light--minimize { background: #febc2e; }
.stem-traffic-light--fullscreen { background: #28c840; }

/* Focused Stem Array window is a game surface, not a desktop window. These
   scoped overrides hide OS chrome without editing the shared shell files. */
:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive)) {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147482000 !important;
  overflow: hidden !important;
}

:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) > :not(.desktop-area)) {
  display: none !important;
}

:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-area) {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
}

:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-area > :not(.desktop-workspace):not(.desktop-strip)) {
  display: none !important;
}

:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-workspace),
:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-strip) {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
}

:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-workspace > :not(.app-window)),
:global(.desktop-shell:has(.app-window.focused:not(.minimized):not(.app-window--overview) .stem-immersive) .desktop-strip > :not(.app-window)) {
  display: none !important;
}

:global(.app-window.focused:has(.stem-immersive):not(.minimized):not(.app-window--overview)) {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483000 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  min-width: 0 !important;
  min-height: 0 !important;
  transform: none !important;
  transition: none !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

:global(.app-window.focused:has(.stem-immersive):not(.minimized):not(.app-window--overview) .window-titlebar),
:global(.app-window.focused:has(.stem-immersive):not(.minimized):not(.app-window--overview) .resize-handle) {
  display: none !important;
}

:global(.app-window.focused:has(.stem-immersive):not(.minimized):not(.app-window--overview) .window-content) {
  flex: 1 1 100% !important;
  min-height: 0 !important;
  overflow: hidden !important;
  background: #03050c !important;
  scrollbar-gutter: auto !important;
  touch-action: manipulation !important;
}

@media (prefers-reduced-motion: reduce) {
  .stem-window-controls,
  .stem-traffic-light,
  .stem-traffic-light > span { transition-duration: 1ms; }
}
</style>
