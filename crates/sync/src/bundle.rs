// CyberManju OS — Sneakernet bundles (crates/sync/src/bundle.rs).
// Role: offline device↔device deltas on a USB stick (§2B.4) — a delta of
// content-addressed op-log rows, BLAKE3-manifested, importable anywhere.
// Genuinely decentralized: no server, no LAN, no account. File bytes travel
// through the existing sync backends on next contact; the bundle carries the
// *operations* (create/edit/move/tag/star/…) so the receiver knows exactly
// what changed, with merge idempotency from `merge_ops` (same op_id twice
// is a no-op, never a duplicate).
// Exports: Bundle, export_bundle, import_bundle, BUNDLE_FORMAT,
// BUNDLE_MAX_OPS.
// Integrates: sync crate (blake3 + db already deps); `sync bundle
// export|import` cybsh verbs and `POST /api/sync/bundle/*` ride on these.
// Contracts: `too_large:` beyond BUNDLE_MAX_OPS; `integrity:` on marker or
// hash mismatch; foreign files stay untouched (read-then-validate before
// any write).

use cybermanju_db::Database;
use cybermanju_types::schema::OpRow;

/// Bundle envelope marker — import rejects anything else, loudly.
pub const BUNDLE_FORMAT: &str = "cyb-bundle/1";
/// Refuse absurd bundles before they touch memory (100k ops ≈ tens of MB).
pub const BUNDLE_MAX_OPS: usize = 100_000;

/// One sneakernet delta.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: String,
    pub from_device: String,
    pub created_at: String,
    pub head: u64,
    pub ops: Vec<OpRow>,
    /// BLAKE3 hex of the canonical ops JSON (everything above minus this
    /// field) — tamper-evident in transit on untrusted sticks.
    pub manifest_blake3: String,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn canonical_ops_json(ops: &[OpRow]) -> Result<String, String> {
    serde_json::to_string(ops).map_err(|e| format!("integrity: bundle ops unserializable: {e}"))
}

/// Collect ops with `seq > since` into an exportable bundle. Nothing is
/// written — the caller places the bytes (USB path, provider file, …).
pub fn export_bundle(db: &Database, device_id: &str, since: u64) -> Result<Bundle, String> {
    if device_id.trim().is_empty() {
        return Err("invalid: device id is required".to_string());
    }
    let ops = db
        .list_ops_since(since, BUNDLE_MAX_OPS + 1)
        .map_err(|e| e.to_string())?;
    if ops.len() > BUNDLE_MAX_OPS {
        return Err(format!(
            "too_large: {} ops since {since} exceeds the {BUNDLE_MAX_OPS}-op bundle cap — export in slices",
            ops.len()
        ));
    }
    let head = db.oplog_head().map_err(|e| e.to_string())?;
    let canonical = canonical_ops_json(&ops)?;
    Ok(Bundle {
        format: BUNDLE_FORMAT.to_string(),
        from_device: device_id.to_string(),
        created_at: now_rfc3339(),
        head,
        ops,
        manifest_blake3: blake3::hash(canonical.as_bytes()).to_hex().to_string(),
    })
}

/// Serialize a bundle for transport (USB file, provider object, …).
pub fn bundle_bytes(bundle: &Bundle) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(bundle).map_err(|e| format!("integrity: bundle unserializable: {e}"))
}

/// Validate + merge a received bundle. Returns (appended, skipped); the
/// receiver's own ops are never rewritten, only extended.
pub fn import_bundle(db: &Database, bytes: &[u8]) -> Result<(usize, usize, String), String> {
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("too_large: bundle exceeds the 256 MiB import cap".to_string());
    }
    let bundle: Bundle =
        serde_json::from_slice(bytes).map_err(|e| format!("integrity: bundle unreadable: {e}"))?;
    if bundle.format != BUNDLE_FORMAT {
        return Err(format!(
            "integrity: not a sneakernet bundle (format '{}')",
            bundle.format
        ));
    }
    if bundle.ops.len() > BUNDLE_MAX_OPS {
        return Err(format!(
            "too_large: bundle holds {} ops (cap {BUNDLE_MAX_OPS})",
            bundle.ops.len()
        ));
    }
    let canonical = canonical_ops_json(&bundle.ops)?;
    let digest = blake3::hash(canonical.as_bytes()).to_hex().to_string();
    if digest != bundle.manifest_blake3 {
        return Err("integrity: bundle manifest mismatch — the file changed in transit".to_string());
    }
    let (appended, skipped) = db.merge_ops(&bundle.ops).map_err(|e| e.to_string())?;
    Ok((appended, skipped, bundle.from_device))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(tag: &str) -> (std::path::PathBuf, Database) {
        let dir = std::env::temp_dir().join(format!(
            "cybermanju-bundle-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let db = Database::new(dir.join("bundle.redb").to_str().unwrap()).expect("db");
        (dir, db)
    }

    fn op(device: &str, kind: &str) -> OpRow {
        OpRow {
            seq: 0,
            op_id: String::new(),
            device_id: device.to_string(),
            created_at: "2026-10-11T00:00:00Z".to_string(),
            kind: kind.to_string(),
            file_id: Some("f1".to_string()),
            payload: serde_json::json!({}),
            bases: Default::default(),
        }
    }

    #[test]
    fn bundle_round_trips_and_merges_idempotently() {
        let (_dir, a) = fixture("a");
        let (_dir, b) = fixture("b");
        a.append_op(op("laptop", "tag")).unwrap();
        a.append_op(op("laptop", "star")).unwrap();
        let bundle = export_bundle(&a, "laptop", 0).unwrap();
        assert_eq!(bundle.ops.len(), 2);
        let bytes = bundle_bytes(&bundle).unwrap();
        let (appended, skipped, from) = import_bundle(&b, &bytes).unwrap();
        assert_eq!((appended, skipped), (2, 0));
        assert_eq!(from, "laptop");
        // Re-import is a pure no-op (same op_ids).
        let (appended, skipped, _) = import_bundle(&b, &bytes).unwrap();
        assert_eq!((appended, skipped), (0, 2));
    }

    #[test]
    fn bundle_rejects_tampering_and_foreign_files() {
        let (_dir, a) = fixture("tamper");
        a.append_op(op("laptop", "tag")).unwrap();
        let mut bundle = export_bundle(&a, "laptop", 0).unwrap();
        bundle.ops.push(op("mallory", "delete"));
        let bytes = bundle_bytes(&bundle).unwrap();
        let err = import_bundle(&a, &bytes).expect_err("manifest");
        assert!(err.starts_with("integrity:"), "{err}");
        let err = import_bundle(&a, b"{\"format\":\"nope\"}").expect_err("format");
        assert!(err.starts_with("integrity:"), "{err}");
        let err = import_bundle(&a, b"not json").expect_err("json");
        assert!(err.starts_with("integrity:"), "{err}");
    }

    #[test]
    fn bundle_export_validates_device_and_slices() {
        let (_dir, a) = fixture("slices");
        assert!(export_bundle(&a, "  ", 0).is_err());
        a.append_op(op("laptop", "tag")).unwrap();
        let bundle = export_bundle(&a, "laptop", 0).unwrap();
        assert_eq!(bundle.head, 0);
        let empty = export_bundle(&a, "laptop", 99).unwrap();
        assert!(empty.ops.is_empty());
    }
}
