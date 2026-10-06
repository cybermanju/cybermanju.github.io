import { describe, expect, it } from 'vitest'
import { bestMatch, jaroWinkler, levenshtein } from '../../src/utils/fuzzyCorrect'
import {
  correctCodeWords,
  correctShellLine,
  CYBSH_COMMANDS,
  normalizeSpoken,
} from '../../src/utils/speechCorrect'

describe('levenshtein', () => {
  it('scores identical strings as zero', () => {
    expect(levenshtein('ls', 'ls')).toBe(0)
  })
  it('counts a single substitution', () => {
    expect(levenshtein('lss', 'ls')).toBe(1)
  })
})

describe('jaroWinkler', () => {
  it('prefers the closer neighbour', () => {
    expect(jaroWinkler('lss', 'ls')).toBeGreaterThan(jaroWinkler('lss', 'ps'))
  })
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('disk', 'disk')).toBe(1)
  })
})

describe('bestMatch', () => {
  it('fixes a doubled letter', () => {
    expect(bestMatch('lss', CYBSH_COMMANDS)?.match).toBe('ls')
  })
  it('returns null when nothing is close', () => {
    expect(bestMatch('zzzq', CYBSH_COMMANDS)).toBeNull()
  })
})

describe('correctShellLine', () => {
  it('repairs a typoed verb', () => {
    const r = correctShellLine('lss /tmp')
    expect(r.line).toBe('ls /tmp')
    expect(r.fixed).toBe(true)
  })
  it('expands aliases', () => {
    expect(correctShellLine('dir').line).toBe('ls')
  })
  it('repairs known subcommands', () => {
    const r = correctShellLine('disk lis')
    expect(r.line).toBe('disk list')
    expect(r.fixes).toContain('lis→list')
  })
  it('joins spoken two-letter verbs', () => {
    expect(correctShellLine('see dee /tmp').line).toBe('cd /tmp')
  })
  it('leaves unknown lines for the server did-you-mean', () => {
    const r = correctShellLine('frobnicate --json')
    expect(r.fixed).toBe(false)
    expect(r.line).toBe('frobnicate --json')
  })
})

describe('normalizeSpoken', () => {
  it('turns prose punctuation words into marks and capitalises', () => {
    expect(normalizeSpoken('hello world period how are you question mark', 'prose')).toBe(
      'Hello world. How are you?',
    )
  })
  it('turns code words into symbols', () => {
    expect(normalizeSpoken('function foo open paren bar close paren open brace', 'code')).toBe(
      'function foo(bar){',
    )
  })
  it('handles camel case phrases', () => {
    expect(normalizeSpoken('camel case foo bar', 'code')).toBe('fooBar')
  })
  it('glues shell symbols', () => {
    expect(normalizeSpoken('disk list', 'shell')).toBe('disk list')
  })
})

describe('correctCodeWords', () => {
  it('repairs STT homophones', () => {
    expect(correctCodeWords('funkshun foo cost')).toBe('function foo const')
  })
})
