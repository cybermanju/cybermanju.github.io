// CyberManju OS — Batch operation commands (thin wrappers over the shared API)

use cybermanju_web::api;
use tauri::State;

use crate::AppState;

/// Batch delete: move multiple files to trash in a single operation.
#[tauri::command]
pub fn batch_delete(file_ids: Vec<String>, state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    api::batch::delete(&db, &file_ids)
}

/// Batch encrypt: encrypt multiple files with a single algorithm.
#[tauri::command]
pub fn batch_encrypt(
    file_ids: Vec<String>,
    algorithm: String,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    api::batch::encrypt(&db, &file_ids, &algorithm)
}

/// Batch compress: compress multiple files with a single layer.
#[tauri::command]
pub fn batch_compress(
    file_ids: Vec<String>,
    layer: String,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    api::batch::compress(&db, &file_ids, &layer)
}
