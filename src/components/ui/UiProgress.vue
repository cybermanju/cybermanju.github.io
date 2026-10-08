<template>
  <div class="ui-progress" :class="[`ui-progress--${tone}`, { 'ui-progress--indeterminate': indeterminate }]">
    <div v-if="label || $slots.label || showValue" class="ui-progress__meta">
      <span class="ui-progress__label"><slot name="label">{{ label }}</slot></span>
      <span v-if="showValue && !indeterminate" class="ui-progress__value">{{ clamped }}%</span>
    </div>
    <div class="ui-progress__track">
      <div
        class="ui-progress__fill"
        :style="indeterminate ? undefined : { width: `${clamped}%` }"
      />
      <div v-if="indeterminate" class="ui-progress__shine" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 0 – 100 */
    value?: number
    label?: string
    tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
    indeterminate?: boolean
    showValue?: boolean
  }>(),
  { value: 0, label: '', tone: 'accent', indeterminate: false, showValue: false }
)

const clamped = computed(() => Math.max(0, Math.min(100, Math.round(props.value))))
</script>

<style scoped>
.ui-progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.ui-progress__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.ui-progress__label {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-xs);
  font-weight: 600;
  color: var(--ui-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-progress__value {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-xs);
  font-weight: 600;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.ui-progress__track {
  position: relative;
  height: 6px;
  border-radius: var(--ui-radius-full);
  background: color-mix(in srgb, var(--ui-text) 10%, transparent);
  border: 1px solid var(--ui-hairline);
  overflow: hidden;
}

.ui-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ui-accent) 70%, transparent),
    var(--ui-accent)
  );
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-accent) 55%, transparent);
  transition: width var(--ui-dur-slow) var(--ui-ease-out);
}

.ui-progress--success .ui-progress__fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-success) 70%, transparent), var(--ui-success));
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-success) 55%, transparent);
}

.ui-progress--warning .ui-progress__fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-warning) 70%, transparent), var(--ui-warning));
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-warning) 55%, transparent);
}

.ui-progress--danger .ui-progress__fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-danger) 70%, transparent), var(--ui-danger));
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-danger) 55%, transparent);
}

.ui-progress--info .ui-progress__fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-info) 70%, transparent), var(--ui-info));
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-info) 55%, transparent);
}

.ui-progress--indeterminate .ui-progress__fill {
  width: 35%;
  animation: ui-progress-slide 1.4s var(--ui-ease) infinite;
}

@keyframes ui-progress-slide {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(330%); }
}

.ui-progress__shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--ui-accent) 30%, transparent),
    transparent
  );
  background-size: 200% 100%;
  animation: ui-shimmer 1.6s linear infinite;
}
</style>
