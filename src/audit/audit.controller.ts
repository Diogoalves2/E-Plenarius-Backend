import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('chamber/:chamberId')
  @ApiOperation({ summary: 'Logs de auditoria da câmara' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findByChamber(@Param('chamberId') chamberId: string, @Query('limit') limit?: number) {
    return this.auditService.findByChamber(chamberId, limit ? +limit : 100);
  }

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Logs de auditoria de uma sessão' })
  findBySession(@Param('sessionId') sessionId: string) {
    return this.auditService.findBySession(sessionId);
  }

  @Get('chamber/:chamberId/verify')
  @ApiOperation({ summary: 'Verificar integridade da cadeia de hash' })
  verifyChain(@Param('chamberId') chamberId: string) {
    return this.auditService.verifyChain(chamberId);
  }
}
