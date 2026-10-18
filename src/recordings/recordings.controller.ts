import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { RecordingsService } from './recordings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';

export class CreateRecordingDto {
  @IsString() @MaxLength(200) fileName: string;
  @IsInt() @Min(1) sizeBytes: number;
  @IsOptional() @IsISO8601() recordedStartAt?: string;
}

export class EditSegmentDto {
  @IsOptional() @IsString() @MaxLength(5000) text?: string;
  @IsOptional() @IsString() @MaxLength(120) speaker?: string | null;
  @IsOptional() @IsBoolean() reviewed?: boolean;
}

@ApiTags('degravacao')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RecordingsController {
  constructor(
    private readonly service: RecordingsService,
    private readonly access: ChamberAccessService,
    private readonly dataSource: DataSource,
  ) {}

  /** Envia/revisa/aprova: presidente, vice, servidor administrativo e 1º/2º secretários da Mesa. */
  private async assertCanManage(user: any) {
    if (['superadmin', 'presidente', 'vice_presidente', 'secretaria'].includes(user.role)) return;
    const [u] = await this.dataSource.query(`SELECT title FROM users WHERE id = $1`, [user.id]);
    if (/^[12]\s*[º°o.]?\s*secret/i.test((u?.title ?? '').trim())) return;
    throw new ForbiddenException('Somente a Mesa Diretora ou a secretaria administrativa gerencia a degravação.');
  }

  private async load(id: string, user: any) {
    const rec = await this.service.findOne(id);
    this.access.assertChamber(user, rec.chamberId);
    return rec;
  }

  @Post('sessions/:sessionId/recordings')
  @ApiOperation({ summary: 'Iniciar envio da gravação da sessão (em partes de 20 MB)' })
  async create(@Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: CreateRecordingDto, @CurrentUser() user: any) {
    const session = await this.access.assertSession(user, sessionId);
    await this.assertCanManage(user);
    return this.service.create(session, user.id, dto);
  }

  @Get('sessions/:sessionId/recordings')
  @ApiOperation({ summary: 'Gravações/degravações da sessão' })
  async list(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentUser() user: any) {
    await this.access.assertSession(user, sessionId);
    return this.service.listBySession(sessionId);
  }

  @Put('recordings/:id/parts/:n')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enviar uma parte (application/octet-stream)' })
  async part(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('n', ParseIntPipe) n: number,
    @Req() req: any,
    @CurrentUser() user: any,
  ) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.putPart(rec, n, req.body);
  }

  @Post('recordings/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Concluir envio e iniciar a transcrição' })
  async complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.complete(rec);
  }

  @Get('recordings/:id')
  @ApiOperation({ summary: 'Gravação + trechos da degravação' })
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.load(id, user);
    return this.service.detail(id);
  }

  @Patch('recordings/:id/segments/:segId')
  @ApiOperation({ summary: 'Corrigir texto/orador de um trecho' })
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('segId', ParseUUIDPipe) segId: string,
    @Body() dto: EditSegmentDto,
    @CurrentUser() user: any,
  ) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.editSegment(rec, segId, dto);
  }

  @Post('recordings/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar degravação (gera hash e registra na auditoria)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.approve(rec, user.id);
  }

  @Post('recordings/:id/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reabrir degravação aprovada para correção' })
  async reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.reopen(rec, user.id);
  }

  @Post('recordings/:id/reprocess')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transcrever novamente' })
  async reprocess(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    return this.service.reprocess(rec);
  }

  @Delete('recordings/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Excluir gravação (não aprovada)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const rec = await this.load(id, user);
    await this.assertCanManage(user);
    await this.service.remove(rec);
    return { ok: true };
  }
}
