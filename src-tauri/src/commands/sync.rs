use std::sync::Arc;
use tauri::State;

pub use cybermanju_sync::SyncState;

use crate::sync::models::*;
use crate::AppState;

// ---------------------------------------------------------------------------
// Tauri commands (thin wrappers over the shared sync API)
// ---------------------------------------------------------------------------

/// List all saved sync configurations.
#[tauri::command]
pub fn list_sync_configs(state: State<'_, AppState>) -> Result<Vec<SyncConfig>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::sync_api::list_configs(&db)
}

/// Create (or save) a sync configuration.
#[tauri::command]
pub fn create_sync_config(
    config: SyncConfig,
    state: State<'_, AppState>,
) -> Result<SyncConfig, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::sync_api::save_config(&db, config)
}

/// Delete a sync configuration by ID.
#[tauri::command]
pub fn delete_sync_config(config_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::sync_api::delete_config(&db, &config_id)
}

/// Start a sync operation for the given config and file IDs.
///
/// The shared implementation releases the database lock before the pipeline
/// runs: the pipeline acquires its own locks per file, so holding one here
/// would deadlock.
#[tauri::command]
pub fn start_sync(
    config_id: String,
    file_ids: Vec<String>,
    state: State<'_, AppState>,
    sync_state: State<'_, Arc<SyncState>>,
) -> Result<SyncResult, String> {
    cybermanju_web::api::sync_api::start(
        &state.db,
        &state.compression,
        &sync_state,
        &config_id,
        file_ids,
    )
}

/// Get the current sync progress.
///
/// Also arms the auto-sync scheduler (item 11) — the desktop polls this
/// command, so the first poll starts the background scan exactly like the
/// REST routes do.
#[tauri::command]
pub fn get_sync_progress(
    sync_state: State<'_, Arc<SyncState>>,
    state: State<'_, AppState>,
) -> Result<SyncProgress, String> {
    cybermanju_sync::scheduler::ensure_started(Arc::clone(&state.db));
    Ok(cybermanju_web::api::sync_api::progress(&sync_state))
}

/// Test the connection for a sync configuration.
#[tauri::command]
pub fn test_sync_connection(config: SyncConfig) -> Result<bool, String> {
    cybermanju_web::api::sync_api::test_connection(&config)
}

/// Cancel the current sync operation.
#[tauri::command]
pub fn cancel_sync(sync_state: State<'_, Arc<SyncState>>) -> Result<bool, String> {
    Ok(cybermanju_web::api::sync_api::cancel(&sync_state))
}

/// List files on the remote backend.
#[tauri::command]
pub fn list_remote_files(config: SyncConfig, prefix: String) -> Result<Vec<RemoteFile>, String> {
    cybermanju_web::api::sync_api::list_remote_files(&config, &prefix)
}

// ---------------------------------------------------------------------------
// <<< AGENT-2 RESTORE / JOBS: the desktop half of the item-7 contract. >>>
// ---------------------------------------------------------------------------

/// Restore a synced copy: download → verify → decrypt/decompress → write.
#[tauri::command]
pub fn restore_sync_file(
    config_id: String,
    file_id: Option<String>,
    remote_path: Option<String>,
    dest_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<cybermanju_web::api::sync_api::RestoreOutcome, String> {
    cybermanju_web::api::sync_api::restore(
        &state.db,
        cybermanju_web::api::sync_api::RestoreRequest {
            config_id,
            file_id,
            remote_path,
            dest_path,
        },
    )
}

/// Delete a remote object (`unsupported:` providers surface as an error,
/// never a fake success).
#[tauri::command]
pub fn delete_remote_file(
    config_id: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    cybermanju_web::api::sync_api::delete_remote(
        &state.db,
        cybermanju_web::api::sync_api::RemoteDeleteRequest {
            config_id,
            remote_path,
        },
    )
}

/// Status/progress/result of one run by id (memory, then `sync_runs`).
#[tauri::command]
pub fn get_sync_job(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<cybermanju_web::api::sync_api::SyncJob, String> {
    cybermanju_web::api::sync_api::job(&state.db, &job_id)
}

/// Run history (newest first) for the sync history UI.
#[tauri::command]
pub fn list_sync_runs(state: State<'_, AppState>) -> Result<Vec<SyncRunRecord>, String> {
    cybermanju_web::api::sync_api::runs(&state.db, 20)
}

/// Create a new private vault repository on GitHub/GitLab.
///
/// Resolves the provider token from the explicit paste or from the stored
/// secret of `configId`, then calls the provider "create repo" endpoint.
/// Returns what the frontend stores in `SyncConfig.repo_name`.
#[tauri::command]
pub fn create_provider_repo(
    backend_type: String,
    config_id: Option<String>,
    token: Option<String>,
    name: String,
    private: Option<bool>,
    description: Option<String>,
    branch: Option<String>,
    base_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<cybermanju_sync::CreatedRepo, String> {
    cybermanju_web::api::sync_api::create_repo(
        &state.db,
        cybermanju_web::api::sync_api::CreateRepoRequest {
            backend_type,
            config_id,
            token,
            name,
            private: private.unwrap_or(true),
            description,
            branch,
            base_path,
        },
    )
}

/// Seed a vault repo with bootstrap files (README, manifest, exported
/// `.cybermanju` bytes as base64) through the provider sync backend.
#[tauri::command]
pub fn seed_repo_files(
    config: SyncConfig,
    files: Vec<cybermanju_web::api::sync_api::SeedFile>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let _ = state;
    cybermanju_web::api::sync_api::seed_repo(cybermanju_web::api::sync_api::SeedRepoRequest {
        config,
        files,
    })
}
