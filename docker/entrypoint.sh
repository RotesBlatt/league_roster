#!/bin/sh
set -eu

echo "[entrypoint] applying migrations"
bun apps/api/src/db/migrate.ts

echo "[entrypoint] starting api"
exec bun apps/api/src/index.ts
