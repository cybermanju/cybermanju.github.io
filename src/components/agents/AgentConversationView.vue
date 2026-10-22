<script setup lang="ts">
// CyberManju OS — Agent conversation view (src/components/agents/AgentConversationView.vue).
// Role: Render explicitly public persisted messages and actual compact run states, never internal A2A payloads.
// Exports: AgentConversationView props/events.
// Integrates: Real native Hub DTOs; parent owns persistence, public projection, polling and idempotency.
// Contracts: One recipient, no optimistic delivery, no raw protocol/error payloads, no tool approvals in v1.
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { userVisibleAgentEvents } from '@/utils/agentEventVisibility'
import type { PersistentAgentProfile, AgentConversation, AgentEvent, DelegatedRun } from '@/types/agentWorkspace'
const props = defineProps<{ conversation: AgentConversation; profiles: PersistentAgentProfile[]; events: AgentEvent[]; draft: string; busy: boolean; loading: boolean; error?: string; canDelegate: boolean; hasEarlier: boolean; userVisibleEventIds?: string[]; runStates?: Pick<DelegatedRun, 'id' | 'conversationId' | 'recipientId' | 'status'>[] }>()
const emit = defineEmits<{ back: []; profile: [id: string]; details: []; send: [text: string, recipientId: string | null, complete: () => void]; 'update:draft': [text: string]; refresh: []; earlier: []; delegate: [] }>()
const submitting = ref(false)
const pending = computed(() => props.busy || submitting.value)
const recipientId = ref('')
const log = ref<HTMLElement | null>(null)
watch(() => props.conversation.id, () => { recipientId.value = props.conversation.members.length === 1 ? props.conversation.members[0] : ''; void nextTick(() => { if (log.value) log.value.scrollTop = log.value.scrollHeight }) }, { immediate: true })
watch(() => props.conversation.members, ids => { if (!ids.includes(recipientId.value)) recipientId.value = '' })
const members = computed(() => props.conversation.members.map(id => ({ id, name: props.profiles.find(p => p.id === id)?.name || 'Unavailable Agent' })))
const events = computed(() => userVisibleAgentEvents(props.events, props.conversation.id, props.userVisibleEventIds))
watch(() => events.value[events.value.length - 1]?.id, () => { const el = log.value; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) void nextTick(() => { el.scrollTop = el.scrollHeight }) })
const runStates = computed(() => (props.runStates ?? []).filter(run => run.conversationId === props.conversation.id && ['pending', 'running', 'completed', 'failed'].includes(run.status)))
const canSend = computed(() => !pending.value && !props.loading && !!props.draft.trim() && new TextEncoder().encode(props.draft).length <= 16384 && (!recipientId.value || members.value.some(member => member.id === recipientId.value)))
function agentName(id: string | null) { return id === null ? 'You' : props.profiles.find(profile => profile.id === id)?.name || 'Agent' }
function time(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }
function send() {
  if (!canSend.value) return
  submitting.value = true
  emit('send', props.draft, recipientId.value || null, () => { submitting.value = false })
}
</script>

<template>
  <section class="aw-chat" aria-label="Agent conversation">
    <header class="aw-header aw-chat-header">
      <button type="button" class="aw-icon-button" aria-label="Back to conversations" :disabled="pending" @click="emit('back')"><AppIcon name="solar:alt-arrow-left-bold" :size="22" /></button>
      <button type="button" class="aw-chat-title" :disabled="pending" @click="emit('details')"><strong>{{ conversation.title }}</strong><span>{{ conversation.kind === 'group' ? 'Group' : 'Direct chat' }} · {{ members.length }} Agents</span></button>
      <button type="button" class="aw-icon-button" aria-label="Refresh conversation events" :disabled="loading" @click="emit('refresh')"><AppIcon name="solar:refresh-bold" :size="20" /></button>
    </header>
    <div class="aw-member-strip" aria-label="Conversation members"><button v-for="member in members" :key="member.id" type="button" class="aw-member-chip" :disabled="pending" @click="emit('profile', member.id)"><span class="aw-avatar aw-avatar-small" aria-hidden="true">{{ member.name.slice(0, 1).toLocaleUpperCase() }}</span>{{ member.name }}</button></div>
    <p class="aw-chat-scope">One selected recipient per run; no autonomous group collaboration. Internal A2A protocol stays hidden; shared context never includes private memory or credentials automatically.<span v-if="conversation.kind === 'group'"> Group-wide A2A collaboration is unavailable.</span><span v-else-if="!canDelegate && members.length > 1"> A2A delegation is unavailable on this host.</span></p>
    <div ref="log" class="aw-event-log" role="log" aria-label="Public persisted conversation messages" :aria-busy="loading">
      <button v-if="hasEarlier" type="button" class="aw-button aw-load-earlier" :disabled="loading" @click="emit('earlier')">Load earlier messages</button>
      <p v-if="loading && !events.length" class="aw-empty" role="status">Loading public messages…</p>
      <p v-else-if="!events.length" class="aw-empty">No public messages yet. Raw/internal events are never displayed as chat.</p>
      <article v-for="event in events" :key="event.id" class="aw-event" :class="{ 'aw-event-user': event.senderId === null, 'aw-event-system': event.kind === 'runFailed' }">
        <header><strong>{{ event.senderId === null ? 'You' : agentName(event.senderId) + ' · owner-delegated route' }}</strong><span v-if="event.kind === 'runFailed'" class="aw-row-tag">Run failed</span><time :datetime="event.createdAt">{{ time(event.createdAt) }}</time></header>
        <p v-if="event.recipientId" class="aw-event-route">To {{ agentName(event.recipientId) }}</p>
        <p v-if="event.kind === 'runFailed'" class="aw-event-text">The runtime recorded a failed run. No completion is assumed. Refresh its status before retrying.</p>
        <p v-else class="aw-event-text">{{ event.text }}</p>
        <footer>Persisted event #{{ event.seq }}</footer>
      </article>
      <div v-for="run in runStates" :key="run.id" class="aw-notice" role="status">{{ agentName(run.recipientId) }} · {{ ({ pending: 'Queued by the runtime', running: 'Running', completed: 'Completed', failed: 'Failed' })[run.status] }}</div>
    </div>
    <p v-if="error" class="aw-error aw-chat-error" role="alert">{{ error }}</p>
    <form class="aw-composer" @submit.prevent="send">
      <label class="aw-field">Recipient · one Agent per run<select v-model="recipientId" :disabled="pending"><option value="">No Agent · save message only</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option></select></label>
      <label class="aw-sr-only" :for="`draft-${conversation.id}`">Message to selected Agent</label>
      <textarea :id="`draft-${conversation.id}`" :value="draft" rows="3" placeholder="Write a message…" :disabled="pending" @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)" />
      <div class="aw-composer-actions"><button v-if="canDelegate && conversation.kind === 'direct' && members.length > 1" type="button" class="aw-button" :disabled="pending" @click="emit('delegate')">Delegate A2A</button><span class="aw-composer-note">{{ pending ? 'Waiting for persistence confirmation…' : 'Tool-less · owner-delegated routes, not authenticated Agent authorship.' }}</span><button type="submit" class="aw-button aw-primary" :disabled="!canSend">{{ pending ? 'Sending…' : recipientId ? 'Send to Agent' : 'Save message' }}</button></div>
    </form>
  </section>
</template>
