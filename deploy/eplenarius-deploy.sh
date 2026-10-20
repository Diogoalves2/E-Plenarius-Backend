#!/usr/bin/env bash
# Deploy do backend acionado pelo GitHub Actions.
#
# Instalado na VPS em /usr/local/sbin/eplenarius-deploy (root, 755) e amarrado à chave do
# GitHub em /root/.ssh/authorized_keys com:
#   command="/usr/local/sbin/eplenarius-deploy",restrict ssh-ed25519 AAAA... github-actions-eplenarius
# A chave só executa este script: sem shell, sem port-forward, sem pty.
#
# Recebe pelo stdin um tar.gz com APENAS o código da API (src, scripts, package*.json,
# tsconfig, nest-cli, Dockerfile). docker-compose.prod.yml, .env.prod, backup e este
# script são da VPS e nunca vêm do repositório: comprometer o GitHub não dá root no host.
#
# Comandos (SSH_ORIGINAL_COMMAND): "deploy <sha>" | "deploy-sync <sha>" (sincroniza schema)
set -euo pipefail

APP=/srv/sites/eplenarius
LOG=/var/log/eplenarius-deploy.log
HEALTH=http://127.0.0.1:3010/api/health
SRC_SNAPSHOT=/var/backups/eplenarius-src-previous.tgz
DC=(docker compose -p eplenarius -f "$APP/docker-compose.prod.yml" --env-file "$APP/.env.prod")
BUILD_INPUTS=(Dockerfile .dockerignore package.json package-lock.json tsconfig.json nest-cli.json)

log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }
die() { log "ERRO: $*"; exit 1; }

wait_healthy() {
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' eplenarius_api 2>/dev/null)" = healthy ] \
      && curl -sf "$HEALTH" >/dev/null && return 0
    sleep 4
  done
  return 1
}

rollback() {
  log "health falhou — voltando para a imagem anterior"
  docker logs --tail 40 eplenarius_api 2>&1 | tee -a "$LOG" || true
  # Código-fonte também volta: um build manual futuro não reconstrói a versão quebrada.
  if [ -f "$SRC_SNAPSHOT" ]; then
    local restore; restore=$(mktemp -d)
    tar xzf "$SRC_SNAPSHOT" -C "$restore"
    for f in "${BUILD_INPUTS[@]}"; do install -m 644 "$restore/$f" "$APP/$f"; done
    rsync -a --delete "$restore/src/" "$APP/src/"
    rsync -a --delete "$restore/scripts/" "$APP/scripts/"
    cp "$restore/.release" "$APP/.release" 2>/dev/null || true
    rm -rf "$restore"
  fi
  if docker image inspect eplenarius-backend:previous >/dev/null 2>&1; then
    docker tag eplenarius-backend:previous eplenarius-backend:latest
    "${DC[@]}" up -d api 2>&1 | tee -a "$LOG"
    wait_healthy && log "rollback ok" || log "rollback TAMBÉM falhou — intervenção manual"
  fi
  exit 1
}

main() {
  local cmd="${SSH_ORIGINAL_COMMAND:-}" sync=false sha
  case "$cmd" in
    "deploy "*)      ;;
    "deploy-sync "*) sync=true ;;
    *) echo "comando não permitido" >&2; exit 2 ;;
  esac
  sha="${cmd#* }"
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "sha inválido" >&2; exit 2; }

  exec 9>/var/lock/eplenarius-deploy.lock
  flock -w 60 9 || die "outro deploy em andamento"
  log "deploy $sha (sync schema: $sync)"

  STAGE=$(mktemp -d /tmp/eplenarius-release.XXXXXX)
  trap 'rm -rf "${STAGE:-}"' EXIT
  local stage="$STAGE"
  head -c 52428800 | tar xzf - -C "$stage" --no-same-owner --no-same-permissions || die "pacote inválido"
  for f in "${BUILD_INPUTS[@]}"; do [ -f "$stage/$f" ] || die "pacote sem $f"; done
  [ -d "$stage/src" ] && [ -d "$stage/scripts" ] || die "pacote sem src/ ou scripts/"

  /usr/local/sbin/eplenarius-backup >>"$LOG" 2>&1 || die "backup falhou — deploy abortado"

  install -d -m 700 /var/backups
  (cd "$APP" && tar czf "$SRC_SNAPSHOT" "${BUILD_INPUTS[@]}" src scripts $( [ -f .release ] && echo .release ))
  for f in "${BUILD_INPUTS[@]}"; do install -m 644 "$stage/$f" "$APP/$f"; done
  rsync -a --delete --chmod=D755,F644 "$stage/src/" "$APP/src/"
  rsync -a --delete --chmod=D755,F644 "$stage/scripts/" "$APP/scripts/"
  echo "$sha" > "$APP/.release"

  docker image inspect eplenarius-backend:latest >/dev/null 2>&1 \
    && docker tag eplenarius-backend:latest eplenarius-backend:previous
  "${DC[@]}" build --pull api 2>&1 | tail -5 | tee -a "$LOG"

  if $sync; then
    log "boot com DB_SYNCHRONIZE=true"
    DB_SYNCHRONIZE=true "${DC[@]}" up -d api 2>&1 | tee -a "$LOG"
    wait_healthy || rollback
  fi
  "${DC[@]}" up -d api 2>&1 | tee -a "$LOG"
  wait_healthy || rollback

  echo "$sha" > "$APP/.deployed"
  docker image prune -f --filter "label=com.docker.compose.project=eplenarius" >/dev/null 2>&1 || true
  log "deploy $sha ok"
}

main "$@"
