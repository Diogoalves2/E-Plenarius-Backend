import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChambersService } from '../chambers/chambers.service';
import { AuditService } from '../audit/audit.service';
import { canonicalJson, sha256 } from '../common/integrity';
import { MAJORITY_LABEL, Majority } from '../common/legislative';

/**
 * Ata da sessão gerada a partir dos dados oficiais: auditoria encadeada (roteiro, falas,
 * presenças), pauta e votos. O documentHash permite conferir que o PDF assinado corresponde
 * ao registro do sistema (GET /sessions/:id/ata recalcula o mesmo hash).
 */
@Injectable()
export class AtaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly chambers: ChambersService,
    private readonly audit: AuditService,
  ) {}

  async build(sessionId: string) {
    const q = (sql: string, params: any[]) => this.dataSource.query(sql, params);

    const [session] = await q(
      `SELECT id, "chamberId", number, type, date, status, "startedAt", "endedAt" FROM sessions WHERE id = $1`,
      [sessionId],
    );
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const chamber = await this.chambers.findOne(session.chamberId);
    const rules = await this.chambers.getRules(session.chamberId);
    const phaseLabel = (k: string) => rules.sessionPhases.find(p => p.key === k)?.label ?? k;

    const members = await q(
      `SELECT id, name, party, role, title FROM users
        WHERE "chamberId" = $1 AND role IN ('vereador', 'presidente', 'vice_presidente') AND "isActive" = true
        ORDER BY name`,
      [session.chamberId],
    );
    const presences = await q(
      `SELECT u.id, u.name, u.party, u.role, p."confirmedAt"
         FROM session_presences p JOIN users u ON u.id = p."userId"
        WHERE p."sessionId" = $1 ORDER BY p."confirmedAt"`,
      [sessionId],
    );
    const presentIds = new Set(presences.map((p: any) => p.id));

    const logs = await q(
      `SELECT a.action, a.detail, a."createdAt" AS at, a.seq, a.hash, u.name AS "userName"
         FROM audit_logs a LEFT JOIN users u ON u.id = a."userId"
        WHERE a."sessionId" = $1 ORDER BY a.seq NULLS FIRST, a."createdAt"`,
      [sessionId],
    );

    const roteiro = logs
      .filter((l: any) => ['session:started', 'session:phase', 'session:ended'].includes(l.action))
      .map((l: any) => ({
        at: l.at,
        evento: l.action === 'session:started' ? 'Abertura da sessão'
          : l.action === 'session:ended' ? 'Encerramento da sessão'
          : phaseLabel(l.detail?.phase),
        por: l.userName ?? null,
      }));

    const falas = logs
      .filter((l: any) => l.action.startsWith('fala:') || l.action.startsWith('aparte:'))
      .map((l: any) => ({
        at: l.at,
        evento: l.action,
        orador: l.detail?.orador ?? l.detail?.aparteante ?? null,
        tipo: l.detail?.tipo ?? null,
        detalhe: l.detail ?? {},
      }));

    const items = await q(
      `SELECT id, number, type, title, "authorName", "votingType", majority, status,
              "votesYes", "votesNo", "votesAbstain", "requiredVotes", "resultExplanation", "resultHash",
              "votingOpenedAt", "votingClosedAt", "orderIndex"
         FROM agenda_items WHERE "sessionId" = $1 ORDER BY "orderIndex", "createdAt"`,
      [sessionId],
    );
    const votacoes = [];
    for (const it of items) {
      const votes = await q(
        `SELECT u.name, u.party, v.choice, v.seq, v.hash
           FROM votes v JOIN users u ON u.id = v."userId"
          WHERE v."agendaItemId" = $1 ORDER BY v.seq`,
        [it.id],
      );
      const closed = it.status === 'aprovado' || it.status === 'rejeitado';
      votacoes.push({
        id: it.id,
        number: it.number,
        type: it.type,
        title: it.title,
        author: it.authorName,
        status: it.status,
        votingType: it.votingType,
        majority: it.majority as Majority,
        majorityLabel: MAJORITY_LABEL[it.majority as Majority] ?? it.majority,
        openedAt: it.votingOpenedAt,
        closedAt: it.votingClosedAt,
        counts: closed ? { sim: it.votesYes ?? 0, nao: it.votesNo ?? 0, abstencao: it.votesAbstain ?? 0 } : null,
        requiredVotes: it.requiredVotes,
        explanation: it.resultExplanation,
        resultHash: it.resultHash,
        totalVotes: votes.length,
        // Nominal só em votação aberta; secreta registra apenas quem votou.
        nominal: it.votingType === 'aberta' && closed
          ? votes.map((v: any) => ({ name: v.name, party: v.party, choice: v.choice }))
          : null,
        votantes: it.votingType === 'secreta' ? votes.map((v: any) => v.name) : null,
      });
    }

    const integrity = await this.audit.verifyChain(session.chamberId);

    // Anexo: degravação integral aprovada (texto revisado pelo secretário)
    const [rec] = await q(
      `SELECT id, "approvedAt", "transcriptHash" FROM session_recordings
        WHERE "sessionId" = $1 AND status = 'aprovado' ORDER BY "approvedAt" DESC LIMIT 1`,
      [sessionId],
    );
    const degravacao = rec ? {
      aprovadaEm: rec.approvedAt,
      hash: rec.transcriptHash,
      trechos: (await q(
        `SELECT "startSec", speaker, COALESCE("editedText", text) AS text FROM transcript_segments
          WHERE "recordingId" = $1 ORDER BY idx`, [rec.id],
      )).map((s: any) => ({ inicioSeg: Math.round(s.startSec), orador: s.speaker, texto: s.text })),
    } : null;

    const doc = {
      sessao: {
        id: session.id, number: session.number, type: session.type, date: session.date,
        status: session.status, startedAt: session.startedAt, endedAt: session.endedAt,
      },
      camara: {
        id: chamber.id, name: chamber.name, city: chamber.city, state: chamber.state, logoUrl: chamber.logoUrl,
        bienioInicio: chamber.bienioInicio, bienioFim: chamber.bienioFim, anoBienio: chamber.anoBienio,
        cadeiras: rules.seats,
      },
      presentes: presences.map((p: any) => ({ name: p.name, party: p.party, role: p.role, confirmedAt: p.confirmedAt })),
      ausentes: members.filter((m: any) => !presentIds.has(m.id)).map((m: any) => ({ name: m.name, party: m.party, role: m.role })),
      roteiro,
      falas,
      votacoes,
      degravacao,
    };
    // Hash só do conteúdo da sessão: estável depois do encerramento (a verificação da cadeia
    // de auditoria muda conforme novas sessões são registradas, por isso fica de fora).
    return {
      ...doc,
      documentHash: sha256(canonicalJson(doc)),
      auditoria: { cadeiaIntegra: integrity.valid, registrosConferidos: integrity.total, motivo: integrity.reason ?? null },
      geradoEm: new Date().toISOString(),
    };
  }
}
