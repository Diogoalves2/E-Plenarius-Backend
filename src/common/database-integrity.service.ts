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

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
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
