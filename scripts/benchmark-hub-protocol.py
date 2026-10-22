#!/usr/bin/env python3
"""CyberManju OS — Hub Protocol Benchmark (scripts/benchmark-hub-protocol.py).
Role: Measure paired baseline/projected hub prompt performance without fabricated token or accuracy claims.
Exports: JSON case runner, explicit live chat-completions adapter, self-test.
Integrates: External JSON fixtures; optional tiktoken and explicitly requested OpenAI-compatible endpoint.
Contracts: No provider calls without --live; no byte estimates; provider errors and credentials are never emitted.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Any


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile, suitable for a small repeated benchmark sample."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, int((p * len(ordered) + 0.999999)) - 1))]


def strict_equal(expected: Any, actual: Any) -> bool:
    """JSON equality with exact types (not Python's bool/int equivalence)."""
    if type(expected) is not type(actual):
        return False
    if isinstance(expected, dict):
        return expected.keys() == actual.keys() and all(strict_equal(expected[k], actual[k]) for k in expected)
    if isinstance(expected, list):
        return len(expected) == len(actual) and all(strict_equal(a, b) for a, b in zip(expected, actual))
    return expected == actual


def strict_json_loads(text: str) -> Any:
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique_pairs)


def load_cases(path: str) -> list[dict[str, Any]]:
    raw = strict_json_loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("cases must be a non-empty JSON array")
    for i, case in enumerate(raw):
        if (not isinstance(case, dict) or not isinstance(case.get("id"), str) or
                not isinstance(case.get("baseline"), str) or not isinstance(case.get("projection"), str) or
                not isinstance(case.get("golden"), dict)):
            raise ValueError(f"case {i} requires string id/baseline/projection and object golden")
        if case.get("runtimeBodies") is True:
            case["baseline"] = strict_json_loads(case["baseline"])
            case["projection"] = strict_json_loads(case["projection"])
            for variant in ("baseline", "projection"):
                validate_runtime_body(case[variant])
    return raw


_BODY_FIELDS = {"model", "messages", "temperature", "top_p", "n", "stream", "stop", "max_tokens",
                "max_completion_tokens", "presence_penalty", "frequency_penalty", "logit_bias",
                "user", "seed", "tools", "tool_choice", "parallel_tool_calls", "response_format",
                "service_tier", "metadata", "store", "reasoning_effort", "verbosity"}


def validate_runtime_body(body: Any) -> None:
    if not isinstance(body, dict) or not isinstance(body.get("model"), str) or not isinstance(body.get("messages"), list):
        raise ValueError("runtime request requires model string and messages array")
    if set(body) - _BODY_FIELDS or "tools" in body or "response_format" in body:
        raise ValueError("unsupported runtime request dialect")
    for message in body["messages"]:
        if not isinstance(message, dict) or not isinstance(message.get("role"), str):
            raise ValueError("unsupported runtime message")
        if not isinstance(message.get("content"), str):
            raise ValueError("structured or missing message content is unsupported")


def runtime_content_tokens(body: dict[str, Any], tokenizer: Any) -> int:
    validate_runtime_body(body)
    return sum(tokenizer.count(message["content"]) for message in body["messages"])


class TiktokenCounter:
    def __init__(self, model: str):
        import tiktoken  # optional real tokenizer, never approximated
        self.encoding = tiktoken.encoding_for_model(model)

    def count(self, text: str) -> int:
        return len(self.encoding.encode(text, disallowed_special=()))


class ChatCompletions:
    def __init__(self, endpoint: str, model: str, key: str):
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}):
            raise RuntimeError("provider endpoint must use HTTPS or loopback HTTP")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise RuntimeError("provider endpoint cannot contain credentials, query or fragment")
        self.url = endpoint.rstrip("/") + "/chat/completions"
        self.model, self.key = model, key

    def complete(self, prompt: str) -> tuple[str, int | None, float]:
        return self.complete_body({"model": self.model, "messages": [{"role": "user", "content": prompt}]})

    def complete_body(self, body: dict[str, Any]) -> tuple[str, int | None, float]:
        validate_runtime_body(body)
        # Provider selection is explicit: preserve the actual body except selected adapter model.
        sent = dict(body)
        sent["model"] = self.model
        body_bytes = json.dumps(sent).encode()
        req = urllib.request.Request(self.url, data=body_bytes, headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/json"}, method="POST")
        start = time.perf_counter()
        try:
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    return None
            opener = urllib.request.build_opener(NoRedirect())
            with opener.open(req, timeout=120) as response:
                raw = response.read(262_145)
                if len(raw) > 262_144:
                    raise ValueError("response limit")
                payload = json.loads(raw.decode("utf-8"))
        except Exception:
            # Deliberately suppress underlying exception text (could contain endpoint/key details).
            raise RuntimeError("provider request failed") from None
        elapsed = time.perf_counter() - start
        try:
            content = payload["choices"][0]["message"]["content"]
            if payload["choices"][0].get("finish_reason", "stop") != "stop":
                raise ValueError
            usage = payload.get("usage", {}).get("prompt_tokens")
            if not isinstance(content, str) or (usage is not None and (type(usage) is not int or usage < 0)):
                raise ValueError
        except (KeyError, IndexError, TypeError, ValueError):
            raise RuntimeError("malformed provider response") from None
        return content, usage, elapsed


def prompt_for(text: str) -> str:
    return "Return only the JSON object representing the requested result. Input: " + text


def run(cases: list[dict[str, Any]], iterations: int, live: ChatCompletions | None,
        tokenizer: TiktokenCounter | None) -> dict[str, Any]:
    result: dict[str, Any] = {"casos": [], "iteracoes_pareadas": iterations}
    all_latency: dict[str, list[float]] = {"baseline": [], "projection": []}
    token_totals: dict[str, int] = {"baseline": 0, "projection": 0}
    token_sources: dict[str, set[str]] = {"baseline": set(), "projection": set()}
    token_unknown = False
    for case in cases:
        runtime = case.get("runtimeBodies") is True
        entry: dict[str, Any] = {"id": case["id"], "accuracy": "indisponivel" if not live else None,
                                 "invalid_response_count": 0}
        case_latency: dict[str, list[float]] = {"baseline": [], "projection": []}
        correct = {"baseline": 0, "projection": 0}
        for _ in range(iterations):
            order = ["baseline", "projection"]
            random.shuffle(order)
            for variant in order:
                body = case[variant]
                if runtime:
                    try:
                        validate_runtime_body(body)
                    except ValueError:
                        token_unknown = True
                        raise
                    count = runtime_content_tokens(body, tokenizer) if tokenizer else None
                    prompt = None
                else:
                    prompt = prompt_for(body)
                    count = tokenizer.count(prompt) if tokenizer else None
                content = None
                usage = None
                if live:
                    content, usage, elapsed = (live.complete_body(body) if runtime else live.complete(prompt))
                    case_latency[variant].append(elapsed)
                    all_latency[variant].append(elapsed)
                if live and type(usage) is int:
                    token_totals[variant] += usage
                    token_sources[variant].add("provider usage")
                elif count is not None:
                    token_totals[variant] += count
                    token_sources[variant].add("tiktoken content-only" if runtime else "tiktoken synthetic prompt")
                else:
                    token_unknown = True
                if live:
                    try:
                        decoded = strict_json_loads(content)
                        if not isinstance(decoded, dict):
                            raise ValueError
                        if strict_equal(case["golden"], decoded):
                            correct[variant] += 1
                    except (ValueError, TypeError):
                        entry["invalid_response_count"] += 1
        if live:
            entry["accuracy"] = {v: {"correct": correct[v], "total": iterations,
                                     "rate": correct[v] / iterations} for v in correct}
            entry["provider_latency_seconds"] = {v: {"p50": percentile(case_latency[v], .50),
                "p95": percentile(case_latency[v], .95)} for v in case_latency}
        result["casos"].append(entry)
    result["tokens_prompt"] = ("indisponivel (conteúdo estruturado não suportado ou tokenizer/usage ausente)"
                                if token_unknown else token_totals)
    sources = set.union(*token_sources.values()) if token_sources else set()
    result["origem_tokens"] = ", ".join(sorted(sources)) if sources else "indisponivel"
    result["latencia_provedor_segundos"] = ({v: {"p50": percentile(all_latency[v], .50),
        "p95": percentile(all_latency[v], .95)} for v in all_latency} if live else "indisponivel (use --live)")
    result["aviso"] = "Fixtures string são sintéticas/harness apenas; não demonstram ganhos do runtime. Corpos runtime medem texto content-only, não framing."
    return result


def _self_test() -> None:
    assert percentile([1, 2, 3, 4], .50) == 2
    assert percentile([1, 2, 3, 4], .95) == 4
    assert not strict_equal({"x": 1}, {"x": True})
    assert strict_equal({"x": [1, "a"]}, {"x": [1, "a"]})
    class Fake:
        def complete(self, prompt: str) -> tuple[str, int, float]:
            return '{"v":3}', 12, 0.01
    cases = [{"id": "fake", "baseline": "calc", "projection": "calc compact", "golden": {"v": 3}}]
    report = run(cases, 3, Fake(), None)
    assert report["casos"][0]["accuracy"]["baseline"] == {"correct": 3, "total": 3, "rate": 1.0}
    assert report["tokens_prompt"]["baseline"] == 36
    class Malformed:
        def complete(self, prompt: str) -> tuple[str, int, float]:
            return "not json", 5, 0.02
    assert run(cases, 1, Malformed(), None)["casos"][0]["invalid_response_count"] == 2
    offline = run(cases, 1, None, None)
    assert offline["casos"][0]["accuracy"] == "indisponivel"
    assert offline["latencia_provedor_segundos"].startswith("indisponivel")
    print("Self-test OK: percentis, igualdade tipada, resposta fake, JSON inválido e capacidades indisponíveis.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark pareado, offline por padrão; saída e instruções em português.")
    parser.add_argument("cases", nargs="?", help="Arquivo JSON de casos [{id,baseline,projection,golden}]")
    parser.add_argument("--iterations", type=int, default=5, help="Repetições pareadas por caso (padrão: 5)")
    parser.add_argument("--tokenizer", choices=["tiktoken"], help="Tokenizer real opcional; sem estimativas")
    parser.add_argument("--tokenizer-model", help="Modelo reconhecido pelo tiktoken")
    parser.add_argument("--live", action="store_true", help="Permite explicitamente chamadas de chat completions")
    parser.add_argument("--provider-endpoint", help="Base URL do provedor; padrão OPENAI_API_BASE")
    parser.add_argument("--provider-model", help="Modelo; padrão OPENAI_MODEL")
    parser.add_argument("--self-test", action="store_true", help="Executa testes unitários stdlib sem rede")
    args = parser.parse_args()
    if args.self_test:
        _self_test()
        return 0
    if not args.cases or args.iterations < 1:
        parser.error("informe casos e --iterations positivo")
    if args.live and (not (args.provider_endpoint or os.getenv("OPENAI_API_BASE")) or
                      not (args.provider_model or os.getenv("OPENAI_MODEL")) or not os.getenv("OPENAI_API_KEY")):
        parser.error("--live exige OPENAI_API_BASE, OPENAI_API_KEY e OPENAI_MODEL (ou endpoint/modelo por opção)")
    if not args.live and (args.provider_endpoint or args.provider_model):
        parser.error("opções de provedor exigem --live")
    tokenizer = None
    if args.tokenizer:
        if not args.tokenizer_model:
            parser.error("--tokenizer tiktoken exige --tokenizer-model")
        try:
            tokenizer = TiktokenCounter(args.tokenizer_model)
        except Exception:
            print("Tokenizer real indisponível; contagem de tokens será reportada indisponível.", file=sys.stderr)
    elif args.tokenizer_model:
        parser.error("--tokenizer-model exige --tokenizer tiktoken")
    try:
        cases = load_cases(args.cases)
    except Exception:
        parser.error("arquivo de casos inválido ou ilegível")
    try:
        adapter = ChatCompletions(args.provider_endpoint or os.getenv("OPENAI_API_BASE", ""),
                                  args.provider_model or os.getenv("OPENAI_MODEL", ""),
                                  os.getenv("OPENAI_API_KEY", "")) if args.live else None
        print(json.dumps(run(cases, args.iterations, adapter, tokenizer), ensure_ascii=False, indent=2))
    except RuntimeError as exc:
        print(f"Benchmark interrompido: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
