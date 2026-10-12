// CyberManju OS — Op-log API (local-first sync exchange, §2C/P3-2).
//
// Devices exchange mutation rows (`OpRow`) using the version vectors the
// `leases` module already models. Push is idempotent (`merge_ops` skips
// known `op_id`s); pull pages by `seq`; conflicts renders the fork pairs
// the UI lets the user resolve; resolve appends a `resolve` op so history
// is never deleted — both forks stay readable under the resolution.
//
// Contract:
//   - GET /api/oplog/since?since=N&limit=M → `{ head, ops }`
//   - POST /api/oplog/push { ops: OpRow[] } → `{ appended, skipped, head }`
//   - GET /api/oplog/conflicts → `{ conflicts: [{a, b}] }`
//   - POST /api/oplog/resolve { opA, opB, choice, deviceId? } → `{ resolved, op }`
// Roles: Authenticated throughout (device attestation via the devices
// registry is the follow-up; the JWT already binds a user).

use cybermanju_db::Database;
use cybermanju_types::schema::OpRow;

fn respond<T: serde::Serialize>(result: Result<T, String>, origin: Option<&str>) -> String {
    match result {
        Ok(value) => crate::json_ok(&value, origin),
        Err(message) => {
            let status = if message.starts_with("not_found:") {
                404
            } else if message.starts_with("too_large:") {
                413
            } else {
                400
            };
            crate::json_error(status, &message, origin)
        }
    }
}

fn parse<T: for<'de> serde::Deserialize<'de>>(body: &str) -> Result<T, String> {
    serde_json::from_str(body).map_err(|e| format!("invalid: bad JSON body: {e}"))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    #[serde(default)]
    pub ops: Vec<OpRow>,
}

/// Merge foreign ops idempotently; absurd pages refused before they merge.
pub fn push(db: &Database, req: &PushRequest) -> Result<serde_json::Value, String> {
    if req.ops.len() > 10_000 {
        return Err(format!(
            "too_large: push holds {} ops (cap 10000 per call — page it)",
            req.ops.len()
        ));
    }
    for op in &req.ops {
        if op.kind.trim().is_empty() {
            return Err("invalid: every pushed op needs a kind".to_string());
        }
        if op.device_id.trim().is_empty() {
            return Err("invalid: every pushed op needs a device_id".to_string());
        }
    }
    let (appended, skipped) = db.merge_ops(&req.ops).map_err(|e| e.to_string())?;
    let head = db.oplog_head().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "appended": appended, "skipped": skipped, "head": head }))
}

/// Resolution request — `choice` is `keep-a` | `keep-b` | `merge`.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    #[serde(default)]
    pub op_a: String,
    #[serde(default)]
    pub op_b: String,
    #[serde(default)]
    pub choice: String,
    #[serde(default)]
    pub device_id: String,
}

/// Resolve one fork pair by appending a `resolve` op. Both forks stay in the
/// log — resolution is a verdict, not a deletion. Unknown op ids are
/// `not_found:`, unknown choices are `invalid:` (the UI only sends the three
/// documented verbs; the cybsh layer normalizes to `merge` first).
pub fn resolve_op(db: &Database, req: &ResolveRequest) -> Result<serde_json::Value, String> {
    if req.op_a.trim().is_empty() || req.op_b.trim().is_empty() {
        return Err("invalid: resolve needs both op ids (opA, opB)".to_string());
    }
    if !["keep-a", "keep-b", "merge"].contains(&req.choice.as_str()) {
        return Err("invalid: choice must be keep-a, keep-b or merge".to_string());
    }
    let a = db
        .get_op_by_id(&req.op_a)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: no op '{}'", req.op_a))?;
    let b = db
        .get_op_by_id(&req.op_b)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: no op '{}'", req.op_b))?;
    let device_id = if req.device_id.trim().is_empty() {
        Database::local_device_id()
    } else {
        req.device_id.clone()
    };
    let file_id = a.file_id.clone().or(b.file_id.clone());
    let row = OpRow {
        seq: 0,
        op_id: String::new(),
        device_id,
        created_at: chrono::Utc::now().to_rfc3339(),
        kind: "resolve".to_string(),
        file_id,
        payload: serde_json::json!({
            "opA": a.op_id,
            "opB": b.op_id,
            "choice": req.choice,
        }),
        bases: Default::default(),
    };
    let stored = db.append_op(row).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "resolved": true, "op": stored }))
}

/// Dispatch `/api/oplog/*`.
pub fn route(
    db: &Database,
    method: &str,
    path_segments: &[&str],
    query: &str,
    body: &str,
    origin: Option<&str>,
) -> Option<String> {
    let response = match path_segments {
        ["api", "oplog", "since"] if method == "GET" => {
            let since = crate::parse_query_param(query, "since")
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            let limit = crate::parse_query_param(query, "limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(500);
            let limit = limit.min(5000);
            match db
                .list_ops_since(since, limit)
                .and_then(|ops| Ok((ops, db.oplog_head()?)))
                .map_err(|e| e.to_string())
            {
                Ok((ops, head)) => {
                    respond(Ok(serde_json::json!({ "head": head, "ops": ops })), origin)
                }
                Err(e) => respond::<serde_json::Value>(Err(e), origin),
            }
        }

        ["api", "oplog", "push"] if method == "POST" => match parse::<PushRequest>(body) {
            Ok(req) => respond(push(db, &req), origin),
            Err(e) => respond::<serde_json::Value>(Err(e), origin),
        },

        ["api", "oplog", "conflicts"] if method == "GET" => {
            match db.op_conflicts().map_err(|e| e.to_string()) {
                Ok(pairs) => respond(
                    Ok(serde_json::json!({
                        "conflicts": pairs.iter().map(|(a, b)| serde_json::json!({ "a": a, "b": b })).collect::<Vec<_>>()
                    })),
                    origin,
                ),
                Err(e) => respond::<serde_json::Value>(Err(e), origin),
            }
        }

        ["api", "oplog", "resolve"] if method == "POST" => match parse::<ResolveRequest>(body) {
            Ok(req) => respond(resolve_op(db, &req), origin),
            Err(e) => respond::<serde_json::Value>(Err(e), origin),
        },

        _ => return None,
    };
    Some(response)
}
