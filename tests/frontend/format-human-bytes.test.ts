// CyberManju OS — Byte size formatting (tests/frontend/format-human-bytes.test.ts).
// Role: keep cross-transport file and disk size displays nonnegative and finite.
// Exports: none.
// Integrates: shared format utility, Vitest.
// Contracts: invalid sizes use 0 B; valid binary units and rounding stay unchanged.
import { describe, expect, it } from 'vitest'
import { humanBytes } from '@/utils/format'

describe('humanBytes', () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, -1, -1024, 0, -0])(
    'uses the existing zero fallback for invalid or nonpositive size %s', (bytes) => {
      expect(humanBytes(bytes)).toBe('0 B')
    },
  )

  it.each([
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [1024 ** 2, '1.0 MB'],
    [1024 ** 3, '1.0 GB'],
    [1024 ** 4, '1.0 TB'],
    [1024 ** 5, '1024 TB'],
  ] as const)('preserves formatting of %s as %s', (bytes, expected) => {
    expect(humanBytes(bytes)).toBe(expected)
  })

  it('keeps representative extreme values free of negative or non-finite text', () => {
    for (const bytes of [Number.MIN_VALUE, 0.5, Number.MAX_VALUE, -Number.MAX_VALUE, NaN, Infinity]) {
      expect(humanBytes(bytes)).not.toMatch(/^-|NaN|Infinity/)
    }
  })
})
