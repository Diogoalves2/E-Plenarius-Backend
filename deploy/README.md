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
| Backup | cron 03:15 → `/srv/sites/eplenarius/backups` (14 dias) |
| Frontend | Vercel `e-plenarius-frontend`, env `NEXT_PUBLIC_API_URL` |

## Atualizar o backend

```bash
# da pasta backend/, no Windows (Git Bash)
tar czf - --exclude=node_modules --exclude=dist --exclude=uploads --exclude=.git \
  --exclude='.env' --exclude='.env.*' --exclude=backups --exclude=docker-compose.yml . \
  | ssh emas 'tar xzf - -C /srv/sites/eplenarius'
ssh emas 'cd /srv/sites/eplenarius && docker compose -p eplenarius -f docker-compose.prod.yml --env-file .env.prod up -d --build api'
```

Mudou entidade (coluna nova)? Rodar uma vez com `DB_SYNCHRONIZE=true` no `.env.prod`, subir, e voltar para `false`
(faça backup antes: `./deploy/backup.sh`).

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
