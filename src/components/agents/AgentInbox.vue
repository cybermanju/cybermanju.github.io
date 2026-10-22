<script setup lang="ts">
// CyberManju OS — Agent inbox (src/components/agents/AgentInbox.vue).
// Role: Render owner-scoped persistent Agents and member-visible conversations.
// Exports: AgentInbox props/events.
// Integrates: Agent workspace v1 presentation types; runtime data supplied by parent.
// Contracts: No fabricated chats/unread/online status; Agent identity is not a run.
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { PersistentAgentProfile, AgentConversation } from '@/types/agentWorkspace'
const props = defineProps<{ profiles: PersistentAgentProfile[]; conversations: AgentConversation[]; loading: boolean; error?: string; available: boolean }>()
const emit = defineEmits<{ profile: [id: string]; conversation: [id: string]; createAgent: []; createConversation: []; refresh: []; advanced: [] }>()
const query = ref('')
const filter = ref<'all' | 'agents' | 'groups' | 'direct'>('all')
const matches = (text: string) => text.toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim())
const canCreateConversation = computed(() => props.available && !props.loading && props.profiles.length > 0)
const profiles = computed(() => props.profiles.filter(p => matches(`${p.name} ${p.personality}`)))
const conversations = computed(() => props.conversations.filter(c => matches(c.title) && (filter.value === 'all' || filter.value === 'groups' && c.kind === 'group' || filter.value === 'direct' && c.kind === 'direct')))
function memberNames(c: AgentConversation) { return c.members.map(m => props.profiles.find(p => p.id === m)?.name || 'Agent').join(', ') }
</script>

<template>
  <section class="aw-inbox" aria-label="Agents and conversations">
    <header class="aw-header">
      <div><h1 tabindex="-1">Agents</h1><p>Persistent identities. Shared conversations.</p></div>
      <button type="button" class="aw-icon-button" aria-label="Refresh Agents and conversations" :disabled="loading || !available" @click="emit('refresh')"><AppIcon name="solar:refresh-bold" :size="21" /></button>
    </header>
    <div class="aw-create-actions">
      <button type="button" class="aw-button aw-primary" :disabled="!available || loading" @click="emit('createAgent')"><AppIcon name="solar:add-circle-bold" :size="18" /> New Agent</button>
      <button type="button" class="aw-button" :disabled="!canCreateConversation" @click="emit('createConversation')"><AppIcon name="solar:chat-round-dots-bold" :size="18" /> New chat</button>
    </div>
    <label class="aw-search"><AppIcon name="solar:magnifer-bold" :size="18" /><span class="aw-sr-only">Search Agents and conversations</span><input v-model="query" type="search" placeholder="Search Agents and chats" autocomplete="off" /></label>
    <nav class="aw-filters" aria-label="Filter Agents and chats">
      <button v-for="item in ([['all', 'All'], ['agents', 'Agents'], ['groups', 'Groups'], ['direct', 'Direct']] as const)" :key="item[0]" type="button" :aria-pressed="filter === item[0]" @click="filter = item[0]">{{ item[1] }}</button>
    </nav>
    <div v-if="!available" class="aw-state" role="status"><AppIcon name="solar:shield-check-bold" :size="30" /><h2>Persistent Agents are not available on this host</h2><p>This view needs the real multiagent runtime. No profiles or messages are stored by this screen.</p><button type="button" class="aw-button" @click="emit('advanced')">Open existing assistant</button></div>
    <div v-else-if="error" class="aw-state aw-error" role="alert"><h2>Could not load your workspace</h2><p>{{ error }}</p><button type="button" class="aw-button" :disabled="loading" @click="emit('refresh')">Try again</button></div>
    <p v-else-if="loading" class="aw-state" role="status">Loading your Agents and conversations…</p>
    <div v-else class="aw-inbox-scroll">
      <section v-if="filter === 'all' || filter === 'agents'" class="aw-list-section" aria-label="Persistent Agents">
        <h2>YOUR AGENTS <span>{{ profiles.length }}</span></h2>
        <button v-for="profile in profiles" :key="profile.id" type="button" class="aw-row" @click="emit('profile', profile.id)">
          <span class="aw-avatar" aria-hidden="true">{{ profile.name.slice(0, 1).toLocaleUpperCase() }}</span>
          <span class="aw-row-copy"><strong>{{ profile.name }}</strong><span>{{ profile.personality || 'Open profile and configuration' }}</span></span>
          <span class="aw-row-tag">Profile</span>
        </button>
        <p v-if="!profiles.length" class="aw-empty">{{ query ? 'No matching Agents.' : 'Create an Agent with its own identity and configuration.' }}</p>
      </section>
      <section v-if="filter !== 'agents'" class="aw-list-section" aria-label="Conversations">
        <h2>CONVERSATIONS <span>{{ conversations.length }}</span></h2>
        <button v-for="conversation in conversations" :key="conversation.id" type="button" class="aw-row" @click="emit('conversation', conversation.id)">
          <span class="aw-avatar aw-avatar-chat" aria-hidden="true"><AppIcon :name="conversation.kind === 'group' ? 'solar:users-group-rounded-bold' : 'solar:chat-round-dots-bold'" :size="23" /></span>
          <span class="aw-row-copy"><strong>{{ conversation.title }}</strong><span>{{ memberNames(conversation) }}</span></span>
          <span class="aw-row-tag">{{ conversation.kind === 'group' ? 'Group' : 'Direct' }}</span>
        </button>
        <p v-if="!conversations.length" class="aw-empty">{{ query ? 'No matching conversations.' : 'Start a direct conversation or a group. A2A routing is explicit inside a conversation.' }}</p>
      </section>
      <p class="aw-privacy"><AppIcon name="solar:shield-check-bold" :size="15" /> Local native host · one recipient per run · no tools or implicit memory sharing.</p>
      <button type="button" class="aw-link" @click="emit('advanced')">Existing assistant · tools and provider setup</button>
    </div>
  </section>
</template>
