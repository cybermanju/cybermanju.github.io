import { beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  dbDispatch: vi.fn(),
  diskStatus: vi.fn(),
  saveDisk: vi.fn(),
  passphrase: vi.fn(),
}))
vi.mock('@/composables/useWasmBackend', () => ({
  wasmDbDispatch: backend.dbDispatch,
  wasmDiskStatus: backend.diskStatus,
  wasmSaveDisk: backend.saveDisk,
  sessionVaultPassphrase: backend.passphrase,
}))

import {
  LANGUAGE_TEACHER_VOICE_SECRET_ID,
  defaultLanguageTeacherVoiceSettings,
  loadLanguageTeacherVoiceSettings,
  normalizeLanguageTeacherVoiceSettings,
  saveLanguageTeacherVoiceSettings,
  testVoiceStudioTts,
  validateVoiceStudioEndpoint,
} from '@/utils/languageTeacherVoiceSettings'

beforeEach(() => {
  vi.clearAllMocks()
  backend.passphrase.mockReturnValue('test-vault-passphrase')
  backend.diskStatus.mockResolvedValue({ attached: true })
  backend.saveDisk.mockResolvedValue({ attached: true })
  backend.dbDispatch.mockImplementation(async (op: string) => op === 'secrets.list' ? [] : null)
})

describe('Language Teacher provider settings', () => {
  it('stores settings only through the sealed secrets operation and saves the attached local file', async () => {
    const input = {
      ...defaultLanguageTeacherVoiceSettings(),
      geminiApiKey: 'GEMINI-DUMMY-KEY',
      elevenLabsApiKey: 'ELEVEN-DUMMY-KEY',
      elevenLabsAgentId: 'public-agent-id',
      voiceStudioEndpoint: 'https://colab.example.net/prefix/v1/audio/speech',
    }

    await saveLanguageTeacherVoiceSettings(input)

    const write = backend.dbDispatch.mock.calls.find(([op]) => op === 'secrets.create')
    expect(write).toBeDefined()
    const args = write?.[1] as { row: { id: string; kind: string }; value: string; passphrase: string }
    expect(args.row.id).toBe(LANGUAGE_TEACHER_VOICE_SECRET_ID)
    expect(args.row.kind).toBe('note')
    expect(args.passphrase).toBe('test-vault-passphrase')
    expect(JSON.parse(args.value)).toMatchObject({
      geminiApiKey: 'GEMINI-DUMMY-KEY',
      elevenLabsApiKey: 'ELEVEN-DUMMY-KEY',
    })
    expect(backend.saveDisk).toHaveBeenCalledOnce()
  })

  it('loads stored values only via explicit local reveal with the session passphrase', async () => {
    const saved = { ...defaultLanguageTeacherVoiceSettings(), elevenLabsAgentId: 'stored-agent-id' }
    backend.dbDispatch.mockImplementation(async (op: string) => {
      if (op === 'secrets.list') return [{ id: LANGUAGE_TEACHER_VOICE_SECRET_ID, hasValue: true }]
      if (op === 'secrets.reveal') return { value: JSON.stringify(saved) }
      return null
    })

    const loaded = await loadLanguageTeacherVoiceSettings()

    expect(loaded.hasSavedConfig).toBe(true)
    expect(loaded.settings.elevenLabsAgentId).toBe('stored-agent-id')
    expect(backend.dbDispatch).toHaveBeenCalledWith('secrets.reveal', {
      id: LANGUAGE_TEACHER_VOICE_SECRET_ID,
      passphrase: 'test-vault-passphrase',
    })
  })

  it('refuses to save without a passphrase and attached .cybermanju file', async () => {
    backend.passphrase.mockReturnValue('')
    await expect(saveLanguageTeacherVoiceSettings(defaultLanguageTeacherVoiceSettings())).rejects.toThrow(/passphrase/i)
    expect(backend.dbDispatch).not.toHaveBeenCalled()

    backend.passphrase.mockReturnValue('test-vault-passphrase')
    backend.diskStatus.mockResolvedValue({ attached: false })
    await expect(saveLanguageTeacherVoiceSettings(defaultLanguageTeacherVoiceSettings())).rejects.toThrow(/Anexe um arquivo/)
    expect(backend.dbDispatch).not.toHaveBeenCalled()
  })

  it('accepts only a clean HTTPS speech endpoint and rejects URL-borne credentials', () => {
    expect(validateVoiceStudioEndpoint('https://colab.example.net/proxy/v1/audio/speech'))
      .toBe('https://colab.example.net/proxy/v1/audio/speech')
    for (const unsafe of [
      'http://colab.example.net/v1/audio/speech',
      'https://user:password@colab.example.net/v1/audio/speech',
      'https://colab.example.net/v1/audio/speech?token=secret',
      'https://colab.example.net/other/route',
    ]) expect(() => validateVoiceStudioEndpoint(unsafe)).toThrow()
  })

  it('sends an explicit anonymous TTS test and refuses redirects', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]).buffer
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/wav; rate=24000' },
      arrayBuffer: async () => audio,
    } as unknown as Response)) as unknown as typeof fetch & ReturnType<typeof vi.fn>

    const result = await testVoiceStudioTts({
      ...defaultLanguageTeacherVoiceSettings(),
      voiceStudioEndpoint: 'https://colab.example.net/v1/audio/speech',
      voiceStudioModel: 'test-model',
      voiceStudioVoice: 'test-voice',
    }, fetcher)

    expect(result).toEqual({ contentType: 'audio/wav', byteLength: 4 })
    const [url, init] = (fetcher as any).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://colab.example.net/v1/audio/speech')
    expect(init.headers).toEqual({ Accept: 'audio/*, application/octet-stream', 'Content-Type': 'application/json' })
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'test-model', voice: 'test-voice' })
    expect(JSON.stringify(init)).not.toMatch(/token|apiKey|Authorization/i)
  })

  it('rejects the manual test before network access when the URL is unsafe', async () => {
    const fetcher = vi.fn()
    await expect(testVoiceStudioTts({
      ...defaultLanguageTeacherVoiceSettings(),
      voiceStudioEndpoint: 'http://127.0.0.1:3900/v1/audio/speech',
    }, fetcher as unknown as typeof fetch)).rejects.toThrow(/HTTPS/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
