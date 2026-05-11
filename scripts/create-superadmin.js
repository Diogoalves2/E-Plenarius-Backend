#!/usr/bin/env node
// Usage: node scripts/create-superadmin.js <email> "<name>" <password>

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const [,, email, name, password] = process.argv;

if (!email || !name || !password) {
  console.error('Uso: node scripts/create-superadmin.js <email> "<nome>" <senha>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Erro: senha deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function main() {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`Usuário "${email}" já existe.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const initials = name.split(' ').filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('');

  await pool.query(
    `INSERT INTO users (id, "chamberId", name, email, "passwordHash", role, initials, "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), NULL, $1, $2, $3, 'superadmin', $4, true, NOW(), NOW())`,
    [name, email, passwordHash, initials],
  );

  console.log('\nSuperadmin criado com sucesso!');
  console.log(`  Email: ${email}`);
  console.log(`  Nome:  ${name}`);
  console.log(`  Role:  superadmin`);
}

main()
  .catch(err => { console.error('Erro:', err.message); process.exit(1); })
  .finally(() => pool.end());
