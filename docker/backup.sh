#!/bin/sh
# Postgres logical backups: one custom-format dump per run, pruned by age.
# Usage: backup.sh          -> loop (interval from BACKUP_INTERVAL_HOURS)
#        backup.sh once     -> single dump, used by tests and manual runs
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

host="${POSTGRES_HOST:-db}"
interval_hours="${BACKUP_INTERVAL_HOURS:-24}"
keep_days="${BACKUP_KEEP_DAYS:-7}"
dir="${BACKUP_DIR:-/backups}"

export PGPASSWORD="$POSTGRES_PASSWORD"
mkdir -p "$dir"

log() { echo "[backup] $*"; }

backup_once() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  final="$dir/${POSTGRES_DB}-${stamp}.dump"
  tmp="$final.tmp"

  log "dumping ${POSTGRES_DB} from ${host} -> ${final}"
  if ! pg_dump -h "$host" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp"; then
    log "pg_dump failed"
    rm -f "$tmp"
    return 1
  fi

  # a dump we cannot even list is worthless; fail loudly instead of keeping garbage
  if ! pg_restore --list "$tmp" >/dev/null; then
    log "dump is unreadable, discarding"
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$final"
  log "ok: ${final} ($(wc -c < "$final") bytes)"

  find "$dir" -name '*.dump' -type f -mtime "+${keep_days}" -print -delete
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit 0
fi

log "every ${interval_hours}h, keeping ${keep_days} days in ${dir}"
while :; do
  if backup_once; then
    sleep_for=$((interval_hours * 3600))
  else
    log "retrying in 5m"
    sleep_for=300
  fi
  sleep "$sleep_for"
done
