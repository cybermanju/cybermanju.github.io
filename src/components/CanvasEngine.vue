// CyberManju OS — CanvasEngine (src/components/CanvasEngine.vue).
// Role: Vue desktop UI: fullscreen animated canvas background (wallpaper slot).
// Exports: module root component.
// Integrates: vue, @/composables/useMotion.
// Contracts: opt-in via `enabled`; pauses when tab hidden or reduced motion;
//   all per-frame work is batched (single path stroke, pattern fills) and
//   particle counts scale with screen size to keep frame cost stable.

<template>
  <canvas ref="canvasRef" class="canvas-engine" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useMotion } from '@/composables/useMotion'

const { reduced } = useMotion()

const props = withDefaults(defineProps<{
  enabled?: boolean
  mode?: number
  particleCount?: number
}>(), {
  enabled: true,
  mode: 0,
  particleCount: 150,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
let animId = 0
let ctx: CanvasRenderingContext2D | null = null
let w = 0, h = 0
let t = 0

let verts: Float64Array
let edges: Int32Array
let rotX = 0, rotY = 0, rotZ = 0

let lissajousPhase = 0
let particles: { x: number; y: number; vx: number; vy: number; life: number; ax: number; ay: number }[] = []
let scanlineOffset = 0

// Mouse interaction: nearest particle is pulled/pushed by the cursor.
let mouseX = -1000
let mouseY = -1000
let mouseActive = false

// Tiles built ONCE (on mount / resize) so the per-frame cost is a handful of
// pattern fills instead of thousands of primitive fills — same pixels, same
// alpha, ~3 orders of magnitude fewer draw calls.
const CHECKER_TILE = 40
let checkerPattern: CanvasPattern | null = null
let scanPattern: CanvasPattern | null = null

function buildTiles() {
  if (!ctx) return

  const c = document.createElement('canvas')
  c.width = CHECKER_TILE
  c.height = CHECKER_TILE
  const cc = c.getContext('2d')
  if (cc) {
    cc.fillStyle = 'rgba(255, 255, 255, 0.03)'
    cc.fillRect(0, 0, CHECKER_TILE / 2, CHECKER_TILE / 2)
    cc.fillRect(CHECKER_TILE / 2, CHECKER_TILE / 2, CHECKER_TILE / 2, CHECKER_TILE / 2)
  }
  checkerPattern = ctx.createPattern(c, 'repeat')

  const s = document.createElement('canvas')
  s.width = 1
  s.height = 4
  const sc = s.getContext('2d')
  if (sc) {
    sc.fillStyle = 'rgba(255, 255, 255, 0.015)'
    sc.fillRect(0, 0, 1, 1)
  }
  scanPattern = ctx.createPattern(s, 'repeat')
}

function resize() {
  const c = canvasRef.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  w = window.innerWidth
  h = window.innerHeight
  c.width = w * dpr
  c.height = h * dpr
  c.style.width = w + 'px'
  c.style.height = h + 'px'
  if (ctx) ctx.scale(dpr, dpr)
  initParticles()
}

function initWireframe() {
  const s = 60
  verts = new Float64Array([
    -s,-s,-s,  s,-s,-s,  s,s,-s,  -s,s,-s,
    -s,-s, s,  s,-s, s,  s,s, s,  -s,s, s,
  ])
  edges = new Int32Array([
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7,
  ])
}

function initParticles() {
  particles = []
  const count = Math.min(props.particleCount, Math.floor((w * h) / 15000))
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5 - 0.5,
      life: Math.random(),
      ax: 0,
      ay: 0,
    })
  }
}

function project(x: number, y: number, z: number): [number, number] {
  const fov = 300
  const cx = w / 2
  const cy = h / 2
  const scale = fov / (fov + z)
  return [x * scale + cx, -y * scale + cy]
}

function rotate3d(x: number, y: number, z: number): [number, number, number] {
  let rx = x, ry = y, rz = z
  let t = ry
  ry = t * Math.cos(rotX) - rz * Math.sin(rotX)
  rz = t * Math.sin(rotX) + rz * Math.cos(rotX)
  t = rx
  rx = t * Math.cos(rotY) + rz * Math.sin(rotY)
  rz = -t * Math.sin(rotY) + rz * Math.cos(rotY)
  t = rx
  rx = t * Math.cos(rotZ) - ry * Math.sin(rotZ)
  ry = t * Math.sin(rotZ) + ry * Math.cos(rotZ)
  return [rx, ry, rz]
}

function drawWireframe() {
  if (!ctx || !verts || !edges) return
  const numVerts = verts.length / 3
  const projected: [number, number][] = []
  for (let i = 0; i < numVerts; i++) {
    const [rx, ry, rz] = rotate3d(verts[i*3], verts[i*3+1], verts[i*3+2])
    projected.push(project(rx, ry, rz))
  }
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < edges.length; i += 2) {
    const p1 = projected[edges[i]]
    const p2 = projected[edges[i + 1]]
    ctx.moveTo(p1[0], p1[1])
    ctx.lineTo(p2[0], p2[1])
  }
  ctx.stroke()
  ctx.fillStyle = '#FFFFFF'
  for (const p of projected) {
    ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4)
  }
}

function drawLissajous() {
  if (!ctx) return
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 1
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.3
  ctx.beginPath()
  const steps = 200
  const a = 3, b = 4
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2
    const x = cx + r * Math.sin(a * th + lissajousPhase * 0.3)
    const y = cy + r * Math.sin(b * th + lissajousPhase * 0.5)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  const s2 = 5, b2 = 6
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2
    const x = cx + r * 0.6 * Math.sin(s2 * th + lissajousPhase * 0.2 + 1)
    const y = cy + r * 0.6 * Math.sin(b2 * th + lissajousPhase * 0.4 + 2)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawParticles() {
  if (!ctx) return
  const count = particles.length
  if (count === 0) return

  const mx = mouseActive ? mouseX : -1
  const my = mouseActive ? mouseY : -1
  const interactRadius = 120

  // Precompute per-particle positions + mouse influence so the draw pass is
  // a tight loop with no allocations.
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  const alphas = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    const p = particles[i]

    // Mouse interaction: attract/repel from cursor.
    if (mouseActive) {
      const dx = mx - p.x
      const dy = my - p.y
      const dist2 = dx * dx + dy * dy
      if (dist2 < interactRadius * interactRadius) {
        const force = (interactRadius * interactRadius - dist2) / (interactRadius * interactRadius)
        p.vx += dx * force * 0.005
        p.vy += dy * force * 0.005
        mouseActive = false // consume one frame of interaction
      }
    }

    p.x += p.vx
    p.y += p.vy
    p.vx *= 0.98
    p.vy *= 0.98
    p.life -= 0.002

    if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
      p.x = Math.random() * w
      p.y = h + 20
      p.vx = (Math.random() - 0.5) * 1.5
      p.vy = -(1 + Math.random() * 2)
      p.life = 0.5 + Math.random() * 0.5
    }

    xs[i] = p.x
    ys[i] = p.y
    alphas[i] = Math.max(0, p.life)
  }

  // Draw connections between nearby particles (constellation / neural net).
  const connectDist = 110
  const connectDist2 = connectDist * connectDist
  ctx.beginPath()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 0.5
  let hasLine = false
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = xs[i] - xs[j]
      const dy = ys[i] - ys[j]
      if (dx * dx + dy * dy < connectDist2) {
        const alpha = 0.04 * (1 - (dx * dx + dy * dy) / connectDist2)
        if (alpha > 0.005) {
          if (!hasLine) {
            ctx.beginPath()
            hasLine = true
          }
          ctx.moveTo(xs[i], ys[i])
          ctx.lineTo(xs[j], ys[j])
        }
      }
    }
  }
  if (hasLine) ctx.stroke()

  // Draw particles: one fillStyle, per-particle alpha via globalAlpha.
  ctx.fillStyle = '#FFFFFF'
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alphas[i]
    ctx.fillRect(xs[i], ys[i], 2.5, 2.5)
  }
  ctx.globalAlpha = 1
}

function drawOpArtRings() {
  if (!ctx) return
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 1
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.sqrt(w * w + h * h) / 2 + 50
  const offset = (t * 0.3) % 40
  ctx.beginPath()
  for (let r = offset; r < maxR; r += 40) {
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.stroke()
}

function drawCheckerboard() {
  if (!ctx || !checkerPattern) return
  const offX = (t * 0.5) % CHECKER_TILE
  const offY = (t * 0.3) % CHECKER_TILE
  ctx.save()
  ctx.translate(offX - CHECKER_TILE, offY - CHECKER_TILE)
  ctx.fillStyle = checkerPattern
  ctx.fillRect(0, 0, w + CHECKER_TILE * 2, h + CHECKER_TILE * 2)
  ctx.restore()
}

function drawScanlines() {
  if (!ctx || !scanPattern) return
  scanlineOffset = (scanlineOffset + 2) % 4
  ctx.save()
  ctx.translate(0, scanlineOffset)
  ctx.fillStyle = scanPattern
  ctx.fillRect(0, -4, w, h + 8)
  ctx.restore()
}

function draw() {
  if (!ctx) return
  t++
  rotX = t * 0.008
  rotY = t * 0.012
  rotZ = t * 0.005
  lissajousPhase += 0.02

  ctx.clearRect(0, 0, w, h)

  drawOpArtRings()
  drawCheckerboard()

  const modeCycle = Math.floor(t / 300) % 3
  switch (modeCycle) {
    case 0:
      drawWireframe()
      break
    case 1:
      drawLissajous()
      drawParticles()
      break
    case 2:
      drawWireframe()
      drawParticles()
      break
  }

  drawScanlines()

  animId = requestAnimationFrame(draw)
}

function start() {
  if (animId) return
  resize()
  initParticles()
  initWireframe()
  draw()
}

function stop() {
  if (animId) {
    cancelAnimationFrame(animId)
    animId = 0
  }
}

/** Backgrounded app → stop burning frames on an invisible wallpaper. */
function onVisibility() {
  if (document.hidden) stop()
  else if (props.enabled && !reduced.value) start()
}

function onMouseMove(e: MouseEvent) {
  mouseX = e.clientX
  mouseY = e.clientY
  mouseActive = true
}

function onMouseLeave() {
  mouseActive = false
}

onMounted(() => {
  const c = canvasRef.value
  if (c) {
    ctx = c.getContext('2d')
  }
  buildTiles()
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseleave', onMouseLeave)
  if (props.enabled && !reduced.value) start()
})

onUnmounted(() => {
  stop()
  window.removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseleave', onMouseLeave)
})

watch(() => props.enabled, (v: boolean) => {
  if (v && !reduced.value) start()
  else stop()
})

watch(reduced, (v: boolean) => {
  if (v) stop()
  else if (props.enabled) start()
})
</script>

<style scoped>
.canvas-engine {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
}
</style>
