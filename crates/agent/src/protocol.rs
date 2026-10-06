// Provider wire protocol: request builders, response parsers, tool schemas.
//
// Two dialects, one normalized shape. Everything here is pure JSON in/out;
// the actual HTTP hop is caller-provided (blocking reqwest behind `native`,
// `fetch` in os-wasm, the dashboard proxy later). Errors carry the house
// machine prefixes (`auth:`, `rate_limited:`, `network:`, `integrity:`).

use cybermanju_types::agent::{AuthScheme, ChatMessage, ProviderPreset, TokenUsage, ToolCall};

// ─── tool schemas (one set, every transport) ──────────────────────────────

/// The agent's tool surface. Native executes these against the Kernel and
/// the volume; WASM executes the file subset against its volume map
/// (`bash`/`task` answer `unsupported:` there — no fake success).
/// Descriptions double as the model's usage guide — keep them imperative
/// and specific about arguments, limits, and failure modes.
pub const TOOL_NAMES: &[&str] = &[
    "read",
    "write",
    "edit",
    "list",
    "grep",
    "glob",
    "bash",
    "task",
    "question",
    "memory_recall",
    "memory_remember",
];

fn tool_def(
    name: &str,
    description: &str,
    properties: serde_json::Value,
    required: &[&str],
) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    })
}

/// Canonical tool definitions (name/description/JSON-schema).
pub fn tool_definitions() -> Vec<serde_json::Value> {
    vec![
        tool_def(
            "read",
            "Read a UTF-8 text file. Always read a file before editing it. Prints the file, then a final `[blake3:<hex>]` line: pass it back as expected_hash on a later edit, and never write it back (write/edit strip it). Refuses encrypted, binary and oversized files with a prefixed error.",
            serde_json::json!({ "path": { "type": "string", "description": "Volume path: leading / = volume root, else working-dir-relative" } }),
            &["path"],
        ),
        tool_def(
            "write",
            "Create or overwrite a whole text file (a version is snapshotted first where supported). Prefer edit for small changes.",
            serde_json::json!({
                "path": { "type": "string" },
                "content": { "type": "string", "description": "Complete new file content" },
            }),
            &["path", "content"],
        ),
        tool_def(
            "edit",
            "Replace ONE exact old_block with new_block. Fails when the block is missing (not_found:) or occurs more than once (conflict:) — then re-read and send a larger unique block. Pass expected_hash (the `[blake3:<hex>]` line a read printed, or the blake3: of a prior write/edit) when writers may race you.",
            serde_json::json!({
                "path": { "type": "string" },
                "old_block": { "type": "string", "description": "Exact current text to replace" },
                "new_block": { "type": "string", "description": "Replacement text" },
                "expected_hash": { "type": "string", "description": "Optional BLAKE3 hex (or a unique prefix) of the file before editing" },
            }),
            &["path", "old_block", "new_block"],
        ),
        tool_def(
            "list",
            "List one directory level. Start orientation at / then drill in.",
            serde_json::json!({ "path": { "type": "string", "description": "Directory, default \"/\"" } }),
            &[],
        ),
        tool_def(
            "grep",
            "Regex search over file contents (an invalid regex searches literally). Use it to locate code; never guess locations. Bounded scan with a match cap.",
            serde_json::json!({
                "pattern": { "type": "string", "description": "Regex (e.g. fn\\s+\\w+)" },
                "path": { "type": "string", "description": "Subdirectory, default \"/\"" },
                "limit": { "type": "integer", "description": "Max matches, default 50" },
            }),
            &["pattern"],
        ),
        tool_def(
            "glob",
            "Find files by pattern without walking whole trees. * stays inside one path segment, ** crosses separators (src/**/*.rs, **/Cargo.toml).",
            serde_json::json!({
                "pattern": { "type": "string", "description": "Glob pattern, default \"**\"" },
                "path": { "type": "string", "description": "Subdirectory to search under, default \"/\"" },
                "limit": { "type": "integer", "description": "Max paths, default 200" },
            }),
            &[],
        ),
        tool_def(
            "bash",
            "Run a command with a timeout (native transports only). cybsh FIRST for volume work: ls/cd/pwd/cat/cp/mv/rm/mkdir/touch/stat/du/df/disk/mount/search/sync/scrub/repair/gc/lease/ps/compute/keygen/encrypt/decrypt/ai (same shell as the Terminal; pass explicit paths). curl/wget for raw network fetch. Prefer mcp__exa__web_search_exa for web search and mcp__exa__web_fetch_exa for pages. The system prompt states the config's shell_mode (auto/cybsh-only/device-only) — obey it. Never run interactive commands; destructive commands pause for approval.",
            serde_json::json!({
                "command": { "type": "string" },
                "timeout_secs": { "type": "integer", "description": "Default 120, clamped 5-600 (shell fallback only)" },
            }),
            &["command"],
        ),
        tool_def(
            "task",
            "Launch one bounded read-only subagent for a delegated exploration goal. One nesting level max.",
            serde_json::json!({
                "goal": { "type": "string" },
                "context": { "type": "string", "description": "Relevant file paths or notes" },
            }),
            &["goal"],
        ),
        // The system prompt advertises this tool, so it must exist in the
        // schema too: schema-driven providers refuse to emit a tool name
        // they were never shown, which silently killed the "ask the human"
        // path before.
        tool_def(
            "question",
            "Ask the human a question when genuinely blocked — sparingly. Returns their answer as the tool result; a denial means work around it or explain.",
            serde_json::json!({
                "question": { "type": "string", "description": "One clear question for the user" },
            }),
            &["question"],
        ),
        tool_def(
            "memory_recall",
            "Search long-term memory (past sessions, stored facts) for the query. Recalled context is bounded and may be stale — verify against the volume before acting on it.",
            serde_json::json!({
                "query": { "type": "string", "description": "What to remember (e.g. deployment quirks, user preferences)" },
                "top_k": { "type": "integer", "description": "Max memories, default 3" },
            }),
            &["query"],
        ),
        tool_def(
            "memory_remember",
            "Store ONE durable fact for future sessions (a decision, preference, environment quirk, lesson learned). Plain text, one fact per call; secrets are redacted automatically. Check memory_recall first so facts are not stored twice.",
            serde_json::json!({
                "text": { "type": "string", "description": "The single fact to remember" },
            }),
            &["text"],
        ),
    ]
}

/// OpenAI `tools` array wrapping the canonical definitions.
pub fn openai_tools() -> serde_json::Value {
    tool_definitions()
        .into_iter()
        .map(|d| serde_json::json!({ "type": "function", "function": d }))
        .collect()
}

/// Anthropic `tools` array (same definitions, `input_schema` key).
pub fn anthropic_tools() -> serde_json::Value {
    tool_definitions()
        .into_iter()
        .map(|mut d| {
            if let Some(obj) = d.as_object_mut() {
                if let Some(params) = obj.remove("parameters") {
                    obj.insert("input_schema".to_string(), params);
                }
            }
            d
        })
        .collect()
}

/// Wrap one canonical definition (`name/description/input_schema`, e.g.
/// from MCP discovery) in the OpenAI `{type, function}` envelope.
pub fn as_openai_tool(def: &serde_json::Value) -> serde_json::Value {
    let name = def.get("name").cloned().unwrap_or(serde_json::Value::Null);
    let description = def
        .get("description")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let parameters = def
        .get("input_schema")
        .cloned()
        .unwrap_or(serde_json::json!({
            "type": "object",
            "properties": {},
        }));
    serde_json::json!({
        "type": "function",
        "function": { "name": name, "description": description, "parameters": parameters },
    })
}

// ─── auth ─────────────────────────────────────────────────────────────────

/// Headers for a chat call. The key itself travels only here, never in a
/// body or a log line.
pub fn auth_headers(preset: &ProviderPreset, api_key: &str) -> Vec<(String, String)> {
    let mut headers = preset.extra_headers.clone();
    match preset.auth {
        AuthScheme::Bearer => {
            if !api_key.is_empty() {
                headers.push(("Authorization".into(), format!("Bearer {api_key}")));
            }
        }
        AuthScheme::Header => {
            let name = preset
                .auth_name
                .clone()
                .unwrap_or_else(|| "x-api-key".into());
            headers.push((name, api_key.to_string()));
        }
        AuthScheme::Query | AuthScheme::None => {}
    }
    headers.push(("Content-Type".into(), "application/json".into()));
    headers
}

/// Append a query-scheme key (`?key=`) to a URL.
pub fn with_query_key(url: &str, name: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return url.to_string();
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}{name}={api_key}")
}

// ─── normalized turn ──────────────────────────────────────────────────────

/// One model reply, dialect-free.
#[derive(Debug, Clone, Default)]
pub struct ParsedTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: TokenUsage,
    /// `stop` | `tool_calls` | `length` | `error:<msg>`.
    pub finish: String,
}

fn u64_at(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|n| n.as_u64()).unwrap_or(0)
}

// ─── OpenAI dialect ───────────────────────────────────────────────────────

/// Build an OpenAI `/chat/completions` body.
pub fn openai_request(
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    tools: bool,
) -> serde_json::Value {
    let mut wire: Vec<serde_json::Value> = Vec::with_capacity(messages.len() + 1);
    if !system.is_empty() {
        wire.push(serde_json::json!({ "role": "system", "content": system }));
    }
    for m in messages {
        match m.role.as_str() {
            "tool" => wire.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id,
                "content": m.content,
            })),
            "assistant_tool" => {
                let calls = m.tool_input.clone().unwrap_or(serde_json::Value::Null);
                wire.push(serde_json::json!({
                    "role": "assistant",
                    "content": m.content,
                    "tool_calls": calls,
                }));
            }
            role => wire.push(serde_json::json!({ "role": role, "content": m.content })),
        }
    }
    let mut body = serde_json::json!({ "model": model, "messages": wire });
    if tools {
        body["tools"] = openai_tools();
        body["tool_choice"] = serde_json::json!("auto");
    }
    body
}

/// Parse an OpenAI chat response (or error envelope) into a turn.
pub fn openai_parse(body: &serde_json::Value) -> Result<ParsedTurn, String> {
    if let Some(err) = body.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown provider error");
        let code = err.get("code").and_then(|c| c.as_str()).unwrap_or_default();
        return Err(classify_provider_error(None, msg, code));
    }
    let choice = body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "integrity: provider returned no choices".to_string())?;
    let message = choice.get("message").unwrap_or(&serde_json::Value::Null);
    let content = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let mut tool_calls = Vec::new();
    if let Some(calls) = message.get("tool_calls").and_then(|c| c.as_array()) {
        for call in calls {
            let id = call
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("call-0")
                .to_string();
            let func = call.get("function").unwrap_or(&serde_json::Value::Null);
            let name = func
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input = func
                .get("arguments")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            tool_calls.push(ToolCall { id, name, input });
        }
    }
    let usage = body.get("usage").map(|u| TokenUsage {
        input_tokens: u64_at(u, "prompt_tokens"),
        output_tokens: u64_at(u, "completion_tokens"),
    });
    let finish = choice
        .get("finish_reason")
        .and_then(|f| f.as_str())
        .unwrap_or("stop")
        .to_string();
    Ok(ParsedTurn {
        content,
        tool_calls,
        usage: usage.unwrap_or_default(),
        finish,
    })
}

// ─── Anthropic dialect ────────────────────────────────────────────────────

/// Build an Anthropic `/v1/messages` body (`max_tokens` required).
pub fn anthropic_request(
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    tools: bool,
) -> serde_json::Value {
    let mut wire: Vec<serde_json::Value> = Vec::with_capacity(messages.len());
    for m in messages {
        match m.role.as_str() {
            "tool" => wire.push(serde_json::json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id,
                    "content": m.content,
                }],
            })),
            "assistant_tool" => {
                let mut blocks = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(serde_json::json!({ "type": "text", "text": m.content }));
                }
                if let Some(calls) = m.tool_input.as_ref().and_then(|v| v.as_array()) {
                    for call in calls {
                        blocks.push(serde_json::json!({
                            "type": "tool_use",
                            "id": call.get("id"),
                            "name": call.get("name"),
                            "input": call.get("input"),
                        }));
                    }
                }
                wire.push(serde_json::json!({ "role": "assistant", "content": blocks }));
            }
            "system" => continue,
            role => {
                let api_role = if role == "assistant" {
                    "assistant"
                } else {
                    "user"
                };
                wire.push(serde_json::json!({ "role": api_role, "content": m.content }));
            }
        }
    }
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": wire,
    });
    if !system.is_empty() {
        body["system"] = serde_json::json!(system);
    }
    if tools {
        body["tools"] = anthropic_tools();
    }
    body
}

/// Parse an Anthropic message response (or error envelope) into a turn.
pub fn anthropic_parse(body: &serde_json::Value) -> Result<ParsedTurn, String> {
    if body.get("error").is_some() {
        let msg = body
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown provider error");
        let kind = body
            .pointer("/error/type")
            .and_then(|m| m.as_str())
            .unwrap_or_default();
        return Err(classify_provider_error(None, msg, kind));
    }
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    if let Some(blocks) = body.get("content").and_then(|c| c.as_array()) {
        for block in blocks {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                        if !content.is_empty() {
                            content.push('\n');
                        }
                        content.push_str(text);
                    }
                }
                Some("tool_use") => tool_calls.push(ToolCall {
                    id: block
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("call-0")
                        .to_string(),
                    name: block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    input: block.get("input").cloned().unwrap_or(serde_json::json!({})),
                }),
                _ => {}
            }
        }
    }
    let usage = body.get("usage").map(|u| TokenUsage {
        input_tokens: u64_at(u, "input_tokens"),
        output_tokens: u64_at(u, "output_tokens"),
    });
    let finish = body
        .get("stop_reason")
        .and_then(|s| s.as_str())
        .map(|s| {
            if s == "tool_use" {
                "tool_calls".to_string()
            } else {
                s.to_string()
            }
        })
        .unwrap_or_else(|| "stop".to_string());
    Ok(ParsedTurn {
        content,
        tool_calls,
        usage: usage.unwrap_or_default(),
        finish,
    })
}

// ─── error classification (house prefixes) ────────────────────────────────

/// Map an HTTP status / provider error onto `auth:`, `rate_limited:` or
/// `network:`. Used by every transport so the UI hints stay uniform.
pub fn classify_provider_error(status: Option<u16>, message: &str, code: &str) -> String {
    let haystack = format!("{message} {code}").to_lowercase();
    let authy = [
        "invalid api key",
        "incorrect api key",
        "unauthorized",
        "authentication",
        "invalid_api_key",
        "authentication_error",
        "permission_denied",
        "account_deactivated",
    ];
    if status == Some(401) || status == Some(403) || authy.iter().any(|s| haystack.contains(s)) {
        return format!("auth: provider rejected credentials: {message}");
    }
    if status == Some(429)
        || haystack.contains("rate limit")
        || haystack.contains("rate_limit")
        || haystack.contains("quota")
        || haystack.contains("overloaded")
        || haystack.contains("529")
    {
        return format!("rate_limited: provider throttled the request: {message}");
    }
    // Context overflow is NOT a network failure — retrying it identically is
    // exactly wrong. The driver/UI treat `context:` as "compact the session".
    if haystack.contains("context_length_exceeded")
        || haystack.contains("prompt is too long")
        || haystack.contains("maximum context")
        || haystack.contains("max context")
        || haystack.contains("context window")
        || haystack.contains("too many tokens")
        || haystack.contains("input length and")
        || haystack.contains("reduce the length")
    {
        return format!("context: transcript exceeds the model's context window: {message}");
    }
    if let Some(status) = status {
        return format!("network: provider HTTP {status}: {message}");
    }
    format!("network: provider error: {message}")
}

// ─── blocking transport (feature `native`) ────────────────────────────────

/// POST JSON and parse the reply. Timeouts are generous — agentic turns
/// think for a while — but always finite.
#[cfg(feature = "native")]
pub fn post_json(
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("network: cannot build HTTP client: {e}"))?;
    let mut req = client.post(url).json(body);
    for (name, value) in headers {
        req = req.header(name.as_str(), value.as_str());
    }
    let resp = req
        .send()
        .map_err(|e| format!("network: request failed: {e}"))?;
    let status = resp.status().as_u16();
    let value: serde_json::Value = resp
        .json()
        .map_err(|e| format!("network: unreadable provider reply: {e}"))?;
    if !(200..300).contains(&status) {
        let msg = value
            .get("error")
            .and_then(|e| {
                e.get("message")
                    .or_else(|| e.pointer("/message"))
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(classify_provider_error(Some(status), &msg, ""));
    }
    Ok(value)
}

/// GET JSON (models refresh). Same prefix contract.
#[cfg(feature = "native")]
pub fn get_json(url: &str, headers: &[(String, String)]) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("network: cannot build HTTP client: {e}"))?;
    let mut req = client.get(url);
    for (name, value) in headers {
        req = req.header(name.as_str(), value.as_str());
    }
    let resp = req
        .send()
        .map_err(|e| format!("network: request failed: {e}"))?;
    let status = resp.status().as_u16();
    let value: serde_json::Value = resp
        .json()
        .map_err(|e| format!("network: unreadable provider reply: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(classify_provider_error(
            Some(status),
            "models request failed",
            "",
        ));
    }
    Ok(value)
}

/// Raw POST returning status + headers + body (Streamable HTTP clients need
/// the session header). Same timeout and prefix contract as `post_json`.
#[cfg(feature = "native")]
/// Status code, response headers and body of a completed HTTP POST.
pub type RawResponse = Result<(u16, Vec<(String, String)>, String), String>;

#[cfg(feature = "native")]
pub fn post_raw(
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
    timeout_secs: u64,
) -> RawResponse {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("network: cannot build HTTP client: {e}"))?;
    let mut req = client.post(url).json(body);
    for (name, value) in headers {
        req = req.header(name.as_str(), value.as_str());
    }
    let resp = req
        .send()
        .map_err(|e| format!("network: request failed: {e}"))?;
    let status = resp.status().as_u16();
    let mut out_headers = Vec::new();
    for (name, value) in resp.headers().iter() {
        out_headers.push((name.to_string(), value.to_str().unwrap_or("").to_string()));
    }
    let text = resp
        .text()
        .map_err(|e| format!("network: unreadable reply: {e}"))?;
    Ok((status, out_headers, text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cybermanju_types::agent::LlmDialect;
    #[test]
    fn tool_schemas_cover_eleven_tools_in_openai_shape() {
        let tools = openai_tools();
        assert_eq!(tools.as_array().map(|a| a.len()), Some(11));
        let first = &tools[0];
        assert_eq!(first["type"], "function");
        assert_eq!(first["function"]["name"], "read");
        // The prompt-advertised `question` tool must be in the schema —
        // schema-driven providers cannot call a tool they were never shown.
        let arr = tools.as_array().expect("openai_tools is an array");
        assert!(arr.iter().any(|t| t["function"]["name"] == "question"));
        // Same for the semantic-memory tools (recall/remember).
        assert!(arr
            .iter()
            .any(|t| t["function"]["name"] == "memory_recall"));
        assert!(arr
            .iter()
            .any(|t| t["function"]["name"] == "memory_remember"));
        let anthropic = anthropic_tools();
        assert!(anthropic[0].get("input_schema").is_some());
        assert!(anthropic[0].get("parameters").is_none());
    }

    #[test]
    fn openai_round_trip_with_tool_calls() {
        let body = openai_request(
            "gpt-5",
            "sys",
            &[ChatMessage {
                role: "user".into(),
                content: "hi".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            }],
            true,
        );
        assert_eq!(body["model"], "gpt-5");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["tools"].as_array().map(|a| a.len()), Some(11));

        let reply = serde_json::json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": "looking",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "read",
                            "arguments": "{\"path\":\"a.rs\"}",
                        },
                    }],
                },
            }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5 },
        });
        let turn = openai_parse(&reply).expect("parse");
        assert_eq!(turn.content, "looking");
        assert_eq!(turn.tool_calls.len(), 1);
        assert_eq!(turn.tool_calls[0].name, "read");
        assert_eq!(turn.tool_calls[0].input["path"], "a.rs");
        assert_eq!(turn.usage.input_tokens, 10);
        assert_eq!(turn.finish, "tool_calls");

        let err = serde_json::json!({ "error": { "message": "Incorrect API key", "code": "invalid_api_key" } });
        assert!(openai_parse(&err).expect_err("auth").starts_with("auth:"));
    }

    #[test]
    fn overflow_is_context_not_network() {
        // A 400 context overflow must never classify as `network:` — the UI
        // hint for network says "retry", which cannot work.
        let err = classify_provider_error(
            Some(400),
            "This model's maximum context length is 128000 tokens",
            "context_length_exceeded",
        );
        assert!(err.starts_with("context:"), "{err}");
        let anthropic = classify_provider_error(
            Some(400),
            "prompt is too long: 210000 tokens > 200000 maximum",
            "invalid_request_error",
        );
        assert!(anthropic.starts_with("context:"), "{anthropic}");
        // …and plain HTTP failures stay network.
        assert!(classify_provider_error(Some(500), "boom", "").starts_with("network:"));
    }

    #[test]
    fn anthropic_round_trip_with_tool_use() {
        let body = anthropic_request("claude-sonnet-4-5", "sys", &[], true);
        assert_eq!(body["max_tokens"], 4096);
        assert_eq!(body["system"], "sys");

        let reply = serde_json::json!({
            "content": [
                { "type": "text", "text": "on it" },
                { "type": "tool_use", "id": "toolu_1", "name": "bash",
                  "input": { "command": "git status" } },
            ],
            "stop_reason": "tool_use",
            "usage": { "input_tokens": 7, "output_tokens": 3 },
        });
        let turn = anthropic_parse(&reply).expect("parse");
        assert_eq!(turn.content, "on it");
        assert_eq!(turn.finish, "tool_calls");
        assert_eq!(turn.tool_calls[0].input["command"], "git status");
        assert_eq!(turn.usage.output_tokens, 3);

        let err = serde_json::json!({ "error": { "type": "overloaded_error", "message": "busy" } });
        assert!(anthropic_parse(&err)
            .expect_err("limited")
            .starts_with("rate_limited:"));
    }

    #[test]
    fn auth_headers_follow_the_scheme() {
        let preset = ProviderPreset {
            id: "x".into(),
            label: "X".into(),
            family: "x".into(),
            base_url: "https://x.test/v1".into(),
            default_model: "m".into(),
            dialect: LlmDialect::OpenAi,
            auth: AuthScheme::Header,
            auth_name: Some("x-api-key".into()),
            key_env: String::new(),
            keyless: false,
            extra_headers: vec![],
        };
        let headers = auth_headers(&preset, "k");
        assert!(headers.iter().any(|(n, v)| n == "x-api-key" && v == "k"));
        assert_eq!(
            with_query_key("https://h.test/v", "key", "k"),
            "https://h.test/v?key=k"
        );
    }
}
