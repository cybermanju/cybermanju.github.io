// CyberManju OS — shared Language Teacher voice settings.
// Role: persists voice-provider configuration; Integrates: OS vault and WASM storage services.
import {
  sessionVaultPassphrase,
  wasmDbDispatch,
  wasmDiskStatus,
  wasmSaveDisk,
} from '@/composables/useWasmBackend'

export const LANGUAGE_TEACHER_VOICE_SECRET_ID = 'language-teacher.voice-providers.v1'
const SECRET_TITLE = 'Language Teacher · provedores de voz'
const VOICESTUDIO_SAMPLE = 'This is a manual Language Teacher voice-service test.'
const VOICE_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const

export type VoiceStudioFormat = typeof VOICE_FORMATS[number]

export interface LanguageTeacherVoiceSettings {
  geminiApiKey: string
  elevenLabsApiKey: string
  elevenLabsAgentId: string
  voiceStudioEndpoint: string
  voiceStudioModel: string
  voiceStudioVoice: string
  voiceStudioFormat: VoiceStudioFormat
  voiceStudioSpeed: number
}

export interface LoadedVoiceSettings {
  settings: LanguageTeacherVoiceSettings
  hasSavedConfig: boolean
}

export interface VoiceStudioTestResult {
  contentType: string
  byteLength: number
}

export function defaultLanguageTeacherVoiceSettings(): LanguageTeacherVoiceSettings {
  return {
    geminiApiKey: '',
    elevenLabsApiKey: '',
    elevenLabsAgentId: '',
    voiceStudioEndpoint: '',
    voiceStudioModel: '',
    voiceStudioVoice: '',
    voiceStudioFormat: 'wav',
    voiceStudioSpeed: 1,
  }
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function validateVoiceStudioEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Informe uma URL completa HTTPS terminada em /v1/audio/speech.')
  }
  if (url.protocol !== 'https:') throw new Error('O endpoint remoto precisa usar HTTPS.')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Não inclua credenciais, query string ou fragmento; este painel não envia tokens ao endpoint.')
  }
  if (!/(?:^|\/)v1\/audio\/speech\/?$/.test(url.pathname)) {
    throw new Error('O endpoint precisa terminar em /v1/audio/speech (prefixos de caminho são aceitos).')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  return url.toString().replace(/\/$/, '')
}

export function normalizeLanguageTeacherVoiceSettings(input: Partial<LanguageTeacherVoiceSettings>): LanguageTeacherVoiceSettings {
  const format = VOICE_FORMATS.includes(input.voiceStudioFormat as VoiceStudioFormat)
    ? input.voiceStudioFormat as VoiceStudioFormat
    : 'wav'
  const speed = input.voiceStudioSpeed === undefined ? 1 : Number(input.voiceStudioSpeed)
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error('A velocidade do VoiceStudio deve estar entre 0,25 e 4.')
  }
  const endpoint = boundedText(input.voiceStudioEndpoint, 2048)
  return {
    geminiApiKey: boundedText(input.geminiApiKey, 8192),
    elevenLabsApiKey: boundedText(input.elevenLabsApiKey, 8192),
    elevenLabsAgentId: boundedText(input.elevenLabsAgentId, 180),
    voiceStudioEndpoint: endpoint ? validateVoiceStudioEndpoint(endpoint) : '',
    voiceStudioModel: boundedText(input.voiceStudioModel, 160),
    voiceStudioVoice: boundedText(input.voiceStudioVoice, 160),
    voiceStudioFormat: format,
    voiceStudioSpeed: speed,
  }
}

async function requireEncryptedLocalVault(): Promise<string> {
  const passphrase = sessionVaultPassphrase()
  if (!passphrase) {
    throw new Error('Desbloqueie um arquivo .cybermanju protegido por passphrase antes de salvar ou revelar credenciais.')
  }
  const status = await wasmDiskStatus()
  if (!status.attached) {
    throw new Error('Anexe um arquivo .cybermanju protegido; um vault apenas de sessão não é usado para guardar estas credenciais.')
  }
  return passphrase
}

async function listMetadata(): Promise<Array<Record<string, unknown>>> {
  const rows = await wasmDbDispatch('secrets.list', {})
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
}

export async function loadLanguageTeacherVoiceSettings(): Promise<LoadedVoiceSettings> {
  const passphrase = await requireEncryptedLocalVault()
  const meta = (await listMetadata()).find(row => row.id === LANGUAGE_TEACHER_VOICE_SECRET_ID)
  if (!meta || meta.hasValue !== true) {
    return { settings: defaultLanguageTeacherVoiceSettings(), hasSavedConfig: false }
  }
  const result = await wasmDbDispatch('secrets.reveal', {
    id: LANGUAGE_TEACHER_VOICE_SECRET_ID,
    passphrase,
  }) as { value?: unknown }
  if (typeof result?.value !== 'string') throw new Error('O cofre não retornou a configuração de voz.')
  let parsed: Partial<LanguageTeacherVoiceSettings>
  try {
    parsed = JSON.parse(result.value) as Partial<LanguageTeacherVoiceSettings>
  } catch {
    throw new Error('A configuração de voz salva não está em um formato reconhecido.')
  }
  return {
    settings: normalizeLanguageTeacherVoiceSettings(parsed),
    hasSavedConfig: true,
  }
}

export async function saveLanguageTeacherVoiceSettings(
  input: Partial<LanguageTeacherVoiceSettings>,
): Promise<LanguageTeacherVoiceSettings> {
  const passphrase = await requireEncryptedLocalVault()
  const settings = normalizeLanguageTeacherVoiceSettings(input)
  const existing = (await listMetadata()).find(row => row.id === LANGUAGE_TEACHER_VOICE_SECRET_ID)
  const now = new Date().toISOString()
  const row = {
    id: LANGUAGE_TEACHER_VOICE_SECRET_ID,
    kind: 'note',
    title: SECRET_TITLE,
    username: null,
    url: null,
    category: 'Language Teacher',
    tags: ['language-teacher', 'voice-providers'],
    notes: 'Configuração local selada; os campos Gemini/ElevenLabs ficam inativos sem broker confiável.',
    favorite: false,
    createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : now,
    updatedAt: now,
    hasValue: true,
  }
  await wasmDbDispatch(existing ? 'secrets.update' : 'secrets.create', {
    row,
    value: JSON.stringify(settings),
    passphrase,
  })
  const saved = await wasmSaveDisk()
  if (!saved.attached) throw new Error('A configuração foi selada no banco, mas o arquivo .cybermanju não confirmou o salvamento. Tente salvar o vault novamente.')
  return settings
}

export async function deleteLanguageTeacherVoiceSettings(): Promise<void> {
  await requireEncryptedLocalVault()
  const existing = (await listMetadata()).some(row => row.id === LANGUAGE_TEACHER_VOICE_SECRET_ID)
  if (existing) {
    await wasmDbDispatch('secrets.delete', { id: LANGUAGE_TEACHER_VOICE_SECRET_ID })
  }
  const saved = await wasmSaveDisk()
  if (!saved.attached) throw new Error('O vault não confirmou o salvamento após remover a configuração.')
}

export async function testVoiceStudioTts(
  input: Partial<LanguageTeacherVoiceSettings>,
  fetcher: typeof fetch = fetch,
): Promise<VoiceStudioTestResult> {
  const settings = normalizeLanguageTeacherVoiceSettings(input)
  if (!settings.voiceStudioEndpoint) throw new Error('Configure primeiro o endpoint HTTPS do VoiceStudio.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  const headers = {
    Accept: 'audio/*, application/octet-stream',
    'Content-Type': 'application/json',
  }
  const body: Record<string, string | number> = {
    input: VOICESTUDIO_SAMPLE,
    response_format: settings.voiceStudioFormat,
    speed: settings.voiceStudioSpeed,
  }
  if (settings.voiceStudioModel) body.model = settings.voiceStudioModel
  if (settings.voiceStudioVoice) body.voice = settings.voiceStudioVoice
  try {
    const response = await fetcher(settings.voiceStudioEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`O endpoint respondeu HTTP ${response.status}; confira modelo, voz e CORS.`)
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw new Error('O endpoint respondeu, mas não retornou áudio binário; confira a rota e o formato do serviço.')
    }
    const bytes = await response.arrayBuffer()
    if (!bytes.byteLength) throw new Error('O endpoint retornou um arquivo de áudio vazio.')
    return { contentType, byteLength: bytes.byteLength }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('O endpoint')) throw cause
    if (controller.signal.aborted) throw new Error('O teste do VoiceStudio expirou após 45 segundos.')
    throw new Error('Não foi possível chamar o endpoint VoiceStudio; confira HTTPS, CORS e disponibilidade. Este teste não envia tokens ou cookies; endpoints que exigem autenticação precisam de broker confiável.')
  } finally {
    clearTimeout(timeout)
  }
}
