import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VotingService } from '../voting/voting.service';
import { MAJORITY_LABEL, Majority } from '../common/legislative';

const CLOSED = `('aprovado', 'rejeitado')`;

/**
 * Portal de transparência (LAI): somente dados públicos por natureza — votações encerradas,
 * votos nominais de votação ABERTA, presença em sessões encerradas. Votação secreta expõe só o placar.
 */
@Injectable()
export class TransparencyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly voting: VotingService,
  ) {}

  private q(sql: string, params: any[] = []) {
    return this.dataSource.query(sql, params);
  }

  private async chamber(chamberId: string) {
    const [c] = await this.q(
      `SELECT id, name, city, state, "logoUrl", slug FROM chambers WHERE id = $1 AND "isActive" = true`,
      [chamberId],
    );
    if (!c) throw new NotFoundException('Câmara não encontrada');
    return c;
  }

  /** Presença de cada membro nas sessões encerradas. */
  private presenceStats(chamberId: string, userId?: string) {
    return this.q(
      `WITH s AS (SELECT id FROM sessions WHERE "chamberId" = $1 AND status = 'encerrada')
       SELECT u.id, u.name, u.party, u.role, u.title, u."avatarUrl", u.initials,
              (SELECT COUNT(*)::int FROM s) AS sessoes,
              (SELECT COUNT(*)::int FROM session_presences p WHERE p."userId" = u.id AND p."sessionId" IN (SELECT id FROM s)) AS presencas
         FROM users u
        WHERE u."chamberId" = $1 AND u.role IN ('vereador', 'presidente', 'vice_presidente') AND u."isActive" = true
          ${userId ? 'AND u.id = $2' : ''}
        ORDER BY u.name`,
      userId ? [chamberId, userId] : [chamberId],
    );
  }

  async summary(chamberId: string) {
    const camara = await this.chamber(chamberId);
    const membros = await this.presenceStats(chamberId);
    const [tot] = await this.q(
      `SELECT
         (SELECT COUNT(*)::int FROM sessions WHERE "chamberId"::text = $1::text AND status = 'encerrada') AS sessoes,
         (SELECT COUNT(*)::int FROM agenda_items WHERE "chamberId"::text = $1::text AND status = 'aprovado') AS aprovadas,
         (SELECT COUNT(*)::int FROM agenda_items WHERE "chamberId"::text = $1::text AND status = 'rejeitado') AS rejeitadas`,
      [chamberId],
    );
    return { camara, totais: tot, membros: membros.map(this.withRate) };
  }

  private withRate = (m: any) => ({ ...m, taxaPresenca: m.sessoes ? Math.round((m.presencas / m.sessoes) * 100) : null });

  votacoes(chamberId: string, limit = 50, offset = 0) {
    return this.q(
      `SELECT ai.id, ai.number, ai.type, ai.title, ai."authorName", ai."votingType", ai.majority, ai.status,
              ai."votesYes", ai."votesNo", ai."votesAbstain", ai."requiredVotes", ai."resultExplanation",
              ai."resultHash", ai."votingClosedAt", s.number AS "sessionNumber", s.date AS "sessionDate", s.id AS "sessionId"
         FROM agenda_items ai JOIN sessions s ON s.id = ai."sessionId"
        WHERE ai."chamberId" = $1 AND ai.status IN ${CLOSED}
        ORDER BY ai."votingClosedAt" DESC NULLS LAST
        LIMIT $2 OFFSET $3`,
      [chamberId, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0)],
    );
  }

  async votacao(itemId: string) {
    const [item] = await this.q(
      `SELECT ai.*, s.number AS "sessionNumber", s.date AS "sessionDate", c.name AS "chamberName"
         FROM agenda_items ai JOIN sessions s ON s.id = ai."sessionId" JOIN chambers c ON c.id::text = ai."chamberId"
        WHERE ai.id = $1 AND ai.status IN ${CLOSED}`,
      [itemId],
    );
    if (!item) throw new NotFoundException('Votação não encontrada ou ainda não encerrada');
    const nominal = item.votingType === 'aberta'
      ? await this.q(
        `SELECT u.id, u.name, u.party, v.choice FROM votes v JOIN users u ON u.id = v."userId"
          WHERE v."agendaItemId" = $1 ORDER BY u.name`, [itemId])
      : null;
    const verificacao = await this.voting.verifyItem(itemId);
    return {
      id: item.id, number: item.number, type: item.type, title: item.title, description: item.description,
      pdfUrl: item.pdfUrl, author: item.authorName, chamberId: item.chamberId, chamberName: item.chamberName,
      sessionId: item.sessionId, sessionNumber: item.sessionNumber, sessionDate: item.sessionDate,
      votingType: item.votingType, majority: item.majority,
      majorityLabel: MAJORITY_LABEL[item.majority as Majority] ?? item.majority,
      status: item.status, closedAt: item.votingClosedAt,
      counts: { sim: item.votesYes ?? 0, nao: item.votesNo ?? 0, abstencao: item.votesAbstain ?? 0 },
      requiredVotes: item.requiredVotes, explanation: item.resultExplanation, resultHash: item.resultHash,
      nominal,
      verificacao: { valid: verificacao.valid, totalVotes: verificacao.totalVotes, problems: verificacao.problems },
    };
  }

  async vereador(chamberId: string, userId: string) {
    await this.chamber(chamberId);
    const [m] = await this.presenceStats(chamberId, userId);
    if (!m) throw new NotFoundException('Vereador não encontrado');
    const votos = await this.q(
      `SELECT ai.id, ai.number, ai.title, ai.status, v.choice, ai."votingClosedAt", s.number AS "sessionNumber"
         FROM votes v JOIN agenda_items ai ON ai.id = v."agendaItemId" JOIN sessions s ON s.id = ai."sessionId"
        WHERE v."userId" = $1 AND ai."votingType" = 'aberta' AND ai.status IN ${CLOSED}
        ORDER BY ai."votingClosedAt" DESC LIMIT 100`,
      [userId],
    );
    const autorias = await this.q(
      `SELECT id, number, type, title, status, "votingClosedAt" FROM agenda_items
        WHERE "authorUserId" = $1 ORDER BY "createdAt" DESC LIMIT 100`,
      [userId],
    );
    return { ...this.withRate(m), votos, autorias };
  }

  // ── Dados abertos (CSV) ──────────────────────────────────────────────────

  private csv(rows: any[], cols: [string, string][]): string {
    const esc = (v: any) => {
      if (v == null) return '';
      const s = v instanceof Date ? v.toISOString() : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // ; como separador e BOM: abre direto no Excel em pt-BR.
    return '﻿' + [cols.map(c => c[1]).join(';'), ...rows.map(r => cols.map(c => esc(r[c[0]])).join(';'))].join('\r\n');
  }

  async csvVotacoes(chamberId: string) {
    await this.chamber(chamberId);
    const rows = await this.votacoes(chamberId, 200, 0);
    return this.csv(rows, [
      ['sessionNumber', 'sessao'], ['sessionDate', 'data_sessao'], ['number', 'numero'], ['type', 'tipo'],
      ['title', 'ementa'], ['authorName', 'autoria'], ['votingType', 'votacao'], ['majority', 'maioria'],
      ['status', 'resultado'], ['votesYes', 'sim'], ['votesNo', 'nao'], ['votesAbstain', 'abstencao'],
      ['requiredVotes', 'votos_necessarios'], ['votingClosedAt', 'encerrada_em'], ['resultHash', 'hash_resultado'],
    ]);
  }

  async csvVotosNominais(chamberId: string) {
    await this.chamber(chamberId);
    const rows = await this.q(
      `SELECT s.number AS sessao, ai.number AS numero, ai.title AS ementa, u.name AS vereador, u.party AS partido,
              v.choice AS voto, ai.status AS resultado, ai."votingClosedAt" AS encerrada_em
         FROM votes v JOIN agenda_items ai ON ai.id = v."agendaItemId"
         JOIN sessions s ON s.id = ai."sessionId" JOIN users u ON u.id = v."userId"
        WHERE ai."chamberId" = $1 AND ai."votingType" = 'aberta' AND ai.status IN ${CLOSED}
        ORDER BY ai."votingClosedAt" DESC, u.name`,
      [chamberId],
    );
    return this.csv(rows, [
      ['sessao', 'sessao'], ['numero', 'numero'], ['ementa', 'ementa'], ['vereador', 'vereador'],
      ['partido', 'partido'], ['voto', 'voto'], ['resultado', 'resultado'], ['encerrada_em', 'encerrada_em'],
    ]);
  }

  async csvPresencas(chamberId: string) {
    await this.chamber(chamberId);
    const rows = (await this.presenceStats(chamberId)).map(this.withRate);
    return this.csv(rows, [
      ['name', 'vereador'], ['party', 'partido'], ['role', 'cargo'], ['sessoes', 'sessoes_encerradas'],
      ['presencas', 'presencas'], ['taxaPresenca', 'taxa_presenca_pct'],
    ]);
  }
}
