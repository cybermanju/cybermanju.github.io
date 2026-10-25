// CyberManju OS — Android file manager session tests (tests/frontend/file-manager-session.test.ts).
// Role: Verify safe path/view checkpoints for returning after Android reclaims the WebView.
// Exports: Vitest suite.
// Integrates: src/utils/fileManagerSession.ts.
// Contracts: Only bounded absolute paths and supported views survive parsing.
import { describe, expect, it } from 'vitest'
import { parseFileManagerSession, serializeFileManagerSession } from '../../src/utils/fileManagerSession'

describe('Android file manager checkpoint', () => {
  it('round trips the current path and view', () => {
    const raw = serializeFileManagerSession({ path: '/photos/trips', view: 'masonry' })
    expect(parseFileManagerSession(raw)).toEqual({ path: '/photos/trips', view: 'masonry' })
  })

  it('rejects malformed, relative, control-character, oversized and unsupported state', () => {
    expect(parseFileManagerSession('{')).toBeNull()
    expect(parseFileManagerSession(JSON.stringify({ path: 'photos', view: 'grid' }))).toBeNull()
    expect(parseFileManagerSession(JSON.stringify({ path: '/photos\nsecret', view: 'grid' }))).toBeNull()
    expect(parseFileManagerSession(JSON.stringify({ path: '/photos', view: 'columns' }))).toBeNull()
    expect(parseFileManagerSession(JSON.stringify({ path: `/${'x'.repeat(2_050)}`, view: 'list' }))).toBeNull()
  })
})
