<!-- CyberManju OS — FirstRunCoach (src/components/FirstRunCoach.vue).
//
// One quiet guided pass over the finished workspace (the coach mark):
// dim the real UI, cut a ring around the actual element with a
// leader note — "This is the Dock…", "Ctrl+` opens cybsh". Steps/keys
// live in utils/coachMarks.ts (pure); this component resolves selectors,
// draws the cutout via the classic box-shadow hole (no 4-panel math),
// and moves between steps. Missing targets become centered cards; the
// tour is dismissable at any point and never blocks input—it is an
// overlay with pointer-events that the user clicks through deliberately.
//
// Role: Vue desktop overlay: first-run coach tour (desktop only).
// Exports: default (FirstRunCoach). Emits: ['done'] on finish/dismiss.
// Integrates: coachMarks utils, --ui-* tokens, ResizeObserver (+resize).
// Contracts: renders nothing (emits 'done') when no step's target exists.
-->
<template>
  <div class="coach-layer" data-testid="first-run-coach" @keydown.esc="finish" @click.self="finish">
    <!-- Cutout ring: a marker over the target that punches a hole in the
         dim with its box-shadow spread (removes all 4-panel math). -->
    <div
      v-if="ringStyle"
      class="coach-hole"
      :style="ringStyle"
      data-testid="coach-hole"
    />
    <div
      class="coach-note"
      :class="[`coach-note--${active.side ?? 'bottom'}`, { centered: !ringStyle }]"
      :style="noteStyle"
      role="status"
      aria-live="polite"
    >
      <span class="coach-kicker">{{ kickerText }}</span>
      <p class="coach-label">{{ active.label }}</p>
      <p v-if="active.detail" class="coach-detail">{{ active.detail }}</p>
      <div class="coach-actions">
        <button v-if="prevId" class="coach-link" type="button" data-testid="coach-back" @click="back">Back</button>
        <button class="coach-ok" type="button" :data-testid="`coach-next-${active.id}`" @click="next">
          {{ nextId ? 'Next' : 'Got it' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  COACH_STEPS,
  nextCoachStep,
  previousCoachStep,
  type CoachStep,
} from '@/utils/coachMarks'

const emit = defineEmits<{ done: [] }>()

const ring = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const stepId = ref<string | null>(null)
const kickerText = ref('')

const active = computed<CoachStep>(() => {
  const step = COACH_STEPS.find(s => s.id === stepId.value) ?? firstAvailableStep()
  return step ?? COACH_STEPS[COACH_STEPS.length - 1] ?? COACH_STEPS[0]!
})
const nextId = computed(() => nextCoachStep(stepId.value))
const prevId = computed(() => previousCoachStep(stepId.value))

/** First step whose selector resolves in the live DOM (or null). */
function firstAvailableStep(): CoachStep | null {
  for (const step of COACH_STEPS) {
    if (!step.target) return step
    if (document.querySelector(step.target)) return step
  }
  return null
}

function resolveStep(id: string | null): CoachStep | null {
  const step = COACH_STEPS.find(s => s.id === id)
  if (step?.target && !document.querySelector(step.target)) {
    // Target vanished — jump to the next step that still resolves.
    return resolveStep(nextCoachStep(step.id)) ?? null
  }
  return step ?? null
}

function updateRing() {
  const step = active.value
  if (!step?.target) {
    ring.value = null
    kickerText.value = step?.kicker ?? ''
    return
  }
  kickerText.value = step.kicker
  const el = document.querySelector(step.target)
  if (!(el instanceof HTMLElement)) {
    ring.value = null
    return
  }
  const r = el.getBoundingClientRect()
  ring.value = { left: r.left, top: r.top, width: r.width, height: r.height }
  kickerText.value = step.kicker
}

const pad = 10

const ringStyle = computed(() => {
  const r = ring.value
  if (!r) return null
  return {
    left: `${Math.max(0, r.left - pad)}px`,
    top: `${Math.max(0, r.top - pad)}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  }
})

/** Note placement: outside the ring on the declared side, else centered. */
const noteStyle = computed(() => {
  const r = ring.value
  if (!r) return null
  const side = active.value.side ?? 'bottom'
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (side === 'top') {
    return { left: '50%', top: `${Math.max(12, r.top - pad - 96)}px`, transform: 'translateX(-50%)' }
  }
  if (side === 'left') {
    return { left: `${Math.max(12, r.left - pad - 432)}px`, top: `${Math.min(vh - 140, r.top)}px` }
  }
  if (side === 'right') {
    return { left: `${Math.min(vw - 444, r.left + r.width + pad + 12)}px`, top: `${Math.min(vh - 140, r.top)}px` }
  }
  // bottom (default) — dock sits at screen bottom, so note goes above it.
  const noteTop = Math.max(12, r.top - pad - 108)
  return { left: '50%', top: `${Math.min(noteTop, vh - 130)}px`, transform: 'translateX(-50%)' }
})

function goTo(id: string | null) {
  const step = resolveStep(id)
  stepId.value = step?.id ?? null
  updateRing()
}

function next() {
  if (!nextId.value) { finish(); return }
  goTo(nextId.value)
}

function back() {
  goTo(prevId.value)
}

function finish() {
  emit('done')
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  goTo(stepId.value ?? firstAvailableStep()?.id ?? null)
  if (!stepId.value) {
    // Nothing resolved — do not show a floating tour of nothing.
    emit('done')
    return
  }
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateRing())
    resizeObserver.observe(document.documentElement)
  }
  window.addEventListener('resize', updateRing)
  window.addEventListener('scroll', updateRing, true)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', updateRing)
  window.removeEventListener('scroll', updateRing, true)
})
</script>

<style scoped>
.coach-layer {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: color-mix(in srgb, var(--ui-bg) 62%, transparent);
  backdrop-filter: none;
}
.coach-hole {
  position: fixed;
  border-radius: calc(var(--ui-radius-lg) + 10px);
  border: 2px solid var(--ui-kicker-color, var(--ui-accent));
  box-shadow: 0 0 0 9999px color-mix(in srgb, var(--ui-bg) 68%, transparent);
  pointer-events: none;
  transition: left var(--ui-dur) var(--ui-ease-spring), top var(--ui-dur) var(--ui-ease-spring),
    width var(--ui-dur) var(--ui-ease-spring), height var(--ui-dur) var(--ui-ease-spring);
}
.coach-note {
  position: fixed;
  width: min(420px, calc(100vw - 24px));
  padding: 14px 16px 12px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  box-shadow: var(--ui-shadow-menu);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.coach-note.centered {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
.coach-kicker {
  color: var(--ui-kicker-color, var(--ui-accent));
  font-size: var(--ui-kicker-fs, 10px);
  font-weight: var(--ui-kicker-weight, 700);
  letter-spacing: var(--ui-kicker-tracking, 0.16em);
  text-transform: var(--ui-kicker-transform, uppercase);
}
.coach-label {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ui-text);
}
.coach-detail {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ui-text-2);
}
.coach-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.coach-link {
  border: none;
  background: none;
  color: var(--ui-text-3);
  font-size: 12px;
  font-family: var(--ui-font);
  cursor: pointer;
  padding: 6px 4px;
}
.coach-ok {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--ui-control-h);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-accent);
  color: var(--ui-on-accent);
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--ui-font);
  cursor: pointer;
  transition: transform var(--ui-dur-fast) var(--ui-ease-spring), background-color var(--ui-dur-fast) ease-out;
}
.coach-ok:active { transform: scale(0.96); }
.coach-ok:hover { background: var(--ui-accent-strong); color: var(--ui-on-accent-strong); }
@media (max-width: 768px) {
  .coach-layer { display: none; } /* mobile got the full wizard instead */
}
@media (prefers-reduced-motion: reduce) {
  .coach-hole { transition: none; }
}
</style>
