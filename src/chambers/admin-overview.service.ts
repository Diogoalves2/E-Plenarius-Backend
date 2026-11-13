import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Sessão aberta há mais que isso aparece como pendência. */
const LONG_SESSION_HOURS = 12;

export interface OverviewAlert {
  level: 'warning' | 'info';
  kind: 'sem_presidente' | 'mfa_pendente' | 'tablets_pendentes' | 'sessao_longa' | 'sem_vereadores';
  chamberId: string;
  chamberName: string;
  message: string;
}

/**
 * Visão geral do superadmin: câmaras com seus números, sessões ao vivo, pendências e
 * saúde do sistema. Só leitura; tudo agregado no banco (poucas consultas, sem N+1).
 */
@Injectable()
export class AdminOverviewService {
  constructor(private readonly db: DataSource) {}

  async overview() {
    const [chambers, leaders, live, totals, dbSize, lastCheckpoint] = await Promise.all([
      this.db.query(`
        SELECT c.id, c.name, c.city, c.state, c."logoUrl", c."isActive", c."createdAt",
          (SELECT count(*) FROM users u WHERE u."chamberId"::text = c.id::text AND u."isActive"
             AND u.role IN ('vereador','presidente','vice_presidente'))::int AS members,
          (SELECT count(*) FROM devices d WHERE d."chamberId"::text = c.id::text AND d.status = 'aprovado')::int AS tablets,
          (SELECT count(*) FROM devices d WHERE d."chamberId"::text = c.id::text AND d.status = 'pendente')::int AS "tabletsPending",
          (SELECT count(*) FROM sessions s WHERE s."chamberId"::text = c.id::text AND s.status = 'encerrada')::int AS "sessionsDone",
          (SELECT max(COALESCE(s."endedAt", s."startedAt")) FROM sessions s WHERE s."chamberId"::text = c.id::text) AS "lastSessionAt",
          (SELECT count(*) FROM agenda_items a WHERE a."chamberId"::text = c.id::text AND a.status IN ('aprovado','rejeitado'))::int AS "itemsVoted",
          (SELECT count(*) FROM votes v WHERE v."chamberId"::text = c.id::text)::int AS votes
        FROM chambers c
        ORDER BY c."createdAt" DESC`),
      this.db.query(`
        SELECT u."chamberId", u.name, u.role, u."mfaEnabledAt" IS NOT NULL AS "mfa", u."lastLoginAt"
        FROM users u
        WHERE u."isActive" AND u.role IN ('presidente','vice_presidente')`),
      this.db.query(`
        SELECT s.id, s."chamberId", s.number, s.type, s.phase, s."startedAt",
          (SELECT count(*) FROM session_presences p WHERE p."sessionId"::text = s.id::text)::int AS present,
          (SELECT a.number FROM agenda_items a WHERE a."sessionId"::text = s.id::text AND a.status = 'em_votacao' LIMIT 1) AS "votingNumber",
          (SELECT a.title FROM agenda_items a WHERE a."sessionId"::text = s.id::text AND a.status = 'em_votacao' LIMIT 1) AS "votingTitle"
        FROM sessions s
        WHERE s.status = 'em_andamento'
        ORDER BY s."startedAt" ASC`),
      this.db.query(`
        SELECT
          (SELECT count(*) FROM users WHERE "isActive" AND role <> 'superadmin')::int AS users,
          (SELECT count(*) FROM sessions)::int AS sessions,
          (SELECT count(*) FROM agenda_items WHERE status IN ('aprovado','rejeitado'))::int AS "itemsVoted",
          (SELECT count(*) FROM votes)::int AS votes,
          (SELECT count(*) FROM audit_logs)::int AS "auditRecords"`),
      this.db.query(`SELECT pg_database_size(current_database())::bigint AS size`).catch(() => [{ size: null }]),
      this.db.query(`SELECT max("createdAt") AS at FROM integrity_checkpoints`).catch(() => [{ at: null }]),
    ]);

    const byChamber = new Map<string, any>(chambers.map((c: any) => [c.id, c]));
    const leadersOf = (id: string) => leaders.filter((l: any) => String(l.chamberId) === id);

    const alerts: OverviewAlert[] = [];
    for (const c of chambers) {
      if (!c.isActive) continue;
      const ls = leadersOf(c.id);
      if (!ls.some((l: any) => l.role === 'presidente'))
        alerts.push({ level: 'warning', kind: 'sem_presidente', chamberId: c.id, chamberName: c.name, message: 'Câmara sem presidente ativo.' });
      for (const l of ls.filter((l: any) => !l.mfa))
        alerts.push({ level: 'info', kind: 'mfa_pendente', chamberId: c.id, chamberName: c.name,
          message: `${l.role === 'presidente' ? 'Presidente' : 'Vice-presidente'} ${l.name} ainda não ativou a verificação em duas etapas.` });
      if (c.tabletsPending > 0)
        alerts.push({ level: 'info', kind: 'tablets_pendentes', chamberId: c.id, chamberName: c.name,
          message: `${c.tabletsPending} tablet(s) aguardando aprovação do presidente.` });
      if (c.members === 0)
        alerts.push({ level: 'warning', kind: 'sem_vereadores', chamberId: c.id, chamberName: c.name, message: 'Nenhum vereador cadastrado.' });
    }
    for (const s of live) {
      const hours = s.startedAt ? (Date.now() - new Date(s.startedAt).getTime()) / 3_600_000 : 0;
      if (hours >= LONG_SESSION_HOURS) {
        const c = byChamber.get(String(s.chamberId));
        alerts.push({ level: 'warning', kind: 'sessao_longa', chamberId: String(s.chamberId), chamberName: c?.name ?? '',
          message: `${s.number}ª sessão aberta há ${Math.floor(hours)} h.` });
      }
    }
    alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1));

    return {
      generatedAt: new Date().toISOString(),
      system: {
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        dbSizeBytes: dbSize[0]?.size != null ? Number(dbSize[0].size) : null,
        lastCheckpointAt: lastCheckpoint[0]?.at ?? null,
        totals: {
          chambers: chambers.length,
          activeChambers: chambers.filter((c: any) => c.isActive).length,
          ...totals[0],
        },
      },
      live: live.map((s: any) => {
        const c = byChamber.get(String(s.chamberId));
        return { ...s, chamberId: String(s.chamberId), chamberName: c?.name ?? '', chamberLogoUrl: c?.logoUrl ?? null, members: c?.members ?? 0 };
      }),
      alerts,
      chambers: chambers.map((c: any) => ({
        ...c,
        leaders: leadersOf(c.id).map((l: any) => ({ name: l.name, role: l.role, mfa: l.mfa, lastLoginAt: l.lastLoginAt })),
        live: live.some((s: any) => String(s.chamberId) === c.id),
      })),
    };
  }
}
