#!/usr/bin/env bash
# Publica uma atualização OTA do app mobile (GitHub Actions do repo mobile).
#
# Instalado em /usr/local/sbin/eplenarius-ota-install e amarrado à chave do repo mobile:
#   command="/usr/local/sbin/eplenarius-ota-install",restrict ssh-ed25519 AAAA... github-actions-eplenarius-ota
#
# Comando: "ota <runtimeVersion> <updateId>" + tar.gz no stdin (gerado por scripts/ota.mjs).
# Só arquivos estáticos: nada do pacote é executado. O manifesto já vem ASSINADO de fora
# da VPS — o app recusa qualquer manifesto sem a assinatura do certificado embutido no APK.
set -euo pipefail

ROOT=/srv/sites/eplenarius-updates
LOG=/var/log/eplenarius-ota.log
KEEP=5

log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }
die() { log "ERRO: $*"; exit 1; }

main() {
  local verb rt id
  read -r verb rt id _ <<<"${SSH_ORIGINAL_COMMAND:-}"
  [ "$verb" = ota ] || { echo "comando não permitido" >&2; exit 2; }
  [[ "$rt" =~ ^[0-9A-Za-z._-]{1,40}$ ]] || { echo "runtime inválido" >&2; exit 2; }
  [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "id inválido" >&2; exit 2; }

  exec 9>/var/lock/eplenarius-ota.lock
  flock -w 60 9 || die "outra publicação em andamento"

  local dir="$ROOT/$rt/android"
  install -d -m 755 "$dir"
  STAGE=$(mktemp -d "$dir/.stage.XXXXXX")
  trap 'rm -rf "${STAGE:-}"' EXIT

  head -c 104857600 | tar xzf - -C "$STAGE" --no-same-owner --no-same-permissions || die "pacote inválido"
  [ -f "$STAGE/manifest.multipart" ] || die "pacote sem manifest.multipart"
  grep -q "\"id\":\"$id\"" "$STAGE/manifest.multipart" || die "id do manifesto não confere com o comando"
  grep -q "\"runtimeVersion\":\"$rt\"" "$STAGE/manifest.multipart" || die "runtime do manifesto não confere"
  [ -z "$(find "$STAGE" -mindepth 1 ! -type f ! -type d)" ] || die "pacote com links/arquivos especiais"
  chmod -R u=rwX,go=rX "$STAGE"

  rm -rf "${dir:?}/$id"
  mv "$STAGE" "$dir/$id"
  STAGE=
  # Troca atômica da versão servida
  ln -sfn "$id" "$dir/.current.tmp"
  mv -Tf "$dir/.current.tmp" "$dir/current"

  # Mantém as $KEEP mais recentes (a atual nunca é apagada)
  local cur; cur=$(readlink "$dir/current")
  find "$dir" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %f\n' | sort -rn | awk -v k="$KEEP" 'NR>k {print $2}' \
    | while read -r old; do [ "$old" = "$cur" ] || rm -rf "${dir:?}/$old"; done

  log "publicada $id (runtime $rt)"
}

main "$@"
