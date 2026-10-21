// CyberManju OS — Screen-reader adapter contracts (tests/frontend/android-screen-reader.test.ts).
// Role: Guard explicit consent, bounded package queues and native-owned lifecycle snapshots.
// Exports: Vitest suite.
// Integrates: src/utils/androidScreenReader.ts and local Android voice command.
// Contracts: No auto-retry, shared audio polling, REST transport or duplicated session state.
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/androidVoice', () => ({ androidVoiceCommand: vi.fn() }))
import { AndroidScreenReader, type ReaderStart, type ReaderStatus } from '@/utils/androidScreenReader'
import type { AndroidVoiceCommand } from '@/utils/androidVoice'

function setup() {
  const snapshot: ReaderStatus = {
    sessionId: null, state: 'idle', packageName: null, index: 0, total: 0,
    overlayGranted: true, packages: [], mode: null, captures: [], engine: 'mlkit-latin-on-device', limitation: 'Visible screen only',
  }
  const command = vi.fn().mockResolvedValue(snapshot)
  return { snapshot, command, reader: new AndroidScreenReader(command as AndroidVoiceCommand) }
}
describe('AndroidScreenReader', () => {
  it('forwards explicit one-app consent once and returns the native snapshot unchanged', async () => {
    const { reader, command, snapshot } = setup()
    expect(await reader.start({ packages: [' com.example.app '], mode: 'single', consentDisclosure: true })).toBe(snapshot)
    expect(command).toHaveBeenCalledExactlyOnceWith('readerStart', {
      packages: ['com.example.app'], mode: 'single', consentDisclosure: true, expiresAt: expect.any(Number),
    })
  })
  it('rejects disclosure bypass, empty/duplicate/malformed apps and invalid queue sizes before IPC', async () => {
    const { reader, command } = setup()
    const bad: unknown[] = [
      { packages: ['com.example.app'], mode: 'single', consentDisclosure: false },
      { packages: [], mode: 'single', consentDisclosure: true },
      { packages: ['com.example.app', 'com.example.app'], mode: 'batch', consentDisclosure: true },
      { packages: ['invalid/package'], mode: 'single', consentDisclosure: true },
      { packages: ['com.example.app'], mode: 'batch', consentDisclosure: true },
      { packages: ['com.example.app'], mode: 'hidden', consentDisclosure: true },
      { packages: Array.from({ length: 21 }, (_, i) => `com.example.app${i}`), mode: 'batch', consentDisclosure: true },
    ]
    for (const request of bad) await expect(reader.start(request as ReaderStart)).rejects.toThrow(/auth:|invalid:/)
    expect(command).not.toHaveBeenCalled()
  })
  it('uses a dedicated polling channel and reads authoritative status after resume', async () => {
    const { reader, command } = setup()
    await reader.status(); await reader.poll(); await reader.stop(); await reader.overlaySettings()
    expect(command.mock.calls.map(call => call[0])).toEqual(['readerStatus', 'readerPoll', 'readerStop', 'readerOverlaySettings'])
    expect(command).not.toHaveBeenCalledWith('poll')
  })
  it('preserves ordered batches and does not retry an ambiguous native start', async () => {
    const { reader, command } = setup()
    command.mockRejectedValueOnce(new Error('conflict: UI busy'))
    await expect(reader.start({ packages: ['com.example.second', 'com.example.first'], mode: 'batch', consentDisclosure: true })).rejects.toThrow('conflict: UI busy')
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]?.[1]?.packages).toEqual(['com.example.second', 'com.example.first'])
  })
})
