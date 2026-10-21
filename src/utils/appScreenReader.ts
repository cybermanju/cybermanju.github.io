// CyberManju OS — UI guards for the Audio-owned AndroidScreenReader API.
// No IPC here: AndroidScreenReader owns readerStart/readerStatus/readerPoll/readerStop.
import type { ReaderStatus } from '@/utils/androidScreenReader'
export const SCREEN_READER_TIMEOUT_MS = 10_000
export function emptyScreenReaderStatus(): ReaderStatus {
  return { sessionId: null, state: 'idle', packageName: null, index: 0, total: 0, overlayGranted: false,
    packages: [], mode: null, captures: [], engine: '', limitation: '' }
}
export function screenReaderActive(status: ReaderStatus): boolean {
  return ['awaiting_permission', 'selecting', 'reading'].includes(status.state)
}
export function parseScreenReaderStatus(raw: unknown): ReaderStatus {
  const invalid = () => new Error('Invalid Android reader status. Refresh status or update the Android app.')
  if (!raw || typeof raw !== 'object') throw invalid()
  const row = raw as Record<string, unknown>
  // Native session errors are lastError; error belongs to the IPC envelope.
  if (typeof row.error === 'string') throw new Error(row.error)
  const nullable = (value: unknown): value is string | null => value === null || (typeof value === 'string' && !!value.trim())
  if (!nullable(row.sessionId) || !nullable(row.packageName)
    || !['idle', 'awaiting_permission', 'selecting', 'reading', 'stopped', 'cancelled', 'error'].includes(String(row.state))
    || typeof row.overlayGranted !== 'boolean' || !Array.isArray(row.packages)
    || !row.packages.every(pkg => typeof pkg === 'string' && !!pkg.trim())
    || !Number.isInteger(row.index) || !Number.isInteger(row.total) || Number(row.index) < 0 || row.total !== row.packages.length
    || ![null, 'single', 'batch'].includes(row.mode as string | null) || !Array.isArray(row.captures)
    || typeof row.engine !== 'string' || typeof row.limitation !== 'string'
    || (row.lastError !== undefined && typeof row.lastError !== 'string')) throw invalid()
  const packages = row.packages as string[]
  if ((row.packageName !== null && !packages.includes(row.packageName))
    || row.captures.some(capture => !capture || typeof capture !== 'object'
      || !packages.includes(capture.packageName) || typeof capture.selectedAt !== 'number'
      || (capture.text !== undefined && typeof capture.text !== 'string'))
    || (['awaiting_permission', 'selecting', 'reading'].includes(String(row.state))
      && (!row.sessionId || !packages.length || Number(row.index) >= packages.length))) throw invalid()
  return { sessionId: row.sessionId, state: row.state as ReaderStatus['state'], packageName: row.packageName,
    index: row.index as number, total: row.total as number, overlayGranted: row.overlayGranted, packages: [...packages],
    mode: row.mode as ReaderStatus['mode'], captures: row.captures.map(capture => ({ ...capture })),
    engine: row.engine, limitation: row.limitation, lastError: row.lastError as string | undefined }
}
/** Bound queue wait as well as native IPC; never retry an ambiguous start. */
export async function boundedReaderRequest<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Android screen session did not respond. Check its notification, then refresh status before trying again.')), SCREEN_READER_TIMEOUT_MS)
    })])
  } finally { clearTimeout(timer) }
}
