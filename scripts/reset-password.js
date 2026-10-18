#!/usr/bin/env node
// Usage: node scripts/reset-password.js <email> <novaSenha>

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const [,, email, password] = process.argv;

if (!email || !password) {
  console.error('Uso: node scripts/reset-password.js <email> <novaSenha>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Erro: senha deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

// DATABASE_URL ou DB_* (container usa DB_HOST=db). SSL só com DB_SSL=true.
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
  const existing = await pool.query('SELECT id, name, role FROM users WHERE email = $1', [email]);
  if (existing.rows.length === 0) {
    console.error(`Usuário "${email}" não encontrado.`);
    process.exit(1);
  }

  const user = existing.rows[0];
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    'UPDATE users SET "passwordHash" = $1, "updatedAt" = NOW() WHERE email = $2',
    [passwordHash, email],
  );

  console.log('\nSenha atualizada com sucesso!');
  console.log(`  Email: ${email}`);
  console.log(`  Nome:  ${user.name}`);
  console.log(`  Role:  ${user.role}`);
}

main()
  .catch(err => { console.error('Erro:', err.message); process.exit(1); })
  .finally(() => pool.end());
