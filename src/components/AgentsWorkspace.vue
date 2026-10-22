<script setup lang="ts">
// CyberManju OS — Agents workspace (src/components/AgentsWorkspace.vue).
// Role: Integrate owner-scoped Agent/chat/profile/A2A screens with existing mobile shell navigation.
// Exports: Controlled presentation props/events and openConversation/reset methods for the real adapter.
// Integrates: Agent screen components; existing AgentPanel; cybermanju:mobile-back event.
// Contracts: Unavailable by default until real runtime exports attach; no fake persistence or API calls.
import { computed, defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentConfig } from '@/types'
import type { PersistentAgentProfile, AgentConversation, AgentEvent, AgentProfileFields, ConversationFields, DelegationFields, DelegatedRun } from '@/types/agentWorkspace'
import { userVisibleAgentEvents } from '@/utils/agentEventVisibility'
import { focusActiveWorkspaceHeading } from '@/utils/agentWorkspaceFocus'
import { useAgentWorkspaceNavigation } from '@/composables/useAgentWorkspaceNavigation'
import AgentInbox from '@/components/agents/AgentInbox.vue'
import AgentProfileEditor from '@/components/agents/AgentProfileEditor.vue'
import AgentConversationForm from '@/components/agents/AgentConversationForm.vue'
import AgentConversationView from '@/components/agents/AgentConversationView.vue'
import AgentDelegationForm from '@/components/agents/AgentDelegationForm.vue'
const LegacyAgentPanel = defineAsyncComponent(() => import('@/components/AgentPanel.vue'))
const props = withDefaults(defineProps<{
  available?: boolean; profiles?: PersistentAgentProfile[]; conversations?: AgentConversation[]; events?: AgentEvent[]; configs?: AgentConfig[];
  loading?: boolean; busy?: boolean; error?: string; canDelegate?: boolean; hasEarlier?: boolean;
  supportedConfigIds?: string[]; ownerScope?: string; userVisibleEventIds?: string[]; runStates?: Pick<DelegatedRun, 'id' | 'conversationId' | 'recipientId' | 'status'>[];
}>(), { available: false, profiles: () => [], conversations: () => [], events: () => [], configs: () => [], loading: false, busy: false, error: '', canDelegate: false, hasEarlier: false, supportedConfigIds: () => [], ownerScope: '', userVisibleEventIds: () => [], runStates: () => [] })
const emit = defineEmits<{
  refresh: []; selectConversation: [id: string]; earlier: [id: string]; refreshEvents: [id: string];
  saveProfile: [fields: AgentProfileFields, profileId: string | undefined, complete: () => void];
  createConversation: [fields: ConversationFields, complete: () => void]; send: [conversationId: string, text: string, recipientId: string | null, complete: () => void];
  delegate: [conversationId: string, fields: DelegationFields, complete: () => void];
}>()
const pendingAction = ref(false)
const working = computed(() => props.busy || pendingAction.value)
let requestEpoch = 0
const nav = useAgentWorkspaceNavigation()
const route = nav.route
const root = ref<HTMLElement | null>(null)
const activeConversationId = ref('')
const activeConversation = computed(() => props.conversations.find(c => c.id === activeConversationId.value))
const activeProfile = computed(() => {
  const current = route.value
  return current.view === 'profile' ? props.profiles.find(p => p.id === current.id) : undefined
})
const members = computed(() => props.profiles.filter(p => activeConversation.value?.members.includes(p.id)))
const visibleEvents = computed(() => userVisibleAgentEvents(props.events, activeConversationId.value, props.userVisibleEventIds))
const formView = ref<'' | 'new-agent' | 'new-chat' | 'delegate'>('')
const draft = computed({ get: () => nav.draftFor(activeConversationId.value), set: value => nav.setDraft(activeConversationId.value, value) })
const isDetail = computed(() => route.value.view !== 'inbox' || !!formView.value)

function openConversation(id: string) {
  if (working.value) return
  formView.value = ''; activeConversationId.value = id
  nav.open({ view: 'conversation', id }); emit('selectConversation', id)
}
function openProfile(id: string) { if (!working.value) { formView.value = ''; nav.open({ view: 'profile', id }) } }
function openForm(view: typeof formView.value) { if (view === 'delegate' && (activeConversation.value?.kind !== 'direct' || !props.canDelegate)) return; if (!working.value) formView.value = view }
function advanced() { if (!working.value) { formView.value = ''; nav.open({ view: 'advanced' }) } }
function back() {
  if (working.value) return
  if (formView.value) formView.value = ''
  else nav.back()
}
function handleMobileBack(event: Event) {
  if ((event as CustomEvent<{ panel?: string }>).detail?.panel !== 'agent' || event.defaultPrevented) return
  if (working.value || formView.value) { event.preventDefault(); if (!working.value) formView.value = ''; return }
  nav.handleMobileBack(event)
}
function reset() { requestEpoch++; pendingAction.value = false; nav.reset(); activeConversationId.value = ''; formView.value = '' }
function profileSaved(id: string, scope: string) { if (scope !== props.ownerScope) return; formView.value = ''; nav.home(); nav.open({ view: 'profile', id }) }
function conversationCreated(id: string, scope: string) { if (scope !== props.ownerScope) return; formView.value = ''; nav.home(); activeConversationId.value = id; nav.open({ view: 'conversation', id }); emit('selectConversation', id) }
function sendConfirmed(conversationId: string, text: string, scope: string) { if (scope === props.ownerScope) nav.clearSubmittedDraft(conversationId, text) }
function operation(complete: () => void, forward: (done: () => void) => void) {
  if (working.value || !props.available) { complete(); return }
  const epoch = ++requestEpoch
  pendingAction.value = true
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    if (epoch === requestEpoch) pendingAction.value = false
    complete()
  }
  try { forward(done) } catch (error) { done(); throw error }
}
function saveProfile(fields: AgentProfileFields, complete: () => void) {
  const id = formView.value === 'new-agent' ? undefined : activeProfile.value?.id
  operation(complete, done => emit('saveProfile', fields, id, done))
}
function createConversation(fields: ConversationFields, complete: () => void) { operation(complete, done => emit('createConversation', fields, done)) }
function delegate(fields: DelegationFields, complete: () => void) { const id = activeConversation.value?.kind === 'direct' && props.canDelegate ? activeConversation.value.id : undefined; if (!id) { complete(); return }; operation(complete, done => emit('delegate', id, fields, done)) }
function send(text: string, recipientId: string | null, complete: () => void) {
  const id = activeConversation.value?.id
  if (!id) { complete(); return }
  operation(complete, done => emit('send', id, text, recipientId, done))
}
watch(() => props.ownerScope, reset)
watch(route, value => {
  if ((value.view === 'conversation' || value.view === 'group') && value.id !== activeConversationId.value) {
    activeConversationId.value = value.id; emit('selectConversation', value.id)
  }
})
watch(() => props.available, available => { if (!available) reset() })
watch([route, formView], () => void nextTick(() => focusActiveWorkspaceHeading(root.value, isDetail.value)))
onMounted(() => window.addEventListener('cybermanju:mobile-back', handleMobileBack))
onBeforeUnmount(() => window.removeEventListener('cybermanju:mobile-back', handleMobileBack))
defineExpose({ openConversation, openProfile, profileSaved, conversationCreated, sendConfirmed, reset })
</script>

<template>
  <div ref="root" class="agent-workspace" :data-detail="isDetail">
    <div v-show="route.view !== 'advanced'" class="aw-inbox-host">
      <AgentInbox :profiles="profiles" :conversations="conversations" :loading="loading" :error="error" :available="available" @profile="openProfile" @conversation="openConversation" @create-agent="openForm('new-agent')" @create-conversation="openForm('new-chat')" @refresh="emit('refresh')" @advanced="advanced" />
    </div>
    <main class="aw-content-host" aria-label="Agent workspace detail">
      <div v-if="route.view === 'advanced'" class="aw-advanced"><header class="aw-header"><button type="button" class="aw-button" @click="back">Back to Agents</button><p>Existing assistant · separate sessions and controls</p></header><LegacyAgentPanel /></div>
      <AgentProfileEditor v-else-if="formView === 'new-agent' || !formView && route.view === 'profile' && activeProfile" :key="formView === 'new-agent' ? 'new' : activeProfile?.id" :profile="formView === 'new-agent' ? undefined : activeProfile" :configs="configs" :supported-config-ids="supportedConfigIds" :busy="working" :error="error" @save="saveProfile" @back="back" @advanced="advanced" />
      <AgentConversationForm v-else-if="formView === 'new-chat'" :profiles="profiles" :busy="working" :error="error" @create="createConversation" @back="back" />
      <AgentDelegationForm v-else-if="formView === 'delegate' && activeConversation && canDelegate" :members="members" :events="visibleEvents" :busy="working" :error="error" @delegate="delegate" @back="back" />
      <section v-else-if="route.view === 'group' && activeConversation" class="aw-detail" aria-label="Conversation info"><header class="aw-header"><button type="button" class="aw-button" @click="back">Back</button><h1 tabindex="-1">Conversation info</h1></header><div class="aw-group-info"><h2>{{ activeConversation.title }}</h2><p class="aw-notice">{{ activeConversation.kind === 'group' ? 'Group chat' : 'Direct chat' }} · {{ activeConversation.members.length }} Agents. Each run addresses one selected member; no implicit transcript, private memory, tools or credentials.</p><button v-for="member in activeConversation.members" :key="member" type="button" class="aw-row" @click="openProfile(member)"><span class="aw-row-copy"><strong>{{ profiles.find(p => p.id === member)?.name || 'Unavailable Agent' }}</strong><span>Persistent Agent · shared native host</span></span></button><p class="aw-empty">Member editing is not offered by this runtime contract.</p></div></section>
      <AgentConversationView v-else-if="route.view === 'conversation' && activeConversation" :conversation="activeConversation" :profiles="members" :events="visibleEvents" :user-visible-event-ids="userVisibleEventIds" :run-states="runStates" v-model:draft="draft" :busy="working" :loading="loading" :error="error" :can-delegate="canDelegate" :has-earlier="hasEarlier" @back="back" @profile="openProfile" @details="nav.open({ view: 'group', id: activeConversation.id })" @send="send" @refresh="emit('refreshEvents', activeConversation.id)" @earlier="emit('earlier', activeConversation.id)" @delegate="openForm('delegate')" />
      <div v-else-if="route.view !== 'inbox'" class="aw-state" role="status"><h1 tabindex="-1">Not available in this scope</h1><p>This Agent or conversation is no longer accessible. No private data is shown.</p><button type="button" class="aw-button" @click="reset">Back to Agents</button></div>
      <div v-else class="aw-state aw-welcome"><h1 tabindex="-1">Your Agent workspace</h1><p>Open an Agent profile or a conversation. Persona notes persist between tool-less runs on this shared native host. Only explicitly selected context is sent; providers and models must have an existing supported adapter.</p></div>
    </main>
  </div>
</template>

<style src="@/styles/agentWorkspace.css"></style>
