// CyberManju OS — compact typed agent coordination contracts.
// Role: stable, bounded wire envelope and references for isolated delegated work.
// Exports: CoordinationEnvelope, CoordinationOp, Fact, EventReference.
// Contracts: compact keys; unknown fields rejected; references never dereference data.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CoordinationEnvelope {
    pub v: u8,
    pub op: CoordinationOp,
    pub data: Vec<Fact>,
    pub refs: Vec<EventReference>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CoordinationOp {
    Task,
    Result,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub k: String,
    pub v: String,
}

/// Compact, non-dereferencing pointer to one field of an immutable event.
/// Wire keys are `e` event id, `s` sequence, `f` field, `b` byte length, `h` BLAKE3 hex digest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventReference {
    #[serde(rename = "e")]
    pub event_id: String,
    #[serde(rename = "s")]
    pub seq: u64,
    #[serde(rename = "f")]
    pub field: String,
    #[serde(rename = "b")]
    pub bytes: usize,
    #[serde(rename = "h")]
    pub hash: String,
}

/// Public immutable recipient profile snapshot included as a typed projection value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicRecipientDescriptor {
    pub name: String,
    pub personality: String,
    pub goals: Vec<String>,
    pub interests: Vec<String>,
    pub knowledge: Vec<String>,
}
