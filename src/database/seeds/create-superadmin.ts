import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'eplenarius',
  username: process.env.DB_USER || 'eplenarius',
  password: process.env.DB_PASSWORD || 'eplenarius_secret',
  entities: [path.resolve(__dirname, '../../**/*.entity{.ts,.js}')],
  synchronize: false,
});

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  await AppDataSource.initialize();

  const email = (await ask('Email do superadmin: ')).trim();
  const name = (await ask('Nome do superadmin: ')).trim();
  const password = (await ask('Senha (mín. 8 chars): ')).trim();

  if (password.length < 8) {
    console.error('Senha deve ter pelo menos 8 caracteres.');
    process.exit(1);
  }

  const existing = await AppDataSource.query(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );

  if (existing.length > 0) {
    console.log(`\nUsuário com email "${email}" já existe.`);
    await AppDataSource.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join('');

  await AppDataSource.query(
    `INSERT INTO users (id, "chamberId", name, email, "passwordHash", role, initials, "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), NULL, $1, $2, $3, 'superadmin', $4, true, NOW(), NOW())`,
    [name, email, passwordHash, initials],
  );

  console.log(`\nSuperadmin criado com sucesso!`);
  console.log(`  Email: ${email}`);
  console.log(`  Role:  superadmin`);
  console.log(`\nAgora você pode fazer login e criar câmaras via POST /api/chambers`);

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
