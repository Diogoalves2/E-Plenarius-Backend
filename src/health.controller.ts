import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Healthcheck (API + banco)' })
  async check() {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
