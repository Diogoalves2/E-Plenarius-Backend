import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

const IMMUTABLE_TABLES = ['votes', 'audit_logs'];

/**
 * Votos e auditoria são somente-inserção no próprio Postgres: UPDATE, DELETE e TRUNCATE
 * disparam erro, inclusive vindos da aplicação. Quem quiser adulterar precisa desligar o
 * trigger como superusuário — e mesmo assim a cadeia de hash (votes.chainHash,
 * audit_logs.hash, agenda_items.resultHash) denuncia a alteração.
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
}
