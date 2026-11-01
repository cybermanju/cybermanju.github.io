// CyberManju OS — Mandarin course tests (tests/frontend/mandarin-course.test.ts).
// Role: protect the source-attributed curriculum, page inventory, and progress rules.
// Contracts: every PDF page is indexed once; source content is not claimed as fully transcribed.
import { describe, expect, it } from 'vitest'
import {
  MANDARIN_CORPUS,
  MANDARIN_LESSONS,
  MANDARIN_QUIZ,
  MANDARIN_SOURCES,
  buildTutorQuizContext,
  canFinishLesson,
  defaultMandarinProgress,
  getQuizPassingScore,
  isLessonId,
  isQuizCorrect,
  updateBestScore,
} from '@/utils/mandarinCourse'

const lessonById = (id: string) => MANDARIN_LESSONS.find(lesson => lesson.id === id)!
const richLessons = MANDARIN_LESSONS as unknown as Array<Record<string, any> & { id: string }>
const richCorpus = MANDARIN_CORPUS as unknown as { coverage: Record<string, any>; pages: Array<Record<string, any>> }

describe('Mandarin curriculum data', () => {
  it('loads the complete ordered sequence from both source books', () => {
    expect(MANDARIN_LESSONS).toHaveLength(29)
    expect(MANDARIN_LESSONS.map(lesson => lesson.sequence)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1))
    expect(MANDARIN_LESSONS.filter(lesson => lesson.moduleId === 'shangrila-m1')).toHaveLength(6)
    expect(MANDARIN_LESSONS.filter(lesson => lesson.moduleId === 'contemporary')).toHaveLength(23)
    expect(MANDARIN_LESSONS.every(lesson => lesson.sourcePages.includes('PDF'))).toBe(true)
    expect(MANDARIN_SOURCES.course.note).toMatch(/autorização do titular para uso e reprodução pedagógica desta cópia/)
    expect(MANDARIN_SOURCES.reader.note).toMatch(/ISBN 978-7-80200-719-2/)
    expect(MANDARIN_SOURCES.reader.note).toMatch(/autorização do titular para uso e reprodução pedagógica desta cópia/)
  })

  it('keeps the reproduction authorization scoped to the two supplied PDFs', () => {
    expect(MANDARIN_CORPUS.sources.map(source => source.id).sort()).toEqual(['reader', 'shangrila'])
    for (const source of MANDARIN_CORPUS.sources as Array<Record<string, any>>) {
      expect(source.reuseAuthorization?.status).toBe('user-confirmed-owner-permission')
      expect(source.reuseAuthorization?.scope).toMatch(/duas cópias PDF fornecidas/)
      expect(source.reuseAuthorization?.publicationPolicy).toMatch(/reprodução pedagógica autorizada/i)
      expect(source.reuseAuthorization?.publicationPolicy).toMatch(/somente às duas cópias PDF fornecidas/)
    }
  })

  it('uses the same lesson shape for vocabulary, examples, writing, exercises, questions, and sources', () => {
    for (const lesson of MANDARIN_LESSONS) {
      expect(lesson.vocabulary.length, lesson.id).toBeGreaterThan(0)
      expect(lesson.examples.length, lesson.id).toBeGreaterThan(0)
      expect(lesson.examples.every(example => example.text && example.kind && example.pinyin && example.translation), lesson.id).toBe(true)
      expect(lesson.writing.prompt, lesson.id).toBeTruthy()
      expect(Array.isArray(lesson.writing.characters), lesson.id).toBe(true)
      expect(lesson.exercises.length, lesson.id).toBeGreaterThan(0)
      expect(lesson.questions.length, lesson.id).toBeGreaterThan(0)
      expect(lesson.sourceRefs.length, lesson.id).toBeGreaterThan(0)
      for (const ref of lesson.sourceRefs) {
        expect(['shangrila', 'reader']).toContain(ref.sourceId)
        const max = MANDARIN_CORPUS.coverage.sourcePageCounts[ref.sourceId]
        expect(ref.pdfPages[0]).toBeGreaterThanOrEqual(1)
        expect(ref.pdfPages[1]).toBeLessThanOrEqual(max)
        if (ref.printedPages) {
          const offset = ref.sourceId === 'shangrila' ? 1 : (ref.printedPages[1] <= 10 ? 15 : 16)
          expect(ref.pdfPages).toEqual(ref.printedPages.map(page => page + offset))
        } else {
          expect(ref.sourceId).toBe('reader')
          expect(ref.pdfPages).toEqual([26, 26])
        }
      }
    }
  })

  it('standardizes pedagogy fields and meets explicit didactic minimums in every unit', () => {
    const arrays = ['languagePoints', 'communicativeFunctions', 'explanations', 'listeningPractice', 'pronunciationPractice', 'writingTasks', 'characterSamples', 'exerciseBank', 'readingSummaries', 'referenceIndexes', 'sourceContextNotes', 'pageSummaries']
    for (const lesson of richLessons) {
      const pedagogy = lesson.pedagogy
      expect(pedagogy?.overview?.summary, lesson.id).toBeTruthy()
      for (const key of arrays) expect(Array.isArray(pedagogy[key]), `${lesson.id}.${key}`).toBe(true)
      expect(lesson.vocabulary.length, lesson.id).toBeGreaterThanOrEqual(8)
      expect(lesson.examples.length, lesson.id).toBeGreaterThanOrEqual(3)
      expect(pedagogy.completenessCheck.meetsMinimums, lesson.id).toBe(true)
      for (const [key, minimum] of Object.entries(pedagogy.completenessCheck.minimums)) {
        expect(pedagogy.completenessCheck.observed[key], `${lesson.id}.${key}`).toBeGreaterThanOrEqual(minimum as number)
      }
      expect(lesson.questions.length, lesson.id).toBeGreaterThanOrEqual(3)
      expect(lesson.questions.every((question: Record<string, any>) => question.answerId && question.explanation && question.options.some((option: Record<string, any>) => option.id === question.answerId)), lesson.id).toBe(true)
      expect(pedagogy.exerciseBank.every((exercise: Record<string, any>) => exercise.type && exercise.expectedAnswer && exercise.explanation), lesson.id).toBe(true)
      expect(new Set(pedagogy.contentRecordIds).size, lesson.id).toBe(pedagogy.contentRecordIds.length)
      expect(pedagogy.provenance.literalTranscription, lesson.id).toBe(false)
      expect(lesson.agentGuidance, lesson.id).toMatch(/não deve receber nem revelar gabarito.*pelo menos 2\/3 de acertos na unidade/i)
    }
  })

  it('keeps printed page numbers and PDF physical pages aligned around the unnumbered appendix', () => {
    expect(lessonById('textbook-00').sourcePages).toContain('PDF pp. 16–25')
    expect(lessonById('textbook-00').sourcePages).toContain('Apêndice II, PDF p. 26')
    expect(lessonById('textbook-01').sourcePages).toContain('PDF pp. 27–35')
    expect(lessonById('textbook-10').sourcePages).toContain('PDF pp. 103–109')
    expect(lessonById('textbook-20').sourcePages).toContain('PDF pp. 186–191')
    expect(lessonById('supplement-translations').sourcePages).toContain('PDF pp. 110–117')
    const appendix = MANDARIN_CORPUS.pages.find(page => page.sourceId === 'reader' && page.pdfPage === 26)
    expect(appendix?.printedPage).toBeNull()
    expect(appendix?.pageType).toBe('unnumbered-appendix')
    expect(MANDARIN_CORPUS.pages.find(page => page.sourceId === 'reader' && page.pdfPage === 209)?.pageType).toBe('credits-copyright')
    expect(MANDARIN_CORPUS.pages.find(page => page.sourceId === 'reader' && page.pdfPage === 210)?.pageType).toBe('back-cover')
  })

  it('keeps quiz keys in step with lesson ids and every answer maps to an option', () => {
    const answerCounts: Record<string, number> = { a: 0, b: 0, c: 0 }
    let totalQuestions = 0
    for (const lesson of MANDARIN_LESSONS) {
      expect(MANDARIN_QUIZ[lesson.id].length).toBeGreaterThan(0)
      for (const question of MANDARIN_QUIZ[lesson.id]) {
        totalQuestions += 1
        expect(question.options.some(option => option.id === question.answerId), question.id).toBe(true)
        expect(question.options).toHaveLength(3)
        expect(new Set(question.options.map(option => option.id)).size, `${question.id} option IDs`).toBe(3)
        expect(new Set(question.options.map(option => option.label)).size, `${question.id} option labels`).toBe(3)
        expect(answerCounts[question.answerId], question.id).toBeDefined()
        answerCounts[question.answerId] += 1
        expect(question.explanation.length).toBeGreaterThan(0)
      }
    }
    expect(totalQuestions).toBe(87)
    expect(answerCounts).toEqual({ a: 29, b: 29, c: 29 })
  })

  it('validates IDs and checks only the published answer', () => {
    expect(isLessonId('sounds')).toBe(true)
    expect(isLessonId('textbook-20')).toBe(true)
    expect(isLessonId('other')).toBe(false)
    const question = MANDARIN_QUIZ.courtesy[0]
    const wrongId = question.options.find(option => option.id !== question.answerId)!.id
    expect(isQuizCorrect(question, question.answerId)).toBe(true)
    expect(isQuizCorrect(question, wrongId)).toBe(false)

    const guardedQuestion = {
      id: 'guarded-q', type: 'multiple-choice' as const, prompt: 'Qual é a resposta?',
      options: [{ id: 'a', label: 'distrator A' }, { id: 'b', label: 'resposta secreta' }, { id: 'c', label: 'distrator C' }],
      answerId: 'b', explanation: 'explicação secreta', sourcePages: 'PDF p. 1',
    }
    const belowTwoThirds = canFinishLesson('context', ['context'], { context: 1 })
    const atTwoThirds = canFinishLesson('context', ['context'], { context: 2 })
    expect(belowTwoThirds).toBe(false)
    expect(atTwoThirds).toBe(true)
    const beforePass = buildTutorQuizContext([guardedQuestion], belowTwoThirds)
    expect(beforePass).toContain(guardedQuestion.prompt)
    expect(beforePass).not.toContain('resposta secreta')
    expect(beforePass).not.toContain('explicação secreta')
    const afterPass = buildTutorQuizContext([guardedQuestion], atTwoThirds)
    expect(afterPass).toContain('resposta secreta')
    expect(afterPass).toContain('explicação secreta')
  })
})

describe('page-level corpus audit', () => {
  it('has exactly one record for every physical PDF page and no missing page numbers', () => {
    expect(MANDARIN_CORPUS.coverage.physicalPdfPages).toBe(267)
    expect(MANDARIN_CORPUS.coverage.sourcePageCounts).toEqual({ shangrila: 57, reader: 210 })
    expect(MANDARIN_CORPUS.coverage.allPhysicalPagesHaveRecords).toBe(true)
    expect(MANDARIN_CORPUS.coverage.missingPageRecords).toEqual([])
    for (const [sourceId, count] of Object.entries(MANDARIN_CORPUS.coverage.sourcePageCounts)) {
      const pages = MANDARIN_CORPUS.pages.filter(page => page.sourceId === sourceId).map(page => page.pdfPage).sort((a, b) => a - b)
      expect(pages).toEqual(Array.from({ length: count }, (_, i) => i + 1))
    }
    expect(new Set(MANDARIN_CORPUS.chapters.map(chapter => chapter.id)).size).toBe(MANDARIN_CORPUS.chapters.length)
    const printedReaderPages = MANDARIN_CORPUS.chapters.filter(chapter => chapter.sourceId === 'reader' && chapter.printedPages)
      .flatMap(chapter => Array.from({ length: chapter.printedPages![1] - chapter.printedPages![0] + 1 }, (_, i) => chapter.printedPages![0] + i)).sort((a, b) => a - b)
    expect(printedReaderPages).toEqual(Array.from({ length: 192 }, (_, i) => i + 1))
  })

  it('reports OCR gaps and explicitly does not claim a full transcription', () => {
    expect(MANDARIN_CORPUS.coverage.completeTextTranscription).toBe(false)
    expect(MANDARIN_CORPUS.coverage.noOcrTextPages.reader).toContain(2)
    expect(MANDARIN_CORPUS.coverage.lowConfidencePages.shangrila).toEqual(Array.from({ length: 11 }, (_, i) => i + 46))
    expect(MANDARIN_CORPUS.coverage.lowConfidencePages.reader).toContain(171)
    expect(MANDARIN_CORPUS.coverage.sparseOcrPages.reader).toEqual([109, 165])
    expect(MANDARIN_CORPUS.limitations.length).toBeGreaterThanOrEqual(5)
  })

  it('links every substantive page to valid teaching records and detects low page-summary coverage', () => {
    const audit = richCorpus.coverage.pedagogicalCoverage
    const pageCoverage = audit.pageCoverage
    const allRecordIds = new Set(richLessons.flatMap(lesson => lesson.pedagogy.contentRecordIds))
    expect(audit.unitCount).toBe(29)
    expect(audit.unitsMeetingDefinedDidacticMinimums).toBe(29)
    expect(audit.unitsBelowMinimums).toEqual([])
    expect(audit.unitCoverage.vocabularyItems).toBeGreaterThan(250)
    expect(audit.unitCoverage.languagePoints).toBeGreaterThanOrEqual(58)
    expect(audit.unitCoverage.communicativeFunctions).toBeGreaterThanOrEqual(58)
    expect(audit.unitCoverage.exerciseTypeKinds).toBeGreaterThanOrEqual(5)
    expect(audit.unitCoverage.questionsWithAnswerAndExplanation).toBeGreaterThanOrEqual(87)
    expect(pageCoverage.substantivePages).toBe(232)
    expect(pageCoverage.substantivePagesWithPageRecords).toBe(232)
    expect(pageCoverage.substantivePagesLinkedToTeachingRecords).toBe(232)
    expect(pageCoverage.pagesWithoutAnyTeachingRecord).toEqual([])
    expect(pageCoverage.pagesWithPageSpecificEvidenceOrVisualSummary).toBe(232)
    expect(pageCoverage.pagesWithoutPageSpecificSummary).toEqual([])
    expect(pageCoverage.pagesUncertainAndNotCounted).toEqual([])
    expect(pageCoverage.unitRangeOnlyPagesNotCounted).toBe(0)
    expect(pageCoverage.unresolvedOcrPagesNotCounted).toBe(0)
    expect(pageCoverage.ocrUncertainPagesTotal).toBe(34)
    expect(pageCoverage.pageMapLinkagePercent).toBe(100)
    expect(pageCoverage.pageSummaryCoveragePercent).toBe(100)
    expect(pageCoverage.pageSummaryCoveragePercent).toBeGreaterThanOrEqual(audit.coverageThresholds.minimumPageSpecificSummaryCoveragePercent)
    expect(audit.thresholdsMet.pageSpecificSummaryCoverage).toBe(true)
    expect(pageCoverage.pagesWithLowConfidenceDetails).toEqual([
      { sourceId: 'shangrila', pdfPage: 23, printedPage: 22, fields: [{ field: 'syllableChartCells', confidence: 'low' }] },
      { sourceId: 'reader', pdfPage: 49, printedPage: 33, fields: [{ field: 'numeralChartCells', confidence: 'low' }] },
      { sourceId: 'reader', pdfPage: 97, printedPage: 81, fields: [{ field: 'referenceVocabularyEntries', confidence: 'low' }] },
      { sourceId: 'reader', pdfPage: 141, printedPage: 125, fields: [{ field: 'climateTableLabelsAndValues', confidence: 'low' }] },
    ])
    expect(pageCoverage.ocrUncertainPagesTotal).toBeGreaterThan(0)
    expect(audit.fullCourseCoverageClaim).toBe(false)
    expect(audit.completeTextTranscription).toBe(false)

    const pageRecordIds = new Set<string>()
    for (const page of richCorpus.pages) {
      const content = page.pageContent
      expect(content?.recordId).toBeTruthy()
      expect(pageRecordIds.has(content.recordId)).toBe(false)
      pageRecordIds.add(content.recordId)
      expect(Array.isArray(content.contentRefs)).toBe(true)
      for (const ref of content.contentRefs) expect(allRecordIds.has(ref), `${content.recordId} -> ${ref}`).toBe(true)
      if (!content.classification.pedagogicallySubstantive) continue
      expect(content.contentRefs.length, content.recordId).toBeGreaterThan(0)
      expect(content.didacticSummary, content.recordId).toBeTruthy()
      for (const [dimension, mapping] of Object.entries(content.coverageByDimension)) {
        expect((mapping as Record<string, any>).status, `${content.recordId}.${dimension}`).toBeTruthy()
        expect((mapping as Record<string, any>).basis, `${content.recordId}.${dimension}`).toBeTruthy()
        for (const ref of (mapping as Record<string, any>).recordIds) expect(allRecordIds.has(ref), `${content.recordId}.${dimension} -> ${ref}`).toBe(true)
      }
    }
  })

  it('records source-specific page observations and preserves uncertainty for illegible details', () => {
    const completedPages = [
      ['shangrila', 9], ['shangrila', 21], ['shangrila', 23], ['shangrila', 36], ['shangrila', 38],
      ...[24, 25, 26, 28, 42, 49, 64, 68, 76, 77, 83, 87, 88, 92, 97, 102, 122, 125, 129, 130, 137, 141, 143, 144, 148, 156, 164, 167, 169, 178, 188].map(page => ['reader', page]),
    ] as Array<[string, number]>
    const visuallyReviewed = new Set(['shangrila:9', 'shangrila:21', ...[26, 28, 64, 83, 92, 122, 129, 130, 137, 143, 144, 169, 188].map(page => `reader:${page}`)])
    const lessonsById = new Map(richLessons.map(lesson => [lesson.id, lesson]))

    expect(completedPages).toHaveLength(36)
    for (const [sourceId, pdfPage] of completedPages) {
      const page = richCorpus.pages.find(item => item.sourceId === sourceId && item.pdfPage === pdfPage)!
      const summaryId = `${page.lessonId}:page-summary:${sourceId}:${String(pdfPage).padStart(3, '0')}`
      const lesson = lessonsById.get(page.lessonId)!
      const summary = lesson.pedagogy.pageSummaries.find((item: Record<string, any>) => item.id === summaryId)
      expect(summary, summaryId).toBeTruthy()
      expect(summary.summary, summaryId).toBeTruthy()
      expect(summary.sourceTextIncluded, summaryId).toBe(false)
      expect(summary.scope, summaryId).toBe('original-brief-summary-not-transcription')
      expect(page.pageContent.contentRefs).toContain(summaryId)

      if (page.pageContent.classification.pedagogicallySubstantive) {
        expect(page.pageContent.countedAsPageSummary, summaryId).toBe(true)
        expect(page.pageContent.mappingStatus, summaryId).toBe('page-specific-evidence')
        expect(page.pageContent.coverageByDimension.sourceSummaries.recordIds).toContain(summaryId)
      } else {
        expect(page.pageContent.countedAsPageSummary, summaryId).toBe(false)
        expect(page.pageContent.classification.pageRole, summaryId).toBe('section-divider')
      }

      if (visuallyReviewed.has(`${sourceId}:${pdfPage}`)) {
        expect(page.visualReview?.status, summaryId).toBe('completed')
        expect(page.pageContent.sourceEvidence.visualReviewStatus, summaryId).toBe('human-visual-review-completed')
      } else {
        expect(page.pageContent.sourceEvidence.supplementalOcr.renderDpi, summaryId).toBe(300)
      }

      for (const field of summary.lowConfidenceDetails) {
        expect(summary.confidenceByField[field], `${summaryId}.${field}`).toBe('low')
        expect(page.pageContent.sourceEvidence.lowConfidenceDetails, summaryId).toContain(field)
      }
    }
  })
})

describe('Mandarin course progress', () => {
  it('creates empty local-only progress and stores independent per-agent tutor sessions', () => {
    const progress = defaultMandarinProgress()
    expect(progress.schemaVersion).toBe(1)
    expect(progress.activeLessonId).toBe('context')
    expect(progress.completedLessons).toEqual([])
    expect(progress.lessonStageVisits).toEqual({})
    expect(progress.chatSessionIds).toEqual({})
    expect(progress.voiceLanguage).toBe('zh-CN')
    expect(progress.shortcuts.toggleVoice).not.toEqual(progress.shortcuts.replayPhrase)
  })

  it('keeps best quiz scores bounded and never lowers a prior high score', () => {
    expect(updateBestScore({}, 'courtesy', 1, 2)).toEqual({ courtesy: 1 })
    expect(updateBestScore({ courtesy: 2 }, 'courtesy', 1, 2)).toEqual({ courtesy: 2 })
    expect(updateBestScore({}, 'courtesy', 99, 2)).toEqual({ courtesy: 2 })
    expect(updateBestScore({}, 'courtesy', -3, 2)).toEqual({ courtesy: 0 })
  })

  it('requires a review and at least two thirds correct before finishing', () => {
    expect(getQuizPassingScore(3)).toBe(2)
    expect(getQuizPassingScore(6)).toBe(4)
    expect(getQuizPassingScore(0)).toBe(0)
    expect(canFinishLesson('sounds', [], { sounds: 2 })).toBe(false)
    expect(canFinishLesson('sounds', ['sounds'], {})).toBe(false)
    expect(canFinishLesson('sounds', ['sounds'], { sounds: 0 })).toBe(false)
    expect(canFinishLesson('sounds', ['sounds'], { sounds: 1 })).toBe(false)
    expect(canFinishLesson('sounds', ['sounds'], { sounds: 2 })).toBe(true)
  })
})
