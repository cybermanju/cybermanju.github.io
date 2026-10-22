// CyberManju OS — typed agent hub protocol boundary.
// Role: validate compact coordination envelopes and build deterministic bounded projections.
// Exports: parse_envelope, canonical_envelope, project, PromptProjection.
// Contracts: fail closed; references are integrity metadata only and are never dereferenced.

use cybermanju_types::agent_hub::{AgentProfile, DelegatedRun, HubEvent, HubEventKind};
use cybermanju_types::coordination::{
    CoordinationEnvelope, CoordinationOp, EventReference, PublicRecipientDescriptor,
};
use serde::{Deserialize, Serialize};

const MAX_FACTS: usize = 32;
const MAX_KEY_BYTES: usize = 64;
const MAX_VALUE_BYTES: usize = 2048;
const MAX_DATA_BYTES: usize = 16_384;
const MAX_REFS: usize = 16;
const MAX_REFERENCE_BYTES: usize = 32_768;
const MAX_ITEMS: usize = 24;
const MAX_ENVELOPE_BYTES: usize = 65_536;

/// Parse only a bare JSON envelope, enforcing protocol version and resource bounds.
pub fn parse_envelope(text: &str) -> Result<CoordinationEnvelope, String> {
    if text.len() > MAX_ENVELOPE_BYTES {
        return Err("too_large: coordination envelope exceeds JSON byte bound".into());
    }
    let envelope: CoordinationEnvelope = serde_json::from_str(text)
        .map_err(|_| "invalid: malformed or unknown coordination envelope fields".to_string())?;
    let envelope = sanitize_envelope(envelope);
    if envelope.v != 1 {
        return Err("invalid: unsupported coordination envelope version".into());
    }
    if envelope.data.len() > MAX_FACTS || envelope.refs.len() > MAX_REFS {
        return Err("too_large: coordination envelope has too many entries".into());
    }
    if envelope.data.is_empty() {
        return Err("invalid: coordination data must not be empty".into());
    }
    if !envelope.refs.is_empty() {
        return Err("invalid: caller-supplied references are not accepted".into());
    }
    let mut total = 0usize;
    let mut keys = std::collections::HashSet::new();
    for fact in &envelope.data {
        if fact.k.is_empty() || fact.k.len() > MAX_KEY_BYTES || fact.v.len() > MAX_VALUE_BYTES {
            return Err("too_large: coordination fact exceeds field bounds".into());
        }
        if !keys.insert(&fact.k) {
            return Err("invalid: duplicate coordination fact key".into());
        }
        total = total
            .saturating_add(fact.k.len())
            .saturating_add(fact.v.len());
    }
    let (required, op_name) = match envelope.op {
        CoordinationOp::Task => ("goal", "task"),
        CoordinationOp::Result => ("answer", "result"),
        CoordinationOp::Blocked => ("reason", "blocked"),
    };
    if !envelope
        .data
        .iter()
        .any(|fact| fact.k == required && !fact.v.trim().is_empty())
    {
        return Err(format!(
            "invalid: {op_name} operation requires nonempty {required} fact"
        ));
    }
    if total > MAX_DATA_BYTES {
        return Err("too_large: coordination facts exceed total byte bound".into());
    }
    for reference in &envelope.refs {
        validate_reference(reference)?;
    }
    Ok(envelope)
}

fn sanitize_envelope(mut envelope: CoordinationEnvelope) -> CoordinationEnvelope {
    for fact in &mut envelope.data {
        fact.k = crate::redact::redact(&fact.k).0;
        fact.v = crate::redact::redact(&fact.v).0;
    }
    envelope
}

/// Return the compact canonical JSON spelling of a valid envelope.
pub fn canonical_envelope(text: &str) -> Result<String, String> {
    let envelope = parse_envelope(text)?;
    serde_json::to_string(&envelope)
        .map_err(|_| "invalid: cannot serialize coordination envelope".into())
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}

fn validate_reference(reference: &EventReference) -> Result<(), String> {
    if !valid_identifier(&reference.event_id)
        || reference.seq == 0
        || reference.field.is_empty()
        || reference.field.len() > 64
        || !reference
            .field
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
        || reference.bytes > MAX_REFERENCE_BYTES
        || reference.hash.len() != 64
        || !reference.hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("invalid: malformed or out-of-bounds event reference".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PromptProjection {
    pub v: u8,
    #[serde(rename = "recipientId")]
    pub recipient_id: String,
    #[serde(rename = "sourceEventId")]
    pub source_event_id: String,
    #[serde(rename = "sourceSeq")]
    pub source_seq: u64,
    pub items: Vec<ProjectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectionItem {
    #[serde(rename = "ref")]
    pub reference: EventReference,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<ProjectedValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ProjectedValue {
    Text(String),
    Envelope(CoordinationEnvelope),
    Profile(PublicRecipientDescriptor),
}

fn projection_reference(source: &HubEvent, field: &str, value: &str) -> EventReference {
    // Callers supply field-sanitized text or canonical serialized typed values.
    // Re-redacting here could corrupt JSON spelling and break PEM traceability.
    EventReference {
        event_id: source.id.clone(),
        seq: source.seq,
        field: field.to_string(),
        bytes: value.len(),
        hash: blake3::hash(value.as_bytes()).to_hex().to_string(),
    }
}

fn fits(projection: &PromptProjection, max_bytes: usize) -> bool {
    serde_json::to_vec(projection)
        .map(|bytes| bytes.len() <= max_bytes)
        .unwrap_or(false)
}

/// Build a JSON-only, deterministic projection; bytes are UTF-8 JSON bytes, not tokens.
/// Values are marker-redacted before storage and hashing. No transcript or memory is consulted.
pub fn project(
    profile: &AgentProfile,
    run: &DelegatedRun,
    source: &HubEvent,
    max_bytes: usize,
) -> Result<PromptProjection, String> {
    if profile.id != run.recipient_id
        || profile.owner_id != run.owner_id
        || profile.provider_config_id != run.provider_config_id
        || run
            .profile_snapshot
            .as_ref()
            .map(|saved| (&saved.id, &saved.owner_id, &saved.provider_config_id))
            != Some((&profile.id, &profile.owner_id, &profile.provider_config_id))
        || source.run_id.as_deref() != Some(run.id.as_str())
        || source.conversation_id != run.conversation_id
        || source.recipient_id.as_deref() != Some(profile.id.as_str())
        || source.sender_id != run.sender_id
        || source.text != run.input
        || source.visibility != run.visibility
        || source.kind != HubEventKind::Delegation
        || source.seq == 0
    {
        return Err("auth: profile, run, and source event routing do not match".into());
    }
    if !run.tool_grants.is_empty() {
        return Err("unsupported: delegated tools are disabled in hub v1".into());
    }
    if run.input.len() > 16_384
        || run.selected_context.len() > 8
        || run.selected_context.iter().map(String::len).sum::<usize>() > 8192
    {
        return Err("too_large: projection input exceeds run bounds".into());
    }
    let (clean_task, internal_task) =
        if run.visibility == cybermanju_types::agent_hub::EventVisibility::Internal {
            let envelope = parse_envelope(&run.input)?;
            let canonical = serde_json::to_string(&envelope)
                .map_err(|_| "invalid: cannot serialize coordination envelope".to_string())?;
            (canonical, Some(envelope))
        } else {
            (crate::redact::redact(&run.input).0, None)
        };
    let mut projection = PromptProjection {
        v: 1,
        recipient_id: profile.id.clone(),
        source_event_id: source.id.clone(),
        source_seq: source.seq,
        items: Vec::new(),
    };
    let task_ref = projection_reference(source, "text", &clean_task);
    let task = ProjectionItem {
        reference: task_ref.clone(),
        value: Some(
            internal_task
                .map(ProjectedValue::Envelope)
                .unwrap_or(ProjectedValue::Text(clean_task)),
        ),
    };
    projection.items.push(task);

    let snapshot = run
        .profile_snapshot
        .as_ref()
        .ok_or_else(|| "integrity: delegated run has no immutable profile snapshot".to_string())?;
    let clean = |value: &str| crate::redact::redact(value).0;
    let descriptor = PublicRecipientDescriptor {
        name: clean(&snapshot.name),
        personality: clean(&snapshot.personality),
        goals: snapshot.goals.iter().map(|v| clean(v)).collect(),
        interests: snapshot.interests.iter().map(|v| clean(v)).collect(),
        knowledge: snapshot.knowledge.iter().map(|v| clean(v)).collect(),
    };
    let descriptor_bytes = serde_json::to_string(&descriptor)
        .map_err(|_| "invalid: cannot serialize public profile".to_string())?;
    if descriptor_bytes.len() > MAX_REFERENCE_BYTES {
        return Err("too_large: public profile snapshot exceeds projection bounds".into());
    }
    let mut candidates = Vec::with_capacity(1 + run.selected_context.len());
    // Reference field namespace: `text` is the event task, `contextN` resolves
    // through that event's run_id to run.selected_context[N], and `profile`
    // resolves to that run's immutable public profile_snapshot. Hashes cover
    // marker-redacted projection values; references are metadata, not fetches.
    for (index, value) in run.selected_context.iter().enumerate() {
        let clean = crate::redact::redact(value).0;
        candidates.push(ProjectionItem {
            reference: projection_reference(source, &format!("context{index}"), &clean),
            value: Some(ProjectedValue::Text(clean)),
        });
    }
    candidates.push(ProjectionItem {
        reference: projection_reference(source, "profile", &descriptor_bytes),
        value: Some(ProjectedValue::Profile(descriptor)),
    });
    if projection.items.len().saturating_add(candidates.len()) > MAX_ITEMS {
        return Err("too_large: selected context exceeds projection item bound".into());
    }
    projection.items.extend(candidates);
    // Reserve every reference before choosing inline values. Otherwise an
    // early value could consume space required for later reference metadata.
    let values: Vec<Option<ProjectedValue>> = projection
        .items
        .iter_mut()
        .map(|item| item.value.take())
        .collect();
    if !fits(&projection, max_bytes) {
        return Err("too_large: required projection references exceed byte bound".into());
    }
    for (index, value) in values.into_iter().enumerate() {
        projection.items[index].value = value;
        if !fits(&projection, max_bytes) {
            projection.items[index].value = None;
        }
    }
    Ok(projection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cybermanju_types::agent_hub::{EventVisibility, HubEventKind, RunStatus};

    fn fixture() -> (AgentProfile, DelegatedRun, HubEvent) {
        let profile = AgentProfile {
            id: "recipient".into(),
            owner_id: "owner".into(),
            name: "Helper".into(),
            personality: "Careful".into(),
            goals: vec!["Help".into()],
            interests: vec![],
            knowledge: vec![],
            provider_config_id: "provider".into(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let run = DelegatedRun {
            id: "run1".into(),
            owner_id: "owner".into(),
            conversation_id: "conv".into(),
            visibility: EventVisibility::User,
            sender_id: None,
            recipient_id: "recipient".into(),
            provider_config_id: "provider".into(),
            profile_snapshot: Some(profile.clone()),
            status: RunStatus::Running,
            selected_context: vec!["Some context".into()],
            tool_grants: vec![],
            input: "Do task".into(),
            result: None,
            error: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let source = HubEvent {
            id: "event1".into(),
            conversation_id: "conv".into(),
            seq: 1,
            visibility: EventVisibility::User,
            kind: HubEventKind::Delegation,
            sender_id: None,
            recipient_id: Some("recipient".into()),
            text: "Do task".into(),
            created_at: String::new(),
            run_id: Some("run1".into()),
        };
        (profile, run, source)
    }

    #[test]
    fn envelope_is_strict_versioned_and_canonical() {
        let raw = r#"{"v":1,"op":"task","data":[{"k":"goal","v":"x"}],"refs":[]}"#;
        assert_eq!(canonical_envelope(raw).unwrap(), raw);
        assert!(parse_envelope(r#"{"v":2,"op":"task","data":[],"refs":[]}"#).is_err());
        assert!(parse_envelope(r#"```json {"v":1,"op":"task","data":[],"refs":[]} ```"#).is_err());
        assert!(parse_envelope(r#"{"v":1,"op":"task","data":[],"refs":[],"extra":true}"#).is_err());
        assert!(parse_envelope(r#"{"v":1,"op":"unknown","data":[],"refs":[]}"#).is_err());
    }

    #[test]
    fn requires_operation_specific_nonblank_facts() {
        for (op, key) in [
            ("task", "goal"),
            ("result", "answer"),
            ("blocked", "reason"),
        ] {
            let good = serde_json::json!({"v":1,"op":op,"data":[{"k":key,"v":" ok "}],"refs":[]})
                .to_string();
            assert!(parse_envelope(&good).is_ok());
            for facts in [
                serde_json::json!([]),
                serde_json::json!([{"k":"other","v":"ok"}]),
                serde_json::json!([{"k":key,"v":"  	"}]),
            ] {
                let bad = serde_json::json!({"v":1,"op":op,"data":facts,"refs":[]}).to_string();
                assert!(parse_envelope(&bad).is_err());
            }
        }
    }

    #[test]
    fn rejects_oversize_facts_and_invalid_references() {
        let long = "x".repeat(MAX_VALUE_BYTES + 1);
        let raw = serde_json::json!({"v":1,"op":"task","data":[{"k":"k","v":long}],"refs":[]})
            .to_string();
        assert!(parse_envelope(&raw).is_err());
        let ref_value = serde_json::json!({"e":"evt","s":1,"f":"text","b":1,"h":"bad"});
        let raw = serde_json::json!({"v":1,"op":"task","data":[],"refs":[ref_value]}).to_string();
        assert!(parse_envelope(&raw).is_err());
    }

    #[test]
    fn projection_is_deterministic_routed_and_bounded_in_utf8_bytes() {
        let (profile, run, source) = fixture();
        let first = project(&profile, &run, &source, 4096).unwrap();
        let second = project(&profile, &run, &source, 4096).unwrap();
        let encoded = serde_json::to_string(&first).unwrap();
        assert_eq!(first, second);
        assert!(encoded.len() <= 4096);
        assert!(encoded.contains("recipientId"));
        assert!(
            matches!(first.items[0].value.as_ref(), Some(ProjectedValue::Text(s)) if s == "Do task")
        );
        let mut minimal = first.clone();
        for item in &mut minimal.items {
            item.value = None;
        }
        let budget = serde_json::to_vec(&minimal).unwrap().len();
        let tiny = project(&profile, &run, &source, budget).unwrap();
        assert!(serde_json::to_vec(&tiny).unwrap().len() <= budget);
        assert!(tiny.items[0].value.is_none());
        let mut wrong = run.clone();
        wrong.recipient_id = "attacker".into();
        assert!(project(&profile, &wrong, &source, 4096)
            .unwrap_err()
            .starts_with("auth:"));
        let mut wrong_source = source.clone();
        wrong_source.run_id = Some("other".into());
        assert!(project(&profile, &run, &wrong_source, 4096).is_err());
    }

    #[test]
    fn internal_task_projects_as_typed_envelope_and_profile_as_object() {
        let (profile, mut run, mut source) = fixture();
        run.visibility = EventVisibility::Internal;
        run.input = r#"{"v":1,"op":"task","data":[{"k":"goal","v":"Do task"}],"refs":[]}"#.into();
        source.visibility = EventVisibility::Internal;
        source.text = run.input.clone();
        let p = project(&profile, &run, &source, 8192).unwrap();
        assert!(matches!(
            p.items[0].value.as_ref(),
            Some(ProjectedValue::Envelope(_))
        ));
        assert!(matches!(
            p.items.last().unwrap().value.as_ref(),
            Some(ProjectedValue::Profile(_))
        ));
        let json = serde_json::to_value(&p).unwrap();
        assert!(json["items"][0]["value"].is_object());
        assert!(json["items"].as_array().unwrap().last().unwrap()["value"].is_object());
    }

    #[test]
    fn utf8_byte_budget_is_explicit_and_task_never_truncated() {
        let (profile, mut run, mut source) = fixture();
        run.input = "é".repeat(150);
        source.text = run.input.clone();
        let mut minimal = project(&profile, &run, &source, 4096).unwrap();
        for item in &mut minimal.items {
            item.value = None;
        }
        let budget = serde_json::to_vec(&minimal).unwrap().len();
        let task_ref_only = project(&profile, &run, &source, budget).unwrap();
        assert!(serde_json::to_vec(&task_ref_only).unwrap().len() <= budget);
        assert!(task_ref_only.items[0].value.is_none());
        assert_eq!(
            task_ref_only.items[0].reference.bytes,
            "é".repeat(150).len()
        );
    }

    #[test]
    fn reference_hash_never_rewrites_serialized_pem_text() {
        let (_, _, source) = fixture();
        let pem = "-----BEGIN PRIVATE KEY-----***\n-----END PRIVATE KEY-----";
        let serialized = serde_json::json!({"personality":pem}).to_string();
        let before = serialized.clone();
        let reference = projection_reference(&source, "profile", &serialized);
        assert_eq!(reference.bytes, serialized.len());
        assert_eq!(
            reference.hash,
            blake3::hash(serialized.as_bytes()).to_hex().to_string()
        );
        assert_eq!(serialized, before);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serialized).unwrap()["personality"],
            pem
        );
    }
}
