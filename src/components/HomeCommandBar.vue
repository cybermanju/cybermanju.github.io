<script setup lang="ts">
// CyberManju OS — HomeCommandBar (src/components/HomeCommandBar.vue).
// Role: Offer one home input that stages text in the existing Assistant or cybsh panel.
// Exports: default Vue SFC (HomeCommandBar).
// Integrates: @/composables/useHomeCommandHandoff, @/composables/useWindowManager, @/components/AppIcon.vue.
// Contracts: Opens real panels and stages drafts only; never invokes an AI provider or executes shell input.
import { ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { stageHomeCommand, type HomeCommandTarget } from '@/composables/useHomeCommandHandoff'
import { useWindowManager } from '@/composables/useWindowManager'

const wm = useWindowManager()
const input = ref('')
const status = ref('')

function stage(target: HomeCommandTarget) {
  const text = input.value.trim()
  if (!text) return
  stageHomeCommand(target, text)
  wm.open(target)
  status.value = target === 'agent' ? 'Added to Assistant draft' : 'Added to cybsh draft'
  input.value = ''
}
</script>

<template>
  <section class="home-command" aria-label="Assistant and cybsh command bar">
    <label class="home-command-input-wrap">
      <AppIcon name="solar:magnifer-bold" :size="17" aria-hidden="true" />
      <input
        v-model="input"
        type="text"
        autocomplete="off"
        aria-label="Ask AI or enter a cybsh command"
        placeholder="Ask AI or enter a cybsh command…"
        @keydown.enter.prevent="stage('agent')"
      />
    </label>
    <div class="home-command-actions">
      <button type="button" :disabled="!input.trim()" @click="stage('agent')">
        <AppIcon name="solar:chat-round-dots-bold" :size="15" aria-hidden="true" />
        <span>Ask AI</span>
      </button>
      <button type="button" :disabled="!input.trim()" @click="stage('terminal')">
        <AppIcon name="solar:file-terminal-bold" :size="15" aria-hidden="true" />
        <span>cybsh</span>
      </button>
    </div>
    <span v-if="status" class="home-command-status" role="status" aria-live="polite">{{ status }}</span>
  </section>
</template>

<style scoped>
.home-command {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: min(680px, 100%);
  padding: 8px;
  border: 1px solid var(--ui-border, rgb(255 255 255 / 12%));
  border-radius: 16px;
  background: var(--ui-surface, rgb(20 24 34 / 88%));
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.home-command-input-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  color: var(--ui-text-muted, #9aa4b2);
}
.home-command-input-wrap input {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text, #f4f6fa);
  font: inherit;
}
.home-command-input-wrap input::placeholder { color: var(--ui-text-muted, #9aa4b2); }
.home-command-actions { display: flex; gap: 6px; }
.home-command-actions button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--ui-border, rgb(255 255 255 / 12%));
  border-radius: 11px;
  background: var(--ui-surface-raised, rgb(255 255 255 / 5%));
  color: var(--ui-text, #f4f6fa);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.home-command-actions button:hover:not(:disabled) { border-color: var(--ui-accent, #7c8cff); }
.home-command-actions button:disabled { opacity: .45; cursor: default; }
.home-command-status {
  grid-column: 1 / -1;
  min-height: 12px;
  padding: 0 10px;
  color: var(--ui-text-muted, #9aa4b2);
  font-size: 10px;
}
@media (max-width: 520px) {
  .home-command { grid-template-columns: 1fr; }
  .home-command-actions button { flex: 1; min-height: 42px; }
  .home-command-status { grid-column: 1; }
}
</style>
