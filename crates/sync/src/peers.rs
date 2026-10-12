// CyberManju OS — Peer transports + federated search (crates/sync/src/peers.rs).
// Role: cross-platform P2P seam (§2B) — one transport enum over the paths that
// really work today (LAN HTTP via mDNS, direct WAN HTTP op-log/search, USB
// sneakernet bundles) with the iroh QUIC relay honestly sequenced as
// `RelayFuture`. Plus the cross-device search port: fetch a peer's
// `GET /api/search` over plain HTTP and merge ranked hits (dedup by file id,
// max score wins, stable desc sort).
// Exports: PeerTransport, PeerEndpoint, parse_peer_endpoint, normalize_base_url,
// classify_addr, is_lan_base, direct_http_plan, FederatedHit,
// merge_federated_hits, fetch_peer_hits, platform_notes.
// Integrates: sync crate (std + reqwest blocking + serde_json already deps);
// `POST /api/search/federated` and the `search_files_federated` Tauri command
// ride on `merge_federated_hits` + `fetch_peer_hits`; the TS twin is
// `src/utils/peerSearch.ts` (same grammar, same merge order).
// Contracts: every constructor validates (`invalid:`); relay tickets answer
// `unsupported:` with the HTTP/LAN/bundle way out, never a hang;
// `fetch_peer_hits` never exceeds its timeout and normalizes failures to
// `network:` / `auth:` — never a guessed address, never a panic.
use std::time::Duration;

/// How we reach a peer. Only `RelayFuture` is aspirational — everything else
/// is live on all six targets (android/ios/windows/linux/docker/wasm-fetch).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerTransport {
    /// Same Wi-Fi via mDNS discovery + `http://host:port` op-log/search.
    LanHttp,
    /// Direct `http(s)://host:port` op-log/search wherever `/api` is reachable.
    WanHttp,
    /// USB sneakernet bundle (`GET/POST /api/sync/bundle/*`), no network.
    Bundle,
    /// iroh QUIC relay / NAT traversal — sequenced, not shipped.
    RelayFuture,
}

impl PeerTransport {
    /// Stable wire string (TS twin `peerTransportName` matches it).
    pub fn as_str(self) -> &'static str {
        match self {
            PeerTransport::LanHttp => "lan-http",
            PeerTransport::WanHttp => "wan-http",
            PeerTransport::Bundle => "bundle",
            PeerTransport::RelayFuture => "relay-future",
        }
    }
}

/// One reachable peer: who it is + where its `/api` lives + how we dial it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerEndpoint {
    pub device_id: String,
    pub base_url: String,
    pub transport: PeerTransport,
}

/// `http(s)://` base for a raw addr half. The addr stays opaque (DNS name,
/// `host:port`, or a full URL); nothing is guessed — a bare addr becomes
/// `http://<addr>`, an existing scheme is kept verbatim (trailing `/` cut).
pub fn normalize_base_url(addr: &str) -> Result<String, String> {
    let base = addr.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("invalid: peer address is required".to_string());
    }
    if base.contains(char::is_whitespace) {
        return Err("invalid: peer address must not contain whitespace".to_string());
    }
    if base.len() >= 7
        && (base.starts_with("http://")
            || base.starts_with("HTTP://")
            || base.starts_with("https://")
            || base.starts_with("HTTPS://"))
    {
        Ok(base.to_string())
    } else {
        Ok(format!("http://{base}"))
    }
}

/// Classify a raw addr half without opening any socket. Relay tickets and
/// multiaddrs (`relay`, `iroh:`, `@`-tickets) are the QUIC future; everything
/// else is direct HTTP (LAN vs WAN is decided by `is_lan_base` on the base).
pub fn classify_addr(addr: &str) -> PeerTransport {
    let low = addr.trim().to_lowercase();
    if low.contains("relay") || low.starts_with("iroh:") || low.contains("/p2p/") {
        return PeerTransport::RelayFuture;
    }
    if is_lan_base(&low) {
        return PeerTransport::LanHttp;
    }
    PeerTransport::WanHttp
}

/// True when a (lower-cased) base/addr looks like same-network HTTP:
/// localhost, RFC-1918, link-local, `.local` mDNS names, or the 3456 default.
pub fn is_lan_base(lower_base_or_addr: &str) -> bool {
    let b = lower_base_or_addr;
    b.contains("localhost")
        || b.contains("127.")
        || b.contains("[::1]")
        || b.contains("10.")
        || b.contains("192.168.")
        || b.contains("172.16.")
        || b.contains("172.17.")
        || b.contains("172.18.")
        || b.contains("172.19.")
        || b.contains("172.2")
        || b.contains("172.30.")
        || b.contains("172.31.")
        || b.contains("169.254.")
        || b.contains(".local")
        || b.contains("0.0.0.0")
}

/// Parse `<device-id>@<addr>` into a dialable endpoint. Both halves required,
/// whitespace refused. Relay addrs parse fine but classify as `RelayFuture`
/// so callers degrade to HTTP/LAN/bundle instead of hanging.
pub fn parse_peer_endpoint(text: &str) -> Result<PeerEndpoint, String> {
    let (device_id, addr) = text
        .split_once('@')
        .ok_or_else(|| "invalid: endpoint must be <device-id>@<addr>".to_string())?;
    let device_id = device_id.trim().to_string();
    let addr = addr.trim().to_string();
    if device_id.is_empty() || addr.is_empty() {
        return Err("invalid: endpoint needs both a device id and an address".to_string());
    }
    if device_id.contains(char::is_whitespace) || addr.contains(char::is_whitespace) {
        return Err("invalid: endpoint halves must not contain whitespace".to_string());
    }
    let transport = classify_addr(&addr);
    let base_url = normalize_base_url(&addr)?;
    Ok(PeerEndpoint {
        device_id,
        base_url,
        transport,
    })
}

/// Real direct-HTTP sync steps for a dialable peer: probe `/api/readyz`, then
/// the op-log pull → push → merge → render exchange. Relay endpoints refuse
/// with `unsupported:` (QUIC is sequenced) naming the live way out.
pub fn direct_http_plan(peer: &PeerEndpoint, since: u64) -> Result<Vec<String>, String> {
    if peer.device_id.trim().is_empty() {
        return Err("invalid: plan needs a device id".to_string());
    }
    if peer.transport == PeerTransport::RelayFuture {
        return Err(format!(
            "unsupported: QUIC dial to '{}' needs the iroh transport (sequenced: new dependency + networked CI proving) — use HTTP dial (GET /api/readyz + op-log pull/push), direct LAN sync or a sneakernet bundle",
            peer.device_id,
        ));
    }
    let base = peer.base_url.trim_end_matches('/');
    Ok(vec![
        format!("probe: GET {base}/api/readyz (15 s abort, fail-closed)"),
        format!("pull: GET {base}/api/oplog/since?since={since}"),
        format!("push: POST {base}/api/oplog/push {{ ops: ours }}"),
        "merge: POST /api/oplog/push { ops: theirs }".to_string(),
        "render: GET /api/oplog/conflicts".to_string(),
    ])
}

/// One ranked hit from any device (local or peer). `source` is the device id
/// for local hits and the peer base URL for remote ones.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FederatedHit {
    pub file_id: String,
    pub file_name: String,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub source: String,
}

/// Merge ranked hits across devices: dedup by `file_id` (max score wins; on a
/// tie the richer snippet wins), stable desc sort by score, truncate to
/// `limit`. Pure — the TS twin `mergeFederatedHits` pins the same order.
pub fn merge_federated_hits(mut hits: Vec<FederatedHit>, limit: usize) -> Vec<FederatedHit> {
    let mut best: std::collections::HashMap<String, FederatedHit> = Default::default();
    for hit in hits.drain(..) {
        if hit.file_id.trim().is_empty() {
            continue;
        }
        let replace = match best.get(&hit.file_id) {
            Some(cur) => {
                hit.score > cur.score
                    || (hit.score == cur.score && hit.snippet.len() > cur.snippet.len())
            }
            None => true,
        };
        if replace {
            best.insert(hit.file_id.clone(), hit);
        }
    }
    let mut out: Vec<FederatedHit> = best.into_values().collect();
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(limit);
    out
}

fn encode_query(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    for ch in query.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            ' ' => out.push_str("%20"),
            _ => {
                let encoded = ch.to_string();
                for b in encoded.as_bytes() {
                    out.push_str(&format!("%{b:02X}"));
                }
            }
        }
    }
    out
}

fn hit_from_value(value: &serde_json::Value, source: &str) -> Option<FederatedHit> {
    let obj = value.as_object()?;
    let file_id = obj
        .get("fileId")
        .or_else(|| obj.get("file_id"))
        .or_else(|| obj.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if file_id.trim().is_empty() {
        return None;
    }
    let file_name = obj
        .get("fileName")
        .or_else(|| obj.get("file_name"))
        .or_else(|| obj.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let file_name = if file_name.is_empty() {
        file_id.clone()
    } else {
        file_name
    };
    let score = obj.get("score").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let snippet = obj
        .get("snippet")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source = obj
        .get("source")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| source.to_string());
    Some(FederatedHit {
        file_id,
        file_name,
        score,
        snippet,
        source,
    })
}

/// Query one peer's `GET /api/search?q=&limit=` with a bounded timeout.
/// Returns source-tagged hits (empty when the peer has no match). Errors are
/// `invalid:` (bad args), `auth:` (401/403), or `network:` (everything else)
/// — never a hang, never a panic, never a guessed address.
pub fn fetch_peer_hits(
    base_url: &str,
    query: &str,
    limit: usize,
    timeout_secs: u64,
    bearer: Option<&str>,
) -> Result<Vec<FederatedHit>, String> {
    if timeout_secs == 0 || timeout_secs > 120 {
        return Err("invalid: timeout_secs must be 1..=120".to_string());
    }
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let base = normalize_base_url(base_url)?;
    let limit = limit.clamp(1, 200);
    let url = format!(
        "{}/api/search?q={}&limit={}",
        base.trim_end_matches('/'),
        encode_query(query),
        limit
    );
    let timeout = Duration::from_secs(timeout_secs);
    let client = reqwest::blocking::Client::builder()
        .user_agent("CyberManjuOS/0.1")
        .connect_timeout(timeout)
        .timeout(timeout)
        .build()
        .map_err(|e| format!("network: peer search client failed for '{base}': {e}"))?;
    let mut req = client.get(&url);
    if let Some(token) = bearer.filter(|t| !t.trim().is_empty()) {
        req = req.bearer_auth(token);
    }
    let resp = req
        .send()
        .map_err(|e| format!("network: peer search {} failed: {e}", base))?;
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err(format!("auth: peer search {base} refused (HTTP {status})"));
    }
    if !(200..300).contains(&status) {
        return Err(format!(
            "network: peer search {base} answered HTTP {status}"
        ));
    }
    let body: serde_json::Value = resp
        .json()
        .map_err(|e| format!("network: peer search {base} returned bad JSON: {e}"))?;
    let items: &[serde_json::Value] = if let Some(arr) = body.as_array() {
        arr
    } else if let Some(arr) = body.get("data").and_then(|v| v.as_array()) {
        arr
    } else if let Some(arr) = body.get("results").and_then(|v| v.as_array()) {
        arr
    } else {
        &[]
    };
    Ok(items
        .iter()
        .filter_map(|v| hit_from_value(v, &base))
        .take(limit)
        .collect())
}

/// Per-platform P2P reality check: (target, one-line note). The UI renders
/// this as the Devices → P2P matrix; every note names the working fallback.
pub fn platform_notes() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "android",
            "mDNS multicast is often blocked (no multicast lock) — use manual device@host:port peers + the cached peer list; search fans out over HTTP with the 15 MiB index heap",
        ),
        (
            "ios",
            "same as android (multicast restricted, background sockets suspended) — manual peers + cached list; HTTP fan-out only while the app is foregrounded",
        ),
        (
            "windows",
            "no system mDNS daemon by default — active scan only (queries from an ephemeral port); allow UDP 5353 / TCP 3456 through the firewall prompt",
        ),
        (
            "linux",
            "port 5353 is usually owned by avahi — passive answering degrades, active scan still finds peers; open UDP 5353 / TCP 3456 in firewalld/ufw",
        ),
        (
            "docker",
            "bridge networks block mDNS — run `--network host` for discovery or set explicit peer base URLs; mount SEARCH_INDEX_PATH persistently or the index rebuilds",
        ),
        (
            "wasm",
            "no UDP sockets / no mDNS in the sandbox — no discovery; search fans out with fetch() to explicit https:// peer URLs only (CORS + mixed-content apply), local search is BM25-lite",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_parses_and_classifies() {
        let lan = parse_peer_endpoint("phone-7@192.168.1.60:3456").unwrap();
        assert_eq!(lan.device_id, "phone-7");
        assert_eq!(lan.base_url, "http://192.168.1.60:3456");
        assert_eq!(lan.transport, PeerTransport::LanHttp);
        let wan = parse_peer_endpoint("vault@https://vault.example.com").unwrap();
        assert_eq!(wan.transport, PeerTransport::WanHttp);
        let relay = parse_peer_endpoint("phone-7@relay.cybermanju.example").unwrap();
        assert_eq!(relay.transport, PeerTransport::RelayFuture);
        assert!(parse_peer_endpoint("no-at-sign").is_err());
        assert!(parse_peer_endpoint("id@").is_err());
        assert!(parse_peer_endpoint("my id@addr").is_err());
    }

    #[test]
    fn direct_plan_runs_for_http_and_refuses_relays() {
        let lan = parse_peer_endpoint("phone-7@192.168.1.60:3456").unwrap();
        let steps = direct_http_plan(&lan, 41).unwrap();
        assert_eq!(steps.len(), 5);
        assert!(steps[0].contains("/api/readyz"), "{steps:?}");
        assert!(steps[1].contains("/api/oplog/since?since=41"), "{steps:?}");
        let relay = parse_peer_endpoint("phone-7@relay.example").unwrap();
        let err = direct_http_plan(&relay, 0).expect_err("relay is QUIC future");
        assert!(err.starts_with("unsupported:"), "{err}");
    }

    #[test]
    fn merge_dedups_by_file_id_max_score_wins() {
        let mk = |id: &str, score: f64, source: &str| FederatedHit {
            file_id: id.to_string(),
            file_name: format!("{id}.txt"),
            score,
            snippet: String::new(),
            source: source.to_string(),
        };
        let out = merge_federated_hits(
            vec![
                mk("a", 1.0, "local"),
                mk("a", 9.0, "peer"),
                mk("b", 5.0, "peer"),
                mk("", 99.0, "peer"),
            ],
            10,
        );
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].file_id, "a");
        assert_eq!(out[0].score, 9.0);
        assert_eq!(out[0].source, "peer");
        assert_eq!(out[1].file_id, "b");
    }

    #[test]
    fn fetch_validates_without_touching_the_network() {
        assert!(fetch_peer_hits("http://127.0.0.1:9", "q", 5, 0, None)
            .unwrap_err()
            .starts_with("invalid:"));
        assert!(fetch_peer_hits("http://127.0.0.1:9", "   ", 5, 2, None)
            .unwrap()
            .is_empty());
        let closed = fetch_peer_hits("http://127.0.0.1:9", "photo", 5, 2, None).unwrap_err();
        assert!(closed.starts_with("network:"), "{closed}");
    }

    #[test]
    fn every_target_has_a_note() {
        let notes = platform_notes();
        for target in ["android", "ios", "windows", "linux", "docker", "wasm"] {
            assert!(notes.iter().any(|(t, _)| *t == target), "{notes:?}");
        }
    }
}
