#!/bin/sh
# Compressed PostgreSQL dump into deploy/backups/, keeping the last 14 days.
# Cron (daily 03:30):  30 3 * * * cd /opt/puente && sh deploy/backup.sh >> deploy/backup.log 2>&1
# Restore: see docs/DEPLOY.md §7 (stop the API and empty the schema first).
set -eu

cd "$(dirname "$0")"
mkdir -p backups
file="backups/puente-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U puente --no-owner puente | gzip > "$file"
chmod 600 "$file"
find backups -name 'puente-*.sql.gz' -mtime +14 -delete
echo "$(date -u +%FT%TZ) respaldo: $file ($(du -h "$file" | cut -f1))"
