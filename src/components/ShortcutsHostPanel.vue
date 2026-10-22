<script setup lang="ts">
// CyberManju OS — Shortcuts host wrapper (src/components/ShortcutsHostPanel.vue).
// Role: Compose the editor with owner-scoped persistence, authorization and Android dispatch.
// Exports: Host-wired Shortcuts Vue component.
// Integrates: ShortcutsPanel, WorkflowService, Android Tauri command.
// Contracts: Fail closed without identity/storage/policy; never persist outputs.
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import ShortcutsPanel from '@/components/ShortcutsPanel.vue'
import { useAppStore } from '@/stores/app'
import { isAndroidApp, isStaticHost, isTauri } from '@/composables/useTauri'
import { useShortcutsAutomationHost } from '@/composables/useShortcutsAutomationHost'
import type { NativeActionResponse } from '@/automation'

const store = useAppStore()
const android = isAndroidApp()
// Positive environment opt-in: a signed-out authenticated dashboard must never use local data.
const allowLocalIdentity = computed(() => (isTauri() || isStaticHost()) && !store.requiresServerAuth())
const host = useShortcutsAutomationHost({
  userId: () => store.currentUser?.userId,
  allowLocalIdentity,
  environment: `${typeof location === 'undefined' ? 'unavailable' : location.origin}:${android ? 'android' : 'web'}`,
  android,
  ...(android ? { nativeBridge: async (request, signal) => {
    if (signal.aborted || !isAndroidApp()) throw new Error('native_dispatch_unavailable')
    return invoke<NativeActionResponse>('automation_native_dispatch', { request })
  } } : {}),
})
const {
  modelValue, savedWorkflow, records, selectedWorkflowId, saveComplete, saveFailed, actions,
  canSave, canRun, authorizationConnected, authorizationRequest, running, result,
  resultContext, pendingRun, acknowledgeFailedContext, notice,
} = host
// Listeners below exist for the lifetime attested here. Unmount revokes consent and aborts.
onMounted(host.connect)
onBeforeUnmount(host.disconnect)
</script>

<template>
  <div class="shortcuts-host">
    <p v-if="allowLocalIdentity && !store.currentUser" class="shortcuts-host-notice" role="note">
      Modo local: os atalhos ficam isolados neste armazenamento do app. Isso não é autenticação nem proteção contra outros usuários deste perfil local.
    </p>
    <p v-if="notice" class="shortcuts-host-notice" role="status">{{ notice }}</p>
    <ShortcutsPanel
      :key="store.currentUser?.userId ?? 'unauthenticated'"
      :model-value="modelValue" :saved-workflow="savedWorkflow"
      :records="records" :selected-workflow-id="selectedWorkflowId"
      :save-complete="saveComplete" :save-failed="saveFailed" :actions="actions"
      :can-save="canSave" :can-run="canRun" :authorization-connected="authorizationConnected"
      :authorization-request="authorizationRequest" :running="running"
      :result="result" :result-context="resultContext" :pending-run="pendingRun"
      :acknowledge-failed-context="acknowledgeFailedContext"
      @update:model-value="host.updateModel" @update:selected-workflow-id="host.select"
      @request-save="host.save" @request-run="host.run"
      @authorization-decision="host.authorizationDecision" @acknowledge-result="host.acknowledge"
    />
  </div>
</template>

<style scoped>
.shortcuts-host { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.shortcuts-host > :deep(.shortcuts-shell) { flex: 1; min-height: 0; }
.shortcuts-host-notice { margin: 0; padding: 10px 16px; font-size: 13px; color: var(--text-secondary, inherit); }
</style>
