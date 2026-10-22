import { Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransparencyService } from './transparency.service';

/** Portal de transparência: tudo público, com cache curto. */
@ApiTags('transparencia')
@Controller('public')
export class TransparencyController {
  constructor(private readonly service: TransparencyService) {}

  @Get('ancoras')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Âncora pública: último elo da cadeia de auditoria de cada câmara' })
  ancoras() {
    return this.service.ancoras();
  }

  @Get('chambers/:chamberId/ancora/:seq')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Hash do registro de auditoria na posição seq (confere uma âncora guardada)' })
  ancora(@Param('chamberId', ParseUUIDPipe) chamberId: string, @Param('seq', ParseIntPipe) seq: number) {
    return this.service.ancora(chamberId, seq);
  }

  @Get('chambers/:chamberId')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Resumo da câmara: membros com taxa de presença, totais de votações' })
  summary(@Param('chamberId', ParseUUIDPipe) id: string) {
    return this.service.summary(id);
  }

  @Get('chambers/:chamberId/votacoes')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Votações encerradas' })
  votacoes(
    @Param('chamberId', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.votacoes(id, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('chambers/:chamberId/estatisticas')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Painel de votações: totais, por mês, por tipo e comportamento de cada membro' })
  estatisticas(@Param('chamberId', ParseUUIDPipe) id: string) {
    return this.service.estatisticas(id);
  }

  @Get('chambers/:chamberId/vereadores/:userId')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Perfil público do vereador: presença, votos nominais, autorias' })
  vereador(
    @Param('chamberId', ParseUUIDPipe) chamberId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.service.vereador(chamberId, userId);
  }

  @Get('votacoes/:itemId')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Detalhe da votação + verificação pública de integridade' })
  votacao(@Param('itemId', ParseUUIDPipe) id: string) {
    return this.service.votacao(id);
  }

  @Get('chambers/:chamberId/dados/:file')
  @ApiOperation({ summary: 'Dados abertos (CSV): votacoes.csv, votos-nominais.csv, presencas.csv' })
  async dados(
    @Param('chamberId', ParseUUIDPipe) id: string,
    @Param('file') file: string,
    @Res() res: any,
  ) {
    const gen: Record<string, () => Promise<string>> = {
      'votacoes.csv': () => this.service.csvVotacoes(id),
      'votos-nominais.csv': () => this.service.csvVotosNominais(id),
      'presencas.csv': () => this.service.csvPresencas(id),
    };
    if (!gen[file]) return res.status(404).json({ statusCode: 404, message: 'Arquivo não encontrado' });
    const body = await gen[file]();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(body);
  }
}
