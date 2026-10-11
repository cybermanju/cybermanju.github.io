// CyberManju OS — Op-log API (local-first sync exchange, §2C/P3-2).
//
// Devices exchange mutation rows (`OpRow`) using the version vectors the
// `leases` module already models. Push is idempotent (`merge_ops` skips
// known `op_id`s); pull pages by `seq`; conflicts renders the fork pairs
// the UI lets the user resolve.
//
// Contract:
//   - GET /api/oplog/since?since=N&limit=M → `{ head, ops }`
//   - POST /api/oplog/push { ops: OpRow[] } → `{ appended, skipped, head }`
//   - GET /api/oplog/conflicts → `{ conflicts: [{a, b}] }`
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
                Ok((ops, head)) => respond(Ok(serde_json::json!({ "head": head, "ops": ops })), origin),
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

        _ => return None,
    };
    Some(response)
}
