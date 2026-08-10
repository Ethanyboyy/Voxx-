#!/bin/sh
# Applies any pending migrations against the mounted volume's database
# (idempotent — safe on every boot, including the very first one when the
# volume is empty) before starting the server, so a redeploy or restart
# never serves traffic against a stale schema.
set -e

npx prisma migrate deploy

exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
