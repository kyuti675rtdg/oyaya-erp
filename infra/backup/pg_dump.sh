#!/usr/bin/env bash
# Oyaya ERP — automated PostgreSQL backup via pg_dump (custom format, compressed).
#
# Schedule on the factory server with cron (runs as the deploy user):
#   0 2 * * * /opt/oyaya-erp/infra/backup/pg_dump.sh >> /var/log/oyaya-backup.log 2>&1
#
# Required env (or a .env file next to this script):
#   PGPASSWORD   Postgres password for DB_USER (never commit this)
# Optional env:
#   DB_HOST, DB_PORT, DB_USER, DB_NAME, BACKUP_DIR, RETENTION_DAYS
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/oyaya-erp}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-oyaya}"
DB_NAME="${DB_NAME:-oyaya_erp}"

if [ -z "${PGPASSWORD:-}" ]; then
  echo "ERROR: PGPASSWORD is not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

pg_dump --format=custom --compress=9 \
  --host="$DB_HOST" --port="$DB_PORT" \
  --username="$DB_USER" --dbname="$DB_NAME" \
  --file="$FILE"

# Prune backups older than the retention window.
find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump" -mtime +"$RETENTION_DAYS" -delete

echo "backup written: $FILE"

# Restore (manual, verified procedure):
#   pg_restore --clean --if-exists --host="$DB_HOST" --port="$DB_PORT" \
#     --username="$DB_USER" --dbname="$DB_NAME" "$FILE"
