// CyberManju OS — explicit native widget host bridge contract.
// Role: Validate foreground widget actions before reaching the Android JNI boundary.
// Exports: command; no REST route, agent tool, polling, persistence or background action.
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_BYTES: usize = 65_536;
const ACTIONS: &[&str] = &[
    "providers",
    "list",
    "add",
    "configure",
    "layout",
    "hide",
    "remove",
    "cancel",
];
const CONFIRM_ACTIONS: &[&str] = &["add", "configure", "remove", "cancel"];

fn validate(action: &str, payload: &Value, now: u64) -> Result<(), String> {
    if !ACTIONS.contains(&action) {
        return Err("unsupported: unknown Android widget action".into());
    }
    if !payload.is_object() || payload.to_string().len() > MAX_PAYLOAD_BYTES {
        return Err("invalid: widget payload must be an object under 65536 bytes".into());
    }
    if CONFIRM_ACTIONS.contains(&action) {
        if payload.get("userInitiated").and_then(Value::as_bool) != Some(true) {
            return Err("auth: explicit user action required".into());
        }
        let expires = payload
            .get("expiresAt")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if expires <= now || expires > now.saturating_add(5_000) {
            return Err("conflict: widget action expired or invalid; try again".into());
        }
    }
    Ok(())
}

#[cfg(any(target_os = "android", test))]
fn decode_response(action: &str, raw: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| "integrity: malformed Android widget response".to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.to_owned());
    }
    if value.get("ok").and_then(Value::as_bool) != Some(true)
        || value.get("action").and_then(Value::as_str) != Some(action)
    {
        return Err("integrity: invalid Android widget acknowledgment".into());
    }
    Ok(value)
}

/// Invoke only for local widget UI actions. Native Android performs deeper validation.
pub fn command(action: &str, payload: Value) -> Result<Value, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "conflict: invalid system clock".to_string())?
        .as_millis() as u64;
    validate(action, &payload, now)?;
    #[cfg(target_os = "android")]
    {
        let raw = super::android_impl::native_dispatch(
            "CybermanjuWidgets",
            action,
            &payload.to_string(),
        )?;
        decode_response(action, &raw)
    }
    #[cfg(not(target_os = "android"))]
    Err("unsupported: native widgets require the Android app".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_action_payload_and_confirmation_window() {
        let now = 1_000;
        assert!(validate("providers", &json!({}), now).is_ok());
        assert!(validate("unknown", &json!({}), now)
            .unwrap_err()
            .starts_with("unsupported:"));
        assert!(validate("list", &json!([]), now)
            .unwrap_err()
            .starts_with("invalid:"));
        assert!(validate("list", &json!({"blob":"x".repeat(MAX_PAYLOAD_BYTES)}), now).is_err());
        assert!(validate("add", &json!({"userInitiated":true,"expiresAt":1001}), now).is_ok());
        assert!(validate(
            "remove",
            &json!({"userInitiated":true,"expiresAt":1000}),
            now
        )
        .is_err());
        assert!(validate(
            "cancel",
            &json!({"userInitiated":true,"expiresAt":6001}),
            now
        )
        .is_err());
        assert!(validate("configure", &json!({"expiresAt":1001}), now)
            .unwrap_err()
            .starts_with("auth:"));
    }

    #[test]
    fn decodes_acknowledgment_and_native_errors() {
        assert_eq!(
            decode_response("list", r#"{"ok":true,"action":"list","items":[]}"#).unwrap()["action"],
            "list"
        );
        assert_eq!(
            decode_response("list", r#"{"error":"invalid: bad widget"}"#).unwrap_err(),
            "invalid: bad widget"
        );
        assert!(decode_response("list", r#"{"ok":true,"action":"hide"}"#).is_err());
        assert!(decode_response("list", "not-json").is_err());
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn command_is_unsupported_off_android() {
        assert!(command("list", json!({}))
            .unwrap_err()
            .starts_with("unsupported:"));
    }
}
