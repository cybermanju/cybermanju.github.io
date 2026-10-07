// CyberManju OS — Core Library
// Orchestrates redb, ML-KEM PQC (pqcrypto-mlkem), Tantivy, Tree-sitter, triple compression, face clustering

pub mod commands;
pub mod compression;
pub mod crypto;
pub mod db;
pub mod faces; // ML module: detect_faces_in_file, embedding_distance, cluster_embeddings
pub mod preview;
pub mod search;
pub mod sync;
pub mod tree_sitter; // parse_file, get_symbols (tauri commands)
pub mod web_dashboard;

use commands::faces as face_cmd;
use commands::sync as sync_cmd;
use commands::{
    accounts, audit, batch, collections, dashboard, encryption, files, import as import_cmd, map,
    search as search_cmd, share, trash, users, versions,
};
use db::Database;
use std::sync::{Arc, RwLock};

pub struct AppState {
    /// Shared with the web dashboard so the redb file is only opened once.
    pub db: Arc<RwLock<Database>>,
    /// Shared with the web dashboard so REST search sees live index updates.
    pub tantivy_index: Arc<RwLock<search::SearchIndex>>,
    pub compression: compression::TripleCompressor,
    pub hmac_secret: [u8; 32],
}

// WebDashboard now handles its own shutdown (Drop impl with signal channel + thread join).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing subscriber (replaces env_logger)
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    tracing::info!("CyberManju OS starting...");

    // Initialize redb database (opened exactly once — shared with the web dashboard)
    let db = match Database::new("cybermanju.db") {
        Ok(d) => Arc::new(RwLock::new(d)),
        Err(e) => {
            tracing::error!("Failed to initialize redb database: {}", e);
            std::process::exit(1);
        }
    };
    tracing::info!("redb database initialized");

    // Initialize Tantivy full-text search index
    let tantivy_index = match search::SearchIndex::new("tantivy_index") {
        Ok(i) => i,
        Err(e) => {
            tracing::error!("Failed to initialize Tantivy: {}", e);
            std::process::exit(1);
        }
    };
    tracing::info!("Tantivy search index ready");

    // Initialize triple-layer compressor
    let compressor = compression::TripleCompressor::new();

    // Initialize HMAC secret for secure session tokens
    let mut hmac_secret = [0u8; 32];
    use rand_core::{OsRng, RngCore};
    OsRng.fill_bytes(&mut hmac_secret);

    let state = AppState {
        db: Arc::clone(&db),
        tantivy_index: Arc::new(RwLock::new(tantivy_index)),
        compression: compressor,
        hmac_secret,
    };

    // Dashboard state for connection tracking and lifecycle
    let dashboard_state = Arc::new(dashboard::DashboardState::new());

    // Sync state for progress tracking and cancellation — shared with the web
    // dashboard so REST and Tauri callers observe the same progress.
    let sync_state = Arc::new(sync_cmd::SyncState::new());

    // ─── Start Web Dashboard (localhost-only, JWT-authenticated) ────────
    // It borrows the application's database handle instead of opening the
    // redb file a second time (which would fail on the exclusive file lock).
    let mut dashboard =
        web_dashboard::WebDashboard::new_shared(web_dashboard::DEFAULT_PORT, Arc::clone(&db));
    dashboard.sync_state = Arc::clone(&sync_state);
    dashboard.set_search_index(Arc::clone(&state.tantivy_index));
    let dashboard = Arc::new(dashboard);
    match dashboard.start() {
        Ok(()) => tracing::info!(
            "Web Dashboard started on port {} (localhost only, JWT auth)",
            web_dashboard::DEFAULT_PORT
        ),
        Err(e) => tracing::error!("Failed to start Web Dashboard: {}", e),
    }
    // dashboard.stop() is called explicitly below after Tauri exits,
    // ensuring the accept thread is joined from the MAIN thread (not from
    // the accept thread's own Drop, which would self-deadlock).

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .manage(dashboard_state)
        .manage(sync_state)
        .manage(Arc::clone(&dashboard))
        .invoke_handler(tauri::generate_handler![
            // File operations
            files::list_files,
            files::get_file,
            files::create_folder,
            files::delete_file,
            files::rename_file,
            files::set_file_tags,
            files::duplicate_file_context,
            files::move_file,
            files::get_preview,
            files::read_file_content,
            files::write_file_content,
            // Search
            search_cmd::search_files,
            search_cmd::search_files_paginated,
            search_cmd::suggest,
            // Encryption
            encryption::encrypt_file,
            encryption::decrypt_file,
            encryption::get_encryption_status,
            encryption::generate_keypair,
            encryption::list_keys,
            // Compression
            commands::compression::compress_file,
            commands::compression::decompress_file,
            commands::compression::get_compression_stats,
            // Collections
            collections::list_collections,
            collections::create_collection,
            collections::add_to_collection,
            collections::remove_from_collection,
            // Face grouping (commands layer — delegates to crate::faces for ML)
            face_cmd::detect_faces,
            face_cmd::detect_faces_batch_cmd,
            face_cmd::recluster_faces,
            face_cmd::rename_face_group,
            face_cmd::merge_face_groups,
            face_cmd::delete_face_group,
            face_cmd::find_similar_faces,
            face_cmd::list_face_groups,
            face_cmd::get_group_files,
            // Map / GPS
            map::get_geo_files,
            map::extract_exif_gps,
            // Accounts
            accounts::list_accounts,
            accounts::create_account,
            accounts::switch_account,
            accounts::delete_account,
            // Tree-sitter code intelligence
            tree_sitter::parse_file,
            tree_sitter::get_symbols,
            tree_sitter::parse_text,
            // Loose groups
            files::create_loose_group,
            files::add_to_loose_group,
            files::list_loose_groups,
            // User management & permissions
            users::register_user,
            users::create_user,
            users::delete_user,
            users::update_user_role,
            users::authenticate_user,
            users::list_users,
            users::set_file_permission,
            users::grant_file_permission,
            users::revoke_file_permission,
            users::verify_file_access,
            users::get_file_permissions,
            users::verify_token,
            // Dashboard
            dashboard::dashboard_status,
            dashboard::start_dashboard,
            dashboard::stop_dashboard,
            // Sync
            sync_cmd::list_sync_configs,
            sync_cmd::create_sync_config,
            sync_cmd::delete_sync_config,
            sync_cmd::start_sync,
            sync_cmd::get_sync_progress,
            sync_cmd::test_sync_connection,
            sync_cmd::cancel_sync,
            sync_cmd::list_remote_files,
            // <<< AGENT-2 SYNC JOBS/RESTORE >>>
            sync_cmd::restore_sync_file,
            sync_cmd::delete_remote_file,
            sync_cmd::get_sync_job,
            sync_cmd::list_sync_runs,
            sync_cmd::create_provider_repo,
            sync_cmd::seed_repo_files,
            // Native AI agent (configs/sessions/detached jobs)
            commands::agent::list_agent_providers,
            commands::agent::list_agent_configs,
            commands::agent::save_agent_config,
            commands::agent::delete_agent_config,
            commands::agent::save_agent_key,
            commands::agent::list_agent_models,
            commands::agent::list_agent_sessions,
            commands::agent::get_agent_session,
            commands::agent::create_agent_session,
            commands::agent::import_agent_session,
            commands::agent::delete_agent_session,
            commands::agent::start_agent_run,
            commands::agent::agent_job_status,
            commands::agent::list_agent_jobs,
            commands::agent::abort_agent_job,
            commands::agent::approve_agent_job,
            commands::agent::init_agent_run,
            commands::agent::compact_agent_session,
            commands::agent::mcp_add_server,
            commands::agent::mcp_remove_server,
            commands::agent::mcp_list_tools,
            commands::agent::list_agent_memories,
            commands::agent::store_agent_memory,
            commands::agent::recall_agent_memories,
            commands::agent::delete_agent_memory,
            // File import / upload
            import_cmd::import_file,
            import_cmd::import_from_url,
            import_cmd::scan_directory,
            import_cmd::upload_file,
            import_cmd::rebuild_search_index,
            // Share links
            share::generate_share_link,
            share::get_shared_file,
            share::list_share_links,
            // Trash / recycle bin
            trash::list_trash,
            trash::restore_from_trash,
            trash::empty_trash,
            trash::delete_from_trash,
            // Audit log
            audit::get_audit_log,
            // Batch operations
            batch::batch_delete,
            batch::batch_encrypt,
            batch::batch_compress,
            // File versioning
            versions::list_file_versions,
            versions::create_file_version,
            versions::revert_file_version,
            versions::snapshot_all_versions,
            // Parent index rebuild
            files::rebuild_parent_index,
            // Disks & volumes (AGENT-6)
            commands::disk::create_disk,
            commands::disk::attach_disk,
            commands::disk::detach_disk,
            commands::disk::resize_disk,
            commands::disk::list_disks,
            commands::disk::volume_df,
            commands::disk::check_disk,
        ])
        .run(tauri::generate_context!())
        .expect("Fatal error while running CyberManju OS — see logs above");

    // ─── Clean shutdown: stop the dashboard before dropping the Arc ──
    dashboard.stop();
    log::info!("Web Dashboard shut down cleanly");
}
