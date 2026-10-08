// CyberManju — browser-local agent loop (static-host / Pages transport).
//
// The WASM dispatcher exposes single-turn primitives (`agent_catalog`,
// `agent_prompt`); this composable drives the multi-turn loop entirely in
// the browser: transcript, tool execution against the volume dispatcher,
// ask-approval parking, usage accounting, and localStorage transcripts.
// Provider keys live in memory only — they are never written to storage.
//
// Mirrors the native permission semantics in `crates/agent/src/config.rs`
// (last-match-wins wildcards, plan denies mutations, deny beats auto).
// Anything the sandbox cannot do answers `unsupported:` — never a fake Ok.

import { ref } from 'vue'
import { wasmAgentCatalog, wasmAgentPrompt } from './useWasmBackend'
import { wasmModuleExports, wasmOsDispatch } from './useWasmBackend'
import { prepareWireMessages } from '@/utils/agentUi'
import { LocalMemoryStore, MEMORY_TEXT_CAP_CHARS, renderRecallBlock, type MemoryStorage } from '@/utils/memory'
import type {
  AgentConfig,
  AgentJob,
  AgentMemory,
  AgentSession,
  ChatMessage,
  MemoryHit,
  PermissionRuleset,
  ProviderPreset,
  TokenUsage,
  ToolCall,
} from '@/types'

const SESSIONS_KEY = 'cybermanju.agent.sessions.v1'
const CONFIGS_KEY = 'cybermanju.agent.configs.v1'
const MEMORIES_KEY = 'cybermanju.agent.memories.v1'

/** Shell-style wildcard: `*` spans any run, `?` exactly one char. */
export function matchWildcard(pattern: string, input: string): boolean {
  const px = pattern
  const memo = new Map<string, boolean>()
  function go(pi: number, ii: number): boolean {
    const key = `${pi}:${ii}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let out: boolean
    if (pi >= px.length) {
      out = ii >= input.length
    } else if (px[pi] === '*') {
      let p = pi
      while (p < px.length && px[p] === '*') p++
      out = false
      for (let skip = ii; skip <= input.length; skip++) {
        if (go(p, skip)) {
          out = true
          break
        }
      }
    } else if (px[pi] === '?') {
      out = ii < input.length && go(pi + 1, ii + 1)
    } else {
      out = ii < input.length && input[ii] === px[pi] && go(pi + 1, ii + 1)
    }
    memo.set(key, out)
    return out
  }
  return go(0, 0)
}

/** Glob matcher mirroring Rust `config::match_glob`: `*`/`?` stay inside
 *  one segment, `**` crosses separators. */
export function matchGlob(pattern: string, path: string): boolean {
  const trim = (s: string) => s.replace(/\\/g, '/').split('/').filter(Boolean)
  const px = trim(pattern.length ? pattern : '**')
  const ix = trim(path)
  function go(pi: number, ii: number): boolean {
    if (pi >= px.length) return ii >= ix.length
    if (px[pi] === '**') {
      let p = pi + 1
      while (p < px.length && px[p] === '**') p++
      for (let skip = ii; skip <= ix.length; skip++) {
        if (go(p, skip)) return true
      }
      return false
    }
    if (ii >= ix.length) return false
    return matchWildcard(px[pi], ix[ii]) && go(pi + 1, ii + 1)
  }
  return go(0, 0)
}

/** Regex when it compiles, literal substring when it does not. */
export function compileGrep(pattern: string): { test: (line: string) => boolean; regex: boolean } {
  try {
    const re = new RegExp(pattern)
    return { test: line => re.test(line), regex: true }
  } catch {
    return { test: line => line.includes(pattern), regex: false }
  }
}

function matchInput(tool: string, input: Record<string, unknown>): string {
  const arg = salientArg(input)
  return arg ? `${tool} ${arg}` : tool
}

function salientArg(input: Record<string, unknown>): string {
  return (
    (input.command as string) ??
    (input.pattern as string) ??
    (input.path as string) ??
    (input.glob as string) ??
    (input.query as string) ??
    (input.url as string) ??
    (input.text as string) ??
    ''
  )
}

export type LocalDecision = { kind: 'allow' } | { kind: 'ask'; summary: string } | { kind: 'deny'; reason: string }

/** Mirror of Rust `config::decide` — keep semantics identical. */
export function decideLocalTool(
  rules: PermissionRuleset,
  agentKind: 'build' | 'plan',
  tool: string,
  input: Record<string, unknown>,
): LocalDecision {
  if (agentKind === 'plan' && (tool === 'edit' || tool === 'write' || tool === 'bash')) {
    return { kind: 'deny', reason: `deny: plan agent may not run \`${tool}\`` }
  }
  const rule = rules.rules[tool]
  let action = rules.default
  if (typeof rule === 'string') {
    action = rule
  } else if (Array.isArray(rule)) {
    const target = matchInput(tool, input)
    const arg = salientArg(input)
    for (const [pattern, act] of rule) {
      if (
        matchWildcard(pattern, target) ||
        matchWildcard(pattern, tool) ||
        (arg !== '' && matchWildcard(pattern, arg))
      ) {
        action = act
      }
    }
  }
  if (action === 'allow') {
    // Standing orders never auto-allow: a `write`/`edit` that would pass
    // silently under an `allow` rule is downgraded to a human decision
    // (Hermes applies the same guard even under `--yolo`). `deny` still wins.
    if (
      (tool === 'write' || tool === 'edit') &&
      isProtectedInstructionPath(String(input.path ?? ''))
    ) {
      return {
        kind: 'ask',
        summary: `Approve \`${tool}\` — protected standing orders`,
      }
    }
    return { kind: 'allow' }
  }
  if (action === 'deny') return { kind: 'deny', reason: `deny: \`${tool}\` is denied by the permission ruleset` }
  return { kind: 'ask', summary: `Approve \`${tool}\`?` }
}

/** Mirror of Rust `config::remember_allow`: "allow always" becomes an
 *  explicit, visible rule on the tool — never an invisible always-list. */
export function rememberAllowLocal(rules: PermissionRuleset, tool: string): void {
  rules.rules[tool] = 'allow'
}

// ─── standing orders + refusal circuit breaker ───────────────────

/** Basenames that are the agent's standing orders — they get folded into the
 *  system prompt, so whoever rewrites them owns every later turn. */
const PROTECTED_INSTRUCTION_BASENAMES = new Set(['agents.md', 'skill.md'])

/** Mirror of Rust `config::is_protected_instruction_path` (Hermes
 *  `security.protected_instruction_files`): case-insensitive basename in any
 *  directory, plus the `.cybermanju/rules.md` path form. */
export function isProtectedInstructionPath(path: string): boolean {
  const norm = String(path || '').replace(/\\/g, '/').toLowerCase()
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  if (PROTECTED_INSTRUCTION_BASENAMES.has(base)) return true
  return /(^|\/)\.cybermanju\/rules\.md$/.test(norm)
}

/** AUTO APPROVE is the exact state a prompt injection aims for, so it never
 *  covers a standing-orders write: that call fails closed with a denial the
 *  model can act on. Returns the denial text, or `null` when the call is an
 *  ordinary ask (parked for the human as usual). */
export function protectedAutoApproveDenial(
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (tool !== 'write' && tool !== 'edit') return null
  if (!isProtectedInstructionPath(String(input.path ?? ''))) return null
  return (
    'deny: protected instruction file (AGENTS.md / SKILL.md / .cybermanju/rules.md) — ' +
    'AUTO APPROVE never covers standing orders; disable AUTO APPROVE to write one'
  )
}

/** Consecutive refusals that stop the loop from asking again — after this
 *  many `no`s on the same tool, re-prompting is nagging, not consent
 *  (Hermes `approvals.denial_breaker_threshold`, same default). */
export const DENIAL_BREAKER_THRESHOLD = 3

export class DenialBreaker {
  private readonly counts = new Map<string, number>()

  /** `refused` false resets the tool — one approval clears the tally. */
  record(tool: string, refused: boolean): void {
    if (refused) this.counts.set(tool, (this.counts.get(tool) ?? 0) + 1)
    else this.counts.delete(tool)
  }

  isOpen(tool: string): boolean {
    return (this.counts.get(tool) ?? 0) >= DENIAL_BREAKER_THRESHOLD
  }

  reason(tool: string): string {
    return (
      `denied: \`${tool}\` was refused ${DENIAL_BREAKER_THRESHOLD} times in a row — the approval ` +
      'breaker is open; stop retrying it, take a different approach, or edit the permission ruleset'
    )
  }
}

// ─── volume tools (WASM dispatcher) ─────────────────────────────

async function wasmRead(path: string): Promise<string> {
  const res = (await wasmOsDispatch('exec', { line: `cat "${path}"` })) as {
    ok: boolean
    output: string
  }
  if (!res.ok) throw new Error(res.output || `not_found: ${path}`)
  return res.output
}

async function wasmWrite(path: string, content: string): Promise<string> {
  const res = (await wasmOsDispatch('write', { path, content })) as {
    ok: boolean
    output: string
  }
  if (!res.ok) throw new Error(res.output || 'write failed')
  return res.output
}

async function wasmList(path: string): Promise<string> {
  const res = (await wasmOsDispatch('ls', { path })) as { ok: boolean; output: string } | string[]
  if (Array.isArray(res)) return res.join('\n')
  if (!res.ok) throw new Error(res.output || `not_found: ${path}`)
  return res.output
}

/** Minimum anchor strength: 16 hex chars = 64 bits — mirrors Rust `edit`.
 *  Anything shorter refuses with `integrity:` instead of coin-flipping. */
const MIN_ANCHOR_HEX = 16

/** Trailer `read` appends: `\n[blake3:<hex>]`. Mirrors `edit::anchor_line`. */
function anchorLineLocal(hash: string): string {
  return `\n[blake3:${hash}]`
}

/** Accept every shape a model might echo back — the whole line, a
 *  `blake3:` prefix, brackets, whitespace — mirrors Rust `edit::normalize_anchor`. */
export function normalizeAnchorLocal(raw: string): string {
  const t = raw.trim()
  const stripped = t.startsWith('[blake3:') ? t.slice('[blake3:'.length)
    : t.startsWith('blake3:') ? t.slice('blake3:'.length)
    : t
  return stripped.replace(/\]+$/, '').trim()
}

/** Hex of a syntactically valid trailing `[blake3:<64hex>]` line, or `null`.
 *  Pure syntax (one trailing newline tolerated) — says nothing about whose
 *  trailer it is. Mirrors Rust `edit::anchor_trailer`. */
export function anchorTrailerHex(text: string): string | null {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const i = body.lastIndexOf('\n')
  const line = i < 0 ? body : body.slice(i + 1)
  const m = /^\[blake3:([0-9a-fA-F]{64})\]$/.exec(line)
  return m ? m[1].toLowerCase() : null
}

/** Bytes before the trailing anchor line. Mirrors Rust `edit::body_before_trailer`. */
function bodyBeforeTrailer(text: string): string {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const i = body.lastIndexOf('\n')
  return i < 0 ? '' : text.slice(0, i)
}

/** Drop a trailing anchor line only when it verifies as ours: the hex must
 *  equal the BLAKE3 of the bytes before it (the exact trailer `read`
 *  appended), or of `existing` — bytes already stored (the pre-edit file in
 *  an edit flow). A file that legitimately ends with an anchor-shaped line
 *  survives untouched. `hashBody` is injectable so tests stay hermetic; when
 *  no hash is available we preserve bytes rather than delete them.
 *  Mirrors Rust `edit::strip_echo`. */
export async function stripEcho(
  text: string,
  existing: string | null,
  hashBody: (body: string) => Promise<string | null> = blake3HexIfAvailable,
): Promise<string> {
  const hex = anchorTrailerHex(text)
  if (!hex) return text
  const body = bodyBeforeTrailer(text)
  const actual = await hashBody(body)
  // Without a hash we cannot prove the trailer is ours — keep the bytes.
  if (!actual) return text
  if (actual === hex) return body
  if (existing !== null) {
    const prev = await hashBody(existing)
    if (prev === hex) return body
  }
  return text
}

/** Drop a trailing anchor line we added (hash-verified). Anything else —
 *  including anchor-shaped content lines — is preserved. The async verified
 *  form of the old sync strip; mirrors Rust `edit::strip_anchor`. */
export async function stripAnchorLocal(
  text: string,
  hashBody: (body: string) => Promise<string | null> = blake3HexIfAvailable,
): Promise<string> {
  return stripEcho(text, null, hashBody)
}

/** BLAKE3 hex of text via the loaded wasm module, or `null` when the module
 *  is not up yet (then a provided anchor simply is not checked — we never
 *  claim a verification we did not perform). */
async function blake3HexIfAvailable(text: string): Promise<string | null> {
  try {
    const w = await wasmModuleExports<{ blake3_hash(d: Uint8Array): string }>()
    if (!w || typeof w.blake3_hash !== 'function') return null
    return w.blake3_hash(new TextEncoder().encode(text))
  } catch {
    return null
  }
}

/** Mirror of Rust `edit::apply_edit` (exact-once anchored replacement).
 *  `expectedHash` is honoured the same way: a stale BLAKE3 refuses with
 *  `integrity:` instead of writing over a file someone else moved. */
async function applyEditLocal(
  current: string,
  oldBlock: string,
  newBlock: string,
  expectedHash?: string,
): Promise<string> {
  if (!oldBlock) throw new Error('invalid: old_block is empty')
  const anchor = normalizeAnchorLocal(expectedHash ?? '')
  if (anchor) {
    // A race check is only real with 64+ bits behind it (mirrors Rust): a
    // shorter anchor refuses even when the wasm hash is unavailable, because
    // weakness is a property of the anchor, not of our ability to verify.
    if (anchor.length < MIN_ANCHOR_HEX) {
      throw new Error(
        `integrity: anchor '${anchor}' is too short (need ≥${MIN_ANCHOR_HEX} hex chars / 64+ bits) — re-read and retry`,
      )
    }
    const actual = await blake3HexIfAvailable(current)
    // Prefix-accept, like Rust: a 16+-char anchor still detects a moved file
    // and never turns into a permanent edit blocker.
    if (actual && !actual.startsWith(anchor)) {
      throw new Error(
        `integrity: file changed since anchor (expected ${anchor}, got ${actual}) — re-read and retry`,
      )
    }
  }
  const hits = current.split(oldBlock).length - 1
  if (hits === 0) throw new Error('not_found: old_block does not occur in the file — re-read and retry')
  if (hits > 1) throw new Error(`conflict: old_block occurs ${hits} times — resend a larger, unique block`)
  return current.replace(oldBlock, newBlock)
}

async function execLocalTool(
  call: { name: string; input: Record<string, unknown> },
  cwd: string,
  configId = '',
): Promise<string> {
  const join = (p: string) => {
    const raw = String(p || '')
    if (raw.startsWith('/')) return raw
    return cwd === '/' ? `/${raw}` : `${cwd}/${raw}`
  };
  switch (call.name) {
    case 'read': {
      const raw = await wasmRead(join(String(call.input.path ?? '')))
      // Same contract as native: hand back an anchor the model can pass as
      // `expected_hash`. Never claim one we could not compute.
      const hash = await blake3HexIfAvailable(raw)
      return hash ? `${raw}${anchorLineLocal(hash)}` : raw
    }
    case 'list': {
      const p = String(call.input.path ?? '')
      return wasmList(p ? join(p) : cwd)
    }
    case 'write': {
      const path = join(String(call.input.path ?? ''))
      // A `[blake3:…]` line echoed out of a `read` is metadata, never
      // content — strip it only when it verifies as ours (exact round-trip
      // trailer, or the trailer of the file already stored for edited
      // echoes). Anything else is user content and stays.
      const rawIn = String(call.input.content ?? '')
      let content = rawIn
      if (anchorTrailerHex(rawIn)) {
        let existing: string | null = null
        try {
          existing = await wasmRead(path)
        } catch {
          // New file (or unreadable): only the round-trip trailer can verify.
        }
        content = await stripEcho(rawIn, existing)
      }
      if (content.length > 1024 * 1024) throw new Error('too_large: content exceeds the 1 MiB browser write cap')
      await wasmWrite(path, content)
      const hash = await blake3HexIfAvailable(content)
      return hash ? `wrote ${path} (${content.length} bytes, blake3:${hash})` : `wrote ${path} (${content.length} bytes)`
    }
    case 'edit': {
      const path = join(String(call.input.path ?? ''))
      const current = await wasmRead(path)
      const anchor = String(call.input.expected_hash ?? '').trim()
      const updated = await applyEditLocal(
        current,
        String(call.input.old_block ?? ''),
        String(call.input.new_block ?? ''),
        anchor || undefined,
      )
      // Hash exactly the bytes that land on disk, so the printed anchor
      // verifies against the file the next read returns. Strip our trailer
      // against the pre-edit bytes: an echo of the read trailer in
      // `new_block` is still metadata, not content.
      const written = await stripEcho(updated, current)
      await wasmWrite(path, written)
      const hash = await blake3HexIfAvailable(written)
      return hash ? `edited ${path} (blake3:${hash})` : `edited ${path}`
    }
    case 'grep': {
      const rawPattern = String(call.input.pattern ?? '')
      if (!rawPattern) throw new Error('invalid: pattern is required')
      const base = String(call.input.path ?? '')
      const limit = Math.min(50, Math.max(1, Number(call.input.limit ?? 50)))
      const { test } = compileGrep(rawPattern)
      const start = base ? join(base) : cwd
      const listing = await wasmList(start)
      const names = listing.split('\n').map(s => s.trim()).filter(s => s && !s.endsWith('/'))
      const matches: string[] = []
      for (const name of names.slice(0, 200)) {
        const full = start === '/' ? `/${name}` : `${start}/${name}`
        try {
          const text = await wasmRead(full)
          text.split('\n').forEach((line, i) => {
            if (matches.length < limit && test(line)) {
              matches.push(`${full}:${i + 1}: ${line.trim().slice(0, 240)}`)
            }
          })
        } catch {
          // Unreadable entries are skipped, never fatal.
        }
        if (matches.length >= limit) break
      }
      return matches.length ? matches.join('\n') : `no matches for \`${rawPattern}\``
    }
    case 'glob': {
      const pattern = String(call.input.pattern ?? '**') || '**'
      const base = String(call.input.path ?? '')
      const limit = Math.min(200, Math.max(1, Number(call.input.limit ?? 200)))
      const start = base ? join(base) : cwd
      const hits: string[] = []
      const stack = [start]
      let seen = 0
      while (stack.length && hits.length < limit && seen < 2000) {
        const dir = stack.pop()!
        let names: string[]
        try {
          names = (await wasmList(dir)).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('.'))
        } catch {
          continue
        }
        for (const name of names) {
          if (hits.length >= limit || seen >= 2000) break
          if (name.endsWith('/')) {
            stack.push(dir === '/' ? `/${name.slice(0, -1)}` : `${dir}/${name.slice(0, -1)}`)
            continue
          }
          seen++
          const full = dir === '/' ? `/${name}` : `${dir}/${name}`
          const rel = full === start
            ? name
            : full.startsWith(`${start}/`)
              ? full.slice(start.length + 1)
              : full.replace(/^\//, '')
          if (matchGlob(pattern, rel)) hits.push(full)
        }
      }
      hits.sort()
      return hits.length ? hits.join('\n') : `no files match \`${pattern}\``
    }
    case 'bash':
      throw new Error('unsupported: `bash` needs the desktop app or Docker server — no shell in the browser sandbox')
    case 'task':
      throw new Error('unsupported: subagents are not available in the browser loop yet — break the goal into steps')
    case 'question':
      throw new Error('unsupported: routed through approvals, never executed directly')
    case 'memory_recall': {
      const query = String(call.input.query ?? '').trim()
      if (!query) throw new Error('invalid: query is required')
      const topK = Math.min(10, Math.max(1, Number(call.input.top_k ?? 3) || 3))
      const hits = localMemories.recall(configId || undefined, query, topK)
      if (!hits.length) return 'no memories match — proceed with the transcript alone'
      return hits.map(h => `- ${h.text}`).join('\n')
    }
    case 'memory_remember': {
      const text = String(call.input.text ?? '').trim().slice(0, MEMORY_TEXT_CAP_CHARS)
      if (!text) throw new Error('invalid: nothing memorable after cleaning')
      const row = localMemories.remember(configId || 'browser', text)
      if (!row) throw new Error('invalid: nothing memorable after cleaning')
      return `remembered ${row.id} (${row.text.length} chars, keyword-only: no embeddings on this transport)`
    }
    default:
      throw new Error(`unsupported: unknown tool '${call.name}'`)
  }
}

// ─── loop state ─────────────────────────────────────────────────

export interface LocalRunOpts {
  baseUrl: string
  dialect: 'openAi' | 'anthropic'
  model: string
  headers: Array<[string, string]>
  system: string
  maxTurns: number
  permission: PermissionRuleset
  autoApprove: boolean
  agentKind: 'build' | 'plan'
  /** Config scope for local memories (namespaces recall + remember). */
  configId?: string
  /** Persist an "allow always" rule the user just granted (config write). */
  onRemember?: (tool: string) => void
}

export interface ApprovalRequest {
  tool: string
  input: Record<string, unknown>
  summary: string
  question?: string | null
  resolve: (approved: boolean, answer?: string, remember?: boolean) => void
}

const running = ref(false)
const pendingApproval = ref<ApprovalRequest | null>(null)
/** One-liner of what the browser loop is doing right now (job line in the UI). */
export const localActivity = ref('')
let abortRequested = false

/** Ask the running browser loop to stop at the next turn boundary. */
export function abortLocalRun(): void {
  abortRequested = true
  if (pendingApproval.value) {
    const parked = pendingApproval.value
    pendingApproval.value = null
    parked.resolve(false)
  }
}

function waitApproval(
  req: Omit<ApprovalRequest, 'resolve'>,
): Promise<{ approved: boolean; answer?: string; remember?: boolean }> {
  return new Promise(resolve => {
    pendingApproval.value = {
      ...req,
      resolve: (approved, answer, remember) => {
        pendingApproval.value = null
        resolve({ approved, answer, remember })
      },
    }
  })
}

function assistantToolWire(calls: ToolCall[]): unknown[] {
  return calls.map(c => ({ id: c.id, name: c.name, input: c.input }))
}

/** Drive one prompt to completion in the browser. Mutates `messages`. */
export async function runLocalAgent(
  opts: LocalRunOpts,
  messages: ChatMessage[],
  usage: TokenUsage,
  onUpdate?: () => void,
): Promise<{ stopped: 'done' | 'limit' | 'aborted' | 'error'; error?: string }> {
  running.value = true
  abortRequested = false
  localActivity.value = `thinking · ${opts.model}`
  // Doom-loop guard (native `agent_api` parity): three byte-identical calls
  // in a row are denied instead of silently burning the turn budget.
  let lastSig: { name: string; json: string } | null = null
  let repeats = 0
  // Refusal breaker (Hermes parity): three `no`s on one tool stop the loop
  // from parking on the human for the same call a fourth time.
  const breaker = new DenialBreaker()
  try {
    for (let turn = 0; turn < Math.min(50, Math.max(1, opts.maxTurns)); turn++) {
      if (abortRequested) return { stopped: 'aborted' as const }
      localActivity.value = `thinking · ${opts.model}`
      // Context pressure is relieved on the *wire* only: the transcript the
      // user sees keeps every byte, the provider gets the pruned copy.
      const wire = prepareWireMessages(messages, { model: opts.model })
      if (wire.pruned > 0) {
        localActivity.value = `compacting · pruned ${wire.pruned} tool result(s)`
      }
      let res: Awaited<ReturnType<typeof wasmAgentPrompt>>
      try {
        res = await wasmAgentPrompt({
          url: opts.dialect === 'anthropic' ? `${opts.baseUrl.replace(/\/$/, '')}/v1/messages` : `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`,
          dialect: opts.dialect,
          model: opts.model,
          headers: opts.headers,
          system: opts.system,
          messages: wire.messages as unknown as Array<Record<string, unknown>>,
          tools: true,
        })
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        // The vite stub (no wasm-pack pkg) throws `not bundled` — translate to
        // an actionable house-prefixed error instead of an unhandled rejection.
        if (detail.includes('not bundled') || detail.includes('wasm backend unavailable')) {
          return { stopped: 'error', error: 'network: browser engine not bundled — use desktop/Docker, or rebuild the Pages pack with wasm-pack' }
        }
        return { stopped: 'error', error: `network: provider call failed — ${detail}` }
      }
      if (!res.ok) {
        return { stopped: 'error', error: res.error ?? 'network: provider call failed' }
      }
      const turnData = res.turn!
      usage.inputTokens += turnData.usage.inputTokens ?? 0
      usage.outputTokens += turnData.usage.outputTokens ?? 0
      if (!turnData.tool_calls.length) {
        messages.push({ role: 'assistant', content: turnData.content })
        onUpdate?.()
        return { stopped: 'done' }
      }
      messages.push({
        role: 'assistant_tool',
        content: turnData.content,
        toolInput: assistantToolWire(turnData.tool_calls),
      } as ChatMessage)
      onUpdate?.()
      for (const call of turnData.tool_calls) {
        const input = (call.input ?? {}) as Record<string, unknown>
        const json = JSON.stringify(call.input ?? {})
        if (lastSig && lastSig.name === call.name && lastSig.json === json) {
          repeats += 1
        } else {
          lastSig = { name: call.name, json }
          repeats = 1
        }
        if (repeats >= 3) {
          messages.push({
            role: 'tool',
            content: 'denied: identical tool call repeated 3 times (doom-loop guard) — vary the input or explain',
            toolCallId: call.id,
            toolName: call.name,
          })
          onUpdate?.()
          continue
        }
        if (call.name === 'question') {
          const q = String(input.question ?? 'The agent has a question.')
          localActivity.value = 'question · waiting for you'
          const ans = await waitApproval({ tool: 'question', input, summary: q, question: q })
          localActivity.value = `thinking · ${opts.model}`
          messages.push({
            role: 'tool',
            content: ans.approved ? `user answered: ${ans.answer || 'approved without comment'}` : 'declined: user declined to answer',
            toolCallId: call.id,
            toolName: call.name,
          })
          onUpdate?.()
          continue
        }
        localActivity.value = activityLine(call.name, input)
        const decision = decideLocalTool(opts.permission, opts.agentKind, call.name, input)
        if (decision.kind === 'deny') {
          breaker.record(call.name, true)
          messages.push({
            role: 'tool',
            content: `${decision.reason} — adjust the permission ruleset to allow it`,
            toolCallId: call.id,
            toolName: call.name,
          })
          onUpdate?.()
          continue
        }
        if (decision.kind === 'ask' && opts.autoApprove) {
          // Auto mode approves ordinary asks — never standing orders.
          const refused = protectedAutoApproveDenial(call.name, input)
          if (refused) {
            breaker.record(call.name, true)
            messages.push({ role: 'tool', content: refused, toolCallId: call.id, toolName: call.name })
            onUpdate?.()
            continue
          }
          breaker.record(call.name, false)
        }
        if (decision.kind === 'ask' && !opts.autoApprove) {
          if (breaker.isOpen(call.name)) {
            messages.push({
              role: 'tool',
              content: breaker.reason(call.name),
              toolCallId: call.id,
              toolName: call.name,
            })
            onUpdate?.()
            continue
          }
          localActivity.value = `${call.name} · waiting for approval`
          const ans = await waitApproval({ tool: call.name, input, summary: decision.summary, question: null })
          if (!ans.approved) {
            breaker.record(call.name, true)
            const feedback = (ans.answer ?? '').trim()
            messages.push({
              role: 'tool',
              content: feedback
                ? `denied: user rejected \`${call.name}\` — user feedback: ${feedback} — work around it or explain`
                : `denied: user rejected \`${call.name}\` — work around it or explain`,
              toolCallId: call.id,
              toolName: call.name,
            })
            onUpdate?.()
            continue
          }
          breaker.record(call.name, false)
          if (ans.remember) {
            rememberAllowLocal(opts.permission, call.name)
            opts.onRemember?.(call.name)
          }
        }
        if (decision.kind === 'allow') breaker.record(call.name, false)
        try {
          const output = await execLocalTool(call, '/', opts.configId ?? '')
          messages.push({ role: 'tool', content: output, toolCallId: call.id, toolName: call.name })
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          const mapped = detail.includes('not bundled') || detail.includes('wasm backend unavailable')
            ? 'unsupported: browser volume unavailable in this build — use desktop/Docker, or rebuild the Pages pack with wasm-pack'
            : detail
          messages.push({ role: 'tool', content: mapped.startsWith('unsupported:') || mapped.startsWith('error:') ? mapped : `error: ${mapped}`, toolCallId: call.id, toolName: call.name })
        }
        onUpdate?.()
      }
    }
    return { stopped: 'limit' }
  } finally {
    running.value = false
    localActivity.value = ''
  }
}

/** `edit /src/app.rs` — same salient-argument shape the native job line shows. */
function activityLine(name: string, input: Record<string, unknown>): string {
  let arg = ''
  try {
    arg = JSON.stringify(input ?? {})
  } catch {
    arg = ''
  }
  if (arg === '{}' || arg === 'undefined') return name
  arg = arg.replace(/["[\]{}]/g, '').replace(/,/g, ' ').trim()
  return arg.length > 150 ? `${name} ${arg.slice(0, 150)}…` : `${name} ${arg}`
}

// ─── local configs + sessions (localStorage; keys never persisted) ──

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private mode — sessions simply don't persist.
  }
}

export function listLocalConfigs(): AgentConfig[] {
  return readJson<AgentConfig[]>(CONFIGS_KEY, [])
}

export function saveLocalConfig(config: AgentConfig): void {
  const all = listLocalConfigs().filter(c => c.id !== config.id)
  all.push({ ...config, hasKey: false })
  writeJson(CONFIGS_KEY, all)
}

export function deleteLocalConfig(id: string): void {
  writeJson(
    CONFIGS_KEY,
    listLocalConfigs().filter(c => c.id !== id),
  )
}

export function listLocalSessions(): AgentSession[] {
  const all = readJson<AgentSession[]>(SESSIONS_KEY, [])
  return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 100)
}

export function saveLocalSession(session: AgentSession): void {
  const all = readJson<AgentSession[]>(SESSIONS_KEY, [])
  const i = all.findIndex(s => s.id === session.id)
  if (i >= 0) all[i] = session
  else all.unshift(session)
  writeJson(SESSIONS_KEY, all.slice(0, 100))
}

export function deleteLocalSession(id: string): void {
  writeJson(
    SESSIONS_KEY,
    readJson<AgentSession[]>(SESSIONS_KEY, []).filter(s => s.id !== id),
  )
}

// ─── local semantic memory (keyword-only recall; the browser mints no
// vectors without an embeddings endpoint — rows stay comparable via the
// same rank/score contract as the native store) ──────────────────────

const localStorageMemory: MemoryStorage = {
  load: () => readJson<AgentMemory[]>(MEMORIES_KEY, []),
  save: all => writeJson(MEMORIES_KEY, all.slice(-500)),
}

export const localMemories = new LocalMemoryStore(localStorageMemory)

export function listLocalMemories(configId?: string): AgentMemory[] {
  return localMemories.list(configId)
}

export function deleteLocalMemory(id: string): void {
  localMemories.remove(id)
}

/** Bounded recall block for the browser system prompt ("" when empty). */
export function recallBlockLocal(configId: string, query: string, topK = 3): string {
  const hits: MemoryHit[] = localMemories.recall(configId, query, topK)
  if (!hits.length) return ''
  return renderRecallBlock(hits) + '\n(degraded: keyword-only recall — no embeddings on this transport)\n'
}

export function useAgent() {
  return {
    running,
    pendingApproval,
    localActivity,
    wasmAgentCatalog,
    runLocalAgent,
    listLocalConfigs,
    saveLocalConfig,
    deleteLocalConfig,
    listLocalSessions,
    saveLocalSession,
    deleteLocalSession,
    listLocalMemories,
    deleteLocalMemory,
    recallBlockLocal,
    matchWildcard,
    decideLocalTool,
  }
}

export type LocalAgentJob = {
  jobId: string
  sessionId: string
  configId: string
  status: string
  turnsUsed: number
  maxTurns: number
  usage: TokenUsage
  result?: string | null
  error?: string | null
  pending?: { tool: string; input: Record<string, unknown>; summary: string; question?: string | null } | null
};
