//! Narrow, typed Android action adapters for the automation runner.
//!
//! Actions only invoke public Android intents. Actions that hand control to a
//! different app return `accepted`, never `succeeded`, because the receiving
//! app does not report whether the user completed its operation.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
#[cfg(any(target_os = "android", test))]
use sha2::{Digest, Sha256};

const MAX_ID_CHARS: usize = 128;
const MAX_OPAQUE_ID_CHARS: usize = 512;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BYTES: usize = 72 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_JSON_DEPTH: usize = 24;
const MAX_JSON_ENTRIES: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeActionRequest {
    pub protocol_version: u32,
    pub request_id: String,
    pub workflow_id: String,
    pub workflow_revision: u64,
    pub node_id: String,
    pub action_id: String,
    pub input: Value,
    pub idempotency_key: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_expected_revision"
    )]
    pub expected_revision: Option<u64>,
}

fn deserialize_expected_revision<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    u64::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeActionResult {
    pub protocol_version: u32,
    pub request_id: String,
    pub workflow_id: String,
    pub workflow_revision: u64,
    pub node_id: String,
    pub action_id: String,
    pub idempotency_key: String,
    #[serde(flatten)]
    pub outcome: NativeActionOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum NativeActionOutcome {
    Succeeded {
        output: Value,
    },
    Accepted {
        job_id: String,
    },
    NeedsConfirmation {
        confirmation_id: String,
        summary: String,
        expires_at: String,
    },
    Denied {
        code: String,
    },
    Failed {
        code: String,
        retryable: bool,
    },
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ValidatedAndroidAction {
    OpenUrl(String),
    OpenMap(String),
    Dial(String),
    ShareText {
        text: String,
        title: String,
    },
    CreateCalendarEvent {
        title: String,
        starts_at_epoch_ms: i64,
        ends_at_epoch_ms: i64,
        location: Option<String>,
        description: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValidationError {
    InvalidArgument,
    UnsupportedAction,
}

impl NativeActionRequest {
    fn envelope_error(&self) -> Option<&'static str> {
        if self.protocol_version != 1 {
            return Some("protocol_version");
        }
        if !valid_id(&self.workflow_id)
            || !valid_id(&self.node_id)
            || !valid_id(&self.action_id)
            || !valid_opaque_id(&self.request_id)
            || !valid_opaque_id(&self.idempotency_key)
            || self.request_id != self.idempotency_key
        {
            return Some("invalid_request");
        }
        if self.workflow_revision == 0
            || self.workflow_revision > MAX_SAFE_INTEGER
            || self
                .expected_revision
                .is_some_and(|revision| revision > MAX_SAFE_INTEGER)
        {
            return Some("invalid_revision");
        }
        if !self.input.is_object() || !valid_json_limits(&self.input) {
            return Some("invalid_argument");
        }
        let input_bytes = serde_json::to_vec(&self.input)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX);
        if input_bytes > MAX_INPUT_BYTES {
            return Some("input_too_large");
        }
        let request_bytes = serde_json::to_vec(self)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX);
        if request_bytes > MAX_REQUEST_BYTES {
            return Some("request_too_large");
        }
        None
    }

    fn into_result(self, outcome: NativeActionOutcome) -> NativeActionResult {
        NativeActionResult {
            protocol_version: self.protocol_version,
            request_id: self.request_id,
            workflow_id: self.workflow_id,
            workflow_revision: self.workflow_revision,
            node_id: self.node_id,
            action_id: self.action_id,
            idempotency_key: self.idempotency_key,
            outcome,
        }
    }
}

/// Validate and execute one registered native action.
///
/// The dispatcher never evaluates workflow code, reads credentials from the
/// workflow document, or invokes a shell. The TypeScript runner owns graph
/// traversal and confirmation policy; this function only handles one allowlisted
/// action node.
pub fn dispatch_native_action(request: NativeActionRequest) -> NativeActionResult {
    if let Some(code) = request.envelope_error() {
        return request.into_result(NativeActionOutcome::Failed {
            code: code.to_string(),
            retryable: false,
        });
    }

    let action = match validate_action(&request.action_id, &request.input) {
        Ok(action) => action,
        Err(ValidationError::InvalidArgument) => {
            return request.into_result(NativeActionOutcome::Failed {
                code: "invalid_argument".to_string(),
                retryable: false,
            });
        }
        Err(ValidationError::UnsupportedAction) => {
            return request.into_result(NativeActionOutcome::Denied {
                code: "unsupported_action".to_string(),
            });
        }
    };

    #[cfg(target_os = "android")]
    let mut result = match super::automation_journal::app_private_directory() {
        Ok(directory) => {
            match super::automation_journal::claim_and_dispatch_at(&directory, &request, || {
                match super::android_impl::dispatch_automation_action(&action) {
                    Ok(true) => NativeActionOutcome::Accepted {
                        job_id: external_job_id(&request.request_id),
                    },
                    Ok(false) => NativeActionOutcome::Succeeded {
                        output: Value::Null,
                    },
                    Err(error) => map_android_error(&error),
                }
            }) {
                Ok(outcome) => request.into_result(outcome),
                Err(_) => request.into_result(NativeActionOutcome::Failed {
                    code: "journal_unavailable".to_string(),
                    retryable: false,
                }),
            }
        }
        Err(_) => request.into_result(NativeActionOutcome::Failed {
            code: "journal_unavailable".to_string(),
            retryable: false,
        }),
    };

    #[cfg(not(target_os = "android"))]
    let mut result = {
        let _ = action;
        request.into_result(NativeActionOutcome::Denied {
            code: "unsupported".to_string(),
        })
    };

    if serde_json::to_vec(&result)
        .map(|encoded| encoded.len() > MAX_RESPONSE_BYTES)
        .unwrap_or(true)
    {
        result.outcome = NativeActionOutcome::Unknown;
    }
    result
}

/// Build a correlated denial for a caller that fails the native UI-origin gate.
pub fn deny_request(request: NativeActionRequest, code: &str) -> NativeActionResult {
    request.into_result(NativeActionOutcome::Denied {
        code: if valid_id(code) {
            code.to_string()
        } else {
            "denied".to_string()
        },
    })
}

fn valid_id(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.chars().count() <= MAX_ID_CHARS
        && first.is_ascii_alphanumeric()
        && chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
}

fn valid_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= MAX_OPAQUE_ID_CHARS
        && !value.chars().any(char::is_control)
}

#[cfg(any(target_os = "android", test))]
fn external_job_id(request_id: &str) -> String {
    const PREFIX: &str = "external:";
    if request_id.encode_utf16().count() + PREFIX.len() <= MAX_OPAQUE_ID_CHARS {
        format!("{PREFIX}{request_id}")
    } else {
        format!("{PREFIX}{:x}", Sha256::digest(request_id.as_bytes()))
    }
}

fn valid_json_limits(value: &Value) -> bool {
    fn walk(value: &Value, depth: usize, entries: &mut usize) -> bool {
        if depth > MAX_JSON_DEPTH {
            return false;
        }
        *entries = entries.saturating_add(1);
        if *entries > MAX_JSON_ENTRIES {
            return false;
        }
        match value {
            Value::Array(items) => items.iter().all(|item| walk(item, depth + 1, entries)),
            Value::Object(items) => items.iter().all(|(key, item)| {
                !key.chars().any(char::is_control) && walk(item, depth + 1, entries)
            }),
            Value::Number(number) => {
                number.as_i64().is_some()
                    || number.as_u64().is_some()
                    || number.as_f64().is_some_and(f64::is_finite)
            }
            _ => true,
        }
    }
    let mut entries = 0;
    walk(value, 0, &mut entries)
}

#[cfg(target_os = "android")]
fn map_android_error(error: &str) -> NativeActionOutcome {
    if error.starts_with("denied:") {
        NativeActionOutcome::Denied {
            code: error.trim_start_matches("denied:").trim().to_string(),
        }
    } else if error.starts_with("not_found:") {
        NativeActionOutcome::Failed {
            code: "no_handler".to_string(),
            retryable: false,
        }
    } else if error.starts_with("unsupported:") {
        NativeActionOutcome::Denied {
            code: "unsupported".to_string(),
        }
    } else if error.starts_with("invalid:") {
        NativeActionOutcome::Failed {
            code: "invalid_argument".to_string(),
            retryable: false,
        }
    } else {
        NativeActionOutcome::Failed {
            code: "android_bridge_error".to_string(),
            retryable: false,
        }
    }
}

fn validate_action(
    action_id: &str,
    input: &Value,
) -> Result<ValidatedAndroidAction, ValidationError> {
    match action_id {
        "android.open_url" => {
            require_only_keys(input, &["url"])?;
            let raw = bounded_string(input, "url", 2048, false)?;
            let url = url::Url::parse(raw).map_err(|_| ValidationError::InvalidArgument)?;
            let authority = raw
                .split_once("://")
                .map(|(_, tail)| tail.split(['/', '?', '#']).next().unwrap_or(""))
                .unwrap_or("");
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || authority.contains('@')
            {
                return Err(ValidationError::InvalidArgument);
            }
            Ok(ValidatedAndroidAction::OpenUrl(url.to_string()))
        }
        "android.open_map" => {
            require_only_keys(input, &["query", "latitude", "longitude", "label"])?;
            let query = optional_string(input, "query", 512)?;
            let label = optional_string(input, "label", 256)?;
            if let Some(query) = query {
                if input.get("latitude").is_some()
                    || input.get("longitude").is_some()
                    || label.is_some()
                    || query.trim().is_empty()
                {
                    return Err(ValidationError::InvalidArgument);
                }
                let encoded: String =
                    url::form_urlencoded::byte_serialize(query.trim().as_bytes()).collect();
                Ok(ValidatedAndroidAction::OpenMap(format!(
                    "geo:0,0?q={encoded}"
                )))
            } else {
                let latitude = input
                    .get("latitude")
                    .and_then(Value::as_f64)
                    .ok_or(ValidationError::InvalidArgument)?;
                let longitude = input
                    .get("longitude")
                    .and_then(Value::as_f64)
                    .ok_or(ValidationError::InvalidArgument)?;
                if !latitude.is_finite()
                    || !longitude.is_finite()
                    || !(-90.0..=90.0).contains(&latitude)
                    || !(-180.0..=180.0).contains(&longitude)
                {
                    return Err(ValidationError::InvalidArgument);
                }
                let uri = if let Some(label) = label.filter(|s| !s.trim().is_empty()) {
                    let encoded: String =
                        url::form_urlencoded::byte_serialize(label.trim().as_bytes()).collect();
                    format!("geo:{latitude},{longitude}?q={latitude},{longitude}({encoded})")
                } else {
                    format!("geo:{latitude},{longitude}")
                };
                Ok(ValidatedAndroidAction::OpenMap(uri))
            }
        }
        "android.dial" => {
            require_only_keys(input, &["phone"])?;
            let raw = bounded_string(input, "phone", 64, false)?.trim();
            let mut normalized = String::with_capacity(raw.len());
            for (index, ch) in raw.chars().enumerate() {
                match ch {
                    '0'..='9' => normalized.push(ch),
                    '+' if index == 0 => normalized.push(ch),
                    ' ' | '-' | '.' | '(' | ')' => {}
                    _ => return Err(ValidationError::InvalidArgument),
                }
            }
            let digits = normalized.chars().filter(char::is_ascii_digit).count();
            if !(3..=32).contains(&digits) {
                return Err(ValidationError::InvalidArgument);
            }
            Ok(ValidatedAndroidAction::Dial(normalized))
        }
        "android.share_text" => {
            require_only_keys(input, &["text", "title"])?;
            let text = bounded_string(input, "text", 16_000, true)?.to_owned();
            if text.trim().is_empty() {
                return Err(ValidationError::InvalidArgument);
            }
            let title = optional_string(input, "title", 120)?
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("Share from CyberManju")
                .to_owned();
            Ok(ValidatedAndroidAction::ShareText { text, title })
        }
        "android.create_calendar_event" => {
            require_only_keys(
                input,
                &[
                    "title",
                    "startsAtEpochMs",
                    "endsAtEpochMs",
                    "location",
                    "description",
                ],
            )?;
            let title = bounded_string(input, "title", 256, false)?
                .trim()
                .to_owned();
            if title.is_empty() {
                return Err(ValidationError::InvalidArgument);
            }
            let start = safe_epoch_ms(input.get("startsAtEpochMs"))?;
            let end = safe_epoch_ms(input.get("endsAtEpochMs"))?;
            if end <= start {
                return Err(ValidationError::InvalidArgument);
            }
            let location = optional_string(input, "location", 512)?.map(str::to_owned);
            let description = optional_string(input, "description", 4000)?.map(str::to_owned);
            Ok(ValidatedAndroidAction::CreateCalendarEvent {
                title,
                starts_at_epoch_ms: start,
                ends_at_epoch_ms: end,
                location,
                description,
            })
        }
        _ => Err(ValidationError::UnsupportedAction),
    }
}

fn require_only_keys(input: &Value, allowed: &[&str]) -> Result<(), ValidationError> {
    let object = input.as_object().ok_or(ValidationError::InvalidArgument)?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(ValidationError::InvalidArgument);
    }
    Ok(())
}

fn bounded_string<'a>(
    input: &'a Value,
    key: &str,
    max_chars: usize,
    allow_newlines: bool,
) -> Result<&'a str, ValidationError> {
    let value = input
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ValidationError::InvalidArgument)?;
    if value.encode_utf16().count() > max_chars
        || value
            .chars()
            .any(|ch| ch.is_control() && !(allow_newlines && matches!(ch, '\n' | '\r' | '\t')))
    {
        return Err(ValidationError::InvalidArgument);
    }
    Ok(value)
}

fn safe_epoch_ms(value: Option<&Value>) -> Result<i64, ValidationError> {
    let timestamp = value
        .and_then(Value::as_i64)
        .ok_or(ValidationError::InvalidArgument)?;
    if timestamp.unsigned_abs() > MAX_SAFE_INTEGER {
        return Err(ValidationError::InvalidArgument);
    }
    Ok(timestamp)
}

fn optional_string<'a>(
    input: &'a Value,
    key: &str,
    max_chars: usize,
) -> Result<Option<&'a str>, ValidationError> {
    match input.get(key) {
        None => Ok(None),
        Some(Value::String(value))
            if value.encode_utf16().count() <= max_chars
                && !value.chars().any(char::is_control) =>
        {
            Ok(Some(value))
        }
        _ => Err(ValidationError::InvalidArgument),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(action_id: &str, input: Value) -> NativeActionRequest {
        NativeActionRequest {
            protocol_version: 1,
            request_id: "req-1".into(),
            workflow_id: "workflow-1".into(),
            workflow_revision: 3,
            node_id: "node-1".into(),
            action_id: action_id.into(),
            input,
            idempotency_key: "req-1".into(),
            expected_revision: None,
        }
    }

    #[test]
    fn http_and_https_urls_are_allowed_but_other_schemes_and_userinfo_are_not() {
        assert!(
            validate_action("android.open_url", &json!({"url":"https://example.com/a"})).is_ok()
        );
        assert!(validate_action("android.open_url", &json!({"url":"http://example.com"})).is_ok());
        for url in [
            "javascript:alert(1)",
            "intent://example.com/#Intent;end",
            "file:///etc/passwd",
            "content://example/item",
            "mailto:user@example.com",
            "https://user:secret@example.com/",
        ] {
            assert_eq!(
                validate_action("android.open_url", &json!({"url":url})),
                Err(ValidationError::InvalidArgument)
            );
        }
    }

    #[test]
    fn maps_require_one_nonempty_query_or_finite_in_range_coordinates() {
        assert!(validate_action("android.open_map", &json!({"query":"Tokyo station"})).is_ok());
        assert!(validate_action(
            "android.open_map",
            &json!({"latitude":35.6812,"longitude":139.7671,"label":"Tokyo"})
        )
        .is_ok());
        assert!(validate_action("android.open_map", &json!({"query":" "})).is_err());
        assert!(validate_action(
            "android.open_map",
            &json!({"latitude":91.0,"longitude":0.0})
        )
        .is_err());
        assert!(validate_action("android.open_map", &json!({"latitude":0.0})).is_err());
        assert!(validate_action(
            "android.open_map",
            &json!({"query":"A","latitude":0.0,"longitude":0.0})
        )
        .is_err());
        assert!(validate_action(
            "android.open_map",
            &json!({"query":"Tokyo","label":"ignored"})
        )
        .is_err());
    }

    #[test]
    fn dial_only_accepts_a_bounded_phone_number_not_a_call_command() {
        assert_eq!(
            validate_action("android.dial", &json!({"phone":"+55 (19) 99914-8596"})),
            Ok(ValidatedAndroidAction::Dial("+5519999148596".into()))
        );
        assert!(validate_action("android.dial", &json!({"phone":"123;CALL"})).is_err());
        assert!(validate_action("android.dial", &json!({"phone":"12"})).is_err());
    }

    #[test]
    fn share_text_is_explicit_and_bounded() {
        assert!(validate_action(
            "android.share_text",
            &json!({"text":"hello","title":"Send"})
        )
        .is_ok());
        assert!(validate_action("android.share_text", &json!({"text":"  "})).is_err());
        assert!(
            validate_action("android.share_text", &json!({"text":"x".repeat(16_001)})).is_err()
        );
    }

    #[test]
    fn calendar_form_requires_valid_time_range_and_safe_strings() {
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":10,"endsAtEpochMs":20})
        )
        .is_ok());
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":20,"endsAtEpochMs":20})
        )
        .is_err());
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":30,"endsAtEpochMs":20})
        )
        .is_err());
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":9007199254740992_i64,"endsAtEpochMs":9007199254740993_i64})
        )
        .is_err());
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":10,"endsAtEpochMs":20,"secret":"must reject"})
        )
        .is_err());
    }

    #[test]
    fn action_inputs_reject_unknown_fields_instead_of_ignoring_them() {
        assert!(validate_action(
            "android.open_url",
            &json!({"url":"https://example.com","token":"secret"})
        )
        .is_err());
        assert!(validate_action("android.dial", &json!({"phone":"1234567","call":true})).is_err());
        assert!(validate_action(
            "android.share_text",
            &json!({"text":"hi","credential":"secret"})
        )
        .is_err());
        assert!(validate_action(
            "android.create_calendar_event",
            &json!({"title":"Meeting","startsAtEpochMs":10,"endsAtEpochMs":20,"extra":null})
        )
        .is_err());
    }

    #[test]
    fn result_repeats_correlation_fields_and_uses_flat_snake_case_status() {
        let result = dispatch_native_action(request("android.unknown", json!({})));
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["requestId"], "req-1");
        assert_eq!(value["workflowRevision"], 3);
        assert_eq!(value["idempotencyKey"], "req-1");
        assert_eq!(value["status"], "denied");
        assert_eq!(value["code"], "unsupported_action");
    }

    #[test]
    fn malformed_envelopes_return_correlated_failures() {
        let mut req = request("android.open_url", json!({"url":"https://example.com"}));
        req.protocol_version = 9;
        let value = serde_json::to_value(dispatch_native_action(req)).unwrap();
        assert_eq!(value["status"], "failed");
        assert_eq!(value["code"], "protocol_version");
        assert_eq!(value["retryable"], false);
        assert_eq!(value["protocolVersion"], 9);

        let mut mismatched = request("android.open_url", json!({"url":"https://example.com"}));
        mismatched.idempotency_key = "other-key".to_string();
        let value = serde_json::to_value(dispatch_native_action(mismatched)).unwrap();
        assert_eq!(value["status"], "failed");
        assert_eq!(value["code"], "invalid_request");
    }

    #[test]
    fn identifiers_follow_the_runner_grammar_and_opaque_id_limit() {
        assert!(valid_id("android.create_calendar_event"));
        assert!(valid_id("workflow:one.v2"));
        assert!(!valid_id("../bad"));
        assert!(!valid_id("has space"));
        assert!(!valid_id(&format!("a{}", "b".repeat(MAX_ID_CHARS))));
        assert!(valid_opaque_id(&"x".repeat(MAX_OPAQUE_ID_CHARS)));
        assert!(!valid_opaque_id(&"x".repeat(MAX_OPAQUE_ID_CHARS + 1)));
        assert!(valid_opaque_id(&"😀".repeat(MAX_OPAQUE_ID_CHARS / 2)));
        assert!(!valid_opaque_id(&"😀".repeat(MAX_OPAQUE_ID_CHARS / 2 + 1)));
        assert!(!valid_opaque_id("bad\nkey"));
    }

    #[test]
    fn request_rejects_unknown_top_level_fields() {
        let value = json!({
            "protocolVersion":1,
            "requestId":"r",
            "workflowId":"w",
            "workflowRevision":1,
            "nodeId":"n",
            "actionId":"android.open_url",
            "input":{"url":"https://example.com"},
            "idempotencyKey":"k",
            "extraSecret":"should not be ignored"
        });
        assert!(serde_json::from_value::<NativeActionRequest>(value).is_err());
    }

    #[test]
    fn request_rejects_null_expected_revision() {
        let value = json!({
            "protocolVersion":1,
            "requestId":"r",
            "workflowId":"w",
            "workflowRevision":1,
            "nodeId":"n",
            "actionId":"android.open_url",
            "input":{"url":"https://example.com"},
            "idempotencyKey":"k",
            "expectedRevision":null
        });
        assert!(serde_json::from_value::<NativeActionRequest>(value).is_err());
    }

    #[test]
    fn external_handoff_job_id_stays_within_opaque_id_limit() {
        let request_id = "x".repeat(MAX_OPAQUE_ID_CHARS);
        let job_id = external_job_id(&request_id);
        assert!(valid_opaque_id(&job_id));
        assert!(job_id.starts_with("external:"));
        assert!(job_id.encode_utf16().count() <= MAX_OPAQUE_ID_CHARS);
    }

    #[test]
    fn input_depth_entry_count_and_serialized_size_are_bounded() {
        let mut depth_limit = json!(null);
        for _ in 0..MAX_JSON_DEPTH {
            depth_limit = json!([depth_limit]);
        }
        assert!(valid_json_limits(&depth_limit));

        let mut deep = json!(null);
        for _ in 0..=MAX_JSON_DEPTH {
            deep = json!([deep]);
        }
        assert!(!valid_json_limits(&deep));

        let at_entry_limit = Value::Array(vec![json!(0); MAX_JSON_ENTRIES - 1]);
        assert!(valid_json_limits(&at_entry_limit));
        let many = Value::Array(vec![json!(0); MAX_JSON_ENTRIES]);
        assert!(!valid_json_limits(&many));

        let oversized = request(
            "android.share_text",
            json!({"text":"x".repeat(MAX_INPUT_BYTES)}),
        );
        let result = serde_json::to_value(dispatch_native_action(oversized)).unwrap();
        assert_eq!(result["status"], "failed");
        assert_eq!(result["code"], "input_too_large");
    }

    #[test]
    fn accepted_response_uses_camel_case_fields_and_preserves_correlation() {
        let value = serde_json::to_value(request("android.dial", json!({})).into_result(
            NativeActionOutcome::Accepted {
                job_id: "external:req-1".to_string(),
            },
        ))
        .unwrap();
        assert_eq!(value["status"], "accepted");
        assert_eq!(value["jobId"], "external:req-1");
        assert_eq!(value["requestId"], "req-1");
        assert_eq!(value["workflowRevision"], 3);
        assert_eq!(value["actionId"], "android.dial");
        assert!(value.get("job_id").is_none());
    }

    #[test]
    fn succeeded_response_always_contains_output_even_when_null() {
        let value = serde_json::to_value(request("android.open_url", json!({})).into_result(
            NativeActionOutcome::Succeeded {
                output: Value::Null,
            },
        ))
        .unwrap();
        assert_eq!(value["status"], "succeeded");
        assert!(value.get("output").is_some());
        assert!(value["output"].is_null());
        assert!(value.get("reason").is_none());
    }

    #[test]
    fn unknown_response_has_no_uncontracted_fields() {
        let value = serde_json::to_value(NativeActionOutcome::Unknown).unwrap();
        assert_eq!(value, json!({"status":"unknown"}));
    }
}
