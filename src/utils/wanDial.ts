// CyberManju OS — WAN dial seam (src/utils/wanDial.ts).
// Role: frontend mirror of the iroh seam in crates/sync/src/iroh.rs
// (ANALYSIS.md §2B.5) — parse `<device>@<addr>` endpoints, answer the QUIC
// dial plan honestly (`unsupported:` + LAN/bundle way out), and offer a REAL
// HTTP dial path (op-log pull/push over plain fetch, 15 s abort) that works
// today wherever the peer exposes `/api`. QUIC/NAT-traversal stays sequenced
// (new dep + networked CI proving).
// Exports: WanEndpoint, parseWanEndpoint, wanDialPlan, wanWayOut,
// wanHttpBase, wanDialSteps, wanHttpProbe, isRelayAddr, wanPeekUrls,
// wanFederatedPlan.
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

/** True when the addr half needs the sequenced QUIC relay (same grammar as Rust `is_relay_addr`). */
export function isRelayAddr(addr: string): boolean {
  const low = addr.trim().toLowerCase()
  if (low.startsWith('iroh:') || low.includes('/p2p/')) return true
  return /(^|[^a-z0-9])relay([^a-z0-9]|$)/.test(low)
}

/** The three URL shapes one WAN endpoint fans out to (probe/search/op-log). */
export function wanPeekUrls(endpoint: WanEndpoint): { readyz: string; search: (q: string, limit?: number) => string; oplogSince: (since: number) => string } {
  const base = wanHttpBase(endpoint)
  return {
    readyz: `${base.replace(/\/+$/, '')}/api/readyz`,
    search: (q: string, limit = 20) => {
      const capped = Math.max(1, Math.min(Math.floor(limit) || 20, 200))
      return `${base.replace(/\/+$/, '')}/api/search?q=${encodeURIComponent(q)}&limit=${capped}`
    },
    oplogSince: (since: number) =>
      `${base.replace(/\/+$/, '')}/api/oplog/since?since=${Math.max(0, Math.floor(since) || 0)}&limit=500`,
  }
}

/**
 * Federated-search plan for a WAN endpoint (local BM25 + one bounded peer
 * fetch). Relay endpoints refuse with `unsupported:` — same gate as Rust
 * `federated_search_plan`.
 */
export function wanFederatedPlan(endpoint: WanEndpoint, query: string, limit = 20): string[] {
  if (!query.trim()) throw new Error('invalid: federated search needs a query')
  if (isRelayAddr(endpoint.addr)) {
    throw new Error(
      `unsupported: federated search to '${endpoint.deviceId}' needs the iroh transport (sequenced) — use direct host:port peers or POST /api/search/federated with reachable base URLs`,
    )
  }
  const capped = Math.max(1, Math.min(Math.floor(limit) || 20, 200))
  const urls = wanPeekUrls(endpoint)
  return [
    `local: BM25 \`${query}\` (limit ${capped}, tagged \`local\`)`,
    `peer: GET ${urls.search(query, capped)} (timeout 8 s, dead peer → zero hits)`,
  ]
}

/** The way out offered alongside the `unsupported:` plan (never guessed). */
export function wanWayOut(endpoint: WanEndpoint): string[] {
  return [
    `lan: POST /api/peers/${endpoint.deviceId}/sync (same Wi-Fi, Devices → LAN peers → SYNC)`,
    'bundle: sneakernet op-log delta via GET/POST /api/sync/bundle/export|import (untrusted sticks stay tamper-evident)',
    `op-log: pull GET /api/oplog/since on next contact — no rescan, payloads ride unchanged when the endpoint arrives (${endpoint.addr})`,
  ]
}

/** `http(s)://` base for a WAN endpoint (bare http hosts default to :3456, like the Rust probe). */
export function wanHttpBase(endpoint: WanEndpoint): string {
  const addr = endpoint.addr.trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(addr)) return addr
  // Bare `host` without a port means the dashboard — same default as
  // `iroh::http_probe` (`host:port` stays verbatim, IPv6 keeps brackets).
  if (!addr.includes(':')) return `http://${addr}:3456`
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
  if (isRelayAddr(endpoint.addr)) {
    throw new Error(
      `unsupported: QUIC dial to '${endpoint.deviceId}' needs the iroh transport (sequenced: new dependency + networked CI proving) — use HTTP dial (GET /api/readyz + op-log pull/push), direct LAN sync or a sneakernet bundle`,
    )
  }
  const { syncExchangeWithPeer } = await import('./peerSearch')
  return syncExchangeWithPeer(
    { deviceId: endpoint.deviceId, baseUrl: wanHttpBase(endpoint), transport: 'wan-http' },
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
