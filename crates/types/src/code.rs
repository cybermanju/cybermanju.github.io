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

/// Extract symbols from source code using heuristic line-by-line scanning.
///
/// Same JSON shape as the tree-sitter path (`name/kind/start_line/end_line/
/// detail/children`), source-ordered. Used for extensions without a bundled
/// grammar and as the fallback when real parsing finds nothing.
pub fn extract_symbols_heuristic(content: &str, language: &str) -> Vec<Value> {
    let mut symbols = Vec::new();
    let mut line_num: u32 = 0;

    // Language-aware keyword sets
    let fn_keywords = match language {
        "rust" => vec![
            "fn ",
            "pub fn ",
            "pub(crate) fn ",
            "pub(super) fn ",
            "async fn ",
            "pub async fn ",
        ],
        "python" => vec!["def "],
        "javascript" | "typescript" => vec![
            "function ",
            "const ",
            "let ",
            "var ",
            "class ",
            "async function ",
            "export function ",
            "export default function ",
        ],
        "go" => vec!["func "],
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

        // Skip comments and empty lines
        if trimmed.is_empty()
            || trimmed.starts_with("//")
            || trimmed.starts_with('#')
            || trimmed.starts_with("/*")
        {
            continue;
        }

        // Check for function definitions
        for kw in &fn_keywords {
            if let Some(rest) = trimmed.strip_prefix(kw) {
                let name = rest
                    .split(['(', '<', ':', '{', ' '])
                    .next()
                    .unwrap_or("")
                    .trim();

                if !name.is_empty() {
                    // Determine if this is a function, class, etc.
                    let kind = if trimmed.contains("class ")
                        || trimmed.contains("struct ")
                        || trimmed.contains("enum ")
                        || trimmed.contains("interface ")
                        || trimmed.contains("trait ")
                        || trimmed.contains("protocol ")
                        || trimmed.contains("module ")
                    {
                        "class"
                    } else if trimmed.contains("impl ") {
                        "impl"
                    } else {
                        "function"
                    };

                    symbols.push(json!({
                        "name": name,
                        "kind": kind,
                        "start_line": line_num,
                        "end_line": line_num,
                        "detail": trimmed,
                        "children": [],
                    }));
                }
                break;
            }
        }

        // Rust-specific: trait / struct / enum, with or without `pub`
        if language == "rust" {
            let spec = ["trait ", "struct ", "enum "]
                .iter()
                .find_map(|kw| trimmed.strip_prefix(kw).map(|_| (*kw, 1usize)))
                .or_else(|| {
                    ["pub trait ", "pub struct ", "pub enum "]
                        .iter()
                        .find_map(|kw| trimmed.strip_prefix(kw).map(|_| (*kw, 2usize)))
                });
            if let Some((kw, name_ix)) = spec {
                let kind = if kw.starts_with("trait") {
                    "interface"
                } else {
                    "class"
                };
                let name = trimmed
                    .split_whitespace()
                    .nth(name_ix)
                    .unwrap_or("anonymous")
                    .split(['<', '{', ';'])
                    .next()
                    .unwrap_or("anonymous")
                    .trim();
                let name = if name.is_empty() { "anonymous" } else { name };
                symbols.push(json!({
                    "name": name,
                    "kind": kind,
                    "start_line": line_num,
                    "end_line": line_num,
                    "detail": trimmed,
                    "children": [],
                }));
                continue;
            }
        }
    }

    symbols
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
}
