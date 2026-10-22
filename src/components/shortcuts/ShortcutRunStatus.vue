<script setup lang="ts">
// CyberManju OS — Shortcut run status (src/components/shortcuts/ShortcutRunStatus.vue).
// Role: Present safe, accessible status for one shortcut execution result.
// Exports: ShortcutRunStatus component.
// Integrates: Automation RunResult and bounded JSON output copying.
// Contracts: No execution controls, persistence, logging, networking, or raw denied payloads.
import { computed, ref, watch } from 'vue'
import { copyJson, LIMITS } from '@/automation'

import { boundedValidationIssues, rejectionLabel, validationIssueLabel, type ShortcutRunResult } from '@/utils/shortcutStatus'

const props = defineProps<{ result?: ShortcutRunResult | null; running?: boolean }>()
const issues = computed(() => props.result?.status === 'rejected' ? boundedValidationIssues(props.result.issues) : [])
const revealed = ref(false)
watch(() => [props.result, props.running], () => { revealed.value = false }, { deep: true })
function outputText(outputs: Record<string, unknown>): string {
  try { return JSON.stringify(copyJson(outputs, LIMITS.outputBytes, true), null, 2) }
  catch { return 'A saída é inválida ou excede o limite de segurança e não pode ser exibida.' }
}
function expiryLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}
</script>
<template>
  <section class="shortcut-run-status" aria-label="Status da execução">
    <div class="status-message" role="status" aria-live="polite" :class="{ 'is-running': running, 'is-success': !running && result?.status === 'completed', 'is-warning': !running && result?.status === 'halted', 'is-error': !running && (result?.status === 'failed' || result?.status === 'rejected') }">
      <span v-if="running">Execução em andamento.</span>
      <template v-else-if="!result">Nenhum resultado de execução disponível.</template>
      <template v-else-if="result.status === 'completed'">
        <span>Execução concluída.</span>
        <p class="detail">{{ result.steps }} etapas concluídas.</p>
        <div class="private-output">
          <button type="button" class="reveal-button" @click="revealed = !revealed">{{ revealed ? 'Ocultar saída privada' : 'Revelar saída privada' }}</button>
          <pre v-if="revealed" class="output">{{ outputText(result.outputs) }}</pre>
        </div>
      </template>
      <template v-else-if="result.status === 'rejected'">
        <span>Execução rejeitada pelo serviço antes do runner.</span>
        <p class="detail">{{ rejectionLabel(result.code) }}</p>
        <ul v-if="issues.length" aria-label="Problemas de validação do host">
          <li v-for="(issue, index) in issues" :key="index">{{ issue.severity === 'error' ? 'Erro' : 'Informação' }}: {{ validationIssueLabel(issue.code) }} <span v-if="issue.nodeId">· nó <code>{{ issue.nodeId }}</code></span></li>
        </ul>
        <p class="detail">Nenhuma nova tentativa automática. O host precisa reconciliar este resultado.</p>
      </template>
      <template v-else-if="result.status === 'failed'">
        <span>Execução interrompida pelo runner.</span>
        <p class="detail">{{ result.code }} · {{ result.steps }} etapas processadas.</p>
      </template>
      <template v-else>
        <template v-if="result.result.status === 'accepted'">
          <span>A solicitação foi aceita pelo host; isso não significa que a execução foi concluída.</span>
        </template>
        <template v-else-if="result.result.status === 'needs_confirmation'">
          <span>Esta ação aguarda confirmação no host. A execução não foi concluída.</span>
          <p class="detail"><strong>Resumo:</strong> {{ result.result.summary }}</p>
          <p class="detail">Expira em: {{ expiryLabel(result.result.expiresAt) }}</p>
          <p class="detail">Confirme diretamente no host. Não é possível aprovar ou retomar por aqui.</p>
        </template>
        <template v-else-if="result.result.status === 'unknown'">
          <span>O resultado é desconhecido. Para evitar repetir um possível efeito, não tente novamente nem retome automaticamente.</span>
        </template>
        <template v-else-if="result.result.status === 'denied'">
          <span>A ação foi negada. Nenhum conteúdo da solicitação é exibido.</span>
          <p class="detail">Código: {{ result.result.code }}</p>
        </template>
        <template v-else-if="result.result.status === 'failed'">
          <span>A ação falhou. Não houve nova tentativa automática.</span>
          <p class="detail">Código: {{ result.result.code }}</p>
        </template>
        <template v-else-if="result.result.status === 'succeeded'">
          <span>A ação terminou, mas a execução do fluxo foi interrompida.</span>
          <div class="private-output">
            <button type="button" class="reveal-button" @click="revealed = !revealed">{{ revealed ? 'Ocultar saída privada' : 'Revelar saída privada' }}</button>
            <pre v-if="revealed" class="output">{{ outputText({ [result.nodeId]: result.result.output }) }}</pre>
          </div>
        </template>
        <p class="detail">{{ result.steps }} etapas processadas.</p>
      </template>
    </div>
  </section>
</template>
<style scoped>
.shortcut-run-status { min-width: 0; color: var(--ui-text); }
.status-message { border: 1px solid var(--ui-border); border-inline-start: 4px solid var(--ui-muted, var(--ui-border)); border-radius: var(--ui-radius-md, 8px); background: var(--ui-surface); padding: 12px; overflow-wrap: anywhere; }
.is-running { border-inline-start-color: var(--ui-accent); }
.is-success { border-inline-start-color: var(--ui-success, #248a58); }
.is-warning { border-inline-start-color: var(--ui-warning, #b7791f); }
.is-error { border-inline-start-color: var(--ui-danger, #c43d3d); }
.detail { margin: 8px 0 0; color: var(--ui-text-2, var(--ui-text)); }
.private-output { margin-top: 10px; }
.reveal-button { min-height: 44px; color: var(--ui-accent); background: transparent; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 6px); padding: 7px 10px; font: inherit; cursor: pointer; }
.reveal-button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.output { max-width: 100%; max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 6px); background: var(--ui-surface, transparent); }
@media (max-width: 360px) { .status-message { padding: 9px; } }
</style>
