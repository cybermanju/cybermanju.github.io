// CyberManju OS — File Manager session (src/utils/fileManagerSession.ts).
// Role: Validate the small Android file-browsing checkpoint restored after WebView process recreation.
// Exports: FileManagerSession, parseFileManagerSession, serializeFileManagerSession.
// Integrates: FileManager.vue and Android app-private localStorage.
// Contracts: Absolute bounded paths and supported views only; no credentials or file contents.

export type FileManagerSessionView = 'grid' | 'list' | 'masonry'

export interface FileManagerSession {
  path: string
  view: FileManagerSessionView
}

export function parseFileManagerSession(raw: string | null | undefined): FileManagerSession | null {
  if (!raw || raw.length > 3_000) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.path !== 'string' || value.path.length > 2_048 || !value.path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(value.path)) return null
    if (!['grid', 'list', 'masonry'].includes(String(value.view))) return null
    return { path: value.path, view: value.view as FileManagerSessionView }
  } catch {
    return null
  }
}

export function serializeFileManagerSession(session: FileManagerSession): string {
  const parsed = parseFileManagerSession(JSON.stringify(session))
  return JSON.stringify(parsed ?? { path: '/', view: 'grid' })
}
