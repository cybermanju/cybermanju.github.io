// CyberManju OS — CSV.test (tests/frontend/csv.test.ts).
// ANALYSIS.md §4.9: cheap dataset view.
import { describe, expect, it } from 'vitest'
import { inferColumnType, parseDelimited, sniffDelimiter } from '../../src/utils/csv'

describe('sniffDelimiter', () => {
  it('picks tab/semicolon/comma', () => {
    expect(sniffDelimiter('a\tb\n')).toBe('\t')
    expect(sniffDelimiter('a;b\n')).toBe(';')
    expect(sniffDelimiter('a,b\n')).toBe(',')
    expect(sniffDelimiter('')).toBe(',')
  })

  it.each([
    ['"Last, first, title";Age', ';'],
    ['"Last, first, title"\tAge', '\t'],
    ['"Many; semicolons; here",Age', ','],
    ['"Many\ttabs\there",Age', ','],
    ['"Say ""hello, there, friend""";Age', ';'],
    ['"Only; quoted; punctuation"', ','],
  ])('ignores quoted punctuation in %s', (header, delimiter) => {
    expect(sniffDelimiter(header)).toBe(delimiter)
  })

  it('keeps ignoring leading blank lines and CRLF endings', () => {
    expect(sniffDelimiter('\r\n  \r\n"Name, aliases, tags";Age\r\nAda;36')).toBe(';')
  })

  it('sniffs only the first non-empty CR-delimited line, not punctuation in later rows', () => {
    expect(sniffDelimiter('\r  \rName;Note\rAda;one,two,three\r')).toBe(';')
  })
})

describe('parseDelimited', () => {
  it('parses quotes, escaped quotes, embedded newlines', () => {
    const t = parseDelimited('name,note\n"a, b","say ""hi"""\n"c","line1\nline2"')
    expect(t?.columns).toEqual(['name', 'note'])
    expect(t?.rows).toEqual([
      ['a, b', 'say "hi"'],
      ['c', 'line1\nline2'],
    ])
  })

  it.each([';', '\t'])('auto-detects %s despite commas in a quoted header', (delimiter) => {
    const table = parseDelimited(`"Last, first, title"${delimiter}Age\r\n"Lovelace, Ada"${delimiter}36\r\n`)
    expect(table).toEqual({
      columns: ['Last, first, title', 'Age'],
      rows: [['Lovelace, Ada', '36']],
      delimiter,
      truncated: false,
    })
  })

  it.each(['\n', '\r\n', '\r'])('parses records separated by %j and preserves quoted line endings', (ending) => {
    const table = parseDelimited(`name;note${ending}Ada;"line1${ending}line2"${ending}Grace;plain${ending}`)
    expect(table).toEqual({
      columns: ['name', 'note'],
      rows: [['Ada', `line1${ending}line2`], ['Grace', 'plain']],
      delimiter: ';',
      truncated: false,
    })
  })

  it('handles mixed record endings without merging cells', () => {
    const table = parseDelimited('name,note\rAda,one\nGrace,two\r\nLinus,three\r')
    expect(table?.columns).toEqual(['name', 'note'])
    expect(table?.rows).toEqual([['Ada', 'one'], ['Grace', 'two'], ['Linus', 'three']])
  })

  it('preserves explicit delimiter selection for CR records', () => {
    const table = parseDelimited('name,note\rAda,one;two;three\r', ',')
    expect(table?.delimiter).toBe(',')
    expect(table?.rows).toEqual([['Ada', 'one;two;three']])
  })

  it('refuses NUL/binary input', () => {
    expect(parseDelimited('a\0b')).toBeNull()
  })

  it('keeps exactly 100 columns complete', () => {
    const cells = Array.from({ length: 100 }, (_, i) => `cell${i}`)
    const table = parseDelimited(`${cells.join(',')}\n${cells.join(',')}`)
    expect(table?.columns).toEqual(cells)
    expect(table?.rows).toEqual([cells])
    expect(table?.truncated).toBe(false)
  })

  it.each(['', '\n'])('flags an oversized header finalized with %j', (ending) => {
    const columns = Array.from({ length: 101 }, (_, i) => `col${i}`)
    const table = parseDelimited(`${columns.join(',')}${ending}`)
    expect(table?.columns).toEqual(columns.slice(0, 100))
    expect(table?.rows).toEqual([])
    expect(table?.truncated).toBe(true)
  })

  it('flags oversized data rows without dropping later records', () => {
    const columns = Array.from({ length: 100 }, (_, i) => `col${i}`)
    const wide = Array.from({ length: 101 }, (_, i) => `value${i}`)
    const later = Array.from({ length: 100 }, (_, i) => `later${i}`)
    const table = parseDelimited([columns.join(','), wide.join(','), later.join(',')].join('\n'))
    expect(table?.columns).toEqual(columns)
    expect(table?.rows).toEqual([wide.slice(0, 100), later])
    expect(table?.truncated).toBe(true)
  })

  it.each(['\n', '\r\n', '\r'])('caps rows and flags truncation with %j endings', (ending) => {
    const big = `h${ending}${`v${ending}`.repeat(6000)}`
    const t = parseDelimited(big)!
    expect(t.truncated).toBe(true)
    expect(t.rows.length).toBeLessThanOrEqual(5000)
  })
})

describe('inferColumnType', () => {
  it('detects number/date/text', () => {
    expect(inferColumnType(['1', '2.5', ''])).toBe('number')
    expect(inferColumnType(['2026-01-01', '2026-02-01'])).toBe('date')
    expect(inferColumnType(['a', '1'])).toBe('text')
    expect(inferColumnType([])).toBe('text')
  })
})
