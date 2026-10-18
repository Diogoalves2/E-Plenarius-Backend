import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly access: ChamberAccessService,
  ) {}

  @Get('chamber/:chamberId')
  @ApiOperation({ summary: 'Logs de auditoria da câmara' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findByChamber(
    @Param('chamberId', ParseUUIDPipe) chamberId: string,
    @CurrentUser() user: any,
    @Query('limit') limit?: number,
  ) {
    this.access.assertChamber(user, chamberId);
    return this.auditService.findByChamber(chamberId, limit ? +limit : 100);
  }

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Logs de auditoria de uma sessão' })
  async findBySession(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentUser() user: any) {
    await this.access.assertSession(user, sessionId);
    return this.auditService.findBySession(sessionId);
  }

  @Get('chamber/:chamberId/verify')
  @ApiOperation({ summary: 'Verificar integridade da cadeia de hash' })
  verifyChain(@Param('chamberId', ParseUUIDPipe) chamberId: string, @CurrentUser() user: any) {
    this.access.assertChamber(user, chamberId);
    return this.auditService.verifyChain(chamberId);
  }
}
