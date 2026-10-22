<script setup lang="ts">
// CyberManju OS — Shortcut node inspector (src/components/shortcuts/ShortcutNodeEditor.vue).
// Role: Accessible draft fields for real action inputs and declarative predicates.
// Exports: Node inspector with apply and dirty events; no execution or persistence.
// Integrates: Public automation types and bounded JSON validation.
// Contracts: Reject inline credential keys; never evaluate user-entered text.
import { computed, ref, useId, watch } from 'vue'
import { copyJson, LIMITS, type Json, type Predicate, type WorkflowNode } from '@/automation'

const props = defineProps<{ node: WorkflowNode; disabled?: boolean }>()
const emit = defineEmits<{ apply: [node: WorkflowNode]; dirty: [value: boolean] }>()
const uid = useId()
const raw = ref('')
const error = ref('')
const modified = ref(false)
const operator = ref<Predicate['op']>('eq')
const left = ref('true')
const right = ref('true')
const advanced = ref(false)
const stepOp = ref('text.upper')
const scriptText = ref('Olá, mundo')
const binaryOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'] as const
const operatorLabels: Record<string, string> = { eq: 'Igual a', ne: 'Diferente de', gt: 'Maior que', gte: 'Maior ou igual', lt: 'Menor que', lte: 'Menor ou igual', contains: 'Contém', exists: 'Existe', all: 'Todas (AND)', any: 'Alguma (OR)', not: 'Negação (NOT)' }
const operators = [...binaryOperators, 'exists', 'all', 'any', 'not'] as const
const complex = computed(() => ['all', 'any', 'not'].includes(operator.value))
watch(() => props.node, node => {
  error.value = ''; modified.value = false; emit('dirty', false)
  raw.value = node.type === 'action' ? JSON.stringify(node.input, null, 2) : node.type === 'condition' ? JSON.stringify(node.predicate, null, 2) : ''
  if (node.type === 'condition') {
    operator.value = node.predicate.op
    if ('left' in node.predicate) { left.value = JSON.stringify(node.predicate.left); right.value = JSON.stringify(node.predicate.right) }
    if ('value' in node.predicate) left.value = JSON.stringify(node.predicate.value)
    advanced.value = ['all', 'any', 'not'].includes(node.predicate.op)
  } else advanced.value = false
}, { immediate: true })
function changed() { modified.value = true; emit('dirty', true); error.value = '' }
function parse(text: string): Json {
  if (text.length > LIMITS.jsonBytes) throw new Error('too_large')
  return copyJson(JSON.parse(text), LIMITS.outputBytes, true)
}
function apply() {
  error.value = ''
  try {
    let node: WorkflowNode = props.node
    if (node.type === 'action') node = { ...node, input: parse(raw.value) }
    if (node.type === 'condition') {
      let predicate: Predicate
      if (advanced.value || complex.value) predicate = parse(raw.value) as unknown as Predicate
      else if (operator.value === 'exists') predicate = { op: 'exists', value: parse(left.value) }
      else predicate = { op: operator.value as typeof binaryOperators[number], left: parse(left.value), right: parse(right.value) }
      node = { ...node, predicate }
    }
    // The parent validates the whole graph before accepting this candidate.
    emit('apply', node)
  } catch {
    error.value = 'JSON inválido ou credencial inline. Use valores JSON e referências secretRef; nunca cole senhas ou tokens.'
  }
}
function chooseOperator() {
  changed()
  if (complex.value) {
    advanced.value = true
    raw.value = JSON.stringify(operator.value === 'not' ? { op: 'not', predicate: { op: 'eq', left: true, right: true } } : { op: operator.value, predicates: [{ op: 'eq', left: true, right: true }] }, null, 2)
  }
}
function prepareScript() {
  raw.value = JSON.stringify({ steps: [{ id: 'text', op: stepOp.value, args: [scriptText.value] }] }, null, 2)
  changed()
}
</script>

<template>
  <form v-if="node.type !== 'end'" class="node-inspector" :aria-labelledby="`${uid}-title`" @submit.prevent="apply">
    <h4 :id="`${uid}-title`">Configurar {{ node.type === 'condition' ? 'condição' : 'ação' }}</h4>
    <fieldset :disabled="disabled">
      <template v-if="node.type === 'action'">
        <details v-if="node.actionId === 'core.script'" class="script-builder">
          <summary>Montar uma transformação de texto</summary>
          <label :for="`${uid}-text`">Texto de entrada</label>
          <input :id="`${uid}-text`" v-model="scriptText" type="text" maxlength="4096" />
          <label :for="`${uid}-operation`">Operação</label>
          <select :id="`${uid}-operation`" v-model="stepOp">
            <option value="text.upper">MAIÚSCULAS</option><option value="text.lower">minúsculas</option>
            <option value="text.trim">Remover espaços nas pontas</option><option value="value">Manter valor</option>
          </select>
          <button type="button" @click="prepareScript">Usar no JSON abaixo</button>
          <p>Substitui a entrada do editor; aplique para atualizar o nó.</p>
        </details>
        <label :for="`${uid}-json`">Entrada da ação · JSON</label>
        <textarea :id="`${uid}-json`" v-model="raw" :maxlength="LIMITS.jsonBytes" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off" :aria-describedby="`${uid}-help ${uid}-error`" @input="changed" />
        <p :id="`${uid}-help`">Dados, não código. Scripts aceitam steps declarativos; não executam JavaScript ou shell. Credenciais apenas como <code>{"secretRef":"vault.id"}</code>. Não coloque segredos em URLs, texto ou prompts.</p>
        <p v-if="node.expectedRevision !== undefined">Revisão nativa esperada: {{ node.expectedRevision }} (preservada).</p>
      </template>
      <template v-else-if="node.type === 'condition'">
        <label :for="`${uid}-op`">Comparação</label>
        <select :id="`${uid}-op`" v-model="operator" @change="chooseOperator">
          <option v-for="op in operators" :key="op" :value="op">{{ operatorLabels[op] }}</option>
        </select>
        <label v-if="!complex" class="check-label"><input v-model="advanced" type="checkbox" @change="changed" /> Editar predicado completo em JSON</label>
        <template v-if="!advanced && !complex">
          <label :for="`${uid}-left`">{{ operator === 'exists' ? 'Valor a verificar' : 'Valor da esquerda' }} · JSON</label>
          <textarea :id="`${uid}-left`" v-model="left" :maxlength="LIMITS.outputBytes" rows="2" spellcheck="false" @input="changed" />
          <template v-if="operator !== 'exists'">
            <label :for="`${uid}-right`">Valor da direita · JSON</label>
            <textarea :id="`${uid}-right`" v-model="right" :maxlength="LIMITS.outputBytes" rows="2" spellcheck="false" @input="changed" />
          </template>
        </template>
        <template v-else>
          <label :for="`${uid}-predicate`">Predicado completo · JSON</label>
          <textarea :id="`${uid}-predicate`" v-model="raw" :maxlength="LIMITS.outputBytes" rows="7" spellcheck="false" @input="changed" />
        </template>
        <p>Use <code>"texto"</code>, <code>42</code>, <code>true</code> ou um binding como <code>{"$output":{"nodeId":"action-1","path":["last"]}}</code>. Sem conversão implícita de tipos. Um resultado de ramo não executado pode estar ausente; teste com “Existe”.</p>
      </template>
      <p :id="`${uid}-error`" role="alert" class="field-error">{{ error }}</p>
      <button type="submit" :disabled="!modified">Aplicar configuração</button>
    </fieldset>
  </form>
</template>

<style scoped>
.node-inspector { margin-top: 12px; border-top: 1px solid var(--ui-border, #555); padding-top: 12px; }
h4 { font-size: 14px; margin-bottom: 10px; }
fieldset { border: 0; min-width: 0; display: grid; gap: 8px; }
label { font-weight: 600; font-size: 13px; }
input, select, textarea { width: 100%; min-width: 0; padding: 10px; background: var(--ui-bg, #16191f); color: var(--ui-text, #f5f5fa); border: 1px solid var(--ui-border, #60646e); border-radius: 9px; font: inherit; }
textarea { resize: vertical; font-family: ui-monospace, monospace; line-height: 1.5; }
p { font-size: 12px; line-height: 1.6; color: var(--ui-text-2, #bfc5cf); overflow-wrap: anywhere; }
code { font-family: ui-monospace, monospace; }
button { justify-self: start; min-height: 44px; padding: 10px 14px; border: 1px solid var(--ui-border, #60646e); border-radius: 9px; background: var(--ui-surface-2, #252936); color: var(--ui-text, #fff); cursor: pointer; font: inherit; }
button:disabled { opacity: .55; cursor: not-allowed; }
:where(button, input, textarea, select, summary):focus-visible { outline: 3px solid var(--ui-accent, #8aabff); outline-offset: 3px; }
.check-label { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.check-label input { width: 20px; height: 20px; flex-shrink: 0; }
.script-builder { padding: 10px; border: 1px solid var(--ui-border, #555); border-radius: 9px; }
.script-builder[open] { display: grid; gap: 8px; }
summary { cursor: pointer; min-height: 32px; }
.field-error { color: var(--ui-danger, #ff9b9b); }
.field-error:empty { display: none; }
</style>
