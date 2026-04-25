import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AgendaService } from './agenda.service';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('agenda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agendaService: AgendaService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Adicionar item à pauta' })
  create(@Body() dto: CreateAgendaItemDto) {
    return this.agendaService.create(dto);
  }

  @Get('session/:sessionId')
  @Public()
  @ApiOperation({ summary: 'Listar itens da pauta de uma sessão' })
  findBySession(@Param('sessionId') sessionId: string) {
    return this.agendaService.findBySession(sessionId);
  }

  @Get('session/:sessionId/active-voting')
  @Public()
  @ApiOperation({ summary: 'Item atualmente em votação' })
  findActiveVoting(@Param('sessionId') sessionId: string) {
    return this.agendaService.findActiveVoting(sessionId);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Buscar item por ID' })
  findOne(@Param('id') id: string) {
    return this.agendaService.findOne(id);
  }

  @Patch(':id/open-voting')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Abrir votação para um item da pauta' })
  openVoting(@Param('id') id: string) {
    return this.agendaService.openVoting(id);
  }

  @Patch(':id/close-voting')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Encerrar votação e registrar resultado' })
  closeVoting(@Param('id') id: string) {
    return this.agendaService.closeVoting(id);
  }
}
