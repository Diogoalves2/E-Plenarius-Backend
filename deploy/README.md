# Deploy — VPS

| | |
|---|---|
| Host | `ssh emas` (2.25.152.184, root) — mesma VPS do portal da prefeitura e do Brasil em Pauta |
| Pasta | `/srv/sites/eplenarius` |
| URL | https://eplenarius.2-25-152-184.sslip.io/api (health: `/api/health`) |
| Containers | `eplenarius_api` (127.0.0.1:3010) + `eplenarius_db` (sem porta exposta) |
| Nginx | `/etc/nginx/sites-available/eplenarius` (Certbot) |
| Segredos | `/srv/sites/eplenarius/.env.prod` (gerado na VPS, chmod 600) |
| Superadmin | `/root/sites/eplenarius-admin.txt` |
| Backup | cron 03:15 `/usr/local/sbin/eplenarius-backup` → `/srv/sites/eplenarius/backups` (14 dias) |
| Frontend | Vercel `e-plenarius-frontend`, env `NEXT_PUBLIC_API_URL` |

## Atualizar o backend (automático)

Push no `master` → GitHub Actions ([.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml)):

1. **test** — `npm ci`, typecheck, build, sobe a API com Postgres descartável e roda
   `test/e2e.mjs` (isolamento, tablets, voto secreto, imutabilidade, tokens, socket).
2. **deploy** (só se o teste passar) — envia por SSH apenas o código da API para
   `/usr/local/sbin/eplenarius-deploy`, que: faz backup → guarda imagem e código atuais →
   build → sobe → espera `/api/health`. Falhou? volta imagem **e** código anteriores sozinho.

Coluna/tabela nova em entidade: rodar o workflow manualmente (Actions → Backend CI/CD →
Run workflow) com **Sincronizar schema** marcado. Se esquecer, o boot detecta a coluna faltando,
`/api/health` responde 503 `schema_outdated` e o deploy volta a versão anterior sozinho.
Para não derrubar a API nesse meio-tempo: commit com `[skip ci]` e depois o Run workflow com sincronização.

| Peça | Onde | Quem altera |
|---|---|---|
| Código da API (`src`, `scripts`, `package*.json`, `Dockerfile`) | repo | push no `master` |
| `docker-compose.prod.yml`, `.env.prod`, nginx | `/srv/sites/eplenarius`, `/etc/nginx` | admin via SSH |
| `eplenarius-deploy`, `eplenarius-backup`, `eplenarius-watchdog` | `/usr/local/sbin` (cópias em `deploy/`) | admin via SSH |
| Chave do GitHub | `authorized_keys` com `command=...,restrict` | só roda o script de deploy |

Segredos do repo: `VPS_SSH_KEY`, `VPS_HOST`, `VPS_KNOWN_HOSTS`. Log: `/var/log/eplenarius-deploy.log`.

Alterou `deploy/eplenarius-deploy.sh` ou `deploy/backup.sh` no repo? Instale manualmente:

```bash
scp deploy/eplenarius-deploy.sh emas:/tmp/d && ssh emas 'install -m 755 /tmp/d /usr/local/sbin/eplenarius-deploy'
scp deploy/backup.sh emas:/tmp/b && ssh emas 'install -m 700 /tmp/b /usr/local/sbin/eplenarius-backup'
```

## Restaurar dump

```bash
cat dump.dump | ssh emas 'docker exec -i eplenarius_db pg_restore -U eplenarius -d eplenarius --clean --if-exists --no-owner'
```

## Logs

```bash
ssh emas 'docker logs -f --tail 100 eplenarius_api'
```

## Segurança em produção

- `votes` e `audit_logs` são somente-inserção (triggers criados no boot). Não dá para apagar dados de teste — **nunca teste em produção**.
- Verificar integridade: `GET /api/voting/item/:id/verify` e `GET /api/audit/chamber/:id/verify` (botão em Auditoria).
- Tablets: o app só entra em tablet autorizado em **Tablets** no painel do presidente.
- Nginx: rate limit `eplen_api` (30 r/s) e `eplen_auth` (30 r/min) por IP.
- Containers: API com FS só leitura, sem capabilities, 768 MB; banco com 768 MB.

## Stack de teste descartável

Sempre com **`-p eplenarius-test` explícito** — sem isso o compose usa o `name:` do arquivo e recria
os containers de produção (já aconteceu: arquivo com CRLF fez o `sed` do nome falhar).

```bash
sed -e 's/^name: eplenarius$/name: eplenarius-test/' -e 's/eplenarius_db/eplenarius_test_db/' \
    -e 's/eplenarius_api/eplenarius_test_api/' -e 's/backend:latest/backend:test/' \
    -e "s/API_HOST_PORT:-3010/API_HOST_PORT:-3011/" docker-compose.prod.yml > docker-compose.test.yml
docker compose -p eplenarius-test -f docker-compose.test.yml --env-file .env.test up -d --build
# ... testes em http://127.0.0.1:3011 ...
docker compose -p eplenarius-test -f docker-compose.test.yml --env-file .env.test down -v
```

## Monitoramento

- **Watchdog** (`/usr/local/sbin/eplenarius-watchdog`, cron a cada 2 min): 3 falhas seguidas no health →
  `docker restart eplenarius_api`. Não reinicia em `schema_outdated`. Alerta de disco ≥ 90%.
  Log: `/var/log/eplenarius-watchdog.log` (só eventos).
- **Uptime externo** ([.github/workflows/uptime.yml](../.github/workflows/uptime.yml), a cada 15 min): API + frontend.
  Falha → e-mail do GitHub. Repositório público sem commits por 60 dias desativa o agendamento.

## Atualizações OTA do app mobile

- **Servidas** pelo Nginx em `/updates/` a partir de `/srv/sites/eplenarius-updates/<runtime>/android/` (`current` → versão ativa; mantém 5).
  `GET /updates/manifest` (headers `expo-runtime-version`, `expo-platform`) devolve o manifesto **pré-assinado**; sem atualização → 204.
- **Publicadas** pelo workflow `App OTA` do repo mobile (push no `master` com mudança em `app/`, `src/`, `assets/`…):
  `scripts/ota.mjs build` exporta o JS, assina com `OTA_PRIVATE_KEY` (segredo do GitHub) e envia por SSH para
  `/usr/local/sbin/eplenarius-ota-install` (forced command; chave só publica OTA, não faz deploy do backend).
- **A VPS não tem a chave de assinatura**: o app só aplica manifesto assinado pelo `certs/certificate.pem` embutido no APK.
- **Mudança nativa** (dependência `expo-*`/`react-native*`, `app.json`, certificado) é bloqueada no build da OTA:
  suba `runtimeVersion` no `app.json`, gere APK (`scripts/build-apk.sh`, que regrava `ota-native-lock.json`) e instale nos tablets.
- Cópia da chave privada de assinatura: `C:\Users\Diogo Alves\.eplenarius-ota\private-key.pem` (guardar também em cofre de senhas).
- Log: `/var/log/eplenarius-ota.log`.
