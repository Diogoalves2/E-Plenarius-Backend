import { Controller, Post, Patch, Get, Body, Param, UseGuards, Req, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VotingService } from './voting.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';

@ApiTags('voting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voting')
export class VotingController {
  constructor(
    private readonly votingService: VotingService,
    private readonly access: ChamberAccessService,
  ) {}

  @Patch('open/:agendaItemId')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'vice_presidente')
  @ApiOperation({ summary: 'Abrir votação (presidente)' })
  async openVoting(@Param('agendaItemId', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.access.assertAgendaItem(user, id);
    return this.votingService.openVoting(id, user);
  }

  @Patch('close/:agendaItemId')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'vice_presidente')
  @ApiOperation({ summary: 'Encerrar votação (presidente)' })
  async closeVoting(@Param('agendaItemId', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.access.assertAgendaItem(user, id);
    return this.votingService.closeVoting(id, user);
  }

  @Post('cast')
  @ApiOperation({ summary: 'Registrar voto (vereador/presidente presente na sessão)' })
  castVote(@Body() dto: CastVoteDto, @CurrentUser() user: any, @Req() req: any) {
    // req.ip = IP real (trust proxy em main.ts); X-Forwarded-For cru é falsificável.
    return this.votingService.castVote(dto, user, req.ip);
  }

  @Get('item/:agendaItemId/votes')
  @ApiOperation({ summary: 'Listar votos de um item (escolha oculta em votação secreta)' })
  getVotes(@Param('agendaItemId', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.votingService.getVotesForViewer(id, user);
  }

  @Get('item/:agendaItemId/verify')
  @ApiOperation({ summary: 'Verificar integridade: cadeia de votos, placar e hash do resultado' })
  async verify(@Param('agendaItemId', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.access.assertAgendaItem(user, id);
    return this.votingService.verifyItem(id);
  }

  @Get('item/:agendaItemId/has-voted')
  @ApiOperation({ summary: 'Verificar se o usuário já votou' })
  hasVoted(@Param('agendaItemId', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.votingService.hasVoted(id, user.id);
  }
}
