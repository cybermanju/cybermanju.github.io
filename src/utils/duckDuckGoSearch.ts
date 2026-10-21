// CyberManju OS — DuckDuckGo Instant Answer search (src/utils/duckDuckGoSearch.ts).
// Role: fetch and normalize DuckDuckGo's public Instant Answer API into safe plain-text answers and link cards.
// Exports: DuckDuckGoResult, DuckDuckGoResponse, DuckDuckGoSearchOptions, htmlToPlainText, safeHttpUrl, duckDuckGoSearchUrl, searchDuckDuckGo.
// Integrates: browser fetch; the public api.duckduckgo.com Instant Answer endpoint, not a general web search/SERP API.
// Contracts: never exposes provider HTML; accepts safe HTTP(S) links only; bounded inputs/outputs; honors caller abort and a 10-second timeout.

export interface DuckDuckGoResult {
  title: string
  url: string
  description: string
  source: string
}

export interface DuckDuckGoResponse {
  answer: string
  answerSource: string
  answerUrl?: string
  results: DuckDuckGoResult[]
}

export interface DuckDuckGoSearchOptions {
  signal?: AbortSignal
}

const API_URL = 'https://api.duckduckgo.com/'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_QUERY_LENGTH = 500
const MAX_RESULTS = 20
const MAX_RELATED_DEPTH = 8
const MAX_ANSWER_LENGTH = 2_000
const MAX_TITLE_LENGTH = 180
const MAX_DESCRIPTION_LENGTH = 1_200
const MAX_SOURCE_LENGTH = 120
const MAX_URL_LENGTH = 2_048

const EMPTY_RESPONSE = (): DuckDuckGoResponse => ({ answer: '', answerSource: '', results: [] })

/** Decode HTML entities without treating provider markup as executable content. */
function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ',
    copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
    eacute: 'é', Eacute: 'É',
  }
  return value.replace(/&(#(?:x[\da-f]{1,8}|\d{1,8})|[a-z][a-z\d]{1,31});/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const hex = body[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\uFFFD'
      try { return String.fromCodePoint(codePoint) } catch { return '\uFFFD' }
    }
    return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : entity
  })
}

/**
 * Convert potentially HTML-formatted API fields into bounded plain text.
 * DOMParser is used when available; the conservative parser fallback supports Node tests and non-DOM runtimes.
 */
export function htmlToPlainText(value: unknown, maxLength = MAX_DESCRIPTION_LENGTH): string {
  if (typeof value !== 'string' || maxLength <= 0) return ''
  let text = value
  if (typeof DOMParser !== 'undefined') {
    try {
      const document = new DOMParser().parseFromString(value, 'text/html')
      document.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove())
      text = document.body?.textContent ?? document.documentElement?.textContent ?? ''
    } catch {
      // Fall through to the non-DOM parser for incomplete DOM implementations.
    }
  }
  if (text === value) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  }
  return decodeEntities(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maxLength).trim()
}

/** Return a canonical HTTP(S) URL, resolving DuckDuckGo's outbound wrapper when safe. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH * 2) return undefined
  let candidate = value.trim()
  try {
    let parsed = new URL(candidate)
    if ((parsed.hostname === 'duckduckgo.com' || parsed.hostname === 'www.duckduckgo.com') && parsed.pathname === '/l/') {
      const destination = parsed.searchParams.get('uddg')
      if (!destination) return undefined
      candidate = destination
      parsed = new URL(candidate)
    }
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return undefined
    if (!parsed.hostname || parsed.hostname.includes('%')) return undefined
    const normalized = parsed.href
    return normalized.length <= MAX_URL_LENGTH ? normalized : undefined
  } catch {
    return undefined
  }
}

/** Build a safe link to DuckDuckGo's own search page. */
export function duckDuckGoSearchUrl(query: string): string {
  const normalizedQuery = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  return `https://duckduckgo.com/?q=${encodeURIComponent(normalizedQuery)}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function cleanField(value: unknown, limit: number): string {
  return htmlToPlainText(value, limit)
}

function sourceFor(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, '').slice(0, MAX_SOURCE_LENGTH) } catch { return '' }
}

function resultFrom(value: unknown, fallbackTitle = ''): DuckDuckGoResult | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const rawResult = typeof item.Result === 'string' ? item.Result : ''
  let resultAnchorText = ''
  let resultAnchorUrl: string | undefined
  if (rawResult) {
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(rawResult)
    if (anchor) {
      resultAnchorText = cleanField(anchor[2], MAX_TITLE_LENGTH)
      const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(anchor[1])?.[2]
      resultAnchorUrl = safeHttpUrl(href)
    }
  }
  const url = safeHttpUrl(item.FirstURL) ?? resultAnchorUrl
  if (!url) return undefined
  const text = cleanField(item.Text, MAX_DESCRIPTION_LENGTH)
  const description = text || cleanField(rawResult, MAX_DESCRIPTION_LENGTH)
  const title = cleanField(item.Heading, MAX_TITLE_LENGTH)
    || resultAnchorText
    || cleanField(fallbackTitle, MAX_TITLE_LENGTH)
    || text.split(/\s(?:-|—|–)\s/, 1)[0].slice(0, MAX_TITLE_LENGTH).trim()
    || sourceFor(url)
  if (!title && !description) return undefined
  return { title, url, description, source: sourceFor(url) }
}

/** Normalize provider fields, nested related topics, and result arrays into a bounded set of direct safe links. */
function normalizeResponse(payload: unknown): DuckDuckGoResponse {
  const data = asRecord(payload)
  if (!data) return EMPTY_RESPONSE()

  const abstract = cleanField(data.AbstractText, MAX_ANSWER_LENGTH)
  const directAnswer = cleanField(data.Answer, MAX_ANSWER_LENGTH)
  const answer = abstract || directAnswer || cleanField(data.Definition, MAX_ANSWER_LENGTH)
  // A calculator/direct Answer must not borrow an unrelated abstract or dictionary citation.
  const answerUrl = abstract ? safeHttpUrl(data.AbstractURL) : directAnswer ? undefined : safeHttpUrl(data.DefinitionURL)
  const answerSource = (abstract ? cleanField(data.AbstractSource, MAX_SOURCE_LENGTH)
    : directAnswer ? 'DuckDuckGo' : cleanField(data.DefinitionSource, MAX_SOURCE_LENGTH))
    || (answerUrl ? sourceFor(answerUrl) : '')

  const results: DuckDuckGoResult[] = []
  const seenUrls = new Set<string>()
  const add = (candidate: DuckDuckGoResult | undefined): void => {
    if (!candidate || results.length >= MAX_RESULTS || seenUrls.has(candidate.url)) return
    seenUrls.add(candidate.url)
    results.push(candidate)
  }

  const providerResults = Array.isArray(data.Results) ? data.Results : []
  for (const item of providerResults) {
    add(resultFrom(item))
    if (results.length >= MAX_RESULTS) break
  }

  const visitTopics = (topics: unknown, depth: number): void => {
    if (!Array.isArray(topics) || depth > MAX_RELATED_DEPTH || results.length >= MAX_RESULTS) return
    for (const topic of topics) {
      if (results.length >= MAX_RESULTS) return
      const record = asRecord(topic)
      if (!record) continue
      if (Array.isArray(record.Topics)) {
        visitTopics(record.Topics, depth + 1)
      } else {
        add(resultFrom(record, typeof record.Name === 'string' ? record.Name : ''))
      }
    }
  }
  visitTopics(data.RelatedTopics, 0)

  return {
    answer,
    answerSource,
    ...(answerUrl ? { answerUrl } : {}),
    results,
  }
}

function makeAbortError(): Error {
  try { return new DOMException('The DuckDuckGo search was aborted.', 'AbortError') } catch {
    const error = new Error('The DuckDuckGo search was aborted.')
    error.name = 'AbortError'
    return error
  }
}

function makeTimeoutError(): Error {
  try { return new DOMException('The DuckDuckGo search timed out after 10 seconds.', 'TimeoutError') } catch {
    const error = new Error('The DuckDuckGo search timed out after 10 seconds.')
    error.name = 'TimeoutError'
    return error
  }
}

/** Fetch DuckDuckGo Instant Answers. This API is not a full search-engine results page. */
export async function searchDuckDuckGo(
  query: string,
  options: DuckDuckGoSearchOptions = {},
): Promise<DuckDuckGoResponse> {
  const normalizedQuery = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  if (!normalizedQuery) return EMPTY_RESPONSE()
  if (options.signal?.aborted) throw makeAbortError()

  const url = new URL(API_URL)
  url.searchParams.set('q', normalizedQuery)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '0')

  const controller = new AbortController()
  let timedOut = false
  const relayAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', relayAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.href, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    // HTTP 202 is a successful API response; use Response.ok rather than requiring status 200.
    if (!response.ok) throw new Error(`DuckDuckGo Instant Answer request failed (HTTP ${response.status}).`)
    return normalizeResponse(await response.json())
  } catch (error) {
    if (timedOut) throw makeTimeoutError()
    if (options.signal?.aborted) throw makeAbortError()
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', relayAbort)
  }
}
