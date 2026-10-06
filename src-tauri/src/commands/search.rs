// CyberManju OS — Search commands (thin wrappers over the shared API)

use std::sync::Arc;

use cybermanju_web::api;
use tauri::State;

use crate::AppState;

/// Search result returned to the frontend.
pub use cybermanju_web::api::search_api::SearchHit as SearchResult;

/// Paginated search results with total count.
pub use cybermanju_web::api::search_api::PaginatedHits as PaginatedSearchResult;

/// Search files using the shared full-text index (falls back to a substring
/// scan when no index is attached).
#[tauri::command]
pub fn search_files(
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let index = Some(Arc::clone(&state.tantivy_index));
    api::search_api::search(&index, &db, &query, limit, offset)
}

/// Search files with pagination (offset + limit) and total count.
#[tauri::command]
pub fn search_files_paginated(
    query: String,
    limit: usize,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<PaginatedSearchResult, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let index = Some(Arc::clone(&state.tantivy_index));
    api::search_api::search_paginated(&index, &db, &query, limit, offset)
}

/// Get type-ahead suggestions for a prefix query.
#[tauri::command]
pub fn suggest(
    prefix: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let index = Some(Arc::clone(&state.tantivy_index));
    api::search_api::suggest(&index, &db, &prefix, limit)
}
