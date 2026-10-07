#!/usr/bin/env bash
# CyberManju OS — push helper.
# Stages everything, commits (never a bare 'update'), and pushes main + tags
# to GitHub (origin) AND the GitLab mirror (gitlab). No force-push ever:
# the script fetches first and rebases onto origin/main when behind, and
# pushes only tags the remote lacks — existing remote tags are never moved
# (tags/releases move only by explicit command).
#
# Commit message UX:
#   ./push.sh "feat: add watch-ci"     # positional (all words joined)
#   ./push.sh -m "feat: add watch-ci"  # explicit flag (same thing)
#   ./push.sh                          # interactive prompt when on a TTY
#                                      # (Enter accepts the dated default),
#                                      # dated default when piped/agent-driven
#
# CI watch (see scripts/watch-ci.sh — full logs of every step):
#   ./push.sh --watch "feat: ..."      # push, then watch the HEAD run
#   PUSH_WATCH_CI=1 ./push.sh -m "..."  # same via env
#   ./push.sh --watch --full ...        # print ALL logs inline, not just failures
#   scripts/watch-ci.sh --sha HEAD      # watch separately at any time
set -u
cd "$(dirname "$0")"

# Heal mixed-ownership `.git/objects` fanout dirs. Sessions here sometimes run
# as root and sometimes as a login uid; object dirs created by one owner
# block `git add` for the other with:
#   "insufficient permission for adding an object to repository database"
# When root, hand stray root-owned `.git` entries back to the worktree owner
# (root can write regardless). As non-root there is nothing safe to chown,
# so just warn early — the `git add` failure below still aborts cleanly.
if [ -d .git/objects ]; then
  if [ "$(id -u)" -eq 0 ]; then
    wt_owner="$(stat -c '%u:%g' . 2>/dev/null || true)"
    if [ -n "$wt_owner" ] && [ "$wt_owner" != "0:0" ]; then
      find .git -user root -exec chown "$wt_owner" {} + 2>/dev/null || true
    fi
  else
    bad_dir="$(find .git/objects -type d ! -writable -print -quit 2>/dev/null || true)"
    if [ -n "$bad_dir" ]; then
      echo "push.sh: WARNING: $bad_dir is not writable by $(id -un) (mixed root/uid .git ownership)." >&2
      echo "push.sh: WARNING: 'git add' may fail — re-run once as root (it heals .git) or run: sudo chown -R $(id -un):$(id -gn) .git" >&2
    fi
  fi
fi

MSG=""
ALLOW_EMPTY=0
DRY_RUN=0
WATCH="auto"   # auto|yes|no
WATCH_ARGS=()
SHOW_HELP=0

usage() {
  cat <<'EOF'
usage: push.sh [options] [message...]

options:
  -m, --message MSG   commit message (default: positional words joined,
                      else prompt on TTY, else dated "chore: sync YYYY-MM-DD")
  --allow-empty       commit even with nothing staged (re-triggers CI on demand)
  --dry-run           print the git commands without running them
  --watch             push, then watch CI for HEAD (full step logs via
                      scripts/watch-ci.sh); exit nonzero if CI is red
  --no-watch          never watch (default unless --watch or PUSH_WATCH_CI=1)
  --logs-dir DIR      pass through to watch-ci.sh
  --failed-only       pass through (print only failure logs; the default)
  --full              pass through (print ALL job logs inline)
  --timeout SECS      pass through to watch-ci.sh (default 3600)
  -h, --help          this help
EOF
}

positional=()
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    -m=*) MSG="${1#-m=}"; shift ;;
    --message=*) MSG="${1#--message=}"; shift ;;
    --allow-empty) ALLOW_EMPTY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --watch) WATCH="yes"; shift ;;
    --no-watch) WATCH="no"; shift ;;
    --logs-dir) WATCH_ARGS+=("$1" "${2:-}"); shift 2 ;;
    --logs-dir=*) WATCH_ARGS+=("$1"); shift ;;
    --failed-only|--full) WATCH_ARGS+=("$1"); shift ;;
    --timeout) WATCH_ARGS+=("$1" "${2:-}"); shift 2 ;;
    --timeout=*) WATCH_ARGS+=("$1"); shift ;;
    -h|--help) SHOW_HELP=1; shift ;;
    --) shift; while [ $# -gt 0 ]; do positional+=("$1"); shift; done ;;
    -*) echo "push.sh: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) positional+=("$1"); shift ;;
  esac
done

if [ "$SHOW_HELP" -eq 1 ]; then
  usage
  exit 0
fi

if [ -z "$MSG" ] && [ "${#positional[@]}" -gt 0 ]; then
  MSG="${positional[*]}"
fi

if [ -z "$MSG" ]; then
  default_msg="chore: sync $(date -u +%Y-%m-%d)"
  if [ -t 0 ]; then
    printf 'Commit message [%s]: ' "$default_msg" > /dev/tty
    IFS= read -r reply < /dev/tty || reply=""
    MSG="${reply:-$default_msg}"
  else
    MSG="$default_msg"
  fi
fi

# Trim surrounding whitespace.
MSG="$(printf '%s' "$MSG" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ -z "$MSG" ]; then
  echo "push.sh: empty commit message — aborting (pass -m \"...\" or --allow-empty to re-trigger CI)" >&2
  exit 2
fi
if printf '%s' "$MSG" | grep -qi '^update$'; then
  echo "push.sh: refusing bare 'update' as a commit message — say what changed" >&2
  exit 2
fi

if [ "$WATCH" = "auto" ] && [ "${PUSH_WATCH_CI:-0}" = "1" ]; then
  WATCH="yes"
fi

echo "push.sh: branch: $(git branch --show-current)"
echo "push.sh: working tree before staging:"
git status --short --branch || true

# This script only ever pushes `main`. Pushing the `main` ref from any other
# branch would silently push a stale ref instead of HEAD — refuse instead.
cur_branch="$(git branch --show-current)"
if [ "$cur_branch" != "main" ]; then
  echo "push.sh: refusing to push from '$cur_branch' — switch to main first (no force-push by design)" >&2
  exit 2
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  (dry-run) $*"
  else
    "$@"
  fi
}

if [ "$DRY_RUN" -eq 0 ]; then
  # A failed `git add` must abort here. Ignoring it stages nothing, prints
  # a confusing "nothing new to commit", then pushes stale HEAD.
  if ! git add -A; then
    echo "push.sh: 'git add -A' FAILED — refusing to commit/push a half-staged tree." >&2
    echo "push.sh: hint: mixed .git ownership? run: sudo chown -R $(stat -c '%U:%G' . 2>/dev/null || echo 'UID:GID') .git" >&2
    exit 1
  fi
else
  echo "  (dry-run) git add -A"
fi

staged=0
if [ "$DRY_RUN" -eq 1 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    staged=1
  fi
elif ! git diff --cached --quiet; then
  staged=1
fi

if [ "$staged" -eq 1 ]; then
  echo "push.sh: committing with message: $MSG"
  if [ "$DRY_RUN" -eq 0 ]; then
    echo "push.sh: staged change stat:"
    git diff --cached --stat || true
  fi
  if [ "$ALLOW_EMPTY" -eq 1 ]; then
    run git commit --allow-empty -m "$MSG" || { echo "push.sh: commit failed" >&2; exit 1; }
  else
    run git commit -m "$MSG" || { echo "push.sh: commit failed" >&2; exit 1; }
  fi
else
  if [ "$ALLOW_EMPTY" -eq 1 ]; then
    echo "push.sh: nothing staged — creating empty commit: $MSG"
    run git commit --allow-empty -m "$MSG"
  else
    echo "push.sh: nothing new to commit (use --allow-empty to force an empty commit)"
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (dry-run) git fetch origin && git fetch gitlab"
  echo "  (dry-run) git pull --rebase origin main (only if behind origin/main)"
  echo "  (dry-run) for r in origin gitlab: git push \$r main + push new tags only"
  if [ "$WATCH" = "yes" ]; then
    # shellcheck disable=SC2145: intentional array expansion display
    echo "  (dry-run) scripts/watch-ci.sh --sha HEAD ${WATCH_ARGS[*]:-}"
  fi
  exit 0
fi

# Push only tags the remote lacks. A tag that exists remotely with a
# different object is NEVER moved (releases move by explicit command only) —
# a blanket `git push --tags` turns that harmless skew into a FAILED remote.
push_new_tags() {
  remote="$1"
  rc=0
  for t in $(git tag --list); do
    [ -n "$t" ] || continue
    local_hash="$(git rev-parse "$t" 2>/dev/null || true)"
    remote_hash="$(git ls-remote "$remote" "refs/tags/$t" 2>/dev/null | awk '{print $1}')"
    if [ -z "$remote_hash" ]; then
      echo "push.sh: pushing new tag $t to $remote"
      if ! git push "$remote" "refs/tags/$t"; then
        echo "push.sh: tag $t -> $remote FAILED" >&2
        rc=1
      fi
    elif [ "$remote_hash" != "$local_hash" ]; then
      echo "push.sh: WARNING: tag $t differs on $remote ($remote_hash vs local $local_hash) — leaving the remote tag alone (explicit move only)" >&2
    fi
  done
  return "$rc"
}

fail=0
origin_ok=0

# Integrate remote work before pushing (no force-push, ever): fetch both
# remotes; if we are behind origin (source of truth — Pages deploys from it),
# rebase onto it. Anything still not fast-forward after that aborts below.
if ! git fetch origin; then
  echo "push.sh: fetch origin FAILED — aborting (cannot verify fast-forward)" >&2
  exit 1
fi
if ! git fetch gitlab; then
  echo "push.sh: WARNING: fetch gitlab failed — will still try the mirror push" >&2
fi
behind_origin="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
ahead_origin="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [ "${behind_origin:-0}" -gt 0 ]; then
  if [ "${ahead_origin:-0}" -gt 0 ]; then
    echo "push.sh: origin/main is $behind_origin ahead and we are $ahead_origin ahead — rebasing onto origin/main ..."
  else
    echo "push.sh: we are $behind_origin behind origin/main — fast-forwarding ..."
  fi
  if git pull --rebase origin main; then
    echo "push.sh: rebase onto origin/main OK"
  else
    echo "push.sh: rebase onto origin/main FAILED — resolve conflicts, then re-run (no -f)" >&2
    exit 1
  fi
fi

for remote in origin gitlab; do
  if git push "$remote" main; then
    echo "push.sh: $remote main OK"
    if [ "$remote" = "origin" ]; then
      origin_ok=1
    fi
    if ! push_new_tags "$remote"; then
      echo "push.sh: $remote tags FAILED" >&2
      fail=1
    fi
  else
    echo "push.sh: $remote main FAILED" >&2
    echo "push.sh: hint: 'git fetch $remote' then 'git pull --rebase $remote main' (no -f), then re-run" >&2
    echo "push.sh: hint: if it says 'could not read Username', no credentials are stored in this shell — set up auth (AGENTS.md §3), then re-run" >&2
    fail=1
  fi
done

head_sha="$(git rev-parse HEAD)"
echo "push.sh: HEAD is now $head_sha"

if [ "$WATCH" = "yes" ]; then
  if [ "$origin_ok" -eq 1 ]; then
    echo "push.sh: watching CI for $head_sha ..."
    if bash scripts/watch-ci.sh --sha "$head_sha" "${WATCH_ARGS[@]}"; then
      echo "push.sh: CI green"
    else
      echo "push.sh: CI NOT green — see logs above" >&2
      fail=1
    fi
  else
    echo "push.sh: skipping CI watch (origin push failed)" >&2
  fi
else
  echo "push.sh: watch CI with: scripts/watch-ci.sh --sha $head_sha  (or re-push with --watch)"
fi

exit "$fail"
