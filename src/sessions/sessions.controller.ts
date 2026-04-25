import { Controller, Get, Post, Delete, Param, Body, Patch, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Criar sessão' })
  create(@Body() dto: CreateSessionDto, @CurrentUser() user: any) {
    return this.sessionsService.create(dto, user.id);
  }

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Listar sessões da câmara' })
  findByChamber(@Param('chamberId') chamberId: string) {
    return this.sessionsService.findByChamber(chamberId);
  }

  @Get('active/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Sessão em andamento' })
  findActive(@Param('chamberId') chamberId: string) {
    return this.sessionsService.findActive(chamberId);
  }

  @Get('current/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Sessão atual (em andamento ou agendada mais próxima)' })
  findCurrent(@Param('chamberId') chamberId: string) {
    return this.sessionsService.findCurrent(chamberId);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Buscar sessão por ID' })
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Patch(':id/start')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Iniciar sessão' })
  start(@Param('id') id: string) {
    return this.sessionsService.start(id);
  }

  @Patch(':id/end')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Encerrar sessão' })
  end(@Param('id') id: string) {
    return this.sessionsService.end(id);
  }

  @Patch(':id/stream')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Atualizar dados da transmissão (YouTube)' })
  updateStream(
    @Param('id') id: string,
    @Body() body: { youtubeUrl?: string; youtubeThumbnailUrl?: string },
  ) {
    return this.sessionsService.updateStream(id, body);
  }

  @Post(':id/presence')
  @ApiOperation({ summary: 'Confirmar presença na sessão' })
  confirmPresence(@Param('id') id: string, @CurrentUser() user: any) {
    return this.sessionsService.confirmPresence(id, user.id);
  }

  @Get(':id/presences')
  @Public()
  @ApiOperation({ summary: 'Listar presenças da sessão' })
  getPresences(@Param('id') id: string) {
    return this.sessionsService.getPresences(id);
  }

  @Delete('leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sair da sessão ativa (remove presença e notifica quórum)' })
  leaveActiveSession(@CurrentUser() user: any) {
    return this.sessionsService.leaveActiveSession(user.id, user.chamberId ?? undefined);
  }
}
