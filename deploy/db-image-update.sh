#!/usr/bin/env bash
# Atualização mensal da imagem do Postgres (patches de segurança da série 16, mesma major).
# Instalado na VPS em /usr/local/sbin/eplenarius-db-update. Cron (root), 1º domingo do mês:
#   30 4 * * 0 [ "$(date +\%d)" -le 07 ] && /usr/local/sbin/eplenarius-db-update >> /var/log/eplenarius-db-update.log 2>&1
# Só recria o container se a imagem mudou, e sempre depois de um backup completo.
set -euo pipefail
APP=/srv/sites/eplenarius
DC=(docker compose -p eplenarius -f "$APP/docker-compose.prod.yml" --env-file "$APP/.env.prod")
log() { echo "[$(date -Is)] $*"; }

img=$(docker inspect -f '{{.Config.Image}}' eplenarius_db)
before=$(docker image inspect -f '{{.Id}}' "$img")
docker pull -q "$img" >/dev/null
after=$(docker image inspect -f '{{.Id}}' "$img")
[ "$before" = "$after" ] && { log "postgres já atualizado ($img)"; exit 0; }

/usr/local/sbin/eplenarius-backup
"${DC[@]}" up -d db
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' eplenarius_db 2>/dev/null)" = healthy ] && break
  sleep 2
done
# A API reconecta sozinha; o watchdog cobre o caso de não reconectar.
sleep 10
curl -sf http://127.0.0.1:3010/api/health >/dev/null && log "postgres atualizado: $img" || log "AVISO: health falhou após atualizar postgres"
