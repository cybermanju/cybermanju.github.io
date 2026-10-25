// CyberManju OS — Agent session import (src/utils/agentSessionImport.ts).
// Role: Validate untrusted transcript files before they enter an agent session store.
// Exports: parseImportedAgentSession.
// Integrates: AgentPanel import flow and AgentSession DTOs.
// Contracts: Bounded transcript, known message roles, server-independent identity, no oversized storage writes.
import type { AgentSession, ChatMessage } from '@/types'

const MAX_IMPORT_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 2_000
const MAX_MESSAGE_BYTES = 1 * 1024 * 1024
const MAX_TOTAL_CONTENT_BYTES = 8 * 1024 * 1024
const MAX_TOOL_INPUT_BYTES = 256 * 1024
const MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'assistant_tool', 'tool'])

function boundedText(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function parseImportedAgentSession(raw: string, id: string, now = new Date().toISOString()): AgentSession {
  if (byteLength(raw) > MAX_IMPORT_BYTES) throw new Error('invalid: session file exceeds the 16 MiB import limit')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid: expected an agent session object')
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.messages)) throw new Error('invalid: session transcript is missing messages')
  if (source.messages.length > MAX_MESSAGES) throw new Error(`invalid: session transcript exceeds ${MAX_MESSAGES} messages`)

  let totalContentBytes = 0
  const messages: ChatMessage[] = source.messages.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`invalid: message ${index + 1} is malformed`)
    const message = item as Record<string, unknown>
    if (typeof message.role !== 'string' || !MESSAGE_ROLES.has(message.role)) throw new Error(`invalid: message ${index + 1} has an unsupported role`)
    if (typeof message.content !== 'string') throw new Error(`invalid: message ${index + 1} has no text content`)
    const contentBytes = byteLength(message.content)
    if (contentBytes > MAX_MESSAGE_BYTES) throw new Error(`invalid: message ${index + 1} exceeds the 1 MiB limit`)
    totalContentBytes += contentBytes
    if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) throw new Error('invalid: transcript content exceeds the 8 MiB limit')

    let toolInput: unknown
    if (message.toolInput !== undefined && message.toolInput !== null) {
      const encoded = JSON.stringify(message.toolInput)
      if (encoded === undefined || byteLength(encoded) > MAX_TOOL_INPUT_BYTES) throw new Error(`invalid: tool input in message ${index + 1} is too large`)
      toolInput = message.toolInput
    }
    return {
      role: message.role,
      content: message.content,
      toolCallId: boundedText(message.toolCallId, '', 512) || null,
      toolName: boundedText(message.toolName, '', 128) || null,
      ...(toolInput === undefined ? {} : { toolInput }),
    }
  })

  const usage = source.usage && typeof source.usage === 'object' && !Array.isArray(source.usage)
    ? source.usage as Record<string, unknown>
    : {}
  const safeCount = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate)
    ? Math.min(1_000_000_000_000, Math.max(0, Math.floor(candidate)))
    : 0
  const firstUserMessage = messages.find(message => message.role === 'user')?.content ?? ''
  return {
    id,
    title: boundedText(source.title, firstUserMessage.slice(0, 80) || 'Imported conversation', 180),
    configId: boundedText(source.configId, '', 256),
    providerId: boundedText(source.providerId, '', 128),
    model: boundedText(source.model, '', 256),
    agentKind: source.agentKind === 'plan' ? 'plan' : 'build',
    workingDir: boundedText(source.workingDir, '', 2_048),
    messages,
    usage: { inputTokens: safeCount(usage.inputTokens), outputTokens: safeCount(usage.outputTokens) },
    createdAt: boundedText(source.createdAt, now, 64) || now,
    updatedAt: now,
  }
}
