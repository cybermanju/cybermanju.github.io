//! `.cybsh` scripts (interpreted automation, no build step).
//!
//! A `.cybsh` file is a flat list of statements run by `run <file.cybsh>`
//! through the *same* shell that powers the terminal — every inline `sh`
//! line goes through `execute()`, so pipes, `&&`/`||`/`;` and `--json`
//! keep working unchanged. There is no compiler, no new syntax family:
//! python-style `if/elif/else` + `print`, `let` bindings with optional
//! TypeScript type annotations (stripped), a `js` expression subset, and
//! `fetch`/`ui`/`providers` bridges to the CyberManju OS surface.
//!
//! Memory model (Rust-flavoured, deliberately boring):
//! - every value is owned (`Value`); there is no aliasing and no tracing
//!   GC — budgets below bound every allocation instead.
//! - `free <name>` drops one binding, `gc` releases the last-output `_`
//!   buffer and shrinks the maps. `vars` shows what is alive.
//! - budgets: 64 KiB source · 200 statements per block level · 5000 steps
//!   total · 1000 loop iterations · 64 vars · 16 KiB per string ·
//!   1024 list items · 256 KiB output (truncated with a note, never
//!   silently dropped).
//!
//! Transports: the native shell runs this module; the static/Pages build
//! mirrors it in `src/utils/cybshScript.ts` (real `fetch`, real theme
//! effects). Anything that needs the dashboard (`fetch` here — this crate
//! has no HTTP client; `sync start`, provider push) answers the honest
//! `unsupported:` instead of faking success.

use std::collections::{BTreeMap, HashMap};

/// File extension `run` requires (exact, lowercase).
pub const SCRIPT_EXT: &str = ".cybsh";
/// Largest script source `run` will read.
pub const MAX_SOURCE_BYTES: usize = 64 * 1024;
/// Statements executed per block level (loop bodies re-count each pass).
pub const MAX_STMTS: usize = 200;
/// Total statement executions per `run` (doom-loop guard analogue).
pub const MAX_STEPS: usize = 5000;
/// Iterations per `while`/`for`.
pub const MAX_ITERS: usize = 1000;
/// Live variables at once (`_` counts).
pub const MAX_VARS: usize = 64;
/// Longest single string value.
pub const MAX_STR: usize = 16 * 1024;
/// Longest list value.
pub const MAX_LIST: usize = 1024;
/// Most user functions per script.
pub const MAX_FUNCS: usize = 32;
/// Deepest nested `def` calls (recursion is bounded, like loops).
pub const MAX_CALL_DEPTH: usize = 32;
/// Script output cap (truncated with a note, like shell tables).
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// One UI effect a script produced (also printed as `ui: …` lines, so the
/// Terminal panel can apply them via `useTheme()` on every transport).
#[derive(Debug, Clone)]
pub struct Effect {
    pub kind: String,
    pub detail: serde_json::Value,
}

/// Rendered result of a script run.
#[derive(Debug, Clone)]
pub struct RunOutput {
    pub text: String,
    pub effects: Vec<Effect>,
    pub vars: usize,
    /// Declared capabilities (None when the script pins none).
    pub caps: Option<CapsSummary>,
    /// Audit counters for the run (Deno-audit flavour).
    pub sh_calls: usize,
    pub fetch_calls: usize,
}

/// JSON-friendly capability summary for `--json` audits.
#[derive(Debug, Clone)]
pub struct CapsSummary {
    pub active: bool,
    pub net: Option<Vec<String>>,
    pub read: Option<Vec<String>>,
    pub write: Option<Vec<String>>,
    pub deny: Vec<String>,
}

impl Caps {
    fn summary(&self) -> Option<CapsSummary> {
        if !self.active {
            return None;
        }
        Some(CapsSummary {
            active: true,
            net: self.net.clone(),
            read: self.read.clone(),
            write: self.write.clone(),
            deny: self.deny.clone(),
        })
    }
}

/// Owned script value — no aliasing, no GC needed beyond `free`/`gc`.
/// `Dict` keys stay sorted (`BTreeMap`), so display, iteration and `==`
/// are deterministic on every transport (Starlark rule).
#[derive(Debug, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    List(Vec<Value>),
    Dict(BTreeMap<String, Value>),
}

impl Value {
    fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Num(_) => "number",
            Value::Str(_) => "string",
            Value::List(_) => "list",
            Value::Dict(_) => "dict",
        }
    }

    /// Python-style truthiness: empty/zero/false/null is false.
    fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Str(s) => !s.is_empty(),
            Value::List(l) => !l.is_empty(),
            Value::Dict(d) => !d.is_empty(),
        }
    }

    fn display(&self) -> String {
        match self {
            Value::Null => "null".to_string(),
            Value::Bool(true) => "true".to_string(),
            Value::Bool(false) => "false".to_string(),
            Value::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else {
                    format!("{n}")
                }
            }
            Value::Str(s) => s.clone(),
            Value::List(items) => {
                let parts: Vec<String> = items.iter().map(|v| v.display()).collect();
                format!("[{}]", parts.join(", "))
            }
            Value::Dict(map) => {
                let parts: Vec<String> = map
                    .iter()
                    .map(|(k, v)| format!("{}: {}", json_quote(k), v.display()))
                    .collect();
                format!("{{{}}}", parts.join(", "))
            }
        }
    }

    fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            Value::Bool(true) => Some(1.0),
            Value::Bool(false) => Some(0.0),
            Value::Str(s) => s.trim().parse::<f64>().ok(),
            Value::Null => Some(0.0),
            Value::List(l) => Some(l.len() as f64),
            Value::Dict(d) => Some(d.len() as f64),
        }
    }
}

/// One source line with its indent level and number.
#[derive(Debug, Clone)]
struct Line {
    indent: usize,
    text: String,
    lineno: usize,
}

/// A user function: params + owned body lines (`def`, Starlark-style).
#[derive(Debug, Clone)]
struct FuncDef {
    params: Vec<String>,
    body: Vec<Line>,
}

/// Declared capabilities (`# cap:` lines, Deno-style least privilege).
/// Absent entirely = ambient (current behaviour, backwards compatible);
/// present = enforced, deny wins.
#[derive(Debug, Clone, Default)]
pub struct Caps {
    /// Fetch allowlist (`net=host,...`). `None` + active = fetch refused.
    pub net: Option<Vec<String>>,
    /// Declared read/write scopes — recorded in the audit, enforced for
    /// verbs/fetch (opaque shell lines cannot be path-scoped honestly).
    pub read: Option<Vec<String>>,
    pub write: Option<Vec<String>>,
    /// Refused shell verbs (`deny=rm,sync`).
    pub deny: Vec<String>,
    /// Whether any `# cap:` line was present.
    pub active: bool,
}

impl Caps {
    fn check_exec(&self, line: &str) -> Result<(), String> {
        if !self.active || self.deny.is_empty() {
            return Ok(());
        }
        let verb = line
            .trim()
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_lowercase();
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
        let host = fetch_host(url);
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
}

/// Host bytes of a URL for capability checks (`https://h:1/p` → `h`).
fn fetch_host(url: &str) -> String {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    host_port
        .split('@')
        .next_back()
        .unwrap_or(host_port)
        .to_lowercase()
}

/// Parse `# cap:` lines (`k=v` tokens: `net/read/write/deny`, comma lists).
pub fn parse_caps(source: &str) -> Caps {
    let mut caps = Caps::default();
    for raw in source.lines().take(200) {
        let t = raw.trim();
        let Some(rest) = t.strip_prefix("# cap:").or_else(|| t.strip_prefix("#cap:")) else {
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

/// Language version this interpreter speaks (`# cybsh: 1` pins it).
pub const SCRIPT_VERSION: &str = "1";

/// First non-blank raw line may pin the language (`# cybsh: 1`).
/// Missing pin = allowed (backwards compatible); wrong pin = honest refusal.
pub fn check_version_pin(source: &str) -> Result<(), String> {
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

/// FNV-1a/64 fingerprint (non-crypto content tag for replay journals).
pub fn fingerprint(source: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in source.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// JSON-quote a string for dict display (minimal escaping, deterministic).
fn json_quote(s: &str) -> String {
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

/// What the host offers a script: inline shell + optional fetch.
/// `fetch: None` (native shell, no HTTP client) keeps the honest
/// `unsupported:`; replay journals inject a serving fetch everywhere.
pub struct Host<'a> {
    pub exec: &'a dyn Fn(&str) -> Result<String, String>,
    pub fetch: Option<&'a dyn Fn(&str) -> Result<String, String>>,
}

struct Interp<'a> {
    host: &'a Host<'a>,
    caps: Caps,
    vars: HashMap<String, Value>,
    funcs: HashMap<String, FuncDef>,
    flow: Option<Value>,
    call_depth: usize,
    out: String,
    effects: Vec<Effect>,
    steps: usize,
    truncated: bool,
    sh_calls: usize,
    fetch_calls: usize,
}

/// Parse + budget-check only (backs `run --dry`): no line executes.
pub fn dry_run(source: &str) -> Result<String, String> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "too_large: script is {} bytes, limit is {MAX_SOURCE_BYTES}",
            source.len()
        ));
    }
    check_version_pin(source)?;
    let lines = split_lines(source)?;
    let caps = parse_caps(source);
    let cap_note = if caps.active {
        format!(" · caps: {}", describe_caps(&caps))
    } else {
        String::new()
    };
    Ok(format!(
        "dry: {} statement(s) parse{cap_note} — nothing executed (use `run <file.cybsh>` to execute)",
        lines.len()
    ))
}

fn describe_caps(caps: &Caps) -> String {
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

/// Parse and execute a script against a [`Host`] (inline shell + fetch).
pub fn run_source(source: &str, host: &Host) -> Result<RunOutput, String> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "too_large: script is {} bytes, limit is {MAX_SOURCE_BYTES}",
            source.len()
        ));
    }
    check_version_pin(source)?;
    let lines = split_lines(source)?;
    let caps = parse_caps(source);
    let mut ip = Interp {
        host,
        caps: caps.clone(),
        vars: HashMap::new(),
        funcs: HashMap::new(),
        flow: None,
        call_depth: 0,
        out: String::new(),
        effects: Vec::new(),
        steps: 0,
        truncated: false,
        sh_calls: 0,
        fetch_calls: 0,
    };
    // Top level runs at parent depth -1 so indent-0 lines execute.
    run_block(&mut ip, &lines, 0, -1)?;
    if ip.truncated {
        ip.out.push_str(&format!(
            "\n… output truncated at {} bytes (fewer `print`/`sh` lines for the full log)",
            MAX_OUTPUT_BYTES
        ));
    }
    let vars = ip.vars.len();
    Ok(RunOutput {
        text: ip.out,
        effects: ip.effects,
        vars,
        caps: caps.summary(),
        sh_calls: ip.sh_calls,
        fetch_calls: ip.fetch_calls,
    })
}

impl<'a> Interp<'a> {
    fn emit(&mut self, s: &str) {
        if self.out.len() >= MAX_OUTPUT_BYTES {
            self.truncated = true;
            return;
        }
        let mut chunk = s.to_string();
        if self.out.len() + chunk.len() + 1 > MAX_OUTPUT_BYTES {
            let keep = MAX_OUTPUT_BYTES - self.out.len();
            chunk.truncate(keep);
            self.truncated = true;
        }
        if !self.out.is_empty() {
            self.out.push('\n');
        }
        self.out.push_str(&chunk);
    }

    fn bump(&mut self) -> Result<(), String> {
        self.steps += 1;
        if self.steps > MAX_STEPS {
            return Err(format!(
                "too_large: script exceeded {MAX_STEPS} steps (possible infinite loop — split it or add a bound)"
            ));
        }
        Ok(())
    }

    fn set_var(&mut self, name: &str, value: Value) -> Result<(), String> {
        if !valid_name(name) {
            return Err(format!(
                "syntax: bad variable name '{name}' ([A-Za-z_][A-Za-z0-9_]*)"
            ));
        }
        if !self.vars.contains_key(name) && self.vars.len() >= MAX_VARS {
            return Err(format!(
                "too_large: script holds {MAX_VARS} variables already (`free` one or run `gc`)"
            ));
        }
        self.vars.insert(name.to_string(), value);
        Ok(())
    }
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && name.len() <= 64
}

/// Builtins, literals and operators a `def` may not shadow (explicit calls
/// always mean the builtin — one meaning per name, Oils rule).
fn is_reserved(name: &str) -> bool {
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

/// Strip `#` comments (quote-aware) and blank lines; measure indent.
/// Tabs count as 4 columns so mixed editors stay comparable.
fn split_lines(source: &str) -> Result<Vec<Line>, String> {
    let mut out = Vec::new();
    for (idx, raw) in source.lines().enumerate() {
        let lineno = idx + 1;
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
        let code = strip_comment(body);
        let text = code.trim().to_string();
        if text.is_empty() {
            continue;
        }
        out.push(Line {
            indent,
            text,
            lineno,
        });
    }
    Ok(out)
}

/// Remove a trailing `# comment` unless the `#` is inside quotes or is
/// part of an interpolation `${…}` / accent hex `#rrggbb`.
fn strip_comment(body: &str) -> &str {
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
                // Byte index of chars[i]: recompute from char prefix.
                let byte: usize = chars[..i].iter().collect::<String>().len();
                return body[..byte].trim_end();
            }
        }
        i += 1;
    }
    body
}

/// Run consecutive lines at indent `> parent`; returns lines consumed.
/// `parent` is `isize` so the top level passes -1 and indent-0 lines run.
fn run_block(
    ip: &mut Interp,
    lines: &[Line],
    start: usize,
    parent: isize,
) -> Result<usize, String> {
    let mut i = start;
    let mut executed = 0usize;
    while i < lines.len() && lines[i].indent as isize > parent {
        if lines[i].indent as isize <= parent {
            break;
        }
        if executed >= MAX_STMTS {
            return Err(format!(
                "too_large: block exceeds {MAX_STMTS} statements (line {}) — split the script",
                lines[i].lineno
            ));
        }
        i = run_statement(ip, lines, i)?;
        executed += 1;
        // A `return` inside a `def` unwinds every enclosing block.
        if ip.flow.is_some() {
            break;
        }
    }
    Ok(i)
}

fn block_indent(lines: &[Line], start: usize, parent: isize) -> Result<usize, String> {
    if start >= lines.len() || lines[start].indent as isize <= parent {
        let at = lines.get(start).map(|l| l.lineno).unwrap_or(0);
        return Err(format!(
            "syntax: expected an indented block after line {at}"
        ));
    }
    Ok(lines[start].indent)
}

/// Skip a block starting at `start` (which must be a child of `parent`).
fn skip_block(lines: &[Line], start: usize, parent: isize) -> usize {
    let mut i = start;
    while i < lines.len() && lines[i].indent as isize > parent {
        i += 1;
    }
    i
}

fn run_statement(ip: &mut Interp, lines: &[Line], idx: usize) -> Result<usize, String> {
    let line = &lines[idx];
    let text = line.text.clone();
    let lineno = line.lineno;
    ip.bump()?;

    // `if <cond>:` with `elif`/`else` siblings at the same indent.
    if is_kw(&text, "if") {
        let cond = strip_suffix_colon(expect_rest(&text, "if", lineno)?, lineno)?;
        let parent = line.indent as isize;
        block_indent(lines, idx + 1, parent)?;
        if is_truthy_cond(ip, &cond, lineno)? {
            let end = run_block(ip, lines, idx + 1, parent)?;
            return Ok(skip_elif_chain(lines, end, parent));
        }
        let mut j = skip_block(lines, idx + 1, parent);
        loop {
            if j < lines.len() && lines[j].indent as isize == parent {
                let t = lines[j].text.clone();
                if is_kw(&t, "elif") {
                    let c = strip_suffix_colon(
                        expect_rest(&t, "elif", lines[j].lineno)?,
                        lines[j].lineno,
                    )?;
                    if is_truthy_cond(ip, &c, lines[j].lineno)? {
                        let end = run_block(ip, lines, j + 1, parent)?;
                        return Ok(skip_elif_chain(lines, end, parent));
                    }
                    j = skip_block(lines, j + 1, parent);
                    continue;
                }
                if t == "else:" || t == "else" {
                    let end = run_block(ip, lines, j + 1, parent)?;
                    return Ok(skip_elif_chain(lines, end, parent));
                }
            }
            return Ok(j);
        }
    }
    if is_kw(&text, "elif") || text == "else:" || text == "else" {
        return Err(format!(
            "syntax: line {lineno}: `{}` without `if`",
            first_word(&text)
        ));
    }

    // `while <cond>:` — bounded, like every loop in this shell.
    if is_kw(&text, "while") {
        let cond = strip_suffix_colon(expect_rest(&text, "while", lineno)?, lineno)?;
        let parent = line.indent as isize;
        block_indent(lines, idx + 1, parent)?;
        let mut iters = 0usize;
        while is_truthy_cond(ip, &cond, lineno)? {
            if iters >= MAX_ITERS {
                return Err(format!(
                    "too_large: `while` exceeded {MAX_ITERS} iterations (line {lineno})"
                ));
            }
            run_block(ip, lines, idx + 1, parent)?;
            iters += 1;
            ip.bump()?;
        }
        return Ok(skip_block(lines, idx + 1, parent));
    }

    // `for <name> in <expr>:` — lists, `range()`, or whitespace/lines split.
    if is_kw(&text, "for") {
        let rest = expect_rest(&text, "for", lineno)?;
        let header = strip_suffix_colon(rest, lineno)?;
        let (name, expr_src) = split_for(&header, lineno)?;
        let parent = line.indent as isize;
        block_indent(lines, idx + 1, parent)?;
        let items = for_items(ip, &expr_src, lineno)?;
        if items.len() > MAX_ITERS {
            return Err(format!(
                "too_large: `for` has {} items, limit is {MAX_ITERS} (line {lineno})",
                items.len()
            ));
        }
        for item in items {
            ip.set_var(&name, item)?;
            run_block(ip, lines, idx + 1, parent)?;
            ip.bump()?;
        }
        ip.vars.remove(&name);
        return Ok(skip_block(lines, idx + 1, parent));
    }

    // `print …` / `print(…)` — python-style output.
    if text == "print" || text == "print()" || is_kw(&text, "print") || text.starts_with("print(") {
        let arg = if text == "print" || text == "print()" {
            String::new()
        } else if text.starts_with("print(") && text.ends_with(')') {
            text["print(".len()..text.len() - 1].to_string()
        } else {
            expect_rest(&text, "print", lineno)?.to_string()
        };
        if arg.trim().is_empty() {
            ip.emit("");
        } else {
            let vals = eval_print_args(ip, &arg, lineno)?;
            ip.emit(&vals);
        }
        return Ok(idx + 1);
    }

    // `fetch <url> [as <var>]` — through the capability gate to the host
    // client (real on static/Pages, journal replays everywhere, honest
    // `unsupported:` where no client exists).
    if is_kw(&text, "fetch") {
        let rest = expect_rest(&text, "fetch", lineno)?;
        let (url_src, var) = split_fetch(rest);
        let url = eval_expr(ip, &url_src, lineno)?.display();
        let body = fetch_checked(ip, &url, lineno)?;
        if let Some(name) = var {
            if !valid_name(&name) {
                return Err(format!("syntax: line {lineno}: bad variable name `{name}`"));
            }
            ip.set_var(&name, Value::Str(body.clone()))?;
            ip.emit(&format!("fetched {url} ({} bytes → {name})", body.len()));
        } else {
            ip.set_var("_", Value::Str(body.clone()))?;
            ip.emit(&body);
        }
        return Ok(idx + 1);
    }

    // Memory introspection: `vars`, `free <name>`, `gc [--apply]`.
    if text == "vars" {
        let mut names: Vec<&String> = ip.vars.keys().collect();
        names.sort();
        if names.is_empty() {
            ip.emit("(no variables)");
        } else {
            // Rows first (borrow ends here), emits after — one borrow at a time.
            let rows: Vec<String> = names
                .iter()
                .map(|name| {
                    let v = &ip.vars[*name];
                    format!(
                        "{name}: {} = {}",
                        v.type_name(),
                        truncate_str(&v.display(), 120)
                    )
                })
                .collect();
            for row in &rows {
                ip.emit(row);
            }
        }
        return Ok(idx + 1);
    }
    if is_kw(&text, "free") {
        let name = expect_rest(&text, "free", lineno)?.trim().to_string();
        if ip.vars.remove(&name).is_some() {
            ip.emit(&format!("freed {name}"));
        } else {
            return Err(format!("not_found: no variable `{name}` (line {lineno})"));
        }
        return Ok(idx + 1);
    }
    if text == "gc" || text == "gc --apply" {
        let before: usize = ip.vars.values().map(|v| v.display().len()).sum();
        ip.vars.remove("_");
        ip.vars.shrink_to_fit();
        let after: usize = ip.vars.values().map(|v| v.display().len()).sum();
        let held = before.saturating_sub(after);
        ip.emit(&format!(
            "gc: {} var(s) alive, released ~{held} byte(s) of last-output buffer (values are owned — no tracing collector needed; `free <name>` drops a binding)",
            ip.vars.len()
        ));
        return Ok(idx + 1);
    }

    // `js <expr>` statement — JS/TS expression subset, printed.
    if is_kw(&text, "js") {
        let expr_src = normalize_js(expect_rest(&text, "js", lineno)?);
        let v = eval_expr(ip, &expr_src, lineno)?;
        ip.emit(&v.display());
        return Ok(idx + 1);
    }

    // `try:` + `catch [var]:` — explicit failure handling (Elvish over
    // bash: failures abort unless caught right here; no implicit contexts).
    if text == "try:" || text == "try" {
        let parent = line.indent as isize;
        block_indent(lines, idx + 1, parent)?;
        let body_end = skip_block(lines, idx + 1, parent);
        match run_block(ip, lines, idx + 1, parent) {
            Ok(_) => {
                // No failure: skip an optional `catch` sibling untouched.
                let mut j = body_end;
                if j < lines.len() && lines[j].indent as isize == parent && is_catch(&lines[j].text)
                {
                    j = skip_block(lines, j + 1, parent);
                }
                return Ok(j);
            }
            Err(e) => {
                let j = body_end;
                if j < lines.len() && lines[j].indent as isize == parent {
                    let t = lines[j].text.clone();
                    let lj = lines[j].lineno;
                    if is_catch(&t) {
                        let var = catch_binding(&t, lj)?;
                        // An error wins over any pending `return`.
                        ip.flow = None;
                        if let Some(name) = var {
                            ip.set_var(&name, Value::Str(truncate_owned(e, MAX_STR)))?;
                        }
                        let end = run_block(ip, lines, j + 1, parent)?;
                        return Ok(end);
                    }
                }
                return Err(e);
            }
        }
    }
    if is_catch(&text) {
        return Err(format!("syntax: line {lineno}: `catch` without `try`"));
    }

    // `def name(p1, p2):` — user functions (Starlark-style: lexical scope,
    // owned values, no global mutation; recursion bounded by call depth).
    if is_kw(&text, "def") {
        let rest = expect_rest(&text, "def", lineno)?;
        let header = strip_suffix_colon(rest, lineno)?;
        let (name, params) = split_def(&header, lineno)?;
        let parent = line.indent as isize;
        block_indent(lines, idx + 1, parent)?;
        let end = skip_block(lines, idx + 1, parent);
        let body: Vec<Line> = lines[idx + 1..end].to_vec();
        if ip.funcs.len() >= MAX_FUNCS && !ip.funcs.contains_key(&name) {
            return Err(format!(
                "too_large: script holds {MAX_FUNCS} functions already"
            ));
        }
        ip.funcs.insert(name, FuncDef { params, body });
        return Ok(end);
    }

    // `return [expr]` — only inside `def` (falls through to the caller).
    if text == "return" || is_kw(&text, "return") {
        if ip.call_depth == 0 {
            return Err(format!("syntax: line {lineno}: `return` outside `def`"));
        }
        let v = if text == "return" {
            Value::Null
        } else {
            eval_expr(ip, expect_rest(&text, "return", lineno)?, lineno)?
        };
        ip.flow = Some(v);
        return Ok(idx + 1);
    }

    // `fail "msg"` — raise a script error (`fail: msg`, caught by `catch`).
    if is_kw(&text, "fail") {
        let msg = eval_expr(ip, expect_rest(&text, "fail", lineno)?, lineno)?.display();
        return Err(format!("fail: {msg}"));
    }

    // `$ <cybsh line>` — inline shell, output shown + stored in `_`.
    if text.starts_with("$ ") || text == "$" {
        let cmdline = text[1..].trim().to_string();
        if cmdline.is_empty() {
            return Ok(idx + 1);
        }
        return run_inline(ip, &cmdline, lineno, idx);
    }

    // `let name [: type] = expr` / `name = expr` (TS annotations stripped).
    if let Some((name, expr_src)) = split_assignment(&text) {
        let v = eval_assign_rhs(ip, &expr_src, lineno)?;
        check_str_cap(&v, lineno)?;
        ip.set_var(&name, v)?;
        return Ok(idx + 1);
    }

    // `sh "cmd"` statement form.
    if is_kw(&text, "sh") {
        let rest = expect_rest(&text, "sh", lineno)?.trim().to_string();
        let cmdline = unquote(&rest, lineno)?.unwrap_or(rest);
        return run_inline(ip, &cmdline, lineno, idx);
    }

    // Bare cybsh line, e.g. `ls /` or `sync status` (same table as `help`).
    if bare_verb(&text).is_some() {
        return run_inline(ip, &text, lineno, idx);
    }

    // Anything else is tried as a bare expression (Oils rule: one way to
    // run code — `sh("…")`, `greet(x)`, even `1 + 2` evaluate and keep `_`).
    // Non-null results print, like `sh "…"` lines do; a typo still fails
    // loudly, just with expression errors attached.
    let v = eval_expr(ip, &text, lineno).map_err(|e| {
        format!(
            "syntax: line {lineno}: unknown statement `{}` ({e}; try `print`, `let`, `def`, `if/elif/else`, `try/catch`, `for`, `while`, `$ <cybsh>`, `sh \"…\"`, `js …`, `fetch …`, `ui …`, `vars/free/gc`)",
            truncate_str(&text, 60)
        )
    })?;
    if !matches!(v, Value::Null) {
        ip.emit(&v.display());
    }
    let _ = ip.set_var("_", v);
    Ok(idx + 1)
}

fn run_inline(ip: &mut Interp, cmdline: &str, lineno: usize, idx: usize) -> Result<usize, String> {
    // Nested `run` goes through the shell's own depth guard; anything else
    // executes here and lands in `_` for the next expression.
    let expanded = interpolate(ip, cmdline, lineno)?;
    match exec_checked(ip, &expanded) {
        Ok(text) => {
            harvest_effects(ip, &text);
            if !text.is_empty() {
                ip.emit(&text);
            }
            let _ = ip.set_var("_", Value::Str(truncate_owned(text, MAX_STR)));
            Ok(idx + 1)
        }
        Err(e) => Err(format!("{e} (line {lineno})")),
    }
}

/// `ui:` effect lines the `ui`/`theme` verbs print become structured
/// effects for the REST/TS layers (`ui: theme=mac-dark`, …).
fn harvest_effects(ip: &mut Interp, text: &str) {
    for raw in text.lines() {
        let line = raw.trim();
        let Some(rest) = line.strip_prefix("ui:") else {
            continue;
        };
        let rest = rest.trim();
        if let Some((k, v)) = rest.split_once('=') {
            let k = k.trim().to_string();
            let v = v.trim().to_string();
            if k == "theme" || k == "accent" {
                ip.effects.push(Effect {
                    kind: k,
                    detail: serde_json::Value::String(v),
                });
            }
        }
    }
}

fn skip_elif_chain(lines: &[Line], mut j: usize, parent: isize) -> usize {
    // After a branch ran, skip any remaining `elif`/`else` siblings + blocks.
    loop {
        if j < lines.len() && lines[j].indent as isize == parent {
            let t = lines[j].text.as_str();
            if is_kw(t, "elif") || t == "else:" || t == "else" {
                j = skip_block(lines, j + 1, parent);
                continue;
            }
        }
        return j;
    }
}

// ─── statement helpers ──────────────────────────────────────────────────

fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or(s)
}

fn is_kw(text: &str, kw: &str) -> bool {
    text == kw || text.starts_with(&format!("{kw} "))
}

fn expect_rest<'b>(text: &'b str, kw: &str, lineno: usize) -> Result<&'b str, String> {
    text.strip_prefix(kw)
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .ok_or_else(|| format!("syntax: line {lineno}: `{kw}` needs an argument"))
}

fn strip_suffix_colon(s: &str, lineno: usize) -> Result<String, String> {
    let t = s.trim();
    if t.ends_with(':') {
        Ok(t[..t.len() - 1].trim().to_string())
    } else {
        Err(format!("syntax: line {lineno}: block opener needs a trailing `:` (`if …:`, `for …:`, `while …:`, `else:`)"))
    }
}

fn split_for(rest: &str, lineno: usize) -> Result<(String, String), String> {
    // `name in expr` — split on the ` in ` with the name validated.
    let mut parts = rest.splitn(2, " in ");
    let name = parts
        .next()
        .map(str::trim)
        .filter(|n| valid_name(n))
        .ok_or_else(|| format!("syntax: line {lineno}: `for` needs `for <name> in <expr>:`"))?;
    let expr = parts
        .next()
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .ok_or_else(|| format!("syntax: line {lineno}: `for` needs `for <name> in <expr>:`"))?;
    Ok((name.to_string(), expr.to_string()))
}

fn for_items(ip: &mut Interp, expr_src: &str, lineno: usize) -> Result<Vec<Value>, String> {
    let v = eval_expr(ip, expr_src, lineno)?;
    match v {
        Value::List(items) => Ok(items),
        // Dicts iterate their sorted keys (deterministic on every run).
        Value::Dict(map) => Ok(map.keys().map(|k| Value::Str(k.clone())).collect()),
        Value::Str(s) => {
            let items = if s.contains('\n') {
                s.lines().map(|l| Value::Str(l.to_string())).collect()
            } else {
                s.split_whitespace()
                    .map(|w| Value::Str(w.to_string()))
                    .collect()
            };
            Ok(items)
        }
        Value::Num(n) => Ok((0..n as i64).map(|i| Value::Num(i as f64)).collect()),
        other => Err(format!(
            "syntax: line {lineno}: `for` needs a list, `range()`, or a string — got {}",
            other.type_name()
        )),
    }
}

fn split_fetch(rest: &str) -> (String, Option<String>) {
    // `url as name` — the ` as ` split is quote-aware enough for URLs.
    if let Some(pos) = rest.find(" as ") {
        let (url, name) = rest.split_at(pos);
        let name = name[" as ".len()..].trim();
        if valid_name(name) && !url.trim().is_empty() {
            return (url.trim().to_string(), Some(name.to_string()));
        }
    }
    (rest.trim().to_string(), None)
}

/// `let name [: type] = expr` or `name = expr`. Returns `None` when the
/// line is not an assignment (no top-level `=` / `==` confusion).
fn split_assignment(text: &str) -> Option<(String, String)> {
    let eq = top_level_eq(text)?;
    let (lhs, rhs) = text.split_at(eq);
    if rhs.starts_with("==") || lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') {
        return None;
    }
    let mut name = lhs.trim().to_string();
    if let Some(rest) = name.strip_prefix("let ") {
        name = rest.trim().to_string();
    } else if let Some(rest) = name.strip_prefix("const ") {
        // `const` is an alias for `let` (scripts are short-lived; the
        // TS twin treats both the same way).
        name = rest.trim().to_string();
    } else if name.contains(' ') {
        return None;
    }
    // Strip an optional TypeScript annotation: `let x: number = 1`.
    if let Some(colon) = name.find(':') {
        name = name[..colon].trim().to_string();
    }
    if !valid_name(&name) || rhs[1..].trim().is_empty() {
        return None;
    }
    Some((name, rhs[1..].trim().to_string()))
}

/// Index of the first top-level `=` outside quotes/parens/brackets.
fn top_level_eq(text: &str) -> Option<usize> {
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
            '=' if depth == 0 => return Some(text_char_index(text, i)),
            _ => {}
        }
        i += 1;
    }
    None
}

fn text_char_index(text: &str, char_idx: usize) -> usize {
    text.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(text.len())
}

/// `catch`, `catch:`, `catch e`, `catch e:` — the `try` sibling.
fn is_catch(text: &str) -> bool {
    text == "catch" || text == "catch:" || is_kw(text, "catch")
}

/// Binding of a `catch` line (`catch e:` → `Some("e")`, bare → `None`).
fn catch_binding(text: &str, lineno: usize) -> Result<Option<String>, String> {
    if text == "catch" || text == "catch:" {
        return Ok(None);
    }
    let name = expect_rest(text, "catch", lineno)?
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_string();
    if name.is_empty() {
        return Ok(None);
    }
    if !valid_name(&name) {
        return Err(format!("syntax: line {lineno}: bad catch binding `{name}`"));
    }
    Ok(Some(name))
}

/// `name(p1, p2)` header of a `def` (parens required, names validated).
fn split_def(header: &str, lineno: usize) -> Result<(String, Vec<String>), String> {
    let open = header
        .find('(')
        .ok_or_else(|| format!("syntax: line {lineno}: `def` needs `def name(p1, …):`"))?;
    let name = header[..open].trim().to_string();
    if !valid_name(&name) {
        return Err(format!("syntax: line {lineno}: bad function name `{name}`"));
    }
    if is_reserved(&name) {
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
        if !valid_name(p) || params.iter().any(|q| q == p) {
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

/// Call a user function: bind params as locals, run the body, restore.
/// Globals are readable inside; assignments stay local (Starlark rule).
fn call_func(ip: &mut Interp, name: &str, args: &[Value], lineno: usize) -> Result<Value, String> {
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
    if ip.call_depth >= MAX_CALL_DEPTH {
        return Err(format!(
            "too_large: line {lineno}: call depth exceeds {MAX_CALL_DEPTH} (recursive `def`?)"
        ));
    }
    let saved_vars = ip.vars.clone();
    let saved_flow = ip.flow.take();
    // Params shadow globals of the same name; every other global stays
    // readable. Assignments never escape (restored below — Starlark rule).
    for (param, arg) in def.params.iter().zip(args.iter()) {
        ip.vars.insert(param.clone(), arg.clone());
    }
    ip.call_depth += 1;
    // Body lines outdent one step below their first line.
    let parent = def
        .body
        .first()
        .map(|l| l.indent as isize - 1)
        .unwrap_or(-1);
    let mut result = run_block(ip, &def.body.clone(), 0, parent).map(|_| Value::Null);
    let returned = ip.flow.take().unwrap_or(Value::Null);
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

/// Inline shell through the capability gate (single choke point for every
/// `sh` form). Counts the call for the `--json` audit.
fn exec_checked(ip: &mut Interp, line: &str) -> Result<String, String> {
    ip.caps.check_exec(line)?;
    ip.sh_calls += 1;
    (ip.host.exec)(line)
}

/// Fetch through the capability gate + optional host client.
fn fetch_checked(ip: &mut Interp, url: &str, lineno: usize) -> Result<String, String> {
    ip.caps.check_fetch(url)?;
    ip.fetch_calls += 1;
    match ip.host.fetch {
        Some(fetch) => fetch(url)
            .map(|text| truncate_owned(text, MAX_STR))
            .map_err(|e| format!("line {lineno}: {e}")),
        None => Err(format!(
            "unsupported: `fetch {url}` needs the browser/static transport (this shell has no HTTP client) — run the same `.cybsh` on Pages, replay a journal (`--replay`), or serve it via `POST /api/os/exec` on the dashboard worker"
        )),
    }
}

/// `--json` output becomes structure: objects → Dict (sorted keys),
/// arrays → List, scalars → themselves. Anything else stays a string,
/// so plain-text commands never break.
fn materialize_json(text: &str) -> Option<Value> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    Some(json_to_value(&value))
}

fn json_to_value(value: &serde_json::Value) -> Value {
    match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => Value::Str(truncate_owned(s.clone(), MAX_STR)),
        serde_json::Value::Array(items) => {
            Value::List(items.iter().take(MAX_LIST).map(json_to_value).collect())
        }
        serde_json::Value::Object(map) => Value::Dict(
            map.iter()
                .take(MAX_LIST)
                .map(|(k, v)| (k.clone(), json_to_value(v)))
                .collect(),
        ),
    }
}

/// Right-hand side of an assignment: `sh "…"` / `js: …` / `fetch …` keep
/// their statement meaning; everything else is an expression.
fn eval_assign_rhs(ip: &mut Interp, src: &str, lineno: usize) -> Result<Value, String> {
    let t = src.trim();
    if is_kw(t, "sh") {
        let rest = expect_rest(t, "sh", lineno)?.trim().to_string();
        let cmdline = unquote(&rest, lineno)?.unwrap_or(rest);
        let expanded = interpolate(ip, &cmdline, lineno)?;
        return inline_value(ip, &expanded, lineno);
    }
    if t.starts_with("js:") {
        let expr_src = normalize_js(t["js:".len()..].trim());
        return eval_expr(ip, &expr_src, lineno);
    }
    if is_kw(t, "fetch") {
        let rest = expect_rest(t, "fetch", lineno)?;
        let (url_src, _) = split_fetch(rest);
        let url = eval_expr(ip, &url_src, lineno)?.display();
        let text = fetch_checked(ip, &url, lineno)?;
        let v = Value::Str(text);
        ip.set_var("_", v.clone())?;
        return Ok(v);
    }
    eval_expr(ip, t, lineno)
}

/// Shared inline-shell capture: `--json` output materializes into
/// structure, anything else stays a string; `_` always keeps the value.
fn inline_value(ip: &mut Interp, cmdline: &str, lineno: usize) -> Result<Value, String> {
    match exec_checked(ip, cmdline) {
        Ok(text) => {
            harvest_effects(ip, &text);
            let v = materialize_json(&text)
                .unwrap_or_else(|| Value::Str(truncate_owned(text, MAX_STR)));
            ip.set_var("_", v.clone())?;
            Ok(v)
        }
        Err(e) => Err(format!("{e} (line {lineno})")),
    }
}

fn eval_print_args(ip: &mut Interp, src: &str, lineno: usize) -> Result<String, String> {
    let parts = split_top_commas(src);
    if parts.len() == 1 {
        return Ok(eval_expr(ip, src.trim(), lineno)?.display());
    }
    let mut out = Vec::new();
    for p in parts {
        out.push(eval_expr(ip, &p, lineno)?.display());
    }
    Ok(out.join(" "))
}

/// Normalize JS/TS operator spellings to the script grammar before parsing.
fn normalize_js(src: &str) -> String {
    src.replace("===", "==")
        .replace("!==", "!=")
        .replace("&&", " and ")
        .replace("||", " or ")
}

fn check_str_cap(v: &Value, lineno: usize) -> Result<(), String> {
    if let Value::Str(s) = v {
        if s.len() > MAX_STR {
            return Err(format!(
                "too_large: line {lineno}: value is {} bytes, limit is {MAX_STR} (`sh` output is capped automatically; split the data)",
                s.len()
            ));
        }
    }
    Ok(())
}

fn truncate_owned(s: String, cap: usize) -> String {
    if s.len() <= cap {
        return s;
    }
    let mut out = s;
    out.truncate(cap);
    out
}

fn truncate_str(s: &str, cap: usize) -> String {
    if s.len() <= cap {
        return s.to_string();
    }
    format!("{}…", &s[..cap])
}

/// `${var}` interpolation for inline shell lines (missing vars stay literal
/// so shell `$` idioms never break loudly).
fn interpolate(ip: &Interp, src: &str, _lineno: usize) -> Result<String, String> {
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
                if let Some(v) = ip.vars.get(name.trim()) {
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
    Ok(out)
}

fn unquote(s: &str, lineno: usize) -> Result<Option<String>, String> {
    let t = s.trim();
    if t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
    {
        return Ok(Some(t[1..t.len() - 1].to_string()));
    }
    if (t.starts_with('"') || t.starts_with('\'')) && t.len() >= 1 {
        return Err(format!("syntax: line {lineno}: unclosed quote in `{t}`"));
    }
    Ok(None)
}

/// First word must be a real cybsh verb for a bare line to count as inline
/// shell (same table as `help`, plus the script verbs themselves excluded
/// to avoid `run`-in-`run` surprises — those still work via `sh "run …"`).
const BARE_VERBS: &[&str] = &[
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
    "oauth",
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
    "compress",
    "decompress",
    "search",
    "grep",
    "find",
    "head",
    "tail",
    "wc",
    "write",
    "edit",
    "ai",
    "theme",
    "ui",
];

fn bare_verb(text: &str) -> Option<&str> {
    let word = first_word(text);
    BARE_VERBS.iter().find(|v| **v == word).copied()
}

// ─── expressions ────────────────────────────────────────────────────────

struct ExprParser<'b, 'a> {
    chars: Vec<char>,
    pos: usize,
    ip: &'b mut Interp<'a>,
    lineno: usize,
}

fn eval_expr(ip: &mut Interp, src: &str, lineno: usize) -> Result<Value, String> {
    // `fetch …` never evaluates here either (see eval_assign_rhs).
    let mut p = ExprParser {
        chars: src.chars().collect(),
        pos: 0,
        ip,
        lineno,
    };
    let v = p.parse_or()?;
    p.skip_ws();
    if p.pos < p.chars.len() {
        return Err(format!(
            "syntax: line {lineno}: unexpected `{}` in expression",
            p.chars[p.pos..].iter().collect::<String>().trim()
        ));
    }
    check_str_cap(&v, lineno)?;
    Ok(v)
}

fn is_truthy_cond(ip: &mut Interp, src: &str, lineno: usize) -> Result<bool, String> {
    Ok(eval_expr(ip, src, lineno)?.truthy())
}

impl<'b, 'a> ExprParser<'b, 'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.chars.len() && self.chars[self.pos].is_whitespace() {
            self.pos += 1;
        }
    }

    fn eat(&mut self, word: &str) -> bool {
        self.skip_ws();
        let end = self.pos + word.len();
        if end <= self.chars.len() && self.chars[self.pos..end].iter().collect::<String>() == word {
            // Word operators (`and`/`or`/`not`) must not prefix an identifier.
            if word.chars().all(|c| c.is_ascii_alphabetic())
                && end < self.chars.len()
                && (self.chars[end].is_ascii_alphanumeric() || self.chars[end] == '_')
            {
                return false;
            }
            self.pos = end;
            return true;
        }
        false
    }

    fn parse_or(&mut self) -> Result<Value, String> {
        let mut left = self.parse_and()?;
        loop {
            if self.eat("or") || self.eat("||") {
                let right = self.parse_and()?;
                left = Value::Bool(left.truthy() || right.truthy());
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_and(&mut self) -> Result<Value, String> {
        let mut left = self.parse_not()?;
        loop {
            if self.eat("and") || self.eat("&&") {
                let right = self.parse_not()?;
                left = Value::Bool(left.truthy() && right.truthy());
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_not(&mut self) -> Result<Value, String> {
        if self.eat("not") {
            return Ok(Value::Bool(!self.parse_not()?.truthy()));
        }
        self.skip_ws();
        if self.pos < self.chars.len() && self.chars[self.pos] == '!' {
            // `!=` is handled one level down; a lone `!` is JS negation.
            let next = self.chars.get(self.pos + 1).copied().unwrap_or(' ');
            if next != '=' {
                self.pos += 1;
                return Ok(Value::Bool(!self.parse_not()?.truthy()));
            }
        }
        self.parse_cmp()
    }

    fn parse_cmp(&mut self) -> Result<Value, String> {
        let left = self.parse_add()?;
        self.skip_ws();
        for op in ["==", "!=", "<=", ">=", "<", ">"] {
            if self.eat_op(op) {
                let right = self.parse_add()?;
                return Ok(Value::Bool(compare(&left, op, &right)));
            }
        }
        Ok(left)
    }

    fn eat_op(&mut self, op: &str) -> bool {
        self.skip_ws();
        let end = self.pos + op.len();
        if end <= self.chars.len() && self.chars[self.pos..end].iter().collect::<String>() == op {
            // `<` must not eat the `<` of `<=` (checked longest-first above,
            // but `=` after `<`/`>` belongs to this same match attempt).
            self.pos = end;
            return true;
        }
        false
    }

    fn parse_add(&mut self) -> Result<Value, String> {
        let mut left = self.parse_mul()?;
        loop {
            self.skip_ws();
            if self.pos < self.chars.len()
                && (self.chars[self.pos] == '+' || self.chars[self.pos] == '-')
            {
                let op = self.chars[self.pos];
                self.pos += 1;
                let right = self.parse_mul()?;
                left = arith(&left, op, &right, self.lineno)?;
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_mul(&mut self) -> Result<Value, String> {
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
                left = arith(&left, op, &right, self.lineno)?;
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_unary(&mut self) -> Result<Value, String> {
        self.skip_ws();
        if self.pos < self.chars.len() && self.chars[self.pos] == '-' {
            self.pos += 1;
            let v = self.parse_unary()?;
            return match v.as_f64() {
                Some(n) => Ok(Value::Num(-n)),
                None => Err(format!("syntax: line {}: `-` needs a number", self.lineno)),
            };
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Value, String> {
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
            Value::Str(self.parse_string()?)
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
                    "true" => Value::Bool(true),
                    "false" => Value::Bool(false),
                    "null" | "none" | "nil" => Value::Null,
                    "and" | "or" | "not" => {
                        return Err(format!(
                            "syntax: line {}: `{ident}` outside an expression",
                            self.lineno
                        ))
                    }
                    _ => self.ip.vars.get(&ident).cloned().ok_or_else(|| {
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
                base = index_field(&base, &field, self.lineno)?;
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
                base = index_value(&base, &key, self.lineno)?;
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
                return Ok(interpolate_str(&out, &self.ip.vars));
            }
            out.push(c);
            self.pos += 1;
        }
        Err(format!("syntax: line {}: unclosed string", self.lineno))
    }

    fn parse_number(&mut self) -> Result<Value, String> {
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
            .map(Value::Num)
            .map_err(|_| format!("syntax: line {}: bad number `{raw}`", self.lineno))
    }

    fn parse_dict(&mut self) -> Result<Value, String> {
        // `{` already peeked. Keys are string literals or bare idents.
        self.pos += 1;
        let mut map = BTreeMap::new();
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == '}' {
                self.pos += 1;
                return Ok(Value::Dict(map));
            }
            if map.len() >= MAX_LIST {
                return Err(format!(
                    "syntax: line {}: dict exceeds {MAX_LIST} keys",
                    self.lineno
                ));
            }
            self.skip_ws();
            if self.pos >= self.chars.len() {
                return Err(format!("syntax: line {}: unclosed `{{`", self.lineno));
            }
            let key = if self.chars[self.pos] == '"' || self.chars[self.pos] == '\'' {
                self.parse_string()?
            } else if self.chars[self.pos].is_ascii_alphabetic() || self.chars[self.pos] == '_' {
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
            if let Value::Str(s) = &value {
                if s.len() > MAX_STR {
                    return Err(format!(
                        "too_large: line {}: dict value exceeds {MAX_STR} bytes",
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
                return Ok(Value::Dict(map));
            }
            return Err(format!(
                "syntax: line {}: expected `,` or `}}` in dict",
                self.lineno
            ));
        }
    }

    fn parse_list(&mut self) -> Result<Value, String> {
        // `[` already peeked.
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ']' {
                self.pos += 1;
                return Ok(Value::List(items));
            }
            if items.len() >= MAX_LIST {
                return Err(format!(
                    "syntax: line {}: list exceeds {MAX_LIST} items",
                    self.lineno
                ));
            }
            let v = self.parse_or()?;
            items.push(v);
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ',' {
                self.pos += 1;
                continue;
            }
            self.skip_ws();
            if self.pos < self.chars.len() && self.chars[self.pos] == ']' {
                self.pos += 1;
                return Ok(Value::List(items));
            }
            return Err(format!(
                "syntax: line {}: expected `,` or `]` in list",
                self.lineno
            ));
        }
    }

    fn call(&mut self, name: &str) -> Result<Value, String> {
        // `(` already peeked.
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
        // User `def`s first (explicit beats builtin), then the builtins.
        if self.ip.funcs.contains_key(name) {
            let lineno = self.lineno;
            return call_func(self.ip, name, &args, lineno);
        }
        let lineno = self.lineno;
        builtin(name, &args, self.ip, lineno)
    }
}

fn interpolate_str(src: &str, vars: &HashMap<String, Value>) -> String {
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

fn compare(left: &Value, op: &str, right: &Value) -> bool {
    match (left, right) {
        (Value::Num(a), Value::Num(b)) => match op {
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
fn index_field(base: &Value, field: &str, lineno: usize) -> Result<Value, String> {
    match base {
        Value::Dict(map) => map
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
fn index_value(base: &Value, key: &Value, lineno: usize) -> Result<Value, String> {
    match (base, key) {
        (Value::Dict(map), k) => {
            let name = k.display();
            map.get(&name).cloned().ok_or_else(|| {
                format!("not_found: dict has no key `{name}` (line {lineno})")
            })
        }
        (Value::List(items), Value::Num(n)) => {
            let i = *n as i64;
            if i < 0 || i as usize >= items.len() {
                return Err(format!(
                    "not_found: line {lineno}: index {i} out of range (len {})",
                    items.len()
                ));
            }
            Ok(items[i as usize].clone())
        }
        (Value::Str(s), Value::Num(n)) => {
            let chars: Vec<char> = s.chars().collect();
            let i = *n as i64;
            if i < 0 || i as usize >= chars.len() {
                return Err(format!(
                    "not_found: line {lineno}: index {i} out of range (len {})",
                    chars.len()
                ));
            }
            Ok(Value::Str(chars[i as usize].to_string()))
        }
        (base, key) => Err(format!(
            "syntax: line {lineno}: cannot index {} with {} (dicts take keys, lists/strings take numbers)",
            base.type_name(),
            key.type_name()
        )),
    }
}

fn arith(left: &Value, op: char, right: &Value, lineno: usize) -> Result<Value, String> {
    // `+` concatenates when either side is a string (JS-flavoured, handy).
    if op == '+' && (matches!(left, Value::Str(_)) || matches!(right, Value::Str(_))) {
        let mut s = left.display();
        s.push_str(&right.display());
        if s.len() > MAX_STR {
            return Err(format!(
                "too_large: line {lineno}: string grew past {MAX_STR} bytes"
            ));
        }
        return Ok(Value::Str(s));
    }
    // `*` repeats a string: `"ab" * 3` (capped).
    if op == '*' {
        if let (Value::Str(s), Value::Num(n)) | (Value::Num(n), Value::Str(s)) = (left, right) {
            let times = (*n).max(0.0).min(256.0) as usize;
            if s.len() * times > MAX_STR {
                return Err(format!(
                    "too_large: line {lineno}: repeat exceeds {MAX_STR} bytes"
                ));
            }
            return Ok(Value::Str(s.repeat(times)));
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
        '+' => Ok(Value::Num(a + b)),
        '-' => Ok(Value::Num(a - b)),
        '*' => Ok(Value::Num(a * b)),
        '/' => {
            if b == 0.0 {
                return Err(format!("syntax: line {lineno}: division by zero"));
            }
            Ok(Value::Num(a / b))
        }
        '%' => {
            if b == 0.0 {
                return Err(format!("syntax: line {lineno}: modulo by zero"));
            }
            Ok(Value::Num(a % b))
        }
        _ => Err(format!("syntax: line {lineno}: unknown operator `{op}`")),
    }
}

/// Builtins shared by every transport: `len/int/str/json/split/range/sh`
/// plus the functional updaters `set/push/del` and `keys/values` for dicts
/// (values are owned, so updates return new values — Starlark rule).
/// `fetch` is intentionally absent — it needs a network client, so it
/// stays an honest `unsupported:` at the statement level instead.
fn builtin(name: &str, args: &[Value], ip: &mut Interp, lineno: usize) -> Result<Value, String> {
    let arity = |min: usize, max: usize| -> Result<(), String> {
        if args.len() < min || args.len() > max {
            return Err(format!(
                "syntax: line {lineno}: `{name}` takes {min}–{max} argument(s), got {}",
                args.len()
            ));
        }
        Ok(())
    };
    match name {
        "len" => {
            arity(1, 1)?;
            Ok(Value::Num(match &args[0] {
                Value::Str(s) => s.chars().count() as f64,
                Value::List(l) => l.len() as f64,
                Value::Dict(d) => d.len() as f64,
                Value::Num(n) => *n,
                Value::Bool(true) => 1.0,
                Value::Bool(false) | Value::Null => 0.0,
            }))
        }
        "int" => {
            arity(1, 1)?;
            args[0].as_f64().map(|n| Value::Num(n.trunc())).ok_or_else(|| {
                format!("syntax: line {lineno}: `int` needs a number-like value")
            })
        }
        "str" => {
            arity(1, 1)?;
            Ok(Value::Str(truncate_owned(args[0].display(), MAX_STR)))
        }
        // `json(text)` materializes structure (objects → Dict, arrays →
        // List) so `--json` verbs compose without re-parsing (Nushell rule).
        "json" => {
            arity(1, 1)?;
            let text = args[0].display();
            materialize_json(&text).ok_or_else(|| {
                format!("syntax: line {lineno}: `json` needs valid JSON text")
            })
        }
        "split" => {
            arity(1, 2)?;
            let Value::Str(text) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `split` takes a string (got {})",
                    args[0].type_name()
                ));
            };
            let items: Vec<Value> = if args.len() == 2 {
                let delim = args[1].display();
                if delim.is_empty() {
                    text.chars().map(|c| Value::Str(c.to_string())).collect()
                } else {
                    text.split(&delim as &str).map(|s| Value::Str(s.to_string())).collect()
                }
            } else if text.contains('\n') {
                text.lines().map(|l| Value::Str(l.to_string())).collect()
            } else {
                text.split_whitespace().map(|w| Value::Str(w.to_string())).collect()
            };
            if items.len() > MAX_LIST {
                return Err(format!("too_large: line {lineno}: split produced {} items (limit {MAX_LIST})", items.len()));
            }
            Ok(Value::List(items))
        }
        "range" => {
            arity(1, 2)?;
            let (start, end) = if args.len() == 2 {
                (
                    args[0].as_f64().unwrap_or(0.0) as i64,
                    args[1].as_f64().unwrap_or(0.0) as i64,
                )
            } else {
                (0, args[0].as_f64().unwrap_or(0.0) as i64)
            };
            let count = end.saturating_sub(start).max(0).min(MAX_ITERS as i64) as usize;
            Ok(Value::List((0..count).map(|i| Value::Num((start + i as i64) as f64)).collect()))
        }
        // `sh(cmd)` runs inline shell and materializes `--json` output.
        "sh" => {
            arity(1, 1)?;
            let cmdline = args[0].display();
            inline_value(ip, &cmdline, lineno)
        }
        // `set(dict, key, value)` → new dict (functional update).
        "set" => {
            arity(3, 3)?;
            let Value::Dict(map) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `set` takes a dict (got {})",
                    args[0].type_name()
                ));
            };
            let mut next = map.clone();
            next.insert(args[1].display(), args[2].clone());
            if next.len() > MAX_LIST {
                return Err(format!("too_large: line {lineno}: dict exceeds {MAX_LIST} keys"));
            }
            Ok(Value::Dict(next))
        }
        // `push(list, value)` → new list.
        "push" => {
            arity(2, 2)?;
            let Value::List(items) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `push` takes a list (got {})",
                    args[0].type_name()
                ));
            };
            if items.len() >= MAX_LIST {
                return Err(format!("too_large: line {lineno}: list exceeds {MAX_LIST} items"));
            }
            let mut next = items.clone();
            next.push(args[1].clone());
            Ok(Value::List(next))
        }
        // `del(dict, key)` → new dict without the key.
        "del" => {
            arity(2, 2)?;
            let Value::Dict(map) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `del` takes a dict (got {})",
                    args[0].type_name()
                ));
            };
            let mut next = map.clone();
            next.remove(&args[1].display());
            Ok(Value::Dict(next))
        }
        // `keys(dict)` → sorted key list; `values(dict)` → matching values.
        "keys" => {
            arity(1, 1)?;
            let Value::Dict(map) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `keys` takes a dict (got {})",
                    args[0].type_name()
                ));
            };
            Ok(Value::List(map.keys().map(|k| Value::Str(k.clone())).collect()))
        }
        "values" => {
            arity(1, 1)?;
            let Value::Dict(map) = &args[0] else {
                return Err(format!(
                    "syntax: line {lineno}: `values` takes a dict (got {})",
                    args[0].type_name()
                ));
            };
            Ok(Value::List(map.values().cloned().collect()))
        }
        _ => Err(format!(
            "syntax: line {lineno}: unknown function `{name}` (try `len/int/str/json/split/range/sh/set/push/del/keys/values` or `def` it first)"
        )),
    }
}

fn split_top_commas(src: &str) -> Vec<String> {
    let chars: Vec<char> = src.chars().collect();
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            i += 1;
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
        i += 1;
    }
    if !cur.trim().is_empty() || !parts.is_empty() {
        parts.push(cur.trim().to_string());
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn stub_echo() -> impl Fn(&str) -> Result<String, String> {
        |line: &str| {
            if line.starts_with("echo ") {
                Ok(line["echo ".len()..].to_string())
            } else if line.starts_with("unknown") {
                Err("unknown command: 'unknown'".to_string())
            } else {
                Ok(format!("ran:{line}"))
            }
        }
    }

    fn host<'a>(exec: &'a dyn Fn(&str) -> Result<String, String>) -> Host<'a> {
        Host { exec, fetch: None }
    }

    fn run_ok(src: &str) -> RunOutput {
        let stub = stub_echo();
        run_source(src, &host(&stub)).expect("script runs")
    }

    fn run_err(src: &str) -> String {
        let stub = stub_echo();
        run_source(src, &host(&stub)).expect_err("script fails")
    }

    #[test]
    fn print_if_elif_else_and_vars() {
        let out = run_ok("let x = 2\nif x == 2:\n  print \"two\"\nelse:\n  print \"other\"\n");
        assert_eq!(out.text, "two");
        let out = run_ok("let x: number = 1\nif x == 9:\n  print \"nine\"\nelif x == 1:\n  print \"one\"\nelse:\n  print \"other\"\n");
        assert_eq!(out.text, "one");
    }

    #[test]
    fn inline_shell_and_interpolation() {
        let out = run_ok("let name = \"world\"\n$ echo hello ${name}\nprint len(\"abcd\")\n");
        assert_eq!(out.text, "hello world\n4");
    }

    #[test]
    fn for_range_and_while() {
        let out = run_ok("for i in range(3):\n  print i\n");
        assert_eq!(out.text, "0\n1\n2");
        let out = run_ok("let n = 0\nwhile n < 3:\n  let n = n + 1\nprint n\n");
        assert_eq!(out.text, "3");
    }

    #[test]
    fn js_subset_and_arith() {
        let out = run_ok("let x = js: 1 + 2 * 3\nprint x\nprint \"ab\" * 3\n");
        assert_eq!(out.text, "7\nababab");
    }

    #[test]
    fn fetch_refuses_honestly() {
        let err = run_err("fetch \"https://example.com\"\n");
        assert!(err.starts_with("unsupported:"), "got {err}");
    }

    #[test]
    fn fetch_serves_from_a_journal_host() {
        let stub = stub_echo();
        let out = run_source(
            "fetch \"https://example.com/x\" as body\nprint len(body)\n",
            &Host {
                exec: &stub,
                fetch: Some(&|url: &str| Ok(format!("page:{url}"))),
            },
        )
        .expect("runs");
        assert!(out.text.contains("26"), "got {}", out.text);
    }

    #[test]
    fn budgets_stop_abuse() {
        let many = "print 1\n".repeat(250);
        let stub = stub_echo();
        assert!(run_source(&many, &host(&stub)).is_err());
        let err = run_err("while true:\n  print 1\n");
        assert!(err.contains("1000") || err.contains("steps"), "got {err}");
    }

    #[test]
    fn memory_builtins_work() {
        let seen = RefCell::new(Vec::new());
        let exec = |line: &str| {
            seen.borrow_mut().push(line.to_string());
            Ok("out".to_string())
        };
        let out =
            run_source("let a = 1\n$ echo hi\nvars\ngc\nfree a\n", &host(&exec)).expect("runs");
        assert!(out.text.contains("a: number = 1"));
        assert!(out.text.contains("gc:"));
        assert!(out.text.contains("freed a"));
    }

    #[test]
    fn unknown_statements_error_loudly() {
        let err = run_err("frobnicate 1\n");
        assert!(err.starts_with("syntax:"), "got {err}");
    }

    #[test]
    fn dicts_index_and_update_functionally() {
        let out = run_ok("let d = {\"b\": 2, \"a\": 1}\nprint d\nprint d.a\nprint d[\"b\"]\n");
        assert_eq!(out.text, "{\"a\": 1, \"b\": 2}\n1\n2");
        let out = run_ok(
            "let d = {a: 1}\nlet e = set(d, \"b\", 2)\nprint keys(e)\nprint len(e)\nprint len(d)\n",
        );
        assert_eq!(out.text, "[a, b]\n2\n1");
        let out = run_ok("let l = push([1], 2)\nprint l[1]\nprint del({a: 1, b: 2}, \"a\")\n");
        assert_eq!(out.text, "2\n{\"b\": 2}");
    }

    #[test]
    fn json_materializes_structure() {
        let out = run_ok("let v = json(\"{\\\"a\\\": [1, 2]}\")\nprint v.a[1]\nprint v.a\n");
        assert_eq!(out.text, "2\n[1, 2]");
    }

    #[test]
    fn dict_commas_survive_print_splitting() {
        let out = run_ok("print {a: 1, b: 2}, \"x\"\n");
        assert_eq!(out.text, "{\"a\": 1, \"b\": 2} x");
        let out = run_ok("let d = {a: 1, b: 2}\nprint len(d)\n");
        assert_eq!(out.text, "2");
    }

    #[test]
    fn try_catch_and_fail() {
        let out = run_ok("try:\n  $ unknown boom\ncatch e:\n  print \"caught\"\nprint \"after\"\n");
        assert_eq!(out.text, "caught\nafter");
        let err = run_err("try:\n  fail \"nope\"\ncatch:\n  fail \"worse\"\n");
        assert!(err.contains("worse"), "got {err}");
        let err = run_err("fail \"stop\"\n");
        assert!(err.starts_with("fail:"), "got {err}");
    }

    #[test]
    fn def_return_and_scope() {
        let out = run_ok("def greet(name):\n  return \"hi \" + name\nprint greet(\"manju\")\n");
        assert_eq!(out.text, "hi manju");
        let out = run_ok("let x = 1\ndef f():\n  let x = 2\n  return x\nprint f()\nprint x\n");
        assert_eq!(out.text, "2\n1");
        let err = run_err("return 1\n");
        assert!(err.contains("outside `def`"), "got {err}");
        let err = run_err("def f(a, a):\n  print a\n");
        assert!(err.contains("duplicate"), "got {err}");
    }

    #[test]
    fn expression_statements_unify_shell_forms() {
        let out = run_ok("sh(\"echo yo\")\n");
        assert_eq!(out.text, "yo");
    }

    #[test]
    fn version_pins_gate_mismatches() {
        let out = run_ok("# cybsh: 1\nprint 1\n");
        assert_eq!(out.text, "1");
        let err = run_err("# cybsh: 99\nprint 1\n");
        assert!(err.starts_with("unsupported:"), "got {err}");
    }

    #[test]
    fn capabilities_deny_verbs_and_scope_fetch() {
        let err = run_err("# cap: deny=rm\n$ rm /x\n");
        assert!(err.starts_with("denied:"), "got {err}");
        let err = run_err("# cap: net=example.com\nfetch \"https://evil.test/x\"\n");
        assert!(err.starts_with("denied:"), "got {err}");
        let out = run_ok("# cap: deny=rm\nprint \"ambient ok\"\n");
        assert_eq!(out.text, "ambient ok");
        assert!(out.caps.map(|c| c.active).unwrap_or(false));
    }

    #[test]
    fn fingerprint_is_stable_hex() {
        assert_eq!(fingerprint("a"), fingerprint("a"));
        assert_ne!(fingerprint("a"), fingerprint("b"));
        assert_eq!(fingerprint("a").len(), 16);
    }
}
