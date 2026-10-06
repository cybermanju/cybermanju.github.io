# AGENTS.md — CyberManju OS agent rules

## Toolchain rules
- NEVER install or set up Rust/Cargo locally (`rustup`, `apt install cargo`, `cargo install`, etc.).
  - No local `cargo fmt`, `cargo clippy`, or `cargo test`.
  - Rely on CI (`Rust Lint & Test` job) for all Rust validation.
  - Local checks allowed: `npm test`, `npx vue-tsc --noEmit`, `bash scripts/check-version.sh`.
- NEVER run `npm ci` from scratch unless required by CI parity; prefer existing `node_modules`.

## Git / GitHub rules
- GH token is persisted in `~/.bashrc` (`GH_TOKEN` / `GITHUB_TOKEN`) and `~/.config/gh/hosts.yml`.
  - Do NOT pass the token explicitly in every command; rely on stored auth (`gh auth status` must pass with no env override).
- Default branch is `main`. Push with `git push origin main` (no `-f` unless explicitly requested).
- Always `git add -A` + commit + push when asked to push; then watch CI via `gh api .../actions/runs/...` (old `gh` has no `--branch` flag).

## CI rules
- CI workflow: `.github/workflows/ci.yml`. Watch until all jobs green; fix and re-push on failure.
- Do not cancel or re-run unrelated queued dependabot runs.
