// Agent SSE stream parsing — mirrors `crates/agent/src/stream.rs`.
import { describe, expect, it } from 'vitest'
import { isStreamDone, parseAgentStreamChunk } from '../../src/utils/agentStream'

describe('agent SSE stream parsing', () => {
  it('decodes one job event', () => {
    const events = parseAgentStreamChunk('event: job\ndata: {"status":"running"}\n\n')
    expect(events).toEqual([{ event: 'job', data: '{"status":"running"}' }])
  })

  it('joins multiline data and lets the last event name win', () => {
    const events = parseAgentStreamChunk('event: one\nevent: two\ndata: a\ndata: b\n\n')
    expect(events).toEqual([{ event: 'two', data: 'a\nb' }])
  })

  it('ignores heartbeats, comments, and unknown fields', () => {
    const chunk = ': ping\n\nretry: 3000\n\nevent: job\ndata: {"a":1}\n\n'
    expect(parseAgentStreamChunk(chunk)).toEqual([{ event: 'job', data: '{"a":1}' }])
  })

  it('keeps the [DONE] sentinel as data so the driver can terminate', () => {
    const events = parseAgentStreamChunk('data: [DONE]\n\n')
    expect(events).toHaveLength(1)
    expect(isStreamDone(events[0].data)).toBe(true)
    expect(isStreamDone('{"status":"done"}')).toBe(false)
  })

  it('sanitizes hostile event names instead of breaking framing', () => {
    const events = parseAgentStreamChunk('event: evil name\ndata: x\n\n')
    expect(events[0].event).toBe('message')
  })

  it('parses a chunk without a trailing blank line', () => {
    const events = parseAgentStreamChunk('event: job\ndata: tail')
    expect(events).toEqual([{ event: 'job', data: 'tail' }])
  })
})
