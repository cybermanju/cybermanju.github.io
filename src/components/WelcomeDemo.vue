<!-- CyberManju OS — WelcomeDemo (src/components/WelcomeDemo.vue).
//
// The landing screen's self-typing mock cybsh session (the welcome-demo
// move): teaches the product by showing a real-looking chat
// with it — vault listing, one-shot encryption, an agent run — then loops.
// The script/cadence lives in utils/welcomeDemoScript.ts (pure, unit-
// tested); this component only runs the clock and renders, so it stays
// decorative: aria-hidden, no interactive content, reduced-motion jumps
// straight to the finished transcript.
//
// Role: Vue landing screen: decorative self-typing mock terminal.
// Exports: default (WelcomeDemo). Emits: none.
// Integrates: --ui-font-mono / --ui-kicker-* tokens, welcomeDemoScript.
// Contracts: decorative only — never mounts buttons or links inside.
-->
<template>
  <div class="wd-window" data-testid="welcome-demo" aria-hidden="true">
    <div class="wd-titlebar">
      <span class="wd-lights"><i /><i /><i /></span>
      <span class="wd-title">cybsh · personal-vault</span>
    </div>
    <div class="wd-body">
      <template v-for="(line, i) in visibleLines" :key="i">
        <div v-if="i < typedIndex" class="wd-line" :class="`wd-line--${line.tone ?? 'plain'}`">{{ line.text }}</div>
        <div v-else-if="i === typedIndex && line.typed" class="wd-line wd-line--typing" :class="`wd-line--${line.tone ?? 'plain'}`">
          {{ line.text.slice(0, typedChars) }}<span class="wd-caret" v-if="typedChars < line.text.length">&#9608;</span>
        </div>
        <div v-else-if="i === typedIndex && typedChars > 0" class="wd-line" :class="`wd-line--${line.tone ?? 'plain'}`">{{ line.text }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  WELCOME_DEMO_LINES,
  initialWelcomeDemo,
  advanceWelcomeDemo,
  type WelcomeDemoLine,
} from '@/utils/welcomeDemoScript'

const state = ref(initialWelcomeDemo())
const running = ref(true)
let timer: ReturnType<typeof setTimeout> | null = null

/** Fully revealed lines render instantly (terminal output semantics). */
const typedIndex = computed(() => state.value.lineIndex)
const typedChars = computed(() => state.value.chars)

const visibleLines = computed<WelcomeDemoLine[]>(() =>
  // Show everything up to and including the active line — earlier loops
  // scroll away naturally because the body keeps its default height.
  WELCOME_DEMO_LINES.slice(0, Math.min(WELCOME_DEMO_LINES.length, state.value.lineIndex + 1)),
)

function tick() {
  if (!running.value) return
  const { state: next, ms } = advanceWelcomeDemo(state.value)
  if (next.complete && next.lineIndex === state.value.lineIndex) {
    state.value = { ...next, lineIndex: next.lineIndex }
    // Hold on the finished transcript, then restart from a clean prompt.
    timer = setTimeout(() => {
      if (!running.value) return
      state.value = initialWelcomeDemo()
      tick()
    }, ms)
    return
  }
  state.value = next
  if (next.lineIndex >= WELCOME_DEMO_LINES.length) {
    // Past the end (defensive) — park completed until the loop timer.
    return
  }
  timer = setTimeout(tick, ms)
}

onMounted(() => {
  // Reduced motion: skip the typing entirely — show the finished demo.
  let reduced = false
  try {
    reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    reduced = false
  }
  if (reduced) {
    // Parked reveal: chars must cover the LAST line or the template's
    // current-line branch would never render it (it is non-typed).
    const last = WELCOME_DEMO_LINES[WELCOME_DEMO_LINES.length - 1]
    state.value = {
      chars: WELCOME_DEMO_LINES.length ? last.text.length : 0,
      lineIndex: Math.max(0, WELCOME_DEMO_LINES.length - 1),
      complete: true,
    }
    running.value = false
    return
  }
  tick()
})

onBeforeUnmount(() => {
  running.value = false
  if (timer) clearTimeout(timer)
  timer = null
})
</script>

<style scoped>
.wd-window {
  width: min(92vw, 460px);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-terminal, #000);
  box-shadow: var(--ui-shadow-menu);
  overflow: hidden;
  user-select: none;
}
.wd-titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ui-hairline);
  background: color-mix(in srgb, var(--ui-text) 4%, transparent);
}
.wd-lights { display: inline-flex; gap: 5px; }
.wd-lights i {
  width: 9px; height: 9px; border-radius: 50%;
  display: inline-block;
  background: color-mix(in srgb, var(--ui-text) 22%, transparent);
}
.wd-lights i:first-child { background: color-mix(in srgb, var(--ui-success) 70%, var(--ui-text)); }
.wd-title {
  margin: 0 auto;
  transform: translateX(-22px);
  color: var(--ui-text-2);
  font-family: var(--ui-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}
.wd-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 158px;
}
.wd-line {
  font-family: var(--ui-font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ui-text-2);
  white-space: pre-wrap;
  word-break: break-word;
}
.wd-line--prompt { color: var(--ui-text); font-weight: 600; }
.wd-line--accent { color: var(--ui-kicker-color, var(--ui-accent)); }
.wd-line--muted { color: var(--ui-text-3); }
.wd-caret {
  display: inline-block;
  margin-left: 1px;
  color: var(--ui-kicker-color, var(--ui-accent));
  animation: wd-blink 1.05s step-end infinite;
}
@keyframes wd-blink { 50% { opacity: 0; } }
@media (max-width: 768px) {
  .wd-body { min-height: 132px; }
}
@media (prefers-reduced-motion: reduce) {
  .wd-caret { animation: none; }
}
</style>
