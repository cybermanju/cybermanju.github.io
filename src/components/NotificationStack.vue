<template>
  <Teleport to="body">
    <div class="notification-stack" role="alert" aria-live="polite">
      <TransitionGroup name="nstack">
        <div
          v-for="n in notifications"
          :key="n.id"
          class="notification-item"
          :class="'notif-' + n.type"
          @click="dismiss(n.id)"
        >
          <span class="notif-icon"><AppIcon :name="ICONS[n.type]" :size="14" /></span>
          <span class="notif-msg">{{ n.message }}</span>
          <button class="notif-close" @click.stop="dismiss(n.id)" aria-label="CLOSE"><AppIcon name="solar:close-bold" :size="13" /></button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { useNotifications, type NotificationType } from '@/composables/useNotifications'

const { notifications, dismiss } = useNotifications()

const ICONS: Record<NotificationType, string> = {
  success: 'solar:check-circle-bold',
  error: 'solar:close-circle-bold',
  warning: 'solar:danger-triangle-bold',
  info: 'solar:info-circle-bold',
}
</script>

<style scoped>
.notification-stack {
  position: fixed;
  bottom: 36px;
  right: 12px;
  z-index: 10000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  pointer-events: none;
  max-width: 380px;
}

.notification-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(160%);
  border: 1px solid color-mix(in srgb, var(--ui-text) 10%, transparent);
  border-left: 3px solid var(--ui-info);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-3), inset 0 1px 0 var(--ui-glass-highlight);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  overflow: hidden;
}

.notif-error {
  border-left-color: var(--ui-danger);
}

.notif-error .notif-icon {
  color: var(--ui-danger);
}

.notif-success {
  border-left-color: var(--ui-accent);
}

.notif-success .notif-icon {
  color: var(--ui-accent);
}

.notif-warning {
  border-left-color: var(--ui-warning);
}

.notif-warning .notif-icon {
  color: var(--ui-warning);
}

.notif-info .notif-icon {
  color: var(--ui-info);
}

.notif-icon {
  font-size: 14px;
  flex-shrink: 0;
  display: flex;
}

.notif-msg {
  flex: 1;
  line-height: 1.35;
}

.notif-close {
  background: none;
  border: none;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text-3);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    color var(--ui-dur-fast) var(--ui-ease-out);
}

.notif-close:hover {
  background: color-mix(in srgb, var(--ui-danger) 16%, transparent);
  color: var(--ui-danger);
}

.nstack-enter-active,
.nstack-leave-active {
  transition: all var(--ui-dur) var(--ui-ease-out);
}

.nstack-enter-from {
  opacity: 0;
  transform: translateX(40px);
}

.nstack-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
