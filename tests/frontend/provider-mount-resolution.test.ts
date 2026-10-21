// CyberManju OS — provider mount resolution regression tests.
// These cover recovery when a route survives but the persisted VFS mount row does not.
import { describe, expect, it } from 'vitest'
import {
  resolveProviderConfigId,
  stableProviderMountId,
} from '../../src/utils/providerMountResolution'

const configs = [{ id: '19c173c8-e52e-40b2-9fb1-6d65c13f056f' }, { id: 'cfg-other' }]

describe('provider route repair resolution', () => {
  it('resolves an existing mount through its exact config mapping', () => {
    expect(resolveProviderConfigId('mount-old', configs, [{ id: 'mount-old', configId: 'cfg-other' }]))
      .toBe('cfg-other')
  })

  it('resolves a stale route whose id is exactly a current config id', () => {
    expect(resolveProviderConfigId(configs[0].id, configs, []))
      .toBe(configs[0].id)
  })

  it('resolves a pending route only when its complete config id exists', () => {
    expect(resolveProviderConfigId('pending-cfg-other', configs, [])).toBe('cfg-other')
    expect(resolveProviderConfigId('pending-cfg-missing', configs, [])).toBeNull()
  })

  it('never guesses another account for an unknown mount id', () => {
    expect(resolveProviderConfigId('mount-missing', configs, [])).toBeNull()
  })

  it('preserves an existing stable mount path id, or reuses the exact config id after row loss', () => {
    expect(stableProviderMountId('cfg-other', [{ id: 'mount-stable', configId: 'cfg-other' }]))
      .toBe('mount-stable')
    expect(stableProviderMountId(configs[0].id, [])).toBe(configs[0].id)
  })
})
