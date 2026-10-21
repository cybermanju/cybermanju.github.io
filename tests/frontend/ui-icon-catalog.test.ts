import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureUiIconCatalog, readUiIconImage } from '../../src/utils/uiIconCatalog'

afterEach(() => vi.unstubAllGlobals())
describe('UI icon catalog and uploads', () => {
  it('offers the complete offline catalog, including names unused by the default UI', async () => {
    const names = await ensureUiIconCatalog()
    expect(names.length).toBeGreaterThan(7000)
    expect(names).toContain('solar:camera-bold')
    expect(names).toContain('solar:cat-outline')
    expect(await ensureUiIconCatalog()).toBe(names)
  })
  it('rejects executable, unsupported, or oversized uploads before decoding', async () => {
    await expect(readUiIconImage({ type: 'image/svg+xml', size: 100 } as File)).rejects.toThrow('PNG')
    await expect(readUiIconImage({ type: 'text/html', size: 100 } as File)).rejects.toThrow('PNG')
    await expect(readUiIconImage({ type: 'image/png', size: 9 * 1024 * 1024 } as File)).rejects.toThrow('8 MB')
  })
  it('preserves aspect ratio and revokes temporary image URLs after conversion', async () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:local', revokeObjectURL: revoke })
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 600; naturalHeight = 300; decode = async () => {} })
    const draw = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: () => 'data:image/png;base64,aGVsbG8=' }
    vi.stubGlobal('document', { createElement: () => canvas })
    expect(await readUiIconImage({ type: 'image/png', size: 100 } as File)).toContain('data:image/png')
    expect(canvas.width).toBe(192)
    expect(canvas.height).toBe(96)
    expect(draw).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:local')
  })
  it('revokes image URLs even when decoding fails', async () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:bad', revokeObjectURL: revoke })
    vi.stubGlobal('Image', class { src = ''; decode = async () => { throw new Error('bad image') } })
    await expect(readUiIconImage({ type: 'image/png', size: 100 } as File)).rejects.toThrow('bad image')
    expect(revoke).toHaveBeenCalledWith('blob:bad')
  })
})
