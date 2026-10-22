// CyberManju OS — Agent hub execution (crates/web/src/api/agent_hub_api.rs).
// Role: connect persistent messaging to existing provider configs and adapters.
// Exports: save_profile, send.
// Integrates: separate AgentHubStore, original sealed-key Database, native host.
// Contracts: one explicit recipient, one tool-less turn, no history/credential sharing.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};

use cybermanju_agent::{agent_loop, hub_prompt, hub_protocol, protocol, providers};
use cybermanju_db::Database;
use cybermanju_types::agent::AuthScheme;
use cybermanju_types::agent_hub::{
    AgentProfile, DelegatedRun, EventVisibility, ProfileInput, RunStatus, SendMessage, SendReceipt,
};

use super::agent_hub_store::AgentHubStore;
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};

const MAX_WORKERS: usize = 8;
const MAX_RESPONSE_BYTES: usize = 262_144;
static ACTIVE_WORKERS: AtomicUsize = AtomicUsize::new(0);

struct WorkerSlot;
impl WorkerSlot {
    fn acquire() -> Result<Self, String> {
        ACTIVE_WORKERS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_WORKERS).then_some(n + 1)
            })
            .map(|_| Self)
            .map_err(|_| "rate_limited: hub execution capacity reached".into())
    }
}
impl Drop for WorkerSlot {
    fn drop(&mut self) {
        ACTIVE_WORKERS.fetch_sub(1, Ordering::AcqRel);
    }
}

// Credentials are loaded solely at the backend boundary, never serialized in
// any profile/event/run. Exact replacement covers opaque keys missed by markers.
fn known_keys(db: &Database) -> Result<Vec<String>, String> {
    let configs = super::agent_api::list_configs(db)?;
    let mut keys = Vec::new();
    for config in configs {
        if let Some(key) = db
            .get_sync_secret(&format!("agent:key:{}", config.id))
            .map_err(|_| "integrity: cannot read sealed provider credentials".to_string())?
        {
            if !key.is_empty() {
                keys.push(key);
            }
        }
    }
    Ok(keys)
}

fn clean(text: &str, keys: &[String]) -> String {
    let refs: Vec<&str> = keys.iter().map(String::as_str).collect();
    hub_prompt::scrub_known_secrets(text, &refs)
}

fn clean_internal(text: &str, keys: &[String]) -> Result<String, String> {
    let refs: Vec<&str> = keys.iter().map(String::as_str).collect();
    hub_prompt::scrub_envelope(text, &refs)
}

/// Inspect decoded values without mutating the request or applying a redactor
/// to serialized JSON. Message content itself contains JSON projections, so
/// embedded JSON candidates must decode strictly before exact comparison.
/// Any candidate parse error fails closed, including numeric range failures.
fn reject_request_credentials(body: &serde_json::Value, keys: &[String]) -> Result<(), String> {
    // Bound cumulative work, including repeatedly decoded embedded strings.
    // Keep serde_json's own recursion guard enabled; never retry unbounded.
    struct Budget {
        bytes: usize,
        values: usize,
    }
    // serde_json::Value discards earlier duplicate object keys. Decode embedded
    // JSON through a visitor that rejects duplicates after JSON escape decoding.
    struct StrictJson(serde_json::Value);
    impl<'de> Deserialize<'de> for StrictJson {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct StrictVisitor;
            impl<'de> Visitor<'de> for StrictVisitor {
                type Value = StrictJson;
                fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    f.write_str("JSON without duplicate object keys")
                }
                fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                    Ok(StrictJson(serde_json::Value::Null))
                }
                fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                    Ok(StrictJson(v.into()))
                }
                fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                    Ok(StrictJson(v.into()))
                }
                fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                    Ok(StrictJson(v.into()))
                }
                fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                    serde_json::Number::from_f64(v)
                        .map(|n| StrictJson(n.into()))
                        .ok_or_else(|| E::custom("invalid number"))
                }
                fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                    Ok(StrictJson(v.into()))
                }
                fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                    Ok(StrictJson(v.into()))
                }
                fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                    let mut out = Vec::new();
                    while let Some(StrictJson(value)) = seq.next_element()? {
                        out.push(value);
                    }
                    Ok(StrictJson(out.into()))
                }
                fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                    let mut out = serde_json::Map::new();
                    while let Some((key, StrictJson(value))) =
                        map.next_entry::<String, StrictJson>()?
                    {
                        if out.contains_key(&key) {
                            return Err(serde::de::Error::custom("duplicate object key"));
                        }
                        out.insert(key, value);
                    }
                    Ok(StrictJson(out.into()))
                }
            }
            deserializer.deserialize_any(StrictVisitor)
        }
    }
    fn inspect_text(
        text: &str,
        keys: &[String],
        depth: usize,
        budget: &mut Budget,
    ) -> Result<bool, String> {
        budget.bytes = budget.bytes.checked_sub(text.len()).ok_or_else(|| {
            "integrity: projected request exceeds safe inspection budget".to_string()
        })?;
        if keys
            .iter()
            .any(|key| !key.is_empty() && text.contains(key.as_str()))
        {
            return Ok(true);
        }
        // The scrubber emits this exact scalar, not an embedded JSON array.
        // Check known keys and charge the budget first: even a key colliding
        // with the marker must fail closed. Never exempt prefixes or suffixes.
        if text == "[REDACTED]" {
            return Ok(false);
        }
        // Recognize only bounded literal prose tokens, never arbitrary braces
        // or attached marker prefixes/suffixes. Reuse this rule for both the
        // leading candidate and later fragments so they cannot diverge.
        fn prose_token_end(text: &str, cursor: usize) -> Option<usize> {
            if cursor != 0
                && !text[..cursor]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_whitespace)
            {
                return None;
            }
            let marker_end = cursor + "[REDACTED]".len();
            let end = if text[cursor..].starts_with("[REDACTED]") {
                marker_end
            } else if text.as_bytes().get(cursor) == Some(&b'{') {
                let end = cursor + 1 + text[cursor + 1..].find('}')?;
                let words = &text[cursor + 1..end];
                if !words.chars().any(|ch| ch.is_ascii_alphabetic())
                    || !words.chars().all(|ch| {
                        ch.is_ascii_alphabetic()
                            || ch.is_ascii_whitespace()
                            || matches!(ch, '_' | '-')
                    })
                {
                    return None;
                }
                end + 1
            } else {
                return None;
            };
            (end == text.len()
                || text[end..].chars().next().is_some_and(|ch| {
                    ch.is_whitespace() || matches!(ch, '.' | ',' | ';' | ':' | '!' | '?')
                }))
            .then_some(end)
        }
        // Credentials and budgets above cover the entire original string.
        // Skip only the leading literal token, then inspect the remaining
        // suffix even without escapes; never exempt the whole prose string.
        let first = text.len() - text.trim_start().len();
        let mut cursor = prose_token_end(text, first).unwrap_or(0);
        if cursor == 0
            && matches!(
                text.trim_start().as_bytes().first(),
                Some(b'{' | b'[' | b'"')
            )
        {
            match serde_json::from_str::<StrictJson>(text) {
                Ok(StrictJson(decoded)) => return inspect(&decoded, keys, depth + 1, budget),
                Err(error) if error.to_string().contains("duplicate object key") => {
                    return Err("integrity: projected request contains ambiguous JSON".into());
                }
                // serde_json reports recursion exhaustion as a syntax error,
                // not a separate category. Match its fixed diagnostic, never
                // expose parser details/content or treat a limit as plain text.
                Err(error) if error.to_string().starts_with("recursion limit exceeded") => {
                    return Err("integrity: projected request exceeds safe inspection depth".into());
                }
                // A range/syntax error may precede escaped credentials or a
                // duplicate key. Uninspectable JSON is never safe plain prose.
                Err(_) => {
                    return Err("integrity: projected request contains uninspectable JSON".into())
                }
            }
        }
        // Inspect JSON/Unicode escapes, not arbitrary reversible encodings.
        // Leave ordinary prose (including policy/schema examples) untouched when
        // it has no escapes. Otherwise inspect every JSON fragment, not just a
        // JSON-leading string: a prose prefix must not bypass escape decoding.
        if !text.contains('\\') && cursor == 0 {
            return Ok(false);
        }
        while cursor < text.len() {
            let Some(relative) = text.as_bytes()[cursor..]
                .iter()
                .position(|&byte| matches!(byte, b'{' | b'[' | b'"'))
            else {
                break;
            };
            cursor += relative;
            if let Some(end) = prose_token_end(text, cursor) {
                cursor = end;
                continue;
            }
            // A streaming decoder consumes one complete strict value, allowing
            // surrounding prose and multiple fragments. Advance over that value
            // rather than reparsing overlapping suffixes; the original text and
            // all decoded values share the same byte/value/depth budgets.
            let mut fragments =
                serde_json::Deserializer::from_str(&text[cursor..]).into_iter::<StrictJson>();
            match fragments.next() {
                Some(Ok(StrictJson(decoded))) => {
                    if inspect(&decoded, keys, depth + 1, budget)? {
                        return Ok(true);
                    }
                    cursor += fragments.byte_offset();
                }
                Some(Err(error)) if error.to_string().contains("duplicate object key") => {
                    return Err("integrity: projected request contains ambiguous JSON".into());
                }
                Some(Err(error)) if error.to_string().starts_with("recursion limit exceeded") => {
                    return Err("integrity: projected request exceeds safe inspection depth".into());
                }
                _ => return Err("integrity: projected request contains uninspectable JSON".into()),
            }
        }
        // A model can decode bare Unicode escapes without JSON delimiters:
        // `Please inspect: \u006fpaque...` must not bypass the fragment scan.
        // Decode one layer into an inspection-only copy. Re-enter the same
        // visitor so nested escapes share byte/value/depth bounds, and newly
        // exposed JSON still gets strict duplicate/range checks. Never rewrite
        // the hashed request. Serde validates surrogate pairs and UTF-8.
        let mut decoded = String::with_capacity(text.len());
        let mut chars = text.char_indices().peekable();
        let mut changed = false;
        while let Some((offset, ch)) = chars.next() {
            if ch == '\\' && text.as_bytes().get(offset + 1) == Some(&b'u') {
                let mut end = offset + 6;
                if let Some(hex) = text.as_bytes().get(offset + 2..end) {
                    if hex.iter().all(u8::is_ascii_hexdigit) {
                        // High surrogates require a second escape, validated
                        // together by serde. Missing/invalid pairs fail closed.
                        if hex[0].eq_ignore_ascii_case(&b'd')
                            && matches!(hex[1], b'8' | b'9' | b'a' | b'A' | b'b' | b'B')
                        {
                            end += 6;
                        }
                        let escape = text.get(offset..end).ok_or_else(|| {
                            "integrity: projected request contains uninspectable Unicode"
                                .to_string()
                        })?;
                        let scalar: String = serde_json::from_str(&format!("\"{escape}\""))
                            .map_err(|_| {
                                "integrity: projected request contains uninspectable Unicode"
                                    .to_string()
                            })?;
                        decoded.push_str(&scalar);
                        changed = true;
                        while chars.peek().is_some_and(|(index, _)| *index < end) {
                            chars.next();
                        }
                        continue;
                    }
                }
            }
            decoded.push(ch);
        }
        if changed {
            return inspect(&serde_json::Value::String(decoded), keys, depth + 1, budget);
        }
        Ok(false)
    }
    fn inspect(
        value: &serde_json::Value,
        keys: &[String],
        depth: usize,
        budget: &mut Budget,
    ) -> Result<bool, String> {
        if depth > 128 {
            return Err("integrity: projected request exceeds safe inspection depth".into());
        }
        budget.values = budget.values.checked_sub(1).ok_or_else(|| {
            "integrity: projected request exceeds safe inspection budget".to_string()
        })?;
        match value {
            serde_json::Value::String(text) => inspect_text(text, keys, depth, budget),
            serde_json::Value::Array(values) => {
                for value in values {
                    if inspect(value, keys, depth + 1, budget)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            serde_json::Value::Object(values) => {
                for (name, value) in values {
                    if inspect_text(name, keys, depth, budget)?
                        || inspect(value, keys, depth + 1, budget)?
                    {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            _ => Ok(false),
        }
    }
    let mut budget = Budget {
        bytes: 1_048_576,
        values: 65_536,
    };
    if inspect(body, keys, 0, &mut budget)? {
        return Err("integrity: projected request contains protected credential data".into());
    }
    Ok(())
}

fn post_hub_request(
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
    keys: &[String],
) -> Result<serde_json::Value, String> {
    // Credentials rotated after ingress must never mutate hashed values or
    // escape into provider content. Auth headers are deliberately separate.
    reject_request_credentials(body, keys)?;
    protocol::post_json_bounded(url, headers, body, MAX_RESPONSE_BYTES)
}

/// Native host only in v1. `owner` is a host principal, never a JSON field.
/// Future network transports MUST derive it from validated claims and separately
/// authorize shared legacy provider configs before exposing this service.
pub fn save_profile(
    db: &Database,
    hub: &AgentHubStore,
    owner: &str,
    mut input: ProfileInput,
) -> Result<AgentProfile, String> {
    let config = super::agent_api::get_config(db, &input.provider_config_id)
        .map_err(|_| "not_found: provider configuration does not exist".to_string())?;
    providers::resolve(&config)?;
    let keys = known_keys(db)?;
    input.name = clean(&input.name, &keys);
    input.personality = clean(&input.personality, &keys);
    for value in input
        .goals
        .iter_mut()
        .chain(input.interests.iter_mut())
        .chain(input.knowledge.iter_mut())
    {
        *value = clean(value, &keys);
    }
    hub.save_profile(owner, input)
}

/// Persist the send exactly once, then atomically claim its routed run. A
/// repeated idempotency key returns the same receipt and cannot dispatch twice.
pub fn send(
    db: Arc<RwLock<Database>>,
    hub: Arc<AgentHubStore>,
    owner: &str,
    mut input: SendMessage,
) -> Result<SendReceipt, String> {
    if !input.tool_grants.is_empty() {
        return Err("unsupported: hub v1 does not grant tools".into());
    }
    if input.text.len() > 16_384
        || input.selected_context.len() > 8
        || input
            .selected_context
            .iter()
            .map(String::len)
            .sum::<usize>()
            > 8192
    {
        return Err("too_large: original delegated input exceeds limits".into());
    }
    let keys = {
        let guard = db
            .read()
            .map_err(|_| "integrity: provider database lock unavailable".to_string())?;
        known_keys(&guard)?
    };
    input.text = if input.sender_id.is_some() {
        clean_internal(&input.text, &keys)?
    } else {
        clean(&input.text, &keys)
    };
    for context in &mut input.selected_context {
        *context = clean(context, &keys);
    }
    let receipt = hub.send(owner, input)?;
    let Some(ref routed) = receipt.run else {
        return Ok(receipt);
    };
    let Some(run) = hub.claim_run(owner, &routed.id)? else {
        return Ok(receipt);
    };
    let slot = match WorkerSlot::acquire() {
        Ok(slot) => slot,
        Err(error) => {
            hub.transition_run(owner, &run.id, RunStatus::Failed, None, Some(error))?;
            return Ok(receipt);
        }
    };
    let owner = owner.to_owned();
    let run_id = run.id.clone();
    let failed_hub = hub.clone();
    let failed_owner = owner.clone();
    let spawned = std::thread::Builder::new()
        .name(format!("hub-{}", run.id))
        .spawn(move || {
            let _slot = slot;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                execute(&db, &hub, &owner, &run)
            }))
            .unwrap_or_else(|_| Err("integrity: hub worker interrupted".into()));
            let transition = finalize_outcome(&hub, &owner, &run.id, outcome);
            if transition.is_err() {
                // No raw error, URL, provider output or credential in the log.
                log::error!("hub terminal state persistence failed");
            }
        });
    if spawned.is_err() {
        failed_hub.transition_run(
            &failed_owner,
            &run_id,
            RunStatus::Failed,
            None,
            Some("integrity: cannot start hub worker".into()),
        )?;
    }
    Ok(receipt)
}

/// Only fixed messages cross the provider-error boundary: upstream errors can
/// echo arbitrary request headers/keys, even keys with no recognizable marker.
fn public_error(error: &str) -> String {
    let (prefix, detail) = if error.starts_with("auth:") {
        (
            "auth",
            "provider authentication or recipient authorization failed",
        )
    } else if error.starts_with("rate_limited:") {
        ("rate_limited", "provider request throttled")
    } else if error.starts_with("too_large:") {
        ("too_large", "hub input or provider reply exceeds limits")
    } else if error.starts_with("unsupported:") {
        (
            "unsupported",
            "provider requested an unavailable capability",
        )
    } else if error.starts_with("not_found:") {
        (
            "not_found",
            "recipient profile or provider configuration unavailable",
        )
    } else if error.starts_with("limit:") {
        ("limit", "provider route unavailable")
    } else if error.starts_with("invalid:") || error.starts_with("context:") {
        ("invalid", "provider rejected this bounded request")
    } else if error.starts_with("integrity:") {
        ("integrity", "hub execution could not complete safely")
    } else {
        (
            "network",
            "provider request failed; review the selected configuration",
        )
    };
    format!("{prefix}: {detail}")
}

/// Completion validation can fail inside the store (e.g. redacted-key collision).
/// Record a fixed failure in a fresh transaction rather than strand Running.
fn finalize_outcome(
    hub: &AgentHubStore,
    owner: &str,
    run_id: &str,
    outcome: Result<String, String>,
) -> Result<DelegatedRun, String> {
    let failure = match outcome {
        Ok(text) => match hub.transition_run(owner, run_id, RunStatus::Completed, Some(text), None)
        {
            Ok(run) => return Ok(run),
            Err(error) => error,
        },
        Err(error) => error,
    };
    hub.transition_run(
        owner,
        run_id,
        RunStatus::Failed,
        None,
        Some(public_error(&failure)),
    )
}

fn validate_finish(
    dialect: cybermanju_types::agent::LlmDialect,
    finish: &str,
) -> Result<(), String> {
    use cybermanju_types::agent::LlmDialect;
    if matches!(finish, "length" | "max_tokens") {
        return Err("limit: provider truncated the reply".into());
    }
    match (dialect, finish) {
        (LlmDialect::OpenAi, "stop") | (LlmDialect::Anthropic, "end_turn" | "stop_sequence") => {
            Ok(())
        }
        _ => Err("invalid: provider did not complete a text reply".into()),
    }
}

fn validate_reply(
    text: &str,
    visibility: EventVisibility,
    keys: &[String],
) -> Result<String, String> {
    if text.len() > 65_536 {
        return Err("too_large: provider text reply exceeds event limit".into());
    }
    if visibility == EventVisibility::Internal {
        let text = clean_internal(text, keys)?;
        let envelope = hub_protocol::parse_envelope(&text)?;
        if envelope.op == cybermanju_types::coordination::CoordinationOp::Task {
            return Err("invalid: internal output requires result or blocked".into());
        }
        hub_protocol::canonical_envelope(&text)
    } else {
        Ok(hub_prompt::suppress_policy_echoes(&clean(text, keys)))
    }
}

fn execute(
    db: &Arc<RwLock<Database>>,
    hub: &AgentHubStore,
    owner: &str,
    run: &DelegatedRun,
) -> Result<String, String> {
    let profile = hub
        .profile(owner, &run.recipient_id)?
        .ok_or_else(|| "not_found: recipient profile unavailable".to_string())?;
    let source = hub.source_event(owner, run)?;
    let messages = hub_prompt::build_projected_messages(&profile, run, &source)?;
    let (config, key, keys) = {
        let guard = db
            .read()
            .map_err(|_| "integrity: provider database lock unavailable".to_string())?;
        let config = super::agent_api::get_config(&guard, &run.provider_config_id)
            .map_err(|_| "not_found: recipient provider configuration unavailable".to_string())?;
        let key = guard
            .get_sync_secret(&format!("agent:key:{}", config.id))
            .map_err(|_| "integrity: cannot load provider credential".to_string())?
            .unwrap_or_default();
        (config, key, known_keys(&guard)?)
    };
    let endpoint = providers::resolve(&config)?;
    if !endpoint.keyless && key.is_empty() {
        return Err("auth: selected provider requires a saved key".into());
    }
    let mut headers = endpoint.extra_headers.clone();
    match endpoint.auth {
        AuthScheme::Bearer if !key.is_empty() => {
            headers.push(("Authorization".into(), format!("Bearer {key}")));
        }
        AuthScheme::Header => {
            headers.push((
                endpoint
                    .auth_name
                    .clone()
                    .unwrap_or_else(|| "x-api-key".into()),
                key.clone(),
            ));
        }
        AuthScheme::Query => {
            // URL credentials can escape through proxies, redirects and logs.
            return Err("unsupported: query-string authentication is disabled for hub runs".into());
        }
        _ => {}
    }
    headers.push(("Content-Type".into(), "application/json".into()));
    let mut turn = agent_loop::AgentTurn::new(messages, 1, 1);
    let (url, headers, body) = turn.build_request(
        &endpoint.base_url,
        endpoint.dialect,
        &config.model,
        hub_prompt::output_policy(endpoint.dialect, run.visibility),
        headers,
        false,
    );
    let reply = post_hub_request(&url, &headers, &body, &keys)?;
    match turn.ingest_reply(endpoint.dialect, &reply)? {
        agent_loop::LoopEvent::TextDone => {
            validate_finish(endpoint.dialect, &turn.last_finish)?;
            let text = turn
                .messages
                .last()
                .filter(|m| m.role == "assistant")
                .map(|m| m.content.as_str())
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| "invalid: provider returned no text reply".to_string())?;
            validate_reply(text, run.visibility, &keys)
        }
        agent_loop::LoopEvent::ToolCalls(_) => {
            Err("unsupported: hub v1 never executes provider tool calls".into())
        }
        agent_loop::LoopEvent::LimitReached => {
            Err("limit: hub single-turn budget exhausted".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_error_echoes_are_never_persisted() {
        for prefix in ["auth:", "network:", "invalid:", "limit:", "arbitrary"] {
            let error = public_error(&format!("{prefix} https://gateway/key opaque-secret-value"));
            assert!(!error.contains("opaque-secret-value"));
            assert!(!error.contains("https://"));
        }
    }

    fn assert_request_blocked_without_io(body: &serde_json::Value, keys: &[String]) {
        assert_request_blocked_with_error(
            body,
            keys,
            "integrity: projected request contains protected credential data",
        );
    }

    #[test]
    fn embedded_duplicate_keys_fail_closed_for_both_provider_dialects() {
        use cybermanju_types::agent::LlmDialect;
        let secret = "opaque-provider-secret-9981";
        let duplicate_json = [
            // Exact reported bypass: Value parsing drops the secret-bearing
            // first value even though its escaped raw spelling is still sent.
            r#"{"x":"\u006fpaque-provider-secret-9981","x":"safe"}"#,
            r#"{"nested":[{"x":"\u006fpaque-provider-secret-9981","x":"safe"}]}"#,
            // Key-name variant: escaped spelling decodes to the protected key;
            // ordinary Value parsing would retain only the trailing safe value.
            r#"{"\u006fpaque-provider-secret-9981":"secret","o\u0070aque-provider-secret-9981":"safe"}"#,
            r#"{"nest":[{"x":1,"x":2}]}"#,
            r#"{"nest":["{\"x\":1,\"x\":2}"]}"#,
            r#"{"\u006eest": {"x": 1, "\u0078": 2}}"#,
        ];
        for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
            for embedded in duplicate_json {
                let turn = agent_loop::AgentTurn::new(
                    vec![cybermanju_types::agent::ChatMessage {
                        role: "user".into(),
                        content: embedded.into(),
                        tool_call_id: None,
                        tool_name: None,
                        tool_input: None,
                    }],
                    1,
                    1,
                );
                let (_, _, body) = turn.build_request(
                    "http://127.0.0.1/v1",
                    dialect,
                    "test-model",
                    hub_prompt::output_policy(dialect, EventVisibility::User),
                    vec![],
                    false,
                );
                assert_request_blocked_with_error(
                    &body,
                    &[secret.into()],
                    "integrity: projected request contains ambiguous JSON",
                );
            }
        }
        let safe =
            serde_json::json!({"messages":[{"content":r#"{"name":"safe","items":[1,{"x":2}]}"#}]});
        assert!(reject_request_credentials(&safe, &[secret.into()]).is_ok());
    }

    fn assert_request_blocked_with_error(
        body: &serde_json::Value,
        keys: &[String],
        expected: &str,
    ) {
        use std::io::Write;
        use std::net::TcpListener;
        use std::time::{Duration, Instant};

        let before = body.clone();
        let serialized = serde_json::to_string(body).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = requests.clone();
        let sentinel = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_millis(200);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        observed.fetch_add(1, Ordering::SeqCst);
                        // If a regression reaches I/O, return promptly rather
                        // than leaving a failed test parked on a HTTP timeout.
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                        );
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => panic!("test provider listener failed"),
                }
            }
        });
        let result = post_hub_request(&url, &[], body, keys);
        sentinel.join().unwrap();
        assert_eq!(result.unwrap_err(), expected);
        assert_eq!(requests.load(Ordering::SeqCst), 0);
        assert_eq!(body, &before);
        assert_eq!(serde_json::to_string(body).unwrap(), serialized);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serialized).unwrap(),
            before
        );
    }

    #[test]
    fn rotated_quote_backslash_and_pem_credentials_never_reach_provider() {
        use cybermanju_types::agent::LlmDialect;
        let credentials = [
            "opaque-provider-\"quoted\"-9981",
            r"opaque-provider-\path\9981",
            r#"opaque-provider-"quoted"-\path\9981"#,
            "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_NOT_A_REAL_KEY\n-----END PRIVATE KEY-----",
        ];
        for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
            for credential in credentials {
                // Simulate rotation after a source snapshot was persisted:
                // current keys are only supplied at the outbound boundary.
                let projection = serde_json::json!({"v":1,"recipientId":"recipient",
                    "sourceEventId":"event","sourceSeq":1,"items":[{"value":{
                        "v":1,"op":"task","data":[{"k":"goal","v":credential}],"refs":[]}}]});
                let content = projection.to_string();
                assert!(!content.contains(credential));
                let turn = agent_loop::AgentTurn::new(
                    vec![cybermanju_types::agent::ChatMessage {
                        role: "user".into(),
                        content,
                        tool_call_id: None,
                        tool_name: None,
                        tool_input: None,
                    }],
                    1,
                    1,
                );
                let (_, _, body) = turn.build_request(
                    "http://127.0.0.1/v1",
                    dialect,
                    "test-model",
                    hub_prompt::output_policy(dialect, EventVisibility::Internal),
                    vec![],
                    false,
                );
                assert_request_blocked_without_io(&body, &[credential.into()]);
            }
        }
    }

    #[test]
    fn request_inspection_never_redacts_or_invalidates_pem_shaped_json() {
        let pem = "-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----";
        let body = serde_json::json!({"messages":[{"role":"user","content":
            serde_json::json!({"pem":pem,"text":"***","plainText":"ordinary prose"}).to_string()}]});
        let before = body.clone();
        let serialized = serde_json::to_string(&body).unwrap();
        assert!(reject_request_credentials(
            &body,
            &["unrelated-current-key".into(), String::new()]
        )
        .is_ok());
        assert_eq!(body, before);
        assert_eq!(serde_json::to_string(&body).unwrap(), serialized);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serialized).unwrap(),
            body
        );
        assert_request_blocked_without_io(&body, &[pem.into()]);
    }

    #[test]
    fn request_inspection_covers_object_keys_nested_strings_and_depth_limit() {
        let credential = r#"opaque-"quoted"-\key"#;
        let mut fields = serde_json::Map::new();
        fields.insert(credential.into(), serde_json::json!("public"));
        let body = serde_json::json!({"array":[serde_json::Value::Object(fields)]});
        assert_request_blocked_without_io(&body, &[credential.into()]);
        let quoted = serde_json::to_string(credential).unwrap();
        let body =
            serde_json::json!({"messages":[{"content":serde_json::to_string(&quoted).unwrap()}]});
        assert_request_blocked_without_io(&body, &[credential.into()]);
        let mut deep = serde_json::json!("public");
        for _ in 0..130 {
            deep = serde_json::Value::Array(vec![deep]);
        }
        assert_eq!(
            reject_request_credentials(&deep, &[credential.into()]).unwrap_err(),
            "integrity: projected request exceeds safe inspection depth"
        );
    }

    #[test]
    fn deeply_nested_embedded_json_fails_closed_before_provider_io() {
        use cybermanju_types::agent::LlmDialect;
        let credential = r#"opaque-"quoted"-\path\9981"#;
        let leaf = serde_json::to_string(credential).unwrap();
        for layers in [130, 512, 4096] {
            // Construct valid deep JSON as text without disabling serde's bound
            // or allocating a deeply recursive Value. Escapes hide exact key bytes.
            let embedded = format!("{}{}{}", "[".repeat(layers), leaf, "]".repeat(layers));
            assert!(!embedded.contains(credential));
            assert!(serde_json::from_str::<serde_json::Value>(&embedded)
                .unwrap_err()
                .to_string()
                .starts_with("recursion limit exceeded"));
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for content in [
                    serde_json::json!({"selectedContext": embedded}).to_string(),
                    format!("Please inspect: {embedded}"),
                ] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content,
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, EventVisibility::Internal),
                        vec![],
                        false,
                    );
                    assert_request_blocked_with_error(
                        &body,
                        &[credential.into()],
                        "integrity: projected request exceeds safe inspection depth",
                    );
                }
            }
        }
    }

    #[test]
    fn candidate_json_parse_errors_fail_closed_before_either_provider_connects() {
        use cybermanju_types::agent::LlmDialect;
        let credential = "opaque-provider-secret-9981";
        for embedded in [
            r#"{"n":1e400,"x":"\\u006fpaque-provider-secret-9981","x":"safe"}"#,
            r#"{"x":"\\u006fpaque-provider-secret-9981","x":1e400}"#,
            r#"{"n":1e400,"x":"\u006fpaque-provider-secret-9981","x":"safe"}"#,
            r#"{"x":"\u006fpaque-provider-secret-9981","x":1e400}"#,
            r#"[1e400,"\u006fpaque-provider-secret-9981"]"#,
            r#"[REDACTED] {"x":"\u006fpaque-provider-secret-9981"}"#,
            r#"[REDACTED\u005d"#,
            r#"["[REDACTED]",1e400,"\u006fpaque-provider-secret-9981"]"#,
            "{not JSON",
            "[unfinished",
            "\"unterminated",
        ] {
            assert!(!embedded.contains(credential));
            assert!(serde_json::from_str::<serde_json::Value>(embedded).is_err());
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for content in [
                    embedded.to_string(),
                    serde_json::json!({"selectedContext": embedded}).to_string(),
                ] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content,
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, EventVisibility::Internal),
                        vec![],
                        false,
                    );
                    assert_request_blocked_with_error(
                        &body,
                        &[credential.into()],
                        if embedded.starts_with("[REDACTED] ") {
                            "integrity: projected request contains protected credential data"
                        } else {
                            "integrity: projected request contains uninspectable JSON"
                        },
                    );
                }
            }
        }
    }

    #[test]
    fn prose_prefixed_escaped_json_fails_closed_before_either_provider_connects() {
        use cybermanju_types::agent::LlmDialect;
        let credential = "opaque-provider-secret-9981";
        let protected = "integrity: projected request contains protected credential data";
        let ambiguous = "integrity: projected request contains ambiguous JSON";
        let uninspectable = "integrity: projected request contains uninspectable JSON";
        for (embedded, expected) in [
            (
                r#"[REDACTED] in C:\reports\public.txt {"x":"\u006fpaque-provider-secret-9981"}"#,
                protected,
            ),
            (
                r#"{schema example} in C:\reports\public.txt \u006fpaque-provider-secret-9981"#,
                protected,
            ),
            (r#"[REDACTED]; {"x":1,"x":2}"#, ambiguous),
            (r#"{schema example} {"n":1e400}"#, uninspectable),
            (r"[REDACTED]suffix in C:\reports\public.txt", uninspectable),
            (r"prefix[REDACTED] in C:\reports\public.txt", uninspectable),
            (
                r"{schema example}suffix in C:\reports\public.txt",
                uninspectable,
            ),
            (
                r"prefix{schema example} in C:\reports\public.txt",
                uninspectable,
            ),
            (r"{schema example2} in C:\reports\public.txt", uninspectable),
            (r"{schema: example} in C:\reports\public.txt", uninspectable),
            (
                r"{{schema example}} in C:\reports\public.txt",
                uninspectable,
            ),
            (
                r#"Please inspect: {"x":"\u006fpaque-provider-secret-9981"}"#,
                protected,
            ),
            (
                r#"Please inspect: {"\u006fpaque-provider-secret-9981":"public"} done."#,
                protected,
            ),
            (
                r#"Please inspect: ["\u006fpaque-provider-secret-9981"] done."#,
                protected,
            ),
            (
                r#"Please inspect: "\u006fpaque-provider-secret-9981" done."#,
                protected,
            ),
            (
                r#"First {"safe":1}, then {"x":"\u006fpaque-provider-secret-9981"} done."#,
                protected,
            ),
            (
                r#"First "safe", then {"x":"\u006fpaque-provider-secret-9981"} done."#,
                protected,
            ),
            (
                r#"😀 Please inspect: {"nested":"Please inspect: {\"x\":\"\\u006fpaque-provider-secret-9981\"}"}"#,
                protected,
            ),
            (
                r#"Please inspect: {"x":"\u006fpaque-provider-secret-9981","x":"safe"}"#,
                ambiguous,
            ),
            (r#"Please inspect: {"x":1,"\u0078":2}"#, ambiguous),
            (
                r#"Please inspect: {"n":1e400,"x":"\u006fpaque-provider-secret-9981"}"#,
                uninspectable,
            ),
            (
                r#"Please inspect: {"x":"\u006fpaque-provider-secret-9981","n":1e400}"#,
                uninspectable,
            ),
            (
                r#"Please inspect: {"x":"\u006fpaque-provider-secret-9981""#,
                uninspectable,
            ),
        ] {
            assert!(!embedded.contains(credential));
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for content in [
                    embedded.to_string(),
                    serde_json::json!({"text": embedded}).to_string(),
                ] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content,
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, EventVisibility::User),
                        vec![],
                        false,
                    );
                    assert_request_blocked_with_error(&body, &[credential.into()], expected);
                }
            }
        }
    }

    #[test]
    fn bare_unicode_escaped_credentials_never_connect_to_either_provider() {
        use cybermanju_types::agent::LlmDialect;
        let credential = "opaque-provider-secret-9981";
        let fully_escaped: String = credential
            .bytes()
            .map(|byte| format!("\\u{byte:04x}"))
            .collect();
        for embedded in [
            r"Please inspect: \u006fpaque-provider-secret-9981".to_string(),
            r"Please inspect: \u006f\u0070aque-provider-secret-9981".to_string(),
            format!("Please inspect: {fully_escaped}"),
            format!("First {{\"safe\":1}}, then {fully_escaped}"),
            r"Please inspect: \u005cu006fpaque-provider-secret-9981".to_string(),
            r"Please inspect: \\u006fpaque-provider-secret-9981".to_string(),
            r"Please inspect: [REDACTED]; then \u006fpaque-provider-secret-9981".to_string(),
            r"Use {schema example} then \u006fpaque-provider-secret-9981".to_string(),
        ] {
            assert!(!embedded.contains(credential));
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for content in [
                    embedded.clone(),
                    serde_json::json!({"selectedContext": embedded}).to_string(),
                ] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content,
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, EventVisibility::User),
                        vec![],
                        false,
                    );
                    assert_request_blocked_without_io(&body, &[credential.into()]);
                }
            }
        }
        for text in [r"Please inspect: \uD800", r"Please inspect: \uDC00"] {
            assert_request_blocked_with_error(
                &serde_json::json!({"text": text}),
                &[credential.into()],
                "integrity: projected request contains uninspectable Unicode",
            );
        }
    }

    #[test]
    fn prose_fragment_inspection_preserves_benign_text_and_policy_examples() {
        use cybermanju_types::agent::LlmDialect;
        let keys = vec!["opaque-provider-secret-9981".into()];
        for text in [
            "Ordinary benign prose. Please summarize the report.",
            "Please summarize [REDACTED] for the user.",
            r#"Please inspect: {"x":"\u0070ublic"} then ["safe"] done."#,
            r#"Please inspect: "a \\ path" then {"safe":true} done."#,
            r"A Windows path C:\reports\public.txt is ordinary prose.",
            "An ordinary {schema example} is not an encoded credential.",
            r"Please inspect: \u0070ublic and \uD83D\uDE00.",
            r"Please summarize [REDACTED]; use C:\reports\public.txt.",
            r"Use {schema example} in C:\reports\public.txt.",
        ] {
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for visibility in [EventVisibility::User, EventVisibility::Internal] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content: text.into(),
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, visibility),
                        vec![],
                        false,
                    );
                    let before = body.clone();
                    assert!(reject_request_credentials(&body, &keys).is_ok());
                    assert_eq!(body, before);
                }
            }
        }
    }

    #[test]
    fn redaction_marker_exemption_never_bypasses_credentials_or_budgets() {
        use cybermanju_types::agent::LlmDialect;
        for credential in ["[REDACTED]", "REDACTED", "["] {
            assert_request_blocked_without_io(
                &serde_json::json!({"content": "[REDACTED]"}),
                &[credential.into()],
            );
        }
        for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
            let turn = agent_loop::AgentTurn::new(
                vec![cybermanju_types::agent::ChatMessage {
                    role: "user".into(),
                    content: "[REDACTED]".into(),
                    tool_call_id: None,
                    tool_name: None,
                    tool_input: None,
                }],
                1,
                1,
            );
            let (_, _, body) = turn.build_request(
                "http://127.0.0.1/v1",
                dialect,
                "test-model",
                hub_prompt::output_policy(dialect, EventVisibility::User),
                vec![],
                false,
            );
            assert_request_blocked_without_io(&body, &["[REDACTED]".into()]);
        }
        let body = serde_json::Value::Array(vec![serde_json::json!("[REDACTED]"); 65_536]);
        assert_request_blocked_with_error(
            &body,
            &[],
            "integrity: projected request exceeds safe inspection budget",
        );
        let body = serde_json::json!({"content": "[REDACTED]opaque-provider-secret-9981"});
        assert_request_blocked_without_io(&body, &["opaque-provider-secret-9981".into()]);
        for text in [
            r"Please summarize [REDACTED]suffix in C:\reports\public.txt",
            r"Please summarize prefix[REDACTED] in C:\reports\public.txt",
            r"Please summarize [REDACTED\u005d in C:\reports\public.txt",
        ] {
            assert_request_blocked_with_error(
                &serde_json::json!({"content": text}),
                &["opaque-provider-secret-9981".into()],
                "integrity: projected request contains uninspectable JSON",
            );
        }
    }

    #[test]
    fn inspection_budgets_bound_wide_values_and_repeated_decoding() {
        let keys = vec!["unrelated-current-key".into()];
        for body in [
            serde_json::json!("x".repeat(1_048_577)),
            serde_json::Value::Array(vec![serde_json::json!("x".repeat(65_536)); 17]),
            serde_json::Value::Array(vec![serde_json::Value::Null; 65_536]),
        ] {
            assert_eq!(
                reject_request_credentials(&body, &keys).unwrap_err(),
                "integrity: projected request exceeds safe inspection budget"
            );
        }
        // Each decode is within serde's depth limit, but the shared host depth
        // must still apply across JSON strings nested inside other JSON strings.
        let mut text = "public".to_owned();
        for _ in 0..4 {
            text = format!(
                "{}{}{}",
                "[".repeat(40),
                serde_json::to_string(&text).unwrap(),
                "]".repeat(40)
            );
        }
        assert_request_blocked_with_error(
            &serde_json::json!({"content":text}),
            &keys,
            "integrity: projected request exceeds safe inspection depth",
        );
    }

    #[test]
    fn internal_output_does_not_fallback_to_unvalidated_prose_or_tasks() {
        for text in [
            "Hello",
            r#"{"v":2,"op":"result","data":[],"refs":[]}"#,
            r#"{"v":1,"op":"task","data":[],"refs":[]}"#,
            r#"{"v":1,"op":"result","data":[],"refs":[],"extra":"unsafe"}"#,
        ] {
            assert!(validate_reply(text, EventVisibility::Internal, &[]).is_err());
        }
        let result = r#"{"v":1,"op":"result","data":[{"k":"answer","v":"5"}],"refs":[]}"#;
        assert_eq!(
            validate_reply(result, EventVisibility::Internal, &[]).unwrap(),
            result
        );
        assert_eq!(
            validate_reply(
                "A concise natural-language reply.",
                EventVisibility::User,
                &[]
            )
            .unwrap(),
            "A concise natural-language reply."
        );
    }

    #[test]
    fn reply_filters_known_keys_and_json_escaped_private_policy_echoes() {
        let text = serde_json::json!({"v":1,"op":"result","data":[
            {"k":"answer","v":hub_prompt::INTERNAL_OUTPUT_POLICY},
            {"k":"secret","v":"opaque-test-value"}],"refs":[]})
        .to_string();
        let result = validate_reply(
            &text,
            EventVisibility::Internal,
            &["opaque-test-value".into()],
        )
        .unwrap();
        let parsed = hub_protocol::parse_envelope(&result).unwrap();
        assert!(parsed.data.iter().all(|fact| fact.v == "[REDACTED]"));
    }

    #[test]
    fn both_adapter_truncation_reasons_reject_even_valid_json_text() {
        use cybermanju_types::agent::LlmDialect;
        let content = r#"{"v":1,"op":"result","data":[{"k":"answer","v":"5"}],"refs":[]}"#;
        for (dialect, reply) in [
            (
                LlmDialect::OpenAi,
                serde_json::json!({"choices":[{"message":{"content":content},"finish_reason":"length"}]}),
            ),
            (
                LlmDialect::Anthropic,
                serde_json::json!({"content":[{"type":"text","text":content}],"stop_reason":"max_tokens"}),
            ),
        ] {
            let mut turn = agent_loop::AgentTurn::new(vec![], 1, 1);
            assert_eq!(
                turn.ingest_reply(dialect, &reply).unwrap(),
                agent_loop::LoopEvent::TextDone
            );
            assert!(validate_finish(dialect, &turn.last_finish)
                .unwrap_err()
                .starts_with("limit:"));
        }
        assert!(validate_finish(LlmDialect::OpenAi, "stop").is_ok());
        assert!(validate_finish(LlmDialect::Anthropic, "end_turn").is_ok());
        assert!(validate_finish(LlmDialect::OpenAi, "content_filter").is_err());
    }

    #[test]
    fn rejected_completion_cannot_leave_running_after_redacted_key_collision() {
        use cybermanju_types::agent_hub::{ConversationKind, CreateConversation};
        let dir = tempfile::tempdir().unwrap();
        let hub = AgentHubStore::open(dir.path().join("terminal.redb")).unwrap();
        let make = |name: &str| ProfileInput {
            id: None,
            name: name.into(),
            personality: String::new(),
            goals: vec![],
            interests: vec![],
            knowledge: vec![],
            provider_config_id: "cfg".into(),
        };
        let a = hub.save_profile("owner", make("a")).unwrap();
        let b = hub.save_profile("owner", make("b")).unwrap();
        let conv = hub
            .create_conversation(
                "owner",
                CreateConversation {
                    kind: ConversationKind::Group,
                    title: "owner initiated".into(),
                    members: vec![a.id.clone(), b.id.clone()],
                },
            )
            .unwrap();
        let receipt = hub
            .send(
                "owner",
                SendMessage {
                    conversation_id: conv.id.clone(),
                    idempotency_key: "once".into(),
                    sender_id: Some(a.id),
                    recipient_id: Some(b.id),
                    text: r#"{"v":1,"op":"task","data":[{"k":"goal","v":"answer"}],"refs":[]}"#
                        .into(),
                    selected_context: vec![],
                    tool_grants: vec![],
                },
            )
            .unwrap();
        let run = hub
            .claim_run("owner", &receipt.run.unwrap().id)
            .unwrap()
            .unwrap();
        let collision = r#"{"v":1,"op":"result","data":[{"k":"answer","v":"public"},{"k":"\u0073k-one","v":"a"},{"k":"\u0073k-two","v":"b"}],"refs":[]}"#;
        let terminal = finalize_outcome(&hub, "owner", &run.id, Ok(collision.into())).unwrap();
        assert_eq!(terminal.status, RunStatus::Failed);
        assert_eq!(
            hub.run("owner", &run.id).unwrap().unwrap().status,
            RunStatus::Failed
        );
        let events = hub.audit_events("owner", &conv.id, 0, 10).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[1].kind,
            cybermanju_types::agent_hub::HubEventKind::RunFailed
        );
        assert!(hub.events("owner", &conv.id, 0, 10).unwrap().is_empty());
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use cybermanju_types::agent::AgentConfig;
    use cybermanju_types::agent_hub::{ConversationKind, CreateConversation, HubEventKind};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::time::{Duration, Instant};

    fn read_request(stream: &mut TcpStream) -> serde_json::Value {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let header_end = loop {
            let mut buf = [0_u8; 1024];
            let count = stream.read(&mut buf).unwrap();
            assert!(count > 0, "incomplete request headers");
            bytes.extend_from_slice(&buf[..count]);
            assert!(bytes.len() < 131_072);
            if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos + 4;
            }
        };
        let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
        let len: usize = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().unwrap())
            })
            .expect("request content length");
        while bytes.len() < header_end + len {
            let mut buf = [0_u8; 1024];
            let count = stream.read(&mut buf).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buf[..count]);
        }
        serde_json::from_slice(&bytes[header_end..header_end + len]).unwrap()
    }

    fn input(name: &str, config: &str) -> ProfileInput {
        ProfileInput {
            id: None,
            name: name.into(),
            personality: format!("{name} persona"),
            goals: vec![],
            interests: vec![],
            knowledge: vec![],
            provider_config_id: config.into(),
        }
    }

    #[test]
    fn benign_redacted_prose_with_paths_reaches_both_providers_unchanged() {
        use cybermanju_types::agent::LlmDialect;
        let keys = vec!["opaque-provider-secret-9981".to_string()];
        let combined = clean(
            r"Please summarize opaque-provider-secret-9981 in C:\reports\public.txt",
            &keys,
        );
        assert_eq!(
            combined,
            r"Please summarize [REDACTED] in C:\reports\public.txt"
        );
        for text in [
            combined.as_str(),
            r"Please summarize [REDACTED]; use C:\reports\public.txt.",
            r"Use {schema example} in C:\reports\public.txt.",
            r"[REDACTED] in C:\reports\public.txt",
            r"[REDACTED]; use C:\reports\public.txt.",
            r"{schema example} in C:\reports\public.txt.",
            r"  [REDACTED] in C:\reports\public.txt",
            r"  {schema example} in C:\reports\public.txt",
            r#"[REDACTED]; {"safe":"public"}"#,
            r#"{schema example} {"safe":"public"}"#,
        ] {
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                for content in [
                    text.to_string(),
                    serde_json::json!({"text": text}).to_string(),
                ] {
                    let turn = agent_loop::AgentTurn::new(
                        vec![cybermanju_types::agent::ChatMessage {
                            role: "user".into(),
                            content,
                            tool_call_id: None,
                            tool_name: None,
                            tool_input: None,
                        }],
                        1,
                        1,
                    );
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test-model",
                        hub_prompt::output_policy(dialect, EventVisibility::User),
                        vec![],
                        false,
                    );
                    let before = body.clone();
                    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                    listener.set_nonblocking(true).unwrap();
                    let url = format!("http://{}/messages", listener.local_addr().unwrap());
                    let server = std::thread::spawn(move || {
                        let start = Instant::now();
                        let mut stream = loop {
                            match listener.accept() {
                                Ok((stream, _)) => break stream,
                                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                    assert!(start.elapsed() < Duration::from_secs(5));
                                    std::thread::sleep(Duration::from_millis(2));
                                }
                                Err(error) => panic!("mock provider: {error}"),
                            }
                        };
                        let captured = read_request(&mut stream);
                        stream
                            .write_all(
                                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                            )
                            .unwrap();
                        captured
                    });
                    let result = post_hub_request(&url, &[], &body, &keys);
                    let captured = server.join().unwrap();
                    assert_eq!(result.unwrap(), serde_json::json!({}));
                    assert_eq!(body, before);
                    assert_eq!(captured, before);
                }
            }
        }
    }

    #[test]
    fn scrubbed_messages_and_envelopes_reach_both_providers_unchanged() {
        use cybermanju_types::agent::LlmDialect;
        let credential = "opaque-provider-secret-9981";
        let keys = vec![credential.to_string()];
        for visibility in [EventVisibility::User, EventVisibility::Internal] {
            let dir = tempfile::tempdir().unwrap();
            let hub = AgentHubStore::open(dir.path().join("scrubbed.redb")).unwrap();
            let sender = hub.save_profile("owner", input("sender", "cfg")).unwrap();
            let mut recipient_input = input("recipient", "cfg");
            recipient_input.personality = clean(credential, &keys);
            assert_eq!(recipient_input.personality, "[REDACTED]");
            let recipient = hub.save_profile("owner", recipient_input).unwrap();
            let conv = hub
                .create_conversation(
                    "owner",
                    CreateConversation {
                        kind: ConversationKind::Group,
                        title: "explicit recipient".into(),
                        members: vec![sender.id.clone(), recipient.id.clone()],
                    },
                )
                .unwrap();
            let envelope = serde_json::json!({"v":1,"op":"task",
                "data":[{"k":"goal","v":credential}],"refs":[]})
            .to_string();
            let text = if visibility == EventVisibility::Internal {
                clean_internal(&envelope, &keys).unwrap()
            } else {
                clean(&format!("Please summarize {credential}"), &keys)
            };
            assert!(text.contains("[REDACTED]"));
            assert!(!text.contains(credential));
            let receipt = hub
                .send(
                    "owner",
                    SendMessage {
                        conversation_id: conv.id,
                        idempotency_key: "scrubbed-once".into(),
                        sender_id: (visibility == EventVisibility::Internal).then_some(sender.id),
                        recipient_id: Some(recipient.id.clone()),
                        text,
                        selected_context: vec![clean(credential, &keys)],
                        tool_grants: vec![],
                    },
                )
                .unwrap();
            let run = hub
                .claim_run("owner", &receipt.run.unwrap().id)
                .unwrap()
                .unwrap();
            let source = hub.source_event("owner", &run).unwrap();
            let messages = hub_prompt::build_projected_messages(&recipient, &run, &source).unwrap();
            for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                let turn = agent_loop::AgentTurn::new(messages.clone(), 1, 1);
                let (_, _, body) = turn.build_request(
                    "http://127.0.0.1/v1",
                    dialect,
                    "test",
                    hub_prompt::output_policy(dialect, visibility),
                    vec![],
                    false,
                );
                let before = body.clone();
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                listener.set_nonblocking(true).unwrap();
                let url = format!("http://{}/messages", listener.local_addr().unwrap());
                let server = std::thread::spawn(move || {
                    let start = Instant::now();
                    let mut stream = loop {
                        match listener.accept() {
                            Ok((stream, _)) => break stream,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                assert!(
                                    start.elapsed() < Duration::from_secs(5),
                                    "scrubbed message never reached provider"
                                );
                                std::thread::sleep(Duration::from_millis(2));
                            }
                            Err(error) => panic!("mock provider: {error}"),
                        }
                    };
                    let captured = read_request(&mut stream);
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                        )
                        .unwrap();
                    captured
                });
                let result = post_hub_request(&url, &[], &body, &keys);
                let captured = server.join().unwrap();
                assert_eq!(result.unwrap(), serde_json::json!({}));
                assert_eq!(body, before);
                assert_eq!(captured, before);
                let serialized = captured.to_string();
                assert!(serialized.contains("[REDACTED]"));
                assert!(!serialized.contains(credential));
            }
        }
    }

    #[test]
    fn pem_material_never_persists_or_reaches_either_provider_projection() {
        use cybermanju_types::agent::LlmDialect;
        let material = [
            "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDSyntheticFirst",
            "J6pN7wH2kL9mQ4sT8vX1yZ5aB3cD6eF0gH7iJ2kL9mN4oP8qR1sT5uV3wX6yZ0",
            "LastSyntheticPrivateKeyLine0123456789abcdef0123456789abcdef0123==",
        ];
        for (label, newline, ansi, gap) in [
            ("PRIVATE KEY", "\n", false, ""),
            ("RSA PRIVATE KEY", "\r\n", false, ""),
            ("EC PRIVATE KEY", "\n", true, ""),
            ("OPENSSH PRIVATE KEY", "\r\n", true, ""),
            ("ENCRYPTED PRIVATE KEY", "\r\n", true, ""),
            ("PRIVATE KEY", "\n", false, "\u{a0}"),
            ("PRIVATE KEY", "\r\n", true, "\u{2003}"),
            ("RSA PRIVATE KEY", "\n", true, "\t\u{a0}\u{2003} "),
        ] {
            let pem = format!(
                "-----{gap}BEGIN {label}-----{newline}{}{newline}-----END {label}-----",
                material.join(newline)
            );
            let pem = if ansi {
                pem.replace("PRIVATE", "\u{1b}[31mPRIVATE\u{1b}[0m")
                    .replace(material[1], &format!("\u{1b}[32m{}\u{1b}[0m", material[1]))
            } else {
                pem
            };
            for visibility in [EventVisibility::Internal, EventVisibility::User] {
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("pem.redb");
                let hub = AgentHubStore::open(&path).unwrap();
                let sender = hub.save_profile("owner", input("sender", "cfg")).unwrap();
                let mut recipient_input = input("recipient", "cfg");
                recipient_input.personality = pem.clone();
                recipient_input.knowledge.push(pem.clone());
                let recipient = hub.save_profile("owner", recipient_input).unwrap();
                let conv = hub
                    .create_conversation(
                        "owner",
                        CreateConversation {
                            kind: ConversationKind::Group,
                            title: "explicit recipient".into(),
                            members: vec![sender.id.clone(), recipient.id.clone()],
                        },
                    )
                    .unwrap();
                let envelope = |op: &str| {
                    serde_json::json!({"v":1,"op":op,
                    "data":[{"k":if op == "task" { "goal" } else { "answer" },"v":pem}],"refs":[]})
                    .to_string()
                };
                let receipt = hub
                    .send(
                        "owner",
                        SendMessage {
                            conversation_id: conv.id.clone(),
                            idempotency_key: "pem-once".into(),
                            sender_id: (visibility == EventVisibility::Internal)
                                .then_some(sender.id.clone()),
                            recipient_id: Some(recipient.id.clone()),
                            text: if visibility == EventVisibility::Internal {
                                envelope("task")
                            } else {
                                pem.clone()
                            },
                            selected_context: vec![pem.clone()],
                            tool_grants: vec![],
                        },
                    )
                    .unwrap();
                let run = hub
                    .claim_run("owner", &receipt.run.unwrap().id)
                    .unwrap()
                    .unwrap();
                if visibility == EventVisibility::Internal {
                    hub_protocol::parse_envelope(&run.input).unwrap();
                }
                let source = hub.source_event("owner", &run).unwrap();
                let messages =
                    hub_prompt::build_projected_messages(&recipient, &run, &source).unwrap();
                serde_json::from_str::<serde_json::Value>(&messages[0].content).unwrap();
                for dialect in [LlmDialect::OpenAi, LlmDialect::Anthropic] {
                    let turn = agent_loop::AgentTurn::new(messages.clone(), 1, 1);
                    let (_, _, body) = turn.build_request(
                        "http://127.0.0.1/v1",
                        dialect,
                        "test",
                        hub_prompt::output_policy(dialect, visibility),
                        vec![],
                        false,
                    );
                    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                    listener.set_nonblocking(true).unwrap();
                    let url = format!("http://{}/messages", listener.local_addr().unwrap());
                    let server = std::thread::spawn(move || {
                        let start = Instant::now();
                        let mut stream = loop {
                            match listener.accept() {
                                Ok((stream, _)) => break stream,
                                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                    assert!(start.elapsed() < Duration::from_secs(5));
                                    std::thread::sleep(Duration::from_millis(2));
                                }
                                Err(error) => panic!("mock provider: {error}"),
                            }
                        };
                        let captured = read_request(&mut stream);
                        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
                        captured
                    });
                    // No exact known-key match: marker sanitization must suffice.
                    post_hub_request(&url, &[], &body, &[]).unwrap();
                    let captured = server.join().unwrap().to_string();
                    for residue in material {
                        assert!(!captured.contains(residue), "{label}");
                    }
                    assert!(!captured.contains("BEGIN"));
                }
                let output = validate_reply(
                    &if visibility == EventVisibility::Internal {
                        envelope("result")
                    } else {
                        pem.clone()
                    },
                    visibility,
                    &[],
                )
                .unwrap();
                let terminal = finalize_outcome(&hub, "owner", &run.id, Ok(output)).unwrap();
                assert_eq!(terminal.status, RunStatus::Completed);
                if visibility == EventVisibility::Internal {
                    hub_protocol::parse_envelope(terminal.result.as_ref().unwrap()).unwrap();
                }
                drop(hub);
                let reopened = AgentHubStore::open(&path).unwrap();
                let persisted = serde_json::json!({
                    "profile":reopened.profile("owner", &recipient.id).unwrap(),
                    "run":reopened.run("owner", &run.id).unwrap(),
                    "events":reopened.audit_events("owner", &conv.id, 0, 100).unwrap(),
                })
                .to_string();
                serde_json::from_str::<serde_json::Value>(&persisted).unwrap();
                for residue in material {
                    assert!(!persisted.contains(residue), "{label}");
                }
                assert!(!persisted.contains("BEGIN"));
            }
        }
    }

    #[test]
    fn direct_a2a_uses_recipient_provider_and_only_selected_context() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let start = Instant::now();
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            start.elapsed() < Duration::from_secs(10),
                            "worker never called provider"
                        );
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("mock provider: {error}"),
                }
            };
            let request = read_request(&mut stream);
            let body = serde_json::json!({
                "choices": [{"message": {"role": "assistant", "content": r#"{"v":1,"op":"result","data":[{"k":"answer","v":"Delivered sk-test-secret"},{"k":"credential","v":"\u006fpaque-provider-secret-9981"}],"refs":[]}"#}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1}
            }).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            request
        });
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("original.redb").to_str().unwrap()).unwrap();
        for (id, model) in [
            ("sender-provider", "sender-model"),
            ("recipient-provider", "recipient-model"),
        ] {
            let config: AgentConfig = serde_json::from_value(serde_json::json!({
                "id": id, "name": id, "providerId": "ollama", "model": model,
                "baseUrlOverride": base,
            }))
            .unwrap();
            super::super::agent_api::save_config(&db, config).unwrap();
        }
        super::super::agent_api::save_key(&db, "recipient-provider", "opaque-provider-secret-9981")
            .unwrap();
        let hub = Arc::new(AgentHubStore::open(dir.path().join("hub.redb")).unwrap());
        let mut sender_input = input("Sender", "sender-provider");
        sender_input
            .knowledge
            .push("SENDER_PRIVATE_KNOWLEDGE".into());
        let sender = save_profile(&db, &hub, "local", sender_input).unwrap();
        let recipient =
            save_profile(&db, &hub, "local", input("Recipient", "recipient-provider")).unwrap();
        let conversation = hub
            .create_conversation(
                "local",
                CreateConversation {
                    kind: ConversationKind::Direct,
                    title: "A2A".into(),
                    members: vec![sender.id.clone(), recipient.id.clone()],
                },
            )
            .unwrap();
        hub.send(
            "local",
            SendMessage {
                conversation_id: conversation.id.clone(),
                idempotency_key: "private-history".into(),
                sender_id: None,
                recipient_id: None,
                text: "SENDER_PRIVATE_HISTORY".into(),
                selected_context: vec![],
                tool_grants: vec![],
            },
        )
        .unwrap();
        let db = Arc::new(RwLock::new(db));
        let message = SendMessage {
            conversation_id: conversation.id.clone(),
            idempotency_key: "route-once".into(),
            sender_id: Some(sender.id),
            recipient_id: Some(recipient.id.clone()),
            text: r#"{"v":1,"op":"task","data":[{"k":"goal","v":"Please summarize"},{"k":"credential","v":"\u006fpaque-provider-secret-9981"}],"refs":[]}"#.into(),
            selected_context: vec!["SELECTED_PUBLIC_CONTEXT".into()],
            tool_grants: vec![],
        };
        let receipt = send(db.clone(), hub.clone(), "local", message.clone()).unwrap();
        assert!(!receipt.event.text.contains("opaque-provider-secret-9981"));
        let run_id = receipt.run.unwrap().id;
        let start = Instant::now();
        let completed = loop {
            let current = hub.run("local", &run_id).unwrap().unwrap();
            if matches!(current.status, RunStatus::Completed | RunStatus::Failed) {
                break current;
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "worker did not finish"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(
            completed.status,
            RunStatus::Completed,
            "{:?}",
            completed.error
        );
        assert!(!completed.result.as_ref().unwrap().contains("test-secret"));
        assert!(!completed
            .result
            .as_ref()
            .unwrap()
            .contains("opaque-provider-secret-9981"));
        let replay = send(db, hub.clone(), "local", message).unwrap();
        assert_eq!(replay.run.unwrap().id, run_id);
        let request = server.join().unwrap();
        assert_eq!(request["model"], "recipient-model");
        assert!(request.get("tools").is_none());
        assert!(request.get("response_format").is_none());
        assert_eq!(completed.visibility, EventVisibility::Internal);
        let serialized = request.to_string();
        assert!(!serialized.contains("opaque-provider-secret-9981"));
        let projected: serde_json::Value =
            serde_json::from_str(request["messages"][1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(projected["items"][0]["value"]["op"], "task");
        assert!(serialized.contains("SELECTED_PUBLIC_CONTEXT"));
        assert!(!serialized.contains("SENDER_PRIVATE_HISTORY"));
        assert!(!serialized.contains("SENDER_PRIVATE_KNOWLEDGE"));
        assert!(!serialized.contains("Sender persona"));
        let events = hub.audit_events("local", &conversation.id, 0, 100).unwrap();
        assert!(!serde_json::to_string(&events)
            .unwrap()
            .contains("opaque-provider-secret-9981"));
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == HubEventKind::Assistant)
                .count(),
            1
        );
        assert!(events
            .iter()
            .filter(|e| e.run_id.as_deref() == Some(run_id.as_str()))
            .all(|e| e.visibility == EventVisibility::Internal));
        assert!(events.windows(2).all(|pair| pair[0].seq + 1 == pair[1].seq));
        let transcript = hub.events("local", &conversation.id, 0, 100).unwrap();
        assert!(transcript
            .iter()
            .all(|event| event.visibility == EventVisibility::User));
        assert_eq!(transcript.len(), 1);
        assert!(hub.events("other-owner", &conversation.id, 0, 100).is_err());
    }
}
