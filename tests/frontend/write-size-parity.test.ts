import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATIC_WRITE_LIMIT } from '../../src/utils/staticCybsh'

const rustOsSource = fs.readFileSync('crates/os-wasm/src/os.rs', 'utf8')

describe('cross-transport shell write limit', () => {
  it('keeps static cybsh and Rust WASM at the same 1 MiB cap', () => {
    const match = rustOsSource.match(
      /const\s+MAX_WRITE_BYTES:\s*usize\s*=\s*([\d_]+)(?:\s*\*\s*([\d_]+))?\s*;/,
    )
    expect(match, 'Rust MAX_WRITE_BYTES constant should be parseable').not.toBeNull()

    const rustLimit = Number(match![1].replaceAll('_', '')) * Number(match![2]?.replaceAll('_', '') ?? 1)
    expect(STATIC_WRITE_LIMIT).toBe(1024 * 1024)
    expect(rustLimit).toBe(STATIC_WRITE_LIMIT)
  })
})
