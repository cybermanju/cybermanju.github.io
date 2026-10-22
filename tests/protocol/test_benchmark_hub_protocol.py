"""CyberManju OS — Hub Protocol Benchmark Tests (tests/protocol/test_benchmark_hub_protocol.py).
Role: Verify benchmark math, strict golden validation, malformed responses and unavailable capabilities.
Exports: unittest coverage for scripts/benchmark-hub-protocol.py.
Integrates: Python standard library only; fake adapters never contact a provider.
Contracts: Test-only synthetic responses do not establish runtime projection equivalence or performance.
"""
from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "benchmark-hub-protocol.py"
spec = importlib.util.spec_from_file_location("benchmark_hub_protocol", SCRIPT)
benchmark = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(benchmark)


class FakeAdapter:
    def __init__(self, response: str, usage: int | None = 9):
        self.response, self.usage = response, usage

    def complete(self, prompt: str) -> tuple[str, int | None, float]:
        return self.response, self.usage, 0.02


class BenchmarkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cases = [{"id": "synthetic-add", "baseline": "synthetic task: 2 + 3",
                       "projection": "synthetic compact: add(2,3)", "golden": {"answer": 5}}]


    def test_runtime_body_dispatch_preserves_policy_and_messages(self) -> None:
        bodies = []
        class RuntimeFake:
            def complete_body(self, body):
                bodies.append(body)
                return '{"answer":5}', 11, .01
        policy = "INTERNAL_OUTPUT_POLICY fixture"
        old_messages = [{"role": "system", "content": policy}, {"role": "user", "content": "old"}]
        new_messages = [{"role": "system", "content": policy}, {"role": "user", "content": "new"}]
        cases = [{"id": "runtime", "runtimeBodies": True,
                  "baseline": {"model": "source-model", "messages": old_messages},
                  "projection": {"model": "source-model", "messages": new_messages},
                  "golden": {"answer": 5}}]
        report = benchmark.run(cases, 1, RuntimeFake(), None)
        self.assertEqual(len(bodies), 2)
        self.assertEqual({json.dumps(body, sort_keys=True) for body in bodies},
                         {json.dumps({"model": "source-model", "messages": old_messages}, sort_keys=True),
                          json.dumps({"model": "source-model", "messages": new_messages}, sort_keys=True)})
        self.assertTrue(all("Return only the JSON object" not in message["content"]
                            for body in bodies for message in body["messages"]))
        self.assertEqual(report["tokens_prompt"], {"baseline": 11, "projection": 11})
        self.assertIn("provider usage", report["origem_tokens"])

    def test_missing_provider_usage_without_tokenizer_is_unavailable(self) -> None:
        report = benchmark.run(self.cases, 1, FakeAdapter('{"answer":5}', None), None)
        self.assertTrue(report["tokens_prompt"].startswith("indisponivel"))
        self.assertEqual(report["origem_tokens"], "indisponivel")

    def test_nearest_rank_percentiles(self) -> None:
        self.assertEqual(benchmark.percentile([4, 1, 3, 2], .50), 2)
        self.assertEqual(benchmark.percentile([4, 1, 3, 2], .95), 4)
        self.assertIsNone(benchmark.percentile([], .95))

    def test_fake_typed_golden_accuracy_and_provider_token_usage(self) -> None:
        report = benchmark.run(self.cases, 2, FakeAdapter('{"answer":5}'), None)
        case = report["casos"][0]
        self.assertEqual(case["accuracy"]["baseline"]["correct"], 2)
        self.assertEqual(case["accuracy"]["projection"]["rate"], 1.0)
        self.assertEqual(report["tokens_prompt"], {"baseline": 18, "projection": 18})
        self.assertEqual(report["latencia_provedor_segundos"]["baseline"]["p50"], .02)

    def test_bool_is_not_typed_integer_golden(self) -> None:
        self.assertFalse(benchmark.strict_equal({"answer": 1}, {"answer": True}))
        report = benchmark.run(self.cases, 1, FakeAdapter('{"answer":true}'), None)
        self.assertEqual(report["casos"][0]["accuracy"]["baseline"]["correct"], 0)

    def test_malformed_response_counts_as_accuracy_failure(self) -> None:
        report = benchmark.run(self.cases, 1, FakeAdapter("not-json"), None)
        self.assertEqual(report["casos"][0]["invalid_response_count"], 2)
        self.assertEqual(report["casos"][0]["accuracy"]["projection"]["correct"], 0)

    def test_duplicate_json_keys_are_not_valid_golden_answers(self) -> None:
        report = benchmark.run(self.cases, 1, FakeAdapter('{"answer":0,"answer":5}'), None)
        self.assertEqual(report["casos"][0]["invalid_response_count"], 2)
        self.assertEqual(report["casos"][0]["accuracy"]["projection"]["correct"], 0)

    def test_offline_capabilities_are_unavailable_not_estimated(self) -> None:
        report = benchmark.run(self.cases, 1, None, None)
        self.assertEqual(report["tokens_prompt"], "indisponivel (conteúdo estruturado não suportado ou tokenizer/usage ausente)")
        self.assertEqual(report["casos"][0]["accuracy"], "indisponivel")
        self.assertEqual(report["latencia_provedor_segundos"], "indisponivel (use --live)")

    def test_case_schema_rejects_malformed_input(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cases.json"
            path.write_text(json.dumps([{"id": "bad", "baseline": "x", "projection": "y", "golden": []}]))
            with self.assertRaises(ValueError):
                benchmark.load_cases(str(path))

    def test_transport_does_not_assume_json_mode_capability(self) -> None:
        seen = []
        class Opener:
            def open(self, request, timeout):
                seen.append(json.loads(request.data))
                return io.BytesIO(json.dumps({"choices": [{"message": {"content": "{}"}}],
                                             "usage": {"prompt_tokens": 7}}).encode())
        adapter = benchmark.ChatCompletions("http://127.0.0.1/v1", "test", "synthetic-only")
        with patch.object(benchmark.urllib.request, "build_opener", return_value=Opener()):
            response, tokens, latency = adapter.complete("public synthetic task")
        self.assertEqual(response, "{}")
        self.assertEqual(tokens, 7)
        self.assertGreaterEqual(latency, 0)
        self.assertNotIn("response_format", seen[0])
        self.assertNotIn("tools", seen[0])

    def test_endpoint_cannot_send_credentials_over_remote_http_or_query(self) -> None:
        for endpoint in ["http://example.com/v1", "https://example.com/v1?key=unsafe",
                         "https://user:password@example.com/v1", "https://example.com/v1#fragment"]:
            with self.assertRaises(RuntimeError):
                benchmark.ChatCompletions(endpoint, "test", "synthetic-only")

    def test_real_tokenizer_counts_content_without_latency_or_quality_claims(self) -> None:
        if importlib.util.find_spec("tiktoken") is None:
            self.skipTest("real tokenizer not installed")
        try:
            counter = benchmark.TiktokenCounter("gpt-4o")
        except Exception:
            self.skipTest("named tokenizer vocabulary unavailable")
        report = benchmark.run(self.cases, 2, None, counter)
        for variant in ["baseline", "projection"]:
            expected = counter.count(benchmark.prompt_for(self.cases[0][variant])) * 2
            self.assertGreater(expected, 0)
            self.assertEqual(report["tokens_prompt"][variant], expected)
        self.assertEqual(report["casos"][0]["accuracy"], "indisponivel")
        self.assertTrue(report["latencia_provedor_segundos"].startswith("indisponivel"))


if __name__ == "__main__":
    unittest.main()
