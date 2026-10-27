<!-- CyberManju OS — UiKicker (src/components/ui/UiKicker.vue).
//
// The instrument-panel eyebrow: 10px, weight 700, +0.16em tracking,
// uppercase — "FIRST RUN · STEP 3/7", "LOCAL RUNTIME · ARM64". Colour
// comes from the `--ui-kicker-*` tokens in tokens.ts (accent hue held at
// ≥ 4.5:1 over every content surface), so the label reads on all themes.
// Role: Vue UI primitive: kicker label.
// Exports: default (UiKicker), computed from props/tokens below.
// Integrates: --ui-kicker-* tokens (font/spacing/colour), UiText/UiTitle.
// Contracts: decorative scale — never for body copy or interactive copy.
-->
<template>
  <div class="ui-kicker" :class="{ muted: tone === 'muted' }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  /** `muted` renders the decorative faint tone instead of the accent hue. */
  tone?: 'accent' | 'muted'
}>(), { tone: 'accent' })
</script>

<style scoped>
.ui-kicker {
  color: var(--ui-kicker-color, var(--ui-accent));
  font-family: var(--ui-font);
  font-size: var(--ui-kicker-fs, 10px);
  font-weight: var(--ui-kicker-weight, 700);
  letter-spacing: var(--ui-kicker-tracking, 0.16em);
  text-transform: var(--ui-kicker-transform, uppercase);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ui-kicker.muted {
  color: var(--ui-text-3);
}
@media (prefers-reduced-motion: reduce) {
  .ui-kicker { transition: none; }
}
</style>
