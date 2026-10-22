<script setup lang="ts">
// CyberManju OS — Agent profile editor (src/components/agents/AgentProfileEditor.vue).
// Role: Edit durable persona fields without exposing provider credentials or inventing hosts/memory.
// Exports: AgentProfileEditor props/events.
// Integrates: Actual Hub ProfileInput; existing AgentConfig references and real supported config ids from parent.
// Contracts: Shared native host, no revision/workspace field, explicit completion; Hub redb is not vault-encrypted/synced.
import { computed, reactive, ref, watch } from 'vue'
import type { AgentConfig } from '@/types'
import type { AgentProfileFields, PersistentAgentProfile } from '@/types/agentWorkspace'
const props = defineProps<{ profile?: PersistentAgentProfile; configs: AgentConfig[]; supportedConfigIds: string[]; busy: boolean; error?: string }>()
const emit = defineEmits<{ save: [fields: AgentProfileFields, complete: () => void]; back: []; advanced: [] }>()
const submitting = ref(false)
const pending = computed(() => props.busy || submitting.value)
const form = reactive({ name: '', personality: '', goals: '', interests: '', knowledge: '', providerConfigId: '' })
watch(() => props.profile, p => {
  Object.assign(form, { name: p?.name ?? '', personality: p?.personality ?? '', goals: p?.goals.join('\n') ?? '', interests: p?.interests.join('\n') ?? '', knowledge: p?.knowledge.join('\n') ?? '', providerConfigId: p?.providerConfigId ?? '' })
}, { immediate: true })
const selectedConfig = computed(() => props.configs.find(c => c.id === form.providerConfigId))
const lines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean)
const bytes = (text: string) => new TextEncoder().encode(text).length
const valid = computed(() => !!form.name.trim() && bytes(form.name) <= 256 && bytes(form.personality) <= 8192 && !!selectedConfig.value && props.supportedConfigIds.includes(form.providerConfigId) && !pending.value && [['goals', 2048], ['interests', 2048], ['knowledge', 4096]].every(([key, limit]) => { const values = lines(form[key as 'goals' | 'interests' | 'knowledge']); return values.length <= 64 && values.every(value => bytes(value) <= Number(limit)) }))
function submit() {
  if (!valid.value) return
  submitting.value = true
  emit('save', { name: form.name.trim(), personality: form.personality, goals: lines(form.goals), interests: lines(form.interests), knowledge: lines(form.knowledge), providerConfigId: form.providerConfigId }, () => { submitting.value = false })
}
</script>

<template>
  <section class="aw-detail" aria-label="Agent profile">
    <header class="aw-header"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Back</button><h1 tabindex="-1">{{ profile ? 'Agent profile' : 'New Agent' }}</h1><span class="aw-row-tag">Persistent</span></header>
    <form class="aw-form" @submit.prevent="submit">
      <div v-if="profile" class="aw-profile-identity"><span class="aw-avatar aw-avatar-large" aria-hidden="true">{{ profile.name.slice(0, 1).toLocaleUpperCase() }}</span><div><h2>{{ profile.name }}</h2><p>Agent ID <code>{{ profile.id }}</code></p><p>Durable profile · not a task or run</p></div></div>
      <p class="aw-notice">All Agents share this native host. Persona and knowledge notes persist; they do not create separate computers, permissions or automatic learning. Never put passwords or API keys here.</p>
      <fieldset :disabled="pending">
        <legend>Identity and instructions</legend>
        <label class="aw-field">Name <span>Up to 256 UTF-8 bytes</span><input v-model="form.name" name="agent-name" required autocomplete="off" /></label>
        <label class="aw-field">Personality <span>Up to 8,192 UTF-8 bytes</span><textarea v-model="form.personality" name="personality" rows="4" placeholder="How should this Agent communicate and approach tasks?" /></label>
        <label class="aw-field">Goals <span>One per line · up to 64 notes, 2,048 bytes each</span><textarea v-model="form.goals" name="goals" rows="3" /></label>
        <label class="aw-field">Interests <span>One per line · up to 64 notes, 2,048 bytes each</span><textarea v-model="form.interests" name="interests" rows="3" /></label>
        <label class="aw-field">Knowledge <span>Profile notes, not automatic memory. Up to 64 notes, 4,096 bytes each.</span><textarea v-model="form.knowledge" name="knowledge" rows="4" /></label>
      </fieldset>
      <fieldset :disabled="pending">
        <legend>Provider and model</legend>
        <label class="aw-field">Provider configuration<select v-model="form.providerConfigId" name="provider-config" required><option disabled value="">Choose a supported existing configuration</option><option v-for="config in configs" :key="config.id" :value="config.id" :disabled="!supportedConfigIds.includes(config.id)">{{ config.name }} · {{ config.providerId }} / {{ config.model }}{{ supportedConfigIds.includes(config.id) ? '' : ' · not available for Hub' }}</option></select></label>
        <p v-if="selectedConfig" class="aw-notice">Model: {{ selectedConfig.model }} · provider: {{ selectedConfig.providerId }}. This references a sealed configuration that other profiles may also use; it is not a separate per-Agent key store.</p>
        <p v-if="!supportedConfigIds.length" class="aw-notice">No supported Hub provider is confirmed. Native Hub v1 supports existing OpenAI- and Anthropic-dialect adapters, not every provider or query-string authentication.</p>
        <button type="button" class="aw-link" @click="emit('advanced')">Manage provider configurations</button>
      </fieldset>
      <p class="aw-notice">Profiles and Hub history use a separate local database. It is not claimed to be encrypted, synced or included in vault export. No tools or implicit private memory are granted to these runs.</p>
      <p v-if="error" class="aw-error" role="alert">{{ error }}</p>
      <footer class="aw-form-footer"><button type="button" class="aw-button" :disabled="pending" @click="emit('back')">Cancel</button><button type="submit" class="aw-button aw-primary" :disabled="!valid">{{ pending ? 'Saving…' : profile ? 'Save profile' : 'Create Agent' }}</button></footer>
    </form>
  </section>
</template>
