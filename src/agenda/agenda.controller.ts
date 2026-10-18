import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AgendaService } from './agenda.service';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';
import { maskSecretCounts } from '../common/integrity';

@ApiTags('agenda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agenda')
export class AgendaController {
  constructor(
    private readonly agendaService: AgendaService,
    private readonly access: ChamberAccessService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Adicionar item à pauta' })
  async create(@Body() dto: CreateAgendaItemDto, @CurrentUser() user: any) {
    const session = await this.access.assertSession(user, dto.sessionId);
    // chamberId sempre o da sessão — nunca o enviado pelo cliente.
    return this.agendaService.create({ ...dto, chamberId: session.chamberId });
  }

  @Get('session/:sessionId')
  @Public()
  @ApiOperation({ summary: 'Listar itens da pauta de uma sessão' })
  async findBySession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return (await this.agendaService.findBySession(sessionId)).map(maskSecretCounts);
  }

  @Get('session/:sessionId/active-voting')
  @Public()
  @ApiOperation({ summary: 'Item atualmente em votação' })
  async findActiveVoting(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    const item = await this.agendaService.findActiveVoting(sessionId);
    return item ? maskSecretCounts(item) : null;
  }

  @Get('chamber/:chamberId/voted')
  @ApiOperation({ summary: 'Listar todos os projetos votados (aprovados/rejeitados) da câmara' })
  async findVotedByChamber(@Param('chamberId', ParseUUIDPipe) chamberId: string, @CurrentUser() user: any) {
    this.access.assertChamber(user, chamberId);
    return (await this.agendaService.findVotedByChamber(chamberId)).map(maskSecretCounts);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Buscar item por ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return maskSecretCounts(await this.agendaService.findOne(id));
  }
}
