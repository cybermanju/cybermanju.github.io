#!/usr/bin/env bash
# CyberManju OS — Backup (scripts/backup.sh).
# AGENT-4 item 12 — snapshot the redb database and the Tantivy search index.
#
#   scripts/backup.sh                  # snapshot now, keep 7
#   scripts/backup.sh --keep 30        # keep the newest 30 snapshots
#   scripts/backup.sh --dir /backups   # write somewhere else
#
# Same variable names the server uses, so a snapshot of a running deployment
# needs no extra configuration:
#
#   DB_PATH             redb database          (default /data/cybermanju.db)
#   SEARCH_INDEX_PATH   Tantivy index directory (default <dir of DB_PATH>/tantivy_index)
#   BACKUP_DIR          snapshot destination   (default <dir of DB_PATH>/backups)
#   BACKUP_KEEP         snapshots to keep      (default 7)
#
# Consistency: `cp --reflink=auto` is used when available, which takes a
# copy-on-write snapshot that stays valid while the server keeps writing.
# On filesystems without reflink this degrades to a plain copy of a live
# file — for a guaranteed-consistent archive stop the service first
# (see docs/OPERATIONS.md §5).
set -euo pipefail

cd "$(dirname "$0")/.."

keep="${BACKUP_KEEP:-7}"
dest_root="${BACKUP_DIR:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="${2:?--keep needs a number}"; shift 2 ;;
    --dir) dest_root="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$keep" in ''|*[!0-9]*) echo "--keep must be a number" >&2; exit 2 ;; esac

db_path="${DB_PATH:-/data/cybermanju.db}"
if [ ! -f "$db_path" ]; then
  echo "database not found: $db_path (set DB_PATH)" >&2
  exit 1
fi

db_dir="$(dirname "$db_path")"
index_path="${SEARCH_INDEX_PATH:-$db_dir/tantivy_index}"
dest_root="${dest_root:-$db_dir/backups}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$dest_root/$stamp"
mkdir -p "$dest"

# Reflink when the platform supports it (btrfs/xfs/APFS); otherwise fall back
# to a portable copy so the script keeps working on ext4 and busybox.
copy_one() {
  cp --reflink=auto -- "$1" "$2" 2>/dev/null || cp -p -- "$1" "$2"
}

copy_one "$db_path" "$dest/$(basename "$db_path")"
if [ -d "$index_path" ]; then
  cp -R -- "$index_path" "$dest/index"
fi

# Manifest: enough to tell a snapshot apart and to check it was not truncated.
manifest="$dest/MANIFEST.txt"
{
  echo "taken_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
  echo "database=$db_path"
  echo "database_bytes=$(wc -c < "$dest/$(basename "$db_path")" | tr -d ' ')"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "database_sha256=$(sha256sum "$dest/$(basename "$db_path")" | cut -d' ' -f1)"
  fi
  if [ -d "$dest/index" ]; then
    echo "search_index=$index_path"
    echo "search_index_bytes=$(du -sk "$dest/index" | cut -f1)K"
  else
    echo "search_index=absent"
  fi
} > "$manifest"

# Prune everything but the newest `keep` snapshots (names are UTC stamps, so
# a lexicographic sort is chronological).
if [ "$keep" -gt 0 ] && [ -d "$dest_root" ]; then
  stale="$(ls -1d "$dest_root"/20* 2>/dev/null | sort -r | tail -n "+$((keep + 1))" || true)"
  while IFS= read -r old; do
    if [ -n "$old" ]; then
      rm -rf -- "$old"
    fi
  done <<< "$stale"
fi

echo "backup: $dest"
grep -E '^(database_bytes|database_sha256|search_index)=' "$manifest" || true
