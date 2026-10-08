// CyberManju OS — native AI agent runtime (shared by Tauri IPC and REST)
//
// Configs (keyless rows, sealed keys) → sessions (transcripts) → detached
// jobs (`prompt_async` → 202-style job, poll `jobs/{id}`) with ask-approval
// parking, abort, and per-call permission decisions. Tool execution runs
// against the host filesystem under the config working root (contained,
// audited). The pure loop math (providers, permissions, protocol, anchored
// edits) lives in `cybermanju-agent`; this module owns threads, locks and
// the database.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use cybermanju_agent::{
    agent_loop, config as agent_config, edit as agent_edit, memory as agent_memory, protocol,
    providers,
};
use cybermanju_db::Database;
use cybermanju_types::agent::{
    AgentConfig, AgentKind, AgentMemory, AgentSession, ChatMessage, LlmDialect, McpServerConfig,
    MemoryHit, MemoryOrigin, TokenUsage, ToolCall,
};
use redb::ReadableTable;
use serde::{Deserialize, Serialize};

// ─── tunables ────────────────────────────────────────────────────────────

/// How long an `ask` waits for the UI before auto-denying.
const APPROVAL_TIMEOUT_SECS: u64 = 600;
/// Single tool output cap (the model drowns past this).
const TOOL_OUTPUT_CAP: usize = 65_536;
/// Read/write/edit size cap (mirrors the editor).
const MAX_TOOL_BYTES: usize = 1024 * 1024;
/// Grep bounds.
const MAX_GREP_MATCHES: usize = 50;
const MAX_GREP_FILES: usize = 500;
/// Directory listing cap.
const MAX_LIST_ENTRIES: usize = 200;
/// Repo-overview cap for the system prompt.
const OVERVIEW_CAP: usize = 200;
/// Nested `task` runs get a short leash.
const SUBAGENT_MAX_TURNS: u32 = 5;
/// Denial sent when the model repeats one exact tool call.
const DOOM_LOOP_DENIAL: &str =
    "denied: identical tool call repeated 3 times (doom-loop guard) — vary the input or explain";

// ─── wire types ──────────────────────────────────────────────────────────

/// One parked approval (or question) awaiting the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub tool: String,
    pub input: serde_json::Value,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}

/// Pollable job snapshot (202-style lifecycle, like sync jobs).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub job_id: String,
    pub session_id: String,
    pub config_id: String,
    pub status: String,
    pub turns_used: u32,
    pub max_turns: u32,
    pub usage: TokenUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<PendingApproval>,
    /// What the worker is doing right now (`thinking · gpt-5`,
    /// `read src/lib.rs`) — polled by the UI so a running job is never a
    /// frozen status line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    /// Terminal-state nudge: the run was long enough to have learned
    /// something but stored no memory — the UI offers a one-tap REMEMBER.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_hint: Option<String>,
}

// ─── secrets (never serialized) ──────────────────────────────────────────

fn agent_key_name(config_id: &str) -> String {
    format!("agent:key:{config_id}")
}

fn load_key(db: &Database, config_id: &str) -> Result<String, String> {
    crate::security::validate_id(config_id)?;
    Ok(db
        .get_sync_secret(&agent_key_name(config_id))
        .map_err(|e| e.to_string())?
        .unwrap_or_default())
}

// ─── config CRUD ─────────────────────────────────────────────────────────

fn with_has_key(db: &Database, mut config: AgentConfig) -> Result<AgentConfig, String> {
    let key = db
        .get_sync_secret(&agent_key_name(&config.id))
        .map_err(|e| e.to_string())?;
    config.has_key = key.as_ref().map(|k| !k.is_empty()).unwrap_or(false);
    Ok(config)
}

/// List all agent configs (keys never included — `hasKey` only).
pub fn list_configs(db: &Database) -> Result<Vec<AgentConfig>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_agent_configs_table())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let config: AgentConfig = serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        out.push(with_has_key(db, config)?);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Load one config by id.
pub fn get_config(db: &Database, config_id: &str) -> Result<AgentConfig, String> {
    crate::security::validate_id(config_id)?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_agent_configs_table())
        .map_err(|e| e.to_string())?;
    let value = table
        .get(config_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent config not found: {}", config_id))?;
    let config: AgentConfig = serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
    with_has_key(db, config)
}

fn validate_config(config: &AgentConfig) -> Result<(), String> {
    if config.name.trim().is_empty() {
        return Err("invalid: name is required".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("invalid: model is required".to_string());
    }
    if config.working_dir.contains("..") {
        return Err("invalid: working_dir must not contain '..'".to_string());
    }
    for (name, server) in &config.mcp_servers {
        if !mcp_proto::valid_server_name(name) {
            return Err(format!("invalid: bad MCP server name '{name}'"));
        }
        server.validate()?;
    }
    // Merges endpoint + dialect; fails on unknown providers and keyless
    // custom configs alike.
    providers::resolve(config)?;
    Ok(())
}

/// Fallback-route validation (save path): ids must exist, must not point at
/// the config itself, no repeats, and the chain stays within
/// `MAX_FAILOVER_ROUTES`. Unknown ids are 4xx here, not runs that fail over
/// onto nothing.
fn validate_fallback_routes(db: &Database, config: &AgentConfig) -> Result<(), String> {
    use cybermanju_agent::config::MAX_FAILOVER_ROUTES;
    if config.fallback_ids.len() > MAX_FAILOVER_ROUTES - 1 {
        return Err(format!(
            "invalid: at most {} fallback assistants (primary + {} routes max)",
            MAX_FAILOVER_ROUTES - 1,
            MAX_FAILOVER_ROUTES
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for id in &config.fallback_ids {
        if id.trim().is_empty() {
            return Err("invalid: fallback id is empty".to_string());
        }
        if id == &config.id {
            return Err("invalid: an assistant cannot fall back onto itself".to_string());
        }
        if !seen.insert(id.clone()) {
            return Err(format!("invalid: duplicate fallback '{id}'"));
        }
        get_config(db, id)
            .map_err(|_| format!("invalid: fallback assistant not found: '{id}'"))?;
    }
    Ok(())
}

/// A route can serve a run when its endpoint resolves and it either needs
/// no key (keyless runtimes like Ollama) or has one sealed.
fn route_usable(db: &Database, config: &AgentConfig) -> bool {
    let endpoint = match providers::resolve(config) {
        Ok(e) => e,
        Err(_) => return false,
    };
    if endpoint.keyless {
        return true;
    }
    load_key(db, &config.id)
        .map(|k| !k.is_empty())
        .unwrap_or(false)
}

/// P0-8: does this config need an admin to save it?
///
/// Returns the reason when privileged material is present:
/// * `mcp_servers` beyond the keyless default `exa` entry (stdio entries
///   spawn processes — same reason `POST/DELETE .../mcp` is admin-gated),
/// * `auto_approve: true` (unattended `ask` → unattended `tool_bash`),
/// * a broad `bash` allow (simple `allow`, or a granular catch-all `*`
///   allow — the shipped default of scoped `curl *`/`wget *` allows plus a
///   `*` ask stays non-admin).
pub fn config_needs_admin(config: &AgentConfig) -> Option<&'static str> {
    use cybermanju_types::agent::{PermissionAction, PermissionRule};
    for (name, server) in &config.mcp_servers {
        if name != cybermanju_types::agent::DEFAULT_EXA_MCP_NAME {
            return Some("mcp_servers: attaching non-default MCP servers needs admin");
        }
        // Even the default name re-declared as stdio is a process spawn.
        if server.transport == "stdio" {
            return Some("mcp_servers: stdio MCP servers spawn processes and need admin");
        }
    }
    if config.auto_approve {
        return Some("auto_approve: unattended approvals need admin");
    }
    match config.permission.rules.get("bash") {
        Some(PermissionRule::Simple(PermissionAction::Allow)) => {
            return Some("bash: blanket allow needs admin");
        }
        Some(PermissionRule::Granular(pairs)) => {
            for (pattern, action) in pairs {
                if *action == PermissionAction::Allow && (pattern == "*" || pattern.trim() == "*") {
                    return Some("bash: catch-all allow needs admin");
                }
            }
        }
        _ => {}
    }
    None
}

/// Create or overwrite a config, enforcing the P0-8 admin gate.
///
/// `is_admin` must come from the caller's JWT claims on the REST path
/// (non-admin callers get `auth:` when the config carries `mcp_servers` /
/// `auto_approve` / broad `bash` allow). The trusted local path (Tauri IPC)
/// passes `true`, mirroring `RegistrationMode::LocalIpc`.
pub fn save_config_as(
    db: &Database,
    mut config: AgentConfig,
    is_admin: bool,
) -> Result<AgentConfig, String> {
    if !is_admin {
        if let Some(reason) = config_needs_admin(&config) {
            return Err(format!("auth: {reason}"));
        }
    }
    save_config_unchecked(db, &mut config)
}

/// Create or overwrite a config. The row never holds key material.
///
/// Trusted-local entry point (Tauri IPC): no admin gate — the desktop
/// process is the trust boundary, like `RegistrationMode::LocalIpc`.
/// REST callers must use [`save_config_as`] with the claims role instead.
pub fn save_config(db: &Database, mut config: AgentConfig) -> Result<AgentConfig, String> {
    save_config_unchecked(db, &mut config)
}

/// Validated + persisted config write shared by [`save_config`] and
/// [`save_config_as`].
fn save_config_unchecked(db: &Database, config: &mut AgentConfig) -> Result<AgentConfig, String> {
    if config.id.is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    crate::security::validate_id(&config.id)?;
    // Defaults first: every config ships the keyless Exa search MCP plus
    // allow-rules for `curl`/`wget` and the Exa tools. Explicit user
    // entries always win (`ensure_*` only fills gaps).
    cybermanju_types::agent::ensure_default_mcp_servers(&mut config.mcp_servers);
    cybermanju_types::agent::ensure_default_agent_permissions(&mut config.permission);
    validate_config(config)?;
    validate_fallback_routes(db, config)?;
    config.max_turns = config.max_turns.clamp(1, agent_loop::MAX_TURNS_HARD_CAP);
    let now = chrono::Utc::now().to_rfc3339();
    if config.created_at.is_empty() {
        // Preserve the original timestamp on updates.
        let keep = db
            .begin_read()
            .ok()
            .and_then(|tx| tx.open_table(Database::get_agent_configs_table()).ok())
            .and_then(|table| table.get(config.id.as_str()).ok().flatten())
            .and_then(|v| serde_json::from_str::<AgentConfig>(v.value()).ok())
            .map(|old| old.created_at)
            .unwrap_or_default();
        config.created_at = if keep.is_empty() { now.clone() } else { keep };
    }
    config.updated_at = now;
    config.has_key = false; // computed on read; never persisted as true
    let serialized = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_configs_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(config.id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    with_has_key(db, config.clone())
}

/// Delete a config and its sealed key.
pub fn delete_config(db: &Database, config_id: &str) -> Result<bool, String> {
    crate::security::validate_id(config_id)?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_configs_table())
            .map_err(|e| e.to_string())?;
        let removed = table
            .remove(config_id)
            .map_err(|e| e.to_string())?
            .is_some();
        if !removed {
            return Err(format!("Agent config not found: {}", config_id));
        }
        let mut secrets = tx
            .open_table(Database::get_sync_secrets_table())
            .map_err(|e| e.to_string())?;
        let _ = secrets
            .remove(agent_key_name(config_id).as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Store (seal) a provider key. Empty keys are rejected — clearing happens
/// via config delete. 4 KiB cap keeps accidental pastes sane.
pub fn save_key(db: &Database, config_id: &str, api_key: &str) -> Result<bool, String> {
    crate::security::validate_id(config_id)?;
    get_config(db, config_id)?; // 404 on unknown configs
    if api_key.trim().is_empty() {
        return Err("invalid: apiKey is required".to_string());
    }
    if api_key.len() > 4096 {
        return Err("invalid: apiKey looks pasted-wrong (over 4 KiB)".to_string());
    }
    db.put_sync_secret(&agent_key_name(config_id), api_key.trim())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Refresh the model list from the provider (OpenAI dialect only —
/// Anthropic has no list API, answered honestly as `unsupported:`).
pub fn list_models(db: &Database, config_id: &str) -> Result<Vec<String>, String> {
    let config = get_config(db, config_id)?;
    let endpoint = providers::resolve(&config)?;
    let models_url =
        providers::models_url(&endpoint.base_url, endpoint.dialect).ok_or_else(|| {
            format!(
                "unsupported: provider '{}' has no models endpoint — enter the model id manually",
                config.provider_id
            )
        })?;
    let key = load_key(db, config_id)?;
    let headers = endpoint_headers(&endpoint, &key);
    let body = protocol::get_json(&models_url, &headers)?;
    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        let mut models: Vec<String> = data
            .iter()
            .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(str::to_string))
            .collect();
        models.sort();
        models.dedup();
        return Ok(models);
    }
    Err("integrity: provider models reply had no data[]".to_string())
}

// ─── sessions ────────────────────────────────────────────────────────────

fn save_session_row(db: &Database, session: &AgentSession) -> Result<(), String> {
    let serialized = serde_json::to_string(session).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_sessions_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(session.id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Newest-first session list (capped — transcripts can be large).
/// Trusted-local entry point (Tauri IPC, cybsh): no owner filter.
pub fn list_sessions(db: &Database) -> Result<Vec<AgentSession>, String> {
    list_sessions_for(db, "", true)
}

/// Owner-bound session list for the REST transport: callers see their own
/// transcripts plus unowned legacy rows; admins see everything. Transcripts
/// can hold secrets and file contents, so they are never world-readable.
pub fn list_sessions_for(
    db: &Database,
    requester: &str,
    is_admin: bool,
) -> Result<Vec<AgentSession>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_agent_sessions_table())
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let session: AgentSession =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if requester.is_empty()
            || is_admin
            || session.owner_id.is_empty()
            || session.owner_id == requester
        {
            rows.push(session);
        }
    }
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    rows.truncate(100);
    Ok(rows)
}

/// Ownership check shared by the per-session entry points. Empty requester
/// means the trusted local path (allowed through like an admin); legacy rows
/// without an owner stay readable so old transcripts never vanish.
fn check_session_owner(
    session: &AgentSession,
    requester: &str,
    is_admin: bool,
) -> Result<(), String> {
    if requester.is_empty()
        || is_admin
        || session.owner_id.is_empty()
        || session.owner_id == requester
    {
        return Ok(());
    }
    Err("auth: agent session belongs to another user".to_string())
}

/// Load one session (export-compatible JSON).
/// Trusted-local entry point (Tauri IPC, workers, cybsh): no owner check.
pub fn get_session(db: &Database, session_id: &str) -> Result<AgentSession, String> {
    crate::security::validate_id(session_id)?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_agent_sessions_table())
        .map_err(|e| e.to_string())?;
    let value = table
        .get(session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
    serde_json::from_str(value.value()).map_err(|e| e.to_string())
}

/// Owner-bound session load for the REST transport.
pub fn get_session_for(
    db: &Database,
    session_id: &str,
    requester: &str,
    is_admin: bool,
) -> Result<AgentSession, String> {
    let session = get_session(db, session_id)?;
    check_session_owner(&session, requester, is_admin)?;
    Ok(session)
}

/// Delete a session and its transcript.
/// Trusted-local entry point (Tauri IPC): no owner check.
pub fn delete_session(db: &Database, session_id: &str) -> Result<bool, String> {
    crate::security::validate_id(session_id)?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_sessions_table())
            .map_err(|e| e.to_string())?;
        let removed = table
            .remove(session_id)
            .map_err(|e| e.to_string())?
            .is_some();
        if !removed {
            return Err(format!("Agent session not found: {}", session_id));
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Owner-bound session delete for the REST transport.
pub fn delete_session_for(
    db: &Database,
    session_id: &str,
    requester: &str,
    is_admin: bool,
) -> Result<bool, String> {
    get_session_for(db, session_id, requester, is_admin)?;
    delete_session(db, session_id)
}

/// Create a session bound to a config snapshot.
/// Trusted-local entry point (Tauri IPC): owned by `"local"`.
pub fn create_session(
    db: &Database,
    config_id: &str,
    title: Option<String>,
) -> Result<AgentSession, String> {
    create_session_as(db, config_id, title, "local")
}

/// Owner-bound session create: the transcript is attributed at birth.
pub fn create_session_as(
    db: &Database,
    config_id: &str,
    title: Option<String>,
    owner: &str,
) -> Result<AgentSession, String> {
    let config = get_config(db, config_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let session = AgentSession {
        id: uuid::Uuid::new_v4().to_string(),
        title: title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Untitled session".to_string()),
        config_id: config.id.clone(),
        provider_id: config.provider_id.clone(),
        model: config.model.clone(),
        agent_kind: config.agent_kind,
        working_dir: config.working_dir.clone(),
        messages: Vec::new(),
        usage: TokenUsage::default(),
        created_at: now.clone(),
        updated_at: now,
        owner_id: owner.to_string(),
    };
    save_session_row(db, &session)?;
    Ok(session)
}

/// Import a session transcript (always re-keyed — never trust a client id).
/// Trusted-local entry point (Tauri IPC): owned by `"local"`.
pub fn import_session(db: &Database, session: AgentSession) -> Result<AgentSession, String> {
    import_session_as(db, session, "local")
}

/// Owner-bound session import: id and owner are both server-assigned.
pub fn import_session_as(
    db: &Database,
    mut session: AgentSession,
    owner: &str,
) -> Result<AgentSession, String> {
    if session.messages.len() > 2000 {
        return Err("invalid: session transcript is too large".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    session.id = uuid::Uuid::new_v4().to_string();
    session.owner_id = owner.to_string();
    session.updated_at = now.clone();
    if session.created_at.is_empty() {
        session.created_at = now;
    }
    save_session_row(db, &session)?;
    Ok(session)
}

// ─── semantic memory ─────────────────────────────────────────────────────
// Long-term memory: curated text + embedding vectors in `agent_memories`
// (redb, same DB file as sessions). Recall is hybrid — vector cosine when
// comparable, keyword overlap otherwise — and always char-budgeted, so
// memory augments the prompt instead of becoming it (Hermes
// `memory_char_limit` parity: 2200). Memory must never break a run: every
// failure mode degrades to keyword recall or an empty block.

/// Default embedding model when the config sets none (OpenAI + Ollama
/// `-embed` models serve `{base}/embeddings`).
const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";

fn embedding_model(config: &AgentConfig) -> String {
    config
        .embedding_model
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_EMBEDDING_MODEL.to_string())
}

/// One OpenAI-compatible embedding call. Anthropic has no embeddings API —
/// honest `unsupported:` (callers fall back to keyword recall, never fail).
fn embed_text(
    cancel: &AtomicBool,
    endpoint: &providers::ResolvedEndpoint,
    api_key: &str,
    model: &str,
    text: &str,
) -> Result<Vec<f32>, String> {
    if endpoint.dialect != LlmDialect::OpenAi {
        return Err(
            "unsupported: this provider dialect has no embeddings API — keyword recall applies"
                .to_string(),
        );
    }
    let url = format!("{}/embeddings", endpoint.base_url.trim_end_matches('/'));
    let headers = endpoint_headers(endpoint, api_key);
    let body = serde_json::json!({ "model": model, "input": text });
    let reply = post_with_retry(cancel, &url, &headers, &body)?;
    let arr = reply
        .get("data")
        .and_then(|d| d.get(0))
        .and_then(|e| e.get("embedding"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "network: unreadable embeddings reply".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for n in arr {
        let f = n
            .as_f64()
            .ok_or_else(|| "network: non-numeric embedding value".to_string())?;
        if !f.is_finite() {
            return Err("network: non-finite embedding value".to_string());
        }
        out.push(f as f32);
    }
    if out.is_empty() {
        return Err("network: empty embedding vector".to_string());
    }
    Ok(out)
}

pub fn save_memory_row(db: &Database, memory: &AgentMemory) -> Result<(), String> {
    let serialized = serde_json::to_string(memory).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_memories_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(memory.id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Newest-first memory list, optionally scoped to one config. Vectors are
/// stripped unless `include_vectors` — list views never ship megabytes of
/// floats; export/sync restores do.
pub fn list_memories(
    db: &Database,
    config_id: Option<&str>,
    include_vectors: bool,
) -> Result<Vec<AgentMemory>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_agent_memories_table())
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let mut m: AgentMemory = serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if let Some(want) = config_id {
            if m.config_id != want {
                continue;
            }
        }
        if !include_vectors {
            m.embedding = Vec::new();
            m.dims = 0;
        }
        rows.push(m);
    }
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    rows.truncate(agent_memory::MEMORY_LIST_LIMIT);
    Ok(rows)
}

/// Delete one memory by id.
pub fn delete_memory(db: &Database, memory_id: &str) -> Result<bool, String> {
    crate::security::validate_id(memory_id)?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_memories_table())
            .map_err(|e| e.to_string())?;
        let removed = table
            .remove(memory_id)
            .map_err(|e| e.to_string())?
            .is_some();
        if !removed {
            return Err(format!("Agent memory not found: {memory_id}"));
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Sanitize + embed one text into an unsaved row. Holds NO lock — the caller
/// saves with `save_memory_row` under a brief transaction, so the provider
/// round trip never stalls concurrent writers. Embedding failure stores the
/// row vectorless (keyword recall still finds it); only cancellation and
/// empty-after-cleaning fail.
#[allow(clippy::too_many_arguments)]
pub fn prepare_memory(
    cancel: &AtomicBool,
    endpoint: &providers::ResolvedEndpoint,
    api_key: &str,
    config_id: &str,
    session_id: Option<String>,
    text: &str,
    origin: MemoryOrigin,
    embedding_model: &str,
) -> Result<AgentMemory, String> {
    if config_id.trim().is_empty() {
        return Err("invalid: config_id is required".to_string());
    }
    let (cleaned, _) = agent_memory::sanitize_text(text);
    if cleaned.is_empty() {
        return Err("invalid: nothing memorable after cleaning".to_string());
    }
    let embedding = match embed_text(cancel, endpoint, api_key, embedding_model, &cleaned) {
        Ok(v) => v,
        Err(e) if e == "cancelled" => return Err(e),
        Err(_) => Vec::new(),
    };
    let now = chrono::Utc::now().to_rfc3339();
    Ok(AgentMemory {
        id: uuid::Uuid::new_v4().to_string(),
        config_id: config_id.to_string(),
        text: cleaned,
        dims: embedding.len() as u32,
        embedding,
        origin,
        session_id,
        uses: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Route-level store: brief read for config + key, embed off-lock, brief
/// write for the row. Never holds the request lock across provider I/O.
pub fn store_memory_entry(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    session_id: Option<String>,
    text: &str,
) -> Result<AgentMemory, String> {
    let (config, key) = {
        let guard = db.read().map_err(|e| e.to_string())?;
        (get_config(&guard, config_id)?, load_key(&guard, config_id)?)
    };
    let endpoint = providers::resolve(&config)?;
    let cancel = AtomicBool::new(false);
    let model = embedding_model(&config);
    let memory = prepare_memory(
        &cancel,
        &endpoint,
        &key,
        &config.id,
        session_id,
        text,
        MemoryOrigin::Remember,
        &model,
    )?;
    {
        let guard = db.read().map_err(|e| e.to_string())?;
        save_memory_row(&guard, &memory)?;
    }
    Ok(memory)
}

/// Count one served recall per hit (feeds the uses-tiebreak so memory that
/// proved useful ranks first). Best effort — recall results never depend on
/// the counter landing.
fn bump_memory_uses(db: &Database, ids: &[String]) -> Result<(), String> {
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_agent_memories_table())
            .map_err(|e| e.to_string())?;
        for id in ids {
            let current: Option<String> = table
                .get(id.as_str())
                .map_err(|e| e.to_string())?
                .map(|guard| guard.value().to_string());
            if let Some(raw) = current {
                let mut m: AgentMemory = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                m.uses = m.uses.saturating_add(1);
                let serialized = serde_json::to_string(&m).map_err(|e| e.to_string())?;
                table
                    .insert(id.as_str(), serialized.as_str())
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Vector-first recall with keyword fallback, over one config's memories.
/// Embedding failure degrades to keywords — recall answers from what the
/// store has, never from a failed provider call.
#[allow(clippy::too_many_arguments)]
pub fn recall_text(
    db: &Database,
    cancel: &AtomicBool,
    endpoint: &providers::ResolvedEndpoint,
    api_key: &str,
    config_id: &str,
    query: &str,
    top_k: usize,
    embedding_model: &str,
) -> Vec<MemoryHit> {
    let memories = list_memories(db, Some(config_id), true).unwrap_or_default();
    if memories.is_empty() {
        return Vec::new();
    }
    let query_vec = embed_text(cancel, endpoint, api_key, embedding_model, query).ok();
    let hits = agent_memory::recall_rank(query_vec.as_deref(), query, &memories, top_k);
    if !hits.is_empty() {
        let ids: Vec<String> = hits.iter().map(|h| h.id.clone()).collect();
        let _ = bump_memory_uses(db, &ids);
    }
    hits
}

/// Route-level recall: config-scoped vector recall when `config_id` is set,
/// keyword-only global search otherwise. Brief reads only — the one
/// embeddings call holds no lock.
pub fn recall_memory_entries(
    db: &Arc<RwLock<Database>>,
    config_id: Option<&str>,
    query: &str,
    top_k: usize,
) -> Result<Vec<MemoryHit>, String> {
    if query.trim().is_empty() {
        return Err("invalid: query is required".to_string());
    }
    let Some(config_id) = config_id else {
        let guard = db.read().map_err(|e| e.to_string())?;
        let memories = list_memories(&guard, None, true)?;
        return Ok(agent_memory::recall_rank(None, query, &memories, top_k));
    };
    let (config, key) = {
        let guard = db.read().map_err(|e| e.to_string())?;
        (get_config(&guard, config_id)?, load_key(&guard, config_id)?)
    };
    let endpoint = providers::resolve(&config)?;
    let cancel = AtomicBool::new(false);
    let model = embedding_model(&config);
    let guard = db.read().map_err(|e| e.to_string())?;
    Ok(recall_text(
        &guard, &cancel, &endpoint, &key, &config.id, query, top_k, &model,
    ))
}

/// Pre-prompt auto-recall: the user prompt seeds a bounded
/// `<recalled-memories>` block. Empty store or failed embedding → "" and the
/// run continues with the transcript alone — memory augments, never blocks.
fn recall_block_for_run(
    db: &Arc<RwLock<Database>>,
    endpoint: &providers::ResolvedEndpoint,
    api_key: &str,
    config: &AgentConfig,
    prompt: &str,
    cancel: &AtomicBool,
) -> String {
    if prompt.trim().is_empty() {
        return String::new();
    }
    let model = embedding_model(config);
    let memories = match db.read() {
        Ok(guard) => list_memories(&guard, Some(&config.id), true).unwrap_or_default(),
        Err(_) => return String::new(),
    };
    if memories.is_empty() {
        return String::new();
    }
    let query_vec = embed_text(cancel, endpoint, api_key, &model, prompt).ok();
    let hits = agent_memory::recall_rank(
        query_vec.as_deref(),
        prompt,
        &memories,
        agent_memory::MEMORY_TOP_K,
    );
    if hits.is_empty() {
        return String::new();
    }
    let ids: Vec<String> = hits.iter().map(|h| h.id.clone()).collect();
    if let Ok(guard) = db.read() {
        let _ = bump_memory_uses(&guard, &ids);
    }
    agent_memory::render_recall_block(&hits, agent_memory::MEMORY_RECALL_BUDGET_CHARS)
}

/// Did this run store any memory (tool call present in the transcript)?
fn remembered_in_run(turn: &agent_loop::AgentTurn) -> bool {
    turn.messages.iter().any(|m| {
        if m.tool_name.as_deref() == Some("memory_remember") {
            return true;
        }
        m.tool_input
            .as_ref()
            .and_then(|v| v.as_array())
            .map(|calls| {
                calls
                    .iter()
                    .any(|c| c.get("name").and_then(|n| n.as_str()) == Some("memory_remember"))
            })
            .unwrap_or(false)
    })
}

// ─── job registry ────────────────────────────────────────────────────────

struct JobState {
    status: String,
    turns_used: u32,
    max_turns: u32,
    usage: TokenUsage,
    result: Option<String>,
    error: Option<String>,
    pending: Option<PendingApproval>,
    activity: Option<String>,
    /// Hermes-style nudge, set once at terminal states: a long run that
    /// stored nothing earns one "teach me" hint. Never mid-run nagging.
    memory_hint: Option<String>,
}

pub struct AgentJob {
    pub job_id: String,
    pub session_id: String,
    pub config_id: String,
    pub started_at: String,
    /// JWT `user_id` that started the job (`"local"` on the trusted Tauri
    /// path, which has no JWT). Never serialized — `JobSnapshot` carries no
    /// owner, and every status/abort/approve entry point checks it.
    pub owner_id: String,
    state: Mutex<JobState>,
    cancel: AtomicBool,
}

#[derive(Debug, Clone)]
struct ApprovalAnswer {
    approved: bool,
    answer: Option<String>,
}

static JOBS: OnceLock<Mutex<HashMap<String, Arc<AgentJob>>>> = OnceLock::new();
static APPROVALS: OnceLock<Mutex<HashMap<String, ApprovalAnswer>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, Arc<AgentJob>>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn approvals() -> &'static Mutex<HashMap<String, ApprovalAnswer>> {
    APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Ownership check shared by every per-job entry point (P0-10).
/// `requester` empty means the trusted local path (Tauri IPC, cybsh
/// scheduler helpers) — allowed through like an admin. Otherwise the caller
/// must own the job or hold `admin`.
fn check_job_owner(job: &AgentJob, requester: &str, is_admin: bool) -> Result<(), String> {
    if requester.is_empty() || is_admin || job.owner_id == requester {
        return Ok(());
    }
    Err("auth: agent job belongs to another user".to_string())
}

fn snapshot(job: &AgentJob) -> JobSnapshot {
    let state = job.state.lock().unwrap_or_else(|p| p.into_inner());
    JobSnapshot {
        job_id: job.job_id.clone(),
        session_id: job.session_id.clone(),
        config_id: job.config_id.clone(),
        status: state.status.clone(),
        turns_used: state.turns_used,
        max_turns: state.max_turns,
        usage: state.usage.clone(),
        result: state.result.clone(),
        error: state.error.clone(),
        pending: state.pending.clone(),
        activity: state.activity.clone(),
        memory_hint: state.memory_hint.clone(),
    }
}

fn set_state(job: &AgentJob, f: impl FnOnce(&mut JobState)) {
    match job.state.lock() {
        Ok(mut state) => f(&mut state),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

/// Headers for a chat call from a resolved endpoint. Mirrors
/// `protocol::auth_headers` without needing a catalog preset (custom
/// providers have none).
fn endpoint_headers(
    endpoint: &providers::ResolvedEndpoint,
    api_key: &str,
) -> Vec<(String, String)> {
    use cybermanju_types::agent::AuthScheme;
    let mut headers = endpoint.extra_headers.clone();
    match endpoint.auth {
        AuthScheme::Bearer => {
            if !api_key.is_empty() {
                headers.push(("Authorization".into(), format!("Bearer {api_key}")));
            }
        }
        AuthScheme::Header => {
            let name = endpoint
                .auth_name
                .clone()
                .unwrap_or_else(|| "x-api-key".into());
            headers.push((name, api_key.to_string()));
        }
        AuthScheme::Query | AuthScheme::None => {}
    }
    headers.push(("Content-Type".into(), "application/json".into()));
    headers
}

/// The host directory tools run against: volume root + config working dir.
fn working_root(config: &AgentConfig) -> Result<PathBuf, String> {
    let vol = cybermanju_os::api::Kernel::global().root().to_path_buf();
    let w = config.working_dir.trim().trim_matches('/');
    if w.is_empty() {
        return Ok(vol);
    }
    Ok(vol.join(w))
}

/// Lexically normalize path parts (no symlink resolution — documented).
fn normalize_join(base: &Path, user: &str) -> PathBuf {
    let mut out = base.to_path_buf();
    for part in user.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            out.pop();
            continue;
        }
        out.push(part);
    }
    out
}

/// Join a tool path onto a root, refusing escapes. Leading `/` means the
/// volume root (cybsh convention); anything else is working-dir-relative.
fn join_contained(root: &Path, vol: &Path, user: &str) -> Result<PathBuf, String> {
    let trimmed = user.trim();
    if trimmed.is_empty() {
        return Err("invalid: empty path".to_string());
    }
    // Leading `/` addresses the volume root (cybsh convention), anything
    // else is working-dir-relative. Either way the result must stay inside
    // the volume; relative paths must additionally stay inside the root.
    let absolute = trimmed.starts_with('/');
    let path = normalize_join(if absolute { vol } else { root }, trimmed);
    if path != *vol && !path.starts_with(vol) {
        return Err("deny: path escapes the volume".to_string());
    }
    if !absolute && path != *root && !path.starts_with(root) {
        return Err("deny: path escapes the working root".to_string());
    }
    Ok(path)
}

fn volume_root() -> PathBuf {
    cybermanju_os::api::Kernel::global().root().to_path_buf()
}

// ─── tool executors (native) ─────────────────────────────────────────────

/// File bytes only — what `edit` hashes and what `write` overwrites.
fn read_raw(root: &Path, vol: &Path, path: &str) -> Result<String, String> {
    let full = join_contained(root, vol, path)?;
    let bytes =
        std::fs::read(&full).map_err(|_| format!("not_found: '{}' does not exist", path.trim()))?;
    if bytes.len() > MAX_TOOL_BYTES {
        return Err(format!(
            "too_large: '{}' is {} bytes, tool limit is {}",
            path.trim(),
            bytes.len(),
            MAX_TOOL_BYTES
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| format!("binary: '{}' is not valid UTF-8 text", path.trim()))
}

/// What the model sees: the file plus a `[blake3:<hex>]` trailer it can hand
/// back as `expected_hash`. Without it the anchor could never be obtained —
/// `write`/`edit` only print a hash for bytes they just wrote.
fn tool_read(root: &Path, vol: &Path, path: &str) -> Result<String, String> {
    let raw = read_raw(root, vol, path)?;
    let hash = agent_edit::blake3_hex(raw.as_bytes());
    Ok(format!("{raw}{}", agent_edit::anchor_line(&hash)))
}

fn tool_list(root: &Path, vol: &Path, path: &str) -> Result<String, String> {
    let dir = if path.trim().is_empty() || path.trim() == "/" {
        if path.trim().starts_with('/') {
            vol.to_path_buf()
        } else {
            root.to_path_buf()
        }
    } else {
        join_contained(root, vol, path)?
    };
    let entries = std::fs::read_dir(&dir)
        .map_err(|_| format!("not_found: '{}' is not a directory", path.trim()))?;
    let mut names = Vec::new();
    for entry in entries.flatten().take(MAX_LIST_ENTRIES + 1) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let suffix = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            "/"
        } else {
            ""
        };
        names.push(format!("{name}{suffix}"));
    }
    names.sort();
    let mut out = names
        .into_iter()
        .take(MAX_LIST_ENTRIES)
        .collect::<Vec<_>>()
        .join("\n");
    if out.is_empty() {
        out.push_str("(empty directory)");
    }
    Ok(out)
}

fn tool_grep(
    root: &Path,
    vol: &Path,
    pattern: &str,
    sub: &str,
    limit: usize,
) -> Result<String, String> {
    if pattern.is_empty() {
        return Err("invalid: pattern is required".to_string());
    }
    // Real regex when it compiles, literal substring when it does not —
    // an invalid regex searches literally instead of failing the tool.
    let matcher = cybermanju_agent::config::GrepPattern::compile(pattern);
    let base = if sub.trim().is_empty() {
        root.to_path_buf()
    } else {
        join_contained(root, vol, sub)?
    };
    const SKIP_DIRS: &[&str] = &[
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".hg",
        ".svn",
    ];
    let limit = limit.clamp(1, MAX_GREP_MATCHES);
    let mut matches = Vec::new();
    let mut files_seen = 0usize;
    let mut stack = vec![base];
    while let Some(dir) = stack.pop() {
        if matches.len() >= limit || files_seen >= MAX_GREP_FILES {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if matches.len() >= limit || files_seen >= MAX_GREP_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            files_seen += 1;
            let bytes = match std::fs::read(&path) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            if bytes.len() > MAX_TOOL_BYTES || bytes.contains(&0) {
                continue;
            }
            let text = match String::from_utf8(bytes) {
                Ok(text) => text,
                Err(_) => continue,
            };
            for (i, line) in text.lines().enumerate() {
                if matcher.is_match(line) {
                    let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy();
                    let snippet: String = line.trim().chars().take(240).collect();
                    matches.push(format!("{}:{}: {}", rel, i + 1, snippet));
                    if matches.len() >= limit {
                        break;
                    }
                }
            }
        }
    }
    if matches.is_empty() {
        let mode = if matcher.is_regex() {
            "regex"
        } else {
            "literal (pattern is not valid regex)"
        };
        return Ok(format!("no matches for `{pattern}` ({mode})"));
    }
    Ok(matches.join("\n"))
}

/// Glob files without walking whole trees: `*` stays in one segment, `**`
/// crosses separators. Results are volume-relative paths, capped.
fn tool_glob(
    root: &Path,
    vol: &Path,
    pattern: &str,
    sub: &str,
    limit: usize,
) -> Result<String, String> {
    const MAX_GLOB_PATHS: usize = 200;
    const MAX_GLOB_FILES: usize = 2000;
    let base = if sub.trim().is_empty() {
        root.to_path_buf()
    } else {
        join_contained(root, vol, sub)?
    };
    let pattern = pattern.trim();
    let pattern = if pattern.is_empty() { "**" } else { pattern };
    const SKIP_DIRS: &[&str] = &[
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".hg",
        ".svn",
    ];
    let limit = limit.clamp(1, MAX_GLOB_PATHS);
    let mut hits = Vec::new();
    let mut files_seen = 0usize;
    let mut stack = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        if hits.len() >= limit || files_seen >= MAX_GLOB_FILES {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if hits.len() >= limit || files_seen >= MAX_GLOB_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            files_seen += 1;
            let rel = path
                .strip_prefix(&base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if cybermanju_agent::config::match_glob(pattern, &rel) {
                let display = if base == *vol {
                    format!("/{rel}")
                } else {
                    rel.clone()
                };
                hits.push(display);
            }
        }
    }
    hits.sort();
    if hits.is_empty() {
        return Ok(format!("no files match `{pattern}`"));
    }
    Ok(hits.join("\n"))
}

fn tool_write(
    db: &Database,
    root: &Path,
    vol: &Path,
    path: &str,
    content: &str,
) -> Result<String, String> {
    // A `[blake3:…]` line echoed out of a `read` is metadata about the file,
    // never file content — strip it, but only when it verifies as ours (the
    // exact round-trip trailer, or the trailer of the file already on disk
    // for edited echoes). A legitimate anchor-shaped content line stays.
    let full = join_contained(root, vol, path)?;
    let owned;
    let content = if agent_edit::anchor_trailer(content).is_some() {
        let existing = std::fs::read(&full)
            .ok()
            .and_then(|b| String::from_utf8(b).ok());
        owned = agent_edit::strip_echo(content, existing.as_deref()).to_string();
        owned.as_str()
    } else {
        content
    };
    if content.len() > MAX_TOOL_BYTES {
        return Err(format!(
            "too_large: content is {} bytes, tool limit is {}",
            content.len(),
            MAX_TOOL_BYTES
        ));
    }
    if let Some(parent) = full.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("not_found: cannot create '{}': {}", parent.display(), e))?;
        }
    }
    let existed = full.exists();
    std::fs::write(&full, content.as_bytes())
        .map_err(|e| format!("not_found: cannot write '{}': {}", path.trim(), e))?;
    let hash = agent_edit::blake3_hex(content.as_bytes());
    let _ = db.log_audit(
        "agent_write",
        "file",
        path.trim(),
        None,
        Some(serde_json::json!({ "bytes": content.len(), "existed": existed, "hash": hash })),
    );
    Ok(format!(
        "wrote {} ({} bytes, blake3:{})",
        path.trim(),
        content.len(),
        hash
    ))
}

fn tool_bash(
    db: &Database,
    root: &Path,
    command: &str,
    timeout_secs: u64,
    mode: cybermanju_types::agent::ShellMode,
) -> Result<String, String> {
    use cybermanju_types::agent::ShellMode;
    use std::process::{Command, Stdio};
    let command = command.trim();
    if command.is_empty() {
        return Err("invalid: empty command".to_string());
    }
    // Shell choice comes from the config (`shell_mode`): cybsh-first in
    // auto, cybsh-only when forced, device-shell-only when forced.
    // cybsh runs against the Kernel/volume via the same shell as the
    // Terminal panel (`ls`, `cat`, `search`, `disk`, `sync`, `ai`, …).
    // Pass explicit paths: the shell's working directory is
    // process-global and shared with the terminal.
    let cybsh_first = match mode {
        ShellMode::Device => false,
        ShellMode::Auto | ShellMode::Cybsh => true,
    };
    if cybsh_first {
        if let Some(first) = command.split_whitespace().next() {
            if cybermanju_os::shell::command_table().contains(&first) {
                let out = cybermanju_os::shell::execute(command, Some(db))?;
                if out.len() > TOOL_OUTPUT_CAP {
                    let mut cut = out;
                    cut.truncate(TOOL_OUTPUT_CAP);
                    cut.push_str("\n… truncated at 64 KiB");
                    return Ok(cut);
                }
                return Ok(out);
            }
        }
        if mode == ShellMode::Cybsh {
            return Err(format!(
                "unsupported: `{}` is not a cybsh command (shell_mode is \
                 cybsh-only) — use a cybsh volume command or switch the \
                 config to auto/device for the device shell",
                command.split_whitespace().next().unwrap_or("")
            ));
        }
    }
    let timeout = timeout_secs.clamp(5, 600);
    // The device shell must not inherit the server's environment: provider
    // keys, `CYBERMANJU_*` secrets and OAuth material live in process env,
    // and `env|printenv` output flows back into the transcript (then to the
    // provider). Start from a scrubbed slate — PATH (inherited, not secret)
    // plus locale only.
    let mut cmd = Command::new("sh");
    cmd.arg("-c")
        .arg(command)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("LANG", "C.UTF-8")
        .env("LC_ALL", "C.UTF-8");
    #[cfg(windows)]
    {
        // git-bash/MSYS `sh` refuses to start without these.
        for key in ["SystemRoot", "SystemDrive", "TEMP", "TMP"] {
            if let Some(v) = std::env::var_os(key) {
                cmd.env(key, v);
            }
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("error: cannot spawn shell: {e}"))?;
    // Drain both pipes on threads: a chatty child would otherwise block on
    // a full pipe buffer while the parent only polls for exit.
    let stdout = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            use std::io::Read;
            let _ = out.read_to_end(&mut buf);
            buf
        })
    });
    let stderr = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            use std::io::Read;
            let _ = err.read_to_end(&mut buf);
            buf
        })
    });
    let deadline = Instant::now() + Duration::from_secs(timeout);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("timeout: command killed after {timeout}s"));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("error: waiting on shell: {e}")),
        }
    };
    let mut out = stdout
        .and_then(|t| t.join().ok())
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let err = stderr
        .and_then(|t| t.join().ok())
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    if !err.trim().is_empty() {
        out.push_str("\n--- stderr ---\n");
        out.push_str(&err);
    }
    if out.len() > TOOL_OUTPUT_CAP {
        out.truncate(TOOL_OUTPUT_CAP);
        out.push_str("\n… truncated at 64 KiB");
    }
    let code = status
        .code()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "signal".into());
    Ok(format!("exit {code}\n{out}"))
}

/// Dispatch one approved tool call to native execution.
/// What the memory tools need beyond `db`: embedding endpoint + key,
/// cancellation, owning config/session, and whether this run may store
/// (subagents report — they never remember).
struct MemoryCtx<'a> {
    endpoint: &'a providers::ResolvedEndpoint,
    api_key: &'a str,
    cancel: &'a AtomicBool,
    config_id: &'a str,
    session_id: &'a str,
    embedding_model: String,
    allow_remember: bool,
}

fn exec_tool(
    db: &Database,
    root: &Path,
    vol: &Path,
    call: &ToolCall,
    mem: &MemoryCtx,
    shell_mode: cybermanju_types::agent::ShellMode,
) -> Result<String, String> {
    let get = |key: &str| {
        call.input
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    match call.name.as_str() {
        "read" => tool_read(root, vol, &get("path")),
        "list" => tool_list(root, vol, &get("path")),
        "grep" => {
            let limit = call
                .input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(MAX_GREP_MATCHES as u64) as usize;
            tool_grep(root, vol, &get("pattern"), &get("path"), limit)
        }
        "glob" => {
            let limit = call
                .input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(200) as usize;
            let pattern = call
                .input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("**");
            tool_glob(root, vol, pattern, &get("path"), limit)
        }
        "write" => tool_write(
            db,
            root,
            vol,
            &get("path"),
            call.input
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        ),
        "edit" => {
            let path = get("path");
            let old_block = call
                .input
                .get("old_block")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let new_block = call
                .input
                .get("new_block")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let expected = call.input.get("expected_hash").and_then(|v| v.as_str());
            let current = read_raw(root, vol, &path)?;
            let updated = agent_edit::apply_edit(&current, old_block, new_block, expected)?;
            // Hash exactly the bytes that land on disk, so the anchor printed
            // here verifies against the file the next call will read. Strip
            // our trailer against the pre-edit bytes: a model echoing the
            // read trailer into `new_block` is still echoing metadata, while
            // a trailer-shaped line it composed itself stays as content.
            let written = agent_edit::strip_echo(&updated, Some(&current)).to_string();
            tool_write(db, root, vol, &path, &written)?;
            Ok(format!(
                "edited {} (blake3:{})",
                path.trim(),
                agent_edit::blake3_hex(written.as_bytes())
            ))
        }
        "bash" => {
            let timeout = call
                .input
                .get("timeout_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(120);
            tool_bash(db, root, &get("command"), timeout, shell_mode)
        }
        "memory_recall" => {
            let top_k = call
                .input
                .get("top_k")
                .and_then(|v| v.as_u64())
                .unwrap_or(agent_memory::MEMORY_TOP_K as u64) as usize;
            let query = get("query");
            if query.trim().is_empty() {
                return Err("invalid: query is required".to_string());
            }
            let hits = recall_text(
                db,
                mem.cancel,
                mem.endpoint,
                mem.api_key,
                mem.config_id,
                &query,
                top_k,
                &mem.embedding_model,
            );
            if hits.is_empty() {
                Ok("no memories match — proceed with the transcript alone".to_string())
            } else {
                Ok(hits
                    .iter()
                    .map(|h| format!("- {}", h.text))
                    .collect::<Vec<_>>()
                    .join("\n"))
            }
        }
        "memory_remember" => {
            if !mem.allow_remember {
                return Err(
                    "deny: subagents cannot store memories — report findings to the parent run"
                        .to_string(),
                );
            }
            if mem.cancel.load(Ordering::SeqCst) {
                return Ok("cancelled: memory store skipped — the run is stopping".to_string());
            }
            let text = call
                .input
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match prepare_memory(
                mem.cancel,
                mem.endpoint,
                mem.api_key,
                mem.config_id,
                Some(mem.session_id.to_string()),
                text,
                MemoryOrigin::Remember,
                &mem.embedding_model,
            ) {
                Ok(m) => match save_memory_row(db, &m) {
                    Ok(()) => Ok(format!(
                        "remembered {} ({} chars{})",
                        m.id,
                        m.text.chars().count(),
                        if m.embedding.is_empty() {
                            ", keyword-only: embeddings unavailable"
                        } else {
                            ""
                        }
                    )),
                    Err(e) => Err(e),
                },
                Err(e) => Err(e),
            }
        }
        other => Err(format!("unsupported: unknown tool '{other}'")),
    }
}

/// Strip secrets from a tool result before it enters the transcript.
/// The transcript persists to disk and syncs across providers — a leaked
/// key there would outlive the run. A redaction note keeps the model aware
/// that something was hidden (otherwise it retries the failing read).
fn clean_output(output: String) -> String {
    let (mut redacted, count) = cybermanju_agent::redact::redact(&output);
    if redacted.len() > TOOL_OUTPUT_CAP {
        redacted.truncate(TOOL_OUTPUT_CAP);
        while !redacted.is_char_boundary(redacted.len()) {
            redacted.pop();
        }
        redacted.push_str("\n… truncated at 64 KiB");
    }
    if count == 0 {
        return redacted;
    }
    format!("{redacted}\n(redacted {count} secret(s) from tool output)")
}

/// Project rules folded into every system prompt (opencode reads
/// `AGENTS.md`; we additionally honor `SKILL.md` and
/// `.cybermanju/rules.md`). Each file capped, total capped, missing or
/// binary files silently skipped — rules guide, never break, a run.
fn load_project_rules(root: &Path) -> String {
    const PER_FILE_CAP: usize = 8192;
    const TOTAL_CAP: usize = 24_576;
    let mut out = String::new();
    for name in ["AGENTS.md", "SKILL.md", ".cybermanju/rules.md"] {
        if out.len() >= TOTAL_CAP {
            break;
        }
        let bytes = match std::fs::read(root.join(name)) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.len() > PER_FILE_CAP {
            continue;
        }
        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push_str(&format!("\n--- project rules ({name}) ---\n{trimmed}\n"));
    }
    if out.len() > TOTAL_CAP {
        out.truncate(TOTAL_CAP);
    }
    out
}

// ─── MCP servers (admin-managed tools) ───────────────────────────────────
///
/// Configs carry `mcp_servers` (validated on save). Discovery (`tools/list`)
/// and calls run here, natively: stdio children for local servers,
/// Streamable HTTP for remote ones. Every tool surfaces namespaced as
/// `mcp__<server>__<tool>` so permission rules match it like any tool.
/// Servers that fail to connect fail the run loudly — a silently missing
/// tool would be worse than no run at all.
use cybermanju_agent::mcp as mcp_proto;

/// One live MCP connection for the duration of a run.
struct McpConnection {
    server: String,
    transport: String,
    /// stdio: child stdin for requests.
    stdin: Option<std::sync::Mutex<std::process::ChildStdin>>,
    /// stdio: lines harvested by the reader thread.
    lines: Option<Arc<Mutex<VecDeque<String>>>>,
    /// stdio: the child (killed on close).
    child: Option<std::sync::Mutex<std::process::Child>>,
    next_id: std::sync::Mutex<u64>,
    /// http: endpoint + headers + negotiated session.
    http_url: Option<String>,
    http_headers: Vec<(String, String)>,
    http_session: std::sync::Mutex<Option<String>>,
}

impl McpConnection {
    fn close(&self) {
        if let Some(child) = self.child.as_ref() {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for McpConnection {
    fn drop(&mut self) {
        self.close();
    }
}

/// A set of connections with RAII teardown — every exit path (return,
/// cancel, panic-unwind) closes children.
struct McpSet {
    conns: Vec<McpConnection>,
}

impl Drop for McpSet {
    fn drop(&mut self) {
        for conn in &self.conns {
            conn.close();
        }
    }
}

impl McpSet {
    fn find(&self, server: &str) -> Option<&McpConnection> {
        self.conns.iter().find(|c| c.server == server)
    }
}

/// Discovered tool with its origin server, in canonical
/// (`name/description/input_schema`) shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolView {
    pub server: String,
    pub name: String,
    pub description: String,
}

/// Connect one server (15s handshake budget) and list its tools.
fn mcp_connect(
    name: &str,
    cfg: &McpServerConfig,
) -> Result<(McpConnection, Vec<cybermanju_agent::mcp::McpToolDef>), String> {
    if !mcp_proto::valid_server_name(name) {
        return Err(format!("invalid: bad MCP server name '{name}'"));
    }
    match cfg.transport.as_str() {
        "stdio" => mcp_connect_stdio(name, cfg),
        "http" => mcp_connect_http(name, cfg),
        other => Err(format!("invalid: unknown MCP transport '{other}'")),
    }
}

fn mcp_connect_stdio(
    name: &str,
    cfg: &McpServerConfig,
) -> Result<(McpConnection, Vec<cybermanju_agent::mcp::McpToolDef>), String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    let command = cfg.command.clone().unwrap_or_default();
    let mut child = Command::new(&command)
        .args(&cfg.args)
        .envs(cfg.env.iter())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("network: cannot spawn MCP server '{name}' ({command}): {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("network: MCP server '{name}' gave no stdin pipe"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("network: MCP server '{name}' gave no stdout pipe"))?;
    let lines: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let feed = Arc::clone(&lines);
    std::thread::Builder::new()
        .name(format!("mcp-{name}-reader"))
        .spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut queue) = feed.lock() {
                    queue.push_back(line);
                    while queue.len() > 256 {
                        queue.pop_front();
                    }
                }
            }
        })
        .map_err(|e| format!("network: cannot start MCP reader for '{name}': {e}"))?;

    let conn = McpConnection {
        server: name.to_string(),
        transport: "stdio".to_string(),
        stdin: Some(Mutex::new(stdin)),
        lines: Some(lines),
        child: Some(Mutex::new(child)),
        next_id: Mutex::new(1),
        http_url: None,
        http_headers: Vec::new(),
        http_session: Mutex::new(None),
    };
    // Handshake: initialize → notifications/initialized → tools/list.
    let init = mcp_request(
        &conn,
        "initialize",
        mcp_proto::initialize_params("cybermanju"),
        15,
    )?;
    let server_version = init
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    log::debug!("MCP '{name}' speaks protocol {server_version}");
    mcp_notify(&conn, "notifications/initialized", serde_json::json!({}))?;
    let listed = mcp_request(&conn, "tools/list", serde_json::json!({}), 15)?;
    Ok((conn, mcp_proto::parse_tools_list(&listed)))
}

fn mcp_request(
    conn: &McpConnection,
    method: &str,
    params: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let id = {
        let mut next = conn.next_id.lock().unwrap_or_else(|p| p.into_inner());
        *next += 1;
        *next
    };
    let line = mcp_proto::request(id, method, params).to_string() + "\n";
    {
        let stdin = conn
            .stdin
            .as_ref()
            .ok_or_else(|| "network: MCP stdio pipe is gone".to_string())?;
        let mut stdin = stdin.lock().unwrap_or_else(|p| p.into_inner());
        use std::io::Write as _;
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("network: MCP write failed: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("network: MCP flush failed: {e}"))?;
    }
    let lines = conn
        .lines
        .as_ref()
        .ok_or_else(|| "network: MCP stdio reader is gone".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if let Ok(mut queue) = lines.lock() {
            if let Some(pos) = queue.iter().position(|line| {
                serde_json::from_str::<serde_json::Value>(line)
                    .ok()
                    .and_then(|v| v.get("id").and_then(|i| i.as_u64()))
                    == Some(id)
            }) {
                let line = queue.remove(pos).unwrap_or_default();
                let value: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|_| "integrity: MCP server sent unparseable JSON".to_string())?;
                return mcp_proto::unwrap_response(&value);
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "network: MCP '{method}' timed out after {timeout_secs}s"
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Fire-and-forget notification (never waits for a reply).
fn mcp_notify(conn: &McpConnection, method: &str, params: serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let line = mcp_proto::notification(method, params).to_string() + "\n";
    let stdin = conn
        .stdin
        .as_ref()
        .ok_or_else(|| "network: MCP stdio pipe is gone".to_string())?;
    let mut stdin = stdin.lock().unwrap_or_else(|p| p.into_inner());
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("network: MCP notify failed: {e}"))?;
    stdin
        .flush()
        .map_err(|e| format!("network: MCP flush failed: {e}"))?;
    Ok(())
}

fn mcp_connect_http(
    name: &str,
    cfg: &McpServerConfig,
) -> Result<(McpConnection, Vec<cybermanju_agent::mcp::McpToolDef>), String> {
    let url = cfg.url.clone().unwrap_or_default();
    let conn = McpConnection {
        server: name.to_string(),
        transport: "http".to_string(),
        stdin: None,
        lines: None,
        child: None,
        next_id: Mutex::new(1),
        http_url: Some(url),
        http_headers: cfg.headers.clone(),
        http_session: Mutex::new(None),
    };
    let init = mcp_http_roundtrip(
        &conn,
        "initialize",
        mcp_proto::initialize_params("cybermanju"),
        15,
    )?;
    let server_version = init
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    log::debug!("MCP '{name}' (http) speaks protocol {server_version}");
    let listed = mcp_http_roundtrip(&conn, "tools/list", serde_json::json!({}), 15)?;
    Ok((conn, mcp_proto::parse_tools_list(&listed)))
}

/// One Streamable-HTTP round trip: POST JSON-RPC, accept SSE-or-JSON,
/// harvest the `Mcp-Session-Id` when the server deals one.
fn mcp_http_roundtrip(
    conn: &McpConnection,
    method: &str,
    params: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let url = conn.http_url.clone().unwrap_or_default();
    let id = {
        let mut next = conn.next_id.lock().unwrap_or_else(|p| p.into_inner());
        *next += 1;
        *next
    };
    let mut headers = conn.http_headers.clone();
    headers.push(("Content-Type".into(), "application/json".into()));
    headers.push((
        "Accept".into(),
        "application/json, text/event-stream".into(),
    ));
    if let Ok(session) = conn.http_session.lock() {
        if let Some(session) = session.as_ref() {
            headers.push(("Mcp-Session-Id".into(), session.clone()));
        }
    }
    let body = mcp_proto::request(id, method, params);
    let (status, resp_headers, text) = http_post_raw(&url, &headers, &body, timeout_secs)?;
    if status == 202 {
        // Accepted with no body (typical for notifications over HTTP).
        return Ok(serde_json::json!({}));
    }
    if !(200..300).contains(&status) {
        return Err(protocol::classify_provider_error(
            Some(status),
            &format!("MCP {method} failed"),
            "",
        ));
    }
    if let Some(session) = resp_headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("mcp-session-id"))
        .map(|(_, value)| value.clone())
    {
        if let Ok(mut slot) = conn.http_session.lock() {
            if slot.is_none() {
                *slot = Some(session);
            }
        }
    }
    // Either a bare JSON-RPC message or an SSE stream carrying one.
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|_| "integrity: MCP HTTP reply was not JSON".to_string())?;
        return mcp_proto::unwrap_response(&value);
    }
    for data in mcp_proto::parse_sse_data_lines(&text) {
        if data
            .get("id")
            .and_then(|i| i.as_u64())
            .map(|i| i == id)
            .unwrap_or(false)
            || data.get("result").is_some()
        {
            return mcp_proto::unwrap_response(&data);
        }
    }
    Err("integrity: MCP HTTP stream carried no matching response".to_string())
}

/// Raw HTTP POST returning status + headers + body (timeouts finite).
fn http_post_raw(
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
    timeout_secs: u64,
) -> cybermanju_agent::protocol::RawResponse {
    protocol::post_raw(url, headers, body, timeout_secs)
}

/// Reconnect one MCP server inside a live set after a transport breach
/// (crashed child, severed pipe): drop the dead connection, dial fresh,
/// and let the caller retry once. Anything else is reported, not retried.
fn reconnect_mcp(
    set: &mut McpSet,
    servers: &std::collections::BTreeMap<String, McpServerConfig>,
    full_name: &str,
) -> Result<(), String> {
    let (server, _) = mcp_proto::split_tool_name(full_name)
        .ok_or_else(|| format!("unsupported: '{full_name}' is not an MCP tool"))?;
    let cfg = servers
        .get(server)
        .ok_or_else(|| format!("not_found: MCP server '{server}' is not attached"))?;
    set.conns.retain(|c| c.server != server);
    let (conn, _) = mcp_connect(server, cfg)?;
    set.conns.push(conn);
    Ok(())
}

fn mcp_call_error_is_breach(message: &str) -> bool {
    [
        "pipe is gone",
        "write failed",
        "flush failed",
        "timed out",
        "reader is gone",
    ]
    .iter()
    .any(|s| message.contains(s))
}
fn mcp_call(
    set: &McpSet,
    full_name: &str,
    input: &serde_json::Value,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let (server, tool) = mcp_proto::split_tool_name(full_name)
        .ok_or_else(|| format!("unsupported: '{full_name}' is not an MCP tool"))?;
    let conn = set
        .find(server)
        .ok_or_else(|| format!("not_found: MCP server '{server}' is not connected"))?;
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }
    let params = serde_json::json!({ "name": tool, "arguments": input });
    let result = match conn.transport.as_str() {
        "stdio" => mcp_request(conn, "tools/call", params, 120)?,
        _ => mcp_http_roundtrip(conn, "tools/call", params, 120)?,
    };
    Ok(mcp_proto::render_call_result(&result))
}

/// Start an agent run on a worker thread; returns immediately with a job
/// snapshot (the REST `202`-style path — the request thread never waits on
/// a provider, same contract as `POST /api/sync/start`).
///
/// Trusted-local entry point (Tauri IPC, cybsh helpers): the job is owned
/// by `"local"`. REST callers must use [`start_job_as`] with the JWT
/// `user_id` so the job is bound to its owner (P0-10).
pub fn start_job(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    session_id: Option<String>,
    prompt: String,
) -> Result<JobSnapshot, String> {
    start_job_as(db, config_id, session_id, prompt, "local")
}

/// Owner-bound variant of [`start_job`] for the REST transport: `owner_id`
/// is the JWT `user_id` and is stored on the job for every later
/// status/abort/approve check. Job ids are `agent-<uuid v4>` (unpredictable).
pub fn start_job_as(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    session_id: Option<String>,
    prompt: String,
    owner_id: &str,
) -> Result<JobSnapshot, String> {
    if prompt.trim().is_empty() {
        return Err("invalid: prompt is required".to_string());
    }
    if prompt.len() > 64 * 1024 {
        return Err("invalid: prompt is too long (64 KiB cap)".to_string());
    }
    // Validate everything on the request thread: bad configs are 4xx, not
    // jobs that fail in the dark.
    let config = {
        let guard = db.read().map_err(|e| e.to_string())?;
        get_config(&guard, config_id)?
    };
    let key = {
        let guard = db.read().map_err(|e| e.to_string())?;
        let key = load_key(&guard, config_id)?;
        // The run may start as long as SOME route in the chain is usable —
        // the worker fails over onto it when the primary's call dies.
        let primary_ok = route_usable(&guard, &config);
        let fallback_ok = config.fallback_ids.iter().any(|id| {
            get_config(&guard, id)
                .map(|c| route_usable(&guard, &c))
                .unwrap_or(false)
        });
        if !primary_ok && !fallback_ok {
            return Err("auth: no API key saved for this config — add one first (or add a fallback assistant with a key)".to_string());
        }
        key
    };
    let session = {
        let guard = db.read().map_err(|e| e.to_string())?;
        match session_id {
            Some(id) => {
                crate::security::validate_id(&id)?;
                let session = get_session(&guard, &id)?;
                // A job must not run on another user's transcript: owners
                // match, legacy unowned rows stay usable, `"local"` is the
                // trusted Tauri path.
                if !session.owner_id.is_empty()
                    && !owner_id.is_empty()
                    && owner_id != "local"
                    && session.owner_id != owner_id
                {
                    return Err("auth: agent session belongs to another user".to_string());
                }
                session
            }
            None => {
                drop(guard);
                let guard = db.read().map_err(|e| e.to_string())?;
                let title: String = prompt
                    .trim()
                    .chars()
                    .take(60)
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                create_session_as(&guard, config_id, Some(title), owner_id)?
            }
        }
    };

    let job = Arc::new(AgentJob {
        job_id: format!("agent-{}", uuid::Uuid::new_v4()),
        session_id: session.id.clone(),
        config_id: config.id.clone(),
        started_at: chrono::Utc::now().to_rfc3339(),
        owner_id: owner_id.to_string(),
        state: Mutex::new(JobState {
            status: "running".to_string(),
            turns_used: 0,
            max_turns: config.max_turns,
            usage: TokenUsage::default(),
            result: None,
            error: None,
            pending: None,
            activity: Some("starting".to_string()),
            memory_hint: None,
        }),
        cancel: AtomicBool::new(false),
    });
    {
        let mut registry = jobs().lock().unwrap_or_else(|p| p.into_inner());
        registry.insert(job.job_id.clone(), Arc::clone(&job));
    }

    let db2 = Arc::clone(db);
    let job2 = Arc::clone(&job);
    let spawned = std::thread::Builder::new()
        .name(format!("agent-{}", job.job_id))
        .spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                run_agent_job(&db2, &job2, config, key, session, prompt)
            }));
            if outcome.is_err() {
                set_state(&job2, |s| {
                    s.status = "error".to_string();
                    s.error = Some("agent worker panicked".to_string());
                    s.pending = None;
                });
            }
        });
    if let Err(e) = spawned {
        set_state(&job, |s| {
            s.status = "error".to_string();
            s.error = Some(format!("could not start agent worker: {e}"));
        });
        return Err(format!("could not start agent worker: {e}"));
    }
    Ok(snapshot(&job))
}

/// The `ai init` prompt: analyze the repo and write `AGENTS.md` with the
/// agent's own tools. A convention, not a code path — the model does the
/// work through the normal loop, so permissions, approvals and versions
/// apply unchanged.
pub const INIT_PROMPT: &str = "Analyze this repository: list the top-level layout, \
identify the languages and build/test commands, and note conventions worth \
following. Then write (or update) AGENTS.md at the working root summarizing: \
project overview, how to build/test/lint, code style rules, and anything an \
AI agent must know before editing. Use the project-rules section you were \
given, if any. Keep it under 100 lines.";

/// Start a repository-init run: a normal detached job with the canned
/// `INIT_PROMPT` in a fresh session. The agent writes AGENTS.md itself.
pub fn start_init_job(db: &Arc<RwLock<Database>>, config_id: &str) -> Result<JobSnapshot, String> {
    start_job(db, config_id, None, INIT_PROMPT.to_string())
}

/// Owner-bound variant of [`start_init_job`] for the REST transport.
pub fn start_init_job_as(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    owner_id: &str,
) -> Result<JobSnapshot, String> {
    start_job_as(db, config_id, None, INIT_PROMPT.to_string(), owner_id)
}

/// Poll one job (trusted-local: Tauri IPC, SSE pre-check, cybsh helpers).
pub fn job_status(job_id: &str) -> Result<JobSnapshot, String> {
    job_status_for(job_id, "", true)
}

/// Owner-bound poll for the REST transport: strangers get `auth:` instead
/// of the job, unknown ids stay 404-shaped (`not_found:`).
pub fn job_status_for(
    job_id: &str,
    requester: &str,
    is_admin: bool,
) -> Result<JobSnapshot, String> {
    crate::security::validate_id(job_id)?;
    let registry = jobs().lock().unwrap_or_else(|p| p.into_inner());
    let job = registry
        .get(job_id)
        .ok_or_else(|| format!("not_found: agent job '{job_id}' not found"))?;
    check_job_owner(job, requester, is_admin)?;
    Ok(snapshot(job))
}

/// All known jobs (trusted-local; capped; registry order is not
/// chronological — the UI sorts by recency from status polls).
pub fn list_jobs() -> Vec<JobSnapshot> {
    list_jobs_for("", true)
}

/// Owner-bound list for the REST transport: admins see everything,
/// everyone else sees only their own jobs. Empty requester (trusted local)
/// sees everything.
pub fn list_jobs_for(requester: &str, is_admin: bool) -> Vec<JobSnapshot> {
    let registry = jobs().lock().unwrap_or_else(|p| p.into_inner());
    let mut out: Vec<JobSnapshot> = registry
        .values()
        .filter(|job| requester.is_empty() || is_admin || job.owner_id == requester)
        .map(|job| snapshot(job))
        .collect();
    out.sort_by(|a, b| b.job_id.cmp(&a.job_id));
    out.truncate(50);
    out
}

/// Request cancellation. Idempotent: unknown ids are 404, finished jobs
/// report success without side effects. Trusted-local (no owner check).
pub fn abort_job(job_id: &str) -> Result<bool, String> {
    abort_job_for(job_id, "", true)
}

/// Owner-bound abort for the REST transport: strangers get `auth:`.
pub fn abort_job_for(job_id: &str, requester: &str, is_admin: bool) -> Result<bool, String> {
    crate::security::validate_id(job_id)?;
    let job = {
        let registry = jobs().lock().unwrap_or_else(|p| p.into_inner());
        registry
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("not_found: agent job '{job_id}' not found"))?
    };
    check_job_owner(&job, requester, is_admin)?;
    job.cancel.store(true, Ordering::SeqCst);
    Ok(true)
}

/// Answer a parked approval (`approved`) or question (`answer`).
/// Returns false when nothing is waiting — the UI polls, so a stale tap
/// must not error loudly. With `remember`, an approval additionally stores
/// "allow always" for that tool in the config (explicit row, reversible).
/// Trusted-local entry point (Tauri IPC): no owner check.
pub fn approve_job(
    db: &Arc<RwLock<Database>>,
    job_id: &str,
    approved: bool,
    answer: Option<String>,
    remember: bool,
) -> Result<bool, String> {
    approve_job_for(db, job_id, approved, answer, remember, "", true)
}

/// Owner-bound approval for the REST transport: only the job owner (or an
/// admin) may answer a parked `ask` — otherwise any authenticated user
/// could approve someone else's job (P0-10). Unknown ids stay
/// `not_found:`-shaped; strangers get `auth:`.
pub fn approve_job_for(
    db: &Arc<RwLock<Database>>,
    job_id: &str,
    approved: bool,
    answer: Option<String>,
    remember: bool,
    requester: &str,
    is_admin: bool,
) -> Result<bool, String> {
    crate::security::validate_id(job_id)?;
    let (tool, owner_ok): (Option<String>, Result<(), String>) = {
        let registry = jobs().lock().unwrap_or_else(|p| p.into_inner());
        let job = registry
            .get(job_id)
            .ok_or_else(|| format!("not_found: agent job '{job_id}' not found"))?;
        let owner_ok = check_job_owner(job, requester, is_admin);
        let tool = job
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .pending
            .as_ref()
            .map(|pending| pending.tool.clone());
        (tool, owner_ok)
    };
    // Fail closed before recording anything: a stranger's answer must never
    // land in another user's approval slot.
    owner_ok?;
    {
        let mut pending = approvals().lock().unwrap_or_else(|p| p.into_inner());
        pending.insert(job_id.to_string(), ApprovalAnswer { approved, answer });
    }
    if approved && remember {
        // Persistent widening ("allow always") is a config write: on the
        // REST transport it needs admin, like `save_config_as`. A non-admin
        // approval still works once — only the permanent rule is skipped.
        // (Tauri IPC passes `is_admin=true`, so desktop behavior is unchanged.)
        if !is_admin {
            log::debug!("remember-allow skipped: non-admin approval approves once only");
        } else if let Some(tool) = tool {
            // Best effort: the approval itself is already recorded above.
            // A failure here must not turn an approval into an error.
            if let Ok(guard) = db.read() {
                if let Ok(registry) = jobs().lock() {
                    if let Some(job) = registry.get(job_id) {
                        let config_id = job.config_id.clone();
                        drop(registry);
                        if let Ok(mut config) = get_config(&guard, &config_id) {
                            cybermanju_agent::config::remember_allow(&mut config.permission, &tool);
                            drop(guard);
                            if let Ok(guard) = db.read() {
                                if let Err(e) = save_config(&guard, config) {
                                    log::debug!("remember-allow rule not persisted: {e}");
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(true)
}

fn wait_approval(job: &AgentJob) -> Option<ApprovalAnswer> {
    let deadline = Instant::now() + Duration::from_secs(APPROVAL_TIMEOUT_SECS);
    loop {
        if job.cancel.load(Ordering::SeqCst) {
            return None;
        }
        if let Ok(mut pending) = approvals().lock() {
            if let Some(answer) = pending.remove(&job.job_id) {
                return Some(answer);
            }
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// POST with backoff on `rate_limited:` (3 retries: 2s/4s/8s). Sleeps in
/// slices so abort stays responsive. Anything else fails immediately —
/// auth errors must never be retried into a lockout.
fn post_with_retry(
    cancel: &AtomicBool,
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut wait = Duration::from_secs(2);
    for attempt in 0..4 {
        match protocol::post_json(url, headers, body) {
            Ok(reply) => return Ok(reply),
            Err(e) if e.starts_with("rate_limited:") && attempt < 3 => {
                let deadline = Instant::now() + wait;
                while Instant::now() < deadline {
                    if cancel.load(Ordering::SeqCst) {
                        return Err("cancelled".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                wait *= 2;
            }
            Err(e) => return Err(e),
        }
    }
    Err("rate_limited: provider still throttling after 3 backoffs".to_string())
}

/// Merge discovered MCP tools into a built request body (both dialects keep
/// their envelope shape; the canonical defs are Anthropic-shaped).
fn merge_mcp_tools(body: &mut serde_json::Value, dialect: LlmDialect, defs: &[serde_json::Value]) {
    if defs.is_empty() {
        return;
    }
    let tools = match body.get_mut("tools").and_then(|t| t.as_array_mut()) {
        Some(tools) => tools,
        None => return,
    };
    for def in defs {
        match dialect {
            LlmDialect::OpenAi => tools.push(protocol::as_openai_tool(def)),
            LlmDialect::Anthropic => tools.push(def.clone()),
        }
    }
}

/// Anthropic prompt-caching markers: cache the system block and set the
/// cache breakpoint on the last tool (Anthropic allows up to 4; one is the
/// honest, portable choice). Repeated turns then stop re-paying the full
/// system + tool-schema prefix.
fn anthropic_cache(body: &mut serde_json::Value) {
    if let Some(text) = body
        .get("system")
        .and_then(|s| s.as_str())
        .map(str::to_string)
    {
        body["system"] = serde_json::json!([{
            "type": "text",
            "text": text,
            "cache_control": { "type": "ephemeral" },
        }]);
    }
    if let Some(tools) = body.get_mut("tools").and_then(|t| t.as_array_mut()) {
        if let Some(last) = tools.last_mut().and_then(|t| t.as_object_mut()) {
            last.insert(
                "cache_control".to_string(),
                serde_json::json!({ "type": "ephemeral" }),
            );
        }
    }
}

// ─── worker ────────────────────────────────────────────────────────────────

/// Repo overview for the system prompt: top-level working-root listing.
fn repo_overview(root: &Path) -> String {
    match tool_list(root, root, "") {
        Ok(listing) => {
            let entries: Vec<String> = listing
                .lines()
                .take(OVERVIEW_CAP)
                .map(str::to_string)
                .collect();
            agent_loop::repo_overview_snippet(&entries, OVERVIEW_CAP)
        }
        Err(_) => "(working root is not readable)".to_string(),
    }
}

fn persist_turn(db: &Arc<RwLock<Database>>, session: &AgentSession) {
    if let Ok(guard) = db.read() {
        let mut session = session.clone();
        session.updated_at = chrono::Utc::now().to_rfc3339();
        let _ = save_session_row(&guard, &session);
    }
}

/// One resolved provider route for a run: the primary first, then fallbacks.
struct FailoverRoute {
    name: String,
    model: String,
    endpoint: providers::ResolvedEndpoint,
    api_key: String,
}

/// Resolve the run's route plan: primary + usable fallbacks. Unknown,
/// unresolvable or key-missing entries are skipped — save-time validation
/// keeps those rare, and a run must never die on a stale fallback id.
fn resolve_routes(
    db: &Arc<RwLock<Database>>,
    config: &AgentConfig,
    api_key: &str,
) -> Vec<FailoverRoute> {
    use cybermanju_agent::config::plan_failover_chain;
    let mut routes = Vec::new();
    let mut push = |routes: &mut Vec<FailoverRoute>, cfg: &AgentConfig, key: String| {
        let endpoint = match providers::resolve(cfg) {
            Ok(e) => e,
            Err(_) => return,
        };
        if !endpoint.keyless && key.is_empty() {
            return;
        }
        routes.push(FailoverRoute {
            name: cfg.name.clone(),
            model: cfg.model.clone(),
            endpoint,
            api_key: key,
        });
    };
    push(&mut routes, config, api_key.to_string());
    let guard = match db.read() {
        Ok(g) => g,
        Err(_) => return routes,
    };
    for id in plan_failover_chain(&config.id, &config.fallback_ids)
        .into_iter()
        .skip(1)
    {
        let cfg = match get_config(&guard, &id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let key = load_key(&guard, &id).unwrap_or_default();
        push(&mut routes, &cfg, key);
    }
    routes
}

/// The blocking agent loop. Every provider call, tool run and approval wait
/// funnels through cancel checks; the transcript persists after each turn.
fn run_agent_job(
    db: &Arc<RwLock<Database>>,
    job: &Arc<AgentJob>,
    config: AgentConfig,
    api_key: String,
    mut session: AgentSession,
    prompt: String,
) {
    let fail = |job: &Arc<AgentJob>, message: String| {
        set_state(job, |s| {
            s.status = "error".to_string();
            s.error = Some(message);
            s.pending = None;
            s.activity = None;
        });
    };

    let routes = resolve_routes(db, &config, &api_key);
    if routes.is_empty() {
        fail(
            job,
            "auth: no usable provider route — save a key on this assistant or on one of its fallbacks"
                .to_string(),
        );
        return;
    }
    // Embeddings/recall stay on the primary route; chat turns fail over.
    let mem_endpoint = routes[0].endpoint.clone();
    let mut endpoint = routes[0].endpoint.clone();
    let mut active_key = routes[0].api_key.clone();
    let mut route_idx = 0;
    let vol = volume_root();
    let root = match working_root(&config) {
        Ok(root) => root,
        Err(e) => {
            fail(job, e);
            return;
        }
    };
    if !root.exists() {
        fail(
            job,
            format!(
                "not_found: working root '{}' does not exist",
                root.display()
            ),
        );
        return;
    }

    // Seed the user turn from the queued prompt.
    session.messages.push(ChatMessage {
        role: "user".into(),
        content: prompt.clone(),
        tool_call_id: None,
        tool_name: None,
        tool_input: None,
    });
    persist_turn(db, &session);
    let mut turn = agent_loop::AgentTurn::new(session.messages.clone(), config.max_turns, 0);
    let kind = match config.agent_kind {
        AgentKind::Build => "build",
        AgentKind::Plan => "plan",
    };
    let mut system = format!(
        "{}{}",
        agent_loop::system_prompt(
            &root.to_string_lossy(),
            kind,
            &repo_overview(&root),
            agent_loop::Sandbox::Native,
            config.shell_mode
        ),
        load_project_rules(&root)
    );
    // Semantic auto-recall (Hermes memory pattern): the user prompt seeds a
    // bounded `<recalled-memories>` block up front, so the run starts with
    // what past sessions learned instead of re-discovering it.
    system.push_str(&recall_block_for_run(
        db,
        &mem_endpoint,
        &api_key,
        &config,
        &prompt,
        &job.cancel,
    ));
    let headers = endpoint_headers(&endpoint, &active_key);
    let mut model = routes[0].model.clone();

    // Connect MCP servers up front: a run with a dead tool server fails
    // loudly here instead of hallucinating around missing tools mid-run.
    // `McpSet` drops (kills children) on every exit path below.
    // Effective map = stored servers + keyless Exa default (old configs
    // predate it; a stored `exa` entry, even disabled, always wins).
    let mut mcp_defs: Vec<serde_json::Value> = Vec::new();
    let mut mcp_conns: Vec<McpConnection> = Vec::new();
    let mut effective_servers = config.mcp_servers.clone();
    cybermanju_types::agent::ensure_default_mcp_servers(&mut effective_servers);
    for (name, server_cfg) in &effective_servers {
        if !server_cfg.enabled {
            continue;
        }
        match mcp_connect(name, server_cfg) {
            Ok((conn, tools)) => {
                for tool in tools {
                    mcp_defs.push(serde_json::json!({
                        "name": mcp_proto::tool_name(name, &tool.name),
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    }));
                }
                mcp_conns.push(conn);
            }
            Err(e) => {
                fail(job, format!("MCP server '{name}' failed to connect: {e}"));
                return;
            }
        }
    }
    if mcp_defs.len() > 256 {
        mcp_defs.truncate(256);
    }
    let mut mcp_set = McpSet { conns: mcp_conns };

    // Doom-loop guard state spans the WHOLE run, not one tool batch: the
    // system prompt promises three identical repeats are auto-denied, and a
    // model that loops once per turn is exactly what a per-batch counter
    // (the original shape here) never catches.
    let mut doom_sig: Option<(String, String)> = None;
    let mut doom_repeats = 0u32;

    // Memory context for the run's tools: recall reads, remember stores
    // (gated by the same `decide` every other tool goes through).
    // Embeddings stay on the primary route even after a chat failover —
    // sealing that would need per-route embedding keys.
    let mem_ctx = MemoryCtx {
        endpoint: &mem_endpoint,
        api_key: &api_key,
        cancel: &job.cancel,
        config_id: &config.id,
        session_id: &session.id,
        embedding_model: embedding_model(&config),
        allow_remember: true,
    };

    loop {
        if job.cancel.load(Ordering::SeqCst) {
            set_state(job, |s| {
                s.status = "cancelled".to_string();
                s.pending = None;
            });
            break;
        }
        let (mut url, mut headers, mut body) = turn.build_request(
            &endpoint.base_url,
            endpoint.dialect,
            &model,
            &system,
            headers.clone(),
            true,
        );
        merge_mcp_tools(&mut body, endpoint.dialect, &mcp_defs);
        // Strip what the ruleset denies everywhere (default-deny strips
        // broadly — honestly so, the runtime `decide` gate would deny
        // those calls anyway). An emptied `tools` key is removed with
        // `tool_choice` so the turn stays a valid no-tools turn.
        agent_config::strip_denied_tools(&mut body, &config.permission, config.agent_kind);
        if endpoint.dialect == LlmDialect::Anthropic {
            anthropic_cache(&mut body);
        }
        if endpoint.auth == cybermanju_types::agent::AuthScheme::Query {
            let name = endpoint.auth_name.as_deref().unwrap_or("key");
            url = protocol::with_query_key(&url, name, &active_key);
        }
        // Tell the poller what is happening: a provider round trip can take
        // minutes, and "RUNNING TURN 3/25" alone reads as a hang.
        set_state(job, |s| {
            s.activity = Some(format!("thinking · {model}"));
        });
        let reply = match post_with_retry(&job.cancel, &url, &headers, &body) {
            Ok(reply) => reply,
            Err(e) if e == "cancelled" => {
                set_state(job, |s| {
                    s.status = "cancelled".to_string();
                    s.pending = None;
                });
                break;
            }
            Err(e) => {
                // Dead key, throttling, transport failure or empty credits:
                // continue the same transcript on the next route instead of
                // failing the run. Anything else would fail identically
                // everywhere, so it stops here.
                if cybermanju_agent::config::is_failover_worthy(&e)
                    && route_idx + 1 < routes.len()
                {
                    route_idx += 1;
                    let next = &routes[route_idx];
                    endpoint = next.endpoint.clone();
                    active_key = next.api_key.clone();
                    headers = endpoint_headers(&endpoint, &active_key);
                    model = next.model.clone();
                    set_state(job, |s| {
                        s.activity =
                            Some(format!("failover → {} · {}", next.name, next.model));
                    });
                    continue;
                }
                if route_idx > 0 {
                    let tried: Vec<String> = routes
                        .iter()
                        .take(route_idx + 1)
                        .map(|r| r.name.clone())
                        .collect();
                    fail(job, format!("{e} (tried: {})", tried.join(" → ")));
                } else {
                    fail(job, e);
                }
                break;
            }
        };
        if job.cancel.load(Ordering::SeqCst) {
            // The abort landed while the provider call was in flight.
            set_state(job, |s| {
                s.status = "cancelled".to_string();
                s.pending = None;
            });
            break;
        }
        let event = match turn.ingest_reply(endpoint.dialect, &reply) {
            Ok(event) => event,
            Err(e) => {
                fail(job, e);
                break;
            }
        };
        session.messages = turn.messages.clone();
        session.usage = turn.usage.clone();
        persist_turn(db, &session);
        set_state(job, |s| {
            s.turns_used = turn.turns_used;
            s.usage = turn.usage.clone();
        });

        match event {
            agent_loop::LoopEvent::TextDone => {
                let text = turn
                    .messages
                    .iter()
                    .rev()
                    .find(|m| m.role == "assistant")
                    .map(|m| m.content.clone())
                    .unwrap_or_default();
                let short: String = text.chars().take(4000).collect();
                // A `length` finish means the model was cut off mid-thought,
                // not that it concluded — say so instead of stopping silently.
                let result = if turn.last_finish == "length" {
                    format!("truncated: model hit max tokens; last partial output:\n{short}")
                } else {
                    short
                };
                set_state(job, |s| {
                    s.status = "done".to_string();
                    s.result = Some(result);
                    // Hermes-style nudge, once: a long run that stored
                    // nothing earns a "teach me" hint for the UI.
                    if agent_memory::should_nudge_memory(turn.turns_used, remembered_in_run(&turn))
                    {
                        s.memory_hint = Some(
                            "This run learned things worth keeping — store one fact with memory_remember.".to_string(),
                        );
                    }
                });
                break;
            }
            agent_loop::LoopEvent::LimitReached => {
                set_state(job, |s| {
                    s.status = "done".to_string();
                    s.result = Some(format!(
                        "turn budget exhausted after {} turns — raise MAX TURNS or COMPACT the session, then continue; last state saved",
                        turn.turns_used
                    ));
                    if agent_memory::should_nudge_memory(turn.turns_used, remembered_in_run(&turn))
                    {
                        s.memory_hint = Some(
                            "This run learned things worth keeping — store one fact with memory_remember.".to_string(),
                        );
                    }
                });
                break;
            }
            agent_loop::LoopEvent::ToolCalls(calls) => {
                let mut stop = false;
                for call in &calls {
                    if job.cancel.load(Ordering::SeqCst) {
                        stop = true;
                        break;
                    }
                    let input_json = serde_json::to_string(&call.input).unwrap_or_default();
                    if doom_sig
                        .as_ref()
                        .map(|sig| sig.0 == call.name && sig.1 == input_json)
                        .unwrap_or(false)
                    {
                        doom_repeats += 1;
                    } else {
                        doom_sig = Some((call.name.clone(), input_json));
                        doom_repeats = 1;
                    }
                    if doom_repeats >= 3 {
                        turn.append_tool_result(call, DOOM_LOOP_DENIAL.to_string());
                        continue;
                    }
                    set_state(job, |s| {
                        let arg = cybermanju_agent::config::salient_arg(&call.input);
                        s.activity = Some(if arg.is_empty() {
                            call.name.clone()
                        } else {
                            let arg: String = arg.chars().take(160).collect();
                            format!("{} {arg}", call.name)
                        });
                    });
                    match run_one_tool(
                        db,
                        job,
                        &config,
                        &root,
                        &vol,
                        &mut mcp_set,
                        &turn,
                        call,
                        &mem_ctx,
                    ) {
                        ToolOutcome::Continue(output) => {
                            turn.append_tool_result(call, clean_output(output));
                        }
                        ToolOutcome::Stop => {
                            stop = true;
                            break;
                        }
                    }
                }
                session.messages = turn.messages.clone();
                session.usage = turn.usage.clone();
                persist_turn(db, &session);
                if stop {
                    break;
                }
            }
        }
    }

    // Final transcript + usage write (best effort — the run already ended).
    session.messages = turn.messages.clone();
    session.usage = turn.usage.clone();
    persist_turn(db, &session);
    set_state(job, |s| {
        s.activity = None;
    });
    let _ = db.read().map(|guard| {
        let _ = guard.log_audit(
            "agent_run",
            "agent_session",
            &session.id,
            None,
            Some(serde_json::json!({ "turns": turn.turns_used })),
        );
    });
}

enum ToolOutcome {
    /// Keep looping with this tool output appended.
    Continue(String),
    /// Stop the run (cancelled, fatal denial, finished subagent edge).
    Stop,
}

/// Permission-check, approval-park and execute one tool call.
#[allow(clippy::too_many_arguments)]
fn run_one_tool(
    db: &Arc<RwLock<Database>>,
    job: &Arc<AgentJob>,
    config: &AgentConfig,
    root: &Path,
    vol: &Path,
    mcp: &mut McpSet,
    turn: &agent_loop::AgentTurn,
    call: &ToolCall,
    mem: &MemoryCtx,
) -> ToolOutcome {
    // Nested subagents run a bounded inline loop — no registry, no parking.
    if call.name == "task" {
        return run_subagent(db, job, config, root, vol, turn, call);
    }

    let decision = agent_config::decide(
        &config.permission,
        config.agent_kind,
        &call.name,
        &call.input,
    );
    match decision {
        agent_config::PermissionDecision::Allow => {}
        agent_config::PermissionDecision::Deny { reason } => {
            return ToolOutcome::Continue(format!(
                "{reason} — adjust the permission ruleset to allow it"
            ));
        }
        agent_config::PermissionDecision::Ask { summary } => {
            if config.auto_approve {
                // Auto mode approves asks, never denies.
            } else {
                let question = if call.name == "question" {
                    call.input
                        .get("question")
                        .and_then(|q| q.as_str())
                        .map(str::to_string)
                } else {
                    None
                };
                set_state(job, |s| {
                    s.status = "waiting_approval".to_string();
                    s.pending = Some(PendingApproval {
                        tool: call.name.clone(),
                        input: call.input.clone(),
                        summary: summary.clone(),
                        question,
                    });
                    s.activity = Some("waiting for your approval".to_string());
                });
                match wait_approval(job) {
                    Some(answer) if answer.approved => {
                        set_state(job, |s| {
                            s.status = "running".to_string();
                            s.pending = None;
                            s.activity = Some(call.name.clone());
                        });
                        if call.name == "question" {
                            let text = answer
                                .answer
                                .filter(|a| !a.trim().is_empty())
                                .unwrap_or_else(|| "approved without comment".to_string());
                            return ToolOutcome::Continue(format!("user answered: {text}"));
                        }
                    }
                    Some(answer) => {
                        set_state(job, |s| {
                            s.status = "running".to_string();
                            s.pending = None;
                        });
                        let feedback = answer
                            .answer
                            .filter(|a| !a.trim().is_empty())
                            .map(|a| format!(" — user feedback: {a}"))
                            .unwrap_or_default();
                        return ToolOutcome::Continue(format!(
                            "denied: user rejected `{}`{feedback} — work around it or explain",
                            call.name
                        ));
                    }
                    None => {
                        if job.cancel.load(Ordering::SeqCst) {
                            set_state(job, |s| {
                                s.status = "cancelled".to_string();
                                s.pending = None;
                            });
                            return ToolOutcome::Stop;
                        }
                        set_state(job, |s| {
                            s.status = "running".to_string();
                            s.pending = None;
                        });
                        return ToolOutcome::Continue(format!(
                            "denied: approval for `{}` timed out after {}s",
                            call.name, APPROVAL_TIMEOUT_SECS
                        ));
                    }
                }
            }
        }
    }

    if call.name == "question" {
        // Auto mode cannot answer questions — say so honestly.
        return ToolOutcome::Continue("declined: auto-approve cannot answer questions".to_string());
    }

    // Namespaced MCP tools run on the live per-run connection set.
    if mcp_proto::split_tool_name(&call.name).is_some() {
        let output = match mcp_call(mcp, &call.name, &call.input, &job.cancel) {
            Ok(output) => output,
            Err(e) if e == "cancelled" => {
                set_state(job, |s| {
                    s.status = "cancelled".to_string();
                    s.pending = None;
                });
                return ToolOutcome::Stop;
            }
            Err(e) if mcp_call_error_is_breach(&e) => {
                // One reconnect, then one retry — a restarted server
                // rejoins mid-run instead of failing every later call.
                match reconnect_mcp(mcp, &config.mcp_servers, &call.name) {
                    Ok(()) => match mcp_call(mcp, &call.name, &call.input, &job.cancel) {
                        Ok(output) => output,
                        Err(e) => format!("error: {e}"),
                    },
                    Err(_) => format!("error: {e}"),
                }
            }
            Err(e) => format!("error: {e}"),
        };
        return ToolOutcome::Continue(clean_output(output));
    }

    let guard = match db.read() {
        Ok(guard) => guard,
        Err(e) => return ToolOutcome::Continue(format!("error: database unavailable: {e}")),
    };
    match exec_tool(&guard, root, vol, call, mem, config.shell_mode) {
        Ok(output) => {
            let mut output = output;
            if output.len() > TOOL_OUTPUT_CAP {
                output.truncate(TOOL_OUTPUT_CAP);
                output.push_str("\n… truncated at 64 KiB");
            }
            ToolOutcome::Continue(output)
        }
        Err(e) => ToolOutcome::Continue(format!("error: {e}")),
    }
}

/// Inline bounded subagent: same config, read-only tool subset, short leash.
/// Shares the parent transcript afterwards as one summarized tool result.
#[allow(clippy::too_many_arguments)]
fn run_subagent(
    db: &Arc<RwLock<Database>>,
    job: &Arc<AgentJob>,
    config: &AgentConfig,
    root: &Path,
    vol: &Path,
    turn: &agent_loop::AgentTurn,
    call: &ToolCall,
) -> ToolOutcome {
    if turn.task_depth >= agent_loop::MAX_TASK_DEPTH {
        return ToolOutcome::Continue(
            "deny: max subagent depth reached — finish this level yourself".to_string(),
        );
    }
    let decision = agent_config::decide(&config.permission, config.agent_kind, "task", &call.input);
    if matches!(decision, agent_config::PermissionDecision::Deny { .. }) {
        return ToolOutcome::Continue(
            "deny: `task` is denied by the permission ruleset".to_string(),
        );
    }
    if !config.auto_approve {
        // Subagents spawn workers — always ask first unless auto mode.
        set_state(job, |s| {
            s.status = "waiting_approval".to_string();
            s.pending = Some(PendingApproval {
                tool: "task".into(),
                input: call.input.clone(),
                summary: "Spawn a subagent for this goal?".into(),
                question: None,
            });
            s.activity = Some("waiting to spawn a subagent".to_string());
        });
        match wait_approval(job) {
            Some(answer) if answer.approved => {
                set_state(job, |s| {
                    s.status = "running".to_string();
                    s.pending = None;
                    s.activity = Some("subagent · running".to_string());
                });
            }
            Some(_) => {
                set_state(job, |s| {
                    s.status = "running".to_string();
                    s.pending = None;
                });
                return ToolOutcome::Continue("denied: user rejected the subagent".to_string());
            }
            None => {
                set_state(job, |s| {
                    s.status = "running".to_string();
                    s.pending = None;
                });
                return ToolOutcome::Continue("denied: subagent approval timed out".to_string());
            }
        }
    }

    let goal = call
        .input
        .get("goal")
        .and_then(|g| g.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if goal.is_empty() {
        return ToolOutcome::Continue("invalid: task needs a goal".to_string());
    }
    let endpoint = match providers::resolve(config) {
        Ok(endpoint) => endpoint,
        Err(e) => return ToolOutcome::Continue(format!("error: {e}")),
    };
    let api_key = match db
        .read()
        .ok()
        .and_then(|guard| load_key(&guard, &config.id).ok())
    {
        Some(key) => key,
        None => return ToolOutcome::Continue("error: database unavailable".to_string()),
    };
    let context = call
        .input
        .get("context")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let mut sub = agent_loop::AgentTurn::new(
        vec![cybermanju_types::agent::ChatMessage {
            role: "user".into(),
            content: format!("Subagent goal: {goal}\nContext: {context}"),
            tool_call_id: None,
            tool_name: None,
            tool_input: None,
        }],
        SUBAGENT_MAX_TURNS,
        turn.task_depth + 1,
    );
    let system = format!(
        "{}{}\nSUBAGENT TOOLSET: this run has `read`, `list` and `grep` only — no edit, \
        write, bash, task or question. Investigate and report; the parent acts on it.",
        agent_loop::system_prompt(
            &root.to_string_lossy(),
            "build",
            &repo_overview(root),
            agent_loop::Sandbox::Native,
            config.shell_mode
        ),
        load_project_rules(root)
    );
    let headers = endpoint_headers(&endpoint, &api_key);
    let model = config.model.clone();
    let mut summary = String::from("(subagent produced no text)");
    for _ in 0..SUBAGENT_MAX_TURNS {
        if job.cancel.load(Ordering::SeqCst) {
            return ToolOutcome::Continue("subagent cancelled with the parent run".to_string());
        }
        let (mut url, headers, mut body) = sub.build_request(
            &endpoint.base_url,
            endpoint.dialect,
            &model,
            &system,
            headers.clone(),
            true,
        );
        if endpoint.auth == cybermanju_types::agent::AuthScheme::Query {
            let name = endpoint.auth_name.as_deref().unwrap_or("key");
            url = protocol::with_query_key(&url, name, &api_key);
        }
        // Strip mutating tools: subagents read and report. The read-only
        // allowlist runs first, then the shared ruleset strip (a
        // default-deny parent strips even reads it did not allow — the
        // runtime gate would deny them anyway, so the schema stays
        // honest). An emptied `tools` key is removed with `tool_choice`.
        if let Some(tools) = body.get_mut("tools").and_then(|t| t.as_array_mut()) {
            let keep = |name: &str| matches!(name, "read" | "list" | "grep");
            tools.retain(|t| {
                t.get("function")
                    .and_then(|f| f.get("name"))
                    .or_else(|| t.get("name"))
                    .and_then(|n| n.as_str())
                    .map(keep)
                    .unwrap_or(false)
            });
            if tools.is_empty() {
                if let Some(obj) = body.as_object_mut() {
                    obj.remove("tools");
                    obj.remove("tool_choice");
                }
            }
        }
        agent_config::strip_denied_tools(&mut body, &config.permission, config.agent_kind);
        if endpoint.dialect == LlmDialect::Anthropic {
            anthropic_cache(&mut body);
        }
        let reply = match post_with_retry(&job.cancel, &url, &headers, &body) {
            Ok(reply) => reply,
            Err(e) if e == "cancelled" => {
                return ToolOutcome::Continue("subagent cancelled with the parent run".to_string())
            }
            Err(e) => return ToolOutcome::Continue(format!("subagent transport failed: {e}")),
        };
        if job.cancel.load(Ordering::SeqCst) {
            return ToolOutcome::Continue("subagent cancelled with the parent run".to_string());
        }
        match sub.ingest_reply(endpoint.dialect, &reply) {
            Ok(agent_loop::LoopEvent::TextDone) => {
                let text = sub
                    .messages
                    .iter()
                    .rev()
                    .find(|m| m.role == "assistant")
                    .map(|m| m.content.clone())
                    .unwrap_or(summary);
                summary = if sub.last_finish == "length" {
                    format!("{text}\n(truncated: subagent hit max tokens)")
                } else {
                    text
                };
                break;
            }
            Ok(agent_loop::LoopEvent::ToolCalls(calls)) => {
                for call in &calls {
                    // Belt and braces: the stripped schema above plus a
                    // runtime gate — a subagent never mutates.
                    let output = match call.name.as_str() {
                        "read" | "list" | "grep" => {
                            let guard = match db.read() {
                                Ok(guard) => guard,
                                Err(e) => {
                                    sub.append_tool_result(
                                        call,
                                        format!("error: database unavailable: {e}"),
                                    );
                                    continue;
                                }
                            };
                            // Subagents report — the `memory_remember` arm
                            // denies stores even if the schema ever leaks one.
                            let mem_ctx = MemoryCtx {
                                endpoint: &endpoint,
                                api_key: &api_key,
                                cancel: &job.cancel,
                                config_id: &config.id,
                                session_id: &job.session_id,
                                embedding_model: embedding_model(config),
                                allow_remember: false,
                            };
                            match exec_tool(&guard, root, vol, call, &mem_ctx, config.shell_mode) {
                                Ok(output) => clean_output(output),
                                Err(e) => format!("error: {e}"),
                            }
                        }
                        other => format!("deny: subagents cannot run `{other}`"),
                    };
                    sub.append_tool_result(call, output);
                }
            }
            Ok(agent_loop::LoopEvent::LimitReached) | Err(_) => break,
        }
    }
    let short: String = summary.chars().take(4000).collect();
    ToolOutcome::Continue(format!("subagent result:\n{short}"))
}

// ─── cybsh `ai …` (lockless REST intercept) ────────────────────────────────

/// Terminal-shaped answer for `POST /api/os/exec` agent lines. A command
/// that ran and failed is still HTTP 200 with `ok: false` — the terminal
/// renders the message instead of failing the request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiExecResult {
    ok: bool,
    line: String,
    output: String,
    prompt: &'static str,
}

fn ai_ok(line: String, output: String, origin: Option<&str>) -> String {
    crate::json_ok(
        &AiExecResult {
            ok: true,
            line,
            output,
            prompt: "cybsh> ",
        },
        origin,
    )
}

fn ai_err(line: String, output: String, origin: Option<&str>) -> String {
    crate::json_ok(
        &AiExecResult {
            ok: false,
            line,
            output,
            prompt: "cybsh> ",
        },
        origin,
    )
}

/// Dispatch one `ai …` terminal line without holding the request lock.
///
/// Called from `route_request` before any lock is taken (job start spawns a
/// worker that takes its own locks; the registry itself is process-global).
/// Returns `None` for non-`ai` lines so they flow to the normal locked path.
///
/// P0-10: `owner_id`/`is_admin` come from the JWT claims — jobs started
/// here are owned by the caller, and status/abort only see the caller's
/// own jobs (admins see all).
pub fn try_ai_exec(
    shared: &Arc<RwLock<Database>>,
    body: &str,
    origin: Option<&str>,
    owner_id: &str,
    is_admin: bool,
) -> Option<String> {
    #[derive(Deserialize)]
    struct ExecLine {
        #[serde(default)]
        line: String,
    }
    let req: ExecLine = serde_json::from_str(body).ok()?;
    let parsed = cybermanju_os::shell::parse_ai_command(&req.line)?;
    let line = req.line.clone();

    match parsed {
        cybermanju_os::shell::AiCommand::Ask {
            prompt,
            config_id,
            session_id,
        } => {
            let config_id = match config_id {
                Some(id) => id,
                None => {
                    let guard = shared.read().ok()?;
                    let configs = list_configs(&guard).ok()?;
                    drop(guard);
                    match configs.into_iter().next().map(|c| c.id) {
                        Some(id) => id,
                        None => {
                            return Some(ai_err(
                                line,
                                "no agent configs — create one in the Agent panel first"
                                    .to_string(),
                                origin,
                            ))
                        }
                    }
                }
            };
            match start_job_as(shared, &config_id, session_id, prompt, owner_id) {
                Ok(job) => Some(ai_ok(
                    line,
                    format!(
                        "started agent job {} (session {}) — poll with `ai status`",
                        job.job_id, job.session_id
                    ),
                    origin,
                )),
                Err(message) => Some(ai_err(line, message, origin)),
            }
        }
        cybermanju_os::shell::AiCommand::Status { job_id } => {
            let snapshot = match job_id {
                Some(id) => job_status_for(&id, owner_id, is_admin).ok(),
                None => list_jobs_for(owner_id, is_admin)
                    .into_iter()
                    .find(|j| j.status == "running" || j.status == "waiting_approval"),
            };
            match snapshot {
                Some(job) => Some(ai_ok(
                    line,
                    format!(
                        "job {} · {} · turn {}/{} · in {} out {} tokens{}",
                        job.job_id,
                        job.status,
                        job.turns_used,
                        job.max_turns,
                        job.usage.input_tokens,
                        job.usage.output_tokens,
                        job.error
                            .as_ref()
                            .map(|e| format!(" · error: {e}"))
                            .unwrap_or_default(),
                    ),
                    origin,
                )),
                None => Some(ai_ok(line, "no agent jobs running".to_string(), origin)),
            }
        }
        cybermanju_os::shell::AiCommand::Abort { job_id } => {
            let id = match job_id {
                Some(id) => id,
                None => match list_jobs_for(owner_id, is_admin)
                    .into_iter()
                    .find(|j| j.status == "running" || j.status == "waiting_approval")
                {
                    Some(job) => job.job_id,
                    None => {
                        return Some(ai_ok(
                            line,
                            "no running agent job to abort".to_string(),
                            origin,
                        ))
                    }
                },
            };
            match abort_job_for(&id, owner_id, is_admin) {
                Ok(true) => Some(ai_ok(line, format!("agent job {id} aborted"), origin)),
                Ok(false) => Some(ai_ok(
                    line,
                    format!("agent job {id} already finished"),
                    origin,
                )),
                Err(message) => Some(ai_err(line, message, origin)),
            }
        }
        cybermanju_os::shell::AiCommand::Sessions => {
            let guard = shared.read().ok()?;
            match list_sessions(&guard) {
                Ok(sessions) if sessions.is_empty() => Some(ai_ok(
                    line,
                    "no agent sessions yet — `ai ask \"…\"` starts one".to_string(),
                    origin,
                )),
                Ok(sessions) => {
                    let mut out = format!("{} session(s):\n", sessions.len());
                    for session in sessions.iter().take(20) {
                        out.push_str(&format!(
                            "  {} · {} · {} msgs · {}\n",
                            session.id,
                            session.title,
                            session.messages.len(),
                            session.updated_at,
                        ));
                    }
                    Some(ai_ok(line, out.trim_end().to_string(), origin))
                }
                Err(message) => Some(ai_err(line, message, origin)),
            }
        }
        cybermanju_os::shell::AiCommand::Init { config_id } => {
            let config_id = match config_id {
                Some(id) => id,
                None => {
                    let guard = shared.read().ok()?;
                    let configs = list_configs(&guard).ok()?;
                    drop(guard);
                    match configs.into_iter().next().map(|c| c.id) {
                        Some(id) => id,
                        None => {
                            return Some(ai_err(
                                line,
                                "no agent configs — create one in the Agent panel first"
                                    .to_string(),
                                origin,
                            ))
                        }
                    }
                }
            };
            match start_init_job_as(shared, &config_id, owner_id) {
                Ok(job) => Some(ai_ok(
                    line,
                    format!(
                        "started repo-init job {} — the agent will write AGENTS.md; poll with `ai status`",
                        job.job_id
                    ),
                    origin,
                )),
                Err(message) => Some(ai_err(line, message, origin)),
            }
        }
    }
}

// ─── session compaction ────────────────────────────────────────────────────

/// Render a transcript slice for a handoff summary: `ROLE: excerpt` lines,
/// newest kept preferentially under an 80 KiB cap.
fn render_handoff(messages: &[ChatMessage]) -> String {
    const PER_MESSAGE_CAP: usize = 1000;
    const TOTAL_CAP: usize = 80_000;
    let mut lines: Vec<String> = Vec::new();
    let mut bytes = 0usize;
    for message in messages.iter().rev() {
        let role = message.role.to_uppercase();
        let excerpt: String = message.content.chars().take(PER_MESSAGE_CAP).collect();
        let mut line = if let Some(name) = message.tool_name.as_deref() {
            format!("{role}({name}): {excerpt}")
        } else {
            format!("{role}: {excerpt}")
        };
        if message.role == "assistant_tool" {
            if let Some(input) = message.tool_input.as_ref() {
                let calls: String = serde_json::to_string(input)
                    .unwrap_or_default()
                    .chars()
                    .take(500)
                    .collect();
                line.push_str(&format!(" [calls {calls}]"));
            }
        }
        if bytes + line.len() > TOTAL_CAP {
            break;
        }
        bytes += line.len();
        lines.push(line);
        if lines.len() >= 400 {
            break;
        }
    }
    lines.reverse();
    lines.join("\n")
}

/// Compact a session: one no-tools turn summarizes the transcript into a
/// fresh session. The old session is kept untouched (reopen it to revert).
/// Lock-free by construction — only brief reads and one terminal write, so
/// the ROUTES call this from the lockless block like `prompt`.
pub fn compact_session(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    session_id: &str,
) -> Result<AgentSession, String> {
    compact_session_for(db, config_id, session_id, "", true)
}

/// Owner-bound compaction for the REST transport: only the transcript owner
/// (or an admin) may summarize someone else's session.
pub fn compact_session_for(
    db: &Arc<RwLock<Database>>,
    config_id: &str,
    session_id: &str,
    requester: &str,
    is_admin: bool,
) -> Result<AgentSession, String> {
    let (config, key, session) = {
        let guard = db.read().map_err(|e| e.to_string())?;
        let config = get_config(&guard, config_id)?;
        let key = load_key(&guard, config_id)?;
        let session = get_session(&guard, session_id)?;
        check_session_owner(&session, requester, is_admin)?;
        (config, key, session)
    };
    if session.messages.is_empty() {
        return Err("invalid: session has no messages to compact".to_string());
    }
    let endpoint = providers::resolve(&config)?;
    if !endpoint.keyless && key.is_empty() {
        return Err("auth: no API key saved for this config — add one first".to_string());
    }
    let handoff = render_handoff(&session.messages);
    let mut turn = agent_loop::AgentTurn::new(
        vec![ChatMessage {
            role: "user".into(),
            content: format!(
                "Summarize this coding session into a handoff for a fresh agent: \
                 decisions made, files changed, errors seen, and the next concrete step. \
                 Be specific with file paths and tool results.\n\nTRANSCRIPT:\n{handoff}"
            ),
            tool_call_id: None,
            tool_name: None,
            tool_input: None,
        }],
        1,
        0,
    );
    let system =
        "You compress session transcripts into actionable handoffs. Output the summary only.";
    let headers = endpoint_headers(&endpoint, &key);
    let (mut url, headers, mut body) = turn.build_request(
        &endpoint.base_url,
        endpoint.dialect,
        &config.model,
        system,
        headers,
        false,
    );
    if endpoint.dialect == LlmDialect::Anthropic {
        anthropic_cache(&mut body);
    }
    if endpoint.auth == cybermanju_types::agent::AuthScheme::Query {
        let name = endpoint.auth_name.as_deref().unwrap_or("key");
        url = protocol::with_query_key(&url, name, &key);
    }
    let cancel = AtomicBool::new(false);
    let reply = post_with_retry(&cancel, &url, &headers, &body)?;
    match turn.ingest_reply(endpoint.dialect, &reply)? {
        agent_loop::LoopEvent::TextDone => {}
        other => {
            return Err(format!(
                "integrity: compaction turn ended unexpectedly: {other:?}"
            ));
        }
    }
    let summary = turn
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "assistant")
        .map(|m| m.content.clone())
        .unwrap_or_default();
    if summary.trim().is_empty() {
        return Err("integrity: compaction produced an empty summary".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let compacted = AgentSession {
        id: uuid::Uuid::new_v4().to_string(),
        title: format!(
            "{} (compacted)",
            session.title.chars().take(48).collect::<String>()
        ),
        config_id: session.config_id.clone(),
        provider_id: session.provider_id.clone(),
        model: session.model.clone(),
        agent_kind: session.agent_kind,
        working_dir: session.working_dir.clone(),
        owner_id: session.owner_id.clone(),
        messages: vec![ChatMessage {
            role: "user".into(),
            content: format!("Previous session summary (compacted at {now}):\n{summary}"),
            tool_call_id: None,
            tool_name: None,
            tool_input: None,
        }],
        usage: TokenUsage {
            input_tokens: session.usage.input_tokens + turn.usage.input_tokens,
            output_tokens: session.usage.output_tokens + turn.usage.output_tokens,
        },
        created_at: now.clone(),
        updated_at: now,
    };
    {
        let guard = db.read().map_err(|e| e.to_string())?;
        save_session_row(&guard, &compacted)?;
    }
    // The handoff doubles as long-term memory: future recalls find what the
    // compacted session learned even though its transcript is gone. Best
    // effort — memory must never break compaction.
    {
        let model = embedding_model(&config);
        let cancel = AtomicBool::new(false);
        if let Ok(guard) = db.read() {
            let _ = prepare_memory(
                &cancel,
                &endpoint,
                &key,
                &session.config_id,
                Some(compacted.id.clone()),
                &summary,
                MemoryOrigin::CompactHandoff,
                &model,
            )
            .and_then(|m| save_memory_row(&guard, &m));
        }
    }
    Ok(compacted)
}

// ─── MCP management ────────────────────────────────────────────────────────

/// Attach an MCP server to a config (validated, not connected yet).
/// Admin-gated at the route: stdio entries spawn processes.
pub fn mcp_add(
    db: &Database,
    config_id: &str,
    name: String,
    server: McpServerConfig,
) -> Result<AgentConfig, String> {
    let name = name.trim();
    if !mcp_proto::valid_server_name(name) {
        return Err(format!("invalid: bad MCP server name '{name}'"));
    }
    server.validate()?;
    let mut config = get_config(db, config_id)?;
    config.mcp_servers.insert(name.to_string(), server);
    save_config(db, config)
}

/// Detach an MCP server from a config.
pub fn mcp_remove(db: &Database, config_id: &str, name: &str) -> Result<AgentConfig, String> {
    let mut config = get_config(db, config_id)?;
    if config.mcp_servers.remove(name).is_none() {
        return Err(format!("not_found: MCP server '{name}' is not attached"));
    }
    save_config(db, config)
}

/// Connect every enabled server on a config and list their tools.
/// Short-lived connections: connected, listed, dropped.
pub fn mcp_tools(db: &Database, config_id: &str) -> Result<Vec<McpToolView>, String> {
    let config = get_config(db, config_id)?;
    mcp_tools_for(&config)
}

/// Same as `mcp_tools` but from an already-loaded config — the lockless
/// routes use this so process spawns never hold the request lock.
pub fn mcp_tools_for(config: &AgentConfig) -> Result<Vec<McpToolView>, String> {
    let mut out = Vec::new();
    // Same effective map as a run: stored servers + keyless Exa default.
    let mut effective = config.mcp_servers.clone();
    cybermanju_types::agent::ensure_default_mcp_servers(&mut effective);
    for (name, server) in &effective {
        if !server.enabled {
            continue;
        }
        let (_conn, tools) =
            mcp_connect(name, server).map_err(|e| format!("MCP server '{name}' failed: {e}"))?;
        for tool in tools {
            out.push(McpToolView {
                server: name.clone(),
                name: mcp_proto::tool_name(name, &tool.name),
                description: tool.description,
            });
        }
        if out.len() >= 256 {
            break;
        }
    }
    out.sort_by(|a, b| (&a.server, &a.name).cmp(&(&b.server, &b.name)));
    Ok(out)
}
