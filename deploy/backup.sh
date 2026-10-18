#!/usr/bin/env bash
# Backup diário do banco + uploads. Instalado na VPS em /usr/local/sbin/eplenarius-backup
# (fora do alcance do deploy automático). Cron (root):
#   15 3 * * * /usr/local/sbin/eplenarius-backup >> /var/log/eplenarius-backup.log 2>&1
set -euo pipefail
umask 077
cd /srv/sites/eplenarius
set -a; . ./.env.prod; set +a

STAMP=$(date +%Y%m%d-%H%M)
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p backups

docker exec eplenarius_db pg_dump -U "${DB_USER:-eplenarius}" -d "${DB_NAME:-eplenarius}" -Fc \
  > "backups/db-$STAMP.dump"
docker run --rm -v eplenarius_uploads:/u:ro -v "$PWD/backups":/b alpine \
  tar czf "/b/uploads-$STAMP.tgz" -C /u .

find backups -type f -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] backup ok: db-$STAMP.dump uploads-$STAMP.tgz"
