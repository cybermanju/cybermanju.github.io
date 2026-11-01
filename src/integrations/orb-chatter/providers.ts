// CyberManju OS — Orb Chatter voice provider contract.
// Role: resolves supported voice providers; Integrates: native OS and browser speech capabilities.
// Orb Chatter compatibility layer for CyberManju OS.
// Upstream architecture reference: Remix ChatterBots, Copyright 2024 Google LLC,
// distributed under Apache-2.0 (see this directory's LICENSE). This file is a
// fresh OS-side provider contract; it does not copy the upstream React client.

export type VoiceProviderId =
  | 'os-browser-agent'
  | 'os-android-agent'
  | 'gemini-live'
  | 'elevenlabs'
  | 'remote-colab'

export type ExternalVoiceProviderId = Exclude<
  VoiceProviderId,
  'os-browser-agent' | 'os-android-agent'
>

export type VoiceProviderImplementation = 'implemented' | 'interface-only'

export interface VoiceProviderDescriptor {
  id: VoiceProviderId
  label: string
  implementation: VoiceProviderImplementation
  input: 'browser-speech' | 'android-native-speech' | 'streaming-audio' | 'remote-audio'
  output: 'browser-speech' | 'android-native-speech' | 'streaming-audio' | 'remote-audio'
  credentials: 'managed-by-os-agent' | 'server-managed-secret'
  summary: string
}

/**
 * Contract for future remote speech/conversation backends. No concrete
 * Gemini Live, ElevenLabs or Colab adapter is shipped in this OS integration.
 * Implementations must keep credentials on a trusted backend, honor AbortSignal,
 * and emit audio/transcript events through the host UI instead of opening the
 * microphone themselves.
 */
export type VoiceProviderEvent =
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'audio'; data: ArrayBuffer; mimeType: string }
  | { type: 'interrupted' }
  | { type: 'error'; message: string }

export interface VoiceProviderSessionContext {
  language: string
  agentConfigId?: string
  signal: AbortSignal
}

export interface VoiceProviderAdapter {
  readonly id: ExternalVoiceProviderId
  /** Endpoint selection and provider secrets stay in the trusted host/backend. */
  connect(context: VoiceProviderSessionContext): Promise<void>
  sendAudio(data: ArrayBuffer, mimeType: string): Promise<void>
  sendText(text: string): Promise<void>
  onEvent(listener: (event: VoiceProviderEvent) => void): () => void
  disconnect(): Promise<void>
}

export const ORB_CHATTER_VOICE_PROVIDERS: readonly VoiceProviderDescriptor[] = [
  {
    id: 'os-browser-agent',
    label: 'Fala do navegador + Agent do OS',
    implementation: 'implemented',
    input: 'browser-speech',
    output: 'browser-speech',
    credentials: 'managed-by-os-agent',
    summary: 'Reconhecimento e síntese do navegador; a resposta passa pelo Agent escolhido no OS.',
  },
  {
    id: 'os-android-agent',
    label: 'Voz nativa Android + Agent do OS',
    implementation: 'implemented',
    input: 'android-native-speech',
    output: 'android-native-speech',
    credentials: 'managed-by-os-agent',
    summary: 'Captura e síntese pelo bridge Android do OS; a resposta passa pelo Agent escolhido no OS.',
  },
  {
    id: 'gemini-live',
    label: 'Gemini Live',
    implementation: 'interface-only',
    input: 'streaming-audio',
    output: 'streaming-audio',
    credentials: 'server-managed-secret',
    summary: 'Contrato reservado para um relay autenticado no servidor; não conectado ao runtime deste OS.',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    implementation: 'interface-only',
    input: 'remote-audio',
    output: 'remote-audio',
    credentials: 'server-managed-secret',
    summary: 'Ponto de extensão sem cliente, endpoint ou backend ElevenLabs implementado; segredo apenas no host confiável.',
  },
  {
    id: 'remote-colab',
    label: 'Serviço remoto / Colab',
    implementation: 'interface-only',
    input: 'remote-audio',
    output: 'remote-audio',
    credentials: 'server-managed-secret',
    summary: 'Ponto de extensão para serviço remoto definido pelo host confiável; não aceita URL nem chave fornecidas pelo cliente e não inclui serviço Colab operacional.',
  },
] as const

const providerById = new Map(ORB_CHATTER_VOICE_PROVIDERS.map(provider => [provider.id, provider]))

export function getVoiceProvider(id: VoiceProviderId): VoiceProviderDescriptor {
  return providerById.get(id)!
}

export interface VoiceRuntimeCapabilities {
  androidNative: boolean
  speechRecognition: boolean
  speechSynthesis: boolean
}

/** Prefer the native Android bridge, otherwise require both browser speech APIs. */
export function resolveVoiceProvider(
  capabilities: VoiceRuntimeCapabilities,
): VoiceProviderDescriptor | null {
  if (capabilities.androidNative) return getVoiceProvider('os-android-agent')
  if (capabilities.speechRecognition && capabilities.speechSynthesis) {
    return getVoiceProvider('os-browser-agent')
  }
  return null
}
