use tauri::State;

use crate::AppState;

// ---------------------------------------------------------------------------
// Tauri commands (thin wrappers over the shared agent API)
// ---------------------------------------------------------------------------

/// List provider presets (endpoints, families, default models).
#[tauri::command]
pub fn list_agent_providers() -> Result<Vec<cybermanju_types::agent::ProviderPreset>, String> {
    Ok(cybermanju_agent::providers::all_presets())
}

/// List saved agent configs (keyless rows, `hasKey` only).
#[tauri::command]
pub fn list_agent_configs(
    state: State<'_, AppState>,
) -> Result<Vec<cybermanju_types::agent::AgentConfig>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::list_configs(&db)
}

/// Create or overwrite an agent config.
#[tauri::command]
pub fn save_agent_config(
    config: cybermanju_types::agent::AgentConfig,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentConfig, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::save_config(&db, config)
}

/// Delete an agent config and its sealed key.
#[tauri::command]
pub fn delete_agent_config(config_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::delete_config(&db, &config_id)
}

/// Seal a provider key for a config (never echoed back).
#[tauri::command]
pub fn save_agent_key(
    config_id: String,
    api_key: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::save_key(&db, &config_id, &api_key)
}

/// Refresh the model list from the provider.
#[tauri::command]
pub fn list_agent_models(
    config_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::list_models(&db, &config_id)
}

/// List sessions (newest first).
#[tauri::command]
pub fn list_agent_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<cybermanju_types::agent::AgentSession>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::list_sessions(&db)
}

/// Load one session transcript.
#[tauri::command]
pub fn get_agent_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentSession, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::get_session(&db, &session_id)
}

/// Create a session bound to a config snapshot.
#[tauri::command]
pub fn create_agent_session(
    config_id: String,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentSession, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::create_session(&db, &config_id, title)
}

/// Import a session transcript (re-keyed server-side).
#[tauri::command]
pub fn import_agent_session(
    session: cybermanju_types::agent::AgentSession,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentSession, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::import_session(&db, session)
}

/// Delete a session.
#[tauri::command]
pub fn delete_agent_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::delete_session(&db, &session_id)
}

/// Start a detached agent run; returns immediately with a job snapshot.
/// Poll with `agent_job_status`; cancel with `abort_agent_job`.
#[tauri::command]
pub fn start_agent_run(
    config_id: String,
    session_id: Option<String>,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_web::api::agent_api::JobSnapshot, String> {
    cybermanju_web::api::agent_api::start_job(&state.db, &config_id, session_id, prompt)
}

/// Poll one job.
#[tauri::command]
pub fn agent_job_status(
    job_id: String,
) -> Result<cybermanju_web::api::agent_api::JobSnapshot, String> {
    cybermanju_web::api::agent_api::job_status(&job_id)
}

/// List known jobs (newest first).
#[tauri::command]
pub fn list_agent_jobs() -> Result<Vec<cybermanju_web::api::agent_api::JobSnapshot>, String> {
    Ok(cybermanju_web::api::agent_api::list_jobs())
}

/// Request cancellation (idempotent).
#[tauri::command]
pub fn abort_agent_job(job_id: String) -> Result<bool, String> {
    cybermanju_web::api::agent_api::abort_job(&job_id)
}

/// Start a repository-init run: the agent analyzes the repo and writes
/// AGENTS.md with its own tools (same loop, same permissions).
#[tauri::command]
pub fn init_agent_run(
    config_id: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_web::api::agent_api::JobSnapshot, String> {
    cybermanju_web::api::agent_api::start_init_job(&state.db, &config_id)
}

/// Answer a parked approval or question. With `remember`, an approval also
/// stores "allow always" for that tool in the config (explicit, reversible).
#[tauri::command]
pub fn approve_agent_job(
    job_id: String,
    approved: bool,
    answer: Option<String>,
    remember: Option<bool>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    cybermanju_web::api::agent_api::approve_job(
        &state.db,
        &job_id,
        approved,
        answer,
        remember.unwrap_or(false),
    )
}

/// Compact a session transcript into a fresh session (old kept for revert).
#[tauri::command]
pub fn compact_agent_session(
    config_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentSession, String> {
    cybermanju_web::api::agent_api::compact_session(&state.db, &config_id, &session_id)
}

/// Attach an MCP server to a config (validated, not yet connected).
#[tauri::command]
pub fn mcp_add_server(
    config_id: String,
    name: String,
    server: cybermanju_types::agent::McpServerConfig,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentConfig, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::mcp_add(&db, &config_id, name, server)
}

/// Detach an MCP server from a config.
#[tauri::command]
pub fn mcp_remove_server(
    config_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentConfig, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::mcp_remove(&db, &config_id, &name)
}

/// Connect a config's MCP servers and list their tools.
#[tauri::command]
pub fn mcp_list_tools(
    config_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<cybermanju_web::api::agent_api::McpToolView>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::mcp_tools(&db, &config_id)
}

// ─── semantic memory (thin wrappers; vectors stay server-side) ──────────

/// List long-term memories, newest first (vectors stripped — see export).
#[tauri::command]
pub fn list_agent_memories(
    config_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<cybermanju_types::agent::AgentMemory>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::list_memories(
        &db,
        config_id.as_deref().filter(|s| !s.is_empty()),
        false,
    )
}

/// Store one durable fact (sanitized, embedded when possible).
#[tauri::command]
pub fn store_agent_memory(
    config_id: String,
    session_id: Option<String>,
    text: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_types::agent::AgentMemory, String> {
    cybermanju_web::api::agent_api::store_memory_entry(&state.db, &config_id, session_id, &text)
}

/// Hybrid recall over one config (`config_id`) or every config (keyword-only
/// when unset).
#[tauri::command]
pub fn recall_agent_memories(
    config_id: Option<String>,
    query: String,
    top_k: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<cybermanju_types::agent::MemoryHit>, String> {
    cybermanju_web::api::agent_api::recall_memory_entries(
        &state.db,
        config_id.as_deref().filter(|s| !s.is_empty()),
        &query,
        top_k.unwrap_or(3) as usize,
    )
}

/// Delete one memory by id.
#[tauri::command]
pub fn delete_agent_memory(
    memory_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::agent_api::delete_memory(&db, &memory_id)
}
