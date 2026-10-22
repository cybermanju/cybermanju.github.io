// CyberManju OS — Agent Hub presentation contracts (src/types/agentWorkspace.ts).
// Role: Mirror the actual native Hub DTOs consumed by the controlled mobile screens.
// Exports: AgentProfile, ProfileInput, Conversation, CreateConversation, HubEvent, SendMessage, DelegatedRun, SendReceipt and UI payload aliases.
// Integrates: docs/agent-hub.schema.json and crates/types/src/agent_hub.rs from runtime protocol revision 2.
// Contracts: camelCase, local native owner only, explicit visibility, one recipient; no adapter here.
export interface AgentProfile {
  id: string
  ownerId: string
  name: string
  personality: string
  goals: string[]
  interests: string[]
  knowledge: string[]
  providerConfigId: string
  createdAt: string
  updatedAt: string
}
export interface ProfileInput {
  id?: string | null
  name: string
  personality: string
  goals: string[]
  interests: string[]
  knowledge: string[]
  providerConfigId: string
}
export interface Conversation {
  id: string
  ownerId: string
  kind: 'direct' | 'group'
  title: string
  members: string[]
  createdAt: string
  lastSeq: number
}
export interface CreateConversation { kind: 'direct' | 'group'; title: string; members: string[] }
export interface HubEvent {
  id: string
  conversationId: string
  seq: number
  visibility: 'user' | 'internal'
  kind: 'message' | 'delegation' | 'assistant' | 'runFailed'
  senderId: string | null
  recipientId: string | null
  text: string
  createdAt: string
  runId: string | null
}
export interface SendMessage {
  conversationId: string
  idempotencyKey: string
  senderId?: string | null
  recipientId?: string | null
  text: string
  selectedContext: string[]
  toolGrants: string[]
}
export interface DelegatedRun {
  id: string
  ownerId: string
  conversationId: string
  visibility: 'user' | 'internal'
  senderId: string | null
  recipientId: string
  providerConfigId: string
  profileSnapshot: AgentProfile | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  selectedContext: string[]
  toolGrants: string[]
  input: string
  result: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}
export interface SendReceipt { event: HubEvent; run: DelegatedRun | null }
export type PersistentAgentProfile = AgentProfile
export type AgentConversation = Conversation
export type AgentEvent = HubEvent
export type AgentProfileFields = Omit<ProfileInput, 'id'>
export type ConversationFields = CreateConversation
export type DelegationFields = Pick<SendMessage, 'senderId' | 'recipientId' | 'text' | 'selectedContext' | 'toolGrants'>
