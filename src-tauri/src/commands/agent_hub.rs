// CyberManju OS — Agent Hub commands (src-tauri/src/commands/agent_hub.rs).
// Role: trusted-local IPC for profiles, conversations, events and delegated runs.
// Exports: hub_list_profiles, hub_save_profile, hub_create_conversation,
//   hub_list_conversations, hub_list_events, hub_send_message, hub_get_run.
// Integrates: AppState's separate AgentHubStore and original provider database.
// Contracts: owner is host-assigned `local`; no tools or private history inherited.

use crate::AppState;
use cybermanju_types::agent_hub::{
    AgentProfile, Conversation, CreateConversation, DelegatedRun, HubEvent, ProfileInput,
    SendMessage, SendReceipt,
};
use tauri::State;

const OWNER: &str = "local";

#[tauri::command(async)]
pub fn hub_list_profiles(state: State<'_, AppState>) -> Result<Vec<AgentProfile>, String> {
    state.agent_hub.profiles(OWNER)
}

#[tauri::command(async)]
pub fn hub_save_profile(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<AgentProfile, String> {
    let db = state
        .db
        .read()
        .map_err(|_| "integrity: provider database lock unavailable".to_string())?;
    cybermanju_web::api::agent_hub_api::save_profile(&db, &state.agent_hub, OWNER, input)
}

#[tauri::command(async)]
pub fn hub_create_conversation(
    input: CreateConversation,
    state: State<'_, AppState>,
) -> Result<Conversation, String> {
    state.agent_hub.create_conversation(OWNER, input)
}

#[tauri::command(async)]
pub fn hub_list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state.agent_hub.conversations(OWNER)
}

#[tauri::command(async)]
pub fn hub_list_events(
    conversation_id: String,
    after_seq: Option<u64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<HubEvent>, String> {
    state.agent_hub.events(
        OWNER,
        &conversation_id,
        after_seq.unwrap_or(0),
        limit.unwrap_or(100).clamp(1, 500),
    )
}

#[tauri::command(async)]
pub fn hub_send_message(
    input: SendMessage,
    state: State<'_, AppState>,
) -> Result<SendReceipt, String> {
    cybermanju_web::api::agent_hub_api::send(
        state.db.clone(),
        state.agent_hub.clone(),
        OWNER,
        input,
    )
}

#[tauri::command(async)]
pub fn hub_get_run(run_id: String, state: State<'_, AppState>) -> Result<DelegatedRun, String> {
    state
        .agent_hub
        .run(OWNER, &run_id)?
        .ok_or_else(|| "not_found: run not found".into())
}
