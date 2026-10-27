<template>
  <div class="orb-navigator" :class="{ 'orb-active': active, 'orb-clicked': clicked, 'motion-reduced': motionReduced }">
    <button ref="coreRef" class="orb-core" type="button" :disabled="disabled" :aria-label="`Orb navigator. Home screen ${screenIndex + 1} of ${screenCount}. Click to move to the next screen, double-click to open all apps, or drag to navigate.`" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerCancel" @pointerleave="pointerLeave" @click="activate">
      <pre class="orb-ascii" aria-hidden="true">       .-========-.
    .-'  :::::::::: '-.
  .'   .::::::::::::.   '.
 /   .:::::--------:::::. \\
|  .:::::/  .----.  \\:::::.|
| .:::::|  / .--. \\  |:::::.|
| ::::::| |        | |::::::|
| .:::::|  \\ '--' /  |:::::.|
|  ':::::\\  '----'  /:::::' |
 \\   ':::::--------:::::'  /
  '.   '::::::::::::'   .'
    '-.  .::::::::.  .-'
       '-========-'</pre>
      <span class="orb-wave orb-wave-one" aria-hidden="true" />
      <span class="orb-wave orb-wave-two" aria-hidden="true" />
      <span class="orb-gaze" aria-hidden="true">(@@@)</span>
      <span class="orb-blink" aria-hidden="true" />
      <span class="orb-screen-count">{{ screenIndex + 1 }}<i>/{{ screenCount }}</i></span>
      <span class="orb-field" aria-hidden="true" />
      <span class="orb-wet" aria-hidden="true" />
      <span class="orb-sheen" aria-hidden="true" />
    </button>
    <span class="orb-caption" aria-hidden="true">TAP NEXT · DOUBLE-TAP ALL APPS · DRAG TO NAVIGATE</span>
  </div>
</template>

<script setup lang="ts">
// CyberManju OS — OrbNavigator (src/components/OrbNavigator.vue).
// Role: Animated, accessible home-screen navigator with direct manipulation.
// Exports: OrbNavigator component.
// Integrates: HomeWorkspaceStudio via navigation and all-apps events.
// Contracts: A delayed single activation advances; a double activation opens the app drawer; drag steps are immediate.
import { onUnmounted, ref } from 'vue'

const props = defineProps<{ screenIndex: number; screenCount: number; disabled?: boolean; motionReduced?: boolean }>()
const emit = defineEmits<{ navigate: [direction: -1 | 1]; openApps: [] }>()
const active = ref(false)
const clicked = ref(false)
const coreRef = ref<HTMLButtonElement | null>(null)
let gesture: { x: number; y: number; pointerId: number; navigated: boolean } | null = null
let clickTimer: ReturnType<typeof setTimeout> | null = null
let navigationTimer: ReturnType<typeof setTimeout> | null = null
let gazeTimer: ReturnType<typeof setTimeout> | null = null
let suppressClick = false
let lastClickAt = 0

function direction(dx: number, dy: number): -1 | 1 {
  return Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? (dx < 0 ? 1 : -1) : dy < 0 ? 1 : -1
}
function aim(event: PointerEvent) {
  const core = event.currentTarget as HTMLElement
  const rect = core.getBoundingClientRect()
  core.style.setProperty('--gaze-x', `${Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2))) * 5}px`)
  core.style.setProperty('--gaze-y', `${Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2))) * 4}px`)
  if (gazeTimer) clearTimeout(gazeTimer)
  gazeTimer = null
}
function settleGaze() {
  if (gazeTimer) clearTimeout(gazeTimer)
  gazeTimer = setTimeout(() => {
    const core = coreRef.value
    core?.style.setProperty('--gaze-x', '0px')
    core?.style.setProperty('--gaze-y', '0px')
    gazeTimer = null
  }, 1100)
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  if (navigationTimer) { clearTimeout(navigationTimer); navigationTimer = null }
  aim(event)
  gesture = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, navigated: false }
  active.value = true
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Window-level pointer events are not required for taps. */ }
}
function pointerMove(event: PointerEvent) {
  aim(event)
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const core = event.currentTarget as HTMLElement
  core.style.setProperty('--orb-x', `${Math.max(-18, Math.min(18, event.clientX - gesture.x) * .35).toFixed(1)}px`)
  core.style.setProperty('--orb-y', `${Math.max(-18, Math.min(18, event.clientY - gesture.y) * .35).toFixed(1)}px`)
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
  if (!gesture.navigated && Math.hypot(dx, dy) >= 14) {
    gesture.navigated = true
    suppressClick = true
    lastClickAt = 0
    if (!props.disabled) emit('navigate', direction(dx, dy))
  }
}
function pointerEnd(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  gesture = null
  active.value = false
  const core = event.currentTarget as HTMLElement
  core.style.removeProperty('--orb-x')
  core.style.removeProperty('--orb-y')
  settleGaze()
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
}
function pointerCancel(event: PointerEvent) { pointerEnd(event) }
function pointerLeave(event: PointerEvent) {
  if (!gesture) {
    const core = event.currentTarget as HTMLElement
    core.style.removeProperty('--orb-x')
    core.style.removeProperty('--orb-y')
    settleGaze()
  }
}
function activate(event: MouseEvent) {
  if (suppressClick) { suppressClick = false; return }
  if (props.disabled) return
  const now = Date.now()
  const doubleActivation = event.detail >= 2 || (lastClickAt > 0 && now - lastClickAt <= 500)
  lastClickAt = doubleActivation ? 0 : now
  clicked.value = false
  requestAnimationFrame(() => {
    clicked.value = true
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { clicked.value = false; clickTimer = null }, 1050)
  })
  if (doubleActivation) {
    if (navigationTimer) clearTimeout(navigationTimer)
    navigationTimer = null
    emit('openApps')
    return
  }
  navigationTimer = setTimeout(() => { navigationTimer = null; emit('navigate', 1) }, 450)
}

onUnmounted(() => {
  if (clickTimer) clearTimeout(clickTimer)
  if (navigationTimer) clearTimeout(navigationTimer)
  if (gazeTimer) clearTimeout(gazeTimer)
})
</script>

<style scoped>
.orb-navigator { --orb-x: 0px; --orb-y: 0px; display: grid; justify-items: center; gap: 4px; touch-action: none; user-select: none; }
.orb-core { --gaze-x: 0px; --gaze-y: 0px; position: relative; width: 112px; height: 112px; min-width: 112px !important; min-height: 112px !important; padding: 0 !important; display: grid; place-items: center; overflow: hidden; isolation: isolate; color: #fff; background: radial-gradient(ellipse at 48% 46%, #383838 0, #151515 42%, #030303 78%) !important; border: 2px solid #e4e4e4 !important; border-radius: 50% !important; outline: 2px solid #111; box-shadow: 0 0 0 3px #777, 0 0 24px #fff5, inset 0 0 18px #fff7, inset 0 -9px 18px #fff3; image-rendering: pixelated; touch-action: none; animation: orb-rest 5.4s ease-in-out infinite; transition: box-shadow .18s ease, filter .18s ease; }
.orb-core:disabled { opacity: 1; cursor: default; }
.orb-core:focus-visible { outline: 3px solid #fff; outline-offset: 5px; }
.orb-core::before,.orb-core::after { content: ''; position: absolute; inset: 5px; border: 1px dashed #fff8; border-radius: 50%; pointer-events: none; animation: orb-ring-spin 14s linear infinite; }
.orb-core::after { inset: 11px; border-style: solid; border-color: #fff4; animation-duration: 9s; animation-direction: reverse; box-shadow: inset 0 0 14px #fff2, 0 0 12px #fff2; }
.orb-ascii,.orb-sheen { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.orb-ascii { z-index: 0; display: grid; place-content: center; margin: 0; overflow: hidden; color: #f4f4f4; font: 700 5.9px/7.05px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .015em; white-space: pre; text-shadow: 0 0 5px #fff, 0 0 12px #fff8; animation: orb-ascii-breathe 4.8s ease-in-out infinite; }
.orb-field,.orb-wet,.orb-sheen { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.orb-field { z-index: 1; opacity: .3; background: repeating-linear-gradient(0deg, transparent 0 2px, #fff3 2px 3px, transparent 3px 6px), repeating-linear-gradient(90deg, transparent 0 19px, #fff1 19px 20px); mix-blend-mode: screen; }
.orb-wet { z-index: 2; background: radial-gradient(ellipse at 31% 18%, #fff9 0 1.5%, #fff5 4%, transparent 24%), radial-gradient(ellipse at 72% 78%, #fff4, transparent 28%), linear-gradient(120deg, transparent 36%, #fff2 48%, #fff9 50%, #fff2 53%, transparent 64%); opacity: .72; mix-blend-mode: screen; animation: orb-liquid 8s ease-in-out infinite alternate; }
.orb-wave { position: absolute; z-index: 3; inset: 25%; border: 1px solid #fff; border-radius: 50%; opacity: 0; pointer-events: none; box-shadow: 0 0 8px #fff, inset 0 0 7px #fff8; transform: scale(.18); }
.orb-wave-two { border-color: #aaa; box-shadow: 0 0 9px #ddd, inset 0 0 7px #fff8; }
.orb-gaze { position: absolute; z-index: 2; top: 50%; left: 50%; color: #fff; font: 900 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -.08em; text-shadow: 0 0 7px #fff, 0 0 13px #fff; transform: translate(calc(-50% + var(--gaze-x)), calc(-50% + var(--gaze-y))); transition: transform .12s ease-out; pointer-events: none; }
.orb-blink { position: absolute; z-index: 6; inset: 7px; border-radius: 50%; background: linear-gradient(180deg, #050505 0 48%, #f4f4f4 49% 51%, #050505 52%); opacity: 0; clip-path: inset(0 0 100%); pointer-events: none; animation: orb-blink 6.4s steps(1,end) infinite; }
.orb-sheen { z-index: 3; background: radial-gradient(ellipse at 50% 30%, #fff6, #fff0 28%), repeating-linear-gradient(0deg, #fff0 0 3px, #fff2 3px 4px); mix-blend-mode: screen; opacity: .76; transform: translate(var(--orb-x), var(--orb-y)); transition: transform 90ms linear, opacity 150ms ease; }
.orb-sheen::after { content: ''; position: absolute; inset: -35% -80%; background: linear-gradient(105deg, transparent 44%, #fff0 47%, #fffa 50%, #fff2 52%, transparent 57%); opacity: .45; transform: translateX(-18%); animation: orb-wet-glint 7s cubic-bezier(.4,0,.2,1) infinite; }
.orb-screen-count { position: absolute; z-index: 7; top: 16px; right: 15px; display: flex; align-items: baseline; padding: 2px 4px; color: #fff; background: #050505d9; border: 1px solid #fff9; border-radius: 8px; box-shadow: 1px 2px 5px #0009; font: 800 12px/1 ui-monospace, monospace; text-shadow: 1px 1px #000; }
.orb-screen-count i { margin-left: 2px; font-size: 9px; font-style: normal; }
.orb-active .orb-core { box-shadow: 0 0 0 3px #fff, 0 0 32px #ffffffbd, inset 0 0 25px #fff9; filter: brightness(1.32) contrast(1.16); }
.orb-active .orb-ascii { animation-duration: .7s; filter: brightness(1.7) contrast(1.2); }
.orb-active .orb-sheen { opacity: 1; }.orb-active .orb-sheen::after { animation-duration: 1.4s; opacity: .85; }
.orb-active .orb-field { opacity: .62; }
.orb-clicked .orb-core { animation: orb-click-flash .52s ease-out both; }
.orb-clicked .orb-core::before { animation-duration: .65s; border-color: #fff; }.orb-clicked .orb-core::after { animation-duration: .42s; border-color: #ddd; }
.orb-clicked .orb-blink { animation: orb-click-blink .28s steps(1,end) both; }
.orb-clicked .orb-ascii { animation-duration: .22s; filter: brightness(2.25) contrast(1.45); text-shadow: 0 0 8px #fff, 0 0 18px #fff; }
.orb-clicked .orb-field { opacity: .85; }.orb-clicked .orb-wet { opacity: 1; }
.orb-clicked .orb-wave-one { animation: orb-ripple .78s cubic-bezier(.12,.58,.32,1) both; }.orb-clicked .orb-wave-two { animation: orb-ripple .78s .16s cubic-bezier(.12,.58,.32,1) both; }
.orb-caption { color: var(--ui-text-3); font: 600 8px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-align: center; }
@keyframes orb-rest { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2px) scale(1.025); } }
@keyframes orb-ascii-breathe { 0%,100% { opacity: .78; } 50% { opacity: 1; } }
@keyframes orb-ring-spin { to { transform: rotate(360deg); } }
@keyframes orb-wet-glint { 0%,18% { transform: translateX(-18%); opacity: .2; } 55% { opacity: .72; } 82%,100% { transform: translateX(18%); opacity: .25; } }
@keyframes orb-liquid { from { transform: scale(1) rotate(-3deg); } to { transform: scale(1.1) rotate(3deg); } }
@keyframes orb-blink { 0%,94%,100% { opacity: 0; clip-path: inset(0 0 100%); } 95%,97% { opacity: .96; clip-path: inset(0); } 98% { opacity: .75; clip-path: inset(100% 0 0); } }
@keyframes orb-click-blink { 0%,20% { opacity: 0; clip-path: inset(0 0 100%); } 45%,75% { opacity: .96; clip-path: inset(0); } 100% { opacity: 0; clip-path: inset(0 0 100%); } }
@keyframes orb-ripple { 0% { opacity: .95; transform: scale(.18); } 75% { opacity: .45; } 100% { opacity: 0; transform: scale(1.62); } }
@keyframes orb-click-flash { 0% { transform: scale(.88); filter: brightness(2.2) contrast(1.4); } 45% { transform: scale(1.12); filter: brightness(1.6); } 100% { transform: scale(1); filter: brightness(1); } }
.motion-reduced .orb-core,.motion-reduced .orb-core::before,.motion-reduced .orb-core::after,.motion-reduced .orb-ascii,.motion-reduced .orb-field,.motion-reduced .orb-wet,.motion-reduced .orb-blink,.motion-reduced .orb-sheen::after { animation: none !important; }
@media(prefers-reduced-motion:reduce) { .orb-core,.orb-core::before,.orb-core::after,.orb-ascii,.orb-field,.orb-wet,.orb-blink,.orb-sheen::after { animation: none !important; transition: none !important; } }
</style>
