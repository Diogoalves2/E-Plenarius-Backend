import {
  Controller, Post, Get, Delete, Param, Body,
  UseGuards, HttpCode, Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExpedienteService } from './expediente.service';
import { InscreverExpedienteDto } from './dto/inscrever-expediente.dto';
import { AjustarTempoDto } from './dto/ajustar-tempo.dto';
import { CriarConvidadoDto } from './dto/criar-convidado.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('expediente')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expediente/sessions')
export class ExpedienteController {
  constructor(private readonly service: ExpedienteService) {}

  // ─── Inscrições ────────────────────────────────────────────────────────────

  @Post(':sessionId/inscrever')
  @UseGuards(RolesGuard)
  @Roles('vereador')
  @ApiOperation({ summary: 'Vereador se inscreve no expediente' })
  inscrever(
    @Param('sessionId') sessionId: string,
    @Body() dto: InscreverExpedienteDto,
    @CurrentUser() user: any,
  ) {
    return this.service.inscrever(sessionId, user.id, dto);
  }

  @Delete(':sessionId/cancelar/:tipo')
  @UseGuards(RolesGuard)
  @Roles('vereador')
  @ApiOperation({ summary: 'Vereador cancela inscrição' })
  cancelar(
    @Param('sessionId') sessionId: string,
    @Param('tipo') tipo: 'grande' | 'pequeno',
    @CurrentUser() user: any,
  ) {
    return this.service.cancelarInscricao(sessionId, user.id, tipo);
  }

  @Get(':sessionId/inscritos')
  @ApiOperation({ summary: 'Listar inscritos no expediente' })
  listarInscritos(@Param('sessionId') sessionId: string) {
    return this.service.listarInscritos(sessionId);
  }

  @Get(':sessionId/ativo')
  @Public()
  @ApiOperation({ summary: 'Expediente ativo com tempo restante' })
  getAtivo(@Param('sessionId') sessionId: string) {
    return this.service.getAtivo(sessionId);
  }

  // ─── Convidados ───────────────────────────────────────────────────────────

  @Post(':sessionId/convidado')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Presidente adiciona convidado ao expediente' })
  inscreverConvidado(
    @Param('sessionId') sessionId: string,
    @Body() dto: CriarConvidadoDto,
  ) {
    return this.service.inscreverConvidado(sessionId, dto);
  }

  @Delete(':sessionId/convidado/:inscricaoId')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presidente remove convidado da lista' })
  removerConvidado(
    @Param('sessionId') sessionId: string,
    @Param('inscricaoId') inscricaoId: string,
  ) {
    return this.service.removerConvidado(sessionId, inscricaoId);
  }

  // ─── Controles do presidente ───────────────────────────────────────────────

  @Post(':sessionId/liberar/:inscricaoId')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Presidente libera tempo do vereador' })
  liberarTempo(
    @Param('sessionId') sessionId: string,
    @Param('inscricaoId') inscricaoId: string,
  ) {
    return this.service.liberarTempo(sessionId, inscricaoId);
  }

  @Post(':sessionId/ajustar')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presidente ajusta tempo (+1 ou -1 minuto)' })
  ajustar(@Param('sessionId') sessionId: string, @Body() dto: AjustarTempoDto) {
    return this.service.ajustarTempo(sessionId, dto.delta);
  }

  @Post(':sessionId/encerrar')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presidente encerra expediente ativo' })
  encerrar(@Param('sessionId') sessionId: string) {
    return this.service.encerrar(sessionId);
  }

  // ─── Apartes ───────────────────────────────────────────────────────────────

  @Post(':sessionId/aparte/solicitar')
  @UseGuards(RolesGuard)
  @Roles('vereador', 'secretaria')
  @HttpCode(200)
  @ApiOperation({ summary: 'Vereador solicita aparte' })
  solicitarAparte(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: any,
  ) {
    const vereador = {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      party: user.party ?? null,
      initials: user.initials ?? null,
      title: user.title ?? null,
    };
    return this.service.solicitarAparte(sessionId, user.id, vereador);
  }

  @Delete(':sessionId/aparte/cancelar')
  @UseGuards(RolesGuard)
  @Roles('vereador', 'secretaria')
  @ApiOperation({ summary: 'Vereador cancela solicitação de aparte' })
  cancelarAparte(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.cancelarAparte(sessionId, user.id);
  }

  @Post(':sessionId/aparte/aceitar/:userId')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presidente aceita aparte de um vereador' })
  aceitarAparte(
    @Param('sessionId') sessionId: string,
    @Param('userId') userId: string,
  ) {
    return this.service.aceitarAparte(sessionId, userId);
  }

  @Post(':sessionId/aparte/encerrar')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presidente encerra aparte ativo' })
  encerrarAparte(@Param('sessionId') sessionId: string) {
    return this.service.encerrarApartePorPresidente(sessionId);
  }
}
