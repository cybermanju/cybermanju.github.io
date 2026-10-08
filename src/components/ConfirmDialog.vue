<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="confirm-overlay"
      @click.self="handleCancel"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <div ref="dialogRef" class="confirm-modal">
        <div class="confirm-header">{{ title }}</div>
        <div class="confirm-body">{{ message }}</div>
        <div class="confirm-actions">
          <button ref="cancelBtnRef" class="confirm-btn cancel" @click="handleCancel"><AppIcon name="solar:close-bold" :size="13" /> {{ cancelText }}</button>
          <button ref="confirmBtnRef" class="confirm-btn ok" @click="handleConfirm"><AppIcon name="solar:check-bold" :size="13" /> {{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
}>(), {
  title: 'CONFIRM',
  message: 'ARE YOU SURE?',
  confirmText: 'YES',
  cancelText: 'CANCEL',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:visible': [value: boolean]
}>()

const dialogRef = ref<HTMLElement | null>(null)
const cancelBtnRef = ref<HTMLElement | null>(null)
const confirmBtnRef = ref<HTMLElement | null>(null)

useFocusTrap(dialogRef, toRef(props, 'visible'))

function handleConfirm() { emit('confirm'); emit('update:visible', false) }
function handleCancel() { emit('cancel'); emit('update:visible', false) }
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ui-bg-deep) 62%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10002;
  animation: ui-fade-in var(--ui-dur) var(--ui-ease-out);
}

.confirm-modal {
  position: relative;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-3), inset 0 1px 0 var(--ui-glass-highlight);
  padding: 22px;
  max-width: 380px;
  width: 90%;
  font-family: var(--ui-font);
  animation: ui-pop var(--ui-dur) var(--ui-ease-spring);
}

.confirm-modal::before {
  content: '';
  position: absolute;
  top: 0;
  left: 22px;
  right: 22px;
  height: 2px;
  border-radius: 0 0 var(--ui-radius-full) var(--ui-radius-full);
  background: var(--ui-accent);
  opacity: 0.85;
}

.confirm-header {
  font-size: var(--ui-fs-md);
  font-weight: 600;
  color: var(--ui-text);
  margin-bottom: 8px;
}

.confirm-body {
  font-size: var(--ui-fs-sm);
  color: var(--ui-text-2);
  margin-bottom: 18px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  font-weight: 700;
  letter-spacing: var(--ui-tracking);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  border: 1px solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text-2);
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-out);
}

.confirm-btn:hover {
  color: var(--ui-text);
  border-color: var(--ui-border-hover);
  background: var(--ui-surface-3);
}

.confirm-btn:active {
  transform: translateY(1px);
}

.confirm-btn.ok {
  background: var(--ui-accent);
  border-color: transparent;
  color: var(--ui-on-accent);
}

.confirm-btn.ok:hover {
  background: var(--ui-accent-strong);
  color: var(--ui-on-accent);
  box-shadow: var(--ui-glow-soft);
}

.confirm-btn:focus-visible {
  outline: none;
  box-shadow: var(--ui-focus-ring, 0 0 0 2px color-mix(in srgb, var(--ui-accent) 55%, transparent));
}
</style>
