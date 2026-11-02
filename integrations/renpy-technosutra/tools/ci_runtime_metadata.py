#!/usr/bin/env python3
"""CyberManju OS — bind the validated Ren'Py runtime to its exact CI run.

Role: validate runtime bytes and generate the OS panel's build metadata.
Contracts: no promotion of an unvalidated, mismatched-commit, or mismatched-run game.zip; no deployment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

RUNTIME_FILES = ("index.html", "game.zip", "renpy-pre.js", "renpy.js", "renpy.wasm", "renpy.data", "service-worker.js")
METADATA_NAME = "build-metadata.json"


def validate_sha(sha: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected a full 40-character Git source SHA")
    return sha


def validate_run_pair(run_id: str, run_attempt: str) -> tuple[str, str]:
    if not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise ValueError("Expected a positive GitHub run ID")
    if not re.fullmatch(r"[1-9][0-9]*", run_attempt):
        raise ValueError("Expected a positive GitHub run attempt")
    return run_id, run_attempt


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def zip_facts(runtime: Path) -> tuple[int, str]:
    for name in RUNTIME_FILES:
        path = runtime / name
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f"Missing required runtime file: {path}")
    archive = runtime / "game.zip"
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return archive.stat().st_size, digest.hexdigest()


def export_metadata(report_path: Path, runtime: Path, sha: str, run_id: str, run_attempt: str) -> dict:
    validate_sha(sha)
    run_id, run_attempt = validate_run_pair(run_id, run_attempt)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("status") != "PASS" or report.get("smokeTest", {}).get("status") != "PASS":
        raise ValueError("Only a candidate with passing build and browser smoke reports may be exported")
    for field in ("authorizedSpritesIncluded", "runtimeSpriteSha256Verified", "spriteManifestPreserved", "captureManifestPreserved"):
        if report.get(field) is not True:
            raise ValueError(f"Missing build validation: {field}")
    if report.get("rawSourceCapturePngsInPackage") is not False:
        raise ValueError("Raw source captures must not be included in the runtime")
    if report.get("runtimeSpriteCount") != 54 or report.get("optimizedImageCount") != 56:
        raise ValueError("Unexpected approved sprite/background inventory")
    expected_build_id = f"ci-{run_id}-{run_attempt}"
    if report.get("buildId") != expected_build_id:
        raise ValueError("Ren'Py build ID does not match the current workflow run and attempt")
    size, digest = zip_facts(runtime)
    service_worker_digest = file_sha256(runtime / "service-worker.js")
    if size != report.get("gameZipBytes") or digest != report.get("gameZipSha256"):
        raise ValueError("Runtime game.zip differs from the validated build report")
    version = re.search(r"\d+\.\d+\.\d+(?:\.\d+)?", str(report.get("engine", "")))
    if version is None:
        raise ValueError("Ren'Py engine version is missing from the validated build report")
    metadata = {
        "schemaVersion": 1,
        "sourceSha": sha,
        "runId": run_id,
        "runAttempt": run_attempt,
        "assetBasePath": "technosutra-vn/",
        "validationCommit": sha[:7],
        "buildId": expected_build_id,
        "renpyVersion": version.group(),
        "optimizedBackgroundCount": report["optimizedImageCount"],
        "runtimeSpriteCount": report["runtimeSpriteCount"],
        "gameZipBytes": size,
        "gameZipSha256": digest,
        "serviceWorkerSha256": service_worker_digest,
        "webOutputBytes": report["webOutputBytes"],
    }
    (runtime / METADATA_NAME).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def stage_typescript(runtime: Path, output: Path, expected_sha: str, expected_run_id: str, expected_run_attempt: str) -> dict:
    validate_sha(expected_sha)
    expected_run_id, expected_run_attempt = validate_run_pair(expected_run_id, expected_run_attempt)
    metadata = json.loads((runtime / METADATA_NAME).read_text(encoding="utf-8"))
    expected_build_id = f"ci-{expected_run_id}-{expected_run_attempt}"
    if metadata.get("schemaVersion") != 1 or metadata.get("sourceSha") != expected_sha:
        raise ValueError("Ren'Py artifact was not built from this OS source commit")
    if (
        metadata.get("runId") != expected_run_id
        or metadata.get("runAttempt") != expected_run_attempt
        or metadata.get("buildId") != expected_build_id
    ):
        raise ValueError("Ren'Py artifact was built by a different workflow run or attempt")
    size, digest = zip_facts(runtime)
    if size != metadata.get("gameZipBytes") or digest != metadata.get("gameZipSha256"):
        raise ValueError("Downloaded game.zip differs from its CI runtime metadata")
    service_worker_digest = file_sha256(runtime / "service-worker.js")
    if service_worker_digest != metadata.get("serviceWorkerSha256"):
        raise ValueError("Downloaded service-worker.js differs from its CI runtime metadata")
    if metadata.get("validationCommit") != expected_sha[:7] or metadata.get("assetBasePath") != "technosutra-vn/":
        raise ValueError("Invalid runtime commit/path metadata")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "// CyberManju OS — validated Ren'Py CI runtime metadata.\n"
        "// Role: bind the OS window to the exact source SHA and checked game.zip.\n"
        "// Generated during CI from the same-run Ren'Py artifact; never asserts a full playthrough.\n"
        "export const TECHNOSUTRA_VN_BUILD = "
        + json.dumps({key: value for key, value in metadata.items() if key != "schemaVersion"}, indent=2)
        + " as const\n",
        encoding="utf-8",
    )
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--build-report", type=Path, required=True)
    export.add_argument("--runtime-dir", type=Path, required=True)
    export.add_argument("--sha", required=True)
    export.add_argument("--run-id", required=True)
    export.add_argument("--run-attempt", required=True)
    stage = commands.add_parser("stage")
    stage.add_argument("--runtime-dir", type=Path, required=True)
    stage.add_argument("--typescript-output", type=Path, required=True)
    stage.add_argument("--expected-sha", required=True)
    stage.add_argument("--expected-run-id", required=True)
    stage.add_argument("--expected-run-attempt", required=True)
    args = parser.parse_args()
    try:
        if args.command == "export":
            metadata = export_metadata(args.build_report, args.runtime_dir, args.sha, args.run_id, args.run_attempt)
        else:
            metadata = stage_typescript(args.runtime_dir, args.typescript_output, args.expected_sha, args.expected_run_id, args.expected_run_attempt)
    except (KeyError, OSError, ValueError, TypeError) as error:
        parser.exit(1, f"Ren'Py runtime validation failed: {error}\n")
    print(f"PASS: source {metadata['sourceSha']}; run {metadata['runId']} attempt {metadata['runAttempt']}; game.zip SHA-256 {metadata['gameZipSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
