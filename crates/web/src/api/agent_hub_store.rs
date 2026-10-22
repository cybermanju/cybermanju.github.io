// CyberManju OS — Agent Hub Store (crates/web/src/api/agent_hub_store.rs).
// Role: durable owner-isolated profiles, conversations, events and delegated runs.
// Exports: AgentHubStore and its transactional profile/message/run operations.
// Integrates: separate redb database, shared agent_hub DTOs and secret redaction.
// Contracts: host-assigned owners; append-only events; atomic sequence/idempotency.

use cybermanju_agent::{hub_protocol, redact};
use cybermanju_types::agent_hub::*;
use redb::{Database, ReadableTable, TableDefinition};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

const PROFILES: TableDefinition<&str, &str> = TableDefinition::new("hub_profiles");
const CONVERSATIONS: TableDefinition<&str, &str> = TableDefinition::new("hub_conversations");
const EVENTS: TableDefinition<&str, &str> = TableDefinition::new("hub_events");
const RUNS: TableDefinition<&str, &str> = TableDefinition::new("hub_runs");
const IDEMPOTENCY: TableDefinition<&str, &str> = TableDefinition::new("hub_idempotency");
const SOURCES: TableDefinition<&str, &str> = TableDefinition::new("hub_run_sources");
const QUARANTINE: TableDefinition<&str, &str> = TableDefinition::new("hub_legacy_quarantine");

/// This handle MUST be shared, not opened separately for every IPC invocation.
pub struct AgentHubStore {
    db: Database,
}

impl AgentHubStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let db = Database::create(path).map_err(err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(err)?;
        }
        let store = Self { db };
        // Read transactions cannot create tables. Commit the entire schema
        // before recovery, including on a completely fresh Android install.
        let tx = store.db.begin_write().map_err(err)?;
        drop(tx.open_table(PROFILES).map_err(err)?);
        drop(tx.open_table(CONVERSATIONS).map_err(err)?);
        drop(tx.open_table(EVENTS).map_err(err)?);
        drop(tx.open_table(RUNS).map_err(err)?);
        drop(tx.open_table(IDEMPOTENCY).map_err(err)?);
        drop(tx.open_table(SOURCES).map_err(err)?);
        drop(tx.open_table(QUARANTINE).map_err(err)?);
        tx.commit().map_err(err)?;
        store.migrate_visibility()?;
        store.recover_interrupted()?;
        Ok(store)
    }

    pub fn profiles(&self, owner: &str) -> Result<Vec<AgentProfile>, String> {
        validate_owner(owner)?;
        let tx = self.db.begin_read().map_err(err)?;
        let table = tx.open_table(PROFILES).map_err(err)?;
        let prefix = format!("{owner}|");
        let upper = format!("{prefix}\u{10ffff}");
        let mut profiles = Vec::new();
        for row in table.range(prefix.as_str()..upper.as_str()).map_err(err)? {
            let (_, value) = row.map_err(err)?;
            let profile: AgentProfile = decode(value.value())?;
            ensure_owner(owner, &profile.owner_id)?;
            profiles.push(profile);
        }
        Ok(profiles)
    }

    pub fn save_profile(
        &self,
        owner: &str,
        mut input: ProfileInput,
    ) -> Result<AgentProfile, String> {
        validate_owner(owner)?;
        limits(&input.name, 256, "name")?;
        if input.name.trim().is_empty() {
            return Err("invalid: profile name is required".into());
        }
        limits(&input.personality, 8192, "personality")?;
        validate_vec(&input.goals, 64, 2048)?;
        validate_vec(&input.interests, 64, 2048)?;
        validate_vec(&input.knowledge, 64, 4096)?;
        validate_id(&input.provider_config_id, "provider config id")?;
        let id = input.id.take().unwrap_or_else(new_id);
        validate_id(&id, "profile id")?;
        let record_key = key(owner, &id);
        let now = timestamp();
        let tx = self.db.begin_write().map_err(err)?;
        let existing: Option<AgentProfile> = read_write(&tx, PROFILES, &record_key)?;
        if let Some(profile) = &existing {
            ensure_owner(owner, &profile.owner_id)?;
        }
        let profile = AgentProfile {
            id,
            owner_id: owner.to_owned(),
            name: clean(input.name),
            personality: clean(input.personality),
            goals: input.goals.into_iter().map(clean).collect(),
            interests: input.interests.into_iter().map(clean).collect(),
            knowledge: input.knowledge.into_iter().map(clean).collect(),
            provider_config_id: input.provider_config_id,
            created_at: existing
                .map(|p| p.created_at)
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        limits(&encode(&profile)?, 32768, "profile")?;
        write_row(&tx, PROFILES, &record_key, &profile)?;
        tx.commit().map_err(err)?;
        Ok(profile)
    }

    pub fn profile(&self, owner: &str, id: &str) -> Result<Option<AgentProfile>, String> {
        validate_owner(owner)?;
        validate_id(id, "profile id")?;
        let tx = self.db.begin_read().map_err(err)?;
        let profile: Option<AgentProfile> = read_row(&tx, PROFILES, &key(owner, id))?;
        if let Some(profile) = &profile {
            ensure_owner(owner, &profile.owner_id)?;
        }
        Ok(profile)
    }

    pub fn create_conversation(
        &self,
        owner: &str,
        input: CreateConversation,
    ) -> Result<Conversation, String> {
        validate_owner(owner)?;
        limits(&input.title, 256, "title")?;
        if input.members.len() > 16 {
            return Err("too_large: conversation has too many members".into());
        }
        let members = unique(input.members)?;
        match input.kind {
            ConversationKind::Direct if !(1..=2).contains(&members.len()) => {
                return Err("invalid: direct conversation requires 1..2 profiles".into());
            }
            ConversationKind::Group if !(1..=16).contains(&members.len()) => {
                return Err("invalid: group conversation requires 1..16 profiles".into());
            }
            _ => {}
        }
        let tx = self.db.begin_write().map_err(err)?;
        for member in &members {
            member_profile(&tx, owner, member)?;
        }
        let conversation = Conversation {
            id: new_id(),
            owner_id: owner.to_owned(),
            kind: input.kind,
            title: clean(input.title),
            members,
            created_at: timestamp(),
            last_seq: 0,
        };
        write_row(
            &tx,
            CONVERSATIONS,
            &key(owner, &conversation.id),
            &conversation,
        )?;
        tx.commit().map_err(err)?;
        Ok(conversation)
    }

    pub fn conversations(&self, owner: &str) -> Result<Vec<Conversation>, String> {
        validate_owner(owner)?;
        let tx = self.db.begin_read().map_err(err)?;
        let table = tx.open_table(CONVERSATIONS).map_err(err)?;
        let prefix = format!("{owner}|");
        let upper = format!("{prefix}\u{10ffff}");
        let mut conversations = Vec::new();
        for row in table.range(prefix.as_str()..upper.as_str()).map_err(err)? {
            let (_, value) = row.map_err(err)?;
            let conversation: Conversation = decode(value.value())?;
            ensure_owner(owner, &conversation.owner_id)?;
            conversations.push(conversation);
        }
        Ok(conversations)
    }

    /// Public conversation projection: fail closed on explicit disclosure, never
    /// infer it from kind. Native hub_list_events uses this safe default.
    pub fn events(
        &self,
        owner: &str,
        conversation_id: &str,
        after_seq: u64,
        limit: usize,
    ) -> Result<Vec<HubEvent>, String> {
        self.read_events(owner, conversation_id, after_seq, limit, false)
    }

    /// Backend-only canonical audit feed; intentionally not an IPC command.
    pub fn audit_events(
        &self,
        owner: &str,
        conversation_id: &str,
        after_seq: u64,
        limit: usize,
    ) -> Result<Vec<HubEvent>, String> {
        self.read_events(owner, conversation_id, after_seq, limit, true)
    }

    /// Explicit owner-only discovery, separate from the normal transcript.
    /// No raw payload is returned or promoted, and no provider run is started.
    /// Native command wiring belongs to the host integration, not this store.
    pub fn quarantined_legacy_events(
        &self,
        owner: &str,
        conversation_id: &str,
        after_seq: u64,
        limit: usize,
    ) -> Result<Vec<QuarantinedLegacyEvent>, String> {
        validate_owner(owner)?;
        validate_id(conversation_id, "conversation id")?;
        let tx = self.db.begin_read().map_err(err)?;
        let conversation: Conversation =
            read_row(&tx, CONVERSATIONS, &key(owner, conversation_id))?
                .ok_or_else(|| "not_found: conversation not found".to_string())?;
        ensure_owner(owner, &conversation.owner_id)?;
        let Some(next_seq) = after_seq.checked_add(1) else {
            return Ok(Vec::new());
        };
        let prefix = format!("{owner}|{conversation_id}|");
        let lower = format!("{prefix}{next_seq:020}");
        let upper = format!("{prefix}\u{10ffff}");
        let table = tx.open_table(QUARANTINE).map_err(err)?;
        let mut entries = Vec::new();
        for row in table.range(lower.as_str()..upper.as_str()).map_err(err)? {
            let (record_key, value) = row.map_err(err)?;
            let reason: LegacyQuarantineReason = decode(value.value())?;
            let event: HubEvent = read_row(&tx, EVENTS, record_key.value())?
                .ok_or_else(|| "integrity: quarantined event unavailable".to_string())?;
            if event.conversation_id != conversation_id
                || record_key.value() != format!("{prefix}{:020}", event.seq)
                || event.visibility != EventVisibility::Internal
            {
                return Err("integrity: quarantine index mismatch".into());
            }
            entries.push(QuarantinedLegacyEvent {
                seq: event.seq,
                reason,
            });
            if entries.len() >= limit.clamp(1, 500) {
                break;
            }
        }
        Ok(entries)
    }

    /// The range starts at the cursor, so old history is not imported. Public
    /// polling may scan internal rows but never returns them or loses a later
    /// visible event behind an internal-only page.
    fn read_events(
        &self,
        owner: &str,
        conversation_id: &str,
        after_seq: u64,
        limit: usize,
        include_internal: bool,
    ) -> Result<Vec<HubEvent>, String> {
        validate_owner(owner)?;
        validate_id(conversation_id, "conversation id")?;
        let tx = self.db.begin_read().map_err(err)?;
        let conversation: Conversation =
            read_row(&tx, CONVERSATIONS, &key(owner, conversation_id))?
                .ok_or_else(|| "not_found: conversation not found".to_string())?;
        ensure_owner(owner, &conversation.owner_id)?;
        let Some(next_seq) = after_seq.checked_add(1) else {
            return Ok(Vec::new());
        };
        let prefix = format!("{owner}|{conversation_id}|");
        let lower = format!("{prefix}{next_seq:020}");
        let upper = format!("{prefix}\u{10ffff}");
        let table = tx.open_table(EVENTS).map_err(err)?;
        let mut events = Vec::new();
        for row in table.range(lower.as_str()..upper.as_str()).map_err(err)? {
            let (_, value) = row.map_err(err)?;
            let event: HubEvent = decode(value.value())?;
            if include_internal || event.visibility == EventVisibility::User {
                events.push(event);
            }
            if events.len() >= limit.clamp(1, 500) {
                break;
            }
        }
        Ok(events)
    }

    /// All membership, replay, sequence and run writes share one transaction.
    /// The authenticated owner initiates every send; sender_id is an owner-
    /// selected delegation label, NOT proof of autonomous agent authorship.
    pub fn send(&self, owner: &str, mut input: SendMessage) -> Result<SendReceipt, String> {
        validate_owner(owner)?;
        validate_id(&input.conversation_id, "conversation id")?;
        if input.idempotency_key.is_empty()
            || input.idempotency_key.len() > 256
            || input.idempotency_key.contains('|')
        {
            return Err("invalid: invalid idempotency key".into());
        }
        if !input.tool_grants.is_empty() {
            return Err("unsupported: hub v1 does not grant tools".into());
        }
        limits(&input.text, 16384, "message")?;
        if input.selected_context.len() > 8
            || input
                .selected_context
                .iter()
                .map(String::len)
                .sum::<usize>()
                > 8192
        {
            return Err("too_large: selected context exceeds limit".into());
        }
        for member in input.sender_id.iter().chain(input.recipient_id.iter()) {
            validate_id(member, "member id")?;
        }
        if input.sender_id.is_some() && input.recipient_id.is_none() {
            return Err("invalid: a profile sender must name a recipient".into());
        }
        if input.sender_id.is_some() && input.sender_id == input.recipient_id {
            return Err("invalid: sender and recipient must differ".into());
        }
        input.text = if input.sender_id.is_some() {
            cybermanju_agent::hub_prompt::scrub_envelope(&input.text, &[])?
        } else {
            clean(input.text)
        };
        input.selected_context = input.selected_context.into_iter().map(clean).collect();
        let visibility = if input.sender_id.is_some() {
            // The host assigns disclosure at ingress, not from the event kind.
            input.text = hub_protocol::canonical_envelope(&input.text)?;
            let envelope = hub_protocol::parse_envelope(&input.text)?;
            if envelope.op != cybermanju_types::coordination::CoordinationOp::Task {
                return Err("invalid: an internal send requires a task envelope".into());
            }
            if !envelope.refs.is_empty() {
                return Err("unsupported: caller-supplied event references are disabled".into());
            }
            EventVisibility::Internal
        } else {
            EventVisibility::User
        };
        let digest = blake3::hash(encode(&input)?.as_bytes())
            .to_hex()
            .to_string();
        let conversation_key = key(owner, &input.conversation_id);
        let idempotency_key = key(
            owner,
            &format!("{}|{}", input.conversation_id, input.idempotency_key),
        );
        let tx = self.db.begin_write().map_err(err)?;
        let mut conversation: Conversation = read_write(&tx, CONVERSATIONS, &conversation_key)?
            .ok_or_else(|| "not_found: conversation not found".to_string())?;
        ensure_owner(owner, &conversation.owner_id)?;
        for member in input.sender_id.iter().chain(input.recipient_id.iter()) {
            if !conversation.members.contains(member) {
                return Err("not_found: conversation member not found".into());
            }
            member_profile(&tx, owner, member)?;
        }
        let previous: Option<(String, SendReceipt)> =
            read_write(&tx, IDEMPOTENCY, &idempotency_key)?;
        if let Some((saved_digest, receipt)) = previous {
            if saved_digest != digest {
                return Err("conflict: idempotency key reused with different payload".into());
            }
            return Ok(receipt);
        }
        let now = timestamp();
        let run = if let Some(recipient) = &input.recipient_id {
            let profile = member_profile(&tx, owner, recipient)?;
            Some(DelegatedRun {
                id: new_id(),
                owner_id: owner.to_owned(),
                conversation_id: conversation.id.clone(),
                visibility,
                sender_id: input.sender_id.clone(),
                profile_snapshot: Some(profile.clone()),
                recipient_id: profile.id,
                provider_config_id: profile.provider_config_id,
                status: RunStatus::Pending,
                selected_context: input.selected_context.clone(),
                tool_grants: Vec::new(),
                input: input.text.clone(),
                result: None,
                error: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            })
        } else {
            None
        };
        let event = HubEvent {
            id: new_id(),
            conversation_id: conversation.id.clone(),
            seq: allocate_seq(&mut conversation)?,
            visibility,
            kind: if run.is_some() {
                HubEventKind::Delegation
            } else {
                HubEventKind::Message
            },
            sender_id: input.sender_id,
            recipient_id: input.recipient_id,
            text: input.text,
            created_at: now,
            run_id: run.as_ref().map(|r| r.id.clone()),
        };
        let receipt = SendReceipt {
            event: event.clone(),
            run: run.clone(),
        };
        write_row(&tx, CONVERSATIONS, &conversation_key, &conversation)?;
        write_row(&tx, EVENTS, &event_key(owner, &event), &event)?;
        if let Some(run) = &run {
            write_row(&tx, RUNS, &key(owner, &run.id), run)?;
            write_row(&tx, SOURCES, &key(owner, &run.id), &event.seq)?;
        }
        write_row(
            &tx,
            IDEMPOTENCY,
            &idempotency_key,
            &(digest, receipt.clone()),
        )?;
        tx.commit().map_err(err)?;
        Ok(receipt)
    }

    pub fn run(&self, owner: &str, id: &str) -> Result<Option<DelegatedRun>, String> {
        validate_owner(owner)?;
        validate_id(id, "run id")?;
        let tx = self.db.begin_read().map_err(err)?;
        let run: Option<DelegatedRun> = read_row(&tx, RUNS, &key(owner, id))?;
        if let Some(run) = &run {
            ensure_owner(owner, &run.owner_id)?;
        }
        Ok(run)
    }

    /// Constant-key lookup; never loads unrelated conversation history.
    pub fn source_event(&self, owner: &str, run: &DelegatedRun) -> Result<HubEvent, String> {
        validate_owner(owner)?;
        validate_id(&run.id, "run id")?;
        ensure_owner(owner, &run.owner_id)?;
        let tx = self.db.begin_read().map_err(err)?;
        let saved: DelegatedRun = read_row(&tx, RUNS, &key(owner, &run.id))?
            .ok_or_else(|| "not_found: run not found".to_string())?;
        if &saved != run {
            return Err("integrity: run snapshot does not match source lookup".into());
        }
        let seq: u64 = read_row(&tx, SOURCES, &key(owner, &run.id))?
            .ok_or_else(|| "integrity: run source index unavailable".to_string())?;
        let record_key = key(owner, &format!("{}|{seq:020}", run.conversation_id));
        let event: HubEvent = read_row(&tx, EVENTS, &record_key)?
            .ok_or_else(|| "integrity: source event unavailable".to_string())?;
        if event.run_id.as_deref() != Some(run.id.as_str())
            || event.visibility != run.visibility
            || event.conversation_id != run.conversation_id
            || event.sender_id != run.sender_id
            || event.recipient_id.as_deref() != Some(run.recipient_id.as_str())
            || event.text != run.input
        {
            return Err("integrity: source event does not match run".into());
        }
        Ok(event)
    }

    /// Exactly one worker can claim a pending run, including concurrent replay.
    pub fn claim_run(&self, owner: &str, id: &str) -> Result<Option<DelegatedRun>, String> {
        validate_owner(owner)?;
        validate_id(id, "run id")?;
        let tx = self.db.begin_write().map_err(err)?;
        let run_key = key(owner, id);
        let Some(mut run) = read_write::<DelegatedRun>(&tx, RUNS, &run_key)? else {
            return Ok(None);
        };
        ensure_owner(owner, &run.owner_id)?;
        if run.status != RunStatus::Pending {
            return Ok(None);
        }
        validate_run_members(&tx, owner, &run)?;
        run.status = RunStatus::Running;
        run.updated_at = timestamp();
        write_row(&tx, RUNS, &run_key, &run)?;
        tx.commit().map_err(err)?;
        Ok(Some(run))
    }

    /// The terminal event and run state commit together; events are never edited.
    pub fn transition_run(
        &self,
        owner: &str,
        id: &str,
        status: RunStatus,
        result: Option<String>,
        error: Option<String>,
    ) -> Result<DelegatedRun, String> {
        validate_owner(owner)?;
        validate_id(id, "run id")?;
        if !matches!(status, RunStatus::Completed | RunStatus::Failed) {
            return Err("invalid: terminal status required".into());
        }
        let tx = self.db.begin_write().map_err(err)?;
        let mut run: DelegatedRun = read_write(&tx, RUNS, &key(owner, id))?
            .ok_or_else(|| "not_found: run not found".to_string())?;
        ensure_owner(owner, &run.owner_id)?;
        if run.status != RunStatus::Running {
            return Err("conflict: run is not running".into());
        }
        finish_run(&tx, owner, &mut run, status, result, error)?;
        tx.commit().map_err(err)?;
        Ok(run)
    }

    /// Legacy rows had no disclosure class. Migrate all of them to internal,
    /// including immutable receipt snapshots, without guessing from event kind.
    /// One transaction makes interrupted migration safe to repeat.
    fn migrate_visibility(&self) -> Result<(), String> {
        let tx = self.db.begin_write().map_err(err)?;
        if read_write::<bool>(&tx, SOURCES, "__quarantine_v3")? == Some(true) {
            return Ok(());
        }
        let already_migrated = read_write::<bool>(&tx, SOURCES, "__visibility_v2")? == Some(true);
        // v2 discarded original visibility provenance. On that upgrade only,
        // internal rows are conservatively listed as ambiguous candidates;
        // never infer provenance or disclosure from kind or text.
        let quarantined = {
            let table = tx.open_table(EVENTS).map_err(err)?;
            let mut entries = Vec::new();
            for row in table.iter().map_err(err)? {
                let (key, value) = row.map_err(err)?;
                let value: serde_json::Value = decode(value.value())?;
                let reason = if value.get("visibility").is_none() {
                    Some(LegacyQuarantineReason::MissingVisibility)
                } else if already_migrated
                    && value.get("visibility").and_then(serde_json::Value::as_str)
                        == Some("internal")
                {
                    Some(LegacyQuarantineReason::LegacyProvenanceUnavailable)
                } else {
                    None
                };
                if let Some(reason) = reason {
                    entries.push((key.value().to_owned(), reason));
                }
            }
            entries
        };
        for (key, reason) in quarantined {
            write_row(&tx, QUARANTINE, &key, &reason)?;
        }
        for (definition, receipt_row) in [(EVENTS, false), (RUNS, false), (IDEMPOTENCY, true)] {
            let updates = {
                let table = tx.open_table(definition).map_err(err)?;
                let mut updates = Vec::new();
                for row in table.iter().map_err(err)? {
                    let (key, value) = row.map_err(err)?;
                    let mut value: serde_json::Value = decode(value.value())?;
                    let mut changed = false;
                    if receipt_row {
                        if let Some(receipt) = value.get_mut(1) {
                            for field in ["event", "run"] {
                                if let Some(record) = receipt
                                    .get_mut(field)
                                    .and_then(serde_json::Value::as_object_mut)
                                {
                                    if !record.contains_key("visibility") {
                                        record.insert("visibility".into(), "internal".into());
                                        changed = true;
                                    }
                                }
                            }
                        }
                    } else if let Some(record) = value.as_object_mut() {
                        if !record.contains_key("visibility") {
                            record.insert("visibility".into(), "internal".into());
                            changed = true;
                        }
                    }
                    if changed {
                        updates.push((key.value().to_owned(), encode(&value)?));
                    }
                }
                updates
            };
            let mut table = tx.open_table(definition).map_err(err)?;
            for (key, value) in updates {
                table.insert(key.as_str(), value.as_str()).map_err(err)?;
            }
        }
        write_row(&tx, SOURCES, "__visibility_v2", &true)?;
        write_row(&tx, SOURCES, "__quarantine_v3", &true)?;
        tx.commit().map_err(err)?;
        Ok(())
    }

    /// Recovery never replays provider calls: an ambiguous interrupted request
    /// may already have been billed upstream. A new send key is an explicit retry.
    fn recover_interrupted(&self) -> Result<(), String> {
        let tx = self.db.begin_write().map_err(err)?;
        let pending = {
            let table = tx.open_table(RUNS).map_err(err)?;
            let mut pending = Vec::new();
            for row in table.iter().map_err(err)? {
                let (_, value) = row.map_err(err)?;
                let run: DelegatedRun = decode(value.value())?;
                if matches!(run.status, RunStatus::Pending | RunStatus::Running) {
                    pending.push(run);
                }
            }
            pending
        };
        for mut run in pending {
            let owner = run.owner_id.clone();
            validate_owner(&owner)?;
            finish_run(
                &tx,
                &owner,
                &mut run,
                RunStatus::Failed,
                None,
                Some("integrity: host restarted; send a new key to retry".into()),
            )?;
        }
        tx.commit().map_err(err)?;
        Ok(())
    }
}

fn validate_run_members(
    tx: &redb::WriteTransaction,
    owner: &str,
    run: &DelegatedRun,
) -> Result<Conversation, String> {
    ensure_owner(owner, &run.owner_id)?;
    let conversation: Conversation =
        read_write(tx, CONVERSATIONS, &key(owner, &run.conversation_id))?
            .ok_or_else(|| "not_found: conversation not found".to_string())?;
    ensure_owner(owner, &conversation.owner_id)?;
    for member in run
        .sender_id
        .iter()
        .chain(std::iter::once(&run.recipient_id))
    {
        if !conversation.members.contains(member) {
            return Err("not_found: conversation member not found".into());
        }
        member_profile(tx, owner, member)?;
    }
    Ok(conversation)
}

fn finish_run(
    tx: &redb::WriteTransaction,
    owner: &str,
    run: &mut DelegatedRun,
    status: RunStatus,
    result: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let mut conversation = validate_run_members(tx, owner, run)?;
    run.status = status;
    run.result = if status == RunStatus::Completed {
        let raw = result.unwrap_or_default();
        let text = if run.visibility == EventVisibility::Internal {
            cybermanju_agent::hub_prompt::scrub_envelope(&raw, &[])?
        } else {
            clean(raw)
        };
        limits(&text, 65536, "assistant result")?;
        if run.visibility == EventVisibility::Internal {
            let envelope = hub_protocol::parse_envelope(&text)?;
            if envelope.op == cybermanju_types::coordination::CoordinationOp::Task {
                return Err("invalid: internal output requires result or blocked".into());
            }
            if !envelope.refs.is_empty() {
                return Err("unsupported: generated event references are disabled".into());
            }
            Some(hub_protocol::canonical_envelope(&text)?)
        } else {
            Some(text)
        }
    } else {
        None
    };
    run.error = if status == RunStatus::Failed {
        // Never persist arbitrary diagnostics supplied by a provider/caller.
        let supplied = error.unwrap_or_default();
        let prefix = supplied.split(':').next().unwrap_or_default();
        let code = match prefix {
            "auth" | "rate_limited" | "too_large" | "unsupported" | "not_found" | "limit"
            | "invalid" | "network" => prefix,
            _ => "integrity",
        };
        Some(format!("{code}: isolated recipient run failed"))
    } else {
        None
    };
    run.updated_at = timestamp();
    let text = if status == RunStatus::Failed && run.visibility == EventVisibility::Internal {
        let envelope = serde_json::json!({
            "v": 1, "op": "blocked",
            "data": [{"k": "reason", "v": run.error.as_deref().unwrap_or("integrity: run failed")}],
            "refs": [],
        })
        .to_string();
        hub_protocol::canonical_envelope(&envelope)?
    } else {
        run.result
            .as_ref()
            .or(run.error.as_ref())
            .cloned()
            .unwrap_or_default()
    };
    let event = HubEvent {
        id: new_id(),
        conversation_id: conversation.id.clone(),
        seq: allocate_seq(&mut conversation)?,
        visibility: run.visibility,
        kind: if status == RunStatus::Completed {
            HubEventKind::Assistant
        } else {
            HubEventKind::RunFailed
        },
        sender_id: Some(run.recipient_id.clone()),
        recipient_id: run.sender_id.clone(),
        text,
        created_at: run.updated_at.clone(),
        run_id: Some(run.id.clone()),
    };
    write_row(tx, RUNS, &key(owner, &run.id), run)?;
    write_row(
        tx,
        CONVERSATIONS,
        &key(owner, &conversation.id),
        &conversation,
    )?;
    write_row(tx, EVENTS, &event_key(owner, &event), &event)?;
    Ok(())
}

fn member_profile(
    tx: &redb::WriteTransaction,
    owner: &str,
    id: &str,
) -> Result<AgentProfile, String> {
    let profile: AgentProfile = read_write(tx, PROFILES, &key(owner, id))?
        .ok_or_else(|| "not_found: profile not found".to_string())?;
    ensure_owner(owner, &profile.owner_id)?;
    Ok(profile)
}

// Named locals keep redb access guards inside their table's lifetime, including
// on Rust 2021. Returning a tail-expression guard risks E0597 at block boundaries.
fn read_row<T: DeserializeOwned>(
    tx: &redb::ReadTransaction,
    definition: TableDefinition<&str, &str>,
    key: &str,
) -> Result<Option<T>, String> {
    let table = tx.open_table(definition).map_err(err)?;
    let raw = table.get(key).map_err(err)?;
    let decoded = raw
        .as_ref()
        .map(|value| decode(value.value()))
        .transpose()?;
    Ok(decoded)
}

fn read_write<T: DeserializeOwned>(
    tx: &redb::WriteTransaction,
    definition: TableDefinition<&str, &str>,
    key: &str,
) -> Result<Option<T>, String> {
    let table = tx.open_table(definition).map_err(err)?;
    let raw = table.get(key).map_err(err)?;
    let decoded = raw
        .as_ref()
        .map(|value| decode(value.value()))
        .transpose()?;
    Ok(decoded)
}

fn write_row<T: Serialize>(
    tx: &redb::WriteTransaction,
    definition: TableDefinition<&str, &str>,
    key: &str,
    value: &T,
) -> Result<(), String> {
    let serialized = encode(value)?;
    let mut table = tx.open_table(definition).map_err(err)?;
    table.insert(key, serialized.as_str()).map_err(err)?;
    Ok(())
}

fn allocate_seq(conversation: &mut Conversation) -> Result<u64, String> {
    conversation.last_seq = conversation
        .last_seq
        .checked_add(1)
        .ok_or_else(|| "conflict: conversation sequence exhausted".to_string())?;
    Ok(conversation.last_seq)
}

fn key(owner: &str, id: &str) -> String {
    format!("{owner}|{id}")
}

fn event_key(owner: &str, event: &HubEvent) -> String {
    key(
        owner,
        &format!("{}|{:020}", event.conversation_id, event.seq),
    )
}

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn validate_owner(owner: &str) -> Result<(), String> {
    if owner.trim().is_empty() || owner.len() > 128 || owner.contains('|') {
        Err("invalid: invalid owner".into())
    } else {
        Ok(())
    }
}

fn ensure_owner(expected: &str, actual: &str) -> Result<(), String> {
    if expected != actual {
        Err("not_found: owner-scoped record not found".into())
    } else {
        Ok(())
    }
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || value.contains('|') {
        Err(format!("invalid: invalid {label}"))
    } else {
        Ok(())
    }
}

fn limits(value: &str, max: usize, label: &str) -> Result<(), String> {
    if value.len() > max {
        Err(format!("too_large: {label} exceeds limit"))
    } else {
        Ok(())
    }
}

fn validate_vec(values: &[String], max_count: usize, max_len: usize) -> Result<(), String> {
    if values.len() > max_count {
        return Err("too_large: profile list exceeds limit".into());
    }
    for value in values {
        limits(value, max_len, "profile field")?;
    }
    Ok(())
}

fn unique(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for value in values {
        validate_id(&value, "member id")?;
        if !result.contains(&value) {
            result.push(value);
        }
    }
    Ok(result)
}

fn clean(value: String) -> String {
    redact::redact(&value).0
}

fn encode<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(err)
}

fn decode<T: DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(err)
}

fn err(_error: impl std::fmt::Display) -> String {
    // Serde/DB diagnostics may echo persisted task data. Never surface it.
    "integrity: hub storage operation failed".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::tempdir;

    fn profile(name: &str) -> ProfileInput {
        ProfileInput {
            id: None,
            name: name.into(),
            personality: String::new(),
            goals: vec![],
            interests: vec![],
            knowledge: vec![],
            provider_config_id: "cfg".into(),
        }
    }

    fn message(
        cid: &str,
        key: &str,
        sender: Option<String>,
        recipient: Option<String>,
    ) -> SendMessage {
        let text = if sender.is_some() {
            r#"{"v":1,"op":"task","data":[{"k":"goal","v":"Hello"}],"refs":[]}"#.into()
        } else {
            "Hello".into()
        };
        SendMessage {
            conversation_id: cid.into(),
            idempotency_key: key.into(),
            sender_id: sender,
            recipient_id: recipient,
            text,
            selected_context: vec![],
            tool_grants: vec![],
        }
    }

    fn conversation(
        store: &AgentHubStore,
        owner: &str,
        kind: ConversationKind,
        members: Vec<String>,
    ) -> Conversation {
        store
            .create_conversation(
                owner,
                CreateConversation {
                    kind,
                    title: "Chat".into(),
                    members,
                },
            )
            .unwrap()
    }

    #[test]
    fn fresh_open_one_profile_dispatch_replay_and_redaction() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("hub.redb")).unwrap();
        let mut input = profile("Agent");
        input.personality = "Bearer persona-secret".into();
        let agent = store.save_profile("owner", input).unwrap();
        assert!(!agent.personality.contains("persona-secret"));
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Direct,
            vec![agent.id.clone()],
        );
        let mut request = message(&conv.id, "once", None, Some(agent.id));
        request.text = "token=sk-ant-abcdefabcdef".into();
        let receipt = store.send("owner", request.clone()).unwrap();
        assert!(!receipt.event.text.contains("abcdef"));
        assert!(receipt.event.text.contains("***"));
        assert_eq!(store.send("owner", request.clone()).unwrap(), receipt);
        request.text = "different".into();
        assert!(store
            .send("owner", request)
            .unwrap_err()
            .starts_with("conflict:"));
        assert_eq!(store.events("owner", &conv.id, 0, 10).unwrap().len(), 1);
    }

    #[test]
    fn group_routing_membership_and_owner_isolation() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("hub.redb")).unwrap();
        let a = store.save_profile("alice", profile("a")).unwrap();
        let b = store.save_profile("alice", profile("b")).unwrap();
        let foreign = store.save_profile("bob", profile("foreign")).unwrap();
        let conv = conversation(
            &store,
            "alice",
            ConversationKind::Group,
            vec![a.id.clone(), b.id.clone()],
        );
        assert!(store.profile("bob", &a.id).unwrap().is_none());
        assert!(store.events("bob", &conv.id, 0, 10).is_err());
        assert!(store.conversations("bob").unwrap().is_empty());
        assert!(store
            .send(
                "alice",
                message(&conv.id, "foreign", Some(a.id.clone()), Some(foreign.id))
            )
            .is_err());
        assert!(store
            .send(
                "alice",
                message(&conv.id, "self", Some(a.id.clone()), Some(a.id.clone()))
            )
            .is_err());
        assert!(store
            .send(
                "alice",
                message(&conv.id, "missing", Some(a.id.clone()), None)
            )
            .is_err());
        let receipt = store
            .send(
                "alice",
                message(&conv.id, "good", Some(a.id), Some(b.id.clone())),
            )
            .unwrap();
        let run = receipt.run.unwrap();
        assert_eq!(run.recipient_id, b.id);
        assert!(store.run("bob", &run.id).unwrap().is_none());
        assert!(store.claim_run("bob", &run.id).unwrap().is_none());
        assert!(store
            .transition_run("bob", &run.id, RunStatus::Failed, None, None)
            .is_err());
        assert!(store.profiles("alice|nested").is_err());
    }

    #[test]
    fn concurrent_replay_allocates_one_sequence_and_one_run() {
        let dir = tempdir().unwrap();
        let store = Arc::new(AgentHubStore::open(dir.path().join("hub.redb")).unwrap());
        let agent = store.save_profile("owner", profile("Agent")).unwrap();
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Direct,
            vec![agent.id.clone()],
        );
        let request = message(&conv.id, "same", None, Some(agent.id));
        let barrier = Arc::new(Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                let barrier = barrier.clone();
                let request = request.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.send("owner", request).unwrap()
                })
            })
            .collect();
        let receipts: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(receipts[0], receipts[1]);
        assert_eq!(store.events("owner", &conv.id, 0, 10).unwrap().len(), 1);
        let run = receipts[0].run.as_ref().unwrap();
        assert!(store.claim_run("owner", &run.id).unwrap().is_some());
        assert!(store.claim_run("owner", &run.id).unwrap().is_none());
    }

    #[test]
    fn terminal_event_is_atomic_unique_and_survives_reopen() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("hub.redb");
        let (cid, run_id) = {
            let store = AgentHubStore::open(&path).unwrap();
            let agent = store.save_profile("owner", profile("Agent")).unwrap();
            let conv = conversation(
                &store,
                "owner",
                ConversationKind::Direct,
                vec![agent.id.clone()],
            );
            let run = store
                .send("owner", message(&conv.id, "run", None, Some(agent.id)))
                .unwrap()
                .run
                .unwrap();
            assert!(store.claim_run("owner", &run.id).unwrap().is_some());
            store
                .transition_run(
                    "owner",
                    &run.id,
                    RunStatus::Completed,
                    Some("Done".into()),
                    None,
                )
                .unwrap();
            assert!(store
                .transition_run("owner", &run.id, RunStatus::Failed, None, None)
                .unwrap_err()
                .starts_with("conflict:"));
            (conv.id, run.id)
        };
        let store = AgentHubStore::open(&path).unwrap();
        assert_eq!(
            store.run("owner", &run_id).unwrap().unwrap().status,
            RunStatus::Completed
        );
        let events = store.events("owner", &cid, 0, 10).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].kind, HubEventKind::Assistant);
        assert_eq!(events[1].seq, 2);
        assert_eq!(store.events("owner", &cid, 1, 1).unwrap().len(), 1);
        assert!(store.events("owner", &cid, u64::MAX, 1).unwrap().is_empty());
    }

    #[test]
    fn restart_fails_pending_and_running_without_replaying_them() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("hub.redb");
        let (cid, ids) = {
            let store = AgentHubStore::open(&path).unwrap();
            let agent = store.save_profile("owner", profile("Agent")).unwrap();
            let conv = conversation(
                &store,
                "owner",
                ConversationKind::Direct,
                vec![agent.id.clone()],
            );
            let pending = store
                .send(
                    "owner",
                    message(&conv.id, "pending", None, Some(agent.id.clone())),
                )
                .unwrap()
                .run
                .unwrap();
            let running = store
                .send("owner", message(&conv.id, "running", None, Some(agent.id)))
                .unwrap()
                .run
                .unwrap();
            store.claim_run("owner", &running.id).unwrap();
            (conv.id, vec![pending.id, running.id])
        };
        let store = AgentHubStore::open(&path).unwrap();
        for id in ids {
            assert_eq!(
                store.run("owner", &id).unwrap().unwrap().status,
                RunStatus::Failed
            );
        }
        assert_eq!(store.events("owner", &cid, 0, 10).unwrap().len(), 4);
        drop(store);
        let reopened = AgentHubStore::open(&path).unwrap();
        assert_eq!(reopened.events("owner", &cid, 0, 10).unwrap().len(), 4);
    }

    #[test]
    fn utf8_context_and_tool_grants_are_bounded_in_code() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("hub.redb")).unwrap();
        assert!(store.save_profile("owner", profile(" \n")).is_err());
        let agent = store.save_profile("owner", profile("Agent")).unwrap();
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Direct,
            vec![agent.id.clone()],
        );
        let mut request = message(&conv.id, "context", None, Some(agent.id));
        request.selected_context = vec!["é".repeat(4097)];
        assert!(store
            .send("owner", request.clone())
            .unwrap_err()
            .starts_with("too_large:"));
        request.selected_context = vec!["x".into(); 9];
        assert!(store
            .send("owner", request.clone())
            .unwrap_err()
            .starts_with("too_large:"));
        request.selected_context.clear();
        request.tool_grants.push("secret_get".into());
        assert!(store
            .send("owner", request)
            .unwrap_err()
            .starts_with("unsupported:"));
    }

    #[test]
    fn internal_envelopes_are_required_and_do_not_become_visible_chat() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("hub.redb")).unwrap();
        let a = store.save_profile("owner", profile("a")).unwrap();
        let b = store.save_profile("owner", profile("b")).unwrap();
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Group,
            vec![a.id.clone(), b.id.clone()],
        );
        let mut request = message(&conv.id, "typed", Some(a.id), Some(b.id));
        request.text = "conversational prose is not a protocol".into();
        assert!(store
            .send("owner", request.clone())
            .unwrap_err()
            .starts_with("invalid:"));
        assert!(store.events("owner", &conv.id, 0, 10).unwrap().is_empty());
        request.text = r#"{"v":1,"op":"task","data":[{"k":"goal","v":"answer"}],"refs":[]}"#.into();
        let receipt = store.send("owner", request).unwrap();
        assert_eq!(receipt.event.visibility, EventVisibility::Internal);
        let run = store
            .claim_run("owner", &receipt.run.unwrap().id)
            .unwrap()
            .unwrap();
        assert_eq!(store.source_event("owner", &run).unwrap(), receipt.event);
        assert!(store.source_event("other-owner", &run).is_err());
        assert!(store
            .transition_run(
                "owner",
                &run.id,
                RunStatus::Completed,
                Some("not JSON".into()),
                None
            )
            .is_err());
        assert_eq!(
            store.run("owner", &run.id).unwrap().unwrap().status,
            RunStatus::Running
        );
        store
            .transition_run(
                "owner",
                &run.id,
                RunStatus::Failed,
                None,
                Some("network: opaque-secret diagnostics".into()),
            )
            .unwrap();
        let events = store.audit_events("owner", &conv.id, 0, 10).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].visibility, EventVisibility::Internal);
        let failed = hub_protocol::parse_envelope(&events[1].text).unwrap();
        assert_eq!(
            failed.op,
            cybermanju_types::coordination::CoordinationOp::Blocked
        );
        assert!(!events[1].text.contains("opaque-secret"));
    }

    #[test]
    fn recipient_profile_snapshot_does_not_change_with_later_profile_edits() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("hub.redb")).unwrap();
        let agent = store.save_profile("owner", profile("original")).unwrap();
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Direct,
            vec![agent.id.clone()],
        );
        let run = store
            .send(
                "owner",
                message(&conv.id, "snapshot", None, Some(agent.id.clone())),
            )
            .unwrap()
            .run
            .unwrap();
        let mut update = profile("changed");
        update.id = Some(agent.id.clone());
        store.save_profile("owner", update).unwrap();
        let source = store.source_event("owner", &run).unwrap();
        let current = store.profile("owner", &agent.id).unwrap().unwrap();
        let projection = hub_protocol::project(&current, &run, &source, 32768).unwrap();
        let text = serde_json::to_string(&projection).unwrap();
        assert!(text.contains("original"));
        assert!(!text.contains("changed"));
        assert_eq!(source.visibility, EventVisibility::User);
    }

    #[test]
    fn public_transcript_skips_internal_assistants_but_retains_later_user_replies() {
        let dir = tempdir().unwrap();
        let store = AgentHubStore::open(dir.path().join("transcript.redb")).unwrap();
        let a = store.save_profile("owner", profile("a")).unwrap();
        let b = store.save_profile("owner", profile("b")).unwrap();
        let conv = conversation(
            &store,
            "owner",
            ConversationKind::Group,
            vec![a.id.clone(), b.id.clone()],
        );
        let internal = store
            .send(
                "owner",
                message(&conv.id, "internal", Some(a.id), Some(b.id.clone())),
            )
            .unwrap()
            .run
            .unwrap();
        store.claim_run("owner", &internal.id).unwrap().unwrap();
        store
            .transition_run(
                "owner",
                &internal.id,
                RunStatus::Completed,
                Some(
                    r#"{"v":1,"op":"result","data":[{"k":"answer","v":"internal"}],"refs":[]}"#
                        .into(),
                ),
                None,
            )
            .unwrap();
        let user = store
            .send("owner", message(&conv.id, "user", None, Some(b.id)))
            .unwrap()
            .run
            .unwrap();
        store.claim_run("owner", &user.id).unwrap().unwrap();
        store
            .transition_run(
                "owner",
                &user.id,
                RunStatus::Completed,
                Some("A natural-language user reply.".into()),
                None,
            )
            .unwrap();
        let first = store.events("owner", &conv.id, 0, 1).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].seq, 3);
        let second = store.events("owner", &conv.id, first[0].seq, 1).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].kind, HubEventKind::Assistant);
        assert_eq!(second[0].visibility, EventVisibility::User);
        assert_eq!(second[0].text, "A natural-language user reply.");
        assert_eq!(
            store.audit_events("owner", &conv.id, 0, 10).unwrap().len(),
            4
        );
    }

    #[test]
    fn legacy_rows_and_receipts_migrate_to_internal_without_kind_inference() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.redb");
        let (cid, request) = {
            let store = AgentHubStore::open(&path).unwrap();
            let agent = store.save_profile("owner", profile("Agent")).unwrap();
            let conv = conversation(&store, "owner", ConversationKind::Direct, vec![agent.id]);
            let request = message(&conv.id, "legacy", None, None);
            store.send("owner", request.clone()).unwrap();
            let tx = store.db.begin_write().unwrap();
            for definition in [EVENTS, IDEMPOTENCY] {
                let mut table = tx.open_table(definition).unwrap();
                let rows: Vec<_> = table
                    .iter()
                    .unwrap()
                    .map(|row| {
                        let (key, value) = row.unwrap();
                        (key.value().to_owned(), value.value().to_owned())
                    })
                    .collect();
                for (key, raw) in rows {
                    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
                    if let Some(record) = value.as_object_mut() {
                        record.remove("visibility");
                    } else {
                        value[1]["event"]
                            .as_object_mut()
                            .unwrap()
                            .remove("visibility");
                    }
                    let encoded = serde_json::to_string(&value).unwrap();
                    table.insert(key.as_str(), encoded.as_str()).unwrap();
                }
            }
            {
                let mut table = tx.open_table(SOURCES).unwrap();
                table.remove("__visibility_v2").unwrap();
                table.remove("__quarantine_v3").unwrap();
            }
            tx.commit().unwrap();
            (conv.id, request)
        };
        let store = AgentHubStore::open(&path).unwrap();
        assert!(store.events("owner", &cid, 0, 10).unwrap().is_empty());
        let event = store.audit_events("owner", &cid, 0, 10).unwrap().remove(0);
        assert_eq!(event.kind, HubEventKind::Message);
        assert_eq!(event.visibility, EventVisibility::Internal);
        assert_eq!(
            store.send("owner", request).unwrap().event.visibility,
            EventVisibility::Internal
        );
        let listing = store
            .quarantined_legacy_events("owner", &cid, 0, 10)
            .unwrap();
        assert_eq!(
            listing,
            vec![QuarantinedLegacyEvent {
                seq: 1,
                reason: LegacyQuarantineReason::MissingVisibility,
            }]
        );
        assert_eq!(
            serde_json::to_value(&listing).unwrap(),
            serde_json::json!([
                {"seq":1,"reason":"missingVisibility"}
            ])
        );
        assert!(store
            .quarantined_legacy_events("other-owner", &cid, 0, 10)
            .is_err());
        assert!(store
            .quarantined_legacy_events("owner|nested", &cid, 0, 10)
            .is_err());
        assert!(store
            .quarantined_legacy_events("owner", &cid, 1, 10)
            .unwrap()
            .is_empty());
        assert!(store
            .quarantined_legacy_events("owner", &cid, u64::MAX, 10)
            .unwrap()
            .is_empty());
        drop(store);
        let reopened = AgentHubStore::open(&path).unwrap();
        assert_eq!(
            reopened
                .quarantined_legacy_events("owner", &cid, 0, 10)
                .unwrap(),
            listing
        );
        assert!(reopened.events("owner", &cid, 0, 10).unwrap().is_empty());
    }

    #[test]
    fn v2_upgrade_lists_ambiguous_internal_candidates_without_kind_inference_or_replay() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v2.redb");
        let cid = {
            let store = AgentHubStore::open(&path).unwrap();
            let a = store.save_profile("owner", profile("a")).unwrap();
            let b = store.save_profile("owner", profile("b")).unwrap();
            let conv = conversation(
                &store,
                "owner",
                ConversationKind::Group,
                vec![a.id.clone(), b.id.clone()],
            );
            let run = store
                .send(
                    "owner",
                    message(&conv.id, "internal", Some(a.id), Some(b.id)),
                )
                .unwrap()
                .run
                .unwrap();
            store.claim_run("owner", &run.id).unwrap().unwrap();
            store.transition_run("owner", &run.id, RunStatus::Completed,
                Some(r#"{"v":1,"op":"result","data":[{"k":"answer","v":"private legacy content"}],"refs":[]}"#.into()), None).unwrap();
            store
                .send("owner", message(&conv.id, "visible", None, None))
                .unwrap();
            assert!(store
                .quarantined_legacy_events("owner", &conv.id, 0, 10)
                .unwrap()
                .is_empty());
            let tx = store.db.begin_write().unwrap();
            {
                let mut table = tx.open_table(SOURCES).unwrap();
                table.remove("__quarantine_v3").unwrap();
            }
            tx.commit().unwrap();
            conv.id
        };
        let store = AgentHubStore::open(&path).unwrap();
        let entries = store
            .quarantined_legacy_events("owner", &cid, 0, 500)
            .unwrap();
        assert_eq!(entries.len(), 2); // delegation AND assistant, never classified by kind
        assert!(entries
            .iter()
            .all(|e| e.reason == LegacyQuarantineReason::LegacyProvenanceUnavailable));
        assert_eq!(
            entries.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            store
                .quarantined_legacy_events("owner", &cid, 0, 0)
                .unwrap(),
            entries[..1]
        );
        assert_eq!(
            store
                .quarantined_legacy_events("owner", &cid, 1, 1)
                .unwrap(),
            entries[1..]
        );
        assert_eq!(store.events("owner", &cid, 0, 10).unwrap().len(), 1);
        assert_eq!(store.audit_events("owner", &cid, 0, 10).unwrap().len(), 3);
        // New explicit internal records after upgrade are not legacy candidates.
        let members = store.conversations("owner").unwrap().remove(0).members;
        let run = store
            .send(
                "owner",
                message(
                    &cid,
                    "new-internal",
                    Some(members[0].clone()),
                    Some(members[1].clone()),
                ),
            )
            .unwrap()
            .run
            .unwrap();
        store.claim_run("owner", &run.id).unwrap().unwrap();
        store
            .transition_run("owner", &run.id, RunStatus::Failed, None, None)
            .unwrap();
        drop(store);
        let reopened = AgentHubStore::open(&path).unwrap();
        assert_eq!(
            reopened
                .quarantined_legacy_events("owner", &cid, 0, 10)
                .unwrap(),
            entries
        );
        assert_eq!(
            reopened.audit_events("owner", &cid, 0, 10).unwrap().len(),
            5
        );
        assert_eq!(reopened.events("owner", &cid, 0, 10).unwrap().len(), 1);
    }
}
