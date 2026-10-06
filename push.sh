#!/usr/bin/env bash
# CyberManju OS — push helper.
# Stages everything, commits (message from $1, dated default — never a bare
# 'update'), and pushes main + tags to GitHub (origin) AND the GitLab
# mirror (gitlab). No force-push: tags/releases move only by explicit command.
set -u
cd "$(dirname "$0")"

MSG="${1:-chore: sync $(date -u +%Y-%m-%d)}"

git add -A
if git diff --cached --quiet; then
  echo "push.sh: nothing new to commit"
else
  git commit -m "$MSG"
fi

fail=0
for remote in origin gitlab; do
  if git push "$remote" main && git push "$remote" --tags; then
    echo "push.sh: $remote OK"
  else
    echo "push.sh: $remote FAILED" >&2
    fail=1
  fi
done
exit "$fail"

