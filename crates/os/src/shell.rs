//! `cybsh` (AGENT-8 item 1 / MISSING.md F1): a real, server-side shell.
//!
//! Input → tokenizer (quotes, `\` escapes, `|`, `&&`, `||`, `;`, `--json`) →
//! pipeline/sequence parser → command dispatch → formatted output.
//!
//! Every command does something real: file commands go through the typed
//! syscall boundary ([`crate::api::Kernel`]), disk commands call
//! `cybermanju_disk`, durability commands call `cybermanju_sync`, tasks and
//! compute call [`crate::task`] and [`crate::compute`]. Nothing here fakes a
//! result — unavailable features answer `unsupported: …` as the ground rules
//! require.

use std::sync::Mutex;
use std::sync::OnceLock;

use cybermanju_db::Database;
use redb::ReadableTable;

use crate::api::{Kernel, OpenFlags};
use crate::task::{TaskState, TaskTable};

/// Max rows kept in persisted shell history.
const HISTORY_LIMIT: usize = 200;

/// ANSI: reset / bright / colours used by the shell's own output.
pub const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const BLUE: &str = "\x1b[34m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";
const CYAN: &str = "\x1b[36m";
/// ANSI: clear screen + home cursor (`clear`).
pub const CLEAR_SCREEN: &str = "\x1b[2J\x1b[H";

// ─── process-wide shell state ───────────────────────────────────────────

fn cwd() -> &'static Mutex<String> {
    static CWD: OnceLock<Mutex<String>> = OnceLock::new();
    CWD.get_or_init(|| Mutex::new("/".to_string()))
}

fn history() -> &'static Mutex<Vec<String>> {
    static HISTORY: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    HISTORY.get_or_init(|| Mutex::new(Vec::new()))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn current_dir() -> String {
    lock(cwd()).clone()
}

fn set_dir(path: String) {
    *lock(cwd()) = path;
}

/// Every command name, in help order — also the tab-completion table.
pub fn command_table() -> &'static [&'static str] {
    &[
        "help",
        "history",
        "clear",
        "version",
        "echo",
        "ls",
        "cd",
        "pwd",
        "cat",
        "cp",
        "mv",
        "rm",
        "mkdir",
        "touch",
        "stat",
        "du",
        "df",
        "mount",
        "umount",
        "disk",
        "providers",
        "quota",
        "sync",
        "scrub",
        "repair",
        "gc",
        "lease",
        "ps",
        "top",
        "kill",
        "jobs",
        "compute",
        "workers",
        "keygen",
        "encrypt",
        "decrypt",
        "search",
        "ai",
    ]
}

/// Tab-completion candidates: commands, then sub-commands, filtered by
/// whatever the user has typed so far.
pub fn completions(prefix: &str) -> Vec<String> {
    let mut out: Vec<String> = command_table()
        .iter()
        .filter(|c| c.starts_with(prefix))
        .map(|c| c.to_string())
        .collect();
    let sub: &[&str] = &[
        "disk create",
        "disk attach",
        "disk detach",
        "disk resize",
        "disk list",
        "disk check",
        "ai ask",
        "ai init",
        "ai status",
        "ai abort",
        "ai sessions",
        "sync start",
        "sync status",
        "sync cancel",
        "compute run",
        "lease status",
        "history clear",
    ];
    for s in sub {
        if s.starts_with(prefix) && !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// `did-you-mean` helper: `"unknown command: 'lss' — did you mean 'ls'?"`
pub fn did_you_mean(what: &str, got: &str, candidates: &[&str]) -> String {
    let mut best: Option<(usize, &str)> = None;
    for candidate in candidates {
        let d = distance(got, candidate);
        if d * 3 <= got.len().max(candidate.len()).max(3)
            && best.map(|(bd, _)| d < bd).unwrap_or(true)
        {
            best = Some((d, candidate));
        }
    }
    match best {
        Some((_, c)) => format!("{what}: '{got}' — did you mean '{c}'?"),
        None => format!("{what}: '{got}'"),
    }
}

/// Damerau-free Levenshtein distance (small inputs only).
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

// ─── tokenizer / parser ─────────────────────────────────────────────────

/// A parsed token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Word(String),
    /// `|`
    Pipe,
    /// `&&`
    And,
    /// `||`
    Or,
    /// `;`
    Semi,
}

/// Split a command line into tokens, honouring `'…'`, `"…"`, `\ ` escapes
/// and the control operators `|`, `&&`, `||`, `;`.
pub fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut had_word = false;
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' if i + 1 < chars.len() => {
                word.push(chars[i + 1]);
                had_word = true;
                i += 2;
                continue;
            }
            '\'' => {
                had_word = true;
                i += 1;
                while i < chars.len() && chars[i] != '\'' {
                    word.push(chars[i]);
                    i += 1;
                }
                if i >= chars.len() {
                    return Err(format!("syntax: unclosed quote in `{input}`"));
                }
                i += 1;
                continue;
            }
            '"' => {
                had_word = true;
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    if chars[i] == '\\' && i + 1 < chars.len() {
                        word.push(chars[i + 1]);
                        i += 2;
                    } else {
                        word.push(chars[i]);
                        i += 1;
                    }
                }
                if i >= chars.len() {
                    return Err(format!("syntax: unclosed quote in `{input}`"));
                }
                i += 1;
                continue;
            }
            '&' if chars.get(i + 1) == Some(&'&') => {
                flush_word(&mut word, &mut had_word, &mut tokens);
                tokens.push(Token::And);
                i += 2;
                continue;
            }
            '|' if chars.get(i + 1) == Some(&'|') => {
                flush_word(&mut word, &mut had_word, &mut tokens);
                tokens.push(Token::Or);
                i += 2;
                continue;
            }
            '|' => {
                flush_word(&mut word, &mut had_word, &mut tokens);
                tokens.push(Token::Pipe);
                i += 1;
                continue;
            }
            ';' => {
                flush_word(&mut word, &mut had_word, &mut tokens);
                tokens.push(Token::Semi);
                i += 1;
                continue;
            }
            c if c.is_whitespace() => {
                flush_word(&mut word, &mut had_word, &mut tokens);
                i += 1;
                continue;
            }
            c => {
                word.push(c);
                had_word = true;
                i += 1;
                continue;
            }
        }
    }
    flush_word(&mut word, &mut had_word, &mut tokens);
    Ok(tokens)
}

fn flush_word(word: &mut String, had_word: &mut bool, tokens: &mut Vec<Token>) {
    if *had_word {
        tokens.push(Token::Word(std::mem::take(word)));
        *had_word = false;
    }
}

/// How two stages/segments are joined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    Then,
    And,
    Or,
}

/// One shell line: a sequence of pipelines joined by `;`, `&&` or `||`.
#[derive(Debug)]
pub struct Line {
    pub segments: Vec<(Link, Vec<Vec<String>>)>,
}

/// Parse tokens into pipelines.
pub fn parse(tokens: Vec<Token>) -> Result<Line, String> {
    let mut segments: Vec<(Link, Vec<Vec<String>>)> = Vec::new();
    let mut link = Link::Then;
    let mut pipeline: Vec<Vec<String>> = Vec::new();
    let mut cmd: Vec<String> = Vec::new();
    let mut saw_any = false;

    for token in tokens {
        match token {
            Token::Word(w) => {
                cmd.push(w);
                saw_any = true;
            }
            Token::Pipe => {
                if cmd.is_empty() {
                    return Err("syntax: pipe with nothing before it".to_string());
                }
                pipeline.push(std::mem::take(&mut cmd));
            }
            Token::And | Token::Or | Token::Semi => {
                if cmd.is_empty() && pipeline.is_empty() {
                    return Err("syntax: empty command".to_string());
                }
                if !cmd.is_empty() {
                    pipeline.push(std::mem::take(&mut cmd));
                }
                segments.push((link, std::mem::take(&mut pipeline)));
                link = match token {
                    Token::And => Link::And,
                    Token::Or => Link::Or,
                    _ => Link::Then,
                };
            }
        }
    }
    if !cmd.is_empty() {
        pipeline.push(cmd);
    }
    if !pipeline.is_empty() {
        segments.push((link, pipeline));
    }
    if !saw_any {
        return Err("syntax: nothing to run".to_string());
    }
    Ok(Line { segments })
}

// ─── execution ──────────────────────────────────────────────────────────

/// Execute one shell line. Returns the rendered output (which may contain
/// ANSI sequences) or `Err("prefix: detail")`.
pub fn execute(line: &str, db: Option<&Database>) -> Result<String, String> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(String::new());
    }
    let tokens = tokenize(line)?;
    let parsed = parse(tokens)?;

    let mut out = String::new();
    let mut last_ok = true;
    let total = parsed.segments.len();
    for (index, (link, pipeline)) in parsed.segments.iter().enumerate() {
        if (link == &Link::And && !last_ok) || (link == &Link::Or && last_ok) {
            continue;
        }
        let mut stdin = String::new();
        let mut stage_out = String::new();
        let mut stage_ok = true;
        for cmd in pipeline {
            let (cmd, wants_json) = strip_json(cmd);
            match dispatch(&cmd, &stdin, db, wants_json) {
                Ok(text) => {
                    stdin = text.clone();
                    stage_out = text;
                }
                Err(e) => {
                    stage_ok = false;
                    stage_out = e;
                    break;
                }
            }
        }
        last_ok = stage_ok;
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&stage_out);
        if stage_ok {
            continue;
        }
        // A failed stage only aborts the line when the next stage cannot
        // recover from it: `… || fallback` and `… ; next` both keep going,
        // `… && next` stops (and the error is returned to the caller).
        match parsed.segments.get(index + 1).map(|(l, _)| *l) {
            Some(Link::Or) | Some(Link::Then) => continue,
            Some(Link::And) | None => return Err(stage_out),
        }
    }
    let _ = total;
    Ok(out)
}

fn strip_json(cmd: &[String]) -> (Vec<String>, bool) {
    let mut json = false;
    let mut out = Vec::with_capacity(cmd.len());
    for part in cmd {
        if part == "--json" {
            json = true;
        } else {
            out.push(part.clone());
        }
    }
    (out, json)
}

// ─── `sync start` starter core ────────────────────────────────────────────

/// A parsed `sync start` invocation.
///
/// Pure, portable parsing only — no I/O, no locks, no threads. This is the
/// "coreutils-style" core shared by every transport: the native shell, the
/// REST intercept in `POST /api/os/exec` (which turns it into a detached
/// `202`-style job via `start_job`), and later the WASM dispatcher. Callers
/// that cannot run a detached job (bare `execute()` with no shared database
/// handle) keep answering the honest `unsupported:` below.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncStart {
    /// Explicit config id, or `None` = first enabled config.
    pub config_id: Option<String>,
    /// File ids to sync; empty = whole library.
    pub file_ids: Vec<String>,
}

/// Parse a full shell line as `sync start [config-id] [file-id …]`.
///
/// Returns `None` for anything else — including multi-stage pipelines and
/// `sync status`/`sync cancel` (those already run lock-free inside
/// `execute`). `--json` flags are ignored, like everywhere else in `cybsh`.
pub fn parse_sync_start(line: &str) -> Option<SyncStart> {
    let tokens = tokenize(line).ok()?;
    let parsed = parse(tokens).ok()?;
    if parsed.segments.len() != 1 {
        return None;
    }
    let (_, pipeline) = &parsed.segments[0];
    if pipeline.len() != 1 {
        return None;
    }
    let cmd = &pipeline[0];
    if cmd.first().map(String::as_str) != Some("sync") {
        return None;
    }
    if cmd.get(1).map(String::as_str) != Some("start") {
        return None;
    }
    let mut rest: Vec<String> = cmd
        .iter()
        .skip(2)
        .filter(|a| a.as_str() != "--json")
        .cloned()
        .collect();
    let config_id = if rest.is_empty() {
        None
    } else {
        Some(rest.remove(0))
    };
    Some(SyncStart {
        config_id,
        file_ids: rest,
    })
}

// ─── `ai …` starter core ─────────────────────────────────────────────────

/// A parsed `ai` invocation — same portable-core contract as `SyncStart`:
/// pure parsing shared by the shell and the lockless REST intercept, which
/// turns `ai ask` into a detached agent job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiCommand {
    /// `ai ask "<prompt>" [--config <id>] [--session <id>]`.
    Ask {
        prompt: String,
        config_id: Option<String>,
        session_id: Option<String>,
    },
    /// `ai status [job-id]`.
    Status { job_id: Option<String> },
    /// `ai abort [job-id]`.
    Abort { job_id: Option<String> },
    /// `ai sessions`.
    Sessions,
    /// `ai init [--config <id>]` — analyze the repo, write AGENTS.md.
    Init { config_id: Option<String> },
}

/// Parse a full shell line as one `ai` subcommand. Single-command lines
/// only; `--json` is accepted anywhere and ignored here (the dispatcher
/// strips it again). Returns `None` for anything else.
pub fn parse_ai_command(line: &str) -> Option<AiCommand> {
    let tokens = tokenize(line).ok()?;
    let parsed = parse(tokens).ok()?;
    if parsed.segments.len() != 1 {
        return None;
    }
    let (_, pipeline) = &parsed.segments[0];
    if pipeline.len() != 1 {
        return None;
    }
    let cmd = &pipeline[0];
    if cmd.first().map(String::as_str) != Some("ai") {
        return None;
    }
    match cmd.get(1).map(String::as_str) {
        Some("ask") => {
            let mut prompt_parts: Vec<String> = Vec::new();
            let mut config_id: Option<String> = None;
            let mut session_id: Option<String> = None;
            let mut rest = cmd.iter().skip(2);
            while let Some(arg) = rest.next() {
                match arg.as_str() {
                    "--config" => config_id = rest.next().cloned(),
                    "--session" => session_id = rest.next().cloned(),
                    "--json" => {}
                    other => prompt_parts.push(other.to_string()),
                }
            }
            let prompt = prompt_parts.join(" ").trim().to_string();
            if prompt.is_empty() {
                return None;
            }
            Some(AiCommand::Ask {
                prompt,
                config_id,
                session_id,
            })
        }
        Some("status") => Some(AiCommand::Status {
            job_id: cmd.get(2).filter(|s| s.as_str() != "--json").cloned(),
        }),
        Some("abort") => Some(AiCommand::Abort {
            job_id: cmd.get(2).filter(|s| s.as_str() != "--json").cloned(),
        }),
        Some("sessions") => Some(AiCommand::Sessions),
        Some("init") => {
            let mut config_id: Option<String> = None;
            let mut rest = cmd.iter().skip(2);
            while let Some(arg) = rest.next() {
                match arg.as_str() {
                    "--config" => config_id = rest.next().cloned(),
                    "--json" => {}
                    _ => return None,
                }
            }
            Some(AiCommand::Init { config_id })
        }
        _ => None,
    }
}

/// How many lines the human-readable tables keep (REST bodies stay small).
const MAX_LINES: usize = 400;

fn truncate(text: String) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= MAX_LINES {
        return text;
    }
    let mut out: String = lines[..MAX_LINES].join("\n");
    out.push_str(&format!(
        "\n{DIM}… {} more lines (use --json for the full list){RESET}",
        lines.len() - MAX_LINES
    ));
    out
}

fn dispatch(
    cmd: &[String],
    stdin: &str,
    db: Option<&Database>,
    json: bool,
) -> Result<String, String> {
    if cmd.is_empty() {
        return Ok(String::new());
    }
    let name = cmd[0].as_str();
    let args = &cmd[1..];
    match name {
        "help" => Ok(help_text(json)),
        "version" => version_cmd(json),
        "clear" => Ok(CLEAR_SCREEN.to_string()),
        "echo" => Ok(merge_args(args)),
        "history" => history_cmd(args, db, json),
        "pwd" => Ok(current_dir()),
        "cd" => cd_cmd(args),
        "ls" => ls_cmd(args, db, json),
        "cat" => cat_cmd(args, stdin, db),
        "cp" => cp_cmd(args, db),
        "mv" => mv_cmd(args, db),
        "rm" => rm_cmd(args, db),
        "mkdir" => mkdir_cmd(args, db),
        "touch" => touch_cmd(args, db),
        "stat" => stat_cmd(args, db, json),
        "du" => du_cmd(args, db, json),
        "df" => df_cmd(db, json),
        "disk" => disk_cmd(args, db, json),
        "mount" => mount_cmd(args, db, json),
        "umount" => umount_cmd(args, db, json),
        "providers" => providers_cmd(db, json),
        "quota" => quota_cmd(db, json),
        "sync" => sync_cmd(args, db, json),
        "scrub" => scrub_cmd(db, json),
        "repair" => repair_cmd(db, json),
        "gc" => gc_cmd(args, db, json),
        "lease" => lease_cmd(args, db, json),
        "ps" => ps_cmd(db, json),
        "top" => top_cmd(db, json),
        "kill" => kill_cmd(args, json),
        "jobs" => jobs_cmd(json),
        "compute" => compute_cmd(args, db, json),
        "workers" => workers_cmd(db, json),
        "keygen" => keygen_cmd(args, db, json),
        "encrypt" => encrypt_cmd(args, json),
        "decrypt" => decrypt_cmd(args, json),
        "search" => search_cmd(args, json),
        "ai" => ai_cmd(args, db, json),
        unknown => Err(did_you_mean("unknown command", unknown, command_table())),
    }
}

fn merge_args(args: &[String]) -> String {
    args.join(" ")
}

// ─── builtins ───────────────────────────────────────────────────────────

fn help_text(json: bool) -> String {
    let groups: &[(&str, &[&str])] = &[
        ("general", &["help", "history", "clear", "version", "echo"]),
        (
            "files",
            &[
                "ls", "cd", "pwd", "cat", "cp", "mv", "rm", "mkdir", "touch", "stat", "du",
            ],
        ),
        (
            "volume",
            &[
                "df",
                "mount",
                "umount",
                "disk create|attach|detach|resize|list|check",
            ],
        ),
        (
            "providers",
            &["providers", "quota", "sync start|status|cancel"],
        ),
        ("durability", &["scrub", "repair", "gc", "lease status"]),
        ("tasks", &["ps", "top", "kill <id>"]),
        ("compute", &["jobs", "compute run <job> <path>", "workers"]),
        ("crypto/search", &["keygen", "encrypt", "decrypt", "search"]),
        (
            "agent",
            &[
                "ai ask \"…\" [--config <id>] [--session <id>]",
                "ai init [--config <id>]",
                "ai status|abort|sessions",
            ],
        ),
    ];
    if json {
        let value = serde_json::json!({
            "prompt": crate::PROMPT,
            "version": crate::OS_VERSION,
            "commands": command_table(),
            "groups": groups.iter().map(|(g, cs)| serde_json::json!({ "group": g, "commands": cs })).collect::<Vec<_>>(),
            "operators": ["|", "&&", "||", ";", "--json"],
        });
        return serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string());
    }
    let mut out = format!(
        "{BOLD}cybsh{RESET} — the CyberManju OS shell (v{})\n\n",
        crate::OS_VERSION
    );
    for (group, cmds) in groups {
        out.push_str(&format!("{CYAN}{group}{RESET}\n"));
        for cmd in *cmds {
            out.push_str(&format!("  {cmd}\n"));
        }
    }
    out.push_str(&format!(
        "\n{DIM}operators:{RESET} |  &&  ||  ;    {DIM}flags:{RESET} --json\n{DIM}tab completion works on every command; ↑/↓ walks history.{RESET}\n"
    ));
    out
}

fn version_cmd(json: bool) -> Result<String, String> {
    let version = crate::OS_VERSION;
    if json {
        return Ok(format!(
            "{{\n  \"shell\": \"cybsh\",\n  \"osVersion\": {version},\n  \"kernel\": \"{}\",\n  \"tasks\": {}\n}}",
            std::env::consts::OS,
            TaskTable::global().counts().total
        ));
    }
    Ok(format!("cybsh {version} ({})", std::env::consts::OS))
}

fn history_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    if args.first().map(String::as_str) == Some("clear") {
        lock(history()).clear();
        if let Some(db) = db {
            let keys: Vec<String> = {
                let tx = db.begin_read().map_err(|e| e.to_string())?;
                let table = tx
                    .open_table(Database::get_shell_history_table())
                    .map_err(|e| e.to_string())?;
                let keys = table
                    .iter()
                    .map_err(|e| e.to_string())?
                    .filter_map(|e| e.ok().map(|(k, _)| k.value().to_string()))
                    .collect::<Vec<_>>();
                drop(table);
                drop(tx);
                keys
            };
            let tx = db.begin_write().map_err(|e| e.to_string())?;
            {
                let mut table = tx
                    .open_table(Database::get_shell_history_table())
                    .map_err(|e| e.to_string())?;
                for key in &keys {
                    table.remove(key.as_str()).map_err(|e| e.to_string())?;
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        return Ok(if json {
            "{\"cleared\":true}".to_string()
        } else {
            "history cleared".to_string()
        });
    }

    let mut rows: Vec<String> = lock(history()).clone();
    if rows.is_empty() {
        if let Some(db) = db {
            rows = load_history(db)?;
        }
    }
    let limit = args
        .first()
        .and_then(|a| a.parse::<usize>().ok())
        .unwrap_or(rows.len())
        .min(rows.len());
    let start = rows.len().saturating_sub(limit);
    let shown: Vec<&String> = rows[start..].iter().collect();
    if json {
        let value: Vec<serde_json::Value> = shown
            .iter()
            .enumerate()
            .map(|(i, line)| serde_json::json!({ "n": start + i + 1, "line": line }))
            .collect();
        return serde_json::to_string(&value).map_err(|e| e.to_string());
    }
    if shown.is_empty() {
        return Ok("history is empty".to_string());
    }
    let width = (start + shown.len()).to_string().len();
    Ok(shown
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:>width$}  {line}", start + i + 1, width = width))
        .collect::<Vec<_>>()
        .join("\n"))
}

/// Restore history from `shell_history` (first use per process).
fn load_history(db: &Database) -> Result<Vec<String>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_shell_history_table())
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<(String, String)> = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (key, value) = entry.map_err(|e| e.to_string())?;
        rows.push((key.value().to_string(), value.value().to_string()));
    }
    drop(table);
    drop(tx);
    rows.sort();
    let lines: Vec<String> = rows
        .into_iter()
        .filter_map(|(_, value)| {
            serde_json::from_str::<serde_json::Value>(&value)
                .ok()
                .and_then(|v| v.get("line").and_then(|l| l.as_str()).map(str::to_string))
        })
        .collect();
    let mut hist = lock(history());
    if hist.is_empty() {
        *hist = lines;
    }
    Ok(hist.clone())
}

/// Record an executed line (memory + `shell_history`).
fn record_history(line: &str, db: Option<&Database>) {
    {
        let mut hist = lock(history());
        if hist.last().map(String::as_str) != Some(line) {
            hist.push(line.to_string());
        }
        while hist.len() > HISTORY_LIMIT {
            hist.remove(0);
        }
    }
    let Some(db) = db else { return };
    let n = lock(history()).len();
    let json = serde_json::json!({ "line": line, "at": chrono::Utc::now().to_rfc3339() });
    let result = (|| -> Result<(), String> {
        let tx = db.begin_write().map_err(|e| e.to_string())?;
        {
            let mut table = tx
                .open_table(Database::get_shell_history_table())
                .map_err(|e| e.to_string())?;
            table
                .insert(format!("{n:08}").as_str(), json.to_string().as_str())
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        log::debug!("could not persist shell history: {e}");
    }
}

fn cd_cmd(args: &[String]) -> Result<String, String> {
    let kernel = Kernel::global();
    let target = if args.is_empty() {
        "/".to_string()
    } else {
        let arg = args[0].as_str();
        if arg.starts_with('/') {
            arg.to_string()
        } else {
            let base = current_dir();
            format!("{}/{}", base.trim_end_matches('/'), arg)
        }
    };
    let host = kernel.resolve(&target)?;
    if !host.is_dir() {
        return Err(format!("not a directory: {target}"));
    }
    let display = kernel.display(&host);
    set_dir(display.clone());
    Ok(String::new())
}

fn absolute(arg: &str) -> String {
    if arg.starts_with('/') {
        arg.to_string()
    } else {
        let base = current_dir();
        format!("{}/{}", base.trim_end_matches('/'), arg)
    }
}

fn ls_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let flags: Vec<&String> = args.iter().filter(|a| a.starts_with('-')).collect();
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    let long = flags.iter().any(|f| f.contains('l'));
    let kernel = Kernel::global();
    let target = paths
        .first()
        .map(|p| absolute(p))
        .unwrap_or_else(current_dir);

    if json {
        let entries = kernel.readdir(&target)?;
        return serde_json::to_string(&serde_json::json!({
            "path": target,
            "entries": entries,
        }))
        .map_err(|e| e.to_string());
    }

    let entries = kernel.readdir(&target)?;
    if entries.is_empty() {
        return Ok(String::new());
    }
    let mut out = String::new();
    for entry in &entries {
        let colour = if entry.is_dir { BLUE } else { RESET };
        let name = if entry.is_dir {
            format!("{}/", entry.name)
        } else {
            entry.name.clone()
        };
        if long {
            let kind = if entry.is_dir { "d" } else { "-" };
            out.push_str(&format!(
                "{} {:>10} {} {}{name}{}\n",
                kind,
                human(entry.size_bytes),
                stamp(entry.modified_ms),
                colour,
                RESET
            ));
        } else {
            out.push_str(&format!("{colour}{name}{RESET}  "));
        }
    }
    if !long {
        out.push('\n');
    }
    let _ = db;
    Ok(truncate(out.trim_end().to_string()))
}

fn cat_cmd(args: &[String], stdin: &str, db: Option<&Database>) -> Result<String, String> {
    let kernel = Kernel::global();
    if args.is_empty() {
        return Ok(stdin.to_string());
    }
    let mut out = String::new();
    for arg in args {
        let path = absolute(arg);
        let fd = kernel.open(&path, OpenFlags::read_only())?;
        let mut buf = Vec::new();
        loop {
            let chunk = kernel.read(fd, 64 * 1024)?;
            if chunk.is_empty() {
                break;
            }
            buf.extend_from_slice(&chunk);
        }
        kernel.close(fd)?;
        out.push_str(&String::from_utf8_lossy(&buf));
    }
    let _ = db;
    Ok(out)
}

fn cp_cmd(args: &[String], db: Option<&Database>) -> Result<String, String> {
    if args.len() < 2 {
        return Err("usage: cp <src> <dst>".to_string());
    }
    let kernel = Kernel::global();
    let src = absolute(&args[0]);
    let dst = absolute(&args[1]);
    let meta = kernel.stat(&src)?;
    if meta.is_dir {
        return Err("unsupported: cp of a directory (use `mv`)".to_string());
    }
    let from = kernel.open(&src, OpenFlags::read_only())?;
    let mut data = Vec::new();
    loop {
        let chunk = kernel.read(from, 64 * 1024)?;
        if chunk.is_empty() {
            break;
        }
        data.extend_from_slice(&chunk);
    }
    kernel.close(from)?;
    let to = kernel.open(&dst, OpenFlags::create())?;
    kernel.write(to, &data)?;
    kernel.close(to)?;
    let _ = db;
    Ok(format!("{} → {}", src, dst))
}

fn mv_cmd(args: &[String], db: Option<&Database>) -> Result<String, String> {
    if args.len() < 2 {
        return Err("usage: mv <src> <dst>".to_string());
    }
    let kernel = Kernel::global();
    let src = absolute(&args[0]);
    let dst = absolute(&args[1]);
    kernel.rename(&src, &dst)?;
    let _ = db;
    Ok(format!("{src} → {dst}"))
}

fn rm_cmd(args: &[String], db: Option<&Database>) -> Result<String, String> {
    let recursive = args.iter().any(|a| a == "-r" || a == "-rf" || a == "-fr");
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    if paths.is_empty() {
        return Err("usage: rm [-r] <path>".to_string());
    }
    let kernel = Kernel::global();
    let mut out = Vec::new();
    for arg in paths {
        let path = absolute(arg);
        if recursive {
            let freed = kernel.remove_tree(&path)?;
            out.push(format!("{path} removed ({} freed)", human(freed)));
        } else {
            kernel.unlink(&path)?;
            out.push(format!("{path} removed"));
        }
    }
    let _ = db;
    Ok(out.join("\n"))
}

fn mkdir_cmd(args: &[String], db: Option<&Database>) -> Result<String, String> {
    let parents = args.iter().any(|a| a == "-p");
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    if paths.is_empty() {
        return Err("usage: mkdir [-p] <path>".to_string());
    }
    let kernel = Kernel::global();
    for arg in &paths {
        let path = absolute(arg);
        if !parents {
            kernel.mkdir(&path)?;
            continue;
        }
        // `mkdir -p`: walk the components, ignoring "already exists".
        let mut acc = String::new();
        for part in path.trim_start_matches('/').split('/') {
            if part.is_empty() {
                continue;
            }
            acc.push('/');
            acc.push_str(part);
            if kernel.stat(&acc).is_ok() {
                continue;
            }
            kernel.mkdir(&acc)?;
        }
    }
    let _ = db;
    Ok(paths
        .iter()
        .map(|p| p.as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn touch_cmd(args: &[String], db: Option<&Database>) -> Result<String, String> {
    if args.is_empty() {
        return Err("usage: touch <path>".to_string());
    }
    let kernel = Kernel::global();
    for arg in args {
        let path = absolute(arg);
        if kernel.stat(&path).is_ok() {
            continue;
        }
        let fd = kernel.open(
            &path,
            OpenFlags {
                create: true,
                write: true,
                ..OpenFlags::default()
            },
        )?;
        kernel.close(fd)?;
    }
    let _ = db;
    Ok(String::new())
}

fn stat_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    if args.is_empty() {
        return Err("usage: stat <path>".to_string());
    }
    let kernel = Kernel::global();
    let path = absolute(&args[0]);
    let stat = kernel.stat(&path)?;
    let _ = db;
    if json {
        return serde_json::to_string(&stat).map_err(|e| e.to_string());
    }
    Ok(format!(
        "{BOLD}{}{RESET}\n  type: {}\n  size: {} bytes\n  modified: {}",
        stat.path,
        stat.kind,
        stat.size_bytes,
        stamp(stat.modified_ms)
    ))
}

fn du_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let kernel = Kernel::global();
    let target = args
        .first()
        .map(|a| absolute(a))
        .unwrap_or_else(current_dir);
    let (bytes, files) = kernel.du(&target)?;
    let _ = db;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "path": target,
            "bytes": bytes,
            "files": files,
        }))
        .map_err(|e| e.to_string());
    }
    Ok(format!(
        "{}  {target}  ({files} file{})",
        human(bytes),
        plural(files)
    ))
}

fn df_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let kernel = Kernel::global();
    let df = kernel.df(db);
    if json {
        return serde_json::to_string(&df).map_err(|e| e.to_string());
    }
    let used_pct = if df.total_bytes == 0 {
        0.0
    } else {
        df.used_bytes as f64 / df.total_bytes as f64 * 100.0
    };
    let mut out = format!(
        "{BOLD}merged volume{RESET}  {} root={}\n  total {}  used {} ({used_pct:.1}%)  free {}\n",
        df.root,
        df.root,
        human(df.total_bytes),
        human(df.used_bytes),
        human(df.free_bytes)
    );
    out.push_str(&bar(used_pct, 40, GREEN, YELLOW));
    out.push_str(&format!(
        "\n  scratch {}  attached {} across {} disk{}\n",
        human(df.scratch_bytes),
        human(df.attached_bytes),
        df.disk_count,
        plural(df.disk_count as u64)
    ));
    if df.disks.is_empty() {
        out.push_str(&format!(
            "{DIM}  no disks attached — `disk create` one to grow the volume{RESET}\n"
        ));
    } else {
        out.push_str(&format!(
            "\n  {:<16} {:>8} {:>8} {:>8} {:>8}  {}\n",
            "DISK", "CAP", "USED", "FREE", "SLOTS", "STATE"
        ));
        for disk in &df.disks {
            let used = disk.used_bytes;
            out.push_str(&format!(
                "  {:<16} {:>8} {:>8} {:>8} {:>8}  {}\n",
                disk.id,
                human(disk.capacity_bytes),
                human(used),
                human(disk.capacity_bytes.saturating_sub(used)),
                disk.compute,
                disk.state
            ));
        }
    }
    Ok(out.trim_end().to_string())
}

// ─── disks / mount ──────────────────────────────────────────────────────

fn disk_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: disk commands need the database".to_string())?;
    let sub = args.first().map(String::as_str).unwrap_or("list");
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    match sub {
        "list" => {
            let disks = cybermanju_disk::disk::list(db)?;
            if json {
                return serde_json::to_string(&disks).map_err(|e| e.to_string());
            }
            if disks.is_empty() {
                return Ok("no disks — `disk create <config> <size>` to make one".to_string());
            }
            let mut out = format!(
                "{:<16} {:>9} {:>9} {:>9} {:<9} {}\n",
                "ID", "CAP", "USED", "FREE", "STATE", "PROVIDER"
            );
            for d in &disks {
                out.push_str(&format!(
                    "{:<16} {:>9} {:>9} {:>9} {:<9} {}\n",
                    d.id,
                    human(d.capacity_bytes),
                    human(d.used_bytes),
                    human(d.free_bytes()),
                    d.state,
                    d.provider
                ));
            }
            Ok(truncate(out.trim_end().to_string()))
        }
        "create" => {
            if rest.len() < 2 {
                return Err("usage: disk create <config-id> <size[K|M|G]> [passphrase]".to_string());
            }
            let size = parse_size(&rest[1])?;
            let passphrase = rest
                .get(2)
                .cloned()
                .or_else(cybermanju_crypto::keystore::master_passphrase)
                .unwrap_or_default();
            let row = cybermanju_disk::disk::create(db, &rest[0], size, &passphrase)?;
            if json {
                return serde_json::to_string(&row).map_err(|e| e.to_string());
            }
            Ok(format!(
                "created {} ({} on {})",
                row.id,
                human(row.capacity_bytes),
                row.provider
            ))
        }
        "attach" | "mount" => {
            let id = rest.first().ok_or("usage: disk attach <id>")?;
            let passphrase = rest
                .get(1)
                .cloned()
                .or_else(cybermanju_crypto::keystore::master_passphrase)
                .unwrap_or_default();
            let row = cybermanju_disk::disk::attach(db, id, &passphrase)?;
            if json {
                return serde_json::to_string(&row).map_err(|e| e.to_string());
            }
            Ok(format!(
                "{} attached — volume grew to {}",
                row.id,
                human(
                    crate::api::list_disks(db)?
                        .into_iter()
                        .filter(|d| d.attached())
                        .map(|d| d.capacity_bytes)
                        .sum::<u64>()
                        + crate::api::DEFAULT_CAPACITY_BYTES
                )
            ))
        }
        "detach" | "umount" => {
            let id = rest.first().ok_or("usage: disk detach <id>")?;
            let row = cybermanju_disk::disk::detach(db, id)?;
            if json {
                return serde_json::to_string(&row).map_err(|e| e.to_string());
            }
            Ok(format!("{} detached", row.id))
        }
        "resize" => {
            if rest.len() < 2 {
                return Err("usage: disk resize <id> <size>".to_string());
            }
            let size = parse_size(&rest[1])?;
            let row = cybermanju_disk::disk::resize(db, &rest[0], size)?;
            if json {
                return serde_json::to_string(&row).map_err(|e| e.to_string());
            }
            Ok(format!(
                "{} resized to {}",
                row.id,
                human(row.capacity_bytes)
            ))
        }
        "check" => {
            let id = rest.first().ok_or("usage: disk check <id>")?;
            let report = cybermanju_disk::disk::check(db, id)?;
            if json {
                return serde_json::to_string(&report).map_err(|e| e.to_string());
            }
            let mut out = format!(
                "{}: blocks {} / container {} / orphans {} / pending {}\n",
                report.disk_id,
                report.blocks,
                report.container_blocks,
                report.orphans,
                report.pending_checkpoint
            );
            if report.locked {
                out.push_str("state: locked — attach the disk first\n");
            }
            for problem in &report.problems {
                out.push_str(&format!("{RED}{problem}{RESET}\n"));
            }
            let health = if report.ok {
                format!("{GREEN}ok{RESET}")
            } else {
                format!("{RED}problems{RESET}")
            };
            out.push_str(&health);
            Ok(out)
        }
        other => Err(did_you_mean(
            "unknown disk subcommand",
            other,
            &["create", "attach", "detach", "resize", "list", "check"],
        )),
    }
}

fn mount_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    if args.is_empty() {
        // `mount` with no arguments lists the mounted disks.
        return disk_cmd(&["list".to_string()], db, json);
    }
    disk_cmd(
        &["attach".to_string()]
            .into_iter()
            .chain(args.to_vec())
            .collect::<Vec<_>>(),
        db,
        json,
    )
}

fn umount_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    if args.is_empty() {
        return Err("usage: umount <disk-id>".to_string());
    }
    disk_cmd(
        &["detach".to_string()]
            .into_iter()
            .chain(args.to_vec())
            .collect::<Vec<_>>(),
        db,
        json,
    )
}

/// `10G`, `512M`, `1024K`, or plain bytes.
fn parse_size(raw: &str) -> Result<u64, String> {
    let raw = raw.trim();
    let (digits, mult) = match raw.chars().last().unwrap_or('0') {
        'k' | 'K' => (&raw[..raw.len() - 1], 1024u64),
        'm' | 'M' => (&raw[..raw.len() - 1], 1024 * 1024),
        'g' | 'G' => (&raw[..raw.len() - 1], 1024 * 1024 * 1024),
        'b' | 'B' => (&raw[..raw.len() - 1], 1),
        _ => (raw, 1),
    };
    let n: u64 = digits
        .trim()
        .parse()
        .map_err(|_| format!("invalid: size '{raw}' (use 4096, 512M, 10G)"))?;
    n.checked_mul(mult)
        .ok_or_else(|| format!("invalid: size '{raw}' overflows u64"))
}

// ─── providers / sync / durability ──────────────────────────────────────

fn providers_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: providers need the database".to_string())?;
    let configs = db.list_sync_configs().map_err(|e| e.to_string())?;
    let disks = crate::api::list_disks(db)?;
    if json {
        let rows: Vec<serde_json::Value> = configs
            .iter()
            .map(|c| {
                let caps = crate::compute::capabilities_for(&c.backend_type);
                serde_json::json!({
                    "id": c.id,
                    "backend": c.backend_type.to_string(),
                    "enabled": c.enabled,
                    "compute": caps.compute,
                    "maxSizeBytes": caps.max_size_bytes,
                    "disk": disks.iter().find(|d| d.provider == c.id).map(|d| serde_json::json!({
                        "id": d.id, "state": d.state, "capacityBytes": d.capacity_bytes,
                    })),
                })
            })
            .collect();
        return serde_json::to_string(&rows).map_err(|e| e.to_string());
    }
    if configs.is_empty() && disks.is_empty() {
        return Ok("no providers connected — add one in Settings".to_string());
    }
    let mut out = format!(
        "{:<18} {:<12} {:<9} {:>6}  {}\n",
        "ID", "BACKEND", "ENABLED", "SLOTS", "DISK"
    );
    for c in &configs {
        let caps = crate::compute::capabilities_for(&c.backend_type);
        let disk = disks
            .iter()
            .find(|d| d.provider == c.id || d.id == c.id)
            .map(|d| format!("{} ({})", d.id, d.state))
            .unwrap_or_else(|| "—".to_string());
        out.push_str(&format!(
            "{:<18} {:<12} {:<9} {:>6}  {}\n",
            c.id,
            c.backend_type.to_string(),
            if c.enabled { "yes" } else { "no" },
            caps.compute,
            disk
        ));
    }
    for d in disks
        .iter()
        .filter(|d| !configs.iter().any(|c| c.id == d.provider || c.id == d.id))
    {
        out.push_str(&format!(
            "{:<18} {:<12} {:<9} {:>6}  {}\n",
            d.provider, "disk", d.state, d.compute, d.id
        ));
    }
    Ok(out.trim_end().to_string())
}

fn quota_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: quota needs the database".to_string())?;
    let configs = db.list_sync_configs().map_err(|e| e.to_string())?;
    let config = configs
        .into_iter()
        .find(|c| c.enabled)
        .ok_or_else(|| "not found: no enabled provider to query".to_string())?;
    let usage = cybermanju_sync::quota_usage(&config).map_err(|e| e.to_string())?;
    if json {
        return serde_json::to_string(&usage).map_err(|e| e.to_string());
    }
    let total = usage
        .total_bytes
        .map(human)
        .unwrap_or_else(|| "?".to_string());
    let used = usage
        .used_bytes
        .map(human)
        .unwrap_or_else(|| "?".to_string());
    Ok(format!(
        "{} ({}): used {} of {} · source: {}",
        config.id, config.backend_type, used, total, usage.detail
    ))
}

/// `ai …` — native agent runs from the terminal.
///
/// Like `sync start`, the real execution needs a detached worker plus the
/// shared database handle, which bare `execute()` does not have (and the
/// job registry lives in `cybermanju-web`, which this crate cannot depend
/// on without a cycle). So this arm is the honest fallback: `POST
/// /api/os/exec` intercepts `ai ask …` locklessly and runs it detached —
/// see `parse_ai_command` and the REST intercept.
fn ai_cmd(args: &[String], _db: Option<&Database>, json: bool) -> Result<String, String> {
    const HINT: &str =
        "run it via POST /api/os/exec {\"line\": \"ai …\"} or the Agent panel; see docs/OPERATIONS.md";
    let sub = args.first().map(String::as_str).unwrap_or("ask");
    if json {
        return serde_json::to_string(&serde_json::json!({
            "started": false,
            "subcommand": sub,
            "error": format!("unsupported: `ai {sub}` needs a detached worker — {HINT}"),
        }))
        .map_err(|e| e.to_string());
    }
    Err(match sub {
        "ask" | "init" => format!("unsupported: `ai {sub}` needs a detached worker — {HINT}"),
        "status" | "abort" | "sessions" => {
            format!("unsupported: `ai {sub}` is served over REST — {HINT}")
        }
        other => did_you_mean(
            "unknown ai subcommand",
            other,
            &["ask", "init", "status", "abort", "sessions"],
        ),
    })
}

fn sync_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let sub = args.first().map(String::as_str).unwrap_or("status");
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    match sub {
        "status" => {
            use cybermanju_sync::state::RunRegistry;
            let latest = RunRegistry::global().latest();
            let snapshot = latest.as_ref().map(|r| r.state.snapshot());
            if json {
                let value = serde_json::json!({
                    "active": latest.as_ref().map(|r| !r.is_finished()).unwrap_or(false),
                    "jobId": latest.as_ref().map(|r| r.run_id.clone()),
                    "progress": snapshot,
                });
                return serde_json::to_string(&value).map_err(|e| e.to_string());
            }
            let Some(run) = latest else {
                return Ok("no sync run yet".to_string());
            };
            let progress = run.state.snapshot();
            Ok(format!(
                "run {} · {} · {}/{} files · {} bytes{}",
                run.run_id,
                progress.status,
                progress.processed_files,
                progress.total_files,
                progress.bytes_uploaded,
                progress
                    .errors
                    .first()
                    .map(|e| format!(" · {RED}{e}{RESET}"))
                    .unwrap_or_default()
            ))
        }
        "cancel" => {
            use cybermanju_sync::state::RunRegistry;
            let job = rest.first().map(String::as_str);
            let cancelled = RunRegistry::global().cancel(job);
            if json {
                return Ok(format!("{{\"cancelled\":{cancelled}}}"));
            }
            Ok(if cancelled {
                "sync run cancelled".to_string()
            } else {
                "no running sync to cancel".to_string()
            })
        }
        "start" => {
            // Bare `execute()` has no shared database handle (`&Database`
            // only lives for one request) and no worker pool, so it cannot
            // run a detached job itself. The real path is one layer up:
            // `POST /api/os/exec` intercepts `sync start …` (see
            // `parse_sync_start` + `try_sync_start_exec`) and runs it as a
            // detached job exactly like `POST /api/sync/start`, returning
            // `202`-style `{jobId}` output. This arm is the honest fallback
            // for direct-library callers (unit tests, embedded use).
            let config_id = rest
                .first()
                .cloned()
                .or_else(|| first_enabled_config(db))
                .unwrap_or_else(|| "—".to_string());
            if json {
                return serde_json::to_string(&serde_json::json!({
                    "started": false,
                    "configId": config_id,
                    "error": "unsupported: `sync start` needs a detached worker — run it via POST /api/os/exec {\"line\": \"sync start …\"} or POST /api/sync/start (202 job). Then `sync status` here.",
                }))
                .map_err(|e| e.to_string());
            }
            Err(format!(
                "unsupported: `sync start` needs a detached worker (config {config_id}) — \
                 run it via POST /api/os/exec or POST /api/sync/start (202 job), \
                 then poll with `sync status`; see docs/OPERATIONS.md"
            ))
        }
        other => Err(did_you_mean(
            "unknown sync subcommand",
            other,
            &["start", "status", "cancel"],
        )),
    }
}

fn first_enabled_config(db: Option<&Database>) -> Option<String> {
    db?.list_sync_configs()
        .ok()?
        .into_iter()
        .find(|c| c.enabled)
        .map(|c| c.id)
}

fn scrub_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: scrub needs the database".to_string())?;
    let run = cybermanju_sync::scrub::scrub(db).map_err(|e| e.to_string())?;
    if json {
        return serde_json::to_string(&run).map_err(|e| e.to_string());
    }
    Ok(format!(
        "scrub {} · {} · {} chunks checked ({} ok, {} corrupt, {} missing) · {} findings in {} ms",
        run.run_id,
        run.status,
        run.checked,
        run.ok,
        run.corrupt,
        run.missing,
        run.findings.len(),
        run.duration_ms
    ))
}

fn repair_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: repair needs the database".to_string())?;
    let queued = cybermanju_sync::repair::drain_findings();
    if queued.is_empty() {
        let status = cybermanju_sync::repair::status(db).map_err(|e| e.to_string())?;
        if json {
            return serde_json::to_string(&status).map_err(|e| e.to_string());
        }
        return Ok(format!(
            "nothing queued — status: {} findings queued, {} repairs ({} repaired, {} unrecoverable, {} skipped), {} tasks",
            status.queued_findings,
            status.repairs.len(),
            status.repaired,
            status.unrecoverable,
            status.skipped,
            status.tasks.len()
        ));
    }
    let count = queued.len();
    let outcome = cybermanju_sync::repair::repair(db, queued).map_err(|e| e.to_string())?;
    cybermanju_sync::repair::apply_outcome(db, &outcome).map_err(|e| e.to_string())?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "rows": outcome.rows,
            "repaired": outcome.repaired(),
            "unrecoverable": outcome.unrecoverable(),
            "skipped": outcome.skipped(),
            "updates": outcome.updates.len(),
        }))
        .map_err(|e| e.to_string());
    }
    Ok(format!(
        "repaired {count} finding(s) · {} rebuilt · {} unrecoverable · {} skipped",
        outcome.repaired(),
        outcome.unrecoverable(),
        outcome.skipped()
    ))
}

fn gc_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let db = db.ok_or_else(|| "unsupported: gc needs the database".to_string())?;
    let dry = args.iter().any(|a| a == "--dry" || a == "--dry-run");
    let report = if dry {
        cybermanju_sync::gc::gc_dry_run(db).map_err(|e| e.to_string())?
    } else {
        cybermanju_sync::gc::gc(db).map_err(|e| e.to_string())?
    };
    if json {
        return serde_json::to_string(&report).map_err(|e| e.to_string());
    }
    Ok(format!(
        "gc{} · {} checked · {} kept · {} deleted · {} bytes freed{}",
        if dry { " (dry run)" } else { "" },
        report.checked,
        report.kept,
        report.deleted,
        report.bytes_freed,
        if report.warnings.is_empty() {
            String::new()
        } else {
            format!(" · {} warnings", report.warnings.len())
        }
    ))
}

fn lease_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let sub = args.first().map(String::as_str).unwrap_or("status");
    if sub != "status" {
        return Err(did_you_mean("unknown lease subcommand", sub, &["status"]));
    }
    let db = db.ok_or_else(|| "unsupported: leases need the database".to_string())?;
    let scope = args.get(1).cloned().unwrap_or_else(|| "volume".to_string());
    let lease = cybermanju_sync::lease::inspect_lease(db, &scope).map_err(|e| e.to_string())?;
    if json {
        return serde_json::to_string(&lease).map_err(|e| e.to_string());
    }
    match lease {
        Some(lease) => Ok(format!(
            "lease '{}' held by {} since {} (expires {})",
            lease.scope, lease.holder, lease.acquired_at, lease.expires_at
        )),
        None => Ok(format!("no lease held for scope '{scope}'")),
    }
}

// ─── tasks / compute ────────────────────────────────────────────────────

fn ps_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let snapshot = crate::task::ps(db);
    if json {
        return serde_json::to_string(&snapshot).map_err(|e| e.to_string());
    }
    if snapshot.tasks.is_empty() {
        return Ok("no tasks".to_string());
    }
    let mut out = format!(
        "{:>4}  {:<9} {:>7} {:>10} {:<10} {:<9} {}",
        "ID", "STATE", "PROGRESS", "BYTES", "PROVIDER", "KIND", "NAME"
    );
    out.push('\n');
    for task in &snapshot.tasks {
        let colour = match task.state {
            TaskState::Running => GREEN,
            TaskState::Failed => RED,
            TaskState::Killed => YELLOW,
            _ => DIM,
        };
        out.push_str(&format!(
            "{:>4}  {}{:<9}{} {:>6.1}% {:>10} {:<10} {:<9} {}\n",
            task.id,
            colour,
            task.state.as_str(),
            RESET,
            task.progress * 100.0,
            human(task.bytes),
            truncate_word(&task.provider, 10),
            task.kind,
            task.name
        ));
    }
    out.push_str(&format!(
        "\ntasks: {} running · {} pending · {} done · {} failed · {} killed · pid {} · up {}",
        snapshot.counts.running,
        snapshot.counts.pending,
        snapshot.counts.done,
        snapshot.counts.failed,
        snapshot.counts.killed,
        snapshot.pid,
        human_ms(snapshot.uptime_ms)
    ));
    Ok(out)
}

fn top_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let snapshot = crate::task::top(db);
    let workers = crate::compute::workers(db);
    if json {
        let value = serde_json::json!({
            "uptimeMs": snapshot.uptime_ms,
            "load": snapshot.load,
            "mem": snapshot.mem,
            "cpuPercent": snapshot.cpu_percent,
            "counts": snapshot.counts,
            "tasks": snapshot.tasks,
            "workers": workers,
        });
        return serde_json::to_string(&value).map_err(|e| e.to_string());
    }
    let load = if snapshot.load.source == "proc" {
        format!(
            "load {} {} {}",
            snapshot.load.load1, snapshot.load.load5, snapshot.load.load15
        )
    } else {
        "load unavailable (/proc/loadavg unreadable here)".to_string()
    };
    let mut out = format!(
        "{BOLD}top{RESET} — up {} · {} · cpu {:.1}% · rss {}\n",
        human_ms(snapshot.uptime_ms),
        load,
        snapshot.cpu_percent,
        human(snapshot.mem.rss_bytes)
    );
    if snapshot.mem.total_bytes > 0 {
        let used = snapshot
            .mem
            .total_bytes
            .saturating_sub(snapshot.mem.available_bytes);
        out.push_str(&format!(
            "  mem {} / {} ({:.1}% used) · available {}\n",
            human(used),
            human(snapshot.mem.total_bytes),
            used as f64 / snapshot.mem.total_bytes as f64 * 100.0,
            human(snapshot.mem.available_bytes)
        ));
    }
    out.push_str(&format!(
        "  tasks {} running / {} total · workers {} ({} local + {} provider)\n\n",
        snapshot.counts.running,
        snapshot.counts.total,
        workers.total,
        workers.local_threads,
        workers.provider_slots
    ));
    ps_cmd(db, json).map(|table| out + &table)
}

fn kill_cmd(args: &[String], json: bool) -> Result<String, String> {
    let id = args
        .first()
        .and_then(|a| a.parse::<u32>().ok())
        .ok_or_else(|| "usage: kill <id>".to_string())?;
    let task = crate::task::kill(id)?;
    if json {
        return serde_json::to_string(&task).map_err(|e| e.to_string());
    }
    Ok(format!(
        "killed task {} ({}) — cancel handle set",
        task.id, task.name
    ))
}

fn jobs_cmd(json: bool) -> Result<String, String> {
    let jobs = crate::compute::available_jobs();
    if json {
        return serde_json::to_string(&jobs).map_err(|e| e.to_string());
    }
    let mut out = String::new();
    for job in &jobs {
        out.push_str(&format!(
            "{BOLD}{:<10}{RESET} {}\n",
            job.name, job.description
        ));
    }
    out.push_str(&format!(
        "{DIM}usage: compute run <job> <path> [--wait]{RESET}"
    ));
    Ok(out)
}

fn compute_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let sub = args.first().map(String::as_str).unwrap_or("");
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    match sub {
        "run" => {
            let rest = strip_json_slice(rest);
            let wait = rest.iter().any(|a| a == "--wait");
            let positional: Vec<&String> = rest.iter().filter(|a| !a.starts_with('-')).collect();
            let (job, path) = match positional.as_slice() {
                [job, path] => (job.as_str(), path.as_str()),
                [job] => (job.as_str(), "/"),
                _ => return Err("usage: compute run <job> [path] [--wait] [--json]".to_string()),
            };
            if wait {
                let report = crate::compute::run(db, job, path)?;
                if json {
                    return serde_json::to_string(&report).map_err(|e| e.to_string());
                }
                let mut out = report.lines.join("\n");
                out.push_str(&format!(
                    "\n{} in {} ms on {} workers",
                    if report.cancelled {
                        "cancelled"
                    } else {
                        "done"
                    },
                    report.elapsed_ms,
                    report.workers.total
                ));
                return Ok(out);
            }
            // Background: the HTTP handler must never block on a job. The
            // thread cannot carry `&Database`, so it is handed the pool
            // snapshot taken right here — the job runs on exactly the workers
            // this command reported.
            let snapshot = crate::compute::workers(db);
            let job_owned = job.to_string();
            let path_owned = path.to_string();
            let pool = snapshot.clone();
            std::thread::Builder::new()
                .name(format!("cybsh-compute-{job_owned}"))
                .spawn(move || {
                    if let Err(e) = crate::compute::run_scheduled(&pool, &job_owned, &path_owned) {
                        log::warn!("compute job {job_owned} failed: {e}");
                    }
                })
                .map_err(|e| format!("io error: cannot spawn job: {e}"))?;
            if json {
                return serde_json::to_string(&serde_json::json!({
                    "started": true,
                    "job": job,
                    "path": path,
                    "workers": snapshot,
                    "hint": "ps / top to watch, `compute run … --wait` to block",
                }))
                .map_err(|e| e.to_string());
            }
            Ok(format!(
                "started {job} on {} workers — `ps` to watch (`compute run {job} {path} --wait` blocks)",
                snapshot.total
            ))
        }
        "" => Err("usage: compute run <job> <path>".to_string()),
        other => Err(did_you_mean("unknown compute subcommand", other, &["run"])),
    }
}

fn strip_json_slice(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| a.as_str() != "--json")
        .cloned()
        .collect()
}

fn workers_cmd(db: Option<&Database>, json: bool) -> Result<String, String> {
    let workers = crate::compute::workers(db);
    if json {
        return serde_json::to_string(&workers).map_err(|e| e.to_string());
    }
    let mut out = format!(
        "{BOLD}workers{RESET} {} = {} local + {} provider\n",
        workers.total, workers.local_threads, workers.provider_slots
    );
    if workers.providers.is_empty() {
        out.push_str(&format!(
            "{DIM}  no providers connected — attach one and this grows{RESET}"
        ));
        return Ok(out);
    }
    out.push_str(&format!(
        "  {:<18} {:<7} {:>5}  {}\n",
        "PROVIDER", "SOURCE", "SLOTS", "BACKEND"
    ));
    for p in &workers.providers {
        out.push_str(&format!(
            "  {:<18} {:<7} {:>5}  {}\n",
            p.id, p.source, p.slots, p.backend
        ));
    }
    Ok(out)
}

// ─── crypto / search ────────────────────────────────────────────────────

fn keygen_cmd(args: &[String], db: Option<&Database>, json: bool) -> Result<String, String> {
    let name = args
        .first()
        .cloned()
        .unwrap_or_else(|| format!("key-{}", &uuid::Uuid::new_v4().to_string()[..8]));
    let passphrase = cybermanju_crypto::keystore::master_passphrase()
        .ok_or_else(|| "unsupported: no master passphrase (unlock the vault first)".to_string())?;
    let handle = cybermanju_crypto::keystore::get_or_derive(&name, &passphrase)
        .map_err(|e| e.to_string())?;
    let _ = db;
    if json {
        return serde_json::to_string(&handle).map_err(|e| e.to_string());
    }
    Ok(format!(
        "key '{}' ready (id {}, wrapped with Argon2id + AEAD)",
        name, handle.id
    ))
}

fn encrypt_cmd(args: &[String], json: bool) -> Result<String, String> {
    let path = args.first().ok_or("usage: encrypt <path>")?;
    let kernel = Kernel::global();
    let src = absolute(path);
    let fd = kernel.open(&src, OpenFlags::read_only())?;
    let mut data = Vec::new();
    loop {
        let chunk = kernel.read(fd, 64 * 1024)?;
        if chunk.is_empty() {
            break;
        }
        data.extend_from_slice(&chunk);
    }
    kernel.close(fd)?;
    let passphrase = cybermanju_crypto::keystore::master_passphrase()
        .ok_or_else(|| "unsupported: no master passphrase (unlock the vault first)".to_string())?;
    let sealed =
        cybermanju_crypto::keystore::seal_str(&passphrase, &data).map_err(|e| e.to_string())?;
    let out_path = format!("{src}.sealed");
    let fd = kernel.open(&out_path, OpenFlags::create())?;
    kernel.write(fd, sealed.as_bytes())?;
    kernel.close(fd)?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "source": src, "output": out_path, "bytes": data.len(),
        }))
        .map_err(|e| e.to_string());
    }
    Ok(format!(
        "{} → {} ({} bytes sealed)",
        src,
        out_path,
        data.len()
    ))
}

fn decrypt_cmd(args: &[String], json: bool) -> Result<String, String> {
    let path = args.first().ok_or("usage: decrypt <path.sealed>")?;
    let kernel = Kernel::global();
    let src = absolute(path);
    let fd = kernel.open(&src, OpenFlags::read_only())?;
    let mut data = Vec::new();
    loop {
        let chunk = kernel.read(fd, 64 * 1024)?;
        if chunk.is_empty() {
            break;
        }
        data.extend_from_slice(&chunk);
    }
    kernel.close(fd)?;
    let passphrase = cybermanju_crypto::keystore::master_passphrase()
        .ok_or_else(|| "unsupported: no master passphrase (unlock the vault first)".to_string())?;
    let blob =
        String::from_utf8(data).map_err(|_| "invalid: sealed file is not text".to_string())?;
    let plain = cybermanju_crypto::keystore::open_sealed_str(&passphrase, &blob)
        .map_err(|e| e.to_string())?;
    let out_path = src.strip_suffix(".sealed").unwrap_or(&src).to_string();
    let fd = kernel.open(&out_path, OpenFlags::create())?;
    kernel.write(fd, plain.as_bytes())?;
    kernel.close(fd)?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "source": src, "output": out_path, "bytes": plain.len(),
        }))
        .map_err(|e| e.to_string());
    }
    Ok(format!("{} → {} ({} bytes)", src, out_path, plain.len()))
}

fn search_cmd(args: &[String], json: bool) -> Result<String, String> {
    let query = merge_args(args);
    if query.trim().is_empty() {
        return Err("usage: search <query>".to_string());
    }
    let results = crate::compute::search(&query, 20)?;
    if json {
        return serde_json::to_string(&results).map_err(|e| e.to_string());
    }
    if results.is_empty() {
        return Ok("no matches".to_string());
    }
    let mut out = String::new();
    for r in &results {
        out.push_str(&format!(
            "{:.2}  {}{RESET}  {}{}\n",
            r.score,
            GREEN,
            r.file_name,
            if r.snippet.is_empty() {
                String::new()
            } else {
                format!(" {DIM}{}{RESET}", truncate_word(&r.snippet, 60))
            }
        ));
    }
    Ok(out.trim_end().to_string())
}

// ─── formatting helpers ─────────────────────────────────────────────────

/// Human byte size: `1.5G`, `4.0k`, `12B`.
pub fn human(bytes: u64) -> String {
    const UNITS: [char; 5] = ['B', 'k', 'M', 'G', 'T'];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes}B")
    } else {
        format!("{value:.1}{}", UNITS[unit])
    }
}

fn human_ms(ms: u64) -> String {
    let secs = ms / 1000;
    match secs {
        0 => format!("{ms}ms"),
        1..=59 => format!("{secs}s"),
        60..=3599 => format!("{}m {}s", secs / 60, secs % 60),
        _ => format!("{}h {}m", secs / 3600, (secs % 3600) / 60),
    }
}

fn stamp(ms: u64) -> String {
    if ms == 0 {
        return "-".to_string();
    }
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn plural(n: u64) -> &'static str {
    if n == 1 {
        ""
    } else {
        "s"
    }
}

fn truncate_word(word: &str, max: usize) -> String {
    if word.chars().count() <= max {
        return word.to_string();
    }
    let cut: String = word.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

fn bar(pct: f64, width: usize, good: &str, warn: &str) -> String {
    let filled = ((pct / 100.0) * width as f64).round() as usize;
    let filled = filled.min(width);
    let colour = if pct >= 90.0 { warn } else { good };
    format!(
        "  [{colour}{}{RESET}{}] {:>4.1}%",
        "█".repeat(filled),
        "░".repeat(width - filled),
        pct
    )
}

/// One entry point the REST/WASM layers use: run a line, record history.
pub fn run(line: &str, db: Option<&Database>) -> Result<String, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let result = execute(trimmed, db);
    if result.is_ok() {
        record_history(trimmed, db);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_handles_quotes_escapes_and_operators() {
        let tokens = tokenize(r#"ls -l "my dir" 'a b' c\ d | grep x && echo ok"#).expect("tokens");
        let words: Vec<&Token> = tokens
            .iter()
            .filter(|t| !matches!(t, Token::Pipe | Token::And | Token::Or | Token::Semi))
            .collect();
        assert_eq!(
            words,
            vec![
                &Token::Word("ls".into()),
                &Token::Word("-l".into()),
                &Token::Word("my dir".into()),
                &Token::Word("a b".into()),
                &Token::Word("c d".into()),
                &Token::Word("grep".into()),
                &Token::Word("x".into()),
                &Token::Word("echo".into()),
                &Token::Word("ok".into()),
            ]
        );
        assert!(tokens.contains(&Token::Pipe));
        assert!(tokens.contains(&Token::And));
        assert!(tokenize("echo 'unclosed").is_err());
        assert!(tokenize("ls |").is_ok());
        assert!(parse(tokenize("| ls").expect("t")).is_err());
    }

    #[test]
    fn unknown_command_suggests_a_neighbour() {
        let err = execute("lsss", None).expect_err("must fail");
        assert!(err.starts_with("unknown command:"), "got {err}");
        assert!(err.contains("ls"), "suggests ls: {err}");

        let err = execute("df2", None).expect_err("must fail");
        assert!(err.contains("df"), "got {err}");
    }

    #[test]
    fn pipelines_and_conditionals_run_for_real() {
        // `echo` → pipe → `cat` (stdin), then `&&` / `||` / `;` control flow.
        let out = execute("echo hello | cat", None).expect("pipe");
        assert_eq!(out, "hello");
        let out = execute("echo a && echo b", None).expect("and");
        assert_eq!(out, "a\nb");
        // The failure is reported (like stderr) *and* the fallback runs.
        let out = execute("false-command || echo recovered", None).expect("or");
        assert_eq!(out, "unknown command: 'false-command'\nrecovered");
        let out = execute("echo one; echo two", None).expect("semi");
        assert_eq!(out, "one\ntwo");
        // `&&` after a failure stops the line and surfaces the error.
        let err = execute("false-command && echo never", None).expect_err("aborts");
        assert!(err.starts_with("unknown command:"), "got {err}");
    }

    #[test]
    fn json_flag_switches_help_to_json() {
        let out = execute("help --json", None).expect("help");
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("valid json");
        assert!(parsed["commands"].as_array().is_some());
        assert_eq!(parsed["prompt"], crate::PROMPT);
        let plain = execute("help", None).expect("plain");
        assert!(plain.contains("cybsh"));
    }

    #[test]
    fn file_commands_work_end_to_end() {
        crate::testutil::volume_dir();
        execute("mkdir -p /shell-demo", None).expect("mkdir");
        execute("touch /shell-demo/a.txt", None).expect("touch");

        let fd = Kernel::global()
            .open("/shell-demo/a.txt", OpenFlags::create())
            .expect("open");
        Kernel::global()
            .write(fd, b"hello from cybsh")
            .expect("write");
        Kernel::global().close(fd).expect("close");

        let out = execute("cat /shell-demo/a.txt", None).expect("cat");
        assert_eq!(out, "hello from cybsh");
        let out = execute("ls /shell-demo", None).expect("ls");
        assert!(out.contains("a.txt"), "got {out}");
        let out = execute("stat /shell-demo/a.txt --json", None).expect("stat");
        let stat: serde_json::Value = serde_json::from_str(&out).expect("json");
        assert_eq!(stat["sizeBytes"], 16);
        let out = execute("du /shell-demo --json", None).expect("du");
        let du: serde_json::Value = serde_json::from_str(&out).expect("json");
        assert_eq!(du["bytes"], 16);

        execute("cp /shell-demo/a.txt /shell-demo/b.txt", None).expect("cp");
        execute("mv /shell-demo/b.txt /shell-demo/c.txt", None).expect("mv");
        assert!(execute("ls /shell-demo", None)
            .expect("ls")
            .contains("c.txt"));
        execute("rm /shell-demo/c.txt", None).expect("rm");
        execute("rm -r /shell-demo", None).expect("rm -r");
        assert!(execute("ls /shell-demo", None).is_err());
    }

    #[test]
    fn path_escape_and_cd_are_contained() {
        crate::testutil::volume_dir();
        let err = execute("cd /definitely-not-here", None).expect_err("must fail");
        assert!(err.starts_with("not a directory:"), "got {err}");
        execute("mkdir -p /shell-cd/sub", None).expect("mkdir");
        execute("cd /shell-cd/sub", None).expect("cd");
        assert_eq!(execute("pwd", None).expect("pwd"), "/shell-cd/sub");
        execute("cd ..", None).expect("cd ..");
        assert_eq!(execute("pwd", None).expect("pwd"), "/shell-cd");
        execute("cd /", None).expect("cd /");
    }

    #[test]
    fn ps_top_and_workers_answer() {
        let out = execute("ps --json", None).expect("ps");
        let ps: serde_json::Value = serde_json::from_str(&out).expect("json");
        assert!(ps["counts"].is_object());
        let out = execute("top", None).expect("top");
        assert!(out.contains("load"), "got {out}");
        let out = execute("workers --json", None).expect("workers");
        let workers: serde_json::Value = serde_json::from_str(&out).expect("json");
        assert!(workers["total"].as_u64().unwrap_or(0) >= 1);
        let out = execute("jobs", None).expect("jobs");
        assert!(out.contains("compress"));
    }

    #[test]
    fn disk_and_durability_commands_degrade_honestly_without_a_db() {
        let err = execute("disk list", None).expect_err("no db");
        assert!(err.starts_with("unsupported:"), "got {err}");
        let err = execute("scrub", None).expect_err("no db");
        assert!(err.starts_with("unsupported:"), "got {err}");
        let err = execute("lease status", None).expect_err("no db");
        assert!(err.starts_with("unsupported:"), "got {err}");
    }

    #[test]
    fn history_records_and_lists_lines() {
        lock(history()).clear();
        let out = execute("history", None).expect("history");
        assert!(out.contains("empty"), "got {out}");
        record_history("echo recorded", None);
        let out = execute("history", None).expect("history");
        assert!(out.contains("echo recorded"), "got {out}");
        assert!(execute("history clear", None).is_ok());
        lock(history()).clear();
    }

    #[test]
    fn ai_parser_covers_ask_status_abort_sessions() {
        assert_eq!(
            parse_ai_command("ai ask \"refactor this\" --config cfg-1"),
            Some(AiCommand::Ask {
                prompt: "refactor this".into(),
                config_id: Some("cfg-1".into()),
                session_id: None,
            })
        );
        assert_eq!(
            parse_ai_command("ai ask fix it --session ses-1 --config cfg-2"),
            Some(AiCommand::Ask {
                prompt: "fix it".into(),
                config_id: Some("cfg-2".into()),
                session_id: Some("ses-1".into()),
            })
        );
        assert_eq!(
            parse_ai_command("ai status"),
            Some(AiCommand::Status { job_id: None })
        );
        assert_eq!(
            parse_ai_command("ai abort agent-1"),
            Some(AiCommand::Abort {
                job_id: Some("agent-1".into())
            })
        );
        assert_eq!(parse_ai_command("ai sessions"), Some(AiCommand::Sessions));
        assert_eq!(
            parse_ai_command("ai init --config cfg-1"),
            Some(AiCommand::Init {
                config_id: Some("cfg-1".into())
            })
        );
        assert_eq!(
            parse_ai_command("ai init"),
            Some(AiCommand::Init { config_id: None })
        );
        assert!(parse_ai_command("ai init extra").is_none());
        assert!(parse_ai_command("ai ask").is_none());
        assert!(parse_ai_command("ai frobnicate").is_none());
        assert!(parse_ai_command("ai ask x | cat").is_none());
        // Direct-library execution stays honest (the REST intercept runs it).
        let err = execute("ai ask hello", None).expect_err("no worker");
        assert!(err.starts_with("unsupported:"), "got {err}");
    }

    #[test]
    fn tab_completion_covers_the_command_table() {
        let hits = completions("d");
        assert!(hits.iter().any(|c| c == "df"));
        assert!(hits.iter().any(|c| c == "disk create"));
        let hits = completions("");
        assert!(hits.len() >= command_table().len());
    }

    #[test]
    fn sync_start_parser_accepts_only_single_start_lines() {
        let parsed = parse_sync_start("sync start").expect("bare start");
        assert_eq!(
            parsed,
            SyncStart {
                config_id: None,
                file_ids: vec![],
            }
        );
        let parsed = parse_sync_start("sync start cfg-1 f1 f2 --json").expect("full");
        assert_eq!(
            parsed,
            SyncStart {
                config_id: Some("cfg-1".into()),
                file_ids: vec!["f1".into(), "f2".into()],
            }
        );
        assert!(parse_sync_start("sync status").is_none());
        assert!(parse_sync_start("sync cancel").is_none());
        assert!(parse_sync_start("disk list").is_none());
        assert!(parse_sync_start("echo hi | sync start cfg").is_none());
        assert!(parse_sync_start("sync start cfg && echo done").is_none());
        assert!(parse_sync_start("sync start 'unclosed").is_none());
        // The direct-library shell still refuses for real (no worker here);
        // the REST intercept is what runs it detached.
        let err = execute("sync start cfg-1", None).expect_err("no worker");
        assert!(err.starts_with("unsupported:"), "got {err}");
    }
}
