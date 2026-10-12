// CyberManju OS — WAN transport seam (crates/sync/src/iroh.rs).
// Role: honest WAN leg of §2B (ANALYSIS.md) — device identity ✅, LAN
// discovery ✅, CAS leases ✅, sneakernet ✅ and direct LAN sync ✅ are all
// landed; the HTTP dial path below is REAL (std TcpStream probe + op-log
// pull/push steps, no new deps) so off-LAN peers sync today wherever `/api`
// is reachable. Only QUIC/NAT-traversal (`iroh` relay dial) stays sequenced
// (new dependency + networked CI proving), never pretended.
// Exports: IrohConfig, IrohEndpoint, parse_endpoint, dial_plan, http_base,
// http_dial_steps, http_probe.
// Integrates: sync crate (std-only, no new deps); the op-log push/pull
// payloads ride unchanged on both paths — only `dial` grows a backend.
// Contracts: every constructor validates; nothing here opens a socket except
// `http_probe` (bounded timeout, `network:` on failure) — `dial_plan` answers
// `unsupported:` with the exact reason until the QUIC transport lands, so
// callers degrade to HTTP/LAN/bundle instead of hanging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrohConfig {
    /// Relay URL (e.g. `https://relay.cybermanju.example`). Empty = direct only.
    pub relay_url: String,
    /// Seconds to wait for NAT traversal before giving up (1..=120).
    pub dial_timeout_secs: u64,
}

impl Default for IrohConfig {
    fn default() -> Self {
        Self {
            relay_url: String::new(),
            dial_timeout_secs: 15,
        }
    }
}

/// A parsed peer endpoint: `<device-id>@<addr>` where addr is still opaque
/// (DNS name, IP or a future iroh ticket — the dial backend decides).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrohEndpoint {
    pub device_id: String,
    pub addr: String,
}

/// Parse `<device-id>@<addr>`; both halves required, whitespace refused.
pub fn parse_endpoint(text: &str) -> Result<IrohEndpoint, String> {
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
    Ok(IrohEndpoint { device_id, addr })
}

/// Validate a WAN dial config. Always `Err("unsupported: …")` today — the
/// iroh QUIC backend is sequenced, not shipped — naming what is missing so the
/// UI can offer HTTP dial + LAN sync + sneakernet instead of a hang.
pub fn dial_plan(endpoint: &IrohEndpoint, config: &IrohConfig) -> Result<String, String> {
    if config.dial_timeout_secs == 0 || config.dial_timeout_secs > 120 {
        return Err("invalid: dial_timeout_secs must be 1..=120".to_string());
    }
    if endpoint.device_id.trim().is_empty() {
        return Err("invalid: dial needs a device id".to_string());
    }
    Err(format!(
        "unsupported: QUIC dial to '{}' needs the iroh transport (sequenced: new dependency + networked CI proving) — use HTTP dial (GET /api/readyz + op-log pull/push), direct LAN sync or a sneakernet bundle",
        endpoint.device_id,
    ))
}

/// `http(s)://` base for a WAN endpoint. The addr half stays opaque (DNS
/// name, `host:port`, or a full URL); nothing is guessed — a bare addr
/// becomes `http://<addr>`, an existing scheme is kept verbatim.
pub fn http_base(endpoint: &IrohEndpoint) -> String {
    let addr = endpoint.addr.trim().trim_end_matches('/');
    if addr.len() >= 7
        && (addr.starts_with("http://")
            || addr.starts_with("HTTP://")
            || addr.starts_with("https://")
            || addr.starts_with("HTTPS://"))
    {
        addr.to_string()
    } else {
        format!("http://{addr}")
    }
}

/// Real HTTP dial steps for an off-LAN peer: probe `/api/readyz`, then the
/// op-log pull → push → merge → render exchange over plain HTTP. Same shape
/// as the frontend `wanDialSteps` (pinned by `wan-dial.test.ts` + `spine.rs`).
pub fn http_dial_steps(endpoint: &IrohEndpoint, since: u64) -> Vec<String> {
    let base = http_base(endpoint);
    vec![
        format!("probe: GET {base}/api/readyz ({} s abort, fail-closed)", 15),
        format!("pull: GET {base}/api/oplog/since?since={since}"),
        format!("push: POST {base}/api/oplog/push {{ ops: ours }}"),
        "merge: POST /api/oplog/push { ops: theirs }".to_string(),
        "render: GET /api/oplog/conflicts".to_string(),
    ]
}

/// Probe `GET <addr>/api/readyz` over std TcpStream with a bounded timeout.
/// `addr` accepts `host:port` or a full `http(s)://host:port` URL; the port
/// defaults to 3456 (the dashboard). Returns `Ok(true)` on any HTTP response
/// with a 2xx status, else `Err("network: …")` — never a hang, never a panic.
///
/// Only literal IPv4/hostname `host:port` forms are dialed (no TLS, no relay
/// tickets — those stay `unsupported:` until the QUIC backend lands).
pub fn http_probe(addr: &str, timeout_secs: u64) -> Result<bool, String> {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    if timeout_secs == 0 || timeout_secs > 120 {
        return Err("invalid: dial_timeout_secs must be 1..=120".to_string());
    }
    let hostport = addr
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_start_matches("HTTP://")
        .trim_start_matches("HTTPS://")
        .trim_end_matches('/')
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if hostport.is_empty() {
        return Err("invalid: probe needs a host:port or URL".to_string());
    }
    if hostport.contains(char::is_whitespace) {
        return Err("invalid: probe addr must not contain whitespace".to_string());
    }
    // Relay tickets / multiaddrs are the QUIC future, not this socket.
    if hostport.contains('@') || hostport.contains("relay") {
        return Err(
            "unsupported: relay-ticket dial needs the iroh transport — use direct host:port or a sneakernet bundle"
                .to_string(),
        );
    }
    let socket_addr = if hostport.contains(':') {
        hostport.clone()
    } else {
        format!("{hostport}:3456")
    };
    let timeout = Duration::from_secs(timeout_secs);
    let resolved = socket_addr
        .to_socket_addrs()
        .map_err(|e| format!("network: WAN probe failed to resolve '{socket_addr}': {e}"))?
        .next()
        .ok_or_else(|| format!("network: WAN probe resolved no address for '{socket_addr}'"))?;
    let mut stream = TcpStream::connect_timeout(&resolved, timeout)
        .map_err(|e| format!("network: WAN probe failed for '{socket_addr}': {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("network: WAN probe failed for '{socket_addr}': {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("network: WAN probe failed for '{socket_addr}': {e}"))?;
    let req =
        format!("GET /api/readyz HTTP/1.0\r\nHost: {socket_addr}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("network: WAN probe failed for '{socket_addr}': {e}"))?;
    let mut buf = [0u8; 512];
    let n = stream
        .read(&mut buf)
        .map_err(|e| format!("network: WAN probe failed for '{socket_addr}': {e}"))?;
    let head = String::from_utf8_lossy(&buf[..n]);
    let status: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    if (200..300).contains(&status) {
        Ok(true)
    } else {
        Err(format!(
            "network: WAN probe {socket_addr} answered HTTP {status}"
        ))
    }
}

/// Classify a raw addr half without opening a socket: relay tickets and
/// multiaddrs are the QUIC future, everything else is direct HTTP. Pure
/// alias over `peers::classify_addr` so both seams agree on one grammar.
pub fn classify_addr(addr: &str) -> super::peers::PeerTransport {
    super::peers::classify_addr(addr)
}

/// Real direct-HTTP dial plan for off-LAN peers (probe + op-log pull/push).
/// Relay endpoints refuse with `unsupported:` — pure alias over
/// `peers::direct_http_plan` so the WAN seam and the peer seam share steps.
pub fn direct_http_plan(endpoint: &IrohEndpoint, since: u64) -> Result<Vec<String>, String> {
    let peer = super::peers::PeerEndpoint {
        device_id: endpoint.device_id.clone(),
        base_url: http_base(endpoint),
        transport: super::peers::classify_addr(&endpoint.addr),
    };
    super::peers::direct_http_plan(&peer, since)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_parses_device_at_addr() {
        let ep = parse_endpoint("phone-7@192.168.1.60:3456").unwrap();
        assert_eq!(ep.device_id, "phone-7");
        assert_eq!(ep.addr, "192.168.1.60:3456");
    }

    #[test]
    fn endpoint_rejects_blanks_and_whitespace() {
        assert!(parse_endpoint("no-at-sign").is_err());
        assert!(parse_endpoint("@addr").is_err());
        assert!(parse_endpoint("id@").is_err());
        assert!(parse_endpoint("my id@addr").is_err());
    }

    #[test]
    fn dial_plan_is_honestly_unsupported_with_a_way_out() {
        let ep = parse_endpoint("phone-7@relay:443").unwrap();
        let err = dial_plan(&ep, &IrohConfig::default()).expect_err("no QUIC transport yet");
        assert!(err.starts_with("unsupported:"), "{err}");
        assert!(err.contains("HTTP dial"), "{err}");
        let bad = dial_plan(
            &ep,
            &IrohConfig {
                relay_url: String::new(),
                dial_timeout_secs: 0,
            },
        );
        assert!(
            bad.unwrap_err().starts_with("invalid:"),
            "timeout validated first"
        );
    }

    #[test]
    fn http_base_keeps_scheme_and_defaults_to_http() {
        let bare = parse_endpoint("phone-7@192.168.1.60:3456").unwrap();
        assert_eq!(http_base(&bare), "http://192.168.1.60:3456");
        let url = parse_endpoint("phone-7@https://vault.example.com").unwrap();
        assert_eq!(http_base(&url), "https://vault.example.com");
    }

    #[test]
    fn http_dial_steps_are_oplog_pull_push_merge() {
        let ep = parse_endpoint("phone-7@192.168.1.60:3456").unwrap();
        let steps = http_dial_steps(&ep, 41);
        assert_eq!(steps.len(), 5);
        assert!(steps[0].contains("/api/readyz"), "{steps:?}");
        assert!(steps[1].contains("/api/oplog/since?since=41"), "{steps:?}");
        assert!(steps[2].contains("/api/oplog/push"), "{steps:?}");
        assert!(steps[4].contains("/api/oplog/conflicts"), "{steps:?}");
    }

    #[test]
    fn http_probe_validates_and_refuses_relays_honestly() {
        // Invalid timeout first (no socket opened).
        assert!(http_probe("127.0.0.1:9", 0)
            .unwrap_err()
            .starts_with("invalid:"));
        // Relay tickets are the QUIC future, not this socket.
        let relay = http_probe("phone-7@relay.example", 2).unwrap_err();
        assert!(relay.starts_with("unsupported:"), "{relay}");
        // Closed loopback port answers `network:`, never hangs, never panics.
        let closed = http_probe("127.0.0.1:9", 2).unwrap_err();
        assert!(closed.starts_with("network:"), "{closed}");
    }
}
