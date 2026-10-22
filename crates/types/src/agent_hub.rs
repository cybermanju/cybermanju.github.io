// CyberManju OS — Agent Hub DTOs (crates/types/src/agent_hub.rs).
// Role: owner-scoped profiles, conversations, append-only events and delegated runs.
// Exports: AgentProfile, ProfileInput, Conversation, CreateConversation, HubEvent,
//   SendMessage, DelegatedRun, SendReceipt and their state/kind enums.
// Integrates: serde contracts shared by native Tauri and the backend service.
// Contracts: camelCase; unknown input fields rejected; no credential fields.

use serde::{Deserialize, Serialize};

/// Durable persona data; provider credentials remain in the original database.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProfile {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    pub personality: String,
    pub goals: Vec<String>,
    pub interests: Vec<String>,
    pub knowledge: Vec<String>,
    pub provider_config_id: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Missing/null id creates a profile; a supplied id updates that owner's row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub personality: String,
    pub goals: Vec<String>,
    pub interests: Vec<String>,
    pub knowledge: Vec<String>,
    pub provider_config_id: String,
}

/// The user owner is implicit; members are profile ids owned by that user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub owner_id: String,
    pub kind: ConversationKind,
    pub title: String,
    pub members: Vec<String>,
    pub created_at: String,
    pub last_seq: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationKind {
    Direct,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateConversation {
    pub kind: ConversationKind,
    pub title: String,
    pub members: Vec<String>,
}

/// Conversation-local sequence numbers are allocated in the write transaction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubEvent {
    pub id: String,
    pub conversation_id: String,
    pub seq: u64,
    pub visibility: EventVisibility,
    pub kind: HubEventKind,
    pub sender_id: Option<String>,
    pub recipient_id: Option<String>,
    pub text: String,
    pub created_at: String,
    pub run_id: Option<String>,
}

/// Explicit disclosure class, independent of event kind. Missing values are
/// rejected on the wire; the store migrates legacy rows to internal, fail-closed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventVisibility {
    User,
    Internal,
}

/// Metadata only: never a legacy payload, kind, sender, run or provider input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuarantinedLegacyEvent {
    pub seq: u64,
    pub reason: LegacyQuarantineReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LegacyQuarantineReason {
    MissingVisibility,
    /// The previous migration discarded provenance. This is only a candidate;
    /// it may have been explicitly internal before that migration.
    LegacyProvenanceUnavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HubEventKind {
    Message,
    Delegation,
    Assistant,
    RunFailed,
}

/// A caller-selected recipient starts exactly one isolated run. None records
/// a message without dispatch. A profile sender must name a distinct recipient.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendMessage {
    pub conversation_id: String,
    pub idempotency_key: String,
    /// Owner-selected profile label for an internal delegation, not an
    /// authenticated agent actor or evidence of autonomous agent authorship.
    pub sender_id: Option<String>,
    pub recipient_id: Option<String>,
    pub text: String,
    pub selected_context: Vec<String>,
    pub tool_grants: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedRun {
    pub id: String,
    pub owner_id: String,
    pub conversation_id: String,
    pub visibility: EventVisibility,
    pub sender_id: Option<String>,
    pub recipient_id: String,
    pub provider_config_id: String,
    /// Public saved persona only; never a constructed/system/private prompt.
    /// Legacy runs have no snapshot and cannot be projected for dispatch.
    #[serde(default)]
    pub profile_snapshot: Option<AgentProfile>,
    pub status: RunStatus,
    pub selected_context: Vec<String>,
    pub tool_grants: Vec<String>,
    pub input: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

/// The immutable original receipt may contain a pending snapshot on replay;
/// use hub_get_run for live status rather than interpreting replay as a retry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SendReceipt {
    pub event: HubEvent,
    pub run: Option<DelegatedRun>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inputs_cannot_smuggle_owner_or_credential_fields() {
        let input = serde_json::json!({
            "name": "Assistant", "personality": "Helpful", "goals": [],
            "interests": [], "knowledge": [], "providerConfigId": "existing",
            "ownerId": "someone-else", "apiKey": "not-accepted",
        });
        assert!(serde_json::from_value::<ProfileInput>(input).is_err());
    }

    #[test]
    fn enums_use_stable_camel_case_wire_names() {
        assert_eq!(
            serde_json::to_string(&HubEventKind::RunFailed).unwrap(),
            "\"runFailed\""
        );
        assert_eq!(
            serde_json::to_string(&RunStatus::Completed).unwrap(),
            "\"completed\""
        );
    }

    #[test]
    fn visibility_is_mandatory_and_not_inferred_from_kind() {
        let mut event = serde_json::json!({
            "id":"e", "conversationId":"c", "seq":1, "kind":"assistant",
            "senderId":"agent", "recipientId":null, "text":"reply",
            "createdAt":"time", "runId":"r",
        });
        assert!(serde_json::from_value::<HubEvent>(event.clone()).is_err());
        event["visibility"] = "user".into();
        assert_eq!(
            serde_json::from_value::<HubEvent>(event.clone())
                .unwrap()
                .visibility,
            EventVisibility::User
        );
        event["visibility"] = "internal".into();
        assert_eq!(
            serde_json::from_value::<HubEvent>(event)
                .unwrap()
                .visibility,
            EventVisibility::Internal
        );
    }
}
