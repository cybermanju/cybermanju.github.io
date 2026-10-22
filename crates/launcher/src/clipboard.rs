// CyberManju OS — explicit clipboard request contract.
// Role: Validate foreground user-action requests before reaching the Android JNI boundary.
// Exports: command; no REST route, agent tool, polling, persistence or background clipboard access.
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TEXT_BYTES: usize = 65_536;
const MAX_PAYLOAD_BYTES: usize = 400_000;

fn validate(action: &str, payload: &Value, now: u64) -> Result<(), String> {
    if !matches!(action, "copy" | "cut" | "paste") {
        return Err("unsupported: unknown clipboard action".into());
    }
    if !payload.is_object() || payload.to_string().len() > MAX_PAYLOAD_BYTES {
        return Err("invalid: clipboard payload must be an object under 400000 bytes".into());
    }
    if payload.get("userInitiated").and_then(Value::as_bool) != Some(true) {
        return Err("auth: explicit user action required".into());
    }
    let expires = payload
        .get("expiresAt")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if expires <= now || expires > now.saturating_add(5_000) {
        return Err(
            "conflict: clipboard action expired or invalid; select the action again".into(),
        );
    }
    if action == "paste" {
        if payload.get("text").is_some() {
            return Err("invalid: paste does not accept text".into());
        }
    } else if !payload
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.is_empty() && text.len() <= MAX_TEXT_BYTES)
    {
        return Err("invalid: clipboard text must contain 1 to 65536 UTF-8 bytes".into());
    }
    Ok(())
}

#[cfg(any(target_os = "android", test))]
fn decode_response(action: &str, raw: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| "integrity: malformed Android clipboard response".to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.to_owned());
    }
    if value.get("ok").and_then(Value::as_bool) != Some(true)
        || value.get("action").and_then(Value::as_str) != Some(action)
        || (action == "paste"
            && !value
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| text.len() <= MAX_TEXT_BYTES))
        || (action != "paste" && value.get("written").and_then(Value::as_bool) != Some(true))
    {
        return Err("integrity: invalid Android clipboard acknowledgment".into());
    }
    Ok(value)
}

/// userInitiated is the bundled UI's attestation, NOT an unforgeable browser gesture.
/// Invoke only synchronously from a trusted user event; Android additionally checks focus/lock.
/// A cut writes only: the caller must preserve/revalidate selection and delete after written=true.
pub fn command(action: &str, payload: Value) -> Result<Value, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "conflict: invalid system clock".to_string())?
        .as_millis() as u64;
    validate(action, &payload, now)?;
    #[cfg(target_os = "android")]
    {
        let raw = super::android_impl::native_dispatch(
            "CybermanjuClipboard",
            action,
            &payload.to_string(),
        )?;
        decode_response(action, &raw)
    }
    #[cfg(not(target_os = "android"))]
    Err("unsupported: native clipboard requires the Android app".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> Value {
        json!({"userInitiated": true, "expiresAt": 11_000, "text": "Olá 🦀\n"})
    }

    #[test]
    fn accepts_exact_unicode_and_whitespace_for_copy_and_cut() {
        for action in ["copy", "cut"] {
            assert!(validate(action, &request(), 10_000).is_ok());
            let mut p = request();
            p["text"] = json!(" \n\t");
            assert!(validate(action, &p, 10_000).is_ok());
        }
        assert!(validate(
            "paste",
            &json!({"userInitiated": true, "expiresAt": 11_000}),
            10_000
        )
        .is_ok());
    }

    #[test]
    fn refuses_unattested_stale_future_and_malformed_requests() {
        for action in ["poll", "read", "write", "clear", "COPY", ""] {
            assert!(validate(action, &request(), 10_000)
                .unwrap_err()
                .starts_with("unsupported:"));
        }
        assert!(validate("copy", &json!([]), 10_000).is_err());
        for value in [json!(false), json!("true"), Value::Null] {
            let mut p = request();
            p["userInitiated"] = value;
            assert!(validate("copy", &p, 10_000)
                .unwrap_err()
                .starts_with("auth:"));
        }
        for value in [
            json!(10_000),
            json!(15_001),
            json!(-1),
            json!(11_000.5),
            json!("11000"),
            Value::Null,
        ] {
            let mut p = request();
            p["expiresAt"] = value;
            assert!(validate("copy", &p, 10_000)
                .unwrap_err()
                .starts_with("conflict:"));
        }
        assert!(validate("paste", &request(), 10_000)
            .unwrap_err()
            .starts_with("invalid:"));
    }

    #[test]
    fn bounds_bytes_without_truncating_or_leaking_text_in_errors() {
        for text in ["", &"x".repeat(65_537), &"🦀".repeat(16_385)] {
            let mut p = request();
            p["text"] = json!(text);
            let error = validate("cut", &p, 10_000).unwrap_err();
            assert!(error.starts_with("invalid:"));
            assert!(!error.contains("🦀"));
        }
        let mut p = request();
        p["text"] = json!("x".repeat(65_536));
        assert!(validate("copy", &p, 10_000).is_ok());
        p["extra"] = json!("x".repeat(400_001));
        assert!(validate("copy", &p, 10_000).is_err());
    }

    #[test]
    fn cut_requires_positive_matching_ack_and_paste_preserves_unicode() {
        assert!(decode_response("cut", r#"{"ok":true,"action":"cut","written":true}"#).is_ok());
        for raw in [
            "",
            "{}",
            "[]",
            r#"{"ok":true,"action":"copy","written":true}"#,
            r#"{"ok":true,"action":"cut","written":false}"#,
            r#"{"ok":true,"action":"cut"}"#,
        ] {
            assert!(decode_response("cut", raw)
                .unwrap_err()
                .starts_with("integrity:"));
        }
        assert!(
            decode_response("cut", r#"{"error":"conflict: clipboard result uncertain"}"#)
                .unwrap_err()
                .starts_with("conflict:")
        );
        let text = "Olá 🦀\n\u{0}";
        let out = decode_response(
            "paste",
            &json!({"ok": true, "action": "paste", "text": text}).to_string(),
        )
        .unwrap();
        assert_eq!(out["text"], text);
        assert!(decode_response(
            "paste",
            &json!({"ok": true, "action": "paste", "text": "x".repeat(65_537)}).to_string()
        )
        .is_err());
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn refuses_off_android_instead_of_browser_or_fake_success() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(command(
            "copy",
            json!({"userInitiated": true, "expiresAt": now + 4_000, "text": "hello"})
        )
        .unwrap_err()
        .starts_with("unsupported:"));
    }
}
