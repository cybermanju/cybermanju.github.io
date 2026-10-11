// CyberManju OS — shared code-intelligence core.
//
// Pure functions, no I/O, no OS calls: language detection plus the heuristic
// symbol extractor. Lives here (not in `src-tauri`) so every transport uses
// the same fallback — the Tauri desktop commands, the `POST /api/code/parse`
// REST route, and later the WASM dispatcher. The real tree-sitter grammars
// stay in `src-tauri/src/tree_sitter` (they need C toolchains); the JSON
// shape produced here is identical, only `"engine"` differs.

use serde_json::{json, Value};

/// Map a file extension to a language name.
pub fn detect_language(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "go" => "go",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" | "cxx" => "cpp",
        "java" => "java",
        "rb" => "ruby",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "html" | "htm" => "html",
        "css" | "scss" | "less" => "css",
        "json" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" | "mdx" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "bash",
        "lua" => "lua",
        "zig" => "zig",
        "ex" | "exs" => "elixir",
        "vue" => "vue",
        "svelte" => "svelte",
        "dart" => "dart",
        "r" => "r",
        "scala" => "scala",
        "hs" => "haskell",
        "clj" | "cljs" => "clojure",
        "pl" | "pm" => "perl",
        "php" => "php",
        "cs" => "csharp",
        "fs" | "fsi" => "fsharp",
        "vb" => "visualbasic",
        "proto" => "protobuf",
        "graphql" | "gql" => "graphql",
        "dockerfile" => "dockerfile",
        "makefile" => "makefile",
        "cmake" => "cmake",
        _ => "unknown",
    }
}

/// Strip leading export/visibility qualifiers so qualified items still match
/// the keyword tables: `export const`, `pub mod`, `pub(crate)`, `unsafe`,
/// `async`, `declare`, `function` (bash), `pub(in path)`.
fn strip_qualifiers<'a>(mut s: &'a str, language: &str) -> &'a str {
    loop {
        let next = if language == "rust" {
            s.strip_prefix("pub ")
                .or_else(|| s.strip_prefix("pub(crate) "))
                .or_else(|| s.strip_prefix("pub(super) "))
                .or_else(|| s.strip_prefix("unsafe "))
                .or_else(|| s.strip_prefix("async "))
                .or_else(|| s.strip_prefix("extern "))
                .or_else(|| {
                    // `pub(in crate::x)` — skip to the closing paren.
                    s.strip_prefix("pub(in ")
                        .and_then(|rest| rest.find(')').map(|i| &rest[i + 1..]))
                        .map(str::trim_start)
                })
        } else if language == "javascript"
            || language == "typescript"
            || language == "vue"
            || language == "svelte"
        {
            s.strip_prefix("export ")
                .or_else(|| s.strip_prefix("export default "))
                .or_else(|| s.strip_prefix("default "))
                .or_else(|| s.strip_prefix("declare "))
                .or_else(|| s.strip_prefix("abstract "))
                .or_else(|| s.strip_prefix("async "))
        } else if language == "python" {
            s.strip_prefix("async ")
        } else if language == "bash" {
            s.strip_prefix("function ")
        } else {
            None
        };
        match next {
            Some(rest) => s = rest.trim_start(),
            None => return s,
        }
    }
}

/// Go methods carry a receiver: `func (s *Store) Save()` — skip the
/// parenthesized receiver so the method name is what gets reported.
fn strip_go_receiver(s: &str) -> &str {
    let t = s.trim_start();
    if t.starts_with('(') {
        let mut depth = 0u32;
        for (i, c) in t.char_indices() {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
                if depth == 0 {
                    return t[i + 1..].trim_start();
                }
            }
        }
    }
    s
}

/// Rust `impl` name: `Foo`, `Foo<T>`, or the target of `Display for Foo`
/// (leading `impl<T>` generics are skipped, not reported).
fn parse_impl_name(rest: &str) -> &str {
    let mut s = rest.trim_start();
    if s.starts_with('<') {
        let mut depth = 0u32;
        for (i, c) in s.char_indices() {
            if c == '<' {
                depth += 1;
            } else if c == '>' {
                depth -= 1;
                if depth == 0 {
                    s = s[i + 1..].trim_start();
                    break;
                }
            }
        }
    }
    let mut tokens = s.split_whitespace();
    let first = tokens.next().unwrap_or("");
    if first == "const" || first == "unsafe" {
        let second = tokens.next().unwrap_or("");
        return name_token(second);
    }
    // `Trait for Target` — the target is the interesting symbol.
    let mut after_for = "";
    let mut seen_for = false;
    let mut prev = first;
    for tok in tokens {
        if prev == "for" {
            after_for = tok;
            seen_for = true;
            break;
        }
        prev = tok;
    }
    let raw = if seen_for { after_for } else { first };
    name_token(raw)
}

/// First identifier token: cut generics, params, bounds and bodies.
fn name_token(raw: &str) -> &str {
    raw.split(['<', '(', ':', '{', ' ', '=', ';', ','])
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches(['?', '!'])
}

/// True for doc-comment lines (`///`, `//!`, `/**`, `##`, `#:`, `"""`, …).
/// Plain narration (`// …`) is deliberately NOT a doc line — it stays
/// inline-only and is never hoisted into symbol metadata.
fn doc_text(trimmed: &str) -> Option<&str> {
    let body = if let Some(rest) = trimmed.strip_prefix("///") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("//!") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("/**") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("##") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("#:") {
        rest
    } else if trimmed.starts_with("\"\"\"") {
        trimmed.trim_matches('"')
    } else if let Some(rest) = trimmed.strip_prefix("--") {
        rest
    } else if trimmed.starts_with('*') && trimmed.len() > 1 {
        &trimmed[1..]
    } else {
        return None;
    };
    let body = body
        .trim_start_matches(['/', '*', ' ', '#', '!', '-', '>', ':', '"'])
        .trim();
    if body.is_empty() || body.starts_with('*') {
        return None;
    }
    Some(body)
}

/// Extract symbols from source code using heuristic line-by-line scanning.
///
/// Same JSON shape as the tree-sitter path (`name/kind/start_line/end_line/
/// detail/children`, plus an additive `docs` string hoisted from the nearest
/// doc-comment above the item), source-ordered. Used for extensions without
/// a bundled grammar and as the fallback when real parsing finds nothing.
pub fn extract_symbols_heuristic(content: &str, language: &str) -> Vec<Value> {
    let mut symbols = Vec::new();
    let mut line_num: u32 = 0;
    // Nearest doc-comment candidate (text, line); cleared by blank lines and
    // by code that yields no symbol, kept across `#[…]` / `@…` attributes.
    let mut pending_docs: Option<(String, u32)> = None;

    // Language-aware keyword sets (matched AFTER qualifier stripping, so
    // `export const` and `pub mod` are found, not just bare `const`/`mod`).
    let fn_keywords: Vec<&str> = match language {
        "rust" => vec![
            "fn ",
            "mod ",
            "struct ",
            "enum ",
            "trait ",
            "type ",
            "const ",
            "static ",
            "impl ",
            "macro_rules! ",
        ],
        "python" => vec!["def ", "class "],
        "javascript" | "typescript" | "vue" | "svelte" => vec![
            "function ",
            "const ",
            "let ",
            "var ",
            "class ",
            "interface ",
            "enum ",
            "type ",
            "namespace ",
        ],
        "go" => vec!["func ", "type "],
        "java" | "kotlin" | "csharp" => vec![
            "public ",
            "private ",
            "protected ",
            "static ",
            "class ",
            "interface ",
            "enum ",
            "void ",
        ],
        "c" | "cpp" => vec![
            "void ", "int ", "float ", "double ", "char ", "bool ", "auto ", "class ", "struct ",
            "enum ", "typedef ",
        ],
        "ruby" => vec!["def ", "class ", "module "],
        "swift" => vec!["func ", "class ", "struct ", "enum ", "protocol "],
        _ => vec![
            "fn ",
            "function ",
            "def ",
            "class ",
            "struct ",
            "interface ",
            "trait ",
            "impl ",
            "enum ",
            "type ",
        ],
    };

    for line in content.lines() {
        line_num += 1;
        let trimmed = line.trim();

        if trimmed.is_empty() {
            pending_docs = None;
            continue;
        }

        // Doc comment directly above an item becomes its `docs` summary.
        if let Some(body) = doc_text(trimmed) {
            let capped: String = body.chars().take(200).collect();
            pending_docs = Some((capped, line_num));
            continue;
        }

        // Skip other comments.
        if trimmed.starts_with("//")
            || trimmed.starts_with('#')
            || trimmed.starts_with("/*")
            || trimmed.starts_with("<!--")
        {
            continue;
        }

        // Attributes / decorators belong to the item below — keep docs.
        if trimmed.starts_with("#[") || trimmed.starts_with('@') {
            continue;
        }

        // Bash: `name() {`, `name ()`, `function name` (qualifier already cut).
        if language == "bash" {
            if let Some(sym) = bash_symbol(trimmed, line_num, &pending_docs, line_num) {
                pending_docs = None;
                symbols.push(sym);
                continue;
            }
            pending_docs = None;
            continue;
        }

        let normalized = strip_qualifiers(trimmed, language);
        // `const`/`static` only count at top level (column 0): indented ones
        // are function bodies, not module structure (mirrors the JS collector).
        let indented = line.starts_with(' ') || line.starts_with('\t');

        // Check for definitions on the normalized line.
        for kw in &fn_keywords {
            if (kw == &"const " || kw == &"static ") && indented {
                break;
            }
            if let Some(rest) = normalized.strip_prefix(kw) {
                // Go methods carry `func (recv) Name` — strip the receiver
                // after the keyword, never off the whole line.
                let rest = if language == "go" && *kw == "func " {
                    strip_go_receiver(rest)
                } else {
                    rest
                };
                let name = if *kw == "impl " {
                    parse_impl_name(rest)
                } else {
                    name_token(rest)
                };

                if !name.is_empty() {
                    // Determine if this is a function, class, etc.
                    // (`trait` keeps its historical "interface" kind.)
                    let kind = if *kw == "trait " {
                        "interface"
                    } else if normalized.contains("class ")
                        || normalized.contains("struct ")
                        || normalized.contains("enum ")
                        || normalized.contains("interface ")
                        || normalized.contains("trait ")
                        || normalized.contains("protocol ")
                        || normalized.contains("module ")
                    {
                        "class"
                    } else if normalized.contains("namespace ") {
                        "module"
                    } else if normalized.contains("macro_rules") {
                        "macro"
                    } else if kw.contains("const") || kw.contains("static") {
                        "const"
                    } else if kw.trim_start() == "mod " {
                        "module"
                    } else if kw.trim_start() == "type " {
                        "type"
                    } else if normalized.contains("impl ") || *kw == "impl " {
                        "impl"
                    } else {
                        "function"
                    };

                    let docs = pending_docs
                        .as_ref()
                        .filter(|(_, dl)| line_num - *dl <= 4)
                        .map(|(t, _)| t.clone())
                        .unwrap_or_default();
                    symbols.push(json!({
                        "name": name,
                        "kind": kind,
                        "start_line": line_num,
                        "end_line": line_num,
                        "detail": trimmed,
                        "children": [],
                        "docs": docs,
                    }));
                }
                break;
            }
        }
        // Code that is not a definition breaks doc attachment; a matched
        // definition consumes the pending docs.
        pending_docs = None;
    }

    symbols
}

/// Bash function definition: the identifier before `(` in `name() {`.
/// Rejects command substitutions, test brackets and keyword-led lines.
fn bash_symbol(
    trimmed: &str,
    line_num: u32,
    pending_docs: &Option<(String, u32)>,
    _now: u32,
) -> Option<Value> {
    let paren = trimmed.find('(')?;
    let name = trimmed[..paren].trim();
    if name.is_empty()
        || name.contains(' ')
        || name.contains('$')
        || name.contains('[')
        || name.contains('"')
        || name.contains('\'')
    {
        return None;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.' | '/'))
    {
        return None;
    }
    if !name
        .chars()
        .next()
        .map(|c| c.is_ascii_alphabetic() || c == '_' || c == '.')
        .unwrap_or(false)
    {
        return None;
    }
    // `if (`, `while (`… — keyword-led, not a definition.
    if matches!(
        name,
        "if" | "for" | "while" | "until" | "case" | "select" | "function" | "echo" | "test"
    ) {
        return None;
    }
    let docs = pending_docs
        .as_ref()
        .filter(|(_, dl)| line_num - *dl <= 4)
        .map(|(t, _)| t.clone())
        .unwrap_or_default();
    Some(json!({
        "name": name,
        "kind": "function",
        "start_line": line_num,
        "end_line": line_num,
        "detail": trimmed,
        "children": [],
        "docs": docs,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_covers_hot_extensions() {
        assert_eq!(detect_language("main.rs"), "rust");
        assert_eq!(detect_language("app.py"), "python");
        assert_eq!(detect_language("run.go"), "go");
        assert_eq!(detect_language("notes.md"), "markdown");
        assert_eq!(detect_language("noext"), "unknown");
    }

    #[test]
    fn heuristic_finds_functions_in_source_order() {
        let content = "fn alpha() {}\nstruct Beta;\nfn gamma() {}\n";
        let symbols = extract_symbols_heuristic(content, "rust");
        let names: Vec<&str> = symbols.iter().filter_map(|s| s["name"].as_str()).collect();
        assert!(names.contains(&"alpha"), "got {names:?}");
        assert!(names.contains(&"Beta"), "got {names:?}");
        assert_eq!(names.first(), Some(&"alpha"));
    }

    #[test]
    fn heuristic_covers_qualified_items() {
        // `export const` / `export interface` (TS), receivers (Go),
        // `pub mod` + `impl` targets (Rust), `name()` (bash).
        let ts = "export const humanBytes = (n: number) => n;\nexport interface Box {\n}\n";
        let names: Vec<&str> = extract_symbols_heuristic(ts, "typescript")
            .iter()
            .filter_map(|s| s["name"].as_str())
            .collect();
        assert!(names.contains(&"humanBytes"), "got {names:?}");
        assert!(names.contains(&"Box"), "got {names:?}");

        let go = "func (s *Store) Save() {}\nfunc Top() {}\ntype Store struct {}\n";
        let names: Vec<&str> = extract_symbols_heuristic(go, "go")
            .iter()
            .filter_map(|s| s["name"].as_str())
            .collect();
        assert!(names.contains(&"Save"), "got {names:?}");
        assert!(names.contains(&"Top"), "got {names:?}");
        assert!(names.contains(&"Store"), "got {names:?}");

        let rs = "pub mod pipe {}\n/// Hoists the doc.\n#[tauri::command]\npub fn run() {}\nimpl Pipe {}\n";
        let syms = extract_symbols_heuristic(rs, "rust");
        let names: Vec<&str> = syms.iter().filter_map(|s| s["name"].as_str()).collect();
        assert!(names.contains(&"pipe"), "got {names:?}");
        assert!(names.contains(&"run"), "got {names:?}");
        assert!(names.contains(&"Pipe"), "got {names:?}");
        let run = syms.iter().find(|s| s["name"] == "run").unwrap();
        assert_eq!(run["docs"], "Hoists the doc.", "got {}", run["docs"]);

        let sh = "## Check the disk.\ncheck() {\n  df -h\n}\nresult=$(curl x)\n";
        let syms = extract_symbols_heuristic(sh, "bash");
        let names: Vec<&str> = syms.iter().filter_map(|s| s["name"].as_str()).collect();
        assert_eq!(names, vec!["check"], "got {names:?}");
    }
}
