#!/usr/bin/env python3
"""Stamp the Web service worker with a content hash of the shipped runtime.

The worker's cache name is derived from every byte the game serves (minus the
worker itself), so a deploy invalidates the cache exactly when something changed:
no manual version bumps, and no stale engine or archive left in a returning
visitor's browser after an update.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

PLACEHOLDER = "__STEM_CACHE_VERSION__"
WORKER = "service-worker.js"
STAMP_LENGTH = 16
# Only the assignment is rewritten. The placeholder is also named in the worker's
# header comment, so a whole-file replace would both double-count and stamp prose.
ASSIGNMENT = re.compile(r"var CACHE_VERSION = '" + PLACEHOLDER + r"';")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def content_version(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.name != WORKER):
        relative = path.relative_to(root).as_posix()
        digest.update(f"{relative}\0{path.stat().st_size}\0{file_sha256(path)}\n".encode("utf-8"))
    return digest.hexdigest()[:STAMP_LENGTH]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web_directory", type=Path, help="built Web output directory")
    args = parser.parse_args()
    root = args.web_directory.resolve()
    worker = root / WORKER
    if not worker.is_file():
        raise SystemExit(f"Missing service worker: {worker}")
    text = worker.read_text(encoding="utf-8")
    found = len(ASSIGNMENT.findall(text))
    if found != 1:
        raise SystemExit(f"{WORKER} must contain exactly one {PLACEHOLDER} assignment, found {found}")
    version = content_version(root)
    stamped = ASSIGNMENT.sub(f"var CACHE_VERSION = '{version}';", text)
    if PLACEHOLDER in ASSIGNMENT.pattern:
        worker.write_text(stamped, encoding="utf-8")
    print(f"Stamped {worker} with cache version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
