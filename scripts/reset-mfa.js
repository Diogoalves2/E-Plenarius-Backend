#!/usr/bin/env node
// Emergência: superadmin perdeu o celular E os códigos de recuperação.
// Apaga a verificação em duas etapas do usuário e encerra as sessões web dele;
// no próximo login ele cadastra um novo app autenticador.
// Na VPS: docker exec eplenarius_api node scripts/reset-mfa.js <email>

const { Pool } = require('pg');

const [,, email] = process.argv;
if (!email) {
  console.error('Uso: node scripts/reset-mfa.js <email>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function main() {
  const { rows } = await pool.query(
    `UPDATE users SET "mfaSecret" = NULL, "mfaPendingSecret" = NULL, "mfaEnabledAt" = NULL,
            "mfaLastStep" = NULL, "mfaRecoveryCodes" = NULL
      WHERE LOWER(email) = LOWER($1) RETURNING id, role`,
    [email],
  );
  if (!rows.length) {
    console.error(`Usuário "${email}" não encontrado.`);
    process.exitCode = 1;
    return;
  }
  await pool.query(
    `UPDATE refresh_tokens SET revoked = true WHERE "userId" = $1 AND "mobileDevice" IS NULL AND revoked = false`,
    [rows[0].id],
  );
  console.log(`2FA redefinida para ${email} (${rows[0].role}). Cadastre o app no próximo login.`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
