// CyberManju OS — DuckDuckGo search.test (tests/frontend/duckduckgo-search.test.ts).
// Role: verify bounded Instant Answer normalization, safe links, plain-text handling, and fetch lifecycle behavior.
// Exports: test suite.
// Integrates: src/utils/duckDuckGoSearch.ts; mocked browser fetch.
// Contracts: provider HTML is never trusted, unsafe URLs are excluded, and no general-SERP results are fabricated.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  duckDuckGoSearchUrl,
  htmlToPlainText,
  safeHttpUrl,
  searchDuckDuckGo,
  type DuckDuckGoResponse,
} from '../../src/utils/duckDuckGoSearch'

function jsonResponse(payload: unknown, status = 202): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DuckDuckGo Instant Answer client', () => {
  it('keeps em-dash descriptions separate from titles and does not misattribute direct answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      Answer: '42', AbstractURL: 'https://example.org/unrelated', AbstractSource: 'Unrelated source',
      RelatedTopics: [{ FirstURL: 'https://example.org/topic', Text: 'Quasar research — Read this full description.' }],
    })))
    const result = await searchDuckDuckGo('42')
    expect(result.answerSource).toBe('DuckDuckGo')
    expect(result.answerUrl).toBeUndefined()
    expect(result.results[0].title).toBe('Quasar research')
    expect(result.results[0].description).toContain('Read this full description.')
  })

  it('requests the public endpoint with bounded query and privacy-safe fetch settings; accepts HTTP 202', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      AbstractText: 'A useful instant answer.',
      AbstractURL: 'https://example.org/topic',
      AbstractSource: 'Example',
      RelatedTopics: [{ FirstURL: 'https://example.org/related', Text: 'Related - Details' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchDuckDuckGo('  test query  ')
    expect(result.answer).toBe('A useful instant answer.')
    expect(result.answerSource).toBe('Example')
    expect(result.answerUrl).toBe('https://example.org/topic')
    expect(result.results).toEqual([{
      title: 'Related',
      url: 'https://example.org/related',
      description: 'Related - Details',
      source: 'example.org',
    }])

    const [requestedUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(requestedUrl)
    expect(parsed.origin + parsed.pathname).toBe('https://api.duckduckgo.com/')
    expect(parsed.searchParams.get('q')).toBe('test query')
    expect(parsed.searchParams.get('format')).toBe('json')
    expect(parsed.searchParams.get('no_html')).toBe('1')
    expect(parsed.searchParams.get('skip_disambig')).toBe('0')
    expect(init).toMatchObject({
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('normalizes HTML fields and strips script/style content without returning markup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      Heading: '<b>Study</b>',
      AbstractText: '<p>Useful &amp; safe <script>alert(1)</script><style>.hidden{}</style>answer</p>',
      AbstractURL: 'https://example.org/a',
      AbstractSource: '<i>Journal</i>',
      Answer: '<strong>fallback answer</strong>',
      Definition: 'definition only when earlier answer fields are blank',
      Results: [{
        FirstURL: 'https://example.org/r',
        Text: 'A <em>plain</em> description &mdash; with detail.',
        Result: '<a href="javascript:alert(1)"><b>Card title</b></a>',
      }],
    })))

    const response = await searchDuckDuckGo('html')
    expect(response.answer).toBe('Useful & safe answer')
    expect(response.answerSource).toBe('Journal')
    expect(response.results).toEqual([{
      title: 'Card title',
      url: 'https://example.org/r',
      description: 'A plain description — with detail.',
      source: 'example.org',
    }])
    expect(JSON.stringify(response)).not.toMatch(/<\/?(?:script|style|p|b|a)\b/i)
    expect(htmlToPlainText('<script>bad()</script><div>Good&nbsp;text</div>')).toBe('Good text')
  })

  it('normalizes answer and definition fallbacks while omitting unsafe answer URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      Answer: '<b>Direct answer</b>',
      AbstractURL: 'javascript:alert(1)',
      AbstractSource: ' ',
      Definition: 'Not selected when Answer exists',
      DefinitionURL: 'https://user:pass@example.org/definition',
      DefinitionSource: 'Dictionary',
    })))
    const response = await searchDuckDuckGo('answer')
    expect(response).toEqual({ answer: 'Direct answer', answerSource: 'DuckDuckGo', results: [] })
  })

  it('accepts Definition when earlier answer fields are missing and returns no URL when there is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Definition: 'Term meaning', DefinitionSource: 'Lexicon' })))
    const response: DuckDuckGoResponse = await searchDuckDuckGo('definition')
    expect(response).toEqual({ answer: 'Term meaning', answerSource: 'Lexicon', results: [] })
    expect('answerUrl' in response).toBe(false)
  })

  it('flattens nested RelatedTopics, deduplicates direct URLs, and caps cards at twenty', async () => {
    const related = [
      { Name: 'Group', Topics: [{ FirstURL: 'https://example.org/one', Text: 'Duplicate - ignored' }] },
      ...Array.from({ length: 24 }, (_, index) => ({ FirstURL: `https://example.org/${index + 2}`, Text: `Item ${index + 2} - Detail` })),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      Results: [{ FirstURL: 'https://example.org/one', Text: 'One - Detail' }],
      RelatedTopics: related,
    })))
    const response = await searchDuckDuckGo('many')
    expect(response.results).toHaveLength(20)
    expect(new Set(response.results.map((item) => item.url)).size).toBe(20)
    expect(response.results[0]?.url).toBe('https://example.org/one')
  })

  it('rejects unsafe schemes and credentials, unwraps DuckDuckGo redirects, and builds encoded search URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('data:text/html,hello')).toBeUndefined()
    expect(safeHttpUrl('https://user:pw@example.org/private')).toBeUndefined()
    expect(safeHttpUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdirect')).toBe('https://example.org/direct')
    expect(safeHttpUrl('https://duckduckgo.com/l/?uddg=javascript%3Aalert%281%29')).toBeUndefined()
    expect(duckDuckGoSearchUrl('  hello world  ')).toBe('https://duckduckgo.com/?q=hello%20world')
    expect(new URL(duckDuckGoSearchUrl('x'.repeat(700))).searchParams.get('q')).toHaveLength(500)
  })

  it('returns an empty response for malformed JSON structures and skips malformed entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ Results: 'not-an-array', RelatedTopics: [{ Topics: 'nope' }, null, { FirstURL: 'file:///etc/passwd', Text: 'unsafe' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchDuckDuckGo('bad')).toEqual({ answer: '', answerSource: '', results: [] })
    expect(await searchDuckDuckGo('bad again')).toEqual({ answer: '', answerSource: '', results: [] })
  })

  it('does not issue a request for a blank query and rejects non-success HTTP statuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchDuckDuckGo('  ')).toEqual({ answer: '', answerSource: '', results: [] })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(searchDuckDuckGo('failure')).rejects.toThrow('HTTP 500')
  })

  it('honors a pre-aborted and an in-flight caller signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchDuckDuckGo('pre-aborted', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })))
    const pendingController = new AbortController()
    const pending = searchDuckDuckGo('cancel me', { signal: pendingController.signal })
    pendingController.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts a stalled request after ten seconds and reports a timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })))
    const pending = searchDuckDuckGo('slow')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })
})
