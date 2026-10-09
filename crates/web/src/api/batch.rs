// CyberManju OS — Batch operations (shared by Tauri IPC and REST)

use cybermanju_db::Database;
use cybermanju_types::schema::FileNode;

/// Batch delete: move multiple files to trash in a single operation.
pub fn delete(db: &Database, file_ids: &[String]) -> Result<u32, String> {
    let mut count = 0u32;

    for file_id in file_ids {
        let tx_read = db.begin_read().map_err(|e| e.to_string())?;
        let table = tx_read
            .open_table(Database::get_files_table())
            .map_err(|e| e.to_string())?;
        let file_node: Option<FileNode> = table
            .get(file_id.as_str())
            .map_err(|e| e.to_string())?
            .and_then(|v| serde_json::from_str(v.value()).ok());
        drop(tx_read);

        if let Some(node) = file_node {
            db.log_audit("batch_delete", "file", file_id, None, None)
                .map_err(|e| e.to_string())?;
            db.trash_file(file_id, &node, None)
                .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

/// Batch encrypt: mark multiple files as encrypted with a single algorithm.
pub fn encrypt(db: &Database, file_ids: &[String], algorithm: &str) -> Result<u32, String> {
    let mut count = 0u32;

    for file_id in file_ids {
        let mut file_node = read_file(db, file_id)?;
        if !file_node.encrypted {
            file_node.encrypted = true;
            file_node.encryption_algorithm = Some(algorithm.to_string());
            file_node.modified_at = chrono::Utc::now().to_rfc3339();
            write_file(db, file_id, &file_node)?;
            db.log_audit("batch_encrypt", "file", file_id, None, None)
                .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

/// Batch compress: record a compression layer on multiple files.
pub fn compress(db: &Database, file_ids: &[String], layer: &str) -> Result<u32, String> {
    let mut count = 0u32;

    for file_id in file_ids {
        let mut file_node = read_file(db, file_id)?;
        if !file_node.compression_layers.contains(&layer.to_string()) {
            file_node.compression_layers.push(layer.to_string());
            file_node.modified_at = chrono::Utc::now().to_rfc3339();
            write_file(db, file_id, &file_node)?;
            db.log_audit("batch_compress", "file", file_id, None, None)
                .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

fn read_file(db: &Database, file_id: &str) -> Result<FileNode, String> {
    let tx_read = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx_read
        .open_table(Database::get_files_table())
        .map_err(|e| e.to_string())?;
    table
        .get(file_id)
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(v.value()).ok())
        .ok_or_else(|| format!("File not found: {}", file_id))
}

fn write_file(db: &Database, file_id: &str, node: &FileNode) -> Result<(), String> {
    let serialized = serde_json::to_string(node).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_files_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(file_id, serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
