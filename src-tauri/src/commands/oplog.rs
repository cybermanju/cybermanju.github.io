// CyberManju OS — Oplog (src-tauri/src/commands/oplog.rs).
// Role: Native IPC entry points for local oplog pull, push, conflict view and resolution.
// Exports: oplog_since, oplog_batches, oplog_conflicts, oplog_push, oplog_merge_batch, oplog_resolve.
// Integrates: shared web oplog validation and owner-scoped queries; AppState DB.
// Contracts: local owner only; pushes require verified signatures; no foreign or revoked rows.
use crate::AppState;
use cybermanju_types::schema::SignedOpBatch;
use cybermanju_web::api::oplog::{PushRequest, ResolveRequest};
use tauri::State;

/// Pull one local-owner page; limit behavior mirrors REST (clamped to 1..5000).
#[tauri::command(async)]
pub fn oplog_since(
    since: Option<u64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::since_for_owner(
        &db,
        since.unwrap_or(0),
        limit.unwrap_or(500),
        "local",
    )
}

/// Pull one local-owner page of preserved signed batches, cursoring by the
/// receiver's batch sequence rather than rewriting sender operation rows.
#[tauri::command(async)]
pub fn oplog_batches(
    since: Option<u64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::signed_batches_for_owner(
        &db,
        since.unwrap_or(0),
        limit.unwrap_or(100),
        "local",
    )
}

/// List local-owner fork pairs, excluding revoked device owners.
#[tauri::command(async)]
pub fn oplog_conflicts(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::conflicts_for_owner(&db, "local")
}

/// Merge only signed, registered-device ops after the shared REST validation.
#[tauri::command(async)]
pub fn oplog_push(
    device_id: String,
    ops: Vec<cybermanju_types::schema::OpRow>,
    signature: String,
    algorithm: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::push(
        &db,
        &PushRequest {
            device_id,
            ops,
            signature,
            algorithm,
        },
        "local",
    )
}

/// Verify a forwarded sender batch while retaining its original envelope and
/// storing it under this local vault's owner scope.
#[tauri::command(async)]
pub fn oplog_merge_batch(
    batch: SignedOpBatch,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::merge_preserved_batch(&db, &batch, "local")
}

/// Append an owner-checked resolution op; existing op history is preserved.
#[tauri::command(async)]
pub fn oplog_resolve(
    op_a: String,
    op_b: String,
    choice: String,
    device_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::oplog::resolve_op(
        &db,
        &ResolveRequest {
            op_a,
            op_b,
            choice,
            device_id: device_id.unwrap_or_default(),
        },
        "local",
    )
}

#[cfg(test)]
mod tests {
    use cybermanju_types::schema::{DeviceRow, OpRow};
    use cybermanju_web::api::oplog::{PushRequest, ResolveRequest};

    fn db() -> (cybermanju_db::Database, std::path::PathBuf) {
        let p = std::env::temp_dir().join(format!("native-oplog-{}.db", uuid::Uuid::new_v4()));
        (
            cybermanju_db::Database::new(p.to_str().unwrap()).unwrap(),
            p,
        )
    }

    fn device(id: &str, owner: &str, revoked: bool) -> DeviceRow {
        DeviceRow {
            id: id.into(),
            name: id.into(),
            owner_id: owner.into(),
            public_key: String::new(),
            key_algorithm: "ml-dsa-65".into(),
            created_at: "2026-10-12T00:00:00Z".into(),
            last_seen_at: "2026-10-12T00:00:00Z".into(),
            revoked,
        }
    }

    fn op(device_id: &str, value: &str) -> OpRow {
        OpRow {
            seq: 0,
            op_id: String::new(),
            device_id: device_id.into(),
            created_at: "2026-10-12T00:00:00Z".into(),
            kind: "rename".into(),
            file_id: Some("same-file".into()),
            payload: serde_json::json!({"value": value}),
            bases: Default::default(),
        }
    }

    #[test]
    fn local_pages_and_conflicts_have_shapes_and_only_active_local_ops() {
        let (db, p) = db();
        db.save_device(&device("local-device", "local", false))
            .unwrap();
        db.save_device(&device("foreign-device", "other", false))
            .unwrap();
        db.save_device(&device("revoked-device", "local", true))
            .unwrap();
        db.append_op(op("local-device", "visible")).unwrap();
        db.append_op(op("foreign-device", "foreign-secret"))
            .unwrap();
        db.append_op(op("revoked-device", "revoked-secret"))
            .unwrap();
        let page = cybermanju_web::api::oplog::since_for_owner(&db, 0, 20, "local").unwrap();
        assert!(page["head"].is_number());
        assert!(page["ops"].is_array());
        let text = page.to_string();
        assert!(text.contains("visible"));
        assert!(!text.contains("foreign-secret"));
        assert!(!text.contains("revoked-secret"));
        let conflicts = cybermanju_web::api::oplog::conflicts_for_owner(&db, "local").unwrap();
        assert!(conflicts["conflicts"].is_array());
        drop(db);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn unsigned_push_and_unowned_resolution_fail_closed() {
        let (db, p) = db();
        db.save_device(&device("local-device", "local", false))
            .unwrap();
        db.save_device(&device("foreign-device", "other", false))
            .unwrap();
        let a = db.append_op(op("local-device", "a")).unwrap();
        let b = db.append_op(op("foreign-device", "b")).unwrap();
        let push = PushRequest {
            device_id: "local-device".into(),
            ops: vec![a.clone()],
            signature: String::new(),
            algorithm: "ml-dsa-65".into(),
        };
        assert!(cybermanju_web::api::oplog::push(&db, &push, "local")
            .unwrap_err()
            .starts_with("auth:"));
        let resolve = ResolveRequest {
            op_a: a.op_id,
            op_b: b.op_id,
            choice: "merge".into(),
            device_id: String::new(),
        };
        assert!(
            cybermanju_web::api::oplog::resolve_op(&db, &resolve, "local")
                .unwrap_err()
                .starts_with("auth:")
        );
        drop(db);
        let _ = std::fs::remove_file(p);
    }
}
