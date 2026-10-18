#!/usr/bin/env bash
# Watchdog da API. Instalado na VPS em /usr/local/sbin/eplenarius-watchdog. Cron (root):
#   */2 * * * * /usr/local/sbin/eplenarius-watchdog
# 3 falhas seguidas no /api/health → reinicia o container (exceto esquema desatualizado,
# que restart não resolve). Também registra disco acima de 90%.
set -uo pipefail

LOG=/var/log/eplenarius-watchdog.log
STATE=/var/lib/eplenarius-watchdog.fails
HEALTH=http://127.0.0.1:3010/api/health
log() { echo "[$(date -Is)] $*" >> "$LOG"; }

# Deploy em andamento: não interferir.
if ! flock -n /var/lock/eplenarius-deploy.lock true 2>/dev/null; then exit 0; fi

body=$(curl -s -m 10 -w '\n%{http_code}' "$HEALTH" 2>/dev/null) || body=$'\n000'
code=${body##*$'\n'}
fails=$(cat "$STATE" 2>/dev/null || echo 0)

if [ "$code" = 200 ]; then
  [ "$fails" -gt 0 ] && log "recuperado após $fails falha(s)"
  echo 0 > "$STATE"
elif echo "$body" | grep -q schema_outdated; then
  [ "$fails" = 0 ] && log "esquema do banco desatualizado — rodar deploy com sincronização (sem restart)"
  echo 1 > "$STATE"
else
  fails=$((fails + 1)); echo "$fails" > "$STATE"
  log "health falhou (HTTP $code), falha $fails/3"
  if [ "$fails" -ge 3 ]; then
    log "reiniciando eplenarius_api"
    docker restart eplenarius_api >/dev/null 2>&1 && log "restart ok" || log "restart FALHOU"
    echo 0 > "$STATE"
  fi
fi

usage=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${usage:-0}" -ge 90 ] && log "ALERTA: disco em ${usage}%"
exit 0
