import { afterEach, describe, expect, it, vi } from 'vitest'
import { setServerUrl, useTauri } from '@/composables/useTauri'
import type { FileNode } from '@/types'

function fileNode(path: string): FileNode {
  return {
    id: 'file-1',
    name: path.split('/').at(-1) ?? '',
    fileType: 'file',
    sizeBytes: 12,
    encrypted: false,
    compressionLayers: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    path,
  }
}

function stubFileList(files: FileNode[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(files), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  setServerUrl('')
})

describe('pathExists in browser transports', () => {
  it('returns true only for a listed logical file path', async () => {
    setServerUrl('http://dashboard.test')
    const fetchMock = stubFileList([fileNode('/docs/guide.md')])

    await expect(useTauri().pathExists('/docs/guide.md')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dashboard.test/api/files',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns false when the list endpoint is reachable but the path is absent', async () => {
    setServerUrl('http://dashboard.test')
    stubFileList([fileNode('/docs/guide.md')])

    await expect(useTauri().pathExists('/missing.md')).resolves.toBe(false)
  })
})
