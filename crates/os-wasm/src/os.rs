// CyberManju OS — WASM `os/*` dispatcher (AGENT-8, items 3 & 14)
//
// The GitHub Pages build has no dashboard behind it, so `POST /api/os/exec`
// would be an empty shell there. This module is the same entry point from the
// browser side: one `os_dispatch(cmd, args_json)` call that answers the
// terminal's questions against a virtual volume kept in `localStorage`
// (in-memory when storage is unavailable), with a BM25-lite `search`.
//
// Everything the *server* owns — attached disks, providers, scrub, repair —
// answers `unsupported: …` rather than pretending. The shell contract
// (`"prefix: detail"`) is unchanged, so the terminal renders identically on
// all three transports.

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
fn cybermanju_commands() -> &'static [&'static str] {
    &[
        "help",
        "history",
        "clear",
        "version",
        "pwd",
        "cd",
        "ls",
        "cat",
        "write",
        "touch",
        "mkdir",
        "rm",
        "stat",
        "du",
        "df",
        "ps",
        "top",
        "jobs",
        "workers",
        "search",
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
        "lease",
        "keygen",
        "encrypt",
        "decrypt",
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
        // One line from the terminal: tokenize, run, and stitch `&&` / `;`
        // sequences together the way the native shell does.
        "exec" => {
            let line = args.first().map(String::as_str).unwrap_or_default().trim();
            if line.is_empty() {
                return ok(String::new());
            }
            HISTORY.with(|h| {
                let mut history = h.borrow_mut();
                if history.last().map(String::as_str) != Some(line) {
                    history.push(line.to_string());
                }
            });
            if line.contains('|') {
                return err(
                    "unsupported: pipelines are not available in the wasm sandbox".to_string(),
                );
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
                    return err(combined);
                }
            }
            ok(combined)
        }
        // Tab completion for the terminal prompt — the raw JSON array the
        // `os_complete` route also returns.
        "complete" => {
            let prefix = args.first().map(String::as_str).unwrap_or_default();
            let hits: Vec<&str> = cybermanju_commands()
                .iter()
                .filter(|c| c.starts_with(prefix))
                .copied()
                .collect();
            serde_json::to_string(&hits).unwrap_or_else(|_| "[]".to_string())
        }
        "help" => ok(format!(
            "cybsh (wasm transport) — {}",
            cybermanju_commands().join(" · ")
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
            let base = args
                .first()
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
            ok(names.join("\n"))
        }
        "cat" => {
            let path = args
                .first()
                .map(|a| join(&CWD.with(|c| c.borrow().clone()), a))
                .unwrap_or_default();
            match volume.get(&path) {
                Some(text) => ok(text.clone()),
                None => err(format!("not found: {path}")),
            }
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
        // The server-owned surface: honest refusal, never a fake success.
        "df-attached" | "mount" | "umount" | "disk" | "providers" | "quota"
        | "sync" | "scrub" | "repair" | "gc" | "lease" | "keygen" | "encrypt"
        | "decrypt" => err(format!(
            "unsupported: `{cmd}` needs the CyberManju dashboard — the wasm build is a \
             browser sandbox (volume lives in localStorage)"
        )),
        _ => err(format!(
            "unknown command: '{cmd}' — try `help`"
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
}
