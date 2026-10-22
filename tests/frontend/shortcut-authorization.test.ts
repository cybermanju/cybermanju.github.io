// CyberManju OS — Authorization tuple regressions (tests/frontend/shortcut-authorization.test.ts).
// Role: Check the UI parser against real runner correlation and hostile request IDs.
// Exports: Vitest authorization parser regression suite.
// Integrates: Public automation runner, identifier rules and UI authorization parser.
// Contracts: No native dispatch, persistence, network or secret resolution.
import { describe, expect, it } from 'vitest'
import { ActionRegistry, MemoryExecutionJournal, WorkflowRunner, type Workflow } from '@/automation'
import { parseAuthorizationRequest, type AuthorizationRequest } from '@/utils/shortcutAuthorization'

const tuple = ['workflow-one', 7, 'run-one', 'node-one'] as const
const request = (requestId: unknown = JSON.stringify(tuple)) => ({
  requestId, workflowId: tuple[0], workflowRevision: tuple[1], nodeId: tuple[3], actionId: 'test.read', input: { value: 'hello' },
})
const fromTuple = (fields: unknown[]) => ({ ...request(JSON.stringify(fields)), workflowId: fields[0], workflowRevision: fields[1], nodeId: fields[3] })

describe('Shortcuts canonical authorization correlation', () => {
  it('accepts the exact requestId produced by the real runner and preserves its idempotency key', async () => {
    const workflow: Workflow = { schemaVersion: 1, id: tuple[0], revision: tuple[1], entryNodeId: tuple[3], nodes: [
      { id: tuple[3], type: 'action', actionId: 'test.read', input: { value: 'hello' }, next: 'end' },
      { id: 'end', type: 'end' },
    ] }
    let approved: AuthorizationRequest | undefined
    const runner = new WorkflowRunner({
      registry: new ActionRegistry().register({ id: 'test.read', effect: 'read', validateInput: () => true,
        execute: async native => {
          expect(native.requestId).toBe(approved?.requestId)
          expect(native.idempotencyKey).toBe(approved?.requestId)
          return { status: 'succeeded', output: null }
        },
      }),
      journal: new MemoryExecutionJournal(),
      authorize: async native => {
        expect(native.requestId).toBe('["workflow-one",7,"run-one","node-one"]')
        expect(native.requestId).toBe(native.idempotencyKey)
        // The host passes only the six UI authorization fields, not the native envelope.
        const { requestId, workflowId, workflowRevision, nodeId, actionId, input } = native
        approved = parseAuthorizationRequest({ requestId, workflowId, workflowRevision, nodeId, actionId, input })
        return 'allow'
      },
    })
    expect(await runner.run(workflow, { runId: tuple[2] })).toMatchObject({ status: 'completed' })
    expect(approved).toEqual(request())
  })

  it.each([
    '', 'auth-1', 'null', '{}', 'true', '7', '"workflow-one"', '[]', '[',
    '["workflow-one",7,"run-one"]', '["workflow-one",7,"run-one","node-one","extra"]',
    '["workflow-one",7,"run-one","node-one",]',
    '["workflow-one",7,,"node-one"]',
    '["workflow-one",7,"run-one","node-one"] trailing',
    { tuple }, tuple, null, 7,
  ])('rejects malformed, non-tuple or wrong-sized request IDs: %j', requestId => {
    expect(() => parseAuthorizationRequest(request(requestId))).toThrow('invalid_authorization')
  })

  it.each([
    ' ["workflow-one",7,"run-one","node-one"]',
    '["workflow-one",7,"run-one","node-one"]\n',
    '["workflow-one", 7,"run-one","node-one"]',
    '["workflow-one",7.0,"run-one","node-one"]',
    '["workflow-one",7e0,"run-one","node-one"]',
    '["\\u0077orkflow-one",7,"run-one","node-one"]',
  ])('rejects noncanonical encodings: %s', requestId => {
    expect(() => parseAuthorizationRequest(request(requestId))).toThrow('invalid_authorization')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null, true, {}, []])('rejects invalid tuple revisions: %j', revision => {
    expect(() => parseAuthorizationRequest(fromTuple([tuple[0], revision, tuple[2], tuple[3]]))).toThrow('invalid_authorization')
  })

  it.each([0, 2, 3])('enforces the real identifier constraints for tuple field %s', index => {
    for (const invalid of ['', 'x'.repeat(129), '-leading', '.leading', ':leading', 'has space', 'slash/id', 'quote"id', 'line\nfeed', 'x\u007f', 'x\u0085', 'ação', 7, null, true, {}, []]) {
      const fields: unknown[] = [...tuple]; fields[index] = invalid
      expect(() => parseAuthorizationRequest(fromTuple(fields)), JSON.stringify(fields)).toThrow('invalid_authorization')
    }
  })

  it.each([
    { workflowId: 'different' }, { workflowRevision: 8 }, { nodeId: 'different' },
    { actionId: 'invalid action' }, { extra: 'unexpected' }, { idempotencyKey: JSON.stringify(tuple) },
  ])('rejects mismatched correlation or extra envelope fields: %j', overrides => {
    expect(() => parseAuthorizationRequest({ ...request(), ...overrides })).toThrow('invalid_authorization')
  })

  it('accepts min/max revision and identifier boundaries while staying within bridge 512', () => {
    expect(parseAuthorizationRequest(fromTuple(['A', 1, '0', 'Z'])).workflowRevision).toBe(1)
    const id = `A${'a._:-09'.repeat(19)}`.slice(0, 128)
    expect(id).toHaveLength(128)
    const maximal = fromTuple([id, Number.MAX_SAFE_INTEGER, id, id])
    // All three IDs are <=128 ASCII chars; even the largest safe revision fits below 512.
    expect(maximal.requestId.length).toBeLessThanOrEqual(512)
    expect(parseAuthorizationRequest(maximal).requestId).toBe(maximal.requestId)
    for (const size of [512, 513]) {
      // No valid tuple reaches 512 with real field limits. Padding must not be normalized.
      const padded = JSON.stringify(tuple).padEnd(size, ' ')
      expect(padded).toHaveLength(size)
      expect(() => parseAuthorizationRequest(request(padded))).toThrow('invalid_authorization')
      const oversizedField = JSON.stringify([tuple[0], tuple[1], 'x'.repeat(size), tuple[3]])
      expect(() => parseAuthorizationRequest(request(oversizedField))).toThrow('invalid_authorization')
    }
  })

  it('keeps resolved-input, literal-secret-reference and detached-copy protections', () => {
    const original = { ...request(), input: { token: { secretRef: 'vault-token' }, values: [false, 0, null] } }
    const parsed = parseAuthorizationRequest(original)
    expect(parsed).toEqual(original)
    expect(parsed.input).not.toBe(original.input)
    expect(() => parseAuthorizationRequest({ ...request(), input: { token: 'plaintext' } })).toThrow('plaintext_secret')
    expect(() => parseAuthorizationRequest({ ...request(), input: { nested: [{ $output: { nodeId: 'first', path: [] } }] } })).toThrow('unresolved_authorization')
  })
})
