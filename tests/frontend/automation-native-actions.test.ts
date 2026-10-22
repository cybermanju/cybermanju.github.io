// CyberManju OS — Android action catalog tests (tests/frontend/automation-native-actions.test.ts).
// Role: Mirror native input boundaries and prove every intent requires host authorization.
// Exports: none.
// Integrates: Android native catalog, ActionRegistry, WorkflowRunner and Vitest.
// Contracts: Closed opt-in IDs; exact fields, UTF-16 limits, no implicit completion or dispatch.
import { describe, expect, it, vi } from 'vitest'
import {
  ANDROID_NATIVE_ACTION_SPECS, registerAndroidNativeActions, createAutomationRegistry,
  ActionRegistry, MemoryExecutionJournal, WorkflowRunner,
  type AndroidNativeActionInputs, type Json, type NativeActionRequest, type NativeActionResponse,
} from '../../src/automation'

type Id = keyof AndroidNativeActionInputs
const valid: Record<Id, Json> = {
  'android.open_url': { url: 'https://example.com/path?q=ok#section' },
  'android.open_map': { query: 'Tokyo station' },
  'android.dial': { phone: '+55 (19) 99914-8596' },
  'android.share_text': { text: 'hello\nworld\r\t', title: 'Share' },
  'android.create_calendar_event': { title: 'Meeting', startsAtEpochMs: 0, endsAtEpochMs: 1 },
}
const ids = Object.keys(valid) as Id[]
function accepts(id: Id, input: unknown): boolean {
  return ANDROID_NATIVE_ACTION_SPECS.find(spec => spec.id === id)!.validateInput(input as Json)
}
function workflow(actionId: string, input: Json) {
  return {
    schemaVersion: 1 as const, id: 'workflow', revision: 3, entryNodeId: 'action',
    nodes: [
      { id: 'action', type: 'action' as const, actionId, input, expectedRevision: 7, next: 'end' },
      { id: 'end', type: 'end' as const },
    ],
  }
}
function bridgeFor(status: 'succeeded' | 'accepted' = 'succeeded') {
  return vi.fn(async (request: NativeActionRequest, _signal: AbortSignal): Promise<NativeActionResponse> => {
    const { input: _input, expectedRevision: _revision, ...correlation } = request
    return status === 'succeeded' ? { ...correlation, status, output: null } :
      { ...correlation, status, jobId: `external:${request.requestId}` }
  })
}

describe('closed Android native catalog', () => {
  it('is opt-in, immutable, exactly five write actions and has no wildcard', () => {
    expect(createAutomationRegistry().list().some(action => action.id.startsWith('android.'))).toBe(false)
    expect(Object.isFrozen(ANDROID_NATIVE_ACTION_SPECS)).toBe(true)
    expect(ANDROID_NATIVE_ACTION_SPECS.every(Object.isFrozen)).toBe(true)
    const registry = new ActionRegistry()
    registerAndroidNativeActions(registry, bridgeFor())
    expect(registry.list()).toEqual(ids.map(id => ({ id, effect: 'write' })))
    expect(registry.get('android.*')).toBeUndefined()
    expect(registry.get('android.intent')).toBeUndefined()
    expect(() => registerAndroidNativeActions(registry, bridgeFor())).toThrow('invalid_action_registration')
  })

  it.each(ids)('%s rejects nonobjects, missing and unknown fields', id => {
    expect(accepts(id, valid[id])).toBe(true)
    for (const input of [null, [], 'text', 1, false, {}, { ...(valid[id] as object), extra: null }]) {
      expect(accepts(id, input)).toBe(false)
    }
  })

  it('uses HTTP(S) only, rejects userinfo including empty credentials and malformed authorities', () => {
    for (const url of ['http://example.com', 'HTTPS://example.com', 'https://[::1]/', 'https://example.com/?email=a@b', 'https://example.com/#@']) {
      expect(accepts('android.open_url', { url })).toBe(true)
    }
    for (const url of ['', '/relative', '//example.com', 'https://', 'file:///etc/passwd', 'content://item',
      'mailto:a@example.com', 'javascript:alert(1)', 'intent://example', 'https://user:secret@example.com',
      'https://user@example.com', 'https://@example.com', 'https://:secret@example.com', 'https://example.com:bad',
      'https://example.com\n', 'https://example.com\u0085']) {
      expect(accepts('android.open_url', { url })).toBe(false)
    }
    const prefix = 'https://example.com/'
    expect(accepts('android.open_url', { url: prefix + 'x'.repeat(2048 - prefix.length) })).toBe(true)
    expect(accepts('android.open_url', { url: prefix + 'x'.repeat(2049 - prefix.length) })).toBe(false)
  })

  it('requires one map mode, finite numeric coordinates and inclusive ranges', () => {
    for (const input of [{ latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180, label: '' },
      { latitude: 35.68, longitude: 139.76, label: 'Tokyo' }, { query: '  Tokyo  ' }]) {
      expect(accepts('android.open_map', input)).toBe(true)
    }
    for (const input of [{ query: '' }, { query: '  ' }, { query: '\u2003' }, { query: 'Tokyo', label: '' },
      { query: 'Tokyo', latitude: 0 }, { query: 'Tokyo', longitude: 0 },
      { query: 'Tokyo', latitude: 0, longitude: 0 }, { latitude: 0 }, { longitude: 0 },
      { latitude: 90.001, longitude: 0 }, { latitude: 0, longitude: -180.001 },
      { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
      { latitude: '0', longitude: 0 }, { latitude: 0, longitude: 0, query: null }]) {
      expect(accepts('android.open_map', input)).toBe(false)
    }
  })

  it('allows only dialer punctuation, one leading plus and 3–32 ASCII digits', () => {
    for (const phone of ['123', '1'.repeat(32), '  +1 (23)-.  ', '\u2003123\u2003', '123' + ' '.repeat(61)]) {
      expect(accepts('android.dial', { phone })).toBe(true)
    }
    for (const phone of ['', '12', '1'.repeat(33), '123' + ' '.repeat(62), '123;CALL', '*123#', 'tel:123',
      '123,456', '123p456', '123/456', '12+3', '++123', '(+123)', '１２３', '١٢٣', '123\t', '123\n']) {
      expect(accepts('android.dial', { phone })).toBe(false)
    }
  })

  it('shares only nonblank text; CR/LF/TAB are allowed in text but not optional titles', () => {
    for (const text of ['text', 'x\r\n\t', '\ufeff']) expect(accepts('android.share_text', { text })).toBe(true)
    for (const text of ['', ' \r\n\t', '\u2003', 'x\u0000', 'x\u007f', 'x\u009f']) {
      expect(accepts('android.share_text', { text })).toBe(false)
    }
    expect(accepts('android.share_text', { text: 'ok', title: '' })).toBe(true)
    expect(accepts('android.share_text', { text: 'ok', title: '  ' })).toBe(true)
    expect(accepts('android.share_text', { text: 'ok', title: '\n' })).toBe(false)
  })

  it('accepts safe signed epoch milliseconds only when start is strictly before end', () => {
    const base = { title: 'Meeting' }
    for (const [startsAtEpochMs, endsAtEpochMs] of [[0, 1], [-1, 0], [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
      expect(accepts('android.create_calendar_event', { ...base, startsAtEpochMs, endsAtEpochMs })).toBe(true)
    }
    for (const [startsAtEpochMs, endsAtEpochMs] of [[0, 0], [2, 1], [0.5, 1], [0, 1.5],
      [-Number.MAX_SAFE_INTEGER - 1, 0], [0, Number.MAX_SAFE_INTEGER + 1], [NaN, 1], [0, Infinity], ['0', 1], [null, 1]]) {
      expect(accepts('android.create_calendar_event', { ...base, startsAtEpochMs, endsAtEpochMs })).toBe(false)
    }
    for (const title of ['', ' ', '\u2003', 'bad\n']) {
      expect(accepts('android.create_calendar_event', { title, startsAtEpochMs: 0, endsAtEpochMs: 1 })).toBe(false)
    }
  })

  it.each([
    ['android.open_map', 'query', 512, {}],
    ['android.open_map', 'label', 256, { latitude: 0, longitude: 0 }],
    ['android.share_text', 'text', 16_000, {}],
    ['android.share_text', 'title', 120, { text: 'ok' }],
    ['android.create_calendar_event', 'title', 256, { startsAtEpochMs: 0, endsAtEpochMs: 1 }],
    ['android.create_calendar_event', 'location', 512, { title: 'ok', startsAtEpochMs: 0, endsAtEpochMs: 1 }],
    ['android.create_calendar_event', 'description', 4000, { title: 'ok', startsAtEpochMs: 0, endsAtEpochMs: 1 }],
  ] as const)('%s.%s enforces UTF-16 bounds and string/control validation', (id, field, limit, base) => {
    for (const value of ['x'.repeat(limit), '😀'.repeat(limit / 2)]) expect(accepts(id, { ...base, [field]: value })).toBe(true)
    for (const value of ['x'.repeat(limit + 1), '😀'.repeat(limit / 2) + 'x', null, 0, true, {}, [], undefined,
      'x\u0000', 'x\u007f', 'x\u0085', 'x\u009f', '\ud800', '\udc00']) {
      expect(accepts(id, { ...base, [field]: value })).toBe(false)
    }
    if (field !== 'text') for (const value of ['x\n', 'x\r', 'x\t']) expect(accepts(id, { ...base, [field]: value })).toBe(false)
  })

  it('does not invoke accessors or serialization hooks during validation', () => {
    const getter = vi.fn(() => 'https://example.com')
    const input = Object.defineProperty({}, 'url', { enumerable: true, get: getter })
    expect(accepts('android.open_url', input)).toBe(false)
    expect(getter).not.toHaveBeenCalled()
    expect(accepts('android.open_url', { url: 'https://example.com', toJSON: getter })).toBe(false)
    expect(getter).not.toHaveBeenCalled()
  })
})

describe('Android catalog through the authorized runner', () => {
  it.each(ids)('%s never dispatches without host approval', async id => {
    const registry = new ActionRegistry(), bridge = bridgeFor()
    registerAndroidNativeActions(registry, bridge)
    const authorize = vi.fn(async () => 'deny' as const)
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize })
    expect(await runner.run(workflow(id, valid[id]), { runId: 'denied' })).toMatchObject({ result: { status: 'denied', code: 'policy_denied' } })
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ actionId: id, input: valid[id] }), 'write', expect.any(AbortSignal))
    expect(bridge).not.toHaveBeenCalled()
  })

  it.each(ids)('%s rejects bad input before authorization and dispatch', async id => {
    const registry = new ActionRegistry(), bridge = bridgeFor(), authorize = vi.fn(async () => 'allow' as const)
    registerAndroidNativeActions(registry, bridge)
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize })
    expect(await runner.run(workflow(id, { ...(valid[id] as object), extra: true }), { runId: 'invalid' }))
      .toMatchObject({ result: { status: 'denied', code: 'invalid_input' } })
    expect(authorize).not.toHaveBeenCalled()
    expect(bridge).not.toHaveBeenCalled()
  })

  it.each(ids)('%s preserves the request and native handoff outcome without replay', async id => {
    const status = id === 'android.open_url' || id === 'android.open_map' ? 'succeeded' : 'accepted'
    const registry = new ActionRegistry(), bridge = bridgeFor(status)
    registerAndroidNativeActions(registry, bridge)
    const runner = new WorkflowRunner({ registry, journal: new MemoryExecutionJournal(), authorize: async () => 'allow' })
    const output = await runner.run(workflow(id, valid[id]), { runId: 'approved' })
    expect(output).toMatchObject(status === 'succeeded' ? { status: 'completed', outputs: { action: null } } :
      { status: 'halted', result: { status: 'accepted', jobId: 'external:["workflow",3,"approved","action"]' } })
    expect(bridge.mock.calls[0][0]).toEqual({
      protocolVersion: 1, requestId: '["workflow",3,"approved","action"]', workflowId: 'workflow', workflowRevision: 3,
      nodeId: 'action', actionId: id, input: valid[id], idempotencyKey: '["workflow",3,"approved","action"]', expectedRevision: 7,
    })
    expect(await runner.run(workflow(id, valid[id]), { runId: 'approved' })).toMatchObject({ result: { status: 'unknown' } })
    expect(bridge).toHaveBeenCalledTimes(1)
  })
})
