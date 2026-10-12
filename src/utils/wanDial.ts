// CyberManju OS — WAN dial seam (src/utils/wanDial.ts).
// Role: frontend mirror of the iroh seam in crates/sync/src/iroh.rs
// (ANALYSIS.md §2B.5) — parse `<device>@<addr>` endpoints, answer the QUIC
// dial plan honestly (`unsupported:` + LAN/bundle way out), and offer a REAL
// HTTP dial path (op-log pull/push over plain fetch, 15 s abort) that works
// today wherever the peer exposes `/api`. QUIC/NAT-traversal stays sequenced
// (new dep + networked CI proving).
// Exports: WanEndpoint, parseWanEndpoint, wanDialPlan, wanWayOut,
// wanHttpBase, wanDialSteps, wanHttpProbe.
// Integrates: DevicesPanel WAN card renders plan + dial steps; `wan plan|dial`
// cybsh verbs reuse the builders; Rust twin is crates/sync/src/iroh.rs (same
// grammar, same `unsupported:` prefix, pinned by wan-dial.test.ts).
// Contracts: pure builders never throw except `invalid:`/`unsupported:` with
// AGENT-1 prefixes; `wanHttpProbe` never hangs (AbortController 15 s default)
// and normalizes failures to `network:` — never a guessed address.
export interface WanEndpoint {
  deviceId: string
  addr: string
}

/** Parse `<device-id>@<addr>`; both halves required, whitespace refused. */
export function parseWanEndpoint(text: string): WanEndpoint {
  const at = text.indexOf('@')
  if (at < 0) throw new Error('invalid: endpoint must be <device-id>@<addr>')
  const deviceId = text.slice(0, at).trim()
  const addr = text.slice(at + 1).trim()
  if (!deviceId || !addr) throw new Error('invalid: endpoint needs both a device id and an address')
  if (/\s/.test(deviceId) || /\s/.test(addr)) {
    throw new Error('invalid: endpoint halves must not contain whitespace')
  }
  return { deviceId, addr }
}

/** Validate a dial timeout (1..=120s, mirroring IrohConfig validation). */
export function checkDialTimeout(secs: number): void {
  if (!Number.isFinite(secs) || Math.floor(secs) !== secs || secs < 1 || secs > 120) {
    throw new Error('invalid: dial_timeout_secs must be 1..=120')
  }
}

/** Honest QUIC dial plan: always `unsupported:` with the live way out. */
export function wanDialPlan(endpoint: WanEndpoint, dialTimeoutSecs = 15): string {
  checkDialTimeout(dialTimeoutSecs)
  if (!endpoint.deviceId.trim()) throw new Error('invalid: dial needs a device id')
  throw new Error(
    `unsupported: QUIC dial to '${endpoint.deviceId}' needs the iroh transport (sequenced: new dependency + networked CI proving) — use HTTP dial (GET /api/readyz + op-log pull/push), direct LAN sync or a sneakernet bundle`,
  )
}

/** The way out offered alongside the `unsupported:` plan (never guessed). */
export function wanWayOut(endpoint: WanEndpoint): string[] {
  return [
    `lan: POST /api/peers/${endpoint.deviceId}/sync (same Wi-Fi, Devices → LAN peers → SYNC)`,
    'bundle: sneakernet op-log delta via GET/POST /api/sync/bundle/export|import (untrusted sticks stay tamper-evident)',
    `op-log: pull GET /api/oplog/since on next contact — no rescan, payloads ride unchanged when the endpoint arrives (${endpoint.addr})`,
  ]
}

/** `http(s)://` base for a WAN endpoint (addr stays opaque, never guessed). */
export function wanHttpBase(endpoint: WanEndpoint): string {
  const addr = endpoint.addr.trim()
  if (/^https?:\/\//i.test(addr)) return addr.replace(/\/+$/, '')
  return `http://${addr}`
}

/** Real HTTP dial steps: op-log pull → push → merge → render over the base. */
export function wanDialSteps(endpoint: WanEndpoint, since = 0): string[] {
  const base = wanHttpBase(endpoint)
  const s = Math.max(0, Math.floor(since))
  return [
    `probe: GET ${base}/api/readyz (15 s abort, fail-closed)`,
    `pull: GET ${base}/api/oplog/since?since=${s}`,
    `push: POST ${base}/api/oplog/push { ops: ours }`,
    `merge: POST /api/oplog/push { ops: theirs }`,
    'render: GET /api/oplog/conflicts',
  ]
}

/**
 * Execute the WAN op-log exchange against a peer base URL: pull → push →
 * merge → render via `syncExchangeWithPeer`. Relay endpoints refuse with
 * `unsupported:` (QUIC is sequenced); direct HTTP peers sync today on all
 * six targets wherever `/api` is reachable.
 */
export async function wanSyncExchange(
  endpoint: WanEndpoint,
  since: number,
  localOps: unknown[],
  deps: {
    fetchJson: (method: string, url: string, body?: unknown) => Promise<unknown>
    pushOps: (ops: unknown[]) => Promise<{ appended: number }>
    fetchConflicts?: () => Promise<unknown>
  },
): Promise<{ pulled: number; pushed: number; steps: string[] }> {
  const { syncExchangeWithPeer } = await import('./peerSearch')
  return syncExchangeWithPeer(
    { deviceId: endpoint.deviceId, baseUrl: endpoint.addr, transport: 'wan-http' },
    since,
    localOps,
    deps,
  )
}
/**
 * Probe a peer's `/api/readyz` with a 15 s abort. Resolves `true` on HTTP 2xx,
 * otherwise throws an AGENT-1 `network:` error (never a hang, never a guess).
 * Node-env safe: without a global `fetch` it answers `unsupported:`.
 */
export async function wanHttpProbe(baseUrl: string, timeoutMs = 15000): Promise<true> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch
  if (typeof fetchFn !== 'function') {
    throw new Error('unsupported: WAN HTTP probe needs fetch (browser or Node 18+)')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/api/readyz`, {
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`network: WAN probe ${baseUrl} answered HTTP ${res.status}`)
    return true
  } catch (err) {
    if (err instanceof Error && /WAN probe|unsupported:/.test(err.message)) throw err
    const reason = err instanceof Error ? err.message : String(err)
    const aborted = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(reason))
    throw new Error(
      aborted
        ? `network: WAN probe timed out after ${timeoutMs}ms calling ${baseUrl}: ${reason}`
        : `network: WAN probe failed for ${baseUrl}: ${reason}`,
    )
  } finally {
    clearTimeout(timer)
  }
}
