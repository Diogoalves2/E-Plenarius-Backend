import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class StatsService {
  constructor(private readonly dataSource: DataSource) {}

  async getForChamber(chamberId: string) {
    const [sessionStats, votingStats, presenceStats, topPresenca, sessionsByMonth] = await Promise.all([
      this.dataSource.query(
        `SELECT status, COUNT(*)::int as count FROM sessions WHERE "chamberId" = $1 GROUP BY status`,
        [chamberId],
      ),
      this.dataSource.query(
        `SELECT
          COUNT(*) FILTER (WHERE ai.status = 'aprovado')::int  AS aprovados,
          COUNT(*) FILTER (WHERE ai.status = 'rejeitado')::int AS rejeitados
         FROM agenda_items ai
         JOIN sessions s ON ai."sessionId" = s.id
         WHERE s."chamberId" = $1`,
        [chamberId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(AVG(pc), 0)::float AS avg_presence
         FROM (
           SELECT COUNT(*)::int AS pc
           FROM session_presences sp
           JOIN sessions s ON sp."sessionId" = s.id
           WHERE s."chamberId" = $1
           GROUP BY sp."sessionId"
         ) t`,
        [chamberId],
      ),
      this.dataSource.query(
        `SELECT u.name, u.initials, u.party, u."avatarUrl", COUNT(*)::int AS presence_count
         FROM session_presences sp
         JOIN sessions s ON sp."sessionId" = s.id
         JOIN users u ON sp."userId" = u.id
         WHERE s."chamberId" = $1 AND u.role IN ('vereador', 'presidente')
         GROUP BY u.id, u.name, u.initials, u.party, u."avatarUrl"
         ORDER BY presence_count DESC
         LIMIT 5`,
        [chamberId],
      ),
      this.dataSource.query(
        `SELECT TO_CHAR(date, 'YYYY-MM') AS month, COUNT(*)::int AS count
         FROM sessions
         WHERE "chamberId" = $1 AND date >= NOW() - INTERVAL '6 months'
         GROUP BY month ORDER BY month ASC`,
        [chamberId],
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of sessionStats) byStatus[row.status] = row.count;

    const aprovados: number = votingStats[0]?.aprovados ?? 0;
    const rejeitados: number = votingStats[0]?.rejeitados ?? 0;

    return {
      sessions: {
        total: Object.values(byStatus).reduce((a: any, b: any) => a + b, 0) as number,
        encerradas: byStatus['encerrada'] ?? 0,
        emAndamento: byStatus['em_andamento'] ?? 0,
        agendadas: byStatus['agendada'] ?? 0,
      },
      votacoes: {
        aprovados,
        rejeitados,
        total: aprovados + rejeitados,
        taxaAprovacao: aprovados + rejeitados > 0
          ? Math.round((aprovados / (aprovados + rejeitados)) * 100)
          : 0,
      },
      presenca: {
        media: Math.round(presenceStats[0]?.avg_presence ?? 0),
      },
      topPresenca: topPresenca.map((r: any) => ({
        name: r.name,
        initials: r.initials,
        party: r.party,
        avatarUrl: r.avatarUrl,
        count: r.presence_count,
      })),
      sessionsByMonth: sessionsByMonth.map((r: any) => ({
        month: r.month,
        count: r.count,
      })),
    };
  }
}
