// CyberManju OS — RippleEffect (src/components/RippleEffect.vue).
// Role: Vue desktop UI: material-style click ripple for buttons and
//   interactive elements. Expands from the click point and fades out.
// Exports: module root component.
// Integrates: vue, @/composables/useMotion.
// Contracts: hidden under prefers-reduced-motion / motion=reduced; each
//   ripple is a single absolutely-positioned circle that self-removes after
//   the animation; no per-element state leaked to parent.

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useMotion } from '@/composables/useMotion'

const { duration, durationCss } = useMotion()

type Ripple = { id: number; x: number; y: number; size: number; opacity: number }
const ripples = ref<Ripple[]>([])
let nextId = 0

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const id = nextId++
  const size = Math.max(rect.width, rect.height) * 2.2
  ripples.value.push({ id, x, y, size: 0, opacity: 0.25 })

  // Animate: expand and fade. CSS @keyframes handles the timing; JS only
  // creates + removes the element.
  const rip = ripples.value.find((r: Ripple) => r.id === id)
  if (!rip) return
  let start = 0
  function animate(now: number) {
    if (!start) start = now
    const elapsed = now - start
    const progress = Math.min(elapsed / duration(600), 1)
    rip.size = size * progress
    rip.opacity = 0.25 * (1 - progress)
    if (progress < 1) {
      requestAnimationFrame(animate)
    } else {
      ripples.value = ripples.value.filter((r: Ripple) => r.id !== id)
    }
  }
  requestAnimationFrame(animate)
}
</script>

<template>
  <div
    class="ripple-container"
    @pointerdown="onPointerDown"
    style="position: relative; overflow: hidden; border-radius: inherit;"
  >
    <slot />
    <transition-group name="ripple" tag="div" class="ripples">
      <ripple
        v-for="rip in ripples"
        :key="rip.id"
        :x="rip.x"
        :y="rip.y"
        :size="rip.size"
        :opacity="rip.opacity"
      />
    </transition-group>
  </div>
</template>

<style scoped>
.ripple-container {
  display: inline-block;
}

.ripples {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: inherit;
}

ripple {
  position: absolute;
  display: block;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
  animation: ripple-expand var(--ripple-dur, 600ms) ease-out forwards;
}

@keyframes ripple-expand {
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  ripple {
    animation: none;
    display: none;
  }
}
</style>
