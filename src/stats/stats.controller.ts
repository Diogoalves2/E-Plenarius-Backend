import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Estatísticas agregadas da câmara' })
  getForChamber(@Param('chamberId') chamberId: string) {
    return this.statsService.getForChamber(chamberId);
  }
}
