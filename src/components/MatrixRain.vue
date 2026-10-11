<!-- CyberManju OS — MatrixRain (src/components/MatrixRain.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <canvas
    ref="canvasRef"
    class="matrix-rain-canvas"
    :style="{ opacity: enabled ? opacity : 0, transition: 'opacity 0.5s ease' }"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = withDefaults(defineProps<{
  enabled?: boolean
  opacity?: number
}>(), {
  enabled: true,
  opacity: 0.08,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
let animationId: number | null = null
let columns: number[] = []
let ctx: CanvasRenderingContext2D | null = null

// Katakana range + latin + digits
const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%^&*(){}[]|;:<>,.?/~`'

function getRandomChar(): string {
  return chars[Math.floor(Math.random() * chars.length)]
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  const colCount = Math.floor(canvas.width / 18)
  columns = Array.from({ length: colCount }, () => Math.floor(Math.random() * canvas.height / 18) * -1)
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return

  // Semi-transparent black to create fade trail
  ctx.fillStyle = 'rgba(10, 10, 15, 0.06)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.font = '14px "Courier New", monospace'

  for (let i = 0; i < columns.length; i++) {
    const char = getRandomChar()
    const x = i * 18
    const y = columns[i] * 18

    // Vary the green intensity for each column
    const brightness = Math.random()
    if (brightness > 0.95) {
      // Head of the stream — brightest
      ctx.fillStyle = 'rgba(200, 255, 200, 0.95)'
      ctx.shadowBlur = 12
      ctx.shadowColor = '#00FF41'
    } else if (brightness > 0.8) {
      ctx.fillStyle = 'rgba(0, 255, 65, 0.9)'
      ctx.shadowBlur = 6
      ctx.shadowColor = '#00FF41'
    } else {
      ctx.fillStyle = `rgba(0, ${Math.floor(150 + Math.random() * 105)}, 0, ${0.4 + Math.random() * 0.4})`
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }

    ctx.fillText(char, x, y)

    // Reset shadow after head
    if (brightness > 0.8) {
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }

    // Move column down, reset at random when off screen
    columns[i]++
    if (y > canvas.height && Math.random() > 0.975) {
      columns[i] = 0
    }
  }

  animationId = requestAnimationFrame(draw)
}

function startAnimation(): void {
  if (animationId) return
  resize()
  draw()
}

function stopAnimation(): void {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
}

onMounted(() => {
  const canvas = canvasRef.value
  if (canvas) {
    ctx = canvas.getContext('2d')
  }
  if (props.enabled) {
    startAnimation()
  }
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  stopAnimation()
  window.removeEventListener('resize', resize)
})

watch(() => props.enabled, (val) => {
  if (val) {
    startAnimation()
  } else {
    stopAnimation()
  }
})
</script>

<style scoped>
.matrix-rain-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
}
</style>