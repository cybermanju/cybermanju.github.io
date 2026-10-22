"""CyberManju OS — Agent Hub Contract Gates.
Role: Validate shared JSON Schema and safety-sensitive integration invariants without claiming Rust execution.
Exports: unittest schema, disclosure and runtime wiring checks.
Integrates: docs/agent-hub.schema.json and production Rust source files.
Contracts: Static checks complement, never replace, Rust compiler/tests in CI; no network or secrets.
"""
from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path

try:
    import jsonschema
except ImportError:
    jsonschema = None

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "docs/agent-hub.schema.json").read_text())


@unittest.skipUnless(jsonschema, "jsonschema package unavailable; schema validation not run")
class SchemaTests(unittest.TestCase):
    def validate(self, name, value):
        schema = dict(SCHEMA)
        schema["$ref"] = "#/$defs/" + name
        jsonschema.Draft202012Validator(schema).validate(value)

    def test_schema_is_valid(self):
        jsonschema.Draft202012Validator.check_schema(SCHEMA)

    def test_quarantine_metadata_has_no_content_or_disclosure_action(self):
        for reason in ["missingVisibility", "legacyProvenanceUnavailable"]:
            value = {"seq": 1, "reason": reason}
            self.validate("QuarantinedLegacyEvent", value)
            for field in ["text", "kind", "senderId", "runId", "visibility", "ownerId"]:
                with self.assertRaises(jsonschema.ValidationError):
                    self.validate("QuarantinedLegacyEvent", dict(value, **{field: "forbidden"}))
        for bad in [{"seq": 0, "reason": "missingVisibility"},
                    {"seq": 1, "reason": "safeToPublish"}, {"seq": 1}]:
            with self.assertRaises(jsonschema.ValidationError):
                self.validate("QuarantinedLegacyEvent", bad)

    def test_internal_envelope_is_typed_and_rejects_unknown_fields(self):
        value = {"v": 1, "op": "task", "data": [{"k": "goal", "v": "extract"}], "refs": []}
        self.validate("CoordinationEnvelope", value)
        for bad in [dict(value, v=2), dict(value, op="toolCall"), dict(value, apiKey="not-allowed"),
                    dict(value, refs=[{"e": "evt"}]), dict(value, data=[]),
                    dict(value, op="result"), dict(value, op="blocked"),
                    dict(value, data=[{"k": "goal", "v": "   "}]),
                    dict(value, data=[{"k": "goal", "v": "x", "extra": True}])]:
            with self.assertRaises(jsonschema.ValidationError):
                self.validate("CoordinationEnvelope", bad)

    def test_visibility_is_required_and_independent_of_kind(self):
        event = {"id": "evt", "conversationId": "conv", "seq": 1, "kind": "assistant",
                 "senderId": "recipient", "recipientId": None, "text": "Reply",
                 "createdAt": "time", "runId": "run"}
        with self.assertRaises(jsonschema.ValidationError):
            self.validate("HubEvent", event)
        for visibility in ["user", "internal"]:
            self.validate("HubEvent", dict(event, visibility=visibility))
        with self.assertRaises(jsonschema.ValidationError):
            self.validate("HubEvent", dict(event, visibility="inferred"))

    def test_projection_supports_explicit_reference_only_item(self):
        projection = {"v": 1, "recipientId": "agent", "sourceEventId": "evt", "sourceSeq": 1,
                      "items": [{"ref": {"e": "evt", "s": 1, "f": "text", "b": 20, "h": "a" * 64}}]}
        self.validate("PromptProjection", projection)
        projection["items"][0]["value"] = None
        with self.assertRaises(jsonschema.ValidationError):
            self.validate("PromptProjection", projection)

    def test_nested_internal_task_is_object_not_json_in_json_string(self):
        value = {"v": 1, "op": "task", "data": [{"k": "goal", "v": "extract"}], "refs": []}
        projection = {"v": 1, "recipientId": "agent", "sourceEventId": "evt", "sourceSeq": 1,
                      "items": [{"ref": {"e": "evt", "s": 1, "f": "text", "b": 20, "h": "a" * 64}, "value": value}]}
        self.validate("PromptProjection", projection)
        self.assertIsInstance(projection["items"][0]["value"], dict)


class IntegrationSourceTests(unittest.TestCase):
    def test_quarantine_is_separate_owner_authorized_metadata_only(self):
        source = (ROOT / "crates/web/src/api/agent_hub_store.rs").read_text().split("#[cfg(test)]")[0]
        listing = source.split("pub fn quarantined_legacy_events(", 1)[1].split("fn read_events(", 1)[0]
        self.assertIn("ensure_owner(owner, &conversation.owner_id)?", listing)
        self.assertLess(listing.index("ensure_owner("), listing.index("after_seq.checked_add"))
        self.assertIn("tx.open_table(QUARANTINE)", listing)
        # Keep the exact metadata fields while allowing rustfmt line wrapping.
        self.assertRegex(
            listing,
            r"QuarantinedLegacyEvent\s*\{\s*seq:\s*event\.seq,\s*reason\s*,?\s*\}",
        )
        for forbidden in ["begin_write", "write_row", "self.send(", "post_json", "events.push(event)"]:
            self.assertNotIn(forbidden, listing)
        migration = source.split("fn migrate_visibility(", 1)[1].split("fn recover_interrupted(", 1)[0]
        self.assertIn('"__quarantine_v3"', migration)
        self.assertIn("LegacyQuarantineReason::MissingVisibility", migration)
        self.assertIn("LegacyQuarantineReason::LegacyProvenanceUnavailable", migration)
        self.assertNotIn(".kind", migration)

    def test_rust_exported_body_policy_when_ci_fixture_is_available(self):
        path = os.getenv("HUB_BENCHMARK_CASES")
        if not path:
            self.skipTest("Rust-generated fixture not exported locally; runtime metrics unavailable")
        cases = json.loads(Path(path).read_text())
        source = (ROOT / "crates/agent/src/hub_prompt.rs").read_text()
        declaration = re.search(r'pub const INTERNAL_OUTPUT_POLICY: &str = ("(?:[^"\\]|\\.)*");', source)
        self.assertIsNotNone(declaration)
        policy = json.loads(declaration.group(1))
        self.assertGreater(len(cases), 0)
        for case in cases:
            self.assertTrue(case["runtimeBodies"])
            self.assertEqual(case["producer"], "cybermanju-agent::hub_prompt::export_runtime_benchmark_cases_when_requested")
            for variant in ["baseline", "projection"]:
                body = json.loads(case[variant])
                self.assertEqual(body["messages"][0]["content"], policy)
                self.assertNotIn("tools", body)
            projection = json.loads(json.loads(case["projection"])["messages"][1]["content"])
            self.assertIsInstance(projection["items"][0]["value"], dict)

    def test_dispatch_uses_traceable_projection_not_legacy_messages(self):
        source = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text().split("#[cfg(test)]")[0]
        self.assertIn("hub.source_event(owner, run)?", source)
        self.assertIn("hub_prompt::build_projected_messages", source)
        self.assertNotIn("hub_prompt::build_messages(", source)
        self.assertIn("hub_protocol::parse_envelope", source)
        self.assertNotIn('"response_format"', source)
        self.assertNotIn("run.selected_context.push", source)

    def test_tool_grants_remain_rejected_and_essential_text_not_omitted(self):
        prompt = (ROOT / "crates/agent/src/hub_prompt.rs").read_text().split("#[cfg(test)]")[0]
        store = (ROOT / "crates/web/src/api/agent_hub_store.rs").read_text().split("#[cfg(test)]")[0]
        self.assertIn("!run.tool_grants.is_empty()", prompt)
        self.assertIn("!input.tool_grants.is_empty()", store)
        self.assertIn('item.reference.field == "text"', prompt)
        self.assertIn('item.reference.field.starts_with("context")', prompt)
        self.assertIn("item.value.is_none()", prompt)
        self.assertNotIn("bounded_clean", store)

    def test_public_event_feed_filters_visibility_in_backend(self):
        store = (ROOT / "crates/web/src/api/agent_hub_store.rs").read_text().split("#[cfg(test)]")[0]
        self.assertIn("self.read_events(owner, conversation_id, after_seq, limit, false)", store)
        self.assertIn("include_internal || event.visibility == EventVisibility::User", store)
        native = (ROOT / "src-tauri/src/commands/agent_hub.rs").read_text()
        self.assertIn("state.agent_hub.events(", native)
        self.assertNotIn("audit_events(", native)

    def test_decoded_field_scrub_and_terminal_failure_are_wired(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text().split("#[cfg(test)]")[0]
        prompt = (ROOT / "crates/agent/src/hub_prompt.rs").read_text().split("#[cfg(test)]")[0]
        self.assertIn("clean_internal(&input.text, &keys)?", api)
        self.assertIn("let text = clean_internal(text, keys)?", api)
        self.assertIn("fact.k = suppress_policy_echoes(&scrub_known_secrets(&fact.k, secrets))", prompt)
        self.assertIn("fact.v = suppress_policy_echoes(&scrub_known_secrets(&fact.v, secrets))", prompt)
        self.assertIn("finalize_outcome(&hub, &owner, &run.id, outcome)", api)
        self.assertIn("validate_finish(endpoint.dialect, &turn.last_finish)?", api)
        self.assertIn('"length" | "max_tokens"', api)

    def test_outbound_request_guard_reads_decoded_values_without_redaction(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text().split("#[cfg(test)]")[0]
        guard = api.split("fn reject_request_credentials(", 1)[1].split("/// Native host", 1)[0]
        self.assertIn("serde_json::Value::String(text)", guard)
        self.assertIn("serde_json::Value::Array(values)", guard)
        self.assertIn("serde_json::Value::Object(values)", guard)
        self.assertIn("serde_json::from_str::<StrictJson>(text)", guard)
        self.assertNotIn("serde_json::from_str::<serde_json::Value>(text)", guard)
        self.assertIn("text.contains(key.as_str())", guard)
        self.assertIn("inspect_text(name, keys, depth, budget)?", guard)
        self.assertLess(guard.index("reject_request_credentials(body, keys)?"), guard.index("protocol::post_json_bounded("))
        self.assertNotIn("clean(", guard)
        self.assertNotIn("redact(", guard)
        self.assertNotIn("serde_json::to_string(", guard)
        self.assertNotIn("clean(&serialized", api)
        self.assertIn("post_hub_request(&url, &headers, &body, &keys)?", api)
        projection = (ROOT / "crates/agent/src/hub_protocol.rs").read_text().split("#[cfg(test)]")[0]
        self.assertNotIn("redact(&descriptor_json)", projection)
        self.assertIn("parse_envelope(&run.input)?", projection)
        reference = projection.split("fn projection_reference(", 1)[1].split("fn fits(", 1)[0]
        self.assertNotIn("redact(", reference)
        self.assertIn("blake3::hash(value.as_bytes())", reference)

    def test_embedded_json_limits_fail_closed_with_bounded_inspection(self):
        source = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = source.split("fn reject_request_credentials(", 1)[1].split("fn post_hub_request(", 1)[0]
        self.assertNotIn("if let Ok(decoded)", guard)
        self.assertIn('starts_with("recursion limit exceeded")', guard)
        self.assertIn('return Err("integrity: projected request exceeds safe inspection depth"', guard)
        self.assertIn("budget.bytes.checked_sub(text.len())", guard)
        self.assertIn("budget.values.checked_sub(1)", guard)
        self.assertRegex(guard, r"bytes: 1_048_576,\s*values: 65_536")
        self.assertNotIn("disable_recursion_limit", guard)
        for regression in ["deeply_nested_embedded_json_fails_closed_before_provider_io",
                           "inspection_budgets_bound_wide_values_and_repeated_decoding"]:
            self.assertIn("fn " + regression, source)
        self.assertIn("[130, 512, 4096]", source)
        self.assertRegex(source, r"assert_request_blocked_with_error\(\s*&body")

    def test_pem_redaction_is_shared_by_storage_and_decoded_fields(self):
        redactor = (ROOT / "crates/agent/src/redact.rs").read_text()
        store = (ROOT / "crates/web/src/api/agent_hub_store.rs").read_text().split("#[cfg(test)]")[0]
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        self.assertIn("scan_pem(text, &mut hits)", redactor)
        self.assertNotIn('marker.starts_with("-----BEGIN")', redactor)
        self.assertIn("redact::redact(&value).0", store)
        regression = api.split("fn pem_material_never_persists_or_reaches_either_provider_projection()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["LlmDialect::OpenAi", "LlmDialect::Anthropic", "EventVisibility::Internal",
                         "EventVisibility::User", "post_hub_request(&url, &[], &body, &[])",
                         "reopened.audit_events", "reopened.run", "reopened.profile",
                         "hub_protocol::parse_envelope", "BEGIN", "material"]:
            self.assertIn(evidence, regression)

    def test_pem_cursor_resumes_after_terminator_not_after_end_line(self):
        redactor = (ROOT / "crates/agent/src/redact.rs").read_text()
        scanner = redactor.split("fn scan_pem(", 1)[1].split("fn ascii_eq_ignore_case(", 1)[0]
        self.assertIn("row_offsets.push(j)", scanner)
        self.assertIn("found = Some(row_offsets[label_end + 4] + 1)", scanner)
        self.assertIn("line_start = end", scanner)
        self.assertNotIn("found = Some(if row_end", scanner)
        self.assertIn("fn pem_second_begin_on_first_end_line_redacts_both_bodies()", redactor)
        self.assertIn('"SECOND_BODY_LINE_ONE"', redactor)
        self.assertIn('"SECOND_BODY_LINE_TWO"', redactor)
        prompt = (ROOT / "crates/agent/src/hub_prompt.rs").read_text()
        self.assertIn("fn same_end_line_pem_blocks_are_removed_from_canonical_projection_and_provider_body()", prompt)

    def test_pem_utf8_boundaries_and_malformed_spacing_fail_closed(self):
        redactor = (ROOT / "crates/agent/src/redact.rs").read_text()
        self.assertIn("while !text.is_char_boundary(limit)", redactor)
        self.assertRegex(
            redactor,
            r"!text\.is_char_boundary\(start\)\s*\|\|\s*!text\.is_char_boundary\(end\)",
        )
        self.assertIn("fn pem_multibyte_scan_cap_never_panics_or_leaks_suffix()", redactor)
        self.assertIn('"😀".repeat(262_145)', redactor)
        self.assertIn("std::panic::catch_unwind(|| redact(&input))", redactor)
        self.assertIn("fn malformed_pem_header_spacing_fails_closed_to_eof()", redactor)
        self.assertIn("if !valid_label", redactor)
        self.assertIn("SECONDMATERIAL", redactor)
        prompt = (ROOT / "crates/agent/src/hub_prompt.rs").read_text()
        regression = prompt.split("fn exact_and_ambiguous_pem_cases_are_scrubbed_at_every_hub_boundary()", 1)[1].split("    #[test]", 1)[0]
        for evidence in ["FIRSTMATERIAL", "SECONDMATERIAL", "canonical_envelope(&raw)",
                         "build_projected_messages", "LlmDialect::OpenAi", "LlmDialect::Anthropic"]:
            self.assertIn(evidence, regression)

    def test_embedded_json_duplicate_keys_cannot_be_overwritten(self):
        api = (ROOT / "crates/web/src/api/agent_hub_api.rs").read_text()
        guard = api.split("fn reject_request_credentials(", 1)[1].split("fn post_hub_request(", 1)[0]
        self.assertIn("impl<'de> Deserialize<'de> for StrictJson", guard)
        self.assertIn("map.next_entry::<String, StrictJson>()?", guard)
        self.assertIn("out.contains_key(&key)", guard)
        self.assertIn('custom("duplicate object key")', guard)
        self.assertIn('return Err("integrity: projected request contains ambiguous JSON"', guard)
        regression = api.split("fn embedded_duplicate_keys_fail_closed_for_both_provider_dialects()", 1)[1].split("    fn assert_request_blocked_with_error", 1)[0]
        for evidence in [r'{"x":"\u006fpaque-provider-secret-9981","x":"safe"}',
                         "LlmDialect::OpenAi", "LlmDialect::Anthropic"]:
            self.assertIn(evidence, regression)
        self.assertRegex(regression, r"assert_request_blocked_with_error\(\s*&body")
        self.assertIn("assert_eq!(requests.load(Ordering::SeqCst), 0)", api)

    def test_new_canonical_constructors_write_visibility(self):
        store = (ROOT / "crates/web/src/api/agent_hub_store.rs").read_text().split("#[cfg(test)]")[0]
        self.assertEqual(store.count("let event = HubEvent {"), 2)
        for constructor in store.split("let event = HubEvent {")[1:]:
            fields = constructor.split("};", 1)[0]
            self.assertIn("visibility", fields)
        self.assertIn('record.insert("visibility".into(), "internal".into())', store)
        self.assertIn("profile_snapshot: Some(profile.clone())", store)


if __name__ == "__main__":
    unittest.main()
