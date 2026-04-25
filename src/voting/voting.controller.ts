import { Controller, Post, Patch, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VotingService } from './voting.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('voting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voting')
export class VotingController {
  constructor(private readonly votingService: VotingService) {}

  @Patch('open/:agendaItemId')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Abrir votação (presidente)' })
  openVoting(@Param('agendaItemId') id: string, @CurrentUser() user: any) {
    return this.votingService.openVoting(id, user);
  }

  @Patch('close/:agendaItemId')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  @ApiOperation({ summary: 'Encerrar votação (presidente)' })
  closeVoting(@Param('agendaItemId') id: string, @CurrentUser() user: any) {
    return this.votingService.closeVoting(id, user);
  }

  @Post('cast')
  @ApiOperation({ summary: 'Registrar voto (vereador)' })
  castVote(@Body() dto: CastVoteDto, @CurrentUser() user: any, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    return this.votingService.castVote(dto, user, ip);
  }

  @Get('item/:agendaItemId/votes')
  @ApiOperation({ summary: 'Listar votos de um item (somente votação aberta)' })
  getVotes(@Param('agendaItemId') id: string) {
    return this.votingService.getVotesByItem(id);
  }

  @Get('item/:agendaItemId/has-voted')
  @ApiOperation({ summary: 'Verificar se o usuário já votou' })
  hasVoted(@Param('agendaItemId') id: string, @CurrentUser() user: any) {
    return this.votingService.hasVoted(id, user.id);
  }
}
