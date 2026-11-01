<template>
  <details class="lt-providers">
    <summary>Configurar credenciais locais e teste do VoiceStudio</summary>
    <div class="lt-providers-body">
      <p class="lt-security">
        As chaves ficam num segredo selado do arquivo <code>.cybermanju</code> (Argon2id + ChaCha20) e só são reveladas localmente após desbloqueá-lo. O modo texto/voz do tutor continua usando o Agent do OS; Gemini Live e ElevenLabs Agents não estão ligados a um broker de tokens efêmeros neste build, então as respectivas chaves ficam armazenadas, mas <strong>não são enviadas nem ativam esses providers</strong>.
      </p>
      <div class="lt-fields">
        <label class="lt-field">
          <span>Gemini API key <small>armazenada, não usada no browser</small></span>
          <input v-model="draft.geminiApiKey" type="password" autocomplete="off" spellcheck="false" maxlength="8192" placeholder="Opcional · fica selada no vault" />
        </label>
        <label class="lt-field">
          <span>ElevenLabs API key <small>armazenada, não usada no browser</small></span>
          <input v-model="draft.elevenLabsApiKey" type="password" autocomplete="off" spellcheck="false" maxlength="8192" placeholder="Opcional · fica selada no vault" />
        </label>
        <label class="lt-field">
          <span>ElevenLabs Agent ID <small>identificador público</small></span>
          <input v-model="draft.elevenLabsAgentId" type="text" autocomplete="off" spellcheck="false" maxlength="180" placeholder="Opcional" />
        </label>
        <label class="lt-field lt-field-wide">
          <span>VoiceStudio endpoint <small>HTTPS completo · rota /v1/audio/speech</small></span>
          <input v-model="draft.voiceStudioEndpoint" type="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://seu-host.example/v1/audio/speech" />
        </label>
        <label class="lt-field">
          <span>Modelo <small>conforme seu servidor</small></span>
          <input v-model="draft.voiceStudioModel" type="text" autocomplete="off" maxlength="160" placeholder="Opcional" />
        </label>
        <label class="lt-field">
          <span>Voz <small>conforme seu servidor</small></span>
          <input v-model="draft.voiceStudioVoice" type="text" autocomplete="off" maxlength="160" placeholder="Opcional" />
        </label>
        <label class="lt-field">
          <span>Formato de resposta</span>
          <select v-model="draft.voiceStudioFormat">
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
            <option value="opus">Opus</option>
            <option value="aac">AAC</option>
            <option value="flac">FLAC</option>
            <option value="pcm">PCM</option>
          </select>
        </label>
        <label class="lt-field">
          <span>Velocidade <small>0,25–4</small></span>
          <input v-model.number="draft.voiceStudioSpeed" type="number" min="0.25" max="4" step="0.05" />
        </label>
      </div>
      <p class="lt-warning">
        O botão de teste envia uma frase fixa e os parâmetros TTS ao endpoint HTTPS escolhido, sem chaves, bearer token ou cookies. O host remoto pode registrar a requisição; use somente servidor seu/confiável. O teste exige CORS, não reproduz o áudio e não altera nem fala automaticamente nas aulas. Se seu endpoint exigir autenticação, este painel ainda não pode chamá-lo com segurança; é necessário um broker confiável.
      </p>
      <div class="lt-actions">
        <UiButton size="sm" variant="ghost" icon="solar:refresh-bold" :disabled="busy" @click="reload">Atualizar do vault</UiButton>
        <UiButton size="sm" icon="solar:diskette-bold" :disabled="busy || !vaultReady" @click="save">{{ busy && action === 'save' ? 'Salvando…' : 'Salvar no .cybermanju' }}</UiButton>
        <UiButton size="sm" variant="secondary" icon="solar:volume-loud-bold" :disabled="busy || !canTest" @click="test">
          {{ busy && action === 'test' ? 'Testando…' : 'Testar VoiceStudio' }}
        </UiButton>
      </div>
      <p class="lt-status" :data-error="statusIsError" role="status" aria-live="polite">{{ status }}</p>
      <p v-if="!vaultReady" class="lt-vault-hint">Para salvar ou revelar credenciais, anexe/desbloqueie um arquivo <code>.cybermanju</code> protegido por passphrase na área de contas/vault. O componente não grava chaves em localStorage, kv ou URL.</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import {
  defaultLanguageTeacherVoiceSettings,
  loadLanguageTeacherVoiceSettings,
  saveLanguageTeacherVoiceSettings,
  testVoiceStudioTts,
  type LanguageTeacherVoiceSettings,
} from '@/utils/languageTeacherVoiceSettings'

const draft = reactive<LanguageTeacherVoiceSettings>(defaultLanguageTeacherVoiceSettings())
const busy = ref(false)
const action = ref<'save' | 'test' | ''>('')
const vaultReady = ref(false)
const hasSavedConfig = ref(false)
const status = ref('Verificando o vault local…')
const statusIsError = ref(false)
const isSaved = ref(false)
let applyingLoadedSettings = false
const canTest = computed(() => vaultReady.value && hasSavedConfig.value && isSaved.value && !!draft.voiceStudioEndpoint.trim())
watch(draft, () => {
  if (!applyingLoadedSettings) isSaved.value = false
}, { deep: true, flush: 'sync' })

function applySettings(settings: LanguageTeacherVoiceSettings) {
  applyingLoadedSettings = true
  Object.assign(draft, settings)
  applyingLoadedSettings = false
}

async function reload() {
  busy.value = true
  action.value = ''
  statusIsError.value = false
  status.value = 'Lendo configuração selada…'
  try {
    const loaded = await loadLanguageTeacherVoiceSettings()
    applySettings(loaded.settings)
    vaultReady.value = true
    hasSavedConfig.value = loaded.hasSavedConfig
    isSaved.value = loaded.hasSavedConfig
    status.value = loaded.hasSavedConfig
      ? 'Configuração carregada do segredo local do .cybermanju.'
      : 'Vault protegido disponível; ainda não há configuração salva.'
  } catch (cause) {
    vaultReady.value = false
    hasSavedConfig.value = false
    isSaved.value = false
    statusIsError.value = true
    status.value = cause instanceof Error ? cause.message : 'Não foi possível abrir a configuração local.'
  } finally {
    busy.value = false
  }
}

async function save() {
  busy.value = true
  action.value = 'save'
  statusIsError.value = false
  status.value = 'Selando credenciais e salvando o vault…'
  try {
    const saved = await saveLanguageTeacherVoiceSettings(draft)
    applySettings(saved)
    vaultReady.value = true
    hasSavedConfig.value = true
    isSaved.value = true
    status.value = 'Configuração selada e salva no arquivo .cybermanju.'
  } catch (cause) {
    statusIsError.value = true
    status.value = cause instanceof Error ? cause.message : 'Não foi possível salvar a configuração.'
  } finally {
    busy.value = false
    action.value = ''
  }
}

async function test() {
  if (!canTest.value) return
  busy.value = true
  action.value = 'test'
  statusIsError.value = false
  status.value = 'Enviando o teste manual ao endpoint…'
  try {
    const result = await testVoiceStudioTts(draft)
    status.value = `Endpoint respondeu áudio (${result.contentType}, ${result.byteLength.toLocaleString()} bytes). O áudio não foi reproduzido.`
  } catch (cause) {
    statusIsError.value = true
    status.value = cause instanceof Error ? cause.message : 'O teste do VoiceStudio falhou.'
  } finally {
    busy.value = false
    action.value = ''
  }
}

onMounted(() => { void reload() })
onBeforeUnmount(() => {
  draft.geminiApiKey = ''
  draft.elevenLabsApiKey = ''
})
</script>

<style scoped>
.lt-providers { margin-top: 14px; border: 1px solid var(--ui-border, rgba(255,255,255,.12)); border-radius: 12px; background: color-mix(in srgb, var(--ui-surface, #111318) 82%, transparent); }
.lt-providers summary { padding: 12px 14px; color: var(--ui-text, #f4f5f7); font-size: 12px; font-weight: 750; cursor: pointer; }
.lt-providers-body { display: grid; gap: 11px; padding: 0 14px 14px; }
.lt-security, .lt-warning, .lt-vault-hint, .lt-status { margin: 0; color: var(--ui-text-2, #bac1ca); font-size: 10px; line-height: 1.5; }
.lt-security { padding: 10px; border: 1px solid rgba(100,201,154,.2); border-radius: 8px; background: rgba(100,201,154,.04); }
.lt-warning { padding: 10px; border: 1px solid rgba(225,173,74,.3); border-radius: 8px; color: #efcf8b; background: rgba(225,173,74,.07); }
.lt-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.lt-field { display: grid; gap: 5px; min-width: 0; color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 750; letter-spacing: .04em; }
.lt-field span { display: flex; flex-wrap: wrap; gap: 5px; align-items: baseline; }
.lt-field small { color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 450; letter-spacing: 0; }
.lt-field input, .lt-field select { width: 100%; min-height: 36px; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--ui-border, rgba(255,255,255,.12)); border-radius: 7px; color: var(--ui-text, #f4f5f7); background: var(--ui-surface, #111318); font: inherit; font-size: 11px; letter-spacing: 0; }
.lt-field input:focus, .lt-field select:focus { outline: 2px solid var(--mi-gold, #d9ab57); outline-offset: 1px; }
.lt-field-wide { grid-column: 1 / -1; }
.lt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.lt-status[data-error="true"] { color: #efcf8b; }
.lt-vault-hint code, .lt-security code { color: var(--ui-text, #f4f5f7); }
@media (max-width: 680px) { .lt-fields { grid-template-columns: 1fr; } .lt-field-wide { grid-column: auto; } .lt-actions > * { flex: 1 1 auto; } }
</style>
