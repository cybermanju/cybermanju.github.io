// CyberManju OS — Clipboard fallback (tests/frontend/clipboard-fallback.test.ts).
// Role: regression tests for cross-browser clipboard writes.
// Exports: none.
// Integrates: Vitest, src/utils/clipboard.ts.
// Contracts: failed/missing Async Clipboard writes fall back and always clean up.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '@/utils/clipboard'

afterEach(() => vi.unstubAllGlobals())

describe('copyToClipboard', () => {
  it('prefers the Async Clipboard API when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const fallbackCopy = vi.fn(() => true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyToClipboard('share URL', { fallbackCopy })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('share URL')
    expect(fallbackCopy).not.toHaveBeenCalled()
  })

  it('uses a temporary textarea when the Async Clipboard API is rejected', async () => {
    const textarea = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    }
    const appendChild = vi.fn()
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => textarea),
      execCommand,
    })

    await expect(copyToClipboard('share URL')).resolves.toBe(true)
    expect(textarea.value).toBe('share URL')
    expect(textarea.setAttribute).toHaveBeenCalledWith('readonly', '')
    expect(textarea.select).toHaveBeenCalledOnce()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(textarea.remove).toHaveBeenCalledOnce()
  })

  it('returns false and still removes the temporary field when fallback copying fails', async () => {
    const textarea = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    }
    vi.stubGlobal('navigator', { clipboard: undefined })
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => false),
    })

    await expect(copyToClipboard('share URL')).resolves.toBe(false)
    expect(textarea.remove).toHaveBeenCalledOnce()
  })
})
