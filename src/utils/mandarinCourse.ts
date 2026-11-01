// CyberManju OS — Mandarin course data (src/utils/mandarinCourse.ts).
// Role: source-attributed Mandarin curriculum, page audit metadata and progress types.
// Contracts: source PDFs and full OCR text stay outside the app; course examples are original.
import lessonData from '@/data/mandarinLessons.json'
import corpusData from '@/data/mandarinCorpus.json'
import type { CourseInteractionMode } from '@/utils/courseInteraction'

export type LessonId = string
export type CourseStage = 'learn' | 'write' | 'quiz' | 'voice' | 'sources'
export type VoiceLanguage = 'zh-CN' | 'pt-BR'

export interface CourseStrokePoint { x: number; y: number }
export interface CourseStroke { points: CourseStrokePoint[] }
export interface CourseChatLine {
  id: string
  role: 'student' | 'tutor'
  text: string
  createdAt: number
  mode: 'text' | 'voice'
}
export interface KeyboardBinding { code: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }
export interface MandarinProgress {
  schemaVersion: 1
  activeLessonId: LessonId
  completedLessons: LessonId[]
  bestQuizScores: Partial<Record<LessonId, number>>
  writing: Partial<Record<LessonId, string>>
  drawings: Partial<Record<LessonId, CourseStroke[]>>
  chatSessionIds: Record<string, string>
  chat: CourseChatLine[]
  voiceLanguage: VoiceLanguage
  interactionMode: CourseInteractionMode
  shortcuts: { toggleVoice: KeyboardBinding; replayPhrase: KeyboardBinding }
  updatedAt: string
}

export interface QuizQuestion {
  id: string
  type: 'multiple-choice'
  prompt: string
  options: Array<{ id: string; label: string }>
  answerId: string
  explanation: string
  sourcePages: string
}
export interface LessonTerm { hanzi: string; pinyin: string; meaning: string; kind?: string; note?: string }
export interface LessonExample { text: string; kind: string; pinyin: string; translation: string; origin: string; sourcePage: number | null }
export interface CourseExercise { id: string; prompt: string; origin: string }
export interface CourseSourceRef {
  sourceId: 'shangrila' | 'reader'
  printedPages: [number, number] | null
  pdfPages: [number, number]
  basis: string
  note?: string
}
type RawCourseSourceRef = Omit<CourseSourceRef, 'printedPages' | 'pdfPages'> & {
  printedPages: number[] | null
  pdfPages: number[]
}
export interface LessonWriting {
  prompt: string
  characters: string[]
  strokeOrderIncluded: boolean
  strokeNotes: string
  sampledCharacterPages?: { pdfPages: number[]; exhaustive: boolean }
  coverageNote?: string
}
export interface MandarinLesson {
  id: LessonId
  sequence: number
  moduleId: string
  moduleTitle: string
  title: string
  subtitle: string
  objective: string
  sourcePages: string
  sourceRefs: CourseSourceRef[]
  vocabulary: LessonTerm[]
  examples: LessonExample[]
  writing: LessonWriting
  practicePrompt: string
  exercises: CourseExercise[]
  questions: QuizQuestion[]
  agentGuidance: string
  /** Compatibility aliases used by the current lesson-card component. */
  concepts: LessonTerm[]
  writingPrompt: string
}
export interface CorpusPage {
  sourceId: 'shangrila' | 'reader'
  pdfPage: number
  printedPage: number | null
  sectionId: string
  lessonId: string | null
  pageTitle: string | null
  pageType: string
  textLayerChars: number
  ocr: {
    engine: string
    languages: string
    renderDpi: number
    pageSegmentationMode: number
    recognizedWordCount: number
    meanWordConfidence: number | null
    status: string
  }
  evidence: string
  visualReview: string | null
  reviewNote: string | null
}
export interface CorpusChapter {
  id: string
  sourceId: string
  lessonId: string | null
  title: string
  type: string
  printedPages: [number, number] | null
  pdfPages: [number, number]
  basis: string
  objective: string | null
}
export interface MandarinCorpus {
  schemaVersion: number
  language: string
  corpusTitle: string
  pageMapping: Record<string, string>
  sources: Array<Record<string, unknown> & { id: string; fileName: string; pdfPageCount: number; sha256: string }>
  chapters: CorpusChapter[]
  pages: CorpusPage[]
  coverage: {
    physicalPdfPages: number
    sourcePageCounts: Record<string, number>
    lessonRecords: number
    coreLessons: number
    supportingUnits: number
    readerCoreChapters: string
    allPhysicalPagesHaveRecords: boolean
    completeTextTranscription: boolean
    missingPageRecords: number[]
    lowConfidencePages: Record<string, number[]>
    noOcrTextPages: Record<string, number[]>
    sparseOcrPages: Record<string, number[]>
  }
  ocrMethod: { software: string; commandProfile: string; textPolicy: string }
  limitations: string[]
}

type LessonRecord = Omit<MandarinLesson, 'concepts' | 'writingPrompt' | 'sourceRefs'> & {
  sourceRefs: RawCourseSourceRef[]
}
const lessonRecords = lessonData.lessons as LessonRecord[]
function normalizePageRange(value: number[], context: string): [number, number] {
  if (value.length !== 2 || value.some(page => !Number.isInteger(page) || page < 1)) {
    throw new Error(`Invalid two-page range for ${context}`)
  }
  return [value[0], value[1]]
}
export const MANDARIN_LESSONS: MandarinLesson[] = lessonRecords.map(lesson => ({
  ...lesson,
  sourceRefs: lesson.sourceRefs.map((ref, index) => ({
    ...ref,
    printedPages: ref.printedPages === null ? null : normalizePageRange(ref.printedPages, `${lesson.id}.sourceRefs[${index}].printedPages`),
    pdfPages: normalizePageRange(ref.pdfPages, `${lesson.id}.sourceRefs[${index}].pdfPages`),
  })),
  concepts: lesson.vocabulary,
  writingPrompt: lesson.writing.prompt,
}))
export const MANDARIN_QUIZ: Record<LessonId, QuizQuestion[]> = Object.fromEntries(
  MANDARIN_LESSONS.map(lesson => [lesson.id, lesson.questions]),
)
export const MANDARIN_CORPUS = corpusData as unknown as MandarinCorpus

export const MANDARIN_SOURCES = {
  course: {
    title: 'Curso de Língua Chinesa 汉语 — Módulo 1',
    publisher: 'Shangrila Cursos',
    note: 'O PDF não indica licença aberta; o dono confirmou autorização do titular para uso e reprodução pedagógica desta cópia no curso, com crédito e páginas-fonte. A autorização vale só para os dois PDFs enviados, não para outras obras nem como licença geral.',
  },
  reader: {
    title: '当代中文 · Chinês Contemporâneo · versão portuguesa do livro do aluno',
    publisher: '華語教學出版社 / Sinolingua; Hanban / Confucius Institute Headquarters',
    note: 'A ficha CIP na página PDF 209 registra edição portuguesa, 2010, ISBN 978-7-80200-719-2 e © da editora. O dono confirmou autorização do titular para uso e reprodução pedagógica desta cópia no curso, com crédito e páginas-fonte; o escopo não se estende a outras obras.',
  },
  voice: {
    title: 'Remix ChatterBots voice-loop sample',
    publisher: 'Google LLC, 2024',
    license: 'Apache-2.0',
    note: 'ZIP de referência licenciado Apache-2.0; seus arquivos não são copiados para este app. O exemplo do ZIP usa um relay /api/live-ws; a API atual do Gemini também permite conexão Live direta pelo SDK com token efêmero emitido por servidor autenticado. Esse broker e o adapter ainda não existem neste OS: o tutor usa VozPonte e qualquer Agent configurado pelo usuário nos modos texto/voz.',
  },
} as const

/** Voice transports considered for adapters; the OS Agent loop is active, while VoiceStudio has a separate manual TTS test only. */
export const VOICE_PROVIDER_CATALOG = [
  {
    id: 'os-agent',
    name: 'Agent configurado no CyberManju',
    state: 'available',
    transport: 'VozPonte do OS: Web Speech API no browser + chat do Agent escolhido + síntese do dispositivo.',
    needs: 'Configure um Agent em Apps → Agents; a chave continua sob o armazenamento seguro já usado pelo OS.',
  },
  {
    id: 'gemini-live',
    name: 'Gemini Live',
    state: 'needs-host-adapter',
    transport: 'SDK @google/genai e WebSocket Live; PCM16, 16 kHz na entrada e 24 kHz na saída.',
    needs: 'Um backend autenticado deve emitir token efêmero de uso limitado; não embutir GEMINI_API_KEY no bundle nem enviar áudio sem consentimento.',
    url: 'https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk',
  },
  {
    id: 'openai-realtime',
    name: 'OpenAI Realtime',
    state: 'needs-host-adapter',
    transport: 'WebRTC recomendado para browser; WebSocket é opção server-side.',
    needs: 'Servidor emite client secret efêmero; segredo permanente fica no host.',
    url: 'https://developers.openai.com/api/docs/guides/realtime',
  },
  {
    id: 'elevenlabs-agents',
    name: 'ElevenLabs Conversational AI',
    state: 'needs-host-adapter',
    transport: 'SDK JavaScript: WebRTC para voz e WebSocket para texto.',
    needs: 'Agente público pode usar ID; agentes privados exigem token temporário/URL assinada emitidos no servidor.',
    url: 'https://elevenlabs.io/docs/eleven-agents/libraries/java-script',
  },
  {
    id: 'voicestudio-local',
    name: 'VoiceStudio · teste TTS manual',
    state: 'manual-test-configurable',
    transport: 'POST explícito do browser a um endpoint HTTPS /v1/audio/speech configurado pelo usuário; resposta binária de áudio.',
    needs: 'O painel testa TTS uma vez por clique, exige CORS, recusa redirect e põe token no header Authorization. Não conduz conversas nem usa token permanente automaticamente.',
    url: 'https://voicestudio.sh/docs/text-to-speech',
  },
  {
    id: 'remote-colab',
    name: 'Colab / serviço de voz remoto',
    state: 'needs-host-adapter',
    transport: 'Transporte remoto depende de um endpoint gerido pela implantação, não de URL de serviço fornecida pela tela.',
    needs: 'Exige adapter no host confiável, autenticação curta e TLS; Colab não é tratado como serviço persistente nem está conectado.',
    url: 'https://github.com/debpalash/VoiceStudio/blob/main/docs/speech-platform.md',
  },
] as const

export const COURSE_PROGRESS_KEY = 'config:language-instructor.mandarin.v1'

export function defaultMandarinProgress(): MandarinProgress {
  return {
    schemaVersion: 1,
    activeLessonId: 'context',
    completedLessons: [],
    bestQuizScores: {},
    writing: {},
    drawings: {},
    chatSessionIds: {},
    chat: [],
    voiceLanguage: 'zh-CN',
    interactionMode: 'text',
    shortcuts: {
      toggleVoice: { code: 'KeyV', alt: true, ctrl: false, meta: false, shift: true },
      replayPhrase: { code: 'KeyR', alt: true, ctrl: false, meta: false, shift: true },
    },
    updatedAt: new Date(0).toISOString(),
  }
}

export function isLessonId(value: unknown): value is LessonId {
  return typeof value === 'string' && MANDARIN_LESSONS.some(lesson => lesson.id === value)
}

export function isQuizCorrect(question: QuizQuestion, selectedId: string): boolean {
  return question.answerId === selectedId
}

export function buildTutorQuizContext(questions: QuizQuestion[], revealSolutions: boolean): string {
  if (!questions.length) return 'Não há perguntas de recuperação nesta unidade.'
  if (!revealSolutions) {
    return `Perguntas de recuperação ativa: ${questions.map(question => question.prompt).join(' | ')}. Faça uma por vez e aguarde a tentativa do estudante; não revele gabarito, alternativa correta ou explicação antes de ele alcançar 2/3.`
  }
  return `Soluções liberadas após tentativa aprovada: ${questions.map(question => {
    const answer = question.options.find(option => option.id === question.answerId)?.label ?? 'gabarito não informado'
    return `${question.prompt} Resposta: ${answer}. Explicação: ${question.explanation}`
  }).join(' | ')}`
}

export function getQuizPassingScore(questionCount: number): number {
  const count = Math.max(0, Math.floor(questionCount))
  return count === 0 ? 0 : Math.ceil((count * 2) / 3)
}

export function updateBestScore(
  current: Partial<Record<LessonId, number>>,
  lessonId: LessonId,
  score: number,
  maximum: number,
): Partial<Record<LessonId, number>> {
  const safeMaximum = Math.max(0, Math.floor(maximum))
  const bounded = Math.max(0, Math.min(safeMaximum, Math.floor(score)))
  return { ...current, [lessonId]: Math.max(current[lessonId] ?? 0, bounded) }
}

export function canFinishLesson(
  lessonId: LessonId,
  completed: LessonId[],
  bestScores: Partial<Record<LessonId, number>>,
): boolean {
  const questionCount = MANDARIN_QUIZ[lessonId]?.length ?? 0
  const passingScore = getQuizPassingScore(questionCount)
  return questionCount > 0 && completed.includes(lessonId) && (bestScores[lessonId] ?? 0) >= passingScore
}
