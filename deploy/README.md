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
Run workflow) com **Sincronizar schema** marcado.

| Peça | Onde | Quem altera |
|---|---|---|
| Código da API (`src`, `scripts`, `package*.json`, `Dockerfile`) | repo | push no `master` |
| `docker-compose.prod.yml`, `.env.prod`, nginx | `/srv/sites/eplenarius`, `/etc/nginx` | admin via SSH |
| `eplenarius-deploy`, `eplenarius-backup` | `/usr/local/sbin` (cópias em `deploy/`) | admin via SSH |
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
