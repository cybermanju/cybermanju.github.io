<!-- CyberManju OS — OrbNavigator (src/components/OrbNavigator.vue). -->
<!-- Role: Animated, accessible home-screen navigator with direct manipulation. -->
<!-- Exports: OrbNavigator component. -->
<!-- Integrates: HomeWorkspaceStudio via directional navigation and all-apps events. -->
<!-- Contracts: A delayed single activation steps to the next screen; a double activation opens
     the app drawer; drag steps are immediate — left/right page linearly, up/down jump grid rows
     (the page list is read as a square-ish row-major grid shared with the studio via
     homeGridCols/homeGridNeighbors, so both sides agree on the same screen map). -->
<template>
  <div class="orb-navigator">
    <button
      ref="coreRef"
      class="orb-core"
      type="button"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :data-state="dynamicState"
      data-testid="orb-navigator"
      @pointerenter="pointerEnter"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerEnd"
      @pointercancel="pointerCancel"
      @pointerleave="pointerLeave"
      @click="activate"
    >
      <!-- Live ASCII sphere: one canvas covers chars, lighting, scans, ripples, the
           count HUD and the neighbor tint wedges (colors appear only in the aimed
           / dragged direction). No frames or rings — the button is just the sphere. -->
      <canvas ref="canvasRef" class="orb-canvas" aria-hidden="true" />
    </button>
    <span class="orb-caption" aria-hidden="true">HOVER · DRAG ANY DIRECTION · TAP NEXT · DOUBLE-TAP ALL APPS</span>
  </div>
</template>

<script setup lang="ts">
// CyberManju OS — OrbNavigator (src/components/OrbNavigator.vue).
// Role: Animated, accessible home-screen navigator with direct manipulation.
// Exports: OrbNavigator component.
// Integrates: HomeWorkspaceStudio via directional navigation and all-apps events;
// src/utils/homeWorkspaces.ts for the shared grid layout + per-screen hue.
// Contracts: A delayed single activation steps to the next screen; a double activation opens the
// app drawer; drag steps are immediate — left/right page linearly, up/down jump grid rows.
// Emits: `navigate` carries {dx,dy} (not just ±1) so the studio can page rows; vertical walls are
// decided here (an impossible step never emits, it only bumps the orb) so routing stays in one place.
// Rendering: canvas 2D ASCII sphere — dense char ramp, spherical lighting + spin, eased state
// weights (idle/pressed/drag), ripple + scanline one-shots, and per-direction neighbor tint wedges
// drawn at low opacity (each neighbor screen keeps its own hue; drags focus the toward-sector).
import { computed, onUnmounted, ref, watch } from 'vue'
import { homeGridCols, homeGridNeighbors, homeHueForScreen, type HomeGridDelta } from '@/utils/homeWorkspaces'

const props = defineProps<{ screenIndex: number; screenCount: number; disabled?: boolean; motionReduced?: boolean }>()
const emit = defineEmits<{ navigate: [delta: HomeGridDelta]; openApps: [] }>()

const active = ref(false)
const clicked = ref(false)
const dynamicState = computed(() => (clicked.value ? 'clicked' : active.value ? 'pressed' : 'idle'))
const coreRef = ref<HTMLButtonElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const ariaLabel = computed(() => {
  const n = homeGridNeighbors(props.screenIndex, props.screenCount)
  const nearby = [
    n.left >= 0 ? 'one screen left' : '',
    n.right >= 0 ? 'one screen right' : '',
    n.up >= 0 ? 'a screen above' : '',
    n.down >= 0 ? 'a screen below' : '',
  ].filter(Boolean).join(', ')
  return `Orb navigator. Home screen ${props.screenIndex + 1} of ${props.screenCount}.` +
    (nearby ? ` Nearby: ${nearby}.` : ' No nearby screens.') +
    ' Click for the next screen, double-click for all apps, or drag toward a nearby screen.'
})

// ---------- gesture state (single/double activation contract unchanged) ----------
let gesture: { x: number; y: number; lx: number; ly: number; pointerId: number; navigated: boolean } | null = null
let clickTimer: ReturnType<typeof setTimeout> | null = null
let navigationTimer: ReturnType<typeof setTimeout> | null = null
let suppressClick = false
let lastClickAt = 0

// Visual inputs the render loop reads (plain module state — never triggers Vue re-renders).
let dragVel = 0 // pointer speed → organic energy
let pressLevel = 0 // 1 while held
let clickPulse = 0 // click flash + expanding ring
let navPing = 0 // screen changed → outward ping, eased away
let scanBoost = 0 // drag navigation → decode scanline
let wallBump = 0 // drag into a wall → nudge feedback, no navigation
let dragDX = 0, dragDY = 0 // dominant drag direction (-1..1 per axis), eases in the loop
let hoverX = 0, hoverY = 0 // -1..1 pointer aim while the cursor is over the orb
let hoverLive = false // true while the pointer is over the button (hover interaction)
let gazeX = 0, gazeY = 0 // eased on-sphere display position of the aim

function direction(dx: number, dy: number): HomeGridDelta {
  return Math.abs(dx) > Math.abs(dy) ? { dx: dx < 0 ? 1 : -1, dy: 0 } : { dx: 0, dy: dy < 0 ? -1 : 1 }
}
function aim(event: PointerEvent) {
  const core = event.currentTarget as HTMLElement
  const rect = core.getBoundingClientRect()
  hoverX = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)))
  hoverY = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)))
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  if (navigationTimer) { clearTimeout(navigationTimer); navigationTimer = null }
  pressLevel = 1
  hoverLive = true
  aim(event)
  gesture = { x: event.clientX, y: event.clientY, lx: event.clientX, ly: event.clientY, pointerId: event.pointerId, navigated: false }
  active.value = true
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Window-level pointer events are not required for taps. */ }
}
function pointerMove(event: PointerEvent) {
  aim(event)
  hoverLive = true
  if (!gesture || event.pointerId !== gesture.pointerId) return
  // pointer speed feeds the orb's organic energy (kept well below the swipe-unlock thresholds)
  dragVel = Math.min(1, dragVel * 0.7 + (Math.hypot(event.clientX - gesture.lx, event.clientY - gesture.ly) / 9) * 0.35)
  gesture.lx = event.clientX
  gesture.ly = event.clientY
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
  if (gesture.navigated) {
    const delta = direction(dx, dy)
    dragDX += (delta.dx - dragDX) * 0.35
    dragDY += (delta.dy - dragDY) * 0.35
  }
  if (!gesture.navigated && Math.hypot(dx, dy) >= 16) {
    gesture.navigated = true
    suppressClick = true
    lastClickAt = 0
    scanBoost = 1
    wallBump = 0
    step(direction(dx, dy))
    if (staticMotion) drawStatic()
  }
}
function pointerEnd(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  gesture = null
  pressLevel = 0
  dragVel = 0
  dragDX = 0; dragDY = 0
  active.value = false
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
}
function pointerCancel(event: PointerEvent) { pointerEnd(event); pressLevel = 0; dragVel = 0 }
function pointerEnter(event: PointerEvent) {
  aim(event)
  hoverLive = true
}
function pointerLeave(event: PointerEvent) {
  hoverLive = false
  if (!gesture) { pressLevel = 0; dragVel = 0; active.value = false }
}
function flashClicked(durationMs = 520) {
  clicked.value = false
  requestAnimationFrame(() => {
    clicked.value = true
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { clicked.value = false; clickTimer = null }, durationMs)
  })
}
/**
 * Directional step. The target is resolved against the shared grid here: vertical drags only
 * emit when a row above/below exists (otherwise the orb just bumps — feedback, no navigation).
 */
function step(delta: HomeGridDelta) {
  // Vertical: rows cap at the real grid (no extension screens grow upward/down).
  // Horizontal: one step past the last screen is permitted so the studio can resolve
  // it as a single empty extension screen (its existing contract), never a blank chain.
  const cols = homeGridCols(props.screenCount)
  const rawTarget = delta.dy ? props.screenIndex + delta.dy * cols : props.screenIndex + delta.dx
  const isHorizontalExtension = !delta.dy && rawTarget === props.screenCount
  if (rawTarget < 0 || (rawTarget >= props.screenCount && !isHorizontalExtension)) {
    // impossible step (a "wall"): bump the orb for feedback but never emit a move
    wallBump = Math.max(wallBump, 1)
    if (staticMotion) drawStatic()
    return
  }
  scanBoost = Math.max(scanBoost, delta.dy ? 0.7 : 1)
  navPing = Math.max(navPing, 0.55)
  if (staticMotion) { drawStatic(); return }
  emit('navigate', delta)
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
  navigationTimer = setTimeout(() => { navigationTimer = null; step({ dx: 1, dy: 0 }) }, 450)
}

// ---------- ASCII sphere renderer ----------
// Dense ramp (first char = empty): detail survives at 112px, unlike the old fixed <pre>.
const RAMP = " .'`^,:;Il!i~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
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

type Dir = 'left' | 'right' | 'up' | 'down'
const DIRS: Dir[] = ['left', 'right', 'up', 'down']
// Neighbor tint ramps: per direction, a white→hue color ladder indexed by the char ramp
// (chars keep their ramp detail but pick up the neighbor's hue as they brighten). Recomputed
// only when the neighbor set changes — the render loop does lookups, never allocation.
const tintRamps: Record<Dir, { neighbor: number; colors: string[] }> = {
  left: { neighbor: -1, colors: [] },
  right: { neighbor: -1, colors: [] },
  up: { neighbor: -1, colors: [] },
  down: { neighbor: -1, colors: [] },
}
const RAMP_MAX = RAMP.length - 1
const FONT = '700 6.4px ui-monospace, SFMono-Regular, Menlo, monospace'

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
function refreshTints() {
  const n = homeGridNeighbors(props.screenIndex, props.screenCount)
  for (const dir of DIRS) {
    const neighbor = n[dir]
    const ramp = tintRamps[dir]
    if (ramp.neighbor === neighbor) continue // cache intact (walls keep their empty cache too)
    ramp.neighbor = neighbor
    if (neighbor < 0) { ramp.colors = []; continue }
    const [r, g, b] = hslToRgb(homeHueForScreen(neighbor), 0.55, 0.6)
    // resting opacity ~0.10, drag-focused ~0.26 — always a whisper of color, never a wash
    ramp.colors = Array.from({ length: RAMP_MAX + 1 }, (_, idx) => {
      const mix = (idx / RAMP_MAX) * 0.72
      return `rgb(${Math.round(244 + (r - 244) * mix)},${Math.round(244 + (g - 244) * mix)},${Math.round(244 + (b - 244) * mix)})`
    })
  }
}

let raf = 0
let running = false
let visible = true
let staticMotion = false
let last = 0
let reducedQuery: MediaQueryList | null = null
let ro: ResizeObserver | null = null
let io: IntersectionObserver | null = null
let dpr = 1, w = 112, h = 112, cw = 6, ch = 7
let ctx: CanvasRenderingContext2D | null = null // resolved once on wire-up; never re-fetched per frame

// Integrated phases: speed/weight changes never cause visual jumps.
const W: number[] = [1, 0, 0, 0, 0, 0.1]
let lvl = 0, spin = 0.6, breath = 0, wob = 0, phOut = 0, phIn = 0, scan = 0, light = 0.4, clock = 0

function setupCanvas(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')
  if (!c) return null
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = cv.getBoundingClientRect()
  w = Math.max(1, Math.round(rect.width))
  h = Math.max(1, Math.round(rect.height))
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  c.font = FONT
  cw = c.measureText('M').width / dpr || 6.4
  ch = 6.4 * 1.16
  return c
}

function render(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, dt: number) {
  const d = staticMotion ? 0 : Math.min(0.05, dt || 0.016)

  // blend state weights so every interaction is a smooth morph, not a class swap
  const state: StateKey = gesture && gesture.navigated ? 'drag' : pressLevel > 0 ? 'pressed' : 'idle'
  const T = TARGETS[state]
  const k = 1 - Math.exp(-d * 3.4)
  for (let i = 0; i < W.length; i++) W[i] = ease(W[i], T[i], k)
  const bW = W[0], eW = W[1], inW = W[2], outW = W[3], scW = W[4], spW = W[5]

  // organic energy: fast attack while dragging, slow release afterwards
  const raw = clamp01(dragVel + pressLevel * 0.25 + (hoverLive && !gesture ? 0.08 : 0))
  lvl = ease(lvl, raw, raw > lvl ? 1 - Math.exp(-d * 20) : 1 - Math.exp(-d * 5))
  clickPulse = Math.max(0, clickPulse - d * 2.2)
  navPing = Math.max(0, navPing - d * 1.6)
  scanBoost = Math.max(0, scanBoost - d * 0.9)
  wallBump = Math.max(0, wallBump - d * 2.4)
  // gaze: pressed = snap to the pointer; hovering = ease in fast; gone = ease back to center
  const gz = pressLevel > 0 ? 1 : hoverLive ? 1 - Math.exp(-d * 11) : 1 - Math.exp(-d * 2.6)
  gazeX = ease(gazeX, hoverLive || pressLevel > 0 ? hoverX : 0, gz)
  gazeY = ease(gazeY, hoverLive || pressLevel > 0 ? hoverY : 0, gz)

  const L = lvl * eW
  spin += d * (spW + eW * 0.2)
  breath += d * (1.15 + eW * 1.5)
  wob += d * (1.2 + L * 2.6)
  phOut += d * (2.4 + L * 5)
  phIn += d * (2.0 + L * 4)
  scan += d * 0.55
  light += d * 0.12

  const scale = (1 + 0.032 * bW * Math.sin(breath)) * (1 + 0.09 * L)
  const R = Math.min(w, h) * 0.44 * scale

  // slow-orbiting key light (static frame keeps the last phase — no jumps on re-enable)
  let lx = Math.cos(light) * 0.45 - 0.15, ly = -0.52 + Math.sin(light) * 0.1, lz = 0.78
  const ll = Math.hypot(lx, ly, lz)
  lx /= ll; ly /= ll; lz /= ll
  const cs = Math.cos(spin * 2.2), sn = Math.sin(spin * 2.2)
  const scanY = -1.25 + ((scan * (scW + scanBoost)) % 2.5)
  const tick = Math.floor(clock * 12)
  // periodic blink band on the eye line (the old CSS blink, now per character)
  const blinkOn = !staticMotion && clock % 6.4 > 5.9 && clock % 6.4 < 6.16
  const bump = wallBump * 2.4 // orb nudges opposite the blocked drag, then settles

  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, cv.width, cv.height)
  c.font = FONT
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = '#f4f4f4'

  const cols = Math.floor(w / cw), rows = Math.floor(h / ch)
  // wall bump shifts the whole sphere briefly against the blocked direction
  const shiftX = bump * -dragDX
  const shiftY = bump * -dragDY

  for (let j = 0; j < rows; j++) {
    const py = (j + 0.5) * ch - h / 2 + shiftY
    for (let i = 0; i < cols; i++) {
      const px = (i + 0.5) * cw - w / 2 + shiftX
      let x = px / R, y = py / R
      const dist = Math.hypot(x, y)
      if (dist > 1.06) continue
      const a = Math.atan2(y, x)
      // living silhouette: lobes breathe at rest, surge wild under load — no static circle
      const edge = 1
        + (0.016 + 0.07 * L) * Math.sin(3 * a + wob)
        + (0.009 + 0.03 * L) * Math.sin(5 * a - wob * 1.3)
        + clickPulse * 0.05 * Math.sin(6 * a + clock * 14)
        + wallBump * 0.022 * Math.sin(6 * a)
      if (dist >= edge) continue
      x /= edge; y /= edge
      const nz = Math.sqrt(Math.max(0, 1 - x * x - y * y))

      // diffuse lighting on the sphere — near-black floor, blown peak
      let bright = 0.02 + 1.14 * Math.max(0, x * lx + y * ly + nz * lz)
      // surface texture that reads as rotation
      const rx = x * cs + nz * sn, rz = -x * sn + nz * cs
      const lon = Math.atan2(rx, rz), lat = Math.asin(Math.max(-1, Math.min(1, y)))
      bright += 0.06 * Math.sin(lon * 2 + Math.sin(lat * 2) * 1.2) * Math.cos(lat)
      const dd = Math.acos(Math.min(1, nz))
      // ripples: press shivers inward, drag pushes waves outward
      bright += outW * (0.08 + 0.34 * L) * Math.sin(dd * 9 - phOut) * nz
      bright += inW * (0.06 + 0.26 * L) * Math.sin(dd * 9 + phIn) * nz
      // click: bright ring expanding from the center
      if (clickPulse > 0.02) bright += clickPulse * 1.1 * Math.sin(dd * 7 - (1 - clickPulse) * 9) * nz
      // navigation ping: a lower, slower ring each time the screen changes
      if (navPing > 0.02) bright += navPing * 0.65 * Math.sin(dd * 6 - (1 - navPing) * 8) * nz
      // wall bump: brief global flare; the reader sees "this edge is solid"
      if (wallBump > 0.02) bright += wallBump * 0.4 * Math.sin(dd * 10) * nz
      // decode scanline while stepping screens
      let scramble = false
      if (scanBoost > 0.03 || scW > 0.04) {
        const near = Math.exp(-Math.pow((y - scanY) / 0.15, 2)) * Math.max(scanBoost, scW * 0.5)
        bright += near * 0.42
        scramble = near > 0.3
      }
      // gaze highlight: chars brighten where the pointer "looks"
      const gd = Math.exp(-((x - gazeX * 0.42) ** 2 + (y - gazeY * 0.42) ** 2) / 0.14)
      bright += gd * 0.28 * (0.35 + eW * 0.65)
      // limb fade for a clean-ish edge, then an S-curve: crush the muddy mid-greys
      // hard toward black and white, keep the fade so the outline still breathes
      const s = clamp01(bright)
      const shaped = s * s * (3 - 2 * s)
      let limb = shaped * Math.min(1, nz * 2.35 + 0.1)
      if (blinkOn && y > -0.42 && y < -0.2) limb *= 0.08
      const idx = Math.round(limb * RAMP_MAX)
      if (idx <= 0) continue
      let chr = RAMP[idx]
      if (scramble && hash(i, j, tick) % 100 < 55) chr = RAMP[1 + (hash(j, i, tick) % RAMP_MAX)]

      // neighbor tints appear ONLY where the interaction points: hovering into a
      // quadrant (past deadzone) focuses that neighbor's hue, dragging likewise;
      // at rest the sphere is pure white-on-black. Wide alpha swing for contrast.
      let alpha = 0.06 + 0.94 * limb
      const deg = a * 180 / Math.PI
      const sector = deg >= -45 && deg < 45 ? 'right' : deg >= 45 && deg < 135 ? 'down' : deg >= 135 || deg < -135 ? 'left' : 'up'
      const ramp = tintRamps[sector]
      if (ramp.neighbor >= 0) {
        const center = sector === 'right' ? 0 : sector === 'down' ? 90 : sector === 'left' ? 180 : -90
        const sq = clamp01(1 - Math.abs(((deg - center + 540) % 360) - 180) / 45)
        const hoverF = Math.max(0, (sector === 'right' ? gazeX : sector === 'left' ? -gazeX : sector === 'down' ? gazeY : -gazeY) - 0.3) / 0.7
        const dragF = Math.max(0, sector === 'right' ? dragDX : sector === 'left' ? -dragDX : sector === 'down' ? dragDY : -dragDY)
        const f = Math.max(dragF, hoverF)
        if (f > 0.02) {
          c.fillStyle = ramp.colors[idx]
          alpha *= (0.28 + 0.72 * f) * (0.66 + 0.34 * sq)
        }
      }
      c.globalAlpha = Math.min(1, alpha)
      c.fillText(chr, (px + w / 2) * dpr, (py + h / 2) * dpr)
    }
  }
  c.globalAlpha = 1

  // count HUD on the sphere itself (replaces the old DOM badge): top-right at 45°,
  // the colored wedge behind it dims slightly so the digits always win
  c.font = `800 ${(5.2 * dpr).toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`
  c.textAlign = 'right'
  c.textBaseline = 'top'
  const hx = (w / 2 + R * 0.48) * dpr, hy = (h / 2 - R * 0.6) * dpr
  c.globalAlpha = 0.92
  c.fillStyle = '#ffffff'
  c.fillText(`${props.screenIndex + 1}/${props.screenCount}`, hx - 3 * dpr, hy + 1 * dpr)
  c.globalAlpha = 1
  c.fillStyle = '#f4f4f4'
}

function frame(now: number) {
  raf = 0
  if (!coreRef.value || !canvasRef.value || !visible || !ctx) return
  const dt = (now - last) / 1000
  last = now
  clock += Math.min(0.05, dt || 0.016)
  render(ctx, canvasRef.value, dt)
  raf = requestAnimationFrame(frame)
}

// Reduced motion renders a single still frame; interactions redraw it once, never looping.
function drawStatic() {
  if (!ctx || !canvasRef.value) return
  refreshTints()
  for (let i = 0; i < W.length; i++) W[i] = TARGETS.idle[i]
  lvl = 0
  render(ctx, canvasRef.value, 0)
}

function checkStatic() {
  const reduce = props.motionReduced || (reducedQuery?.matches ?? false)
  if (reduce && !staticMotion) {
    staticMotion = true
    stop()
    drawStatic()
  } else if (!reduce && staticMotion) {
    staticMotion = false
    start()
  }
}

function start() {
  const core = coreRef.value
  const cv = canvasRef.value
  if (!core || !cv || running || staticMotion || props.disabled) return
  ctx = setupCanvas(cv)
  if (!ctx) return
  refreshTints()
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
    ro?.disconnect(); io?.disconnect(); stop()
    if (!cv) return
    const core = coreRef.value
    if (!core) return
    reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    ctx = setupCanvas(cv)
    ro = new ResizeObserver(() => {
      ctx = setupCanvas(cv)
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
  () => [props.screenIndex, props.screenCount, props.disabled, props.motionReduced],
  (next, prev) => {
    if (next[2] && !prev?.[2]) navPing = Math.max(navPing, 0.35) // disabled: the orb goes quiet, not dark
    checkStatic()
    refreshTints()
    if (next[0] !== prev?.[0]) navPing = Math.max(navPing, 0.55) // screen changed → outward ping
    if (staticMotion) drawStatic()
    else if (visible && !running && !props.disabled) start()
  },
)

onUnmounted(() => {
  if (clickTimer) clearTimeout(clickTimer)
  if (navigationTimer) clearTimeout(navigationTimer)
  stop()
  ro?.disconnect()
  io?.disconnect()
  reducedQuery = null
  ro = null
  io = null
})
</script>

<style scoped>
.orb-navigator { display: grid; justify-items: center; gap: 10px; user-select: none; }
/* The button is nothing but the sphere: no border, no ring, no background plate,
   no clipping — the wobbling silhouette extends freely; hit area stays the square
   so grabbing a lobe-edge never misses. */
.orb-core {
  position: relative; width: 112px; height: 112px; min-width: 112px !important; min-height: 112px !important;
  padding: 0 !important; display: grid; place-items: center; isolation: isolate;
  background: transparent !important; border: none !important; outline: none;
  touch-action: none; cursor: grab;
}
.orb-core:disabled { cursor: default; }
.orb-core:active { cursor: grabbing; }
.orb-core:focus-visible { outline: 2px solid #fff7; outline-offset: 6px; border-radius: 50%; }
.orb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
/* pressed feedback stays CSS so it reads even when the render loop is frozen */
.orb-caption { color: var(--ui-text-3, #9a9a9a); font: 600 8px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-align: center; }
</style>
