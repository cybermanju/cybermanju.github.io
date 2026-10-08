// Browser parity: bash-subset + depth-1 subagents + HTTP MCP helpers.
import { describe, expect, it } from 'vitest'
import {
  BROWSER_SUBAGENT_MAX_TURNS,
  BROWSER_TASK_MAX_DEPTH,
  decideLocalTool,
  listLocalMcpTools,
  localMcpServers,
  splitMcpToolName,
} from '../../src/composables/useAgent'
import { stripDeniedTools, toolMeta } from '../../src/utils/agentUi'
import type { PermissionRuleset } from '../../src/types'

describe('splitMcpToolName', () => {
  it('splits namespaced tools', () => {
    expect(splitMcpToolName('mcp__exa__web_search_exa')).toEqual(['exa', 'web_search_exa'])
  })
  it('rejects malformed names', () => {
    expect(splitMcpToolName('read')).toBeNull()
    expect(splitMcpToolName('mcp__only')).toBeNull()
    expect(splitMcpToolName('mcp__a__b__c')).toBeNull()
    expect(splitMcpToolName('mcp____tool')).toBeNull()
  })
})

describe('browser task budget', () => {
  it('matches native depth-1 / 5-turn parity', () => {
    expect(BROWSER_TASK_MAX_DEPTH).toBe(1)
    expect(BROWSER_SUBAGENT_MAX_TURNS).toBe(5)
  })
})

describe('listLocalMcpTools', () => {
  it('returns empty when no config is stored', async () => {
    try {
      localStorage.clear()
    } catch {
      // Node env has no localStorage — the helper already fails closed.
    }
    await expect(listLocalMcpTools('missing')).resolves.toEqual([])
  })
  it('fails closed without throwing (node has no localStorage)', () => {
    expect(localMcpServers('anything')).toEqual({})
  })
})

describe('browser tool wiring', () => {
  const open: PermissionRuleset = { default: 'allow', rules: {} }
  it('plan stays read-only for write/edit/bash', () => {
    expect(decideLocalTool(open, 'plan', 'bash', { command: 'ls' }).kind).toBe('deny')
    expect(decideLocalTool(open, 'plan', 'write', { path: 'a' }).kind).toBe('deny')
    expect(decideLocalTool(open, 'plan', 'read', { path: 'a' }).kind).toBe('allow')
  })
  it('stripDeniedTools drops plan mutations (D7 parity)', () => {
    const tools = ['read', 'write', 'edit', 'bash', 'task', 'memory_recall']
    expect(stripDeniedTools(tools, open, 'plan')).toEqual(['read', 'task', 'memory_recall'])
  })
  it('toolMeta covers every browser tool incl. mcp__', () => {
    for (const t of ['read', 'write', 'edit', 'list', 'grep', 'glob', 'bash', 'task', 'question', 'memory_recall', 'memory_remember']) {
      expect(toolMeta(t).name).toBe(t)
    }
    expect(toolMeta('mcp__exa__web_search_exa').verb).toBe('MCP')
  })
})
