"""Source contracts only; Rust runtime regressions remain mandatory in CI."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class HubSecuritySourceTests(unittest.TestCase):
    def test_unicode_pem_scanning_decodes_scalars_and_retains_byte_offsets(self):
        source = (ROOT / "crates/agent/src/redact.rs").read_text()
        self.assertIn("while let Some(width) = pem_whitespace_len(&clean[begin..])", source)
        helper = source.split("fn pem_whitespace_len(", 1)[1].split("fn ascii_eq_ignore_case(", 1)[0]
        self.assertIn("std::str::from_utf8(bytes.get(..width)?)", helper)
        self.assertIn("scalar.is_whitespace().then_some(width)", helper)
        self.assertIn("begin += width", source)
        self.assertIn("if begin != pos + 5", source)
        self.assertIn("while !text.is_char_boundary(limit)", source)
        regression = source.split("fn pem_unicode_separator_whitespace_fails_closed_without_slicing_utf8()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r"\u{a0}", r"\u{2003}", r"\u{2028}", r"\u{3000}",
                         '"😀".repeat(262_145)', "std::panic::catch_unwind", "uncertain suffix"]:
            self.assertIn(evidence, regression)

    def test_unicode_pem_has_canonical_projection_and_reopened_store_coverage(self):
        prompt = (ROOT / "crates/agent/src/hub_prompt.rs").read_text()
        regression = prompt.split("fn unicode_spaced_pem_is_removed_from_canonical_projection_and_provider_body()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["canonical_envelope(&raw)", "scrub_envelope(&raw", "parse_envelope(&canonical)",
                         "build_projected_messages", "PromptProjection", "LlmDialect::OpenAi",
                         "LlmDialect::Anthropic", "UNICODEMATERIAL", "uncertain suffix"]:
            self.assertIn(evidence, regression)
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        regression = api.split("fn pem_material_never_persists_or_reaches_either_provider_projection()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r"\u{a0}", r"\u{2003}", "-----{gap}BEGIN", "reopened.profile",
                         "reopened.run", "reopened.audit_events", "post_hub_request",
                         "EventVisibility::Internal", "EventVisibility::User"]:
            self.assertIn(evidence, regression)

    def test_candidate_json_parse_failure_cannot_fall_back_to_prose(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn reject_request_credentials(", 1)[1].split("fn post_hub_request(", 1)[0]
        self.assertRegex(guard, r'Err\(_\) => (?:\{\s*)?return Err\("integrity: projected request contains uninspectable JSON"\.into\(\)\)')
        self.assertNotIn("Err(_) => {}", guard)
        regression = api.split("fn candidate_json_parse_errors_fail_closed_before_either_provider_connects()", 1)[1].split("    #[test]", 1)[0]
        for vector in [r'{"n":1e400,"x":"\\u006fpaque-provider-secret-9981","x":"safe"}',
                       r'{"x":"\\u006fpaque-provider-secret-9981","x":1e400}',
                       r'{"n":1e400,"x":"\u006fpaque-provider-secret-9981","x":"safe"}',
                       r'{"x":"\u006fpaque-provider-secret-9981","x":1e400}']:
            self.assertIn(vector, regression)
        for evidence in ["LlmDialect::OpenAi", "LlmDialect::Anthropic", "assert_request_blocked_with_error",
                         "serde_json::from_str::<serde_json::Value>(embedded).is_err()"]:
            self.assertIn(evidence, regression)
        helper = api.split("fn assert_request_blocked_with_error(", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["post_hub_request", "requests.load(Ordering::SeqCst), 0", "assert_eq!(body, &before)"]:
            self.assertIn(evidence, helper)


    def test_exact_redaction_marker_is_checked_after_credentials_and_budget(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn inspect_text(", 1)[1].split("    fn inspect(", 1)[0]
        marker = guard.index('if text == "[REDACTED]"')
        self.assertLess(guard.index("budget.bytes.checked_sub(text.len())"), marker)
        self.assertLess(guard.index("text.contains(key.as_str())"), marker)
        self.assertLess(marker, guard.index("serde_json::from_str::<StrictJson>(text)"))
        self.assertRegex(guard, r'if text == "\[REDACTED\]" \{\s*return Ok\(false\);\s*\}')
        positive = api.split("fn scrubbed_messages_and_envelopes_reach_both_providers_unchanged()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["EventVisibility::User", "EventVisibility::Internal", "LlmDialect::OpenAi",
                         "LlmDialect::Anthropic", "clean_internal(&envelope, &keys)",
                         "hub_prompt::build_projected_messages", "post_hub_request", "read_request",
                         "assert_eq!(body, before)", "assert_eq!(captured, before)"]:
            self.assertIn(evidence, positive)
        negative = api.split("fn redaction_marker_exemption_never_bypasses_credentials_or_budgets()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ['["[REDACTED]", "REDACTED", "["]', "LlmDialect::OpenAi",
                         "LlmDialect::Anthropic", "assert_request_blocked_without_io", "65_536",
                         "assert_request_blocked_with_error"]:
            self.assertIn(evidence, negative)
        malformed = api.split("fn candidate_json_parse_errors_fail_closed_before_either_provider_connects()", 1)[1].split("    #[test]", 1)[0]
        self.assertIn(r'[REDACTED] {"x":"\u006fpaque-provider-secret-9981"}', malformed)
        self.assertIn(r'["[REDACTED]",1e400,"\u006fpaque-provider-secret-9981"]', malformed)

    def test_prose_prefixed_json_uses_strict_nonoverlapping_bounded_decoding(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn inspect_text(", 1)[1].split("    fn inspect(", 1)[0]
        leading = guard.index("serde_json::from_str::<StrictJson>(text)")
        prose = guard.index("serde_json::Deserializer::from_str(&text[cursor..])")
        self.assertLess(leading, prose)
        for evidence in ["if !text.contains('\\\\')", "while cursor < text.len()",
                         "cursor += relative", ".into_iter::<StrictJson>()",
                         "inspect(&decoded, keys, depth + 1, budget)?",
                         "cursor += fragments.byte_offset()",
                         'contains("duplicate object key")',
                         'starts_with("recursion limit exceeded")']:
            self.assertIn(evidence, guard)
        regression = api.split("fn prose_prefixed_escaped_json_fails_closed_before_either_provider_connects()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r'Please inspect: {"x":"\u006fpaque-provider-secret-9981"}',
                         r'Please inspect: {"\u006fpaque-provider-secret-9981":"public"}',
                         r'Please inspect: ["\u006fpaque-provider-secret-9981"]',
                         r'Please inspect: "\u006fpaque-provider-secret-9981"',
                         r'"n":1e400', r'"x":1,"\u0078":2',
                         "LlmDialect::OpenAi", "LlmDialect::Anthropic",
                         "EventVisibility::User", "assert_request_blocked_with_error",
                         "assert!(!embedded.contains(credential))"]:
            self.assertIn(evidence, regression)
        positive = api.split("fn prose_fragment_inspection_preserves_benign_text_and_policy_examples()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["Ordinary benign prose", "[REDACTED]", r"\u0070ublic",
                         "C:\\reports\\public.txt", "EventVisibility::Internal",
                         "hub_prompt::output_policy", "assert_eq!(body, before)"]:
            self.assertIn(evidence, positive)

    def test_bare_unicode_inspection_is_bounded_read_only_and_blocks_both_dialects(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn inspect_text(", 1)[1].split("    fn inspect(", 1)[0]
        for evidence in ["text.char_indices().peekable()", "hex.iter().all(u8::is_ascii_hexdigit)",
                         "serde_json::from_str(&format!", "Value::String(decoded), keys, depth + 1, budget",
                         "projected request contains uninspectable Unicode"]:
            self.assertIn(evidence, guard)
        regression = api.split("fn bare_unicode_escaped_credentials_never_connect_to_either_provider()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r"Please inspect: \u006fpaque-provider-secret-9981",
                         r"\u006f\u0070aque-provider-secret-9981", "let fully_escaped: String",
                         'First {{\\"safe\\":1}}, then {fully_escaped}',
                         r"\u005cu006fpaque-provider-secret-9981", r"\uD800", r"\uDC00",
                         "LlmDialect::OpenAi", "LlmDialect::Anthropic", "selectedContext",
                         "assert_request_blocked_without_io"]:
            self.assertIn(evidence, regression)

    def test_standalone_marker_and_schema_prose_reach_real_mock_providers(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn inspect_text(", 1)[1].split("    fn inspect(", 1)[0]
        for evidence in ['starts_with("[REDACTED]")', "end == text.len()",
                         "ch.is_ascii_alphabetic()", "ch.is_ascii_whitespace()"]:
            self.assertIn(evidence, guard)
        regression = api.split("fn benign_redacted_prose_with_paths_reaches_both_providers_unchanged()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r"Please summarize opaque-provider-secret-9981 in C:\reports\public.txt",
                         r"Please summarize [REDACTED] in C:\reports\public.txt",
                         r"Please summarize [REDACTED]; use C:\reports\public.txt.",
                         r"Use {schema example} in C:\reports\public.txt.",
                         "LlmDialect::OpenAi", "LlmDialect::Anthropic", "post_hub_request",
                         "read_request", "assert_eq!(body, before)", "assert_eq!(captured, before)"]:
            self.assertIn(evidence, regression)

    def test_leading_prose_tokens_are_bounded_before_json_and_suffix_is_inspected(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn inspect_text(", 1)[1].split("    fn inspect(", 1)[0]
        leading = guard.index("let mut cursor = prose_token_end(text, first).unwrap_or(0)")
        self.assertLess(guard.index("budget.bytes.checked_sub(text.len())"), leading)
        self.assertLess(guard.index("text.contains(key.as_str())"), leading)
        self.assertLess(leading, guard.index("serde_json::from_str::<StrictJson>(text)"))
        for evidence in ["if cursor == 0", "if !text.contains('\\\\') && cursor == 0",
                         "while cursor < text.len()", "prose_token_end(text, cursor)",
                         "cursor != 0", "end == text.len()"]:
            self.assertIn(evidence, guard)
        positive = api.split("fn benign_redacted_prose_with_paths_reaches_both_providers_unchanged()", 1)[1].split("    #[test]", 1)[0]
        for text in [r'"[REDACTED] in C:\reports\public.txt"',
                     r'"[REDACTED]; use C:\reports\public.txt."',
                     r'"{schema example} in C:\reports\public.txt."']:
            self.assertIn(text, positive)
        negative = api.split("fn prose_prefixed_escaped_json_fails_closed_before_either_provider_connects()", 1)[1].split("    #[test]", 1)[0]
        for evidence in [r'[REDACTED] in C:\reports\public.txt {"x":"\u006fpaque-provider-secret-9981"}',
                         r'{schema example} in C:\reports\public.txt \u006fpaque-provider-secret-9981',
                         r'[REDACTED]; {"x":1,"x":2}', r'{schema example} {"n":1e400}',
                         "[REDACTED]suffix", "prefix[REDACTED]", "{schema example}suffix",
                         "prefix{schema example}", "{schema example2}", "{schema: example}",
                         "{{schema example}}", "assert_request_blocked_with_error"]:
            self.assertIn(evidence, negative)


if __name__ == "__main__":
    unittest.main()
