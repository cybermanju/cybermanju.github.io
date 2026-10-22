<script setup lang="ts">
// CyberManju OS — New Agent conversation (src/components/agents/AgentConversationForm.vue).
// Role: Select an explicit owner-scoped group or one- or two-Agent direct conversation.
// Exports: AgentConversationForm props/events.
// Integrates: Agent workspace profiles and runtime conversation creation in parent.
// Contracts: Group requires members; direct supports one or two; group supports up to 16; no implied memory/tool sharing.
import { computed, ref } from 'vue'
import type { PersistentAgentProfile, ConversationFields } from '@/types/agentWorkspace'
const props = defineProps<{ profiles: PersistentAgentProfile[]; busy: boolean; error?: string }>()
const emit = defineEmits<{ create: [fields: ConversationFields, complete: () => void]; back: [] }>()
const submitting = ref(false)
const pending = computed(() => props.busy || submitting.value)
const title = ref('')
const kind = ref<'direct' | 'group'>('direct')
const memberAgentIds = ref<string[]>([])
const valid = computed(() => !!title.value.trim() && new TextEncoder().encode(title.value).length <= 256 && !pending.value && (kind.value === 'direct' ? memberAgentIds.value.length >= 1 && memberAgentIds.value.length <= 2 : memberAgentIds.value.length >= 1 && memberAgentIds.value.length <= 16) && memberAgentIds.value.every(id => props.profiles.some(p => p.id === id)))
function submit() {
  if (!valid.value) return
  submitting.value = true
  emit('create', { title: title.value.trim(), kind: kind.value, members: [...memberAgentIds.value] }, () => { submitting.value = false })
}
</script>

<template>
  <section class="aw-detail" aria-label="New conversation">
    <header class="aw-header"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Back</button><h1 tabindex="-1">New conversation</h1></header>
    <form class="aw-form" @submit.prevent="submit">
      <fieldset :disabled="pending"><legend>Conversation</legend>
        <label class="aw-field">Title<input v-model="title" required name="conversation-title" autocomplete="off" /></label>
        <label class="aw-field">Type<select v-model="kind" name="conversation-kind"><option value="group">Group chat</option><option value="direct">Direct chat · 1–2 Agents</option></select></label>
        <p class="aw-notice">{{ kind === 'direct' ? 'Choose one or two Agents belonging to the local owner.' : 'Choose between one and sixteen Agents.' }} Each run addresses just one selected Agent, even in a group. No transcript, private memories or credentials are included automatically.</p>
      </fieldset>
      <fieldset class="aw-members" :disabled="pending"><legend>Members · {{ memberAgentIds.length }} selected</legend>
        <label v-for="profile in profiles" :key="profile.id" class="aw-member-choice"><input v-model="memberAgentIds" type="checkbox" :value="profile.id" /><span class="aw-avatar" aria-hidden="true">{{ profile.name.slice(0, 1).toLocaleUpperCase() }}</span><span><strong>{{ profile.name }}</strong><small>{{ profile.personality || 'Persistent profile' }}</small></span></label>
        <p v-if="!profiles.length" class="aw-empty">Create an Agent before starting a conversation.</p>
      </fieldset>
      <p v-if="kind === 'direct' && (memberAgentIds.length < 1 || memberAgentIds.length > 2)" class="aw-notice" role="status">A direct chat accepts one or two Agents.</p>
      <p class="aw-notice">Membership is fixed at creation in v1. This is a shared local host, not a remote Agent instance.</p>
      <p v-if="error" class="aw-error" role="alert">{{ error }}</p>
      <footer class="aw-form-footer"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Cancel</button><button type="submit" class="aw-button aw-primary" :disabled="!valid">{{ pending ? 'Creating…' : 'Create conversation' }}</button></footer>
    </form>
  </section>
</template>
