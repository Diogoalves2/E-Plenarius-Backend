import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

const IMMUTABLE_TABLES = ['votes', 'audit_logs', 'integrity_checkpoints'];

/**
 * Votos e auditoria são somente-inserção no próprio Postgres: UPDATE, DELETE e TRUNCATE
 * disparam erro, inclusive vindos da aplicação. Quem quiser adulterar precisa desligar o
 * trigger como dono da tabela — e mesmo assim a cadeia de hash (votes.chainHash,
 * audit_logs.hash, agenda_items.resultHash) e o selo HMAC denunciam a alteração.
 *
 * Em produção a API roda com um papel que NÃO é dono das tabelas (DB_APP_USER): mesmo com
 * a API comprometida, não há como desligar triggers nem fazer UPDATE/DELETE nessas tabelas.
 * O dono (DB_USER) só conecta no boot de sincronização de schema, que também ajusta as permissões.
 */
@Injectable()
export class DatabaseIntegrityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseIntegrityService.name);

  /** Alterações de estrutura pendentes (tabela/coluna faltando) detectadas no boot. */
  pendingSchema: string[] = [];

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    // Com synchronize desligado (produção), confere se o banco tem tudo o que as entidades usam.
    // Só conta CREATE TABLE / ADD COLUMN: diferenças cosméticas (defaults, comentários) não bloqueiam.
    if (!this.dataSource.options.synchronize) {
      const log = await this.dataSource.driver.createSchemaBuilder().log();
      this.pendingSchema = log.upQueries
        .map(q => q.query)
        .filter(q => /^CREATE TABLE|ADD (COLUMN )?"/i.test(q.trim()) || /ALTER TABLE .* ADD "/i.test(q));
      if (this.pendingSchema.length) {
        this.logger.error(`Esquema do banco desatualizado (${this.pendingSchema.length} alteração(ões)). `
          + 'Rode o deploy com sincronização de schema.');
        this.pendingSchema.forEach(q => this.logger.error(`  pendente: ${q.slice(0, 160)}`));
      }
    }

    const [{ owner }] = await this.dataSource.query(
      `SELECT COALESCE((SELECT pg_has_role(current_user, tableowner, 'USAGE') FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'votes'), false) AS owner`,
    );
    if (owner) {
      await this.installTriggers();
      await this.grantAppRole();
    } else {
      await this.checkTriggers();
    }
  }

  private async installTriggers() {
    await this.dataSource.query(`
      CREATE OR REPLACE FUNCTION eplenarius_block_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Tabela % é somente-inserção (registro imutável)', TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END $$;
    `);
    for (const table of IMMUTABLE_TABLES) {
      await this.dataSource.query(`
        CREATE OR REPLACE TRIGGER ${table}_immutable
          BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION eplenarius_block_mutation();
      `);
      await this.dataSource.query(`
        CREATE OR REPLACE TRIGGER ${table}_no_truncate
          BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION eplenarius_block_mutation();
      `);
    }
    this.logger.log(`Tabelas imutáveis: ${IMMUTABLE_TABLES.join(', ')}`);
  }

  /** Papel da API sem dono: cria/atualiza e aplica o mínimo de permissões (roda como dono). */
  private async grantAppRole() {
    const user = process.env.DB_APP_USER;
    const password = process.env.DB_APP_PASSWORD;
    if (!user || !password) return;
    if (!/^[a-z_][a-z0-9_]{2,40}$/.test(user)) {
      this.logger.error('DB_APP_USER inválido (use letras minúsculas, números e _).');
      return;
    }
    const q = (sql: string, params?: any[]) => this.dataSource.query(sql, params);
    const [{ exists }] = await q(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`, [user]);
    const [{ sql }] = await q(
      `SELECT format('${exists ? 'ALTER' : 'CREATE'} ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS sql`,
      [user, password],
    );
    try {
      await q(sql);
    } catch {
      // A mensagem do driver traz o SQL (com a senha): não propaga.
      this.logger.error(`Falha ao criar/atualizar o papel "${user}".`);
      return;
    }
    const [{ grantDb }] = await q(`SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS "grantDb"`, [user]);
    await q(grantDb);
    await q(`GRANT USAGE ON SCHEMA public TO "${user}"`);
    await q(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${user}"`);
    await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${user}"`);
    await q(`REVOKE UPDATE, DELETE ON ${IMMUTABLE_TABLES.join(', ')} FROM "${user}"`);
    await q(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${user}"`);
    this.logger.log(`Papel da API "${user}": sem dono das tabelas, sem UPDATE/DELETE em ${IMMUTABLE_TABLES.join(', ')}`);
  }

  /** Sem ser dono não dá para (re)criar triggers: só confere se estão lá. */
  private async checkTriggers() {
    const expected = IMMUTABLE_TABLES.flatMap(t => [`${t}_immutable`, `${t}_no_truncate`]);
    const rows: { tgname: string }[] = await this.dataSource.query(
      `SELECT tgname FROM pg_trigger WHERE tgname = ANY($1) AND tgenabled <> 'D'`, [expected],
    );
    const missing = expected.filter(n => !rows.some(r => r.tgname === n));
    if (missing.length) this.logger.error(`Triggers de imutabilidade ausentes/desligados: ${missing.join(', ')}`);
    else this.logger.log(`Tabelas imutáveis (verificado, API sem dono): ${IMMUTABLE_TABLES.join(', ')}`);
  }
}
