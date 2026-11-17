#!/bin/sh
# CI helper: proves docker/backup.sh can dump the live database and that the dump
# restores into an empty one.
#
# Defaults target the GitHub Linux runner: host networking + Postgres on
# 127.0.0.1:5432. On Docker Desktop pass NETWORK_MODE="" and
# DB_HOST=host.docker.internal. Day-to-day backups don't need this script:
#   docker compose run --rm backup once
set -eu

IMAGE="${IMAGE:-postgres:17-alpine}"
VOLUME="${VOLUME:-backup-check}"
DB_HOST="${DB_HOST:-127.0.0.1}"
# word splitting is intended: either "--network host" or empty
NETWORK_MODE="${NETWORK_MODE---network host}"
# shellcheck disable=SC2086
set -- $NETWORK_MODE

: "${POSTGRES_USER:=lol}"
: "${POSTGRES_PASSWORD:=lol}"
: "${POSTGRES_DB:=lol}"

docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true

echo "[ci] taking a backup"
docker run --rm "$@" \
  -v "$PWD/docker/backup.sh:/usr/local/bin/backup.sh:ro" \
  -v "$VOLUME:/backups" \
  -e "POSTGRES_HOST=$DB_HOST" \
  -e "POSTGRES_USER=$POSTGRES_USER" \
  -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  -e "POSTGRES_DB=$POSTGRES_DB" \
  "$IMAGE" sh /usr/local/bin/backup.sh once

echo "[ci] restoring that backup into a scratch database"
docker run --rm "$@" \
  -v "$VOLUME:/backups" \
  -e "PGHOST=$DB_HOST" \
  -e "PGUSER=$POSTGRES_USER" \
  -e "PGPASSWORD=$POSTGRES_PASSWORD" \
  -e "PGDATABASE=$POSTGRES_DB" \
  "$IMAGE" sh -ec '
    ls -lt /backups
    dump=$(ls -1t /backups/*.dump | head -1)
    echo "restoring $dump"

    psql -d postgres -c "drop database if exists restore_check"
    psql -d postgres -c "create database restore_check"
    pg_restore -d restore_check "$dump"

    source_tables=$(psql -tAc "select count(*) from information_schema.tables
      where table_schema = '"'"'public'"'"'")
    restored_tables=$(psql -d restore_check -tAc "select count(*) from
      information_schema.tables where table_schema = '"'"'public'"'"'")

    echo "source tables=$source_tables restored tables=$restored_tables"
    test "$source_tables" = "$restored_tables"
    test "$restored_tables" -gt 0

    psql -d postgres -c "drop database restore_check"
  '

docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
echo "[ci] backup and restore ok"
