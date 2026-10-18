import { Controller, Get, Post, Delete, Param, Body, Patch, UseGuards, HttpCode, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';
import { AtaService } from './ata.service';
import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPhaseDto {
  @ApiProperty({ example: 'ordem_do_dia' })
  @IsString() @Matches(/^[a-z0-9_]{2,40}$/)
  phase: string;
}

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly access: ChamberAccessService,
    private readonly ataService: AtaService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Criar sessão' })
  create(@Body() dto: CreateSessionDto, @CurrentUser() user: any) {
    this.access.assertChamber(user, dto.chamberId);
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
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.access.assertSession(user, id);
    return this.sessionsService.start(id, user.id);
  }

  @Patch(':id/end')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Encerrar sessão' })
  async end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.access.assertSession(user, id);
    return this.sessionsService.end(id, user.id);
  }

  @Patch(':id/phase')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Mudar a fase do roteiro da sessão' })
  async setPhase(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetPhaseDto, @CurrentUser() user: any) {
    await this.access.assertSession(user, id);
    return this.sessionsService.setPhase(id, body.phase, user.id);
  }

  @Get(':id/ata')
  @Public()
  @ApiOperation({ summary: 'Ata da sessão montada da auditoria (presenças, roteiro, falas, votações, hashes)' })
  ata(@Param('id', ParseUUIDPipe) id: string) {
    return this.ataService.build(id);
  }

  @Patch(':id/stream')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Atualizar dados da transmissão (YouTube)' })
  async updateStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { youtubeUrl?: string; youtubeThumbnailUrl?: string },
    @CurrentUser() user: any,
  ) {
    await this.access.assertSession(user, id);
    return this.sessionsService.updateStream(id, body);
  }

  @Post(':id/presence')
  @ApiOperation({ summary: 'Confirmar presença na sessão' })
  async confirmPresence(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const session = await this.access.assertSession(user, id);
    if (session.status === 'encerrada') throw new BadRequestException('Sessão já encerrada');
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
