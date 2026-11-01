import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { MANDARIN_CORPUS, MANDARIN_LESSONS } from '@/utils/mandarinCourse'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
const template = instructor.split('<script setup lang="ts">')[0]
const script = instructor.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('MandarinInstructor script setup not found')

function compileComponentFunction(name: string, args: string[] = []) {
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script!, ts.ScriptTarget.Latest, true)
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!declaration) throw new Error(`Component function not found: ${name}`)
  const code = script!.slice(declaration.getStart(sourceFile), declaration.end)
  const compiled = ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
  return new Function(...args, `${compiled}; return ${name}`)() as (...values: any[]) => any
}

const buildPageSummaryCatalog = compileComponentFunction('buildPageSummaryCatalog')
const filterPageSummaryCatalog = compileComponentFunction('filterPageSummaryCatalog')
const buildTutorSourcePageContext = compileComponentFunction('buildTutorSourcePageContext')
const corpusPageRows = MANDARIN_CORPUS.pages as unknown as Array<Record<string, any>>
const pageSummaries = buildPageSummaryCatalog(corpusPageRows) as Array<Record<string, any>>
const lessonPageSummaryIds = new Set(
  (MANDARIN_LESSONS as unknown as Array<{ pedagogy?: { pageSummaries?: Array<{ id?: string }> } }>)
    .flatMap(lesson => lesson.pedagogy?.pageSummaries ?? [])
    .map(item => item.id)
    .filter((id): id is string => !!id),
)

describe('Language Teacher page-summary navigation and Agent context', () => {
  it('makes every substantive corpus summary available and quantifies the former lesson-list gap', () => {
    const substantivePages = corpusPageRows.filter(page => page.pageContent?.classification?.pedagogicallySubstantive)
    expect(substantivePages).toHaveLength(232)
    expect(pageSummaries).toHaveLength(232)
    expect(new Set(pageSummaries.map(page => page.key)).size).toBe(232)
    expect(pageSummaries.every(page => page.summary && page.summaryRecordId !== undefined)).toBe(true)

    const listed = pageSummaries.filter(page => lessonPageSummaryIds.has(page.summaryRecordId))
    const catalogOnly = pageSummaries.filter(page => !lessonPageSummaryIds.has(page.summaryRecordId))
    expect(listed).toHaveLength(93)
    expect(catalogOnly).toHaveLength(139)
    expect(pageSummaries.every(page => page.lessonId && page.pageTitle !== undefined)).toBe(true)
  })

  it('keeps all 232 pages reachable through the same search, select, and previous/next catalog', () => {
    expect(filterPageSummaryCatalog(pageSummaries, '')).toHaveLength(232)
    for (const page of pageSummaries) {
      expect(filterPageSummaryCatalog(pageSummaries, page.key).some(match => match.key === page.key), page.key).toBe(true)
    }
    expect(template).toContain('v-model="sourcePageSearch"')
    expect(template).toContain('v-model="selectedSourcePageKey"')
    expect(template).toContain('v-for="page in filteredSourcePageSummaries"')
    expect(template).toContain('@click="moveSourcePage(-1)"')
    expect(template).toContain('@click="moveSourcePage(1)"')
    expect(template).toContain('@click="studySelectedSourcePage"')
    expect(template).toContain('Cobertura por página não significa cobertura integral do curso nem transcrição integral.')
  })

  it('passes each selected page summary and its provenance/caveats into the tutor prompt context', () => {
    expect(script).toContain('buildTutorSourcePageContext(tutorSourcePage.value)')
    for (const page of pageSummaries) {
      const context = buildTutorSourcePageContext(page) as string
      expect(context, page.key).toContain(page.summary)
      expect(context, page.key).toContain('não uma transcrição integral')
      if (page.mappingNote) expect(context, page.key).toContain(page.mappingNote)
      if (page.contentUncertainty) expect(context, page.key).toContain(page.contentUncertainty)
      for (const field of page.lowConfidenceFields) expect(context, page.key).toContain(field)
      if (page.reviewNote) expect(context, page.key).toContain(page.reviewNote)
      if (page.visualReview) expect(context, page.key).toContain(page.visualReview)
    }
  })

  it('preserves the four page-specific low-confidence detail groups in both catalog and Agent context', () => {
    const details = pageSummaries.flatMap(page => page.lowConfidenceFields)
    expect(new Set(details)).toEqual(new Set([
      'syllableChartCells',
      'numeralChartCells',
      'referenceVocabularyEntries',
      'climateTableLabelsAndValues',
    ]))
    for (const field of details) {
      expect(template).toContain('selectedSourcePage.lowConfidenceFields.join')
      const page = pageSummaries.find(item => item.lowConfidenceFields.includes(field))!
      expect(buildTutorSourcePageContext(page)).toContain(field)
    }
  })
})
