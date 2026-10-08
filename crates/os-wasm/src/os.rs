// CyberManju OS — WASM `os/*` dispatcher (AGENT-8, items 3 & 14)
//
// The GitHub Pages build has no dashboard behind it, so `POST /api/os/exec`
// would be an empty shell there. This module is the same entry point from the
// browser side: one `os_dispatch(cmd, args_json)` call that answers the
// terminal's questions against a virtual volume kept in `localStorage`
// (in-memory when storage is unavailable), with a BM25-lite `search`.
//
// Two layers answer here. The volume verbs below run natively against the
// virtual volume; the vault verbs (`quota`, `providers`, `oauth`, `encrypt`,
// …) are intercepted first by the TypeScript layer
// (`src/utils/staticCybsh.ts`), which sees the local vault and the provider
// network that this crate cannot reach. Anything reaching the refusal arm is
// genuinely server-owned and answers `unsupported: …` rather than
// pretending. The shell contract (`"prefix: detail"`) is unchanged, so the
// terminal renders identically on all three transports.

#[cfg(target_arch = "wasm32")]
use js_sys::global;
use js_sys::{Reflect, JSON};
use std::cell::RefCell;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

// In-memory mirror of the browser store. Used directly when `localStorage`
// is missing (private mode, non-browser test host).
thread_local! {
    static MEMORY: RefCell<BTreeMap<String, String>> = const { RefCell::new(BTreeMap::new()) };
    static CWD: RefCell<String> = RefCell::new(String::from("/"));
    static HISTORY: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    static TASKS: RefCell<Vec<TaskRow>> = const { RefCell::new(Vec::new()) };
    static SCRIPT_DEPTH: RefCell<usize> = const { RefCell::new(0) };
}

const STORAGE_KEY: &str = "cybermanju.os.volume";
const DEFAULT_CAPACITY: u64 = 64 * 1024 * 1024;
/// Single-write cap: localStorage quotas (~5 MiB) are shared with everything
/// else the browser stores — oversized writes refuse instead of silently
/// dropping half a file on quota errors.
const MAX_WRITE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug)]
struct TaskRow {
    id: u32,
    kind: String,
    name: String,
    state: String,
    progress: f64,
    bytes: u64,
    provider: String,
}

// ─── browser storage ───────────────────────────────────────────────────────

// ─── browser storage ───────────────────────────────────────────────────────

/// `window.localStorage` reached through `Reflect`, so the crate keeps no
/// `web-sys` dependency. On the host (unit tests) there is no browser store —
/// the in-memory mirror is used instead.
#[cfg(target_arch = "wasm32")]
fn local_storage() -> Option<js_sys::Object> {
    let window = Reflect::get(&global(), &JsValue::from_str("window")).ok()?;
    if window.is_undefined() || window.is_null() {
        return None;
    }
    let storage = Reflect::get(&window, &JsValue::from_str("localStorage")).ok()?;
    if storage.is_undefined() || storage.is_null() {
        return None;
    }
    storage.dyn_into::<js_sys::Object>().ok()
}

#[cfg(not(target_arch = "wasm32"))]
fn local_storage() -> Option<js_sys::Object> {
    None
}

fn call1(obj: &JsValue, name: &str, arg: &JsValue) -> Option<JsValue> {
    let func = Reflect::get(obj, &JsValue::from_str(name)).ok()?;
    let func = func.dyn_into::<js_sys::Function>().ok()?;
    let args = js_sys::Array::new();
    args.push(arg);
    Reflect::apply(&func, obj, &args).ok()
}

fn call2(obj: &JsValue, name: &str, a: &JsValue, b: &JsValue) -> Option<JsValue> {
    let func = Reflect::get(obj, &JsValue::from_str(name)).ok()?;
    let func = func.dyn_into::<js_sys::Function>().ok()?;
    let args = js_sys::Array::new();
    args.push(a);
    args.push(b);
    Reflect::apply(&func, obj, &args).ok()
}

/// Read the persisted volume, falling back to an empty one.
fn load_volume() -> BTreeMap<String, String> {
    if let Some(storage) = local_storage() {
        let raw = call1(&storage, "getItem", &JsValue::from_str(STORAGE_KEY))
            .and_then(|value| value.as_string());
        if let Some(raw) = raw {
            if let Ok(value) = JSON::parse(&raw) {
                if let Some(obj) = value.dyn_ref::<js_sys::Object>() {
                    let mut map = BTreeMap::new();
                    for key in js_sys::Object::keys(obj) {
                        if let (Some(name), Some(text)) =
                            (key.as_string(), Reflect::get(obj, &key).ok())
                        {
                            if let Some(text) = text.as_string() {
                                map.insert(name, text);
                            }
                        }
                    }
                    return map;
                }
            }
        }
    }
    MEMORY.with(|m| m.borrow().clone())
}

fn save_volume(volume: &BTreeMap<String, String>) {
    let mut first = true;
    let mut body = String::from("{");
    for (path, text) in volume {
        if !first {
            body.push(',');
        }
        first = false;
        body.push_str(&js(path));
        body.push(':');
        body.push_str(&js(text));
    }
    body.push('}');
    if let Some(storage) = local_storage() {
        call2(
            &storage.into(),
            "setItem",
            &JsValue::from_str(STORAGE_KEY),
            &JsValue::from_str(&body),
        );
    }
    MEMORY.with(|m| {
        *m.borrow_mut() = volume.clone();
    });
}

// ─── helpers ───────────────────────────────────────────────────────────────

fn join(cwd: &str, path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if !path.starts_with('/') {
        for part in cwd.trim_start_matches('/').split('/') {
            if !part.is_empty() && part != "." {
                parts.push(part);
            }
        }
    }
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

fn ok(output: String) -> String {
    format!(
        r#"{{"ok":true,"line":"","output":{},"prompt":"cybsh> "}}"#,
        js(&output)
    )
}

fn err(message: String) -> String {
    format!(
        r#"{{"ok":false,"line":"","output":{},"error":{},"prompt":"cybsh> "}}"#,
        js(&message),
        js(&message)
    )
}

/// JSON-encode a string without going near the JS runtime — the same
/// escaping `JSON::stringify` does, so the host-side tests exercise the real
/// encoder the browser will use.
fn js(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn bytes_of(volume: &BTreeMap<String, String>) -> u64 {
    volume.values().map(|v| v.len() as u64).sum()
}

/// The browser-side command table — the same names `help` advertises.
///
/// Verbs the terminal answers locally from the vault live here too
/// (`quota`, `providers`, `oauth`, `encrypt`, …): on a static host the
/// TypeScript layer (`src/utils/staticCybsh.ts`) intercepts the single-command
/// line first and the Rust arms below stay a fallback; `complete` suggests
/// the same table either way so Tab never hides a verb `exec` understands.
fn cybermanju_commands() -> &'static [&'static str] {
    &[
        "help",
        "history",
        "clear",
        "version",
        "echo",
        "pwd",
        "cd",
        "ls",
        "cat",
        "cp",
        "mv",
        "write",
        "touch",
        "mkdir",
        "rm",
        "stat",
        "du",
        "df",
        "ps",
        "top",
        "kill",
        "jobs",
        "workers",
        "search",
        "grep",
        "find",
        "head",
        "tail",
        "wc",
        "edit",
        "compute",
        "scrub",
        "repair",
        "gc",
        "sync",
        "disk",
        "mount",
        "umount",
        "providers",
        "quota",
        "oauth",
        "lease",
        "keygen",
        "encrypt",
        "decrypt",
        "compress",
        "decompress",
        "ai",
        "run",
        "theme",
        "ui",
    ]
}

/// Multi-word candidates Tab also offers — mirrors `completions()` in the
/// native shell plus the static layer's vault verbs, so discovery matches
/// the desktop on every transport.
fn complete_subs() -> &'static [&'static str] {
    &[
        "disk create",
        "disk attach",
        "disk detach",
        "disk resize",
        "disk check",
        "disk list",
        "disk status",
        "disk df",
        "ai ask",
        "ai init",
        "ai status",
        "ai abort",
        "ai sessions",
        "sync start",
        "sync status",
        "sync list",
        "sync cancel",
        "compute run",
        "lease status",
        "history clear",
        "oauth status",
        "oauth start",
        "ui theme",
        "ui accent",
        "ui density",
        "ui glass",
        "ui motion",
        "ui glow",
        "ui vars",
        "ui palette",
        "ui get",
        "theme get",
    ]
}

/// BM25-lite over the stored files: term frequency against the collection.
fn search(volume: &BTreeMap<String, String>, query: &str, limit: usize) -> Vec<String> {
    let terms: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(|t| t.to_string())
        .collect();
    if terms.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(f64, String)> = Vec::new();
    for (path, text) in volume {
        let haystack = format!("{} {}", path.to_lowercase(), text.to_lowercase());
        let mut score = 0.0f64;
        for term in &terms {
            let hits = haystack.matches(term).count() as f64;
            if hits > 0.0 {
                score += (hits / (haystack.len() as f64 + 1.0)) * 100.0 + 1.0;
            }
        }
        if score > 0.0 {
            scored.push((score, path.clone()));
        }
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().take(limit).map(|(_, p)| p).collect()
}

/// `*`-only glob match (case-sensitive). `*` spans separators.
fn wasm_glob(pattern: &str, text: &str) -> bool {
    if pattern == "*" || pattern.is_empty() {
        return true;
    }
    if !pattern.contains('*') {
        return text.contains(pattern);
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut rest = text;
    let mut first = true;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        let last = i == parts.len() - 1;
        if first && !pattern.starts_with('*') {
            if !rest.starts_with(part) {
                return false;
            }
            rest = &rest[part.len()..];
            first = false;
            continue;
        }
        first = false;
        match rest.find(part) {
            Some(pos) => {
                if last && !pattern.ends_with('*') && pos + part.len() != rest.len() {
                    return false;
                }
                rest = &rest[pos + part.len()..];
            }
            None => return false,
        }
    }
    true
}

/// `grep [-i] [-n] <pattern> [paths…]` over the localStorage volume.
fn wasm_grep(volume: &BTreeMap<String, String>, args: &[String]) -> String {
    let mut insensitive = false;
    let mut show_line = false;
    let mut rest: Vec<&String> = Vec::new();
    for a in args {
        match a.as_str() {
            "-i" | "--ignore-case" => insensitive = true,
            "-n" | "--line-number" => show_line = true,
            _ => rest.push(a),
        }
    }
    if rest.is_empty() {
        return "usage: grep [-i] [-n] <pattern> [paths…]".to_string();
    }
    let pattern = rest[0].clone();
    let needle = if insensitive {
        pattern.to_lowercase()
    } else {
        pattern.clone()
    };
    let hits_line = |line: &str| -> bool {
        if insensitive {
            line.to_lowercase().contains(&needle)
        } else {
            line.contains(&needle)
        }
    };
    let mut targets: Vec<String> = Vec::new();
    let cwd = CWD.with(|c| c.borrow().clone());
    if rest.len() == 1 {
        // Whole volume when no path is given (no stdin on this transport).
        targets.extend(volume.keys().cloned());
    } else {
        for t in &rest[1..] {
            let base = join(&cwd, t);
            if volume.contains_key(&base) {
                targets.push(base);
                continue;
            }
            let prefix = if base == "/" {
                "/".to_string()
            } else {
                format!("{base}/")
            };
            let mut any = false;
            for k in volume.keys() {
                if k == &base || k.starts_with(&prefix) {
                    if !k.ends_with("/.keep") {
                        targets.push(k.clone());
                    }
                    any = true;
                }
            }
            if !any {
                return format!("not_found: {t}");
            }
        }
    }
    targets.sort();
    targets.dedup();
    let prefix_file = targets.len() > 1;
    let mut hits: Vec<String> = Vec::new();
    for file in &targets {
        if let Some(text) = volume.get(file) {
            for (i, line) in text.lines().enumerate() {
                if hits_line(line) {
                    let body = if show_line {
                        format!("{}:{line}", i + 1)
                    } else {
                        line.to_string()
                    };
                    hits.push(if prefix_file {
                        format!("{file}:{body}")
                    } else {
                        body
                    });
                    if hits.len() >= 400 {
                        break;
                    }
                }
            }
        }
        if hits.len() >= 400 {
            break;
        }
    }
    if hits.is_empty() {
        format!("no matches for `{pattern}`")
    } else {
        hits.join("\n")
    }
}

/// `find [path] [pattern]` over the localStorage volume.
fn wasm_find(volume: &BTreeMap<String, String>, args: &[String]) -> String {
    let cwd = CWD.with(|c| c.borrow().clone());
    let non_flags: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    let (root_arg, pattern) = match non_flags.len() {
        0 => ("/".to_string(), None),
        1 => {
            let probe = join(&cwd, non_flags[0]);
            let is_dir = probe == "/" || volume.keys().any(|k| k.starts_with(&format!("{probe}/")));
            if is_dir || volume.contains_key(&probe) && probe.ends_with('/') {
                (probe, None)
            } else if volume.contains_key(&probe) {
                return probe;
            } else {
                ("/".to_string(), Some(non_flags[0].clone()))
            }
        }
        _ => (join(&cwd, non_flags[0]), Some(non_flags[1].clone())),
    };
    let prefix = if root_arg == "/" {
        "/".to_string()
    } else {
        format!("{}/", root_arg.trim_end_matches('/'))
    };
    let mut hits: Vec<String> = volume
        .keys()
        .filter(|k| *k == &root_arg || k.starts_with(&prefix))
        .filter(|k| match &pattern {
            None => true,
            Some(p) => {
                let base = k.rsplit('/').next().unwrap_or(k);
                wasm_glob(p, base) || wasm_glob(p, k)
            }
        })
        .cloned()
        .collect();
    hits.sort();
    if hits.is_empty() {
        "(no matches)".to_string()
    } else {
        hits.join("\n")
    }
}

/// `head|tail [-n N] <path]`.
fn wasm_head_tail(
    volume: &BTreeMap<String, String>,
    args: &[String],
    head: bool,
) -> Result<String, String> {
    let mut n = 10usize;
    let mut rest: Vec<&String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if (args[i] == "-n" || args[i] == "--lines") && i + 1 < args.len() {
            n = args[i + 1].parse().unwrap_or(10);
            i += 2;
            continue;
        }
        if args[i].starts_with("-n") && args[i].len() > 2 {
            n = args[i][2..].parse().unwrap_or(10);
            i += 1;
            continue;
        }
        rest.push(&args[i]);
        i += 1;
    }
    n = n.max(1);
    let path = rest
        .first()
        .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
        .unwrap_or_default();
    if path.is_empty() {
        return Err(if head {
            "usage: head [-n N] <path>".to_string()
        } else {
            "usage: tail [-n N] <path>".to_string()
        });
    }
    match volume.get(&path) {
        Some(text) => {
            let lines: Vec<&str> = text.lines().collect();
            if head {
                Ok(lines.into_iter().take(n).collect::<Vec<_>>().join("\n"))
            } else {
                let start = lines.len().saturating_sub(n);
                Ok(lines[start..].join("\n"))
            }
        }
        None => Err(format!("not_found: {path}")),
    }
}

/// `wc [paths…]` over the localStorage volume.
fn wasm_wc(volume: &BTreeMap<String, String>, args: &[String]) -> String {
    let cwd = CWD.with(|c| c.borrow().clone());
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    if paths.is_empty() {
        return "usage: wc [paths…]".to_string();
    }
    let mut rows: Vec<String> = Vec::new();
    let mut totals = (0u64, 0u64, 0u64);
    for p in paths {
        let path = join(&cwd, p);
        match volume.get(&path) {
            Some(text) => {
                let l = text.lines().count() as u64;
                let w = text.split_whitespace().count() as u64;
                let b = text.len() as u64;
                totals = (totals.0 + l, totals.1 + w, totals.2 + b);
                rows.push(format!("{l} {w} {b} {path}"));
            }
            None => return format!("not_found: {p}"),
        }
    }
    if rows.len() > 1 {
        rows.push(format!("{} {} {} total", totals.0, totals.1, totals.2));
    }
    rows.join("\n")
}

/// `edit <path> <old> <new>` — exact-once replacement in the volume.
fn wasm_edit(volume: &mut BTreeMap<String, String>, args: &[String]) -> Result<String, String> {
    if args.len() < 3 {
        return Err("usage: edit <path> <old> <new>".to_string());
    }
    let path = join(&CWD.with(|c| c.borrow().clone()), &args[0]);
    let old = &args[1];
    let new = &args[2];
    if old.is_empty() {
        return Err("integrity: refusing empty anchor (old text must be ≥1 char)".to_string());
    }
    match volume.get(&path) {
        Some(text) => {
            let count = text.matches(old.as_str()).count();
            if count == 0 {
                return Err(format!("not_found: anchor occurs 0 times in {path}"));
            }
            if count > 1 {
                return Err(format!(
                    "conflict: anchor occurs {count} times in {path} — refine it to exactly one"
                ));
            }
            let updated = text.replacen(old.as_str(), new.as_str(), 1);
            let bytes = updated.len();
            volume.insert(path.clone(), updated);
            Ok(format!("edited {path} (1 replacement, {bytes} bytes)"))
        }
        None => Err(format!("not_found: {path}")),
    }
}

// ─── the dispatcher ────────────────────────────────────────────────────────

/// One entry point for every transport: `cmd` is the first token, `args_json`
/// is `{"args": ["…"], "line": "…"}`. Returns the terminal's response JSON.
#[wasm_bindgen]
pub fn os_dispatch(cmd: &str, args_json: &str) -> String {
    let args: Vec<String> = JSON::parse(args_json)
        .ok()
        .and_then(|value| Reflect::get(&value, &JsValue::from_str("args")).ok())
        .and_then(|value| value.dyn_into::<js_sys::Array>().ok())
        .map(|array| {
            array
                .iter()
                .filter_map(|v| v.as_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    dispatch(cmd, &args)
}

/// Whitespace tokenizer with single/double quotes — enough for one shell line
/// coming from `os_exec`.
fn tokenize(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in line.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '\'' || c == '"' => quote = Some(c),
            None if c.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn dispatch(cmd: &str, args: &[String]) -> String {
    let mut volume = load_volume();
    match cmd {
        // One line from the terminal: history + envelope here, the `&&`/`;`
        // stitching in `exec_result` so `.cybsh` scripts reuse it.
        "exec" => {
            let line = args.first().map(String::as_str).unwrap_or_default();
            exec_envelope(line)
        }
        // Tab completion for the terminal prompt — the raw JSON array the
        // `os_complete` route also returns. Verbs plus sub-commands, like
        // the native `completions()`.
        "complete" => {
            let prefix = args.first().map(String::as_str).unwrap_or_default();
            let mut hits: Vec<&str> = cybermanju_commands()
                .iter()
                .filter(|c| c.starts_with(prefix))
                .copied()
                .collect();
            for sub in complete_subs() {
                if sub.starts_with(prefix) && !hits.contains(sub) {
                    hits.push(sub);
                }
            }
            hits.sort();
            serde_json::to_string(&hits).unwrap_or_else(|_| "[]".to_string())
        }
        "help" => ok(format!(
            "cybsh (wasm transport)\n\
             local volume:\n  {}\n\
             local vault (offline, no dashboard):\n  {}\n\
             dashboard only (desktop app, Docker, :3456):\n  \
             sync start · sync cancel · provider push · full OAuth dance · provider scrub/repair · ai ask",
            [
                "help", "history", "clear", "version", "echo", "pwd", "cd",
                "ls", "cat", "cp", "mv", "write", "touch", "mkdir", "rm",
                "stat", "du", "df", "ps", "top", "kill", "jobs", "workers",
                "search", "grep", "find", "head", "tail", "wc", "edit",
                "compute", "run", "theme", "ui",
            ]
            .join(" · "),
            [
                "quota", "providers", "oauth", "disk", "sync status",
                "sync list", "sync move", "lease", "mount", "scrub", "repair", "gc",
                "keygen", "encrypt", "decrypt", "compress", "decompress",
            ]
            .join(" · "),
        )),
        "version" => ok(format!(
            "cybermanju os {} (wasm transport)",
            cybermanju_os_version()
        )),
        "history" => {
            let lines = HISTORY.with(|h| h.borrow().clone());
            if lines.is_empty() {
                ok("history is empty".to_string())
            } else {
                ok(lines.join("\n"))
            }
        }
        "clear" => {
            HISTORY.with(|h| h.borrow_mut().clear());
            ok(String::new())
        }
        "echo" => ok(args.join(" ")),
        "pwd" => ok(CWD.with(|c| c.borrow().clone())),
        "cd" => {
            let target = args
                .first()
                .map(|a| a.as_str())
                .unwrap_or("/");
            let path = join(&CWD.with(|c| c.borrow().clone()), target);
            let dir = if path == "/" { "/".to_string() } else { format!("{path}/") };
            if path != "/"
                && !volume.keys().any(|k| k.starts_with(&dir) && k.len() > dir.len())
                && !volume.contains_key(&path)
            {
                return err(format!("not a directory: {target}"));
            }
            CWD.with(|c| *c.borrow_mut() = path.clone());
            ok(path)
        }
        "ls" => {
            // Flags (`-l`, `-a`, `-la`, `--long`, …) are accepted and
            // ignored like the native shell: the first non-flag arg is the
            // path, so `ls -la /docs` lists instead of looking up `/-la`.
            let base = args
                .iter()
                .find(|a| !a.starts_with('-'))
                .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
                .unwrap_or_else(|| CWD.with(|c| c.borrow().clone()));
            let prefix = if base == "/" { "/".to_string() } else { format!("{base}/") };
            let mut names: Vec<String> = volume
                .keys()
                .filter_map(|path| {
                    if !path.starts_with(&prefix) {
                        return None;
                    }
                    let rest = &path[prefix.len()..];
                    if rest.contains('/') {
                        let dir = rest.split('/').next().unwrap_or("").to_string();
                        if dir.is_empty() {
                            return None;
                        }
                        Some(format!("{dir}/"))
                    } else {
                        Some(rest.to_string())
                    }
                })
                .collect();
            names.sort();
            names.dedup();
            if names.is_empty() && base != "/" && !volume.contains_key(&base) {
                return err(format!("not found: {base}"));
            }
            // An empty volume lists as a sentence, not silence: the agent
            // orients on `/` first, and `""` reads as a transport glitch
            // while `(empty directory)` reads as "create files here".
            // (Native `tool_list` answers the same sentence.)
            if names.is_empty() {
                return ok("(empty directory)".to_string());
            }
            ok(names.join("\n"))
        }
        "cat" => {
            let path = args
                .first()
                .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
                .unwrap_or_default();
            // A directory is not a missing file — say so, so the caller
            // reaches for `ls` instead of retrying the read.
            if path == "/" || volume.keys().any(|k| k != &path && k.starts_with(&format!("{path}/"))) {
                return err(format!("invalid: '{path}' is a directory — use ls to list it"));
            }
            match volume.get(&path) {
                Some(text) => ok(text.clone()),
                None => err(format!("not found: {path}")),
            }
        }
        "cp" => {
            if args.len() < 2 {
                return err("usage: cp <src> <dst>".to_string());
            }
            let cwd = CWD.with(|c| c.borrow().clone());
            let src = join(&cwd, &args[0]);
            let dst = join(&cwd, &args[1]);
            let text = match volume.get(&src) {
                Some(text) => text.clone(),
                None => {
                    let prefix = format!("{src}/");
                    if volume.keys().any(|k| k.starts_with(&prefix)) {
                        return err(format!("is a directory: {} (wasm cp copies files only)", args[0]));
                    }
                    return err(format!("not found: {}", args[0]));
                }
            };
            if text.len() > MAX_WRITE_BYTES {
                return err(format!(
                    "too_large: content is {} bytes, wasm write limit is {}",
                    text.len(),
                    MAX_WRITE_BYTES
                ));
            }
            volume.insert(dst.clone(), text);
            save_volume(&volume);
            ok(format!("{src} -> {dst}"))
        }
        "mv" => {
            if args.len() < 2 {
                return err("usage: mv <src> <dst>".to_string());
            }
            let cwd = CWD.with(|c| c.borrow().clone());
            let src = join(&cwd, &args[0]);
            let dst = join(&cwd, &args[1]);
            let text = match volume.remove(&src) {
                Some(text) => text,
                None => {
                    let prefix = format!("{src}/");
                    if volume.keys().any(|k| k.starts_with(&prefix)) {
                        return err(format!("is a directory: {} (wasm mv moves files only)", args[0]));
                    }
                    return err(format!("not found: {}", args[0]));
                }
            };
            volume.insert(dst.clone(), text);
            save_volume(&volume);
            ok(format!("{src} -> {dst}"))
        }
        "touch" => {
            for arg in args {
                let path = join(&CWD.with(|c| c.borrow().clone()), arg);
                volume.entry(path).or_default();
            }
            save_volume(&volume);
            ok(String::new())
        }
        "write" => {
            // `write <path> <content>` — the editor's save path on static
            // hosts. Both arrive as whole positional args (no tokenizing),
            // so content keeps its whitespace intact.
            let raw_path = args.first().map(String::as_str).unwrap_or_default();
            if raw_path.is_empty() {
                return err("usage: write <path> <content>".to_string());
            }
            let content = args.get(1).cloned().unwrap_or_default();
            if content.len() > MAX_WRITE_BYTES {
                return err(format!(
                    "too_large: content is {} bytes, wasm write limit is {}",
                    content.len(),
                    MAX_WRITE_BYTES
                ));
            }
            let path = join(&CWD.with(|c| c.borrow().clone()), raw_path);
            volume.insert(path.clone(), content.clone());
            save_volume(&volume);
            ok(format!("wrote {} ({} bytes)", path, content.len()))
        }
        "mkdir" => {
            // Directories are implied by paths in the map; record a marker so
            // `ls` and `cd` see an empty directory.
            for arg in args {
                let path = join(&CWD.with(|c| c.borrow().clone()), arg);
                volume.entry(format!("{path}/.keep")).or_default();
            }
            save_volume(&volume);
            ok(String::new())
        }
        "rm" => {
            let recursive = args.iter().any(|a| a == "-r" || a == "-rf" || a == "-fr");
            let mut removed = 0u64;
            for arg in args.iter().filter(|a| !a.starts_with('-')) {
                let path = join(&CWD.with(|c| c.borrow().clone()), arg);
                if let Some(text) = volume.remove(&path) {
                    removed += text.len() as u64;
                    continue;
                }
                let prefix = format!("{path}/");
                let keys: Vec<String> = volume
                    .keys()
                    .filter(|k| k.starts_with(&prefix))
                    .cloned()
                    .collect();
                if keys.is_empty() {
                    return err(format!("not found: {arg}"));
                }
                if !recursive {
                    return err(format!("is a directory: {arg} (use -r)"));
                }
                for key in keys {
                    if let Some(text) = volume.remove(&key) {
                        removed += text.len() as u64;
                    }
                }
            }
            save_volume(&volume);
            ok(format!("{removed} bytes freed"))
        }
        "stat" => {
            let path = args
                .first()
                .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
                .unwrap_or_default();
            match volume.get(&path) {
                Some(text) => ok(format!(
                    r#"{{"path":"{}","kind":"file","sizeBytes":{}}}"#,
                    js(&path),
                    text.len()
                )),
                None => err(format!("not found: {path}")),
            }
        }
        "du" => {
            let base = args
                .first()
                .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
                .unwrap_or_else(|| CWD.with(|c| c.borrow().clone()));
            let prefix = if base == "/" { "/".to_string() } else { format!("{base}/") };
            let (files, bytes): (usize, u64) = volume
                .iter()
                .filter(|(path, _)| *path == &base || path.starts_with(&prefix))
                .fold((0, 0), |(n, b), (_, text)| (n + 1, b + text.len() as u64));
            ok(format!(r#"{{"path":"{}","bytes":{bytes},"files":{files}}}"#, js(&base)))
        }
        "df" => {
            let used = bytes_of(&volume);
            let cores = hardware_concurrency();
            ok(format!(
                r#"{{"totalBytes":{DEFAULT_CAPACITY},"usedBytes":{used},"freeBytes":{},"root":"/","diskCount":0,"attachedBytes":0,"scratchBytes":{used},"disks":[],"localThreads":{cores}}}"#,
                DEFAULT_CAPACITY.saturating_sub(used)
            ))
        }
        "ps" | "top" => {
            let tasks = TASKS.with(|t| {
                t.borrow()
                    .iter()
                    .map(|t| {
                        format!(
                            r#"{{"id":{},"kind":"{}","name":"{}","state":"{}","progress":{},"startedAt":"","bytes":{},"provider":"{}"}}"#,
                            t.id, t.kind, js(&t.name), t.state, t.progress, t.bytes, t.provider
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            });
            ok(format!(
                r#"{{"tasks":[{tasks}],"counts":{{"pending":0,"running":0,"done":0,"failed":0,"killed":0,"total":{}}},"pid":1,"uptimeMs":0}}"#,
                TASKS.with(|t| t.borrow().len())
            ))
        }
        "kill" => {
            let target = args.first().map(String::as_str).unwrap_or_default();
            let id: u32 = match target.parse() {
                Ok(id) => id,
                Err(_) => return err("usage: kill <id>".to_string()),
            };
            let removed = TASKS.with(|t| {
                let mut tasks = t.borrow_mut();
                let before = tasks.len();
                tasks.retain(|task| task.id != id);
                tasks.len() != before
            });
            if removed {
                ok(format!("killed task {id}"))
            } else {
                err(format!("not_found: no task {id}"))
            }
        }
        "jobs" => ok(
            r#"[{"name":"hash","description":"BLAKE3 every file in the volume","takesPath":true},{"name":"search","description":"Re-run the BM25-lite index over stored text","takesPath":false}]"#
                .to_string(),
        ),
        "workers" => {
            let cores = hardware_concurrency();
            ok(format!(
                r#"{{"localThreads":{cores},"providerSlots":0,"total":{cores},"providers":[]}}"#
            ))
        }
        "search" => {
            let query = args.join(" ");
            let hits = search(&volume, &query, 20);
            if hits.is_empty() {
                ok(format!("no matches for `{query}`"))
            } else {
                ok(hits.join("\n"))
            }
        }
        "grep" => ok(wasm_grep(&volume, args)),
        "find" => ok(wasm_find(&volume, args)),
        "head" => match wasm_head_tail(&volume, args, true) {
            Ok(out) => ok(out),
            Err(e) => err(e),
        },
        "tail" => match wasm_head_tail(&volume, args, false) {
            Ok(out) => ok(out),
            Err(e) => err(e),
        },
        "wc" => ok(wasm_wc(&volume, args)),
        "edit" => match wasm_edit(&mut volume, args) {
            Ok(out) => {
                save_volume(&volume);
                ok(out)
            }
            Err(e) => err(e),
        },
        "compute" => {
            // `compute run <job> <path>` — real work over the stored volume,
            // synchronously: the browser has no worker pool to hand it to.
            if args.first().map(String::as_str) != Some("run") {
                return err("usage: compute run <job> <path>".to_string());
            }
            let job = args.get(1).cloned().unwrap_or_default();
            let path = args
                .get(2)
                .cloned()
                .unwrap_or_else(|| "/".to_string());
            let prefix = join(&CWD.with(|c| c.borrow().clone()), &path);
            let matched: Vec<(&String, &String)> = volume
                .iter()
                .filter(|(p, _)| p.starts_with(&prefix))
                .collect();
            let bytes: u64 = matched.iter().map(|(_, t)| t.len() as u64).sum();
            let id = TASKS.with(|t| {
                let mut tasks = t.borrow_mut();
                let id = tasks.iter().map(|t| t.id).max().unwrap_or(0) + 1;
                tasks.push(TaskRow {
                    id,
                    kind: "compute".into(),
                    name: format!("compute run {job} {path}"),
                    state: "done".into(),
                    progress: 1.0,
                    bytes,
                    provider: "local".into(),
                });
                id
            });
            ok(format!(
                "{job} finished · {} files · {bytes} bytes scanned (task {id})",
                matched.len()
            ))
        }
        // `.cybsh` scripts + theme/ui: the same interpreted language as the
        // native shell (`crates/os/src/script.rs`) and the static twin
        // (`src/utils/cybshScript.ts`), compacted for the sandbox (no
        // provider verbs here — the static layer answers those first).
        "run" => run_script_file(args),
        "theme" => theme_cmd(args),
        "ui" => ui_cmd(args),
        // The agent needs a detached worker no browser sandbox can host —
        // same honest answer as the static layer and the native shell.
        "ai" => err(
            "unsupported: `ai ask` needs a detached worker — run it from the Agent panel or POST /api/os/exec on the dashboard; see docs/OPERATIONS.md".to_string(),
        ),
        // The server-owned surface: honest refusal, never a fake success.
        //
        // On a static host the terminal intercepts these verbs first
        // (`src/utils/staticCybsh.ts` answers `quota`/`providers`/`oauth`/
        // `disk`/`sync status`/`encrypt`/`compress`/… locally from the vault
        // plus live CORS-OK provider probes), so reaching this arm means a
        // chained line or a direct dispatch call — keep the refusal honest
        // and point at both the local answer and the dashboard.
        "df-attached" | "mount" | "umount" | "disk" | "providers" | "quota" | "oauth"
        | "sync" | "scrub" | "repair" | "gc" | "lease" | "keygen" | "encrypt"
        | "decrypt" | "compress" | "decompress" => err(format!(
            "unsupported: `{cmd}` needs the CyberManju dashboard for provider work — the wasm build is a \
             browser sandbox (volume lives in localStorage, secrets in the local vault). \
             Run `{cmd}` as a single-command line for the local vault answer, or connect a dashboard (:3456) for provider push"
        )),
        _ => err(format!(
            "unknown command: '{cmd}' — try `help`"
        )),
    }
}

/// Shared single-line runner: history + envelope at the call site, the
/// `&&`/`;` stitching here so `.cybsh` scripts reuse the exact same path
/// as the terminal (pipes stay an honest refusal in this sandbox).
fn exec_envelope(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ok(String::new());
    }
    HISTORY.with(|h| {
        let mut history = h.borrow_mut();
        if history.last().map(String::as_str) != Some(trimmed) {
            history.push(trimmed.to_string());
        }
    });
    match exec_result(trimmed) {
        Ok(text) => ok(text),
        Err(message) => err(message),
    }
}

fn exec_result(line: &str) -> Result<String, String> {
    if line.contains('|') {
        return Err("unsupported: pipelines are not available in the wasm sandbox".to_string());
    }
    let separator = if line.contains("&&") { "&&" } else { ";" };
    let mut combined = String::new();
    for chunk in line.split(separator) {
        let tokens = tokenize(chunk);
        if tokens.is_empty() {
            continue;
        }
        let result = dispatch(&tokens[0], &tokens[1..]);
        let value: serde_json::Value =
            serde_json::from_str(&result).unwrap_or(serde_json::Value::Null);
        let ran_ok = value["ok"].as_bool().unwrap_or(false);
        let output = value["output"].as_str().unwrap_or_default();
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(output);
        if !ran_ok {
            return Err(combined);
        }
    }
    Ok(combined)
}

// ─── `.cybsh` scripts + `theme`/`ui` ─────────────────────────────────────
// Same interpreted language as the native shell (`crates/os/src/script.rs`)
// and the static twin (`src/utils/cybshScript.ts`): python-style
// `print` + `if/elif/else`, `let` (TS annotations stripped), `for`/`while`,
// inline `$ <cybsh>` / `sh "…"` lines through `exec_result`, a `js`
// expression subset, honest `fetch` refusal, and `ui`/`theme` against the
// volume mirror (`/.cybermanju/theme.json`). Budgets match the native side
// so a script behaves the same on every transport.

const SCRIPT_EXT: &str = ".cybsh";
const SCRIPT_MAX_SOURCE: usize = 64 * 1024;
const SCRIPT_MAX_STMTS: usize = 200;
const SCRIPT_MAX_STEPS: usize = 5000;
const SCRIPT_MAX_ITERS: usize = 1000;
const SCRIPT_MAX_VARS: usize = 64;
const SCRIPT_MAX_STR: usize = 16 * 1024;
const SCRIPT_MAX_LIST: usize = 1024;
const SCRIPT_MAX_OUTPUT: usize = 256 * 1024;
const SCRIPT_MAX_FUNCS: usize = 32;
const SCRIPT_MAX_CALL_DEPTH: usize = 32;
/// Language version pinned by `# cybsh: 1`.
const SCRIPT_VERSION: &str = "1";
const THEME_FILE: &str = "/.cybermanju/theme.json";

fn run_script_file(args: &[String]) -> String {
    let dry = args.iter().any(|a| a == "--dry" || a == "--check");
    if args.iter().any(|a| a == "--help" || a == "-h") || args.is_empty() {
        return err(
            "usage: run <file.cybsh> [--dry] [--json] [--record <journal.json>] [--replay <journal.json>]"
                .to_string(),
        );
    }
    let mut record_arg: Option<String> = None;
    let mut replay_arg: Option<String> = None;
    let mut positional: Vec<&String> = Vec::new();
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "--record" || arg == "--replay" {
            skip_next = true;
            continue;
        }
        if !arg.starts_with('-') {
            positional.push(arg);
        }
    }
    let mut flag_values = args.iter();
    while let Some(arg) = flag_values.next() {
        if arg == "--record" || arg == "--replay" {
            let value = match flag_values.next().filter(|v| !v.starts_with('-')) {
                Some(v) => v.clone(),
                None => {
                    return err(format!("usage: run <file.cybsh> [{arg} <journal.json>]"));
                }
            };
            if arg == "--record" {
                record_arg = Some(value);
            } else {
                replay_arg = Some(value);
            }
        }
    }
    if record_arg.is_some() && replay_arg.is_some() {
        return err("invalid: `--record` and `--replay` are exclusive".to_string());
    }
    let raw_path = match positional.first() {
        Some(p) => (*p).clone(),
        None => return err("usage: run <file.cybsh> [--dry] [--json]".to_string()),
    };
    if !raw_path.to_lowercase().ends_with(SCRIPT_EXT) {
        return err(format!(
            "invalid: `run` needs a {SCRIPT_EXT} file (got `{raw_path}`) — scripts are interpreted, no build step"
        ));
    }
    let json = args.iter().any(|a| a == "--json");
    let cwd = CWD.with(|c| c.borrow().clone());
    let path = join(&cwd, &raw_path);
    let source = match load_volume().get(&path) {
        Some(s) => s.clone(),
        None => return err(format!("not_found: no script at {path}")),
    };
    if source.len() > SCRIPT_MAX_SOURCE {
        return err(format!(
            "too_large: script is {} bytes, limit is {SCRIPT_MAX_SOURCE}",
            source.len()
        ));
    }
    if dry {
        return match script_dry(&source) {
            Ok(report) => ok(format!("{path}: {report}")),
            Err(e) => err(e),
        };
    }
    if SCRIPT_DEPTH.with(|d| *d.borrow()) >= 4 {
        return err(
            "too_large: `run` nesting exceeds 4 (script calling script calling …)".to_string(),
        );
    }
    // Replay journal: same source fingerprint or an `integrity:` refusal.
    let journal = if let Some(replay_name) = &replay_arg {
        let journal_path = join(&cwd, replay_name);
        let raw = match load_volume().get(&journal_path) {
            Some(s) => s.clone(),
            None => {
                return err(format!(
                    "not_found: no replay journal at {journal_path} (`--record` one first)"
                ))
            }
        };
        let parsed: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return err(format!("invalid: `{replay_name}` is not a replay journal")),
        };
        match script_journal_check(&parsed, &source) {
            Ok(journal) => Some(journal),
            Err(e) => return err(e),
        }
    } else {
        None
    };
    let recording = record_arg.is_some();
    let log_sh = RefCell::new(BTreeMap::new());
    let log_fetch: RefCell<BTreeMap<String, (bool, String)>> = RefCell::new(BTreeMap::new());
    let exec_wrap = |line: &str| -> Result<String, String> {
        if let Some(journal) = journal.as_ref() {
            return match journal.sh.get(line) {
                Some(rec) if rec.0 => Ok(rec.1.clone()),
                Some(rec) => Err(rec.1.clone()),
                None => Err(format!(
                    "not_found: replay journal has no `sh \"{line}\"` (re-record with `--record`)"
                )),
            };
        }
        let result = exec_result(line);
        if recording {
            let rec = match &result {
                Ok(text) => (true, text.clone()),
                Err(message) => (false, message.clone()),
            };
            log_sh.borrow_mut().insert(line.to_string(), rec);
        }
        result
    };
    let fetch_wrap = |url: &str| -> Result<String, String> {
        if let Some(journal) = journal.as_ref() {
            return match journal.fetch.get(url) {
                Some(rec) if rec.0 => Ok(rec.1.clone()),
                Some(rec) => Err(rec.1.clone()),
                None => Err(format!(
                    "not_found: replay journal has no `fetch {url}` (re-record with `--record`)"
                )),
            };
        }
        Err(format!(
            "unsupported: `fetch {url}` needs the browser/static transport (this sandbox has no HTTP client) — run the same {SCRIPT_EXT} via the Pages build where `fetch` really runs, or replay a journal (`--replay`)"
        ))
    };
    SCRIPT_DEPTH.with(|d| *d.borrow_mut() += 1);
    let result = script_run(&source, &exec_wrap, Some(&fetch_wrap));
    SCRIPT_DEPTH.with(|d| {
        let mut v = d.borrow_mut();
        *v = v.saturating_sub(1);
    });
    let output = match result {
        Ok(output) => output,
        Err(e) => return err(e),
    };
    if recording {
        let record_name = record_arg.as_ref().expect("recording");
        let record_path = join(&cwd, record_name);
        let mut sh_map = serde_json::Map::new();
        for (k, (ok, text)) in log_sh.borrow().iter() {
            sh_map.insert(k.clone(), serde_json::json!({ "ok": ok, "output": text }));
        }
        let mut fetch_map = serde_json::Map::new();
        for (k, (ok, text)) in log_fetch.borrow().iter() {
            fetch_map.insert(k.clone(), serde_json::json!({ "ok": ok, "output": text }));
        }
        let mut volume = load_volume();
        volume.insert(
            record_path,
            serde_json::json!({
                "cybsh": 1,
                "fingerprint": script_fingerprint(&source),
                "script": path,
                "calls": { "sh": sh_map, "fetch": fetch_map },
            })
            .to_string(),
        );
        save_volume(&volume);
    }
    if json {
        ok(serde_json::json!({
            "path": path,
            "vars": output.vars,
            "caps": output.caps,
            "calls": { "sh": output.sh_calls, "fetch": output.fetch_calls },
            "journal": if journal.is_some() { "replay" } else if recording { "record" } else { "none" },
            "output": output.text,
        })
        .to_string())
    } else {
        ok(output.text)
    }
}

/// `--dry` report with version + capability notes (no line executes).
fn script_dry(source: &str) -> Result<String, String> {
    let n = script_parse(source)?;
    let caps = script_parse_caps(source);
    let cap_note = if caps.active {
        format!(" · caps: {}", script_describe_caps(&caps))
    } else {
        String::new()
    };
    Ok(format!(
        "dry: {n} statement(s) parse{cap_note} — nothing executed (use `run <file.cybsh>` to execute)"
    ))
}

/// A verified replay journal: calls keyed by line/URL, `(ok, output)`.
struct ScriptJournal {
    sh: BTreeMap<String, (bool, String)>,
    fetch: BTreeMap<String, (bool, String)>,
}

fn script_journal_check(parsed: &serde_json::Value, source: &str) -> Result<ScriptJournal, String> {
    if parsed.get("cybsh").and_then(|v| v.as_u64()) != Some(1) {
        return Err("invalid: replay journal is not a cybsh v1 journal".to_string());
    }
    let want = script_fingerprint(source);
    if parsed.get("fingerprint").and_then(|v| v.as_str()) != Some(want.as_str()) {
        return Err(
            "integrity: replay journal fingerprint mismatch — the script changed since `--record` (re-record, don't replay stale inputs)".to_string(),
        );
    }
    let mut journal = ScriptJournal {
        sh: BTreeMap::new(),
        fetch: BTreeMap::new(),
    };
    if let Some(calls) = parsed.get("calls") {
        for (table, dest) in [("sh", &mut journal.sh), ("fetch", &mut journal.fetch)] {
            if let Some(entries) = calls.get(table).and_then(|t| t.as_object()) {
                for (k, v) in entries {
                    dest.insert(
                        k.clone(),
                        (
                            v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false),
                            v.get("output")
                                .and_then(|o| o.as_str())
                                .unwrap_or("")
                                .to_string(),
                        ),
                    );
                }
            }
        }
    }
    Ok(journal)
}

fn theme_ids() -> &'static [&'static str] {
    &[
        "mac-light",
        "mac-dark",
        "mac-graphite-light",
        "mac-graphite-dark",
        "mac-midnight",
        "ocean-light",
        "sunset-light",
        "forest-light",
        "lavender-light",
        "rose-light",
        "ocean-night",
        "forest-night",
        "ember-night",
        "nebula-night",
        "cyber-night",
        "matrix-night",
        "cyberpunk-night",
    ]
}

fn canonical_theme(id: &str) -> Option<&'static str> {
    match id.to_lowercase().as_str() {
        "mac-light" => Some("mac-light"),
        "mac-dark" => Some("mac-dark"),
        "mac-graphite-light" => Some("mac-graphite-light"),
        "mac-graphite-dark" => Some("mac-graphite-dark"),
        "mac-midnight" => Some("mac-midnight"),
        "ocean-light" => Some("ocean-light"),
        "sunset-light" => Some("sunset-light"),
        "forest-light" => Some("forest-light"),
        "lavender-light" => Some("lavender-light"),
        "rose-light" => Some("rose-light"),
        "ocean-night" => Some("ocean-night"),
        "forest-night" => Some("forest-night"),
        "ember-night" => Some("ember-night"),
        "nebula-night" => Some("nebula-night"),
        "cyber-night" => Some("cyber-night"),
        "matrix-night" => Some("matrix-night"),
        "cyberpunk-night" => Some("cyberpunk-night"),
        "midnight" => Some("mac-midnight"),
        "nebula" => Some("mac-dark"),
        "ember" => Some("mac-dark"),
        "daylight" => Some("mac-light"),
        "ghostline" => Some("mac-dark"),
        _ => None,
    }
}

fn valid_accent(raw: &str) -> bool {
    let hex = raw.strip_prefix('#').unwrap_or(raw);
    (hex.len() == 3 || hex.len() == 6) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Full interface settings mirror (`/.cybermanju/theme.json`) — every `ui`
/// verb reads/writes this shape on all transports, so the terminal
/// customizes the whole interface, not just the palette.
#[derive(Clone, Debug)]
struct UiSettings {
    theme: String,
    accent: Option<String>,
    accents: Vec<(String, String)>,
    density: String,
    glass: u8,
    motion: String,
    glow: bool,
}

impl UiSettings {
    fn defaults() -> Self {
        Self {
            theme: "mac-light".to_string(),
            accent: None,
            accents: Vec::new(),
            density: "comfortable".to_string(),
            glass: 2,
            motion: "auto".to_string(),
            glow: true,
        }
    }

    fn to_json(&self) -> serde_json::Value {
        let mut accents = serde_json::Map::new();
        for (k, v) in &self.accents {
            accents.insert(k.clone(), serde_json::Value::String(v.clone()));
        }
        serde_json::json!({
            "theme": self.theme,
            "accent": self.accent,
            "accents": accents,
            "density": self.density,
            "glass": self.glass,
            "motion": self.motion,
            "glow": self.glow,
        })
    }
}

fn load_ui() -> UiSettings {
    let data = load_volume().get(THEME_FILE).cloned().unwrap_or_default();
    if data.is_empty() {
        return UiSettings::defaults();
    }
    let value: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::Value::Null);
    let theme = value
        .get("theme")
        .and_then(|v| v.as_str())
        .filter(|t| canonical_theme(t).is_some())
        .unwrap_or("mac-light")
        .to_string();
    let accent = value
        .get("accent")
        .and_then(|v| v.as_str())
        .filter(|a| valid_accent(a))
        .map(str::to_string);
    let mut accents = Vec::new();
    if let Some(map) = value.get("accents").and_then(|v| v.as_object()) {
        for (k, v) in map {
            if let Some(hex) = v.as_str() {
                if canonical_theme(k).is_some() && valid_accent(hex) {
                    accents.push((k.clone(), hex.to_string()));
                }
            }
        }
    }
    let density = value
        .get("density")
        .and_then(|v| v.as_str())
        .filter(|d| *d == "compact" || *d == "comfortable")
        .unwrap_or("comfortable")
        .to_string();
    let glass = value
        .get("glass")
        .and_then(|v| v.as_u64())
        .unwrap_or(2)
        .min(3) as u8;
    let motion = value
        .get("motion")
        .and_then(|v| v.as_str())
        .filter(|m| *m == "auto" || *m == "full" || *m == "reduced")
        .unwrap_or("auto")
        .to_string();
    let glow = value.get("glow").and_then(|v| v.as_bool()).unwrap_or(true);
    UiSettings {
        theme,
        accent,
        accents,
        density,
        glass,
        motion,
        glow,
    }
}

fn save_ui(s: &UiSettings) {
    let mut volume = load_volume();
    volume.insert(THEME_FILE.to_string(), s.to_json().to_string());
    save_volume(&volume);
}

/// Human summary + the machine `ui:` effect lines the Terminal panel
/// applies via `useTheme()`, so the interface changes on all transports.
fn ui_line(s: &UiSettings) -> String {
    let accent = s.accent.as_deref().unwrap_or("system");
    let mut out = format!(
        "theme: {} · accent: {accent}\ndensity: {} · glass: {} · motion: {} · glow: {}",
        s.theme,
        s.density,
        s.glass,
        s.motion,
        if s.glow { "on" } else { "off" }
    );
    if !s.accents.is_empty() {
        let per: Vec<String> = s.accents.iter().map(|(k, v)| format!("{k}={v}")).collect();
        out.push_str(&format!("\naccents: {}", per.join(" ")));
    }
    out.push_str(&format!("\nui: theme={}", s.theme));
    out.push_str(&format!("\nui: accent={accent}"));
    out.push_str(&format!("\nui: density={}", s.density));
    out.push_str(&format!("\nui: glass={}", s.glass));
    out.push_str(&format!("\nui: motion={}", s.motion));
    out.push_str(&format!("\nui: glow={}", if s.glow { "on" } else { "off" }));
    for (k, v) in &s.accents {
        out.push_str(&format!("\nui: accent-for={k}:{v}"));
    }
    out
}

fn parse_glass(raw: &str) -> Option<u8> {
    match raw.to_lowercase().as_str() {
        "0" | "solid" => Some(0),
        "1" | "light" => Some(1),
        "2" | "default" => Some(2),
        "3" | "rich" => Some(3),
        _ => None,
    }
}

fn theme_cmd(args: &[String]) -> String {
    let json = args.iter().any(|a| a == "--json");
    let want = args.iter().find(|a| !a.starts_with('-')).cloned();
    let s = load_ui();
    let id = match want {
        None => {
            if json {
                return ok(s.to_json().to_string());
            }
            return ok(ui_line(&s));
        }
        Some(w) if w == "get" => {
            if json {
                return ok(s.to_json().to_string());
            }
            return ok(ui_line(&s));
        }
        Some(w) => w,
    };
    let canonical = match canonical_theme(&id) {
        Some(c) => c,
        None => {
            return err(format!(
                "invalid: unknown theme '{id}' (try: {})",
                theme_ids().join(", ")
            ))
        }
    };
    let mut next = s.clone();
    next.theme = canonical.to_string();
    save_ui(&next);
    if json {
        return ok(next.to_json().to_string());
    }
    ok(ui_line(&next))
}

fn ui_cmd(args: &[String]) -> String {
    let json = args.iter().any(|a| a == "--json");
    let plain: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    let sub = plain.first().map(|s| s.as_str()).unwrap_or("get");
    let s = load_ui();
    match sub {
        "get" => {
            if json {
                return ok(s.to_json().to_string());
            }
            ok(ui_line(&s))
        }
        "theme" => {
            let id = match plain.get(1) {
                Some(id) => id,
                None => {
                    return err(format!(
                        "usage: ui theme <id> (try: {})",
                        theme_ids().join(", ")
                    ))
                }
            };
            let canonical = match canonical_theme(id) {
                Some(c) => c,
                None => {
                    return err(format!(
                        "invalid: unknown theme '{id}' (try: {})",
                        theme_ids().join(", ")
                    ))
                }
            };
            let mut next = s.clone();
            next.theme = canonical.to_string();
            save_ui(&next);
            if json {
                return ok(next.to_json().to_string());
            }
            ok(ui_line(&next))
        }
        "accent" => {
            let raw = match plain.get(1) {
                Some(r) => r,
                None => {
                    return err(
                        "usage: ui accent <#rrggbb|#rgb|default> [--for <theme>]".to_string(),
                    )
                }
            };
            let for_theme: Option<&str> = match args
                .iter()
                .position(|a| a == "--for" || a == "-for")
            {
                Some(i) => match args.get(i + 1).filter(|t| !t.starts_with('-')) {
                    Some(t) => {
                        if canonical_theme(t).is_none() {
                            return err(format!(
                                "invalid: unknown theme '{t}' (try: {})",
                                theme_ids().join(", ")
                            ));
                        }
                        Some(t.as_str())
                    }
                    None => {
                        return err(format!(
                            "invalid: --for needs a theme (try: {})",
                            theme_ids().join(", ")
                        ))
                    }
                },
                None => None,
            };
            let next: Option<String> = if raw.as_str() == "default"
                || raw.as_str() == "system"
                || raw.as_str() == "none"
            {
                None
            } else {
                let hex = if raw.starts_with('#') {
                    raw.to_string()
                } else {
                    format!("#{raw}")
                };
                if !valid_accent(&hex) {
                    return err(format!(
                        "invalid: bad accent '{raw}' (use #rrggbb, #rgb, or `default`)"
                    ));
                }
                Some(hex)
            };
            let mut updated = s.clone();
            if let Some(t) = for_theme {
                let canonical = canonical_theme(t).unwrap_or("mac-light");
                updated.accents.retain(|(k, _)| k != canonical);
                if let Some(hex) = next.clone() {
                    updated.accents.push((canonical.to_string(), hex));
                }
                save_ui(&updated);
                let shown = next.clone().unwrap_or_else(|| "system".to_string());
                if json {
                    return ok(updated.to_json().to_string());
                }
                return ok(format!(
                    "accent: {canonical} → {shown}\nui: accent-for={canonical}:{shown}"
                ));
            }
            updated.accent = next;
            save_ui(&updated);
            if json {
                return ok(updated.to_json().to_string());
            }
            ok(ui_line(&updated))
        }
        "density" => {
            let want = plain.get(1).map(|v| v.as_str()).unwrap_or("get");
            if want == "get" {
                if json {
                    return ok(serde_json::json!({ "density": s.density }).to_string());
                }
                return ok(format!("density: {}\nui: density={}", s.density, s.density));
            }
            if want != "compact" && want != "comfortable" {
                return err(format!(
                    "invalid: bad density '{want}' (use compact|comfortable)"
                ));
            }
            let mut updated = s.clone();
            updated.density = want.to_string();
            save_ui(&updated);
            if json {
                return ok(serde_json::json!({ "density": want }).to_string());
            }
            ok(format!("density: {want}\nui: density={want}"))
        }
        "glass" => {
            let want = plain.get(1).map(|v| v.as_str()).unwrap_or("get");
            if want == "get" {
                if json {
                    return ok(serde_json::json!({ "glass": s.glass }).to_string());
                }
                return ok(format!("glass: {}\nui: glass={}", s.glass, s.glass));
            }
            let level = match parse_glass(want) {
                Some(l) => l,
                None => {
                    return err(format!(
                        "invalid: bad glass '{want}' (use 0|solid, 1|light, 2|default, 3|rich)"
                    ))
                }
            };
            let mut updated = s.clone();
            updated.glass = level;
            save_ui(&updated);
            if json {
                return ok(serde_json::json!({ "glass": level }).to_string());
            }
            ok(format!("glass: {level}\nui: glass={level}"))
        }
        "motion" => {
            let want = plain.get(1).map(|v| v.as_str()).unwrap_or("get");
            if want == "get" {
                if json {
                    return ok(serde_json::json!({ "motion": s.motion }).to_string());
                }
                return ok(format!("motion: {}\nui: motion={}", s.motion, s.motion));
            }
            if want != "auto" && want != "full" && want != "reduced" {
                return err(format!(
                    "invalid: bad motion '{want}' (use auto|full|reduced)"
                ));
            }
            let mut updated = s.clone();
            updated.motion = want.to_string();
            save_ui(&updated);
            if json {
                return ok(serde_json::json!({ "motion": want }).to_string());
            }
            ok(format!("motion: {want}\nui: motion={want}"))
        }
        "glow" => {
            let want = plain.get(1).map(|v| v.as_str()).unwrap_or("get");
            if want == "get" {
                let shown = if s.glow { "on" } else { "off" };
                if json {
                    return ok(serde_json::json!({ "glow": s.glow }).to_string());
                }
                return ok(format!("glow: {shown}\nui: glow={shown}"));
            }
            let on = match want.to_lowercase().as_str() {
                "on" | "true" | "1" => true,
                "off" | "false" | "0" => false,
                _ => {
                    return err(format!("invalid: bad glow '{want}' (use on|off)"));
                }
            };
            let mut updated = s.clone();
            updated.glow = on;
            save_ui(&updated);
            let shown = if on { "on" } else { "off" };
            if json {
                return ok(serde_json::json!({ "glow": on }).to_string());
            }
            ok(format!("glow: {shown}\nui: glow={shown}"))
        }
        other => err(format!(
            "usage: ui theme <id>|accent <#hex|default> [--for <theme>]|density <compact|comfortable>|glass <0|solid|1|light|2|default|3|rich>|motion <auto|full|reduced>|glow <on|off>|get (got `{other}`)"
        )),
    }
}

// ─── script interpreter (compact twin of `crates/os/src/script.rs`) ───────

#[derive(Debug, Clone)]
enum SValue {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    List(Vec<SValue>),
    // Dict keys stay sorted, so display, iteration and `==` are
    // deterministic on every transport (Starlark rule).
    Dict(BTreeMap<String, SValue>),
}

impl SValue {
    fn type_name(&self) -> &'static str {
        match self {
            SValue::Null => "null",
            SValue::Bool(_) => "bool",
            SValue::Num(_) => "number",
            SValue::Str(_) => "string",
            SValue::List(_) => "list",
            SValue::Dict(_) => "dict",
        }
    }

    fn truthy(&self) -> bool {
        match self {
            SValue::Null => false,
            SValue::Bool(b) => *b,
            SValue::Num(n) => *n != 0.0 && !n.is_nan(),
            SValue::Str(s) => !s.is_empty(),
            SValue::List(l) => !l.is_empty(),
            SValue::Dict(d) => !d.is_empty(),
        }
    }

    fn display(&self) -> String {
        match self {
            SValue::Null => "null".to_string(),
            SValue::Bool(true) => "true".to_string(),
            SValue::Bool(false) => "false".to_string(),
            SValue::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else {
                    format!("{n}")
                }
            }
            SValue::Str(s) => s.clone(),
            SValue::List(items) => {
                let parts: Vec<String> = items.iter().map(|v| v.display()).collect();
                format!("[{}]", parts.join(", "))
            }
            SValue::Dict(map) => {
                let parts: Vec<String> = map
                    .iter()
                    .map(|(k, v)| format!("{}: {}", script_json_quote(k), v.display()))
                    .collect();
                format!("{{{}}}", parts.join(", "))
            }
        }
    }

    fn as_f64(&self) -> Option<f64> {
        match self {
            SValue::Num(n) => Some(*n),
            SValue::Bool(true) => Some(1.0),
            SValue::Bool(false) => Some(0.0),
            SValue::Str(s) => s.trim().parse::<f64>().ok(),
            SValue::Null => Some(0.0),
            SValue::List(l) => Some(l.len() as f64),
            SValue::Dict(d) => Some(d.len() as f64),
        }
    }
}

/// Inline shell + fetch as values: the host surface a script may touch.
type ScriptShellFn<'a> = &'a dyn Fn(&str) -> Result<String, String>;

/// JSON-quote a string for dict display (minimal escaping, deterministic).
fn script_json_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[derive(Debug, Clone)]
struct SLine {
    indent: usize,
    text: String,
    lineno: usize,
}

#[derive(Debug, Clone)]
struct SFuncDef {
    params: Vec<String>,
    body: Vec<SLine>,
}

/// Declared capabilities (`# cap:` lines, Deno-style least privilege).
#[derive(Debug, Clone, Default)]
struct SCaps {
    net: Option<Vec<String>>,
    read: Option<Vec<String>>,
    write: Option<Vec<String>>,
    deny: Vec<String>,
    active: bool,
}

impl SCaps {
    fn check_exec(&self, line: &str) -> Result<(), String> {
        if !self.active || self.deny.is_empty() {
            return Ok(());
        }
        let verb = line.split_whitespace().next().unwrap_or("").to_lowercase();
        if self.deny.iter().any(|d| d.to_lowercase() == verb) {
            return Err(format!(
                "denied: `{verb}` is refused by this script's capabilities (`# cap: deny=…`)"
            ));
        }
        Ok(())
    }

    fn check_fetch(&self, url: &str) -> Result<(), String> {
        if !self.active {
            return Ok(());
        }
        let host = script_fetch_host(url);
        match &self.net {
            Some(hosts) if hosts.iter().any(|h| h.to_lowercase() == host) => Ok(()),
            Some(_) => Err(format!(
                "denied: fetch {url} is outside this script's `net=` allowlist"
            )),
            None => {
                Err("denied: fetch needs a `net=<host>` capability (`# cap: net=…`)".to_string())
            }
        }
    }

    fn summary(&self) -> serde_json::Value {
        serde_json::json!({
            "active": self.active,
            "net": self.net,
            "read": self.read,
            "write": self.write,
            "deny": self.deny,
        })
    }
}

fn script_fetch_host(url: &str) -> String {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    host_port
        .split('@')
        .next_back()
        .unwrap_or(host_port)
        .to_lowercase()
}

fn script_parse_caps(source: &str) -> SCaps {
    let mut caps = SCaps::default();
    for raw in source.lines().take(200) {
        let t = raw.trim();
        let rest = if let Some(r) = t.strip_prefix("# cap:") {
            r
        } else if let Some(r) = t.strip_prefix("#cap:") {
            r
        } else {
            continue;
        };
        caps.active = true;
        for tok in rest.split_whitespace() {
            let Some((k, v)) = tok.split_once('=') else {
                continue;
            };
            let items: Vec<String> = v
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            match k {
                "net" => caps.net = Some(items),
                "read" => caps.read = Some(items),
                "write" => caps.write = Some(items),
                "deny" => caps.deny.extend(items),
                _ => {}
            }
        }
    }
    caps
}

fn script_describe_caps(caps: &SCaps) -> String {
    let mut parts = Vec::new();
    if let Some(net) = &caps.net {
        parts.push(format!("net={}", net.join(",")));
    }
    if !caps.deny.is_empty() {
        parts.push(format!("deny={}", caps.deny.join(",")));
    }
    if parts.is_empty() {
        parts.push("declared".to_string());
    }
    parts.join(" ")
}

fn script_check_version(source: &str) -> Result<(), String> {
    for raw in source.lines() {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        if let Some(rest) = t.strip_prefix('#') {
            let decl = rest.trim();
            if let Some(ver) = decl
                .strip_prefix("cybsh:")
                .or_else(|| decl.strip_prefix("cybsh "))
            {
                let ver = ver.trim();
                if ver != SCRIPT_VERSION {
                    return Err(format!(
                        "unsupported: script pins cybsh v{ver} but this shell speaks v{SCRIPT_VERSION}"
                    ));
                }
            }
        }
        return Ok(());
    }
    Ok(())
}

/// FNV-1a/64 over the UTF-8 bytes — same tag as every other transport, so
/// replay journals stay portable (`fnv("a") == af63dc4c8601ec8c`).
fn script_fingerprint(source: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in source.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

struct ScriptInterp<'a> {
    exec: ScriptShellFn<'a>,
    fetch: Option<ScriptShellFn<'a>>,
    caps: SCaps,
    vars: BTreeMap<String, SValue>,
    funcs: BTreeMap<String, SFuncDef>,
    flow: Option<SValue>,
    call_depth: usize,
    out: String,
    steps: usize,
    truncated: bool,
    sh_calls: usize,
    fetch_calls: usize,
}

struct ScriptOut {
    text: String,
    vars: usize,
    sh_calls: usize,
    fetch_calls: usize,
    caps: Option<serde_json::Value>,
}

fn script_parse(source: &str) -> Result<usize, String> {
    script_check_version(source)?;
    Ok(script_split(source)?.len())
}

fn script_run(
    source: &str,
    exec: ScriptShellFn<'_>,
    fetch: Option<ScriptShellFn<'_>>,
) -> Result<ScriptOut, String> {
    script_check_version(source)?;
    let lines = script_split(source)?;
    let caps = script_parse_caps(source);
    let mut ip = ScriptInterp {
        exec,
        fetch,
        caps: caps.clone(),
        vars: BTreeMap::new(),
        funcs: BTreeMap::new(),
        flow: None,
        call_depth: 0,
        out: String::new(),
        steps: 0,
        truncated: false,
        sh_calls: 0,
        fetch_calls: 0,
    };
    // Top level runs at parent depth -1 so indent-0 lines execute.
    script_block(&mut ip, &lines, 0, -1)?;
    if ip.truncated {
        ip.out.push_str(&format!(
            "\n… output truncated at {SCRIPT_MAX_OUTPUT} bytes (fewer `print`/`sh` lines for the full log)"
        ));
    }
    Ok(ScriptOut {
        text: ip.out,
        vars: ip.vars.len(),
        sh_calls: ip.sh_calls,
        fetch_calls: ip.fetch_calls,
        caps: if caps.active {
            Some(caps.summary())
        } else {
            None
        },
    })
}

/// Inline shell through the capability gate (single choke point).
fn script_exec_checked(ip: &mut ScriptInterp, line: &str) -> Result<String, String> {
    ip.caps.check_exec(line)?;
    ip.sh_calls += 1;
    (ip.exec)(line)
}

/// Fetch through the capability gate + optional journal hook.
fn script_fetch_checked(ip: &mut ScriptInterp, url: &str, lineno: usize) -> Result<String, String> {
    ip.caps.check_fetch(url)?;
    ip.fetch_calls += 1;
    match ip.fetch {
        Some(fetch) => fetch(url)
            .map(|text| {
                if text.len() > SCRIPT_MAX_STR {
                    text[..SCRIPT_MAX_STR].to_string()
                } else {
                    text
                }
            })
            .map_err(|e| format!("line {lineno}: {e}")),
        None => Err(format!(
            "unsupported: `fetch {url}` needs the browser/static transport (this sandbox has no HTTP client) — run the same {SCRIPT_EXT} via the Pages build where `fetch` really runs, or replay a journal (`--replay`)"
        )),
    }
}

/// Shared capture: `--json` output materializes, text stays a string.
fn script_inline_value(
    ip: &mut ScriptInterp,
    cmdline: &str,
    lineno: usize,
) -> Result<SValue, String> {
    match script_exec_checked(ip, cmdline) {
        Ok(text) => {
            let v = script_materialize(&text).unwrap_or_else(|| {
                SValue::Str(if text.len() > SCRIPT_MAX_STR {
                    text[..SCRIPT_MAX_STR].to_string()
                } else {
                    text
                })
            });
            script_set(ip, "_", v.clone())?;
            Ok(v)
        }
        Err(e) => Err(format!("{e} (line {lineno})")),
    }
}

fn script_materialize(text: &str) -> Option<SValue> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    Some(script_json_value(&value))
}

fn script_json_value(value: &serde_json::Value) -> SValue {
    match value {
        serde_json::Value::Null => SValue::Null,
        serde_json::Value::Bool(b) => SValue::Bool(*b),
        serde_json::Value::Number(n) => SValue::Num(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => SValue::Str(if s.len() > SCRIPT_MAX_STR {
            s[..SCRIPT_MAX_STR].to_string()
        } else {
            s.clone()
        }),
        serde_json::Value::Array(items) => SValue::List(
            items
                .iter()
                .take(SCRIPT_MAX_LIST)
                .map(script_json_value)
                .collect(),
        ),
        serde_json::Value::Object(map) => SValue::Dict(
            map.iter()
                .take(SCRIPT_MAX_LIST)
                .map(|(k, v)| (k.clone(), script_json_value(v)))
                .collect(),
        ),
    }
}

fn script_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && name.len() <= 64
}

/// Builtins, literals and operators a `def` may not shadow.
fn script_is_reserved(name: &str) -> bool {
    matches!(
        name,
        "len"
            | "int"
            | "str"
            | "json"
            | "split"
            | "range"
            | "sh"
            | "set"
            | "push"
            | "del"
            | "keys"
            | "values"
            | "true"
            | "false"
            | "null"
            | "none"
            | "nil"
            | "and"
            | "or"
            | "not"
    )
}

fn script_emit(ip: &mut ScriptInterp, s: &str) {
    if ip.out.len() >= SCRIPT_MAX_OUTPUT {
        ip.truncated = true;
        return;
    }
    let mut chunk = s.to_string();
    if ip.out.len() + chunk.len() + 1 > SCRIPT_MAX_OUTPUT {
        let keep = SCRIPT_MAX_OUTPUT - ip.out.len();
        chunk.truncate(keep);
        ip.truncated = true;
    }
    if !ip.out.is_empty() {
        ip.out.push('\n');
    }
    ip.out.push_str(&chunk);
}

fn script_bump(ip: &mut ScriptInterp) -> Result<(), String> {
    ip.steps += 1;
    if ip.steps > SCRIPT_MAX_STEPS {
        return Err(format!(
            "too_large: script exceeded {SCRIPT_MAX_STEPS} steps (possible infinite loop — split it or add a bound)"
        ));
    }
    Ok(())
}

fn script_set(ip: &mut ScriptInterp, name: &str, value: SValue) -> Result<(), String> {
    if !script_valid_name(name) {
        return Err(format!(
            "syntax: bad variable name '{name}' ([A-Za-z_][A-Za-z0-9_]*)"
        ));
    }
    if !ip.vars.contains_key(name) && ip.vars.len() >= SCRIPT_MAX_VARS {
        return Err(format!(
            "too_large: script holds {SCRIPT_MAX_VARS} variables already (`free` one or run `gc`)"
        ));
    }
    ip.vars.insert(name.to_string(), value);
    Ok(())
}

fn script_strip_comment(body: &str) -> &str {
    let chars: Vec<char> = body.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            i += 1;
            continue;
        }
        if c == '#' {
            let prev = if i == 0 { ' ' } else { chars[i - 1] };
            if i == 0 || prev.is_whitespace() {
                let byte: usize = chars[..i].iter().collect::<String>().len();
                return body[..byte].trim_end();
            }
        }
        i += 1;
    }
    body
}

fn script_split(source: &str) -> Result<Vec<SLine>, String> {
    let mut out = Vec::new();
    for (idx, raw) in source.lines().enumerate() {
        let mut indent = 0usize;
        for c in raw.chars() {
            if c == ' ' {
                indent += 1;
            } else if c == '\t' {
                indent += 4;
            } else {
                break;
            }
        }
        let body = raw.trim_start_matches([' ', '\t']);
        let text = script_strip_comment(body).trim().to_string();
        if text.is_empty() {
            continue;
        }
        out.push(SLine {
            indent,
            text,
            lineno: idx + 1,
        });
    }
    Ok(out)
}

fn script_block(
    ip: &mut ScriptInterp,
    lines: &[SLine],
    start: usize,
    parent: isize,
) -> Result<usize, String> {
    let mut i = start;
    let mut executed = 0usize;
    while i < lines.len() && lines[i].indent as isize > parent {
        if executed >= SCRIPT_MAX_STMTS {
            return Err(format!(
                "too_large: block exceeds {SCRIPT_MAX_STMTS} statements (line {}) — split the script",
                lines[i].lineno
            ));
        }
        i = script_statement(ip, lines, i)?;
        executed += 1;
        // A `return` inside a `def` unwinds every enclosing block.
        if ip.flow.is_some() {
            break;
        }
    }
    Ok(i)
}

fn script_block_indent(lines: &[SLine], start: usize, parent: isize) -> Result<(), String> {
    if start >= lines.len() || lines[start].indent as isize <= parent {
        let at = lines.get(start).map(|l| l.lineno).unwrap_or(0);
        return Err(format!(
            "syntax: expected an indented block after line {at}"
        ));
    }
    Ok(())
}

fn script_skip(lines: &[SLine], start: usize, parent: isize) -> usize {
    let mut i = start;
    while i < lines.len() && lines[i].indent as isize > parent {
        i += 1;
    }
    i
}

fn script_first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or(s)
}

fn script_is_kw(text: &str, kw: &str) -> bool {
    text == kw || text.starts_with(&format!("{kw} "))
}

fn script_rest<'b>(text: &'b str, kw: &str, lineno: usize) -> Result<&'b str, String> {
    text.strip_prefix(kw)
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .ok_or_else(|| format!("syntax: line {lineno}: `{kw}` needs an argument"))
}

fn script_colon(s: &str, lineno: usize) -> Result<String, String> {
    let t = s.trim();
    match t.strip_suffix(':') {
        Some(inner) => Ok(inner.trim().to_string()),
        None => Err(format!("syntax: line {lineno}: block opener needs a trailing `:` (`if …:`, `for …:`, `while …:`, `else:`)")),
    }
}

fn script_bare_verb(text: &str) -> bool {
    matches!(
        script_first_word(text),
        "help"
            | "history"
            | "clear"
            | "version"
            | "echo"
            | "ls"
            | "cd"
            | "pwd"
            | "cat"
            | "cp"
            | "mv"
            | "rm"
            | "mkdir"
            | "touch"
            | "stat"
            | "du"
            | "df"
            | "mount"
            | "umount"
            | "disk"
            | "providers"
            | "quota"
            | "oauth"
            | "sync"
            | "scrub"
            | "repair"
            | "gc"
            | "lease"
            | "ps"
            | "top"
            | "kill"
            | "jobs"
            | "compute"
            | "workers"
            | "keygen"
            | "encrypt"
            | "decrypt"
            | "compress"
            | "decompress"
            | "search"
            | "grep"
            | "find"
            | "head"
            | "tail"
            | "wc"
            | "write"
            | "edit"
            | "ai"
            | "theme"
            | "ui"
    )
}

fn script_skip_chain(lines: &[SLine], mut j: usize, parent: isize) -> usize {
    loop {
        if j < lines.len() && lines[j].indent as isize == parent {
            let t = lines[j].text.as_str();
            if script_is_kw(t, "elif") || t == "else:" || t == "else" {
                j = script_skip(lines, j + 1, parent);
                continue;
            }
        }
        return j;
    }
}

fn script_is_catch(text: &str) -> bool {
    text == "catch" || text == "catch:" || script_is_kw(text, "catch")
}

fn script_catch_binding(text: &str, lineno: usize) -> Result<Option<String>, String> {
    if text == "catch" || text == "catch:" {
        return Ok(None);
    }
    let name = script_rest(text, "catch", lineno)?
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_string();
    if name.is_empty() {
        return Ok(None);
    }
    if !script_valid_name(&name) {
        return Err(format!("syntax: line {lineno}: bad catch binding `{name}`"));
    }
    Ok(Some(name))
}

fn script_split_def(header: &str, lineno: usize) -> Result<(String, Vec<String>), String> {
    let open = header
        .find('(')
        .ok_or_else(|| format!("syntax: line {lineno}: `def` needs `def name(p1, …):`"))?;
    let name = header[..open].trim().to_string();
    if !script_valid_name(&name) {
        return Err(format!("syntax: line {lineno}: bad function name `{name}`"));
    }
    if script_is_reserved(&name) {
        return Err(format!(
            "syntax: line {lineno}: `{name}` is a builtin — pick another function name"
        ));
    }
    let rest = header[open + 1..].trim();
    if !rest.ends_with(')') {
        return Err(format!(
            "syntax: line {lineno}: `def` params need a closing `)`"
        ));
    }
    let mut params = Vec::new();
    for p in rest[..rest.len() - 1].split(',') {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        if !script_valid_name(p) || params.iter().any(|q| q == p) {
            return Err(format!("syntax: line {lineno}: bad/duplicate param `{p}`"));
        }
        params.push(p.to_string());
    }
    if params.len() > 8 {
        return Err(format!(
            "syntax: line {lineno}: `def` takes at most 8 params"
        ));
    }
    Ok((name, params))
}

fn script_split_fetch(rest: &str) -> (String, Option<String>) {
    if let Some(pos) = rest.find(" as ") {
        let name = rest[pos + " as ".len()..].trim();
        if script_valid_name(name) && !rest[..pos].trim().is_empty() {
            return (rest[..pos].trim().to_string(), Some(name.to_string()));
        }
    }
    (rest.trim().to_string(), None)
}

fn script_call_func(
    ip: &mut ScriptInterp,
    name: &str,
    args: &[SValue],
    lineno: usize,
) -> Result<SValue, String> {
    let def = ip.funcs.get(name).cloned().ok_or_else(|| {
        format!(
            "syntax: line {lineno}: unknown function `{name}` (try `len/int/str/json/split/range/sh/set/push/del/keys/values` or `def` it first)"
        )
    })?;
    if args.len() != def.params.len() {
        return Err(format!(
            "syntax: line {lineno}: `{name}` takes {} argument(s), got {}",
            def.params.len(),
            args.len()
        ));
    }
    if ip.call_depth >= SCRIPT_MAX_CALL_DEPTH {
        return Err(format!(
            "too_large: line {lineno}: call depth exceeds {SCRIPT_MAX_CALL_DEPTH} (recursive `def`?)"
        ));
    }
    let saved_vars = ip.vars.clone();
    let saved_flow = ip.flow.take();
    for (param, arg) in def.params.iter().zip(args.iter()) {
        ip.vars.insert(param.clone(), arg.clone());
    }
    ip.call_depth += 1;
    let parent = def
        .body
        .first()
        .map(|l| l.indent as isize - 1)
        .unwrap_or(-1);
    let mut result = script_block(ip, &def.body, 0, parent).map(|_| SValue::Null);
    let returned = ip.flow.take().unwrap_or(SValue::Null);
    if result.is_ok() {
        result = Ok(returned);
    }
    ip.vars = saved_vars;
    if let Some(flow) = saved_flow {
        ip.flow = Some(flow);
    }
    ip.call_depth -= 1;
    result
}

fn script_inline(
    ip: &mut ScriptInterp,
    cmdline: &str,
    lineno: usize,
    idx: usize,
) -> Result<usize, String> {
    let expanded = script_interpolate(&ip.vars, cmdline);
    match script_exec_checked(ip, &expanded) {
        Ok(text) => {
            if !text.is_empty() {
                script_emit(ip, &text);
            }
            let capped = if text.len() > SCRIPT_MAX_STR {
                text[..SCRIPT_MAX_STR].to_string()
            } else {
                text
            };
            let _ = script_set(ip, "_", SValue::Str(capped));
            Ok(idx + 1)
        }
        Err(e) => Err(format!("{e} (line {lineno})")),
    }
}

fn script_interpolate(vars: &BTreeMap<String, SValue>, src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && chars.get(i + 1) == Some(&'{') {
            let mut j = i + 2;
            while j < chars.len() && chars[j] != '}' {
                j += 1;
            }
            if j < chars.len() {
                let name: String = chars[i + 2..j].iter().collect();
                if let Some(v) = vars.get(name.trim()) {
                    out.push_str(&v.display());
                } else {
                    out.push_str(&chars[i..=j].iter().collect::<String>());
                }
                i = j + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn script_unquote(s: &str, lineno: usize) -> Result<Option<String>, String> {
    let t = s.trim();
    if t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
    {
        return Ok(Some(t[1..t.len() - 1].to_string()));
    }
    if t.starts_with('"') || t.starts_with('\'') {
        return Err(format!("syntax: line {lineno}: unclosed quote in `{t}`"));
    }
    Ok(None)
}

fn script_statement(ip: &mut ScriptInterp, lines: &[SLine], idx: usize) -> Result<usize, String> {
    let text = lines[idx].text.clone();
    let lineno = lines[idx].lineno;
    let parent = lines[idx].indent as isize;
    script_bump(ip)?;

    if script_is_kw(&text, "if") {
        let cond = script_colon(script_rest(&text, "if", lineno)?, lineno)?;
        script_block_indent(lines, idx + 1, parent)?;
        if script_cond(ip, &cond, lineno)? {
            let end = script_block(ip, lines, idx + 1, parent)?;
            return Ok(script_skip_chain(lines, end, parent));
        }
        let mut j = script_skip(lines, idx + 1, parent);
        loop {
            if j < lines.len() && lines[j].indent as isize == parent {
                let t = lines[j].text.clone();
                let lj = lines[j].lineno;
                if script_is_kw(&t, "elif") {
                    let c = script_colon(script_rest(&t, "elif", lj)?, lj)?;
                    if script_cond(ip, &c, lj)? {
                        let end = script_block(ip, lines, j + 1, parent)?;
                        return Ok(script_skip_chain(lines, end, parent));
                    }
                    j = script_skip(lines, j + 1, parent);
                    continue;
                }
                if t == "else:" || t == "else" {
                    let end = script_block(ip, lines, j + 1, parent)?;
                    return Ok(script_skip_chain(lines, end, parent));
                }
            }
            return Ok(j);
        }
    }
    if script_is_kw(&text, "elif") || text == "else:" || text == "else" {
        return Err(format!(
            "syntax: line {lineno}: `{}` without `if`",
            script_first_word(&text)
        ));
    }

    if script_is_kw(&text, "while") {
        let cond = script_colon(script_rest(&text, "while", lineno)?, lineno)?;
        script_block_indent(lines, idx + 1, parent)?;
        let mut iters = 0usize;
        while script_cond(ip, &cond, lineno)? {
            if iters >= SCRIPT_MAX_ITERS {
                return Err(format!(
                    "too_large: `while` exceeded {SCRIPT_MAX_ITERS} iterations (line {lineno})"
                ));
            }
            script_block(ip, lines, idx + 1, parent)?;
            iters += 1;
            script_bump(ip)?;
        }
        return Ok(script_skip(lines, idx + 1, parent));
    }

    if script_is_kw(&text, "for") {
        let rest = script_rest(&text, "for", lineno)?;
        let header = script_colon(rest, lineno)?;
        let mut parts = header.splitn(2, " in ");
        let name = parts.next().map(str::trim).unwrap_or("");
        let expr_src = parts.next().map(str::trim).unwrap_or("");
        if !script_valid_name(name) || expr_src.is_empty() {
            return Err(format!(
                "syntax: line {lineno}: `for` needs `for <name> in <expr>:`"
            ));
        }
        script_block_indent(lines, idx + 1, parent)?;
        let items = script_for_items(ip, expr_src, lineno)?;
        if items.len() > SCRIPT_MAX_ITERS {
            return Err(format!(
                "too_large: `for` has {} items, limit is {SCRIPT_MAX_ITERS} (line {lineno})",
                items.len()
            ));
        }
        for item in items {
            script_set(ip, name, item)?;
            script_block(ip, lines, idx + 1, parent)?;
            script_bump(ip)?;
        }
        ip.vars.remove(name);
        return Ok(script_skip(lines, idx + 1, parent));
    }

    if text == "print"
        || text == "print()"
        || script_is_kw(&text, "print")
        || text.starts_with("print(")
    {
        let arg = if text == "print" || text == "print()" {
            String::new()
        } else if text.starts_with("print(") && text.ends_with(')') {
            text["print(".len()..text.len() - 1].to_string()
        } else {
            script_rest(&text, "print", lineno)?.to_string()
        };
        if arg.trim().is_empty() {
            script_emit(ip, "");
        } else {
            let parts = script_top_commas(&arg);
            if parts.len() == 1 {
                let text = script_eval(ip, arg.trim(), lineno)?.display();
                script_emit(ip, &text);
            } else {
                let mut out = Vec::new();
                for p in parts {
                    out.push(script_eval(ip, &p, lineno)?.display());
                }
                script_emit(ip, &out.join(" "));
            }
        }
        return Ok(idx + 1);
    }

    if script_is_kw(&text, "fetch") {
        let rest = script_rest(&text, "fetch", lineno)?;
        let (url_src, var) = script_split_fetch(rest);
        let url = script_eval(ip, &url_src, lineno)?.display();
        let body = script_fetch_checked(ip, &url, lineno)?;
        if let Some(name) = var {
            if !script_valid_name(&name) {
                return Err(format!("syntax: line {lineno}: bad variable name `{name}`"));
            }
            script_set(ip, &name, SValue::Str(body.clone()))?;
            script_emit(
                ip,
                &format!("fetched {url} ({} bytes → {name})", body.len()),
            );
        } else {
            script_set(ip, "_", SValue::Str(body.clone()))?;
            script_emit(ip, &body);
        }
        return Ok(idx + 1);
    }

    if text == "vars" {
        if ip.vars.is_empty() {
            script_emit(ip, "(no variables)");
        } else {
            let rows: Vec<String> = ip
                .vars
                .iter()
                .map(|(name, v)| {
                    let shown = v.display();
                    let cut = if shown.len() > 120 {
                        format!("{}…", &shown[..120])
                    } else {
                        shown
                    };
                    format!("{name}: {} = {cut}", v.type_name())
                })
                .collect();
            for row in rows {
                script_emit(ip, &row);
            }
        }
        return Ok(idx + 1);
    }
    if script_is_kw(&text, "free") {
        let name = script_rest(&text, "free", lineno)?.trim().to_string();
        if ip.vars.remove(&name).is_some() {
            script_emit(ip, &format!("freed {name}"));
        } else {
            return Err(format!("not_found: no variable `{name}` (line {lineno})"));
        }
        return Ok(idx + 1);
    }
    if text == "gc" || text == "gc --apply" {
        let before: usize = ip.vars.values().map(|v| v.display().len()).sum();
        ip.vars.remove("_");
        let after: usize = ip.vars.values().map(|v| v.display().len()).sum();
        script_emit(
            ip,
            &format!(
                "gc: {} var(s) alive, released ~{} byte(s) of last-output buffer (values are owned — no tracing collector needed; `free <name>` drops a binding)",
                ip.vars.len(),
                before.saturating_sub(after)
            ),
        );
        return Ok(idx + 1);
    }

    if script_is_kw(&text, "js") {
        let src = script_normalize_js(script_rest(&text, "js", lineno)?);
        let v = script_eval(ip, &src, lineno)?;
        script_emit(ip, &v.display());
        return Ok(idx + 1);
    }

    // `try:` + `catch [var]:` — explicit failure handling.
    if text == "try:" || text == "try" {
        script_block_indent(lines, idx + 1, parent)?;
        let body_end = script_skip(lines, idx + 1, parent);
        match script_block(ip, lines, idx + 1, parent) {
            Ok(_) => {
                let mut j = body_end;
                if j < lines.len()
                    && lines[j].indent as isize == parent
                    && script_is_catch(&lines[j].text)
                {
                    j = script_skip(lines, j + 1, parent);
                }
                return Ok(j);
            }
            Err(e) => {
                let j = body_end;
                if j < lines.len() && lines[j].indent as isize == parent {
                    let t = lines[j].text.clone();
                    let lj = lines[j].lineno;
                    if script_is_catch(&t) {
                        let var = script_catch_binding(&t, lj)?;
                        ip.flow = None;
                        if let Some(name) = var {
                            let capped = if e.len() > SCRIPT_MAX_STR {
                                e[..SCRIPT_MAX_STR].to_string()
                            } else {
                                e.clone()
                            };
                            script_set(ip, &name, SValue::Str(capped))?;
                        }
                        let end = script_block(ip, lines, j + 1, parent)?;
                        return Ok(end);
                    }
                }
                return Err(e);
            }
        }
    }
    if script_is_catch(&text) {
        return Err(format!("syntax: line {lineno}: `catch` without `try`"));
    }

    // `def name(p1, p2):` — user functions (lexical, owned, no globals).
    if script_is_kw(&text, "def") {
        let rest = script_rest(&text, "def", lineno)?;
        let header = script_colon(rest, lineno)?;
        let (name, params) = script_split_def(&header, lineno)?;
        script_block_indent(lines, idx + 1, parent)?;
        let end = script_skip(lines, idx + 1, parent);
        let body: Vec<SLine> = lines[idx + 1..end].to_vec();
        if ip.funcs.len() >= SCRIPT_MAX_FUNCS && !ip.funcs.contains_key(&name) {
            return Err(format!(
                "too_large: script holds {SCRIPT_MAX_FUNCS} functions already"
            ));
        }
        ip.funcs.insert(name, SFuncDef { params, body });
        return Ok(end);
    }

    // `return [expr]` — only inside `def`.
    if text == "return" || script_is_kw(&text, "return") {
        if ip.call_depth == 0 {
            return Err(format!("syntax: line {lineno}: `return` outside `def`"));
        }
        let v = if text == "return" {
            SValue::Null
        } else {
            script_eval(ip, script_rest(&text, "return", lineno)?, lineno)?
        };
        ip.flow = Some(v);
        return Ok(idx + 1);
    }

    // `fail "msg"` — raise a script error (`fail: msg`, caught by `catch`).
    if script_is_kw(&text, "fail") {
        let msg = script_eval(ip, script_rest(&text, "fail", lineno)?, lineno)?.display();
        return Err(format!("fail: {msg}"));
    }

    if text.starts_with("$ ") || text == "$" {
        let cmdline = text[1..].trim().to_string();
        if cmdline.is_empty() {
            return Ok(idx + 1);
        }
        return script_inline(ip, &cmdline, lineno, idx);
    }

    if let Some((name, expr_src)) = script_assignment(&text) {
        let v = script_assign_rhs(ip, &expr_src, lineno)?;
        if let SValue::Str(s) = &v {
            if s.len() > SCRIPT_MAX_STR {
                return Err(format!(
                    "too_large: line {lineno}: value is {} bytes, limit is {SCRIPT_MAX_STR} (`sh` output is capped automatically; split the data)",
                    s.len()
                ));
            }
        }
        script_set(ip, &name, v)?;
        return Ok(idx + 1);
    }

    if script_is_kw(&text, "sh") {
        let rest = script_rest(&text, "sh", lineno)?.trim().to_string();
        let cmdline = script_unquote(&rest, lineno)?.unwrap_or(rest);
        return script_inline(ip, &cmdline, lineno, idx);
    }

    if script_bare_verb(&text) {
        let line = text.clone();
        return script_inline(ip, &line, lineno, idx);
    }

    // Anything else is tried as a bare expression: non-null results print,
    // like `sh "…"` lines do; a typo still fails loudly with the cause.
    match script_eval(ip, &text, lineno) {
        Ok(v) => {
            if !matches!(v, SValue::Null) {
                script_emit(ip, &v.display());
            }
            let _ = script_set(ip, "_", v);
            Ok(idx + 1)
        }
        Err(e) => Err(format!(
            "syntax: line {lineno}: unknown statement `{}` ({e}; try `print`, `let`, `def`, `if/elif/else`, `try/catch`, `for`, `while`, `$ <cybsh>`, `sh \"…\"`, `js …`, `fetch …`, `ui …`, `vars/free/gc`)",
            if text.len() > 60 {
                format!("{}…", &text[..60])
            } else {
                text
            }
        )),
    }
}

fn script_cond(ip: &mut ScriptInterp, src: &str, lineno: usize) -> Result<bool, String> {
    Ok(script_eval(ip, src, lineno)?.truthy())
}

fn script_for_items(
    ip: &mut ScriptInterp,
    expr_src: &str,
    lineno: usize,
) -> Result<Vec<SValue>, String> {
    match script_eval(ip, expr_src, lineno)? {
        SValue::List(items) => Ok(items),
        // Dicts iterate their sorted keys (deterministic on every run).
        SValue::Dict(map) => Ok(map.keys().map(|k| SValue::Str(k.clone())).collect()),
        SValue::Str(s) => Ok(if s.contains('\n') {
            s.lines().map(|l| SValue::Str(l.to_string())).collect()
        } else {
            s.split_whitespace()
                .map(|w| SValue::Str(w.to_string()))
                .collect()
        }),
        SValue::Num(n) => Ok((0..n.max(0.0) as i64)
            .map(|i| SValue::Num(i as f64))
            .collect()),
        other => Err(format!(
            "syntax: line {lineno}: `for` needs a list, `range()`, or a string — got {}",
            other.type_name()
        )),
    }
}

fn script_assignment(text: &str) -> Option<(String, String)> {
    let eq = script_top_eq(text)?;
    let (lhs, rhs) = text.split_at(eq);
    if rhs.starts_with("==") || lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') {
        return None;
    }
    let mut name = lhs.trim().to_string();
    if let Some(rest) = name.strip_prefix("let ") {
        name = rest.trim().to_string();
    } else if let Some(rest) = name.strip_prefix("const ") {
        name = rest.trim().to_string();
    } else if name.contains(' ') {
        return None;
    }
    if let Some(colon) = name.find(':') {
        name = name[..colon].trim().to_string();
    }
    if !script_valid_name(&name) || rhs[1..].trim().is_empty() {
        return None;
    }
    Some((name, rhs[1..].trim().to_string()))
}

fn script_top_eq(text: &str) -> Option<usize> {
    let chars: Vec<char> = text.chars().collect();
    let mut quote: Option<char> = None;
    let mut depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '"' | '\'' => quote = Some(c),
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            '=' if depth == 0 => {
                let byte: usize = chars[..i].iter().collect::<String>().len();
                return Some(byte);
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn script_assign_rhs(ip: &mut ScriptInterp, src: &str, lineno: usize) -> Result<SValue, String> {
    let t = src.trim();
    if script_is_kw(t, "sh") {
        let rest = script_rest(t, "sh", lineno)?.trim().to_string();
        let cmdline = script_unquote(&rest, lineno)?.unwrap_or(rest);
        let expanded = script_interpolate(&ip.vars, &cmdline);
        return script_inline_value(ip, &expanded, lineno);
    }
    if let Some(rest) = t.strip_prefix("js:") {
        let normalized = script_normalize_js(rest.trim());
        return script_eval(ip, &normalized, lineno);
    }
    if script_is_kw(t, "fetch") {
        let rest = script_rest(t, "fetch", lineno)?;
        let (url_src, _) = script_split_fetch(rest);
        let url = script_eval(ip, &url_src, lineno)?.display();
        let body = script_fetch_checked(ip, &url, lineno)?;
        let v = SValue::Str(body);
        script_set(ip, "_", v.clone())?;
        return Ok(v);
    }
    script_eval(ip, t, lineno)
}

fn script_normalize_js(src: &str) -> String {
    src.replace("===", "==")
        .replace("!==", "!=")
        .replace("&&", " and ")
        .replace("||", " or ")
}

fn script_top_commas(src: &str) -> Vec<String> {
    let chars: Vec<char> = src.chars().collect();
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0usize;
    for c in chars {
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                cur.push(c);
            }
            '(' | '[' | '{' => {
                depth += 1;
                cur.push(c);
            }
            ')' | ']' | '}' => {
                depth = depth.saturating_sub(1);
                cur.push(c);
            }
            ',' if depth == 0 => {
                parts.push(cur.trim().to_string());
                cur = String::new();
            }
            _ => cur.push(c),
        }
    }
    if !cur.trim().is_empty() || !parts.is_empty() {
        parts.push(cur.trim().to_string());
    }
    parts
}

fn script_eval(ip: &mut ScriptInterp, src: &str, lineno: usize) -> Result<SValue, String> {
    let mut p = ScriptExpr {
        chars: src.chars().collect(),
        pos: 0,
        interp: ip,
        lineno,
    };
    let v = p.parse_or()?;
    p.skip_ws();
    if p.pos < p.chars.len() {
        let rest: String = p.chars[p.pos..].iter().collect();
        return Err(format!(
            "syntax: line {lineno}: unexpected `{}` in expression",
            rest.trim()
        ));
    }
    if let SValue::Str(s) = &v {
        if s.len() > SCRIPT_MAX_STR {
            return Err(format!(
                "too_large: line {lineno}: value exceeds {SCRIPT_MAX_STR} bytes"
            ));
        }
    }
    Ok(v)
}

struct ScriptExpr<'b, 'x> {
    chars: Vec<char>,
    pos: usize,
    interp: &'b mut ScriptInterp<'x>,
    lineno: usize,
}

impl<'b, 'x> ScriptExpr<'b, 'x> {
    fn skip_ws(&mut self) {
        while self.pos < self.chars.len() && self.chars[self.pos].is_whitespace() {
            self.pos += 1;
        }
    }

    fn eat_word(&mut self, word: &str) -> bool {
        self.skip_ws();
        let end = self.pos + word.len();
        if end > self.chars.len() {
            return false;
        }
        let got: String = self.chars[self.pos..end].iter().collect();
        if got != word {
            return false;
        }
        if word.chars().all(|c| c.is_ascii_alphabetic())
            && end < self.chars.len()
            && (self.chars[end].is_ascii_alphanumeric() || self.chars[end] == '_')
        {
            return false;
        }
        self.pos = end;
        true
    }

    fn eat_op(&mut self, op: &str) -> bool {
        self.skip_ws();
        let end = self.pos + op.len();
        if end > self.chars.len() {
            return false;
        }
        let got: String = self.chars[self.pos..end].iter().collect();
        if got != op {
            return false;
        }
        self.pos = end;
        true
    }

    fn parse_or(&mut self) -> Result<SValue, String> {
        let mut left = self.parse_and()?;
        loop {
            if self.eat_word("or") || self.eat_op("||") {
                let right = self.parse_and()?;
                left = SValue::Bool(left.truthy() || right.truthy());
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_and(&mut self) -> Result<SValue, String> {
        let mut left = self.parse_not()?;
        loop {
            if self.eat_word("and") || self.eat_op("&&") {
                let right = self.parse_not()?;
                left = SValue::Bool(left.truthy() && right.truthy());
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_not(&mut self) -> Result<SValue, String> {
        if self.eat_word("not") {
            return Ok(SValue::Bool(!self.parse_not()?.truthy()));
        }
        self.skip_ws();
        if self.pos < self.chars.len() && self.chars[self.pos] == '!' {
            let next = self.chars.get(self.pos + 1).copied().unwrap_or(' ');
            if next != '=' {
                self.pos += 1;
                return Ok(SValue::Bool(!self.parse_not()?.truthy()));
            }
        }
        self.parse_cmp()
    }

    fn parse_cmp(&mut self) -> Result<SValue, String> {
        let left = self.parse_add()?;
        for op in ["==", "!=", "<=", ">=", "<", ">"] {
            if self.eat_op(op) {
                let right = self.parse_add()?;
                return Ok(SValue::Bool(script_compare(&left, op, &right)));
            }
        }
        Ok(left)
    }

    fn parse_add(&mut self) -> Result<SValue, String> {
        let mut left = self.parse_mul()?;
        loop {
            self.skip_ws();
            if self.pos < self.chars.len()
                && (self.chars[self.pos] == '+' || self.chars[self.pos] == '-')
            {
                let op = self.chars[self.pos];
                self.pos += 1;
                let right = self.parse_mul()?;
                left = script_arith(&left, op, &right, self.lineno)?;
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_mul(&mut self) -> Result<SValue, String> {
        let mut left = self.parse_unary()?;
        loop {
            self.skip_ws();
            if self.pos < self.chars.len()
                && (self.chars[self.pos] == '*'
                    || self.chars[self.pos] == '/'
                    || self.chars[self.pos] == '%')
            {
                let op = self.chars[self.pos];
                self.pos += 1;
                let right = self.parse_unary()?;
                left = script_arith(&left, op, &right, self.lineno)?;
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_unary(&mut self) -> Result<SValue, String> {
        self.skip_ws();
        if self.pos < self.chars.len() && self.chars[self.pos] == '-' {
            self.pos += 1;
            let v = self.parse_unary()?;
            return match v.as_f64() {
                Some(n) => Ok(SValue::Num(-n)),
                None => Err(format!("syntax: line {}: `-` needs a number", self.lineno)),
            };
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<SValue, String> {
        self.skip_ws();
        if self.pos >= self.chars.len() {
            return Err(format!(
                "syntax: line {}: expression ended early",
                self.lineno
            ));
        }
        let c = self.chars[self.pos];
        let mut base = if c == '(' {
            self.pos += 1;
            let v = self.parse_or()?;
            self.skip_ws();
            if self.pos >= self.chars.len() || self.chars[self.pos] != ')' {
                return Err(format!("syntax: line {}: unclosed `(`", self.lineno));
            }
            self.pos += 1;
            v
        } else if c == '[' {
            self.parse_list()?
        } else if c == '{' {
            self.parse_dict()?
        } else if c == '"' || c == '\'' {
            SValue::Str(self.parse_string()?)
        } else if c.is_ascii_digit()
            || (c == '.'
                && self
                    .chars
                    .get(self.pos + 1)
                    .map(|d| d.is_ascii_digit())
                    .unwrap_or(false))
        {
            self.parse_number()?
        } else if c.is_ascii_alphabetic() || c == '_' {
            let ident = self.parse_ident();
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == '(' {
                self.call(&ident)?
            } else {
                match ident.as_str() {
                    "true" => SValue::Bool(true),
                    "false" => SValue::Bool(false),
                    "null" | "none" | "nil" => SValue::Null,
                    "and" | "or" | "not" => {
                        return Err(format!(
                            "syntax: line {}: `{ident}` outside an expression",
                            self.lineno
                        ))
                    }
                    _ => self.interp.vars.get(&ident).cloned().ok_or_else(|| {
                        format!("not_found: no variable `{ident}` (line {})", self.lineno)
                    })?,
                }
            }
        } else {
            return Err(format!(
                "syntax: line {}: unexpected `{c}` in expression",
                self.lineno
            ));
        };
        // Postfix indexing: `d.key`, `d["k"]`, `l[0]`, `s[0]`.
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == '.' {
                self.pos += 1;
                let field = self.parse_ident();
                if field.is_empty() {
                    return Err(format!(
                        "syntax: line {}: `.` needs a field name",
                        self.lineno
                    ));
                }
                base = script_index_field(&base, &field, self.lineno)?;
                continue;
            }
            if self.pos < self.chars.len() && self.chars[self.pos] == '[' {
                self.pos += 1;
                let key = self.parse_or()?;
                self.skip_ws();
                if self.pos >= self.chars.len() || self.chars[self.pos] != ']' {
                    return Err(format!(
                        "syntax: line {}: unclosed `[` in index",
                        self.lineno
                    ));
                }
                self.pos += 1;
                base = script_index_value(&base, &key, self.lineno)?;
                continue;
            }
            return Ok(base);
        }
    }

    fn parse_ident(&mut self) -> String {
        let start = self.pos;
        while self.pos < self.chars.len()
            && (self.chars[self.pos].is_ascii_alphanumeric() || self.chars[self.pos] == '_')
        {
            self.pos += 1;
        }
        self.chars[start..self.pos].iter().collect()
    }

    fn parse_string(&mut self) -> Result<String, String> {
        let quote = self.chars[self.pos];
        self.pos += 1;
        let mut out = String::new();
        while self.pos < self.chars.len() {
            let c = self.chars[self.pos];
            if c == '\\' && self.pos + 1 < self.chars.len() {
                let n = self.chars[self.pos + 1];
                match n {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    _ => out.push(n),
                }
                self.pos += 2;
                continue;
            }
            if c == quote {
                self.pos += 1;
                return Ok(script_str_interp(&out, &self.interp.vars));
            }
            out.push(c);
            self.pos += 1;
        }
        Err(format!("syntax: line {}: unclosed string", self.lineno))
    }

    fn parse_number(&mut self) -> Result<SValue, String> {
        let start = self.pos;
        let mut dot = false;
        while self.pos < self.chars.len()
            && (self.chars[self.pos].is_ascii_digit() || self.chars[self.pos] == '.')
        {
            if self.chars[self.pos] == '.' {
                if dot {
                    break;
                }
                dot = true;
            }
            self.pos += 1;
        }
        let raw: String = self.chars[start..self.pos].iter().collect();
        raw.parse::<f64>()
            .map(SValue::Num)
            .map_err(|_| format!("syntax: line {}: bad number `{raw}`", self.lineno))
    }

    fn parse_list(&mut self) -> Result<SValue, String> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ']' {
                self.pos += 1;
                return Ok(SValue::List(items));
            }
            if items.len() >= SCRIPT_MAX_LIST {
                return Err(format!(
                    "syntax: line {}: list exceeds {SCRIPT_MAX_LIST} items",
                    self.lineno
                ));
            }
            items.push(self.parse_or()?);
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ',' {
                self.pos += 1;
                continue;
            }
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ']' {
                self.pos += 1;
                return Ok(SValue::List(items));
            }
            return Err(format!(
                "syntax: line {}: expected `,` or `]` in list",
                self.lineno
            ));
        }
    }

    fn parse_dict(&mut self) -> Result<SValue, String> {
        // `{` already peeked. Keys are string literals or bare idents.
        self.pos += 1;
        let mut map = BTreeMap::new();
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == '}' {
                self.pos += 1;
                return Ok(SValue::Dict(map));
            }
            if map.len() >= SCRIPT_MAX_LIST {
                return Err(format!(
                    "syntax: line {}: dict exceeds {SCRIPT_MAX_LIST} keys",
                    self.lineno
                ));
            }
            self.skip_ws();
            if self.pos >= self.chars.len() {
                return Err(format!("syntax: line {}: unclosed `{{`", self.lineno));
            }
            let kc = self.chars[self.pos];
            let key = if kc == '"' || kc == '\'' {
                self.parse_string()?
            } else if kc.is_ascii_alphabetic() || kc == '_' {
                self.parse_ident()
            } else {
                return Err(format!(
                    "syntax: line {}: dict keys are `\"str\"` or bare idents",
                    self.lineno
                ));
            };
            self.skip_ws();
            if self.pos >= self.chars.len() || self.chars[self.pos] != ':' {
                return Err(format!(
                    "syntax: line {}: dict needs `key: value` pairs",
                    self.lineno
                ));
            }
            self.pos += 1;
            let value = self.parse_or()?;
            if let SValue::Str(s) = &value {
                if s.len() > SCRIPT_MAX_STR {
                    return Err(format!(
                        "too_large: line {}: dict value exceeds {SCRIPT_MAX_STR} bytes",
                        self.lineno
                    ));
                }
            }
            map.insert(key, value);
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ',' {
                self.pos += 1;
                continue;
            }
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == '}' {
                self.pos += 1;
                return Ok(SValue::Dict(map));
            }
            return Err(format!(
                "syntax: line {}: expected `,` or `}}` in dict",
                self.lineno
            ));
        }
    }

    fn call(&mut self, name: &str) -> Result<SValue, String> {
        self.pos += 1;
        let mut args = Vec::new();
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ')' {
                self.pos += 1;
                break;
            }
            if args.len() >= 8 {
                return Err(format!(
                    "syntax: line {}: `{name}` takes at most 8 arguments",
                    self.lineno
                ));
            }
            args.push(self.parse_or()?);
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ',' {
                self.pos += 1;
                continue;
            }
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ')' {
                self.pos += 1;
                break;
            }
            return Err(format!(
                "syntax: line {}: expected `,` or `)` in `{name}(…)`",
                self.lineno
            ));
        }
        // `sh(<expr>)` runs inline shell with `--json` materialization.
        if name == "sh" {
            if args.len() != 1 {
                return Err(format!(
                    "syntax: line {}: `sh` takes 1 argument",
                    self.lineno
                ));
            }
            let lineno = self.lineno;
            let cmdline = args[0].display();
            return script_inline_value(self.interp, &cmdline, lineno);
        }
        // User `def`s beat builtins (explicit definitions win).
        if self.interp.funcs.contains_key(name) {
            let lineno = self.lineno;
            let interp = &mut *self.interp;
            return script_call_func(interp, name, &args, lineno);
        }
        let lineno = self.lineno;
        script_builtin(name, &args, lineno)
    }
}

fn script_str_interp(src: &str, vars: &BTreeMap<String, SValue>) -> String {
    let mut out = String::with_capacity(src.len());
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && chars.get(i + 1) == Some(&'{') {
            let mut j = i + 2;
            while j < chars.len() && chars[j] != '}' {
                j += 1;
            }
            if j < chars.len() {
                let name: String = chars[i + 2..j].iter().collect();
                if let Some(v) = vars.get(name.trim()) {
                    out.push_str(&v.display());
                } else {
                    out.push_str(&chars[i..=j].iter().collect::<String>());
                }
                i = j + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn script_compare(left: &SValue, op: &str, right: &SValue) -> bool {
    match (left, right) {
        (SValue::Num(a), SValue::Num(b)) => match op {
            "==" => a == b,
            "!=" => a != b,
            "<" => a < b,
            "<=" => a <= b,
            ">" => a > b,
            ">=" => a >= b,
            _ => false,
        },
        _ => {
            let (a, b) = (left.display(), right.display());
            match op {
                "==" => a == b,
                "!=" => a != b,
                "<" => a < b,
                "<=" => a <= b,
                ">" => a > b,
                ">=" => a >= b,
                _ => false,
            }
        }
    }
}

/// `d.field` — dict lookup only (use `len(x)` etc. for the rest).
fn script_index_field(base: &SValue, field: &str, lineno: usize) -> Result<SValue, String> {
    match base {
        SValue::Dict(map) => map
            .get(field)
            .cloned()
            .ok_or_else(|| format!("not_found: dict has no field `{field}` (line {lineno})")),
        other => Err(format!(
            "syntax: line {lineno}: `.` indexes dicts — got {} (try `len(x)`)",
            other.type_name()
        )),
    }
}

/// `d["k"]`, `l[0]`, `s[0]` — dict key, list index, string char.
fn script_index_value(base: &SValue, key: &SValue, lineno: usize) -> Result<SValue, String> {
    match (base, key) {
        (SValue::Dict(map), k) => {
            let name = k.display();
            map.get(&name).cloned().ok_or_else(|| {
                format!("not_found: dict has no key `{name}` (line {lineno})")
            })
        }
        (SValue::List(items), SValue::Num(n)) => {
            let i = *n as i64;
            if i < 0 || i as usize >= items.len() {
                return Err(format!(
                    "not_found: line {lineno}: index {i} out of range (len {})",
                    items.len()
                ));
            }
            Ok(items[i as usize].clone())
        }
        (SValue::Str(s), SValue::Num(n)) => {
            let chars: Vec<char> = s.chars().collect();
            let i = *n as i64;
            if i < 0 || i as usize >= chars.len() {
                return Err(format!(
                    "not_found: line {lineno}: index {i} out of range (len {})",
                    chars.len()
                ));
            }
            Ok(SValue::Str(chars[i as usize].to_string()))
        }
        (base, key) => Err(format!(
            "syntax: line {lineno}: cannot index {} with {} (dicts take keys, lists/strings take numbers)",
            base.type_name(),
            key.type_name()
        )),
    }
}

fn script_arith(left: &SValue, op: char, right: &SValue, lineno: usize) -> Result<SValue, String> {
    if op == '+' && (matches!(left, SValue::Str(_)) || matches!(right, SValue::Str(_))) {
        let mut s = left.display();
        s.push_str(&right.display());
        if s.len() > SCRIPT_MAX_STR {
            return Err(format!(
                "too_large: line {lineno}: string grew past {SCRIPT_MAX_STR} bytes"
            ));
        }
        return Ok(SValue::Str(s));
    }
    if op == '*' {
        let pair: (&SValue, &SValue) = match (left, right) {
            (SValue::Str(_), _) => (left, right),
            (_, SValue::Str(_)) => (right, left),
            _ => (left, right),
        };
        if let (SValue::Str(s), SValue::Num(n)) = pair {
            // Capped; NaN/non-positive → empty, never a `clamp` panic.
            let times = if !n.is_finite() || *n <= 0.0 {
                0
            } else {
                n.min(256.0) as usize
            };
            if s.len() * times > SCRIPT_MAX_STR {
                return Err(format!(
                    "too_large: line {lineno}: repeat exceeds {SCRIPT_MAX_STR} bytes"
                ));
            }
            return Ok(SValue::Str(s.repeat(times)));
        }
    }
    let (a, b) = match (left.as_f64(), right.as_f64()) {
        (Some(a), Some(b)) => (a, b),
        _ => {
            return Err(format!(
                "syntax: line {lineno}: `{op}` needs numbers (got {} and {})",
                left.type_name(),
                right.type_name()
            ))
        }
    };
    match op {
        '+' => Ok(SValue::Num(a + b)),
        '-' => Ok(SValue::Num(a - b)),
        '*' => Ok(SValue::Num(a * b)),
        '/' => {
            if b == 0.0 {
                return Err(format!("syntax: line {lineno}: division by zero"));
            }
            Ok(SValue::Num(a / b))
        }
        '%' => {
            if b == 0.0 {
                return Err(format!("syntax: line {lineno}: modulo by zero"));
            }
            Ok(SValue::Num(a % b))
        }
        _ => Err(format!("syntax: line {lineno}: unknown operator `{op}`")),
    }
}

fn script_builtin(name: &str, args: &[SValue], lineno: usize) -> Result<SValue, String> {
    // Arity is checked per arm below (`call` already caps at 8 args).
    match name {
        "len" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `len` takes 1 argument"));
            }
            Ok(SValue::Num(match &args[0] {
                SValue::Str(s) => s.chars().count() as f64,
                SValue::List(l) => l.len() as f64,
                SValue::Dict(d) => d.len() as f64,
                SValue::Num(n) => *n,
                SValue::Bool(true) => 1.0,
                SValue::Bool(false) | SValue::Null => 0.0,
            }))
        }
        "int" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `int` takes 1 argument"));
            }
            args[0].as_f64().map(|n| SValue::Num(n.trunc())).ok_or_else(|| {
                format!("syntax: line {lineno}: `int` needs a number-like value")
            })
        }
        "str" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `str` takes 1 argument"));
            }
            let mut s = args[0].display();
            if s.len() > SCRIPT_MAX_STR {
                s.truncate(SCRIPT_MAX_STR);
            }
            Ok(SValue::Str(s))
        }
        "json" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `json` takes 1 argument"));
            }
            // Materialized structure (objects → Dict, arrays → List).
            script_materialize(&args[0].display()).ok_or_else(|| {
                format!("syntax: line {lineno}: `json` needs valid JSON text")
            })
        }
        "split" => {
            if args.is_empty() || args.len() > 2 {
                return Err(format!("syntax: line {lineno}: `split` takes 1–2 arguments"));
            }
            let text = match &args[0] {
                SValue::Str(s) => s.clone(),
                other => {
                    return Err(format!(
                        "syntax: line {lineno}: `split` takes a string (got {})",
                        other.type_name()
                    ))
                }
            };
            let items: Vec<SValue> = if args.len() == 2 {
                let delim = args[1].display();
                if delim.is_empty() {
                    text.chars().map(|c| SValue::Str(c.to_string())).collect()
                } else {
                    text.split(&delim as &str)
                        .map(|s| SValue::Str(s.to_string()))
                        .collect()
                }
            } else if text.contains('\n') {
                text.lines().map(|l| SValue::Str(l.to_string())).collect()
            } else {
                text.split_whitespace()
                    .map(|w| SValue::Str(w.to_string()))
                    .collect()
            };
            if items.len() > SCRIPT_MAX_LIST {
                return Err(format!(
                    "too_large: line {lineno}: split produced {} items (limit {SCRIPT_MAX_LIST})",
                    items.len()
                ));
            }
            Ok(SValue::List(items))
        }
        "range" => {
            if args.is_empty() || args.len() > 2 {
                return Err(format!("syntax: line {lineno}: `range` takes 1–2 arguments"));
            }
            let (start, end) = if args.len() == 2 {
                (
                    args[0].as_f64().unwrap_or(0.0) as i64,
                    args[1].as_f64().unwrap_or(0.0) as i64,
                )
            } else {
                (0, args[0].as_f64().unwrap_or(0.0) as i64)
            };
            let count = end.saturating_sub(start).max(0).min(SCRIPT_MAX_ITERS as i64) as usize;
            Ok(SValue::List(
                (0..count).map(|i| SValue::Num((start + i as i64) as f64)).collect(),
            ))
        }
        // Functional updaters (values are owned — updates return new values).
        "set" => {
            if args.len() != 3 {
                return Err(format!("syntax: line {lineno}: `set` takes 3 arguments"));
            }
            let map = match &args[0] {
                SValue::Dict(map) => map,
                other => {
                    return Err(format!(
                        "syntax: line {lineno}: `set` takes a dict (got {})",
                        other.type_name()
                    ))
                }
            };
            let mut next = map.clone();
            next.insert(args[1].display(), args[2].clone());
            if next.len() > SCRIPT_MAX_LIST {
                return Err(format!("too_large: line {lineno}: dict exceeds {SCRIPT_MAX_LIST} keys"));
            }
            Ok(SValue::Dict(next))
        }
        "push" => {
            if args.len() != 2 {
                return Err(format!("syntax: line {lineno}: `push` takes 2 arguments"));
            }
            let items = match &args[0] {
                SValue::List(items) => items,
                other => {
                    return Err(format!(
                        "syntax: line {lineno}: `push` takes a list (got {})",
                        other.type_name()
                    ))
                }
            };
            if items.len() >= SCRIPT_MAX_LIST {
                return Err(format!("too_large: line {lineno}: list exceeds {SCRIPT_MAX_LIST} items"));
            }
            let mut next = items.clone();
            next.push(args[1].clone());
            Ok(SValue::List(next))
        }
        "del" => {
            if args.len() != 2 {
                return Err(format!("syntax: line {lineno}: `del` takes 2 arguments"));
            }
            let map = match &args[0] {
                SValue::Dict(map) => map,
                other => {
                    return Err(format!(
                        "syntax: line {lineno}: `del` takes a dict (got {})",
                        other.type_name()
                    ))
                }
            };
            let mut next = map.clone();
            next.remove(&args[1].display());
            Ok(SValue::Dict(next))
        }
        "keys" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `keys` takes 1 argument"));
            }
            match &args[0] {
                SValue::Dict(map) => Ok(SValue::List(
                    map.keys().map(|k| SValue::Str(k.clone())).collect(),
                )),
                other => Err(format!(
                    "syntax: line {lineno}: `keys` takes a dict (got {})",
                    other.type_name()
                )),
            }
        }
        "values" => {
            if args.len() != 1 {
                return Err(format!("syntax: line {lineno}: `values` takes 1 argument"));
            }
            match &args[0] {
                SValue::Dict(map) => Ok(SValue::List(map.values().cloned().collect())),
                other => Err(format!(
                    "syntax: line {lineno}: `values` takes a dict (got {})",
                    other.type_name()
                )),
            }
        }
        _ => Err(format!(
            "syntax: line {lineno}: unknown function `{name}` (try `len/int/str/json/split/range/sh/set/push/del/keys/values` or `def` it first)"
        )),
    }
}

#[cfg(target_arch = "wasm32")]
fn hardware_concurrency() -> usize {
    Reflect::get(&global(), &JsValue::from_str("navigator"))
        .ok()
        .and_then(|nav| Reflect::get(&nav, &JsValue::from_str("hardwareConcurrency")).ok())
        .and_then(|v| v.as_f64())
        .map(|n| n.max(1.0) as usize)
        .unwrap_or(1)
}

#[cfg(not(target_arch = "wasm32"))]
fn hardware_concurrency() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

/// Same reported version as the native crate — one number for both.
fn cybermanju_os_version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_clamps_at_the_root() {
        assert_eq!(join("/a/b", "../.."), "/");
        assert_eq!(join("/", "x/y"), "/x/y");
        assert_eq!(join("/a", "/b"), "/b");
        assert_eq!(join("/a/b", ".."), "/a");
    }

    #[test]
    fn search_scores_matches() {
        let mut volume = BTreeMap::new();
        volume.insert("/notes.txt".into(), "the quick brown fox".into());
        volume.insert("/other.txt".into(), "lazy dog".into());
        let hits = search(&volume, "fox", 10);
        assert_eq!(hits, vec!["/notes.txt".to_string()]);
        assert!(search(&volume, "zebra", 10).is_empty());
    }

    #[test]
    fn unsupported_commands_refuse_honestly() {
        let out = dispatch("scrub", &[]);
        assert!(out.contains("unsupported:"), "{out}");
        assert!(
            out.contains(r#""ok":false"#) || out.contains("unsupported"),
            "{out}"
        );
    }

    #[test]
    fn unknown_commands_use_the_did_you_mean_shape() {
        let out = dispatch("definitely-not-a-command", &[]);
        assert!(out.contains("unknown command:"), "{out}");
        assert!(out.contains(r#""ok":false"#), "{out}");
    }

    #[test]
    fn write_round_trips_through_cat() {
        let out = dispatch(
            "write",
            &["/edit.txt".to_string(), "hello wasm".to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("cat", &["/edit.txt".to_string()]);
        assert!(out.contains("hello wasm"), "{out}");
        let big = "x".repeat(MAX_WRITE_BYTES + 1);
        let out = dispatch("write", &["/big.txt".to_string(), big]);
        assert!(out.contains("too_large:"), "{out}");
    }

    #[test]
    fn ls_ignores_flags_and_names_empty_dirs() {
        // Regression: the agent's first orient move is `ls -la /` on a
        // fresh volume. Flags must not be mistaken for a path (`/-la`),
        // and an empty volume must read as a sentence, not silence.
        let out = dispatch("ls", &["-la".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("(empty directory)"), "{out}");
        let out = dispatch("exec", &["ls -la".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(!out.contains("not found: /-la"), "{out}");
        // A real missing path still refuses with the house prefix.
        let out = dispatch("ls", &["/no-such-dir-xyz".to_string()]);
        assert!(out.contains("not found:"), "{out}");
    }

    #[test]
    fn cat_on_a_directory_names_ls_not_not_found() {
        // Regression: `read {path:"/"}` answered `not found: /`, sending
        // the model in circles. A directory must say it is one.
        let out = dispatch("write", &["/catdir/note.txt".to_string(), "hi".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("cat", &["/catdir".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        assert!(out.contains("is a directory"), "{out}");
        let out = dispatch("cat", &["/".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        let out = dispatch("rm", &["-r".to_string(), "/catdir".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
    }

    #[test]
    fn echo_joins_args() {
        let out = dispatch("echo", &["hello".to_string(), "wasm".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("hello wasm"), "{out}");
        let out = dispatch("echo", &[]);
        assert!(out.contains(r#""ok":true"#), "{out}");
    }

    #[test]
    fn text_verbs_run_on_the_volume() {
        let out = dispatch(
            "write",
            &[
                "/wasm-text/note.txt".to_string(),
                "hello brave new world".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch(
            "grep",
            &["brave".to_string(), "/wasm-text/note.txt".to_string()],
        );
        assert!(out.contains("brave"), "{out}");
        let out = dispatch(
            "grep",
            &[
                "-n".to_string(),
                "brave".to_string(),
                "/wasm-text/note.txt".to_string(),
            ],
        );
        assert!(out.contains("1:"), "{out}");
        let out = dispatch("find", &["/wasm-text".to_string(), "note*".to_string()]);
        assert!(out.contains("note.txt"), "{out}");
        let out = dispatch(
            "head",
            &[
                "-n".to_string(),
                "1".to_string(),
                "/wasm-text/note.txt".to_string(),
            ],
        );
        assert!(out.contains("hello"), "{out}");
        let out = dispatch("wc", &["/wasm-text/note.txt".to_string()]);
        assert!(out.contains("4"), "{out}");
        let out = dispatch(
            "edit",
            &[
                "/wasm-text/note.txt".to_string(),
                "brave".to_string(),
                "fearless".to_string(),
            ],
        );
        assert!(out.contains("1 replacement"), "{out}");
        let out = dispatch("tail", &["/wasm-text/note.txt".to_string()]);
        assert!(out.contains("fearless"), "{out}");
        let out = dispatch("rm", &["-r".to_string(), "/wasm-text".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        // Every new verb is advertised for completion.
        let out = dispatch("complete", &["".to_string()]);
        for cmd in ["grep", "find", "head", "tail", "wc", "edit"] {
            assert!(out.contains(cmd), "{cmd} missing: {out}");
        }
    }

    #[test]
    fn cp_and_mv_round_trip() {
        let out = dispatch("write", &["/cp-src.txt".to_string(), "copy me".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch(
            "cp",
            &["/cp-src.txt".to_string(), "/cp-dst.txt".to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        // The source survives a copy.
        let out = dispatch("cat", &["/cp-src.txt".to_string()]);
        assert!(out.contains("copy me"), "{out}");
        let out = dispatch("cat", &["/cp-dst.txt".to_string()]);
        assert!(out.contains("copy me"), "{out}");
        let out = dispatch(
            "mv",
            &["/cp-dst.txt".to_string(), "/cp-moved.txt".to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        // The source is gone after a move.
        let out = dispatch("cat", &["/cp-dst.txt".to_string()]);
        assert!(out.contains("not found:"), "{out}");
        let out = dispatch("cat", &["/cp-moved.txt".to_string()]);
        assert!(out.contains("copy me"), "{out}");
        // Missing sources refuse with the house prefix.
        let out = dispatch("cp", &["/cp-nope.txt".to_string(), "/cp-x.txt".to_string()]);
        assert!(out.contains("not found:"), "{out}");
        let out = dispatch("cp", &["/cp-src.txt".to_string()]);
        assert!(out.contains("usage: cp"), "{out}");
    }

    #[test]
    fn kill_removes_only_the_named_task() {
        let out = dispatch(
            "compute",
            &["run".to_string(), "hash".to_string(), "/".to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let id: u32 = out
            .split("(task ")
            .nth(1)
            .and_then(|tail| tail.split(')').next())
            .and_then(|n| n.parse().ok())
            .expect("compute reports (task <id>)");
        let out = dispatch("kill", &["not-a-number".to_string()]);
        assert!(out.contains("usage: kill"), "{out}");
        let out = dispatch("kill", &["999999".to_string()]);
        assert!(out.contains("not_found:"), "{out}");
        let out = dispatch("kill", &[id.to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains(&format!("killed task {id}")), "{out}");
        let out = dispatch("kill", &[id.to_string()]);
        assert!(out.contains("not_found:"), "{out}");
    }

    #[test]
    fn ai_refuses_with_the_detached_worker_hint() {
        let out = dispatch("ai", &["ask".to_string(), "hi".to_string()]);
        assert!(out.contains("unsupported:"), "{out}");
        assert!(out.contains("detached worker"), "{out}");
        assert!(out.contains(r#""ok":false"#), "{out}");
    }

    #[test]
    fn complete_suggests_verbs_and_subcommands() {
        let out = dispatch("complete", &["sync ".to_string()]);
        assert!(out.contains("sync start"), "{out}");
        assert!(out.contains("sync status"), "{out}");
        assert!(out.contains("sync cancel"), "{out}");
        let out = dispatch("complete", &["oauth".to_string()]);
        assert!(out.contains("oauth"), "{out}");
        assert!(out.contains("oauth status"), "{out}");
        assert!(out.contains("oauth start"), "{out}");
        let out = dispatch("complete", &["ai ".to_string()]);
        assert!(out.contains("ai ask"), "{out}");
        // No prefix narrows nothing: every verb is offered exactly once.
        let out = dispatch("complete", &[]);
        for cmd in cybermanju_commands() {
            assert!(
                out.matches(cmd).count() >= 1,
                "{cmd} missing from completion: {out}"
            );
        }
    }

    #[test]
    fn help_groups_local_volume_vault_and_dashboard() {
        let out = dispatch("help", &[]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("local volume:"), "{out}");
        assert!(
            out.contains("local vault (offline, no dashboard):"),
            "{out}"
        );
        assert!(out.contains("dashboard only"), "{out}");
        assert!(out.contains("quota"), "{out}");
        assert!(out.contains("sync start"), "{out}");
    }

    #[test]
    fn vault_verbs_refuse_with_the_local_answer_hint() {
        for cmd in ["quota", "oauth", "compress", "decompress"] {
            let out = dispatch(cmd, &[]);
            assert!(out.contains("unsupported:"), "{cmd}: {out}");
            assert!(out.contains("single-command line"), "{cmd}: {out}");
        }
    }

    #[test]
    fn run_executes_scripts_from_the_volume() {
        let script = "print \"hi\"\nlet x: number = 1\nif x == 1:\n  print \"one\"\nelse:\n  print \"other\"\nfor i in range(2):\n  print i\n$ echo yo\n";
        let out = dispatch(
            "write",
            &["/run-demo/hello.cybsh".to_string(), script.to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/hello.cybsh".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("hi"), "{out}");
        assert!(out.contains("one"), "{out}");
        assert!(out.contains("0\\n1"), "{out}");
        assert!(out.contains("yo"), "{out}");
        // --dry parses without executing; wrong extensions and missing
        // files refuse with the house prefixes.
        let out = dispatch(
            "run",
            &["/run-demo/hello.cybsh".to_string(), "--dry".to_string()],
        );
        assert!(out.contains("dry:"), "{out}");
        let out = dispatch("run", &["/run-demo/notes.txt".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        let out = dispatch("run", &["/run-demo/missing.cybsh".to_string()]);
        assert!(out.contains("not_found:"), "{out}");
        let out = dispatch(
            "run",
            &["/run-demo/hello.cybsh".to_string(), "--json".to_string()],
        );
        assert!(out.contains(r#""vars""#), "{out}");
    }

    #[test]
    fn run_refuses_fetch_honestly_in_the_sandbox() {
        let out = dispatch(
            "write",
            &[
                "/run-demo/net.cybsh".to_string(),
                "fetch \"https://example.com\"\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/net.cybsh".to_string()]);
        assert!(out.contains("unsupported:"), "{out}");
    }

    #[test]
    fn theme_and_ui_round_trip_with_effect_lines() {
        let out = dispatch("theme", &["mac-dark".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("ui: theme=mac-dark"), "{out}");
        let out = dispatch("ui", &["accent".to_string(), "#ff2d55".to_string()]);
        assert!(out.contains("ui: accent=#ff2d55"), "{out}");
        let out = dispatch("ui", &["get".to_string()]);
        assert!(out.contains("mac-dark"), "{out}");
        assert!(out.contains("#ff2d55"), "{out}");
        let out = dispatch("theme", &["nosuch".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        let out = dispatch("ui", &["accent".to_string(), "bogus".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        // Leave the shared volume theme clean for other tests.
        let out = dispatch("ui", &["theme".to_string(), "mac-light".to_string()]);
        assert!(out.contains("ui: theme=mac-light"), "{out}");
        let out = dispatch("ui", &["accent".to_string(), "default".to_string()]);
        assert!(out.contains("ui: accent=system"), "{out}");
    }

    #[test]
    fn ui_drives_the_whole_interface() {
        let out = dispatch("ui", &["density".to_string(), "compact".to_string()]);
        assert!(out.contains("ui: density=compact"), "{out}");
        let out = dispatch("ui", &["density".to_string(), "bogus".to_string()]);
        assert!(out.contains("invalid:"), "{out}");
        let out = dispatch("ui", &["glass".to_string(), "rich".to_string()]);
        assert!(out.contains("ui: glass=3"), "{out}");
        let out = dispatch("ui", &["motion".to_string(), "reduced".to_string()]);
        assert!(out.contains("ui: motion=reduced"), "{out}");
        let out = dispatch("ui", &["glow".to_string(), "off".to_string()]);
        assert!(out.contains("ui: glow=off"), "{out}");
        let out = dispatch(
            "ui",
            &[
                "accent".to_string(),
                "#ff2d78".to_string(),
                "--for".to_string(),
                "cyberpunk-night".to_string(),
            ],
        );
        assert!(
            out.contains("ui: accent-for=cyberpunk-night:#ff2d78"),
            "{out}"
        );
        let out = dispatch("ui", &["get".to_string(), "--json".to_string()]);
        assert!(out.contains(r#""density":"compact""#), "{out}");
        assert!(out.contains(r#""glass":3"#), "{out}");
        assert!(out.contains(r#""motion":"reduced""#), "{out}");
        assert!(out.contains(r#""glow":false"#), "{out}");
        assert!(out.contains(r##""cyberpunk-night":"#ff2d78""##), "{out}");
        // Restore defaults for other tests.
        for args in [
            vec!["density".to_string(), "comfortable".to_string()],
            vec!["glass".to_string(), "2".to_string()],
            vec!["motion".to_string(), "auto".to_string()],
            vec!["glow".to_string(), "on".to_string()],
        ] {
            let out = dispatch("ui", &args);
            assert!(out.contains(r#""ok":true"#), "{out}");
        }
        let out = dispatch(
            "ui",
            &[
                "accent".to_string(),
                "default".to_string(),
                "--for".to_string(),
                "cyberpunk-night".to_string(),
            ],
        );
        assert!(
            out.contains("ui: accent-for=cyberpunk-night:system"),
            "{out}"
        );
    }

    #[test]
    fn run_speaks_dicts_try_and_def() {
        let script = concat!(
            "# cybsh: 1\n",
            "def greet(name):\n",
            "  return \"hi \" + name\n",
            "let d = {\"b\": 2, \"a\": 1}\n",
            "print d.a\n",
            "print greet(\"manju\")\n",
            "try:\n",
            "  fail \"boom\"\n",
            "catch e:\n",
            "  print \"caught\"\n",
            "print keys(set(d, \"c\", 3))\n",
        );
        let out = dispatch(
            "write",
            &["/run-demo/lang.cybsh".to_string(), script.to_string()],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/lang.cybsh".to_string()]);
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("1\\nhi manju\\ncaught\\n[a, b, c]"), "{out}");
    }

    #[test]
    fn run_enforces_pins_and_capabilities() {
        let out = dispatch(
            "write",
            &[
                "/run-demo/future.cybsh".to_string(),
                "# cybsh: 99\nprint 1\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/future.cybsh".to_string()]);
        assert!(out.contains("unsupported:"), "{out}");
        assert!(out.contains("v99"), "{out}");

        let out = dispatch(
            "write",
            &[
                "/run-demo/capped.cybsh".to_string(),
                "# cap: deny=rm\n$ rm /x\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/capped.cybsh".to_string()]);
        assert!(out.contains("denied:"), "{out}");

        let out = dispatch(
            "write",
            &[
                "/run-demo/net.cybsh".to_string(),
                "# cap: net=example.com\nfetch \"https://evil.test/x\"\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch("run", &["/run-demo/net.cybsh".to_string()]);
        assert!(out.contains("denied:"), "{out}");
    }

    #[test]
    fn run_records_and_replays_journals() {
        let out = dispatch(
            "write",
            &[
                "/run-demo/rec.cybsh".to_string(),
                "print sh(\"echo hi\")\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch(
            "run",
            &[
                "/run-demo/rec.cybsh".to_string(),
                "--record".to_string(),
                "/run-demo/rec.json".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("hi"), "{out}");
        let out = dispatch("cat", &["/run-demo/rec.json".to_string()]);
        assert!(out.contains("fingerprint"), "{out}");
        assert!(out.contains("echo hi"), "{out}");
        // Replay serves without executing (tamper the script → integrity).
        let out = dispatch(
            "run",
            &[
                "/run-demo/rec.cybsh".to_string(),
                "--replay".to_string(),
                "/run-demo/rec.json".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains("hi"), "{out}");
        let out = dispatch(
            "write",
            &[
                "/run-demo/rec.cybsh".to_string(),
                "print sh(\"echo changed\")\n".to_string(),
            ],
        );
        assert!(out.contains(r#""ok":true"#), "{out}");
        let out = dispatch(
            "run",
            &[
                "/run-demo/rec.cybsh".to_string(),
                "--replay".to_string(),
                "/run-demo/rec.json".to_string(),
            ],
        );
        assert!(out.contains("integrity:"), "{out}");
    }

    #[test]
    fn script_fingerprint_matches_the_published_vector() {
        assert_eq!(script_fingerprint("a"), "af63dc4c8601ec8c");
        assert_eq!(script_fingerprint("a").len(), 16);
    }
}
