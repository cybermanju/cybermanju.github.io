// CyberManju OS — Android window session tests (tests/frontend/window-session.test.ts).
// Role: Verify bounded, safe serialization for restoring app windows after Android process reclamation.
// Exports: Vitest suite.
// Integrates: src/utils/windowSession.ts.
// Contracts: Session data never carries arbitrary props, malformed records, or unbounded window lists.
import { describe, expect, it } from 'vitest'
import { parseWindowSession, serializeWindowSession, type WindowSessionSnapshot } from '../../src/utils/windowSession'

const sample: WindowSessionSnapshot = {
  windows: [{
    id: 'win-7', panelType: 'disks', x: 24, y: 42, width: 700, height: 540,
    minimized: false, zIndex: 17, column: 2, line: 1,
    props: { tab: 'backup', diskId: 'disk-42', secret: 'must not persist' } as Record<string, string>,
  }],
  focusHistory: ['win-7'],
  stripOffset: 2,
  stripLine: 1,
}

describe('Android window session checkpoint', () => {
  it('round trips geometry, focus and bounded non-sensitive panel routing props', () => {
    const parsed = parseWindowSession(serializeWindowSession(sample))
    expect(parsed).toMatchObject({
      windows: [{ id: 'win-7', panelType: 'disks', x: 24, y: 42, width: 700, height: 540, props: { tab: 'backup', diskId: 'disk-42' } }],
      focusHistory: ['win-7'], stripOffset: 2, stripLine: 1,
    })
    expect(parsed?.windows[0].props).not.toHaveProperty('secret')
  })

  it('rejects malformed snapshots and bounds untrusted fields', () => {
    expect(parseWindowSession('{')).toBeNull()
    expect(parseWindowSession(JSON.stringify({ version: 2, windows: [] }))).toBeNull()
    const parsed = parseWindowSession(JSON.stringify({
      version: 1,
      windows: [
        { ...sample.windows[0], x: 99_000_000, width: 99_000_000 },
        { ...sample.windows[0], panelType: '__proto__' },
        sample.windows[0],
      ],
      focusHistory: ['win-7', 'win-999'], stripOffset: -5, stripLine: 2,
    }))
    expect(parsed?.windows).toHaveLength(1)
    expect(parsed?.windows[0].x).toBe(1_000_000)
    expect(parsed?.windows[0].width).toBe(10_000)
    expect(parsed?.focusHistory).toEqual(['win-7'])
    expect(parsed?.stripOffset).toBe(0)
  })

  it('caps window count and ignores unknown or credential-like props', () => {
    const windows = Array.from({ length: 40 }, (_, index) => ({
      ...sample.windows[0], id: `win-${index + 1}`, props: { tab: 'settings', apiKey: 'secret', passphrase: 'secret' },
    }))
    const parsed = parseWindowSession(serializeWindowSession({ ...sample, windows }))
    expect(parsed?.windows).toHaveLength(8)
    expect(parsed?.windows[0].props).toEqual({ tab: 'settings' })
  })
})
