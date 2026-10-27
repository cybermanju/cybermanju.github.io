<!-- CyberManju OS — OrbNavigator (src/components/OrbNavigator.vue). -->
<!-- Role: Animated, accessible home-screen navigator with direct manipulation. -->
<!-- Exports: OrbNavigator component. -->
<!-- Integrates: HomeWorkspaceStudio via navigation and all-apps events. -->
<!-- Contracts: A delayed single activation advances; a double activation opens the app drawer; drag steps are immediate. -->
<template>
  <div class="orb-navigator" :class="{ 'orb-navigator--static': staticMotion }">
    <button
      ref="coreRef"
      class="orb-core"
      type="button"
      :disabled="disabled"
      :aria-label="`Orb navigator. Home screen ${screenIndex + 1} of ${screenCount}. Click to move to the next screen, double-click to open all apps, or drag to navigate.`"
      :data-state="dynamicState"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerEnd"
      @pointercancel="pointerCancel"
      @pointerleave="pointerLeave"
      @click="activate"
    >
      <!-- Live ASCII sphere: one canvas replaces the old pre/wet/sheen/blink layer stack. -->
      <canvas ref="canvasRef" class="orb-canvas" aria-hidden="true" />
      <span class="orb-screen-count" aria-hidden="true">{{ screenIndex + 1 }}<i>/{{ screenCount }}</i></span>
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
// Rendering: canvas 2D ASCII sphere (dense char ramp, spherical lighting + spin,
// eased state weights for idle/pressed/drag, ripple + scanline one-shots, DPR glow).
// Interactions are unchanged: gaze follows the pointer, drag >14px emits navigate(),
// single click advances after 450ms, double click opens the app drawer.
import { computed, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ screenIndex: number; screenCount: number; disabled?: boolean; motionReduced?: boolean }>()
const emit = defineEmits<{ navigate: [direction: -1 | 1]; openApps: [] }>()

const active = ref(false)
const clicked = ref(false)
const dynamicState = computed(() => (clicked.value ? 'clicked' : active.value ? 'pressed' : 'idle'))
const coreRef = ref<HTMLButtonElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// ---------- gesture state (contract unchanged) ----------
let gesture: { x: number; y: number; lx: number; ly: number; pointerId: number; navigated: boolean } | null = null
let clickTimer: ReturnType<typeof setTimeout> | null = null
let navigationTimer: ReturnType<typeof setTimeout> | null = null
let gazeTimer: ReturnType<typeof setTimeout> | null = null
let suppressClick = false
let lastClickAt = 0

// Visual one-shots the render loop reads (updated by handlers below).
let dragVel = 0 // pointer speed → organic "voice" energy
let pressLevel = 0 // 1 while held
let clickPulse = 0 // click flash + expanding ring
let navPing = 0 // screen changed → outward ripple
let scanBoost = 0 // drag navigation → decode scanline
let gazeX = 0, gazeY = 0 // -1..1 pointer aim, eases back to center

function direction(dx: number, dy: number): -1 | 1 {
  return Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? (dx < 0 ? 1 : -1) : dy < 0 ? 1 : -1
}
function aim(event: PointerEvent) {
  const core = event.currentTarget as HTMLElement
  const rect = core.getBoundingClientRect()
  const nx = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)))
  const ny = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)))
  gazeX += (nx - gazeX) * 0.5
  gazeY += (ny - gazeY) * 0.5
}
function settleGaze() {
  if (gazeTimer) clearTimeout(gazeTimer)
  gazeTimer = setTimeout(() => {
    gazeTimer = null // loop eases axes back to 0 on its own
  }, 1100)
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  if (navigationTimer) { clearTimeout(navigationTimer); navigationTimer = null }
  pressLevel = 1
  gazeX = 0; gazeY = 0
  aim(event)
  gesture = { x: event.clientX, y: event.clientY, lx: event.clientX, ly: event.clientY, pointerId: event.pointerId, navigated: false }
  active.value = true
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Window-level pointer events are not required for taps. */ }
}
function pointerMove(event: PointerEvent) {
  aim(event)
  if (!gesture || event.pointerId !== gesture.pointerId) return
  // pointer speed feeds the orb's organic energy level (fast attack handled in the loop)
  dragVel = Math.min(1, dragVel * 0.7 + (Math.hypot(event.clientX - gesture.lx, event.clientY - gesture.ly) / 9) * 0.35)
  gesture.lx = event.clientX
  gesture.ly = event.clientY
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
  if (!gesture.navigated && Math.hypot(dx, dy) >= 14) {
    gesture.navigated = true
    suppressClick = true
    lastClickAt = 0
    scanBoost = 1
    if (!props.disabled) emit('navigate', direction(dx, dy))
    if (staticMotion) drawStatic()
  }
}
function pointerEnd(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  gesture = null
  pressLevel = 0
  dragVel = 0
  active.value = false
  settleGaze()
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
}
function pointerCancel(event: PointerEvent) { pointerEnd(event); pressLevel = 0; dragVel = 0 }
function pointerLeave(event: PointerEvent) {
  if (!gesture) { pressLevel = 0; dragVel = 0; active.value = false; settleGaze() }
}
function flashClicked(durationMs = 520) {
  clicked.value = false
  requestAnimationFrame(() => {
    clicked.value = true
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { clicked.value = false; clickTimer = null }, durationMs)
  })
}
function activate(event: MouseEvent) {
  if (suppressClick) { suppressClick = false; return }
  if (props.disabled) return
  aim(event as unknown as PointerEvent)
  clickPulse = 1
  flashClicked()
  if (staticMotion) drawStatic()
  const now = Date.now()
  const doubleActivation = event.detail >= 2 || (lastClickAt > 0 && now - lastClickAt <= 500)
  lastClickAt = doubleActivation ? 0 : now
  if (doubleActivation) {
    if (navigationTimer) clearTimeout(navigationTimer)
    navigationTimer = null
    clickPulse = 1.4 // stronger flash for the drawer
    emit('openApps')
    return
  }
  navigationTimer = setTimeout(() => { navigationTimer = null; emit('navigate', 1); navPing = 1 }, 450)
}

// ---------- ASCII sphere renderer ----------
// Dense ramp (first char = empty): detail survives at 112px unlike the old fixed <pre>.
const RAMP = " .'`^,:;Il!i~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
// eased channel weights: breath gain | energy | ripple-in | ripple-out | scan | spin
const TARGETS = {
  idle:    [1.0, 0.0, 0.0, 0.0, 0.0, 0.1],
  pressed: [0.5, 1.0, 1.0, 0.0, 0.0, 0.35],
  drag:    [0.45, 1.0, 0.0, 1.0, 1.0, 0.5],
} as const
type StateKey = keyof typeof TARGETS

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ease = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k
function hash(i: number, j: number, k: number) {
  let x = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return (x ^ (x >>> 16)) >>> 0
}

let raf = 0
let running = false
let visible = true
let staticMotion = false
let last = 0
let reducedQuery: MediaQueryList | null = null
let ro: ResizeObserver | null = null
let io: IntersectionObserver | null = null
let dpr: number = 1, w = 112, h = 112, cw = 6, ch = 7

// Integrated phases: speed/weight changes never cause visual jumps.
const W: number[] = TARGETS.idle.slice()
let lvl = 0, spin = 0.6, breath = 0, wob = 0, phOut = 0, phIn = 0, scan = 0, light = 0.4, clock = 0

function setupCanvas(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = cv.getBoundingClientRect()
  w = Math.max(1, Math.round(rect.width))
  h = Math.max(1, Math.round(rect.height))
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  ctx.font = `${6.4 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`
  cw = ctx.measureText('M').width / dpr || 6.4
  ch = 6.4 * 1.16
  return ctx
}

function render(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, dt: number) {
  const ts = (staticMotion ? 0 : 1) * 1
  const d = Math.min(0.05, dt || 0.016) * ts
  clock += d

  // blend state weights so every interaction is a smooth morph, not a class swap
  const state: StateKey = gesture && gesture.navigated ? 'drag' : pressLevel > 0 ? 'pressed' : 'idle'
  const T = TARGETS[state]
  const k = 1 - Math.exp(-(d * 3.4) / 1)
  for (let i = 0; i < W.length; i++) W[i] = ease(W[i], T[i], k)
  const [bW, eW, inW, outW, scW, spW] = W

  // organic energy: fast attack while dragging, slow release like a dying voice level
  const raw = clamp01(dragVel + pressLevel * 0.25)
  lvl = ease(lvl, raw, raw > lvl ? 1 - Math.exp(-d * 20) : 1 - Math.exp(-d * 5))
  clickPulse = Math.max(0, clickPulse - d * 2.2)
  navPing = Math.max(0, navPing - d * 1.6)
  scanBoost = Math.max(0, scanBoost - d * 0.9)
  if (pressLevel === 0) {
    gazeX = ease(gazeX, 0, 1 - Math.exp(-d * 2.4))
    gazeY = ease(gazeY, 0, 1 - Math.exp(-d * 2.4))
  }

  const L = lvl * eW
  spin += d * (spW + eW * 0.2)
  breath += d * (1.15 + eW * 1.5)
  wob += d * (1.2 + L * 2.6)
  phOut += d * (2.4 + L * 5)
  phIn += d * (2.0 + L * 4)
  scan += d * 0.55
  light += d * 0.12

  const chars = RAMP
  const nC = chars.length - 1
  const scale = (1 + 0.032 * bW * Math.sin(breath)) * (1 + 0.09 * L)
  const R = Math.min(w, h) * 0.44 * scale

  // slow-orbiting key light + fixed rim fill
  let lx = Math.cos(light) * 0.45 - 0.15, ly = -0.52 + Math.sin(light) * 0.1, lz = 0.78
  const ll = Math.hypot(lx, ly, lz)
  lx /= ll; ly /= ll; lz /= ll
  const cs = Math.cos(spin * 2.2), sn = Math.sin(spin * 2.2)
  const scanY = -1.25 + ((scan * (scW + scanBoost)) % 2.5)
  const tick = Math.floor(clock * 12)
  // periodic "blink" band sweeping the eye line (old CSS blink, now per-character)
  const bt = clock % 6.4
  const blinkOn = bt > 5.9 && bt < 6.16

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.font = `${6.4 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f4f4f4'

  const cols = Math.floor(w / cw), rows = Math.floor(h / ch)
  const camX = gazeX * 0.34, camY = gazeY * 0.2 // gaze shifts apparent lighting = "eyes" following pointer
  const maxR = R * 1.06

  for (let j = 0; j < rows; j++) {
    const py = (j + 0.5) * ch - h / 2
    for (let i = 0; i < cols; i++) {
      const px = (i + 0.5) * cw - w / 2
      let x = px / R, y = py / R
      const dist = Math.hypot(x, y)
      if (dist > 1.06) continue
      const a = Math.atan2(y, x)
      // edge wobble while energized — surface reads as liquid
      const edge = 1 + L * (0.03 * Math.sin(3 * a + wob) + 0.016 * Math.sin(5 * a - wob * 1.3)) + clickPulse * .05 * Math.sin(6 * a + clock * 14)
      if (dist >= edge) continue
      x /= edge; y /= edge
      const nz = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      const nx = x - camX * 0.4, ny2 = y - camY

      // diffuse lighting on the sphere
      let b = 0.06 + 0.86 * Math.max(0, nx * lx + ny2 * ly + nz * lz)
      // surface texture that reads as rotation
      const rx = x * cs + nz * sn, rz = -x * sn + nz * cs
      const lon = Math.atan2(rx, rz), lat = Math.asin(Math.max(-1, Math.min(1, y)))
      b += 0.06 * Math.sin(lon * 2 + Math.sin(lat * 2) * 1.2) * Math.cos(lat)
      const dd = Math.acos(Math.min(1, nz))
      // ripples: press shivers inward, drag pushes waves outward
      b += outW * (0.08 + 0.34 * L) * Math.sin(dd * 9 - phOut) * nz
      b += inW * (0.06 + 0.26 * L) * Math.sin(dd * 9 + phIn) * nz
      // click: bright ring expanding from center
      if (clickPulse > 0.02) b += clickPulse * 1.1 * Math.sin(dd * 7 - (1 - clickPulse) * 9) * nz
      // screen change: shorter outward ping
      if (navPing > 0.02) b += navPing * 0.7 * Math.sin(dd * 6 - (1 - navPing) * 8) * nz
      // decode scanline while navigating
      let scramble = false
      if (scanBoost > 0.03 || scW > 0.04) {
        const near = Math.exp(-Math.pow((y - scanY) / 0.15, 2)) * Math.max(scanBoost, scW * 0.5)
        b += near * 0.42
        scramble = near > 0.3
      }
      // gaze highlight: chars brighten near where the pointer "looks"
      const gd = Math.exp(-((x - gazeX * 0.42) ** 2 + (y - gazeY * 0.42) ** 2) / 0.14)
      b += gd * 0.28 * (0.35 + eW * 0.65)
      // blink band + limb fade for a clean circle edge
      let limb = clamp01(b) * Math.min(1, nz * 2.2 + 0.15)
      if (blinkOn && y > -0.42 && y < -0.2) limb *= 0.08
      const idx = Math.round(limb * nC)
      if (idx <= 0) continue
      let chr = chars[idx]
      if (scramble && hash(i, j, tick) % 100 < 55) chr = chars[1 + (hash(j, i, tick) % nC)]
      ctx.globalAlpha = 0.26 + 0.74 * limb
      ctx.fillText(chr, (px + w / 2) * dpr, (py + h / 2) * dpr)
    }
  }
  ctx.globalAlpha = 1
}

function frame(now: number) {
  raf = 0
  const core = coreRef.value, cv = canvasRef.value
  if (!core || !cv || !visible) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  render(ctx, cv, (now - last) / 1000)
  last = now
  raf = requestAnimationFrame(frame)
}

// Reduced motion renders a single static frame; interactions redraw it once.
function drawStatic() {
  const cv = canvasRef.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  setupCanvas(cv)
  W.forEach((_, i) => { W[i] = TARGETS.idle[i] })
  lvl = 0; clickPulse = clickPulse > 0 ? Math.max(0.2, clickPulse) : 0
  staticMotion = true
  render(ctx, cv, 0)
}

function checkStatic() {
  const reduce = props.motionReduced || (reducedQuery?.matches ?? false)
  if (reduce && !staticMotion) {
    staticMotion = true
    cancelAnimationFrame(raf)
    raf = 0
    drawStatic()
  } else if (!reduce && staticMotion) {
    staticMotion = false
    start()
  }
  return reduce
}

function start() {
  const core = coreRef.value
  const cv = canvasRef.value
  if (!core || !cv || running || staticMotion || props.disabled) return
  const ctx = setupCanvas(cv)
  if (!ctx) return
  running = true
  last = performance.now()
  raf = requestAnimationFrame(frame)
}
function stop() {
  running = false
  cancelAnimationFrame(raf)
  raf = 0
}

watch(
  () => [coreRef.value, canvasRef.value] as const,
  ([, cv]) => {
    // reset any previous observers before re-attaching
    ro?.disconnect(); io?.disconnect(); stop()
    if (!cv) return
    const core = coreRef.value
    if (!core) return
    reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    setupCanvas(cv)
    ro = new ResizeObserver(() => {
      setupCanvas(cv)
      if (staticMotion) drawStatic()
    })
    ro.observe(core)
    io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true
      if (visible && !running && !staticMotion) start()
    }, { threshold: 0 })
    io.observe(core)
    checkStatic()
    start()
  },
  { immediate: true, flush: 'post' },
)

watch(
  () => [props.screenIndex, props.disabled, props.motionReduced],
  () => {
    checkStatic()
    if (staticMotion) drawStatic()
    else if (visible && !running) start()
    else if (!props.disabled && running) { /* keep looping */ }
  },
)

onUnmounted(() => {
  if (clickTimer) clearTimeout(clickTimer)
  if (navigationTimer) clearTimeout(navigationTimer)
  if (gazeTimer) clearTimeout(gazeTimer)
  stop()
  ro?.disconnect()
  io?.disconnect()
  reducedQuery = null
  ro = null
  io = null
})
</script>

<style scoped>
.orb-navigator { display: grid; justify-items: center; gap: 4px; user-select: none; }
.orb-core {
  position: relative; width: 112px; height: 112px; min-width: 112px !important; min-height: 112px !important;
  padding: 0 !important; display: grid; place-items: center; overflow: hidden; isolation: isolate;
  color: #fff; background: radial-gradient(ellipse at 48% 46%, #383838 0, #151515 42%, #030303 78%) !important;
  border: 2px solid #e4e4e4 !important; border-radius: 50% !important; outline: 2px solid #111;
  box-shadow: 0 0 0 3px #777, 0 0 24px #fff5, inset 0 0 18px #fff7, inset 0 -9px 18px #fff3;
  image-rendering: pixelated; touch-action: none; transition: box-shadow .18s ease, filter .18s ease;
}
.orb-core:disabled { opacity: 1; cursor: default; }
.orb-core:focus-visible { outline: 3px solid #fff; outline-offset: 5px; }
.orb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; filter: drop-shadow(0 0 4px #fff8); pointer-events: none; }
/* pressed / click feedback stays CSS so it works even with animations frozen */
.orb-core:active { box-shadow: 0 0 0 3px #fff, 0 0 32px #ffffffbd, inset 0 0 25px #fff9; filter: brightness(1.28) contrast(1.12); }
.orb-screen-count {
  position: absolute; z-index: 7; top: 16px; right: 15px; display: flex; align-items: baseline; padding: 2px 4px;
  color: #fff; background: #050505d9; border: 1px solid #fff9; border-radius: 8px; box-shadow: 1px 2px 5px #0009;
  font: 800 12px/1 ui-monospace, monospace; text-shadow: 1px 1px #000;
}
.orb-screen-count i { margin-left: 2px; font-size: 9px; font-style: normal; }
.orb-caption { color: var(--ui-text-3, #9a9a9a); font: 600 8px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-align: center; }
@media (prefers-reduced-motion: reduce) { .orb-canvas { filter: drop-shadow(0 0 3px #fff6); } }
</style>
