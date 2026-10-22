<script setup lang="ts">
// CyberManju OS — Explicit A2A delegation (src/components/agents/AgentDelegationForm.vue).
// Role: Review owner-delegated sender/recipient, bounded task and selected public context.
// Exports: AgentDelegationForm props/events using actual Hub SendMessage fields.
// Integrates: hub_send_message via parent; only public projection events supplied here.
// Contracts: One recipient/turn, 8 context strings/8192 bytes, no tools/implicit transcript/private data.
import { computed, ref, watch } from 'vue'
import type { PersistentAgentProfile, AgentEvent, DelegationFields } from '@/types/agentWorkspace'
const props = defineProps<{ members: PersistentAgentProfile[]; events: AgentEvent[]; busy: boolean; error?: string }>()
const emit = defineEmits<{ delegate: [fields: DelegationFields, complete: () => void]; back: [] }>()
const submitting = ref(false)
const pending = computed(() => props.busy || submitting.value)
const fromAgentId = ref('')
const toAgentId = ref('')
const task = ref('')
const contextEventIds = ref<string[]>([])
const reviewing = ref(false)
const selectedEvents = computed(() => props.events.filter(event => contextEventIds.value.includes(event.id)))
const selectedContext = computed(() => selectedEvents.value.map(event => event.text))
const bytes = (text: string) => new TextEncoder().encode(text).length
const contextBytes = computed(() => selectedContext.value.reduce((total, text) => total + bytes(text), 0))
const valid = computed(() => !pending.value && !!task.value.trim() && bytes(task.value) <= 16384 && fromAgentId.value !== toAgentId.value && props.members.some(m => m.id === fromAgentId.value) && props.members.some(m => m.id === toAgentId.value) && contextEventIds.value.length <= 8 && contextBytes.value <= 8192 && contextEventIds.value.every(id => props.events.some(event => event.id === id)))
watch([fromAgentId, toAgentId, task, contextEventIds], () => { reviewing.value = false }, { deep: true, flush: 'sync' })
function submit() {
  if (!valid.value) return
  if (!reviewing.value) { reviewing.value = true; return }
  submitting.value = true
  emit('delegate', { senderId: fromAgentId.value, recipientId: toAgentId.value, text: task.value.trim(), selectedContext: [...selectedContext.value], toolGrants: [] }, () => { submitting.value = false })
}
function name(id: string) { return props.members.find(m => m.id === id)?.name || id }
</script>

<template>
  <section class="aw-detail" aria-label="Explicit Agent-to-Agent delegation">
    <header class="aw-header"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Back</button><h1 tabindex="-1">Delegate A2A</h1></header>
    <form class="aw-form" @submit.prevent="submit">
      <p class="aw-notice">The local owner requests one bounded provider turn on behalf of a selected Agent. The sender label is owner-delegated, not authenticated Agent authorship. This is not an autonomous swarm. Only your task and explicitly selected public text are sent; no private memory, files, transcript or credentials.</p>
      <fieldset :disabled="pending"><legend>Route and task</legend>
        <label class="aw-field">On behalf of Agent · owner-delegated<select v-model="fromAgentId" required><option disabled value="">Choose delegated sender label</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option></select></label>
        <label class="aw-field">To Agent<select v-model="toAgentId" required><option disabled value="">Choose recipient</option><option v-for="member in members" :key="member.id" :value="member.id" :disabled="member.id === fromAgentId">{{ member.name }}</option></select></label>
        <label class="aw-field">Task <span>Up to 16,384 UTF-8 bytes</span><textarea v-model="task" required rows="5" placeholder="Describe this Agent's bounded task." /></label>
      </fieldset>
      <fieldset class="aw-context-options" :disabled="pending"><legend>Context · {{ contextEventIds.length }}/8 selected · {{ contextBytes }}/8,192 bytes</legend>
        <label v-for="event in events" :key="event.id" class="aw-context-choice"><input v-model="contextEventIds" type="checkbox" :value="event.id" /><span>#{{ event.seq }}<small>{{ event.text }}</small></span></label>
        <p v-if="!events.length" class="aw-empty">No public messages to share. The task alone will be sent.</p>
      </fieldset>
      <p class="aw-notice">Tool-less execution only. No tool grants will be sent. There are no external-tool approvals or remote hosts in this v1.</p>
      <section v-if="reviewing" class="aw-review" aria-label="Review delegation"><h2>Confirm owner-delegated run</h2><p><strong>{{ name(fromAgentId) }} → {{ name(toAgentId) }}</strong></p><p class="aw-event-text">{{ task }}</p><p>{{ selectedEvents.length }} selected messages · no tools · no implicit private data.</p><div v-for="event in selectedEvents" :key="event.id" class="aw-notice"><strong>Message #{{ event.seq }}</strong><p class="aw-event-text">{{ event.text }}</p></div></section>
      <p v-if="error" class="aw-error" role="alert">{{ error }}</p>
      <footer class="aw-form-footer"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Cancel</button><button type="submit" class="aw-button aw-primary" :disabled="!valid">{{ pending ? 'Starting…' : reviewing ? 'Confirm delegation' : 'Review delegation' }}</button></footer>
    </form>
  </section>
</template>
