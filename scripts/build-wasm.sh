#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== CyberManju OS — WASM Build for GitHub Pages ==="
echo ""

cd "$PROJECT_ROOT"
npm ci

echo "[1/2] Building WASM frontend..."
npx vite build --config vite.config.wasm.ts

echo "[2/2] WASM build complete!"
echo "Output: dist-wasm/"
ls -la dist-wasm/ 2>/dev/null || echo "(no output found)"