<!-- CyberManju OS — Default Home CTA (frontend consumer only). -->
<!-- Role: explicit Android Home choice with observed-state feedback, never a startup prompt. -->
<!-- Exports: HomeDefaultRoleAction. Integrates: Audio's frozen role contract through useHomeRoleAction. -->
<!-- Contracts: unavailable/unknown native commands disable requests; pending is not success. -->
<template>
  <section v-if="role.supported" class="home-role-action" data-ui-layout-ignore aria-label="Android default Home">
    <div class="home-role-buttons">
      <button type="button" :disabled="!role.canRequest.value" aria-describedby="home-role-status" @click="role.request($event)">Set as default Home</button>
      <button type="button" :disabled="role.checking.value || role.requesting.value" @click="role.check">{{ role.checking.value ? 'Checking…' : 'Check status' }}</button>
    </div>
    <p id="home-role-status" role="status">{{ role.notice.value }}</p>
  </section>
</template>
<script setup lang="ts">
import { useHomeRoleAction } from '@/composables/useHomeRoleAction'
const props = defineProps<{ beforeRequest: () => Promise<boolean> }>()
const role = useHomeRoleAction(() => props.beforeRequest())
</script>
<style scoped>
.home-role-action { flex-shrink: 0; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); color: var(--ui-text); }
.home-role-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.home-role-action button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); font: inherit; cursor: pointer; }
.home-role-action button:first-child:not(:disabled) { background: var(--ui-accent); color: var(--ui-on-accent); border-color: var(--ui-accent); }
.home-role-action button:disabled { opacity: .55; cursor: default; }
.home-role-action button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.home-role-action p { margin: 8px 0 0; color: var(--ui-text-3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
</style>
