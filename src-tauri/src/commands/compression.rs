// CyberManju OS — Compression (src-tauri/src/commands/compression.rs).
// Role: Persist native compression artifacts without replacing source bytes.
// Exports: FrontendCompressionStats, FrontendLayerDetail, compress_file, decompress_file, get_compression_stats.
// Integrates: shared TripleCompressor, redb file metadata, Tauri IPC.
// Contracts: no fabricated success; private create-new sidecars; fail closed on changed or corrupt bytes.
use crate::AppState;
use cybermanju_db::Database;
use cybermanju_types::schema::FileNode;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendCompressionStats {
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f64,
    pub layer: String,
    pub layer_details: Vec<FrontendLayerDetail>,
    pub blake3_hash: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLayerDetail {
    pub name: String,
    pub algorithm: String,
    pub input_size: u64,
    pub output_size: u64,
    pub ratio: f64,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredArtifact {
    path: PathBuf,
    hash: String,
    codec: String,
    requested_layer: String,
    stats: FrontendCompressionStats,
}

fn read_node(db: &Database, id: &str) -> Result<FileNode, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_files_table())
        .map_err(|e| e.to_string())?;
    let value = table
        .get(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: file '{id}' not found"))?;
    serde_json::from_str(value.value()).map_err(|e| e.to_string())
}

fn save_node(db: &Database, id: &str, node: &FileNode) -> Result<(), String> {
    let serialized = serde_json::to_string(node).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(Database::get_files_table())
            .map_err(|e| e.to_string())?;
        table.insert(id, serialized.as_str()).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn original_path(node: &FileNode) -> Result<PathBuf, String> {
    node.context_data
        .as_ref()
        .and_then(|ctx| ctx.get("original_path"))
        .and_then(|v| v.as_str())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!(
                "not_found: '{}' has no stored source bytes on this device; import or upload the file first",
                node.name
            )
        })
}

fn sidecar_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".cyb3");
    PathBuf::from(name)
}

fn recorded_artifact(node: &FileNode) -> Result<Option<StoredArtifact>, String> {
    node.context_data
        .as_ref()
        .and_then(|ctx| ctx.get("compression_artifact"))
        .map(|value| {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("integrity: invalid compression artifact metadata: {e}"))
        })
        .transpose()
}

fn write_new_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("conflict: cannot create new artifact {}: {e}", path.display()))?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(format!("integrity: artifact persistence failed: {e}"));
    }
    Ok(())
}

fn decode_artifact(
    compression: &crate::compression::TripleCompressor,
    bytes: &[u8],
    layer: &str,
) -> Result<Vec<u8>, String> {
    let result = match layer {
        "identity" => return Ok(bytes.to_vec()),
        "all" => compression.decompress_triple(bytes).map(|(data, _)| data),
        "lz4" => compression.decompress_lz4(bytes),
        "zstd" => compression.decompress_zstd(bytes),
        "brotli" => compression.decompress_brotli(bytes),
        _ => return Err("integrity: compression: invalid recorded layer".to_string()),
    };
    result.map_err(|e| format!("integrity: compression: artifact decode failed: {e}"))
}

fn validate_artifact(
    compression: &crate::compression::TripleCompressor,
    node: &FileNode,
    record: &StoredArtifact,
) -> Result<Vec<u8>, String> {
    if record.path != sidecar_path(&original_path(node)?) {
        return Err("integrity: compression artifact path does not match source".to_string());
    }
    let bytes = std::fs::read(&record.path)
        .map_err(|e| format!("integrity: cannot read compression artifact: {e}"))?;
    if bytes.len() as u64 != record.stats.compressed_size
        || blake3::hash(&bytes).to_hex().as_str() != record.hash
    {
        return Err("integrity: compression artifact hash or size mismatch".to_string());
    }
    let decoded = decode_artifact(compression, &bytes, &record.codec)?;
    if decoded.len() as u64 != record.stats.original_size
        || blake3::hash(&decoded).to_hex().as_str() != record.stats.blake3_hash
    {
        return Err("integrity: decoded compression bytes do not match source snapshot".to_string());
    }
    Ok(decoded)
}

/// Save a private compressed copy. Source bytes and their size/hash remain unchanged.
/// External filesystem writers must be quiesced during artifact creation and removal.
#[tauri::command(async)]
pub fn compress_file(
    file_id: String,
    layer: String,
    state: State<'_, AppState>,
) -> Result<FrontendCompressionStats, String> {
    if !["lz4", "zstd", "brotli", "all"].contains(&layer.as_str()) {
        return Err("unsupported: choose lz4, zstd, brotli, or all for compression".to_string());
    }
    let db = state.db.write().map_err(|e| e.to_string())?;
    let mut node = read_node(&db, &file_id)?;
    if node.file_type != "file" {
        return Err("unsupported: compress individual files, not folders".to_string());
    }
    if node.encrypted {
        return Err("unsupported: decrypt the file before compression".to_string());
    }
    let source = original_path(&node)?;
    let data = std::fs::read(&source).map_err(|e| {
        format!("not_found: cannot read source bytes; import or upload the file first: {e}")
    })?;
    if let Some(record) = recorded_artifact(&node)? {
        let decoded = validate_artifact(&state.compression, &node, &record)?;
        if decoded != data {
            return Err("conflict: source changed; preserving source and artifact".to_string());
        }
        if record.requested_layer != layer {
            return Err("conflict: decompress before choosing a different codec".to_string());
        }
        return Ok(record.stats);
    }
    if !node.compression_layers.is_empty() {
        return Err("integrity: legacy compression has no verified artifact; reimport source bytes".to_string());
    }
    let start = std::time::Instant::now();
    let (artifact, codec, details) = if layer == "all" {
        let (bytes, stats) = state
            .compression
            .compress_triple(&data)
            .map_err(|e| format!("integrity: compression failed: {e}"))?;
        let codec = if stats.layer.starts_with("skipped") { "identity" } else { "all" };
        (bytes, codec.to_string(), stats.layer_details)
    } else {
        let (bytes, detail) = state
            .compression
            .compress_data(&data, &layer)
            .map_err(|e| format!("integrity: compression failed: {e}"))?;
        (bytes, layer.clone(), vec![detail])
    };
    let stats = FrontendCompressionStats {
        original_size: data.len() as u64,
        compressed_size: artifact.len() as u64,
        ratio: if data.is_empty() { 1.0 } else { artifact.len() as f64 / data.len() as f64 },
        layer: codec.clone(),
        layer_details: details
            .into_iter()
            .map(|detail| FrontendLayerDetail {
                name: detail.name,
                algorithm: detail.algorithm,
                input_size: detail.input_size,
                output_size: detail.output_size,
                ratio: detail.ratio,
                color: detail.color,
            })
            .collect(),
        blake3_hash: blake3::hash(&data).to_hex().to_string(),
        duration_ms: start.elapsed().as_millis() as u64,
    };
    let record = StoredArtifact {
        path: sidecar_path(&source),
        hash: blake3::hash(&artifact).to_hex().to_string(),
        codec,
        requested_layer: layer.clone(),
        stats: stats.clone(),
    };
    let value = serde_json::to_value(&record).map_err(|e| e.to_string())?;
    write_new_private(&record.path, &artifact)?;
    let context = node.context_data.get_or_insert_with(|| serde_json::json!({}));
    let context = context
        .as_object_mut()
        .ok_or_else(|| "integrity: source context is not an object; artifact retained".to_string())?;
    context.insert("compression_artifact".to_string(), value);
    node.compression_layers = vec![layer];
    save_node(&db, &file_id, &node).map_err(|e| {
        format!("integrity: metadata update failed; artifact retained at {}: {e}", record.path.display())
    })?;
    Ok(stats)
}

/// Decode and verify before restoring a missing source or removing the compressed copy.
#[tauri::command(async)]
pub fn decompress_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<FrontendCompressionStats, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    let mut node = read_node(&db, &file_id)?;
    if node.encrypted || node.file_type != "file" {
        return Err("unsupported: select a decrypted file before decompression".to_string());
    }
    let record = recorded_artifact(&node)?.ok_or_else(|| {
        "integrity: no verified compression artifact; reimport source bytes".to_string()
    })?;
    let decoded = validate_artifact(&state.compression, &node, &record)?;
    let source = original_path(&node)?;
    match std::fs::read(&source) {
        Ok(current) if current != decoded => {
            return Err("conflict: source changed; preserving source and artifact".to_string());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => write_new_private(&source, &decoded)?,
        Err(e) => return Err(format!("integrity: cannot inspect source bytes: {e}")),
    }
    let previous = node.clone();
    if let Some(context) = node.context_data.as_mut().and_then(|value| value.as_object_mut()) {
        context.remove("compression_artifact");
    }
    node.compression_layers.clear();
    save_node(&db, &file_id, &node)?;
    if let Err(e) = std::fs::remove_file(&record.path) {
        let rollback = save_node(&db, &file_id, &previous);
        return Err(format!("integrity: artifact cleanup failed: {e}; metadata rollback: {rollback:?}"));
    }
    Ok(FrontendCompressionStats {
        original_size: record.stats.compressed_size,
        compressed_size: decoded.len() as u64,
        ratio: if record.stats.compressed_size == 0 {
            1.0
        } else {
            decoded.len() as f64 / record.stats.compressed_size as f64
        },
        layer: "decompressed".to_string(),
        layer_details: vec![],
        blake3_hash: record.stats.blake3_hash,
        duration_ms: 0,
    })
}

/// Report persisted statistics, never an invented ratio from file metadata alone.
#[tauri::command(async)]
pub fn get_compression_stats(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<FrontendCompressionStats, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let node = read_node(&db, &file_id)?;
    if let Some(record) = recorded_artifact(&node)? {
        validate_artifact(&state.compression, &node, &record)?;
        return Ok(record.stats);
    }
    if !node.compression_layers.is_empty() {
        return Err("integrity: compression statistics have no verified artifact".to_string());
    }
    Ok(FrontendCompressionStats {
        original_size: node.size_bytes,
        compressed_size: node.size_bytes,
        ratio: 1.0,
        layer: "none".to_string(),
        layer_details: vec![],
        blake3_hash: node.hash_blake3.unwrap_or_default(),
        duration_ms: 0,
    })
}

#[cfg(test)]
#[path = "../native_compression_tests.rs"]
mod tests;
