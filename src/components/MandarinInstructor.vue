<template>
  <div class="mandarin-app" @keydown="onPanelKeydown">
    <header class="mi-header">
      <div class="mi-heading">
        <p class="mi-eyebrow">CYBERMANJU · CURSO INICIAL DE MANDARIM</p>
        <h1>Mandarim, um som de cada vez.</h1>
        <p class="mi-lede">Um curso inicial de mandarim, guiado pelo material que você enviou. Comece ouvindo, escreva à mão e pratique sem pressa.</p>
      </div>
      <div class="mi-progress-card" aria-label="Progresso do curso">
        <div class="mi-progress-top"><span>Seu percurso</span><strong>{{ completedCount }} / {{ MANDARIN_LESSONS.length }}</strong></div>
        <div class="mi-progress-track" role="progressbar" :aria-valuenow="completedCount" :aria-valuemin="0" :aria-valuemax="MANDARIN_LESSONS.length" aria-label="Aulas concluídas">
          <span :style="{ width: `${courseProgress}%` }" />
        </div>
        <small>{{ courseProgress }}% concluído · guardado no OS</small>
      </div>
    </header>

    <nav class="mi-stage-nav" aria-label="Áreas do curso">
      <button v-for="item in stages" :key="item.id" type="button" class="mi-stage-button" :class="{ active: stage === item.id }" :aria-current="stage === item.id ? 'page' : undefined" @click="setStage(item.id)">
        <AppIcon :name="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </button>
      <span class="mi-save-state" role="status" aria-live="polite">{{ saveState }}</span>
    </nav>

	<div class="mi-workspace">
	  <aside class="mi-lesson-rail" aria-label="Aulas do curso">
	    <section v-for="group in lessonGroups" :key="group.id" class="mi-lesson-group">
	      <p class="mi-section-label">{{ group.title }}</p>
	      <button v-for="lesson in group.lessons" :key="lesson.id" class="mi-lesson-link" :class="{ active: activeLessonId === lesson.id }" type="button" @click="selectLesson(lesson.id)">
	        <span class="mi-lesson-index">{{ String(lesson.sequence).padStart(2, '0') }}</span>
	        <span class="mi-lesson-copy"><strong>{{ lesson.title }}</strong><small>{{ lesson.subtitle }}</small></span>
	        <AppIcon v-if="isComplete(lesson.id)" name="solar:check-circle-bold" :size="17" class="mi-complete-icon" />
	      </button>
	    </section>
	    <div class="mi-rail-note">
          <AppIcon name="solar:shield-check-bold" :size="15" />
          <span>Seu progresso e seus exercícios ficam no vault local do OS; passar para outro aparelho depende da sincronização do vault.</span>
        </div>
      </aside>

      <main class="mi-main" :aria-labelledby="`lesson-${activeLesson.id}`">
        <template v-if="stage === 'learn'">
          <div class="mi-content-head">
            <div>
              <p class="mi-kicker">{{ activeLesson.sourcePages }}</p>
              <h2 :id="`lesson-${activeLesson.id}`">{{ activeLesson.title }}</h2>
              <p class="mi-subtitle">{{ activeLesson.objective }}</p>
            </div>
            <span class="mi-lesson-state" :class="{ done: isComplete(activeLesson.id) }">{{ isComplete(activeLesson.id) ? 'CONCLUÍDA' : 'EM ANDAMENTO' }}</span>
          </div>

          <section v-if="activeLesson.id === 'sounds'" class="mi-tone-hero" aria-label="Quatro tons do mandarim">
            <div class="mi-tone-intro"><span class="mi-pinyin-tag">PINYIN · TONS LEXICAIS</span><p>O mesmo som-base muda de sentido quando muda de tom. Ouça a curva, não tente adivinhar pelo volume.</p></div>
            <div class="mi-tone-ribbons" aria-hidden="true">
              <div v-for="(tone, index) in toneShapes" :key="tone.id" class="mi-tone-ribbon">
                <svg viewBox="0 0 160 72" role="img" :aria-label="tone.label"><path :d="tone.path" /></svg>
                <span>{{ index + 1 }}</span>
              </div>
            </div>
          </section>

	          <div class="mi-concept-grid">
	            <article v-for="(concept, index) in activeLesson.concepts" :key="`${activeLesson.id}-${index}`" class="mi-concept-card" :class="{ 'mi-concept-card--tone': activeLesson.id === 'sounds' }">
              <div class="mi-concept-top"><span>{{ activeLesson.id === 'sounds' ? `TOM ${index + 1}` : `EXPRESSÃO ${String(index + 1).padStart(2, '0')}` }}</span><button type="button" class="mi-icon-button" :aria-label="`Ouvir ${concept.hanzi} ${concept.pinyin}`" title="Ouvir pronúncia" @click="speak(concept.hanzi, 'zh-CN')"><AppIcon name="solar:volume-loud-bold" :size="17" /></button></div>
              <strong class="mi-hanzi" lang="zh-CN">{{ concept.hanzi }}</strong>
              <span class="mi-pinyin">{{ concept.pinyin }}</span>
              <p>{{ concept.meaning }}</p>
              <small v-if="concept.note" class="mi-source-note">{{ concept.note }}</small>
	            </article>
	          </div>
	          <section v-if="activeLesson.examples.length" class="mi-example-section" aria-label="Exemplos de uso">
	            <div class="mi-extra-head"><p class="mi-section-label">EXEMPLO ORIGINAL DO CURSO</p><span>Não é transcrição literal da fonte</span></div>
	            <article v-for="(example, index) in activeLesson.examples" :key="`${activeLesson.id}-example-${index}`" class="mi-example-card">
	              <strong lang="zh-CN">{{ example.text }}</strong><span class="mi-pinyin">{{ example.pinyin }}</span><p>{{ example.translation }}</p>
	            </article>
	          </section>
	          <section v-if="activeLesson.exercises.length > 1" class="mi-exercise-bank" aria-label="Exercício de transferência">
	            <p class="mi-section-label">EXERCÍCIO DE TRANSFERÊNCIA</p><p>{{ activeLesson.exercises[1].prompt }}</p>
	          </section>

	          <section class="mi-practice-callout">
            <div class="mi-callout-icon"><AppIcon name="solar:lightbulb-bolt-bold" :size="20" /></div>
            <div><p class="mi-section-label">FAÇA AGORA</p><p>{{ activeLesson.practicePrompt }}</p></div>
            <UiButton size="sm" icon="solar:pen-bold" @click="setStage('write')">Praticar</UiButton>
          </section>
          <footer class="mi-content-foot"><span>Fonte didática: {{ activeLesson.sourcePages }}. Conteúdo do app resumido; página original não foi copiada.</span><UiButton size="sm" icon="solar:check-circle-bold" :active="reviewed" @click="markReviewed">{{ reviewed ? 'Revisão concluída' : 'Marcar como revisada' }}</UiButton></footer>
        </template>

        <template v-else-if="stage === 'write'">
          <div class="mi-content-head"><div><p class="mi-kicker">ESCREVER E DESENHAR · {{ activeLesson.sourcePages }}</p><h2 :id="`lesson-${activeLesson.id}`">Pratique no seu ritmo</h2><p class="mi-subtitle">Digite a resposta e use a área livre para rascunhar os caracteres com mouse, toque ou caneta.</p></div></div>
          <div class="mi-writing-layout">
            <section class="mi-writing-card">
              <label class="mi-field-label" :for="`writing-${activeLesson.id}`">DESAFIO DE ESCRITA</label>
              <p class="mi-writing-prompt">{{ activeLesson.writingPrompt }}</p>
              <textarea :id="`writing-${activeLesson.id}`" v-model="currentWriting" class="mi-writing-input" rows="5" maxlength="1200" placeholder="Escreva aqui; você também pode inserir caracteres abaixo." spellcheck="false" aria-describedby="writing-count" />
              <div class="mi-writing-bottom"><span id="writing-count">{{ currentWriting.length }} / 1200</span><div class="mi-character-picks" role="group" aria-label="Inserir caracteres de prática"><button v-for="character in writingCharacters" :key="character" type="button" @click="insertCharacter(character)">{{ character }}</button></div></div>
            </section>
            <section class="mi-draw-card" aria-labelledby="draw-title">
              <div class="mi-draw-head"><div><p class="mi-section-label">TRAÇO LIVRE</p><h3 id="draw-title">Área de desenho</h3></div><div class="mi-draw-actions"><UiButton size="xs" variant="ghost" icon="solar:undo-left-round-bold" :disabled="!activeStrokes.length" @click="undoStroke">Desfazer</UiButton><UiButton size="xs" variant="ghost" icon="solar:trash-bin-trash-bold" :disabled="!activeStrokes.length" @click="clearDrawing">Limpar</UiButton></div></div>
              <div class="mi-canvas-wrap"><canvas ref="drawingCanvas" class="mi-drawing-canvas" aria-label="Área de desenho para praticar os caracteres chineses" @pointerdown="onDrawStart" @pointermove="onDrawMove" @pointerup="onDrawEnd" @pointercancel="onDrawEnd" @lostpointercapture="onDrawEnd" /></div>
              <p class="mi-canvas-hint"><AppIcon name="solar:pen-bold" :size="13" /> Desenhe sobre a grade; o traço é salvo no progresso do curso.</p>
            </section>
          </div>
	          <div class="mi-practice-callout"><div class="mi-callout-icon"><AppIcon name="solar:lightbulb-bolt-bold" :size="20" /></div><div><p class="mi-section-label">LEMBRETE</p><p>{{ activeLesson.writing.strokeNotes }}</p><small v-if="activeLesson.writing.coverageNote" class="mi-writing-source-note">{{ activeLesson.writing.coverageNote }}</small></div><UiButton size="sm" variant="ghost" icon="solar:book-bold" @click="setStage('sources')">Ver referências</UiButton></div>
        </template>

        <template v-else-if="stage === 'quiz'">
          <div class="mi-content-head"><div><p class="mi-kicker">REVISÃO RÁPIDA · {{ activeLesson.sourcePages }}</p><h2 :id="`lesson-${activeLesson.id}`">Cheque o que ficou</h2><p class="mi-subtitle">{{ quizQuestions.length }} perguntas curtas para recuperar sem olhar as cartas. Para concluir, acerte pelo menos {{ quizPassingScore }} (2/3).</p></div><span class="mi-quiz-best">Melhor: {{ progress.bestQuizScores[activeLesson.id] ?? 0 }} / {{ quizQuestions.length }}</span></div>
          <form class="mi-quiz-list" @submit.prevent="scoreQuiz">
            <fieldset v-for="(question, qIndex) in quizQuestions" :key="question.id" class="mi-question">
              <legend><span class="mi-question-number">{{ String(qIndex + 1).padStart(2, '0') }}</span>{{ question.prompt }}</legend>
              <label v-for="option in question.options" :key="option.id" class="mi-option" :class="quizOptionClass(question.id, option.id)">
                <input v-model="quizAnswers[question.id]" type="radio" :name="question.id" :value="option.id" :disabled="quizScored" />
                <span>{{ option.label }}</span>
                <AppIcon v-if="quizScored && option.id === question.answerId" name="solar:check-circle-bold" :size="16" />
              </label>
              <p v-if="quizScored" class="mi-answer-explanation">{{ question.explanation }} <span>· fonte {{ question.sourcePages }}</span></p>
            </fieldset>
            <div class="mi-quiz-footer"><p v-if="quizScored" class="mi-quiz-result" role="status" aria-live="polite">{{ quizScore }} / {{ quizQuestions.length }} corretas. {{ quizPass ? (reviewed ? 'Mínimo atingido — aula concluída.' : 'Mínimo atingido — marque a aula como revisada para concluir.') : 'Abaixo do mínimo de 2/3; revise e tente novamente.' }}</p><UiButton size="md" icon="solar:check-read-bold" type="submit" :disabled="!allQuizAnswered || (quizScored && quizPass)">{{ quizScored && quizPass ? 'Aprovado' : quizScored ? 'Tentar novamente' : 'Conferir respostas' }}</UiButton></div>
          </form>
        </template>

        <template v-else-if="stage === 'voice'">
          <div class="mi-content-head"><div><p class="mi-kicker">VOICE LAB · AGENTE ESCOLHIDO NO OS</p><h2 :id="`lesson-${activeLesson.id}`">Converse com o tutor</h2><p class="mi-subtitle">O modo voz usa a ponte de voz existente do OS e o Agent configurado por você; o microfone só liga quando você pede.</p></div><span class="mi-voice-state" :data-state="voice.state.value"><i />{{ voiceLabel }}</span></div>
          <div class="mi-voice-layout">
            <section class="mi-voice-card">
              <div class="mi-voice-setting-row"><label for="mandarin-agent-select">AGENTE PARA ESTA PRÁTICA</label><select id="mandarin-agent-select" v-model="studio.chatConfigId.value" :disabled="voice.active.value || studio.jobActive.value"><option value="">Selecione um Agent</option><option v-for="config in studio.configs.value" :key="config.id" :value="config.id">{{ config.name }} · {{ config.model }}</option></select></div>
              <div class="mi-voice-setting-row"><label for="voice-language">IDIOMA DA FALA</label><select id="voice-language" v-model="progress.voiceLanguage"><option value="zh-CN">Mandarim · zh-CN</option><option value="pt-BR">Português · pt-BR</option></select></div>
              <p class="mi-voice-safety"><AppIcon name="solar:shield-check-bold" :size="15" />Não guardamos áudio. O browser ou o sistema reconhece sua fala; a transcrição entra no progresso local e segue como texto ao provider do Agent. A voz da resposta usa a síntese do dispositivo. Verifique as políticas do serviço de reconhecimento que você usa.</p>
              <p v-if="!voice.supported" class="mi-provider-warning" role="status">Este browser não oferece SpeechRecognition + voz sintetizada. Você ainda pode praticar por texto; o Android pode usar o serviço de voz nativo.</p>
              <div class="mi-voice-controls"><UiButton v-if="!voice.active.value" size="lg" icon="solar:microphone-3-bold" :disabled="!selectedAgentId || studio.jobActive.value || !voice.supported" @click="startVoice">Iniciar conversa por voz</UiButton><template v-else><UiButton size="md" icon="solar:stop-circle-bold" variant="danger" @click="stopVoice">Encerrar voz</UiButton><UiButton v-if="voice.state.value === 'speaking'" size="md" icon="solar:skip-next-bold" variant="secondary" @click="voice.interrupt">Interromper e falar</UiButton></template><UiButton size="md" variant="ghost" icon="solar:settings-bold" @click="wm.open('agent')">Configurar Agents</UiButton></div>
              <p v-if="voice.state.value === 'listening'" class="mi-live-caption" role="status">Estou ouvindo. Fale uma frase em mandarim quando estiver pronto.</p>
              <p v-if="voice.state.value === 'thinking'" class="mi-live-caption" role="status">O tutor está preparando uma resposta…</p>
              <p v-if="voice.state.value === 'speaking'" class="mi-live-caption" role="status">O tutor está falando. Você pode interromper.</p>
              <p v-if="voice.error.value" class="mi-voice-error" role="alert">{{ voice.error.value }}</p>
              <div class="mi-shortcut-grid">
                <div class="mi-shortcut-row"><span><strong>Alternar voz</strong><small>Funciona só nesta aba, com a janela em foco.</small></span><UiButton size="xs" variant="outline" @click="beginShortcutCapture('toggleVoice')">{{ shortcutLabel('toggleVoice') }}</UiButton></div>
                <div class="mi-shortcut-row"><span><strong>Ouvir a frase atual</strong><small>Repete a expressão em foco da aula.</small></span><UiButton size="xs" variant="outline" @click="beginShortcutCapture('replayPhrase')">{{ shortcutLabel('replayPhrase') }}</UiButton></div>
                <p v-if="capturingShortcut" class="mi-capture-message" role="status">Pressione uma combinação de tecla com pelo menos um modificador. Esc cancela.</p>
              </div>
              <p class="mi-shortcut-note">Atalhos são opcionais. O navegador ou o sistema operacional pode reservar certas combinações.</p>
            </section>
            <section class="mi-chat-card" aria-label="Transcrição do tutor do curso">
              <div class="mi-chat-head"><div><p class="mi-section-label">TRANSCRIÇÃO DO CURSO</p><strong>{{ progress.chat.length }} mensagens salvas</strong></div><button type="button" class="mi-icon-button" title="Limpar transcrição do curso" aria-label="Limpar transcrição do curso" :disabled="!progress.chat.length" @click="clearChat"><AppIcon name="solar:trash-bin-trash-bold" :size="16" /></button></div>
              <div ref="chatList" class="mi-chat-list" aria-live="polite">
                <p v-if="!progress.chat.length" class="mi-chat-empty">Comece com “Nǐ hǎo” ou pergunte sobre um dos tópicos da aula.</p>
                <article v-for="line in progress.chat" :key="line.id" class="mi-chat-line" :class="`mi-chat-line--${line.role}`"><span>{{ line.role === 'student' ? 'VOCÊ' : 'TUTOR' }} · {{ line.mode === 'voice' ? 'voz' : 'texto' }}</span><p>{{ line.text }}</p></article>
              </div>
              <form class="mi-chat-compose" @submit.prevent="sendTextPractice"><label class="sr-only" for="mandarin-chat-input">Sua mensagem para o tutor</label><textarea id="mandarin-chat-input" v-model="chatDraft" rows="2" maxlength="800" placeholder="Escreva uma pergunta ou resposta em mandarim…" :disabled="studio.jobActive.value || voice.active.value" /><UiButton size="sm" type="submit" icon="solar:plain-bold" :disabled="!chatDraft.trim() || studio.jobActive.value || voice.active.value">Enviar</UiButton></form>
            </section>
          </div>
          <section class="mi-adapter-list"><div><p class="mi-section-label">PORTAS PARA NOVOS PROVIDERS</p><h3>Uma interface, providers trocáveis</h3></div><article v-for="provider in VOICE_PROVIDER_CATALOG.filter(row => row.id !== 'os-agent')" :key="provider.id" class="mi-adapter"><div><strong>{{ provider.name }}</strong><small>{{ provider.transport }}</small><small>{{ provider.needs }}</small></div><span class="mi-adapter-badge">Host adapter necessário</span><a v-if="provider.url" :href="provider.url" target="_blank" rel="noopener noreferrer">Documentação</a></article><p class="mi-adapter-foot" role="status" aria-live="polite">Rota ativa neste dispositivo: <strong>{{ voice.provider?.label ?? 'indisponível; use o chat por texto' }}</strong>. {{ voice.provider?.summary ?? 'A ponte de voz não é suportada neste dispositivo.' }} Os serviços remotos ainda não estão conectados; seu destino precisa ser definido pelo host confiável. Esta tela não aceita URL de rota nem encaminha chaves informadas pelo cliente.</p></section>
        </template>

        <template v-else>
          <div class="mi-content-head"><div><p class="mi-kicker">FONTES E CRÉDITOS</p><h2 :id="`lesson-${activeLesson.id}`">Material que orienta o curso</h2><p class="mi-subtitle">As fontes foram usadas para montar resumos, objetivos e referências de páginas. PDFs completos e imagens escaneadas não fazem parte do build.</p></div></div>
          <div class="mi-source-list">
	            <article class="mi-source-card"><span class="mi-source-label">CURSO DE MANDARIM · FONTE 1</span><h3>{{ MANDARIN_SOURCES.course.title }}</h3><p>Crédito indicado no material: {{ MANDARIN_SOURCES.course.publisher }}. Mapeado do contexto e pronúncia às folhas de escrita: pp. 1–56 impressas; as referências de cada aula também mostram o número físico do PDF.</p><p>{{ MANDARIN_SOURCES.course.note }}</p></article>
	            <article class="mi-source-card"><span class="mi-source-label">CURSO DE MANDARIM · FONTE 2</span><h3>{{ MANDARIN_SOURCES.reader.title }}</h3><p>{{ MANDARIN_SOURCES.reader.publisher }}. Sequência do sumário: Lições 0–20, leituras de apoio e índices; as páginas são citadas sem copiar as leituras ou exercícios completos.</p><p>{{ MANDARIN_SOURCES.reader.note }}</p></article>
	            <article class="mi-source-card"><span class="mi-source-label">COBERTURA E LIMITES</span><h3>{{ MANDARIN_CORPUS.coverage.physicalPdfPages }} páginas com registro individual</h3><p>O índice inclui {{ MANDARIN_CORPUS.coverage.sourcePageCounts.shangrila }} páginas do curso Shangrila e {{ MANDARIN_CORPUS.coverage.sourcePageCounts.reader }} do livro do aluno. Isso é cobertura de inventário, não transcrição integral.</p><p v-for="(limitation, index) in MANDARIN_CORPUS.limitations" :key="`limitation-${index}`">{{ limitation }}</p></article>
            <article class="mi-source-card"><span class="mi-source-label">VOICE LOOP · REFERÊNCIA TÉCNICA</span><h3>{{ MANDARIN_SOURCES.voice.title }}</h3><p>{{ MANDARIN_SOURCES.voice.publisher }} · {{ MANDARIN_SOURCES.voice.license }}. O projeto não copia arquivos do ZIP recebido. O OS usa VozPonte e o driver de Agents existentes.</p><p>{{ MANDARIN_SOURCES.voice.note }}</p></article>
            <div class="mi-source-links"><a href="https://ai.google.dev/gemini-api/docs/live-api" target="_blank" rel="noopener noreferrer">Gemini Live API · tokens efêmeros e WebSocket ↗</a><a href="https://developers.openai.com/api/docs/guides/realtime" target="_blank" rel="noopener noreferrer">OpenAI Realtime · WebRTC e client secrets ↗</a><a href="https://elevenlabs.io/docs/eleven-agents/libraries/java-script" target="_blank" rel="noopener noreferrer">ElevenLabs Agents · WebRTC e tokens de conversa ↗</a></div>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
// CyberManju OS — MandarinInstructor (src/components/MandarinInstructor.vue).
// Role: integrated Mandarin learning surface with local exercises and the OS voice loop.
// Exports: window component.
// Integrates: Panel/window registry, useVault, useStudioAgent, VozPonte, source-attributed course data.
// Contracts: never persists provider API keys; uploaded PDFs are summarized/cited, not redistributed.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { useWindowManager } from '@/composables/useWindowManager'
import { useWindowUi } from '@/composables/useWindowUi'
import { useStudioAgent } from '@/composables/useStudioAgent'
import { useVoiceCall } from '@/composables/useVoiceCall'
import { vaultGetJson, vaultSetJson, vaultBackend } from '@/composables/useVault'
import {
  COURSE_PROGRESS_KEY,
  MANDARIN_LESSONS,
  MANDARIN_QUIZ,
  MANDARIN_CORPUS,
  MANDARIN_SOURCES,
  VOICE_PROVIDER_CATALOG,
  buildTutorQuizContext,
  canFinishLesson,
  defaultMandarinProgress,
  getQuizPassingScore,
  isLessonId,
  isQuizCorrect,
  updateBestScore,
  type CourseChatLine,
  type CourseStroke,
  type KeyboardBinding,
  type LessonId,
  type MandarinProgress,
  type QuizQuestion,
  type CourseStage,
  type VoiceLanguage,
} from '@/utils/mandarinCourse'

const wm = useWindowManager()
const windowUi = useWindowUi()
const studio = useStudioAgent()
const progress = ref<MandarinProgress>(defaultMandarinProgress())
const hydrated = ref(false)
const saveState = ref('Carregando progresso…')
const stage = ref<CourseStage>('learn')
const activeLessonId = computed(() => progress.value.activeLessonId)
const activeLesson = computed(() => MANDARIN_LESSONS.find(row => row.id === activeLessonId.value) ?? MANDARIN_LESSONS[0])
const lessonGroups = [
  { id: 'shangrila-m1', title: 'SHANGRILA · MÓDULO 1', lessons: MANDARIN_LESSONS.filter(lesson => lesson.moduleId === 'shangrila-m1') },
  { id: 'contemporary', title: 'CHINÊS CONTEMPORÂNEO · LIÇÕES 0–20', lessons: MANDARIN_LESSONS.filter(lesson => lesson.moduleId === 'contemporary') },
]
const quizQuestions = computed(() => MANDARIN_QUIZ[activeLessonId.value])
const reviewed = ref(false)
const quizAnswers = ref<Record<string, string>>({})
const quizScored = ref(false)
const quizScore = ref(0)
const quizPassingScore = computed(() => getQuizPassingScore(quizQuestions.value.length))
const quizPass = computed(() => quizScored.value && quizScore.value >= quizPassingScore.value)
const allQuizAnswered = computed(() => quizQuestions.value.every(question => !!quizAnswers.value[question.id]))
const chatDraft = ref('')
const chatList = ref<HTMLElement | null>(null)
const drawingCanvas = ref<HTMLCanvasElement | null>(null)
const saveRevision = ref(0)
const courseProgress = computed(() => Math.round((completedCount.value / MANDARIN_LESSONS.length) * 100))
const completedCount = computed(() => MANDARIN_LESSONS.filter(lesson => isComplete(lesson.id)).length)
const currentWriting = computed({
  get: () => progress.value.writing[activeLessonId.value] ?? '',
  set: (value: string) => { progress.value.writing[activeLessonId.value] = value },
})
const activeStrokes = computed(() => progress.value.drawings[activeLessonId.value] ?? [])
const selectedAgentId = computed(() => studio.chatConfigId.value)
const stages: Array<{ id: CourseStage; label: string; icon: string }> = [
  { id: 'learn', label: 'Aprender', icon: 'solar:book-bold' },
  { id: 'write', label: 'Escrever', icon: 'solar:pen-bold' },
  { id: 'quiz', label: 'Revisar', icon: 'solar:check-read-bold' },
  { id: 'voice', label: 'Falar', icon: 'solar:microphone-3-bold' },
  { id: 'sources', label: 'Fontes', icon: 'solar:document-text-bold' },
]
const toneShapes = [
  { id: '1', label: 'Primeiro tom, nivelado', path: 'M10 16 L150 16' },
  { id: '2', label: 'Segundo tom, ascendente', path: 'M10 58 C54 54 92 35 150 14' },
  { id: '3', label: 'Terceiro tom, baixo e curvo', path: 'M10 19 C44 65 95 66 150 14' },
  { id: '4', label: 'Quarto tom, descendente', path: 'M10 14 C62 24 107 45 150 58' },
]
const writingCharacters = computed(() => {
  const characters = activeLesson.value.writing.characters
  return characters.length ? characters : activeLesson.value.vocabulary.slice(0, 8).map(term => term.hanzi)
})
const voiceLabel = computed(() => ({ idle: 'PRONTA', listening: 'OUVINDO', thinking: 'PENSANDO', speaking: 'FALANDO', muted: 'MUTADA', error: 'ERRO' }[voice.state.value]))
const voice = useVoiceCall(sendVoicePrompt, () => progress.value.voiceLanguage)
const capturingShortcut = ref<keyof MandarinProgress['shortcuts'] | ''>('')

let saveTimer: ReturnType<typeof setTimeout> | null = null
let drawingObserver: ResizeObserver | null = null
let liveStroke: { points: Array<{ x: number; y: number }> } | null = null
let canvasPointer: number | null = null
let chatSendBusy = false

function isComplete(id: LessonId): boolean {
  return canFinishLesson(id, progress.value.completedLessons, progress.value.bestQuizScores)
}

function setStage(next: CourseStage) {
  if (voice.active.value && next !== 'voice') stopVoice()
  capturingShortcut.value = ''
  stage.value = next
  if (next === 'write') void nextTick(setupCanvas)
}

function selectLesson(id: LessonId) {
  if (voice.active.value) stopVoice()
  progress.value.activeLessonId = id
  reviewed.value = progress.value.completedLessons.includes(id)
  quizAnswers.value = {}
  quizScored.value = false
  quizScore.value = 0
  liveStroke = null
  if (stage.value === 'write') void nextTick(setupCanvas)
}

function markReviewed() {
  reviewed.value = true
  if (!progress.value.completedLessons.includes(activeLessonId.value)) {
    progress.value.completedLessons.push(activeLessonId.value)
  }
  saveState.value = 'Aula marcada como revisada'
}

function scoreQuiz() {
  if (quizScored.value) {
    quizAnswers.value = {}
    quizScored.value = false
    quizScore.value = 0
    return
  }
  if (!allQuizAnswered.value) return
  quizScore.value = quizQuestions.value.reduce((score, question) => score + Number(isQuizCorrect(question, quizAnswers.value[question.id])), 0)
  quizScored.value = true
  progress.value.bestQuizScores = updateBestScore(progress.value.bestQuizScores, activeLessonId.value, quizScore.value, quizQuestions.value.length)
  if (reviewed.value && quizPass.value && !progress.value.completedLessons.includes(activeLessonId.value)) {
    progress.value.completedLessons.push(activeLessonId.value)
  }
  saveState.value = quizPass.value ? 'Mínimo de 2/3 atingido — nota salva' : 'Mínimo de 2/3 não atingido — revise e tente de novo'
}

function quizOptionClass(questionId: string, optionId: string) {
  if (!quizScored.value) return quizAnswers.value[questionId] === optionId ? 'selected' : ''
  const question = quizQuestions.value.find(row => row.id === questionId)
  return optionId === question?.answerId ? 'correct' : quizAnswers.value[questionId] === optionId ? 'incorrect' : ''
}

function speak(text: string, lang: VoiceLanguage) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    saveState.value = 'Síntese de voz indisponível neste dispositivo'
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.84
  utterance.onend = () => { saveState.value = 'Pronúncia concluída' }
  utterance.onerror = () => { saveState.value = 'Pronúncia não disponível neste dispositivo' }
  window.speechSynthesis.speak(utterance)
}

function speakCurrentPhrase() {
  const phrase = activeLesson.value.examples.find(example => example.kind === 'sentence')?.text || activeLesson.value.vocabulary[0]?.hanzi
  if (phrase) speak(phrase, 'zh-CN')
}

function insertCharacter(value: string) {
  const start = document.querySelector<HTMLTextAreaElement>(`#writing-${activeLessonId.value}`)
  if (!start) {
    currentWriting.value += value
    return
  }
  const from = start.selectionStart
  const to = start.selectionEnd
  currentWriting.value = `${currentWriting.value.slice(0, from)}${value}${currentWriting.value.slice(to)}`
  void nextTick(() => {
    start.focus()
    const cursor = from + value.length
    start.setSelectionRange(cursor, cursor)
  })
}

function setupCanvas() {
  const canvas = drawingCanvas.value
  if (!canvas || typeof ResizeObserver === 'undefined' && typeof window === 'undefined') return
  drawingObserver?.disconnect()
  drawingObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(renderCanvas)
  if (drawingObserver) drawingObserver.observe(canvas)
  renderCanvas()
}

function renderCanvas() {
  const canvas = drawingCanvas.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.round(rect.width * dpr)
  const height = Math.round(rect.height * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, rect.width, rect.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 4
  const accent = getComputedStyle(canvas).getPropertyValue('--ui-accent').trim()
  context.strokeStyle = accent || '#d99b43'
  for (const path of activeStrokes.value) drawStroke(context, path.points, rect.width, rect.height)
  if (liveStroke) drawStroke(context, liveStroke.points, rect.width, rect.height)
}

function drawStroke(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, width: number, height: number) {
  if (!points.length) return
  context.beginPath()
  context.moveTo(points[0].x * width, points[0].y * height)
  for (const point of points.slice(1)) context.lineTo(point.x * width, point.y * height)
  if (points.length === 1) context.lineTo(points[0].x * width + 0.5, points[0].y * height + 0.5)
  context.stroke()
}

function drawSegment(previous: { x: number; y: number }, next: { x: number; y: number }) {
  const canvas = drawingCanvas.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 4
  context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ui-accent').trim() || '#d99b43'
  context.beginPath()
  context.moveTo(previous.x * rect.width, previous.y * rect.height)
  context.lineTo(next.x * rect.width, next.y * rect.height)
  context.stroke()
}

function pointFromEvent(event: PointerEvent) {
  const bounds = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
}

function onDrawStart(event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  const canvas = event.currentTarget as HTMLCanvasElement
  canvasPointer = event.pointerId
  try { canvas.setPointerCapture(event.pointerId) } catch { /* capture is optional */ }
  liveStroke = { points: [pointFromEvent(event)] }
  renderCanvas()
}

function onDrawMove(event: PointerEvent) {
  if (!liveStroke || event.pointerId !== canvasPointer) return
  const next = pointFromEvent(event)
  const prev = liveStroke.points[liveStroke.points.length - 1]
  if (Math.hypot(next.x - prev.x, next.y - prev.y) < 0.002 || liveStroke.points.length >= 300) return
  liveStroke.points.push(next)
  drawSegment(prev, next)
}

function onDrawEnd(event: PointerEvent) {
  if (!liveStroke || (canvasPointer !== null && event.pointerId !== canvasPointer)) return
  const finished: CourseStroke = { points: liveStroke.points.slice() }
  if (finished.points.length && activeStrokes.value.length < 80) {
    progress.value.drawings[activeLessonId.value] = [...activeStrokes.value, finished]
  }
  liveStroke = null
  canvasPointer = null
  renderCanvas()
}

function undoStroke() {
  progress.value.drawings[activeLessonId.value] = activeStrokes.value.slice(0, -1)
  void nextTick(renderCanvas)
}

function clearDrawing() {
  progress.value.drawings[activeLessonId.value] = []
  liveStroke = null
  void nextTick(renderCanvas)
}

function safeBinding(value: unknown, fallback: KeyboardBinding): KeyboardBinding {
  if (!value || typeof value !== 'object') return { ...fallback }
  const row = value as Partial<KeyboardBinding>
  if (typeof row.code !== 'string' || row.code.length > 40) return { ...fallback }
  return { code: row.code, alt: row.alt === true, ctrl: row.ctrl === true, meta: row.meta === true, shift: row.shift === true }
}

function normalizeProgress(input: Partial<MandarinProgress> | null | undefined): MandarinProgress {
  const base = defaultMandarinProgress()
  if (!input || typeof input !== 'object') return base
  const rawScores = input.bestQuizScores && typeof input.bestQuizScores === 'object' ? input.bestQuizScores : {}
  const bestQuizScores: MandarinProgress['bestQuizScores'] = {}
  const rawWriting = input.writing && typeof input.writing === 'object' ? input.writing : {}
  const writing: MandarinProgress['writing'] = {}
  const rawDrawings = input.drawings && typeof input.drawings === 'object' ? input.drawings : {}
  const drawings: MandarinProgress['drawings'] = {}
  for (const lesson of MANDARIN_LESSONS) {
    const score = rawScores[lesson.id]
    if (typeof score === 'number' && Number.isFinite(score)) bestQuizScores[lesson.id] = Math.max(0, Math.min(MANDARIN_QUIZ[lesson.id].length, Math.floor(score)))
    const writingValue = rawWriting[lesson.id]
    if (typeof writingValue === 'string') writing[lesson.id] = writingValue.slice(0, 1200)
    const rawStrokes = rawDrawings[lesson.id]
    if (Array.isArray(rawStrokes)) {
      drawings[lesson.id] = rawStrokes.slice(-80).flatMap(rawStroke => {
        const points = (rawStroke as CourseStroke | undefined)?.points
        if (!Array.isArray(points)) return []
        const safePoints = points.slice(0, 300).flatMap(point => {
          if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return []
          return [{ x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) }]
        })
        return safePoints.length ? [{ points: safePoints }] : []
      })
    }
  }
  const rawSessions = input.chatSessionIds && typeof input.chatSessionIds === 'object' ? input.chatSessionIds : {}
  const chatSessionIds = Object.fromEntries(Object.entries(rawSessions).filter(([id, value]) => id.length <= 120 && typeof value === 'string' && value.length <= 160))
  const chat = Array.isArray(input.chat) ? input.chat.flatMap((line): CourseChatLine[] => {
    if (!line || typeof line.id !== 'string' || (line.role !== 'student' && line.role !== 'tutor') || typeof line.text !== 'string') return []
    return [{ id: line.id.slice(0, 80), role: line.role, text: line.text.slice(0, 6000), mode: line.mode === 'text' ? 'text' : 'voice', createdAt: Number.isFinite(line.createdAt) ? line.createdAt : Date.now() }]
  }).slice(-60) : []
  return {
    ...base,
    ...input,
    activeLessonId: isLessonId(input.activeLessonId) ? input.activeLessonId : base.activeLessonId,
    completedLessons: Array.isArray(input.completedLessons) ? [...new Set(input.completedLessons.filter(isLessonId))] : [],
    bestQuizScores,
    writing,
    drawings,
    chatSessionIds,
    chat,
    voiceLanguage: input.voiceLanguage === 'pt-BR' ? 'pt-BR' : 'zh-CN',
    shortcuts: {
      toggleVoice: safeBinding(input.shortcuts?.toggleVoice, base.shortcuts.toggleVoice),
      replayPhrase: safeBinding(input.shortcuts?.replayPhrase, base.shortcuts.replayPhrase),
    },
  }
}

async function hydrateProgress() {
  try {
    const loaded = await vaultGetJson<Partial<MandarinProgress>>(COURSE_PROGRESS_KEY)
    progress.value = normalizeProgress(loaded)
    reviewed.value = progress.value.completedLessons.includes(activeLessonId.value)
    saveState.value = `${vaultBackend() === 'kv' ? 'Vault' : 'Este dispositivo'} · progresso carregado`
  } catch (cause) {
    saveState.value = `Não foi possível ler o vault: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    hydrated.value = true
  }
}

function scheduleSave() {
  if (!hydrated.value) return
  saveRevision.value++
  const revision = saveRevision.value
  saveState.value = 'Salvando…'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const snapshot: MandarinProgress = { ...progress.value, updatedAt: new Date().toISOString() }
      await vaultSetJson(COURSE_PROGRESS_KEY, snapshot)
      if (revision === saveRevision.value) saveState.value = `${vaultBackend() === 'kv' ? 'Vault' : 'Este dispositivo'} · salvo`
    } catch (cause) {
      if (revision === saveRevision.value) saveState.value = `Falha ao salvar: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }, 350)
}

function newChatLine(role: CourseChatLine['role'], text: string, mode: CourseChatLine['mode']): CourseChatLine {
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role, text: text.slice(0, 6000), mode, createdAt: Date.now() }
}

function tutorPrompt(text: string) {
  const passingScore = getQuizPassingScore(activeLesson.value.questions.length)
  const bestScore = progress.value.bestQuizScores[activeLessonId.value] ?? 0
  const solutionsUnlocked = passingScore > 0 && bestScore >= passingScore
  return [
    'Você é o tutor conversacional de um curso estruturado de mandarim, para alguém que estuda em português brasileiro.',
    `Módulo: ${activeLesson.value.moduleTitle}. Lição ${activeLesson.value.sequence}: ${activeLesson.value.title}. Objetivo: ${activeLesson.value.objective}`,
    `Referência consultável: ${activeLesson.value.sourcePages}. Trate-a como localização na fonte, não como texto reproduzido.`,
    `Vocabulário autorizado para esta aula: ${activeLesson.value.vocabulary.map(term => `${term.hanzi} (${term.pinyin}): ${term.meaning}`).join('; ')}.`,
    `Exemplo(s) original(is): ${activeLesson.value.examples.map(example => `${example.text} (${example.pinyin}) = ${example.translation}`).join('; ')}.`,
    `Exercícios propostos: ${activeLesson.value.exercises.map(exercise => exercise.prompt).join(' | ')}.`,
    `Desafio de escrita: ${activeLesson.value.writing.prompt} Modelos para praticar: ${activeLesson.value.writing.characters.join('、')}. ${activeLesson.value.writing.strokeNotes}`,
    buildTutorQuizContext(activeLesson.value.questions, solutionsUnlocked),
    activeLesson.value.agentGuidance,
    'Responda com gentileza e precisão: use caracteres simplificados, pinyin com tons e explicação curta em português. Use as perguntas para recuperação ativa, uma de cada vez, sem revelar o gabarito antes de o estudante tentar; depois explique a resposta correta. Corrija uma coisa por vez. Se a resposta não estiver sustentada pelo resumo, diga que o estudante deve consultar a fonte que pode usar; não invente citação nem reconstrua diálogo ou exercício do livro. Não peça dados pessoais, não acione ferramentas e não altere arquivos.',
    `Mensagem do estudante (${progress.value.voiceLanguage === 'zh-CN' ? 'a fala pode estar em mandarim' : 'a fala pode estar em português'}):`,
    text.trim(),
  ].join('\n\n')
}

function waitForTutorReply(startIndex: number, sessionId: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unwatch = () => {}
    const timeout = setTimeout(() => finish(new Error('O tutor demorou demais. A conversa segue salva em Agents.')), 120_000)
    const stop = () => finish(new DOMException('Voz interrompida.', 'AbortError'))
    function finish(error?: Error, answer?: string) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unwatch()
      signal?.removeEventListener('abort', stop)
      if (error) reject(error)
      else resolve(answer ?? '')
    }
    function check() {
      if (signal?.aborted) { stop(); return }
      if (studio.pendingApproval.value && studio.activeJob.value?.sessionId === sessionId) {
        finish(new Error('O Agent está aguardando uma autorização. Abra Agents para revisar a solicitação.'))
        return
      }
      const session = studio.viewing.value
      if (!session || session.id !== sessionId) return
      const reply = session.messages.slice(startIndex).reverse().find(row => row.role === 'assistant' && row.content.trim())
      if (reply && !studio.jobActive.value) { finish(undefined, reply.content); return }
      const status = studio.activeJob.value?.status
      if (status === 'error' || status === 'cancelled') {
        finish(new Error(studio.jobError.value || studio.activeJob.value?.error || 'O Agent não concluiu a resposta.'))
      }
      if (!studio.jobActive.value && !reply && session.messages.length > startIndex) {
        finish(new Error('Não chegou uma resposta de texto do Agent; veja o transcript em Agents.'))
      }
    }
    unwatch = watch(() => [studio.viewing.value?.id, studio.viewing.value?.messages.length, studio.activeJob.value?.status, studio.pendingApproval.value] as const, check, { immediate: true, deep: true })
    signal?.addEventListener('abort', stop, { once: true })
  })
}

async function sendTutorTurn(text: string, mode: CourseChatLine['mode'], signal?: AbortSignal): Promise<string> {
  const configId = studio.chatConfigId.value
  if (!configId) throw new Error('Escolha ou crie um Agent em Apps → Agents antes de iniciar a conversa.')
  if (studio.jobActive.value) throw new Error('O Agent já está ocupado. Aguarde a resposta anterior antes de enviar outra mensagem.')
  if (signal?.aborted) throw new DOMException('Voz interrompida.', 'AbortError')
  const previousConfigId = configId
  const previousViewing = studio.viewing.value
  let sessionId: string | undefined = progress.value.chatSessionIds[configId]
  try {
    if (sessionId) {
      await studio.loadSession(sessionId)
      if (studio.viewing.value?.id !== sessionId) sessionId = undefined
    }
    if (!sessionId) {
      studio.setViewing(null)
      const created = await studio.newSession()
      if (!created) throw new Error('Não consegui abrir uma sessão de estudo no Agent selecionado.')
      sessionId = created.id
      progress.value.chatSessionIds[configId] = sessionId
    }
    const session = studio.viewing.value
    if (!session || session.id !== sessionId) throw new Error('A sessão do tutor mudou durante o envio. Tente novamente.')
    const startIndex = session.messages.length
    const abortOwnedTurn = () => {
      if (studio.activeJob.value?.sessionId === sessionId) void studio.abort()
    }
    signal?.addEventListener('abort', abortOwnedTurn, { once: true })
    let answer: string
    try {
      const sent = await studio.send(tutorPrompt(text.slice(0, 800)))
      if (!sent) throw new Error('O Agent não aceitou a mensagem. Verifique sua configuração e tente de novo.')
      answer = await waitForTutorReply(startIndex, sessionId, signal)
    } finally {
      signal?.removeEventListener('abort', abortOwnedTurn)
    }
    progress.value.chat.push(newChatLine('student', text, mode), newChatLine('tutor', answer, mode))
    if (progress.value.chat.length > 60) progress.value.chat.splice(0, progress.value.chat.length - 60)
    void nextTick(() => { if (chatList.value) chatList.value.scrollTop = chatList.value.scrollHeight })
    return answer
  } finally {
    studio.chatConfigId.value = previousConfigId
    studio.setViewing(previousViewing)
  }
}

async function sendVoicePrompt(text: string, signal: AbortSignal) {
  return sendTutorTurn(text, 'voice', signal)
}

async function sendTextPractice() {
  const text = chatDraft.value.trim()
  if (!text || chatSendBusy) return
  chatSendBusy = true
  chatDraft.value = ''
  try {
    await sendTutorTurn(text, 'text')
  } catch (cause) {
    progress.value.chat.push(newChatLine('student', text, 'text'))
    progress.value.chat.push(newChatLine('tutor', cause instanceof Error ? cause.message : String(cause), 'text'))
    if (progress.value.chat.length > 60) progress.value.chat.splice(0, progress.value.chat.length - 60)
    chatDraft.value = text
  } finally {
    chatSendBusy = false
  }
}

async function startVoice() {
  if (!selectedAgentId.value) {
    saveState.value = 'Selecione um Agent antes de ligar o microfone'
    return
  }
  if (!voice.supported) return
  voice.start()
}

function stopVoice() {
  voice.end()
  capturingShortcut.value = ''
}

function clearChat() {
  progress.value.chat = []
  progress.value.chatSessionIds = {}
}

function shortcutLabel(action: keyof MandarinProgress['shortcuts']) {
  const binding = progress.value.shortcuts[action]
  if (!binding.code) return 'Definir tecla'
  const parts = [binding.ctrl && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', binding.meta && 'Meta', binding.code.replace(/^Key/, '').replace(/^Digit/, '')].filter(Boolean)
  return parts.join(' + ')
}

function beginShortcutCapture(action: keyof MandarinProgress['shortcuts']) {
  if (voice.active.value) return
  capturingShortcut.value = action
}

function isModifierOnly(code: string) {
  return ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)
}

function onPanelKeydown(event: KeyboardEvent) {
  if (!capturingShortcut.value) return
  if (event.code === 'Escape') {
    capturingShortcut.value = ''
    event.preventDefault()
    return
  }
  if (isModifierOnly(event.code) || event.repeat) return
  if (!(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) {
    saveState.value = 'Escolha uma combinação com Alt, Ctrl, Meta ou Shift'
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const next: KeyboardBinding = { code: event.code, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
  const other = capturingShortcut.value === 'toggleVoice' ? 'replayPhrase' : 'toggleVoice'
  const otherBinding = progress.value.shortcuts[other]
  if (otherBinding.code && JSON.stringify(next) === JSON.stringify(otherBinding)) {
    saveState.value = 'Essa combinação já está usada pelo outro atalho'
    return
  }
  progress.value.shortcuts[capturingShortcut.value] = next
  capturingShortcut.value = ''
}

function sameBinding(a: KeyboardBinding, event: KeyboardEvent) {
  return !!a.code && a.code === event.code && a.alt === event.altKey && a.ctrl === event.ctrlKey && a.meta === event.metaKey && a.shift === event.shiftKey
}

function onGlobalShortcut(event: KeyboardEvent) {
  if (stage.value !== 'voice' || !windowUi.focused.value || capturingShortcut.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const toggle = progress.value.shortcuts.toggleVoice
  if (sameBinding(toggle, event)) {
    event.preventDefault()
    if (voice.active.value) stopVoice()
    else void startVoice()
    return
  }
  if (sameBinding(progress.value.shortcuts.replayPhrase, event)) {
    event.preventDefault()
    speakCurrentPhrase()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalShortcut)
  void hydrateProgress()
  void studio.ensureCatalog()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalShortcut)
  drawingObserver?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
  window.speechSynthesis?.cancel()
  stopVoice()
})

watch(progress, scheduleSave, { deep: true })
watch(() => activeLessonId.value, () => {
  reviewed.value = progress.value.completedLessons.includes(activeLessonId.value)
})
watch(stage, next => { if (next === 'write') void nextTick(setupCanvas) })
watch(activeStrokes, () => { void nextTick(renderCanvas) }, { deep: true })
</script>

<style scoped>
.mandarin-app {
  --mi-gold: color-mix(in srgb, var(--ui-accent, #d99b43) 75%, #ffd88a);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100%;
  height: 100%;
  overflow: auto;
  color: var(--ui-text, #eef0f4);
  background:
    radial-gradient(ellipse at 13% 0%, color-mix(in srgb, var(--ui-accent, #d99b43) 10%, transparent), transparent 38%),
    var(--ui-surface, #111318);
  font-family: var(--ui-font, Inter, ui-sans-serif, system-ui, sans-serif);
  scrollbar-gutter: stable;
}
.mandarin-app * { box-sizing: border-box; }
.mi-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 26px 30px 20px; border-bottom: 1px solid var(--ui-border, rgba(255,255,255,.09)); }
.mi-heading { max-width: 720px; min-width: 0; }
.mi-eyebrow, .mi-kicker, .mi-section-label, .mi-source-label { margin: 0; color: var(--mi-gold); font-size: 10px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.mi-header h1 { margin: 8px 0 6px; font-size: clamp(23px, 3vw, 36px); line-height: 1.12; letter-spacing: -.045em; }
.mi-lede { max-width: 670px; margin: 0; color: var(--ui-text-2, #b8bfca); font-size: 13px; line-height: 1.6; }
.mi-progress-card { width: min(245px, 30%); padding: 13px 15px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 12px; background: var(--ui-glass, rgba(255,255,255,.04)); box-shadow: var(--ui-shadow-1, none); }
.mi-progress-top { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; }
.mi-progress-top strong { color: var(--ui-text, #fff); font-variant-numeric: tabular-nums; }
.mi-progress-track { height: 5px; margin: 11px 0 7px; overflow: hidden; border-radius: 99px; background: var(--ui-surface-3, rgba(255,255,255,.11)); }
.mi-progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--mi-gold); transition: width 220ms ease; }
.mi-progress-card small { color: var(--ui-text-3, #949ba7); font-size: 10px; }
.mi-stage-nav { position: sticky; z-index: 2; top: 0; display: flex; align-items: center; gap: 4px; padding: 9px 30px; border-bottom: 1px solid var(--ui-border, rgba(255,255,255,.09)); background: color-mix(in srgb, var(--ui-surface, #111318) 92%, transparent); backdrop-filter: blur(12px); }
.mi-stage-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 0 12px; border: 1px solid transparent; border-radius: 8px; color: var(--ui-text-2, #b8bfca); background: transparent; font: inherit; font-size: 12px; cursor: pointer; transition: background 140ms ease, color 140ms ease, border-color 140ms ease; }
.mi-stage-button:hover { color: var(--ui-text, #fff); background: var(--ui-glass, rgba(255,255,255,.05)); }
.mi-stage-button.active { color: var(--ui-text, #fff); border-color: color-mix(in srgb, var(--mi-gold) 35%, transparent); background: color-mix(in srgb, var(--mi-gold) 13%, transparent); }
.mi-save-state { margin-left: auto; overflow: hidden; color: var(--ui-text-3, #949ba7); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.mi-workspace { display: grid; flex: 1; grid-template-columns: minmax(195px, 230px) minmax(0, 1fr); align-items: stretch; min-height: 0; }
.mi-lesson-rail { display: flex; flex-direction: column; gap: 7px; padding: 23px 15px; border-right: 1px solid var(--ui-border, rgba(255,255,255,.09)); background: color-mix(in srgb, var(--ui-surface, #111318) 94%, #000); }
.mi-lesson-group { display: grid; gap: 5px; }
.mi-lesson-group > .mi-section-label { padding: 0 9px 4px; font-size: 9px; }
.mi-lesson-link { display: grid; grid-template-columns: 29px minmax(0, 1fr) 18px; align-items: center; gap: 8px; width: 100%; padding: 10px 9px; border: 1px solid transparent; border-radius: 9px; color: var(--ui-text-2, #bac1ca); background: transparent; text-align: left; cursor: pointer; }
.mi-lesson-link:hover { background: var(--ui-glass, rgba(255,255,255,.05)); }
.mi-lesson-link.active { border-color: var(--ui-border-hover, rgba(255,255,255,.16)); color: var(--ui-text, #fff); background: var(--ui-glass-2, rgba(255,255,255,.07)); }
.mi-lesson-index { color: var(--mi-gold); font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 11px; }
.mi-lesson-copy { display: grid; gap: 3px; min-width: 0; }
.mi-lesson-copy strong { overflow: hidden; font-size: 11px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.mi-lesson-copy small { overflow: hidden; color: var(--ui-text-3, #949ba7); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.mi-complete-icon { color: #64c99a; }
.mi-rail-note { display: flex; gap: 8px; align-items: flex-start; margin-top: auto; padding: 11px 9px; border-top: 1px solid var(--ui-border, rgba(255,255,255,.08)); color: var(--ui-text-3, #949ba7); font-size: 10px; line-height: 1.45; }
.mi-rail-note :deep(svg) { flex-shrink: 0; color: var(--mi-gold); }
.mi-main { min-width: 0; padding: 24px clamp(16px, 3vw, 34px) 32px; }
.mi-content-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin: 0 0 20px; }
.mi-content-head h2 { margin: 6px 0 5px; font-size: clamp(20px, 2.5vw, 27px); letter-spacing: -.035em; }
.mi-subtitle { max-width: 680px; margin: 0; color: var(--ui-text-2, #bac1ca); font-size: 12px; line-height: 1.55; }
.mi-lesson-state, .mi-quiz-best { flex-shrink: 0; padding: 6px 9px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 999px; color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 700; letter-spacing: .06em; }
.mi-lesson-state.done { color: #67d09d; border-color: rgba(103,208,157,.25); }
.mi-tone-hero { display: grid; grid-template-columns: minmax(170px, .7fr) minmax(280px, 1.3fr); align-items: center; gap: 20px; margin-bottom: 14px; padding: 17px; border: 1px solid color-mix(in srgb, var(--mi-gold) 18%, var(--ui-border, #282c34)); border-radius: 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--mi-gold) 11%, transparent), transparent 70%), var(--ui-glass, rgba(255,255,255,.035)); }
.mi-pinyin-tag { color: var(--mi-gold); font-size: 9px; font-weight: 750; letter-spacing: .13em; }
.mi-tone-intro p { margin: 7px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; line-height: 1.55; }
.mi-tone-ribbons { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.mi-tone-ribbon { position: relative; min-width: 0; padding: 8px 8px 4px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 9px; background: color-mix(in srgb, var(--ui-surface, #111318) 72%, transparent); }
.mi-tone-ribbon svg { display: block; width: 100%; height: auto; overflow: visible; }
.mi-tone-ribbon path { fill: none; stroke: var(--mi-gold); stroke-linecap: round; stroke-width: 5; vector-effect: non-scaling-stroke; }
.mi-tone-ribbon span { color: var(--ui-text-3, #949ba7); font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 9px; }
.mi-concept-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 10px; }
.mi-concept-card { display: flex; flex-direction: column; min-width: 0; min-height: 175px; padding: 12px 13px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 11px; background: var(--ui-glass, rgba(255,255,255,.035)); transition: border-color 160ms ease, transform 160ms ease; }
.mi-concept-card:hover { transform: translateY(-2px); border-color: var(--ui-border-hover, rgba(255,255,255,.2)); }
.mi-concept-card--tone .mi-hanzi { color: var(--mi-gold); }
.mi-concept-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ui-text-3, #949ba7); font-size: 8px; font-weight: 750; letter-spacing: .11em; }
.mi-icon-button { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 8px; color: var(--ui-text-2, #bac1ca); background: transparent; cursor: pointer; }
.mi-icon-button:hover:not(:disabled) { color: var(--mi-gold); background: var(--ui-glass, rgba(255,255,255,.05)); }
.mi-hanzi { margin: 9px 0 2px; font-family: 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 28px; line-height: 1.1; }
.mi-pinyin { color: var(--mi-gold); font-size: 11px; font-weight: 650; }
.mi-concept-card p { margin: 8px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; line-height: 1.45; }
.mi-source-note { margin-top: auto; padding-top: 6px; color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.4; }
.mi-example-section { display: grid; gap: 8px; margin-top: 15px; }
.mi-extra-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 12px; }
.mi-extra-head > span { color: var(--ui-text-3, #949ba7); font-size: 9px; }
.mi-example-card { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); align-items: baseline; gap: 5px 12px; padding: 12px 14px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 10px; background: var(--ui-glass, rgba(255,255,255,.035)); }
.mi-example-card strong { grid-row: span 2; font-family: 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 20px; }
.mi-example-card .mi-pinyin { align-self: end; }
.mi-example-card p { margin: 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; }
.mi-exercise-bank { margin-top: 9px; padding: 11px 13px; border-left: 2px solid color-mix(in srgb, var(--mi-gold) 65%, transparent); border-radius: 0 8px 8px 0; background: var(--ui-glass, rgba(255,255,255,.025)); }
.mi-exercise-bank > p:last-child { margin: 6px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; line-height: 1.5; }
.mi-practice-callout { display: grid; grid-template-columns: 35px minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-top: 15px; padding: 14px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 11px; background: var(--ui-glass, rgba(255,255,255,.035)); }
.mi-callout-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--mi-gold); background: color-mix(in srgb, var(--mi-gold) 15%, transparent); }
.mi-practice-callout > div:nth-child(2) p:last-child { margin: 5px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; line-height: 1.5; }
.mi-section-label { color: var(--ui-text-3, #949ba7); font-size: 8px; }
.mi-content-foot { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--ui-border, rgba(255,255,255,.08)); }
.mi-content-foot > span { color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.45; }
.mi-writing-layout { display: grid; grid-template-columns: minmax(220px, .8fr) minmax(260px, 1.2fr); gap: 13px; }
.mi-writing-card, .mi-draw-card, .mi-voice-card, .mi-chat-card, .mi-source-card { min-width: 0; padding: 16px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 12px; background: var(--ui-glass, rgba(255,255,255,.035)); }
.mi-field-label { display: block; color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 750; letter-spacing: .1em; }
.mi-writing-prompt { min-height: 36px; margin: 10px 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; line-height: 1.5; }
.mi-writing-source-note { display: block; margin-top: 6px; color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.45; }
.mi-writing-input, .mi-chat-compose textarea { width: 100%; min-height: 125px; resize: vertical; padding: 11px 12px; border: 1px solid var(--ui-border, rgba(255,255,255,.13)); border-radius: 8px; outline: none; color: var(--ui-text, #f4f5f7); background: var(--ui-surface, #111318); font: 15px/1.6 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', var(--ui-font, sans-serif); }
.mi-writing-input:focus, .mi-chat-compose textarea:focus, .mi-voice-setting-row select:focus, .mi-chat-compose input:focus { border-color: var(--mi-gold); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-gold) 20%, transparent); }
.mi-writing-bottom { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; color: var(--ui-text-3, #949ba7); font-size: 10px; }
.mi-character-picks { display: flex; flex-wrap: wrap; gap: 5px; }
.mi-character-picks button { min-width: 34px; min-height: 34px; border: 1px solid var(--ui-border, rgba(255,255,255,.12)); border-radius: 7px; color: var(--ui-text, #f4f5f7); background: var(--ui-surface-3, rgba(255,255,255,.05)); font-size: 16px; cursor: pointer; }
.mi-character-picks button:hover { border-color: var(--mi-gold); }
.mi-draw-head, .mi-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mi-draw-head h3, .mi-adapter-list h3 { margin: 5px 0 0; font-size: 16px; }
.mi-draw-actions { display: flex; gap: 5px; }
.mi-canvas-wrap { height: 222px; margin-top: 13px; overflow: hidden; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 9px; background-image: linear-gradient(to right, var(--ui-border, rgba(255,255,255,.08)) 1px, transparent 1px), linear-gradient(to bottom, var(--ui-border, rgba(255,255,255,.08)) 1px, transparent 1px); background-size: 24px 24px; background-position: center; background-color: color-mix(in srgb, var(--ui-surface, #111318) 88%, var(--mi-gold)); }
.mi-drawing-canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.mi-canvas-hint { display: flex; gap: 6px; align-items: center; margin: 9px 0 0; color: var(--ui-text-3, #949ba7); font-size: 9px; }
.mi-question { min-width: 0; margin: 0; padding: 14px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 10px; }
.mi-question + .mi-question { margin-top: 9px; }
.mi-question legend { width: 100%; padding: 0; font-size: 12px; font-weight: 650; line-height: 1.5; }
.mi-question-number { display: inline-grid; place-items: center; width: 26px; height: 26px; margin-right: 8px; border: 1px solid var(--ui-border, rgba(255,255,255,.11)); border-radius: 7px; color: var(--mi-gold); font-family: var(--ui-font-mono, monospace); font-size: 10px; }
.mi-option { display: flex; align-items: center; gap: 10px; min-height: 42px; margin-top: 6px; padding: 7px 10px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 7px; color: var(--ui-text-2, #bac1ca); background: var(--ui-glass, rgba(255,255,255,.025)); font-size: 11px; cursor: pointer; }
.mi-option input { flex: 0 0 auto; accent-color: var(--mi-gold); }
.mi-option :deep(svg) { margin-left: auto; color: #64c99a; }
.mi-option.selected { border-color: color-mix(in srgb, var(--mi-gold) 55%, transparent); }
.mi-option.correct { border-color: rgba(100,201,154,.42); color: #a7e4c4; }
.mi-option.incorrect { border-color: rgba(241,109,123,.4); color: #f19aa4; }
.mi-answer-explanation { margin: 9px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 10px; line-height: 1.45; }
.mi-answer-explanation span { color: var(--ui-text-3, #949ba7); }
.mi-quiz-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-top: 14px; }
.mi-quiz-result { margin: 0; color: var(--ui-text-2, #bac1ca); font-size: 11px; }
.mi-voice-state { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--ui-border, rgba(255,255,255,.1)); border-radius: 99px; color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 750; letter-spacing: .08em; }
.mi-voice-state i { width: 7px; height: 7px; border-radius: 50%; background: #747b86; }
.mi-voice-state[data-state='listening'] i { background: #64c99a; box-shadow: 0 0 12px rgba(100,201,154,.6); animation: mi-pulse 1.1s ease-in-out infinite alternate; }
.mi-voice-state[data-state='thinking'] i { background: #d9ab57; animation: mi-pulse .6s ease-in-out infinite alternate; }
.mi-voice-state[data-state='speaking'] i { background: #66ade5; animation: mi-pulse .7s ease-in-out infinite alternate; }
@keyframes mi-pulse { to { opacity: .35; transform: scale(.72); } }
.mi-voice-layout { display: grid; grid-template-columns: minmax(250px, .9fr) minmax(270px, 1.1fr); gap: 12px; align-items: stretch; }
.mi-voice-card { display: flex; flex-direction: column; gap: 12px; }
.mi-voice-setting-row { display: grid; gap: 6px; }
.mi-voice-setting-row label { color: var(--ui-text-3, #949ba7); font-size: 9px; font-weight: 750; letter-spacing: .1em; }
.mi-voice-setting-row select { width: 100%; min-height: 40px; padding: 7px 10px; border: 1px solid var(--ui-border, rgba(255,255,255,.12)); border-radius: 8px; color: var(--ui-text, #f4f5f7); background: var(--ui-surface, #111318); font: inherit; font-size: 11px; }
.mi-voice-safety { display: flex; gap: 8px; align-items: flex-start; margin: 0; color: var(--ui-text-2, #bac1ca); font-size: 10px; line-height: 1.5; }
.mi-voice-safety :deep(svg) { flex-shrink: 0; color: #64c99a; }
.mi-provider-warning, .mi-voice-error { margin: 0; padding: 10px; border: 1px solid rgba(225,173,74,.3); border-radius: 8px; color: #efcf8b; background: rgba(225,173,74,.07); font-size: 10px; line-height: 1.5; }
.mi-voice-error { border-color: rgba(241,109,123,.32); color: #f19aa4; background: rgba(241,109,123,.07); }
.mi-voice-controls { display: flex; flex-wrap: wrap; gap: 7px; margin: 2px 0; }
.mi-live-caption { margin: 0; padding: 9px 10px; border-left: 2px solid var(--mi-gold); color: var(--ui-text-2, #bac1ca); background: var(--ui-glass, rgba(255,255,255,.04)); font-size: 10px; }
.mi-shortcut-grid { display: grid; gap: 8px; margin-top: 3px; padding-top: 12px; border-top: 1px solid var(--ui-border, rgba(255,255,255,.09)); }
.mi-shortcut-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.mi-shortcut-row span { display: grid; gap: 3px; }
.mi-shortcut-row strong { font-size: 10px; }
.mi-shortcut-row small, .mi-shortcut-note, .mi-capture-message { color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.4; }
.mi-shortcut-note, .mi-capture-message { margin: 0; }
.mi-capture-message { color: var(--mi-gold); }
.mi-chat-card { display: flex; flex-direction: column; min-height: 330px; }
.mi-chat-head { flex: 0 0 auto; padding-bottom: 9px; border-bottom: 1px solid var(--ui-border, rgba(255,255,255,.09)); }
.mi-chat-head strong { display: block; margin-top: 4px; font-size: 10px; }
.mi-chat-list { display: flex; flex: 1; flex-direction: column; gap: 9px; min-height: 175px; max-height: 380px; overflow-y: auto; padding: 12px 2px; overscroll-behavior: contain; }
.mi-chat-empty { align-self: center; max-width: 245px; margin: auto; color: var(--ui-text-3, #949ba7); font-size: 11px; line-height: 1.55; text-align: center; }
.mi-chat-line { max-width: 92%; padding: 9px 10px; border: 1px solid var(--ui-border, rgba(255,255,255,.09)); border-radius: 9px; background: var(--ui-glass, rgba(255,255,255,.035)); }
.mi-chat-line--student { align-self: flex-end; border-color: color-mix(in srgb, var(--mi-gold) 22%, var(--ui-border, #282c34)); background: color-mix(in srgb, var(--mi-gold) 7%, var(--ui-surface, #111318)); }
.mi-chat-line > span { color: var(--ui-text-3, #949ba7); font-size: 8px; font-weight: 750; letter-spacing: .1em; }
.mi-chat-line p { margin: 5px 0 0; font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.mi-chat-compose { display: flex; align-items: flex-end; gap: 7px; padding-top: 9px; border-top: 1px solid var(--ui-border, rgba(255,255,255,.09)); }
.mi-chat-compose textarea { min-height: 48px; max-height: 120px; resize: vertical; font-size: 13px; }
.mi-adapter-list { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 14px; }
.mi-adapter { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--ui-border, rgba(255,255,255,.09)); border-radius: 9px; background: var(--ui-glass, rgba(255,255,255,.025)); }
.mi-adapter > div { display: grid; gap: 4px; }
.mi-adapter strong { font-size: 10px; }
.mi-adapter small { color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.4; }
.mi-adapter-badge { color: var(--ui-text-3, #949ba7); font-size: 8px; }
.mi-adapter a, .mi-source-links a { color: var(--mi-gold); font-size: 9px; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.mi-adapter-foot { margin: 1px 0 0; color: var(--ui-text-3, #949ba7); font-size: 9px; line-height: 1.5; }
.mi-source-list { display: grid; gap: 10px; }
.mi-source-card { padding: 16px; }
.mi-source-card h3 { margin: 7px 0; font-size: 15px; }
.mi-source-card p { margin: 6px 0 0; color: var(--ui-text-2, #bac1ca); font-size: 10px; line-height: 1.58; }
.mi-source-links { display: flex; flex-wrap: wrap; gap: 9px 16px; padding: 10px 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
:deep(button:focus-visible), .mi-voice-setting-row select:focus-visible, .mi-option:focus-within, .mi-character-picks button:focus-visible, .mi-drawing-canvas:focus-visible, .mi-source-links a:focus-visible { outline: 2px solid var(--mi-gold); outline-offset: 3px; }
@media (max-width: 900px) {
  .mi-header { align-items: flex-start; flex-direction: column; gap: 15px; }
  .mi-progress-card { width: min(100%, 340px); }
  .mi-workspace { grid-template-columns: 1fr; }
  .mi-lesson-rail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; padding: 10px 14px; border-right: 0; border-bottom: 1px solid var(--ui-border, rgba(255,255,255,.09)); }
  .mi-lesson-group, .mi-rail-note { grid-column: 1 / -1; }
  .mi-lesson-group { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .mi-lesson-group > .mi-section-label { grid-column: 1 / -1; }
  .mi-rail-note { margin: 0; padding: 5px 9px 0; border: 0; }
  .mi-lesson-link { grid-template-columns: 24px minmax(0, 1fr) 16px; gap: 5px; padding: 8px 6px; }
  .mi-lesson-copy strong { font-size: 10px; }
  .mi-lesson-copy small { font-size: 8px; }
}
@media (max-width: 700px) {
  .mi-header { padding: 20px 17px 15px; }
  .mi-stage-nav { gap: 2px; overflow-x: auto; padding: 7px 12px; }
  .mi-stage-button { flex: 0 0 auto; min-height: 44px; padding: 0 9px; font-size: 10px; }
  .mi-save-state { position: sticky; right: 0; flex: 0 0 98px; padding: 7px 4px 7px 8px; background: var(--ui-surface, #111318); text-align: right; }
  .mi-lesson-rail { grid-template-columns: 1fr; padding: 9px 12px; }
  .mi-lesson-group { grid-template-columns: 1fr; }
  .mi-lesson-group > .mi-section-label { padding-bottom: 0; }
  .mi-lesson-link { min-height: 44px; grid-template-columns: 28px minmax(0, 1fr) 18px; padding: 7px 8px; }
  .mi-lesson-copy strong { font-size: 11px; }
  .mi-lesson-copy small { font-size: 9px; }
  .mi-rail-note { padding-top: 4px; }
  .mi-main { padding: 18px 14px 25px; }
  .mi-tone-hero { grid-template-columns: 1fr; }
  .mi-tone-ribbons { gap: 5px; }
  .mi-tone-ribbon { padding: 6px; }
  .mi-tone-ribbon svg { max-height: 54px; }
  .mi-concept-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mi-concept-card { min-height: 165px; padding: 10px; }
  .mi-practice-callout { grid-template-columns: 32px minmax(0, 1fr); }
  .mi-practice-callout > :deep(.ui-btn) { grid-column: 2; justify-self: start; min-height: 44px; }
  .mi-content-foot { align-items: flex-start; flex-direction: column; }
  .mi-writing-layout, .mi-voice-layout { grid-template-columns: 1fr; }
  .mi-canvas-wrap { height: 190px; }
  .mi-adapter { grid-template-columns: minmax(0, 1fr) auto; }
  .mi-adapter a { grid-column: 1 / -1; }
  .mi-quiz-footer { align-items: stretch; }
  .mi-quiz-footer :deep(.ui-btn) { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .mandarin-app *, .mandarin-app *::before, .mandarin-app *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
</style>
