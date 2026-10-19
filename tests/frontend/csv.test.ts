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

  it('refuses NUL/binary input', () => {
    expect(parseDelimited('a\0b')).toBeNull()
  })

  it('caps rows and flags truncation', () => {
    const big = `h\n${'v\n'.repeat(6000)}`
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
