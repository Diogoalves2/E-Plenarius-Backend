import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { DatabaseIntegrityService } from './common/database-integrity.service';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly integrity: DatabaseIntegrityService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Healthcheck (API + banco + esquema)' })
  async check() {
    await this.dataSource.query('SELECT 1');
    // Esquema desatualizado = API quebrada em produção: 503 faz o deploy voltar a versão anterior.
    if (this.integrity.pendingSchema.length) {
      throw new ServiceUnavailableException({
        status: 'schema_outdated',
        message: 'Banco sem as colunas/tabelas desta versão — publicar com sincronização de schema.',
        pending: this.integrity.pendingSchema.length,
      });
    }
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
