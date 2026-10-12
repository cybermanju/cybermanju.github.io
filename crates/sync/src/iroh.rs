// CyberManju OS — WAN transport seam (crates/sync/src/iroh.rs).
// Role: honest placeholder for the iroh leg of §2B (ANALYSIS.md) — device
// identity ✅, LAN discovery ✅, CAS leases ✅, sneakernet ✅ and direct LAN
// sync ✅ are all landed; WANNAT traversal is sequenced after them because
// it needs a new dependency (`iroh`) plus networked CI proving, neither of
// which belongs in a blind commit.
// Exports: IrohConfig, IrohEndpoint, parse_endpoint, dial_plan.
// Integrates: sync crate (std-only, no new deps); the op-log push/pull
// payloads ride unchanged when a real endpoint arrives — only `dial` grows
// a backend.
// Contracts: every constructor validates; nothing here opens a socket —
// `dial_plan` answers `unsupported:` with the exact reason until the
// transport lands, so callers degrade to LAN/bundle instead of hanging.
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
/// iroh backend is sequenced, not shipped — naming what is missing so the
/// UI can offer LAN sync + sneakernet instead of a hang.
pub fn dial_plan(endpoint: &IrohEndpoint, config: &IrohConfig) -> Result<String, String> {
    if config.dial_timeout_secs == 0 || config.dial_timeout_secs > 120 {
        return Err("invalid: dial_timeout_secs must be 1..=120".to_string());
    }
    if endpoint.device_id.trim().is_empty() {
        return Err("invalid: dial needs a device id".to_string());
    }
    Err(format!(
        "unsupported: WAN dial to '{}' needs the iroh transport (sequenced: new dependency + networked CI proving) — use direct LAN sync or a sneakernet bundle",
        endpoint.device_id,
    ))
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
        let err = dial_plan(&ep, &IrohConfig::default()).expect_err("no transport yet");
        assert!(err.starts_with("unsupported:"), "{err}");
        assert!(err.contains("LAN sync"), "{err}");
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
}
