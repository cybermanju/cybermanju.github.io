// CyberManju OS — OS routes (AGENT-8)
//
// Pre-created and pre-hooked by the supervisor: `crates/web/src/lib.rs` calls
// `route()` right after the auth gate, and `os` is already in
// `security::ROUTED_SEGMENTS`. AGENT-8 implements the arms; nobody edits
// `lib.rs`, `security.rs` or `api/mod.rs`.
//
// Contract: return `Some(response)` for a path this family owns, `None` for
// anything else. `POST /api/os/exec` (the `cybsh` terminal) is the important
// one — it must be authenticated like every other route.

use cybermanju_db::Database;
use cybermanju_os::api::Kernel;
use serde::Deserialize;
use serde::Serialize;
use std::sync::{Arc, RwLock};

/// Render a `Result` the way this crate does everywhere else: 404 when the
/// message reports a missing entity, 501 when the capability does not exist
/// on this platform, 400 otherwise (`not a directory: …`, `disk full: …`).
fn respond<T: Serialize>(result: Result<T, String>, origin: Option<&str>) -> String {
    match result {
        Ok(value) => crate::json_ok(&value, origin),
        Err(message) => {
            let status = if message.starts_with("not found:")
                || message.contains("not found:")
                || message.starts_with("no such")
            {
                404
            } else if message.starts_with("unsupported:") {
                501
            } else {
                400
            };
            crate::json_error(status, &message, origin)
        }
    }
}

/// `400` for a body this route cannot even parse.
fn bad_request(message: String, origin: Option<&str>) -> String {
    crate::json_error(400, &message, origin)
}

/// Every request body is JSON; this is the house error for one that is not.
fn parse<T: for<'de> Deserialize<'de>>(body: &str) -> Result<T, String> {
    serde_json::from_str(body).map_err(|err| format!("Invalid JSON: {}", err))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecRequest {
    /// One shell line, exactly as the user typed it (`echo hi | cat`).
    line: String,
}

/// `/api/os/exec` result. A command that *runs* and reports a failure is a
/// 200 with `ok: false` — the terminal shows the message, it does not fail the
/// HTTP request. Only a body we cannot parse is a 400.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecResult {
    ok: bool,
    line: String,
    output: String,
    /// Present when `ok` is false, for clients that only read `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    prompt: &'static str,
}

/// `du(1)` for one path.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuResult {
    path: String,
    bytes: u64,
    files: u64,
}

/// `sync start …` inside `POST /api/os/exec`, run for real.
///
/// The normal `os_api::route` path holds the request database lock, under
/// which `start_job` would deadlock (it takes its own short read lock to
/// load the config). So `route_request` calls this **before** the lock is
/// taken: a line that parses as a single `sync start` becomes a detached
/// job via `start_job` — exactly like `POST /api/sync/start` — and answers
/// the terminal's `ExecResult` shape (`ok: true` + `{jobId}` output).
/// Anything else returns `None` and flows to the locked path untouched.
pub fn try_sync_start_exec(
    shared: &Arc<RwLock<Database>>,
    body: &str,
    origin: Option<&str>,
) -> Option<String> {
    let req: ExecRequest = serde_json::from_str(body).ok()?;
    let start = cybermanju_os::shell::parse_sync_start(&req.line)?;
    let line = req.line.clone();

    // Resolve the config id with a short-lived read; the guard is dropped
    // before `start_job` takes its own lock.
    let config_id = match start.config_id {
        Some(id) => id,
        None => {
            let guard = shared.read().ok()?;
            let configs = crate::api::sync_api::list_configs(&guard).ok()?;
            drop(guard);
            configs.into_iter().find(|c| c.enabled).map(|c| c.id)?
        }
    };

    let output = match crate::api::sync_api::start_job(shared, &config_id, start.file_ids) {
        Ok(job) => format!(
            "started sync job {} (config {}) · {}/{} files — poll with `sync status`",
            job.job_id, job.config_id, job.progress.processed_files, job.progress.total_files,
        ),
        Err(message) => {
            return Some(crate::json_ok(
                &ExecResult {
                    ok: false,
                    line,
                    output: message.clone(),
                    error: None,
                    prompt: cybermanju_os::PROMPT,
                },
                origin,
            ));
        }
    };
    Some(crate::json_ok(
        &ExecResult {
            ok: true,
            line,
            output,
            error: None,
            prompt: cybermanju_os::PROMPT,
        },
        origin,
    ))
}

/// Dispatch `/api/os/*` (exec, stat, ls, du, df, ps, top, jobs, workers).
pub fn route(
    db: &Database,
    method: &str,
    path_segments: &[&str],
    body: &str,
    origin: Option<&str>,
) -> Option<String> {
    let rest: &[&str] = match path_segments {
        ["api", "os"] => &[],
        ["api", "os", rest @ ..] => rest,
        _ => return None,
    };
    if rest.is_empty() {
        return Some(crate::json_error(404, "not found: /api/os", origin));
    }
    let head = rest[0];
    // Path arguments arrive as segments; a volume path is re-joined so
    // `/api/os/ls/projects/2026` reads `/projects/2026`.
    let path = if rest.len() < 2 {
        "/".to_string()
    } else {
        format!("/{}", rest[1..].join("/"))
    };

    let response = match (head, method) {
        // ─── cybsh ──────────────────────────────────────────────────────
        ("exec", "POST") => match parse::<ExecRequest>(body) {
            Ok(request) => {
                let line = request.line.clone();
                let (ok, output) = match cybermanju_os::execute(&line, Some(db)) {
                    Ok(output) => (true, output),
                    Err(message) => (false, message),
                };
                crate::json_ok(
                    &ExecResult {
                        ok,
                        line,
                        output,
                        error: None,
                        prompt: cybermanju_os::PROMPT,
                    },
                    origin,
                )
            }
            Err(err) => bad_request(err, origin),
        },

        // Tab completion for the terminal's prompt.
        ("complete", "GET") => respond(Ok(cybermanju_os::completions(&path[1..])), origin),

        // ─── filesystem ────────────────────────────────────────────────
        ("stat", "GET") => respond(Kernel::global().stat(&path), origin),
        ("ls", "GET") => respond(Kernel::global().readdir(&path), origin),
        ("du", "GET") => match Kernel::global().du(&path) {
            Ok((bytes, files)) => crate::json_ok(&DuResult { path, bytes, files }, origin),
            Err(message) => crate::json_error(404, &message, origin),
        },
        ("df", "GET") => crate::json_ok(&Kernel::global().df(Some(db)), origin),

        // ─── task table / fan-out ───────────────────────────────────────
        ("ps", "GET") => crate::json_ok(&cybermanju_os::ps(Some(db)), origin),
        ("top", "GET") => crate::json_ok(&cybermanju_os::top(Some(db)), origin),
        ("workers", "GET") => crate::json_ok(&cybermanju_os::workers(Some(db)), origin),
        ("jobs", "GET") => crate::json_ok(&cybermanju_os::available_jobs(), origin),

        // Known endpoint, wrong verb — say so instead of falling through to
        // the generic 404.
        (_, _) if KNOWN.contains(&head) => crate::json_error(
            405,
            &format!("method not allowed: {method} /api/os/{head}"),
            origin,
        ),
        _ => crate::json_error(404, &format!("not found: /api/os/{head}"), origin),
    };
    Some(response)
}

/// Endpoints this family owns, for the 405 arm above.
const KNOWN: &[&str] = &[
    "exec", "complete", "stat", "ls", "du", "df", "ps", "top", "workers", "jobs",
];
