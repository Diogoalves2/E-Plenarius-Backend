import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { IntegrityCheckpoint } from './entities/integrity-checkpoint.entity';
import { canonicalJson, GENESIS_HASH, sha256 } from '../common/integrity';
import { withPublicUser } from '../common/serialize';
import { seal, sealEnabled, sealMatches } from '../common/seal';

interface LogInput {
  chamberId: string;
  sessionId?: string;
  userId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, any>;
  ipAddress?: string;
  deviceInfo?: string;
}

export interface ChainVerification {
  valid: boolean;
  total: number;
  brokenAt?: string;
  reason?: string;
  /** Selo HMAC: 'ativo' quando a chave está configurada na API. */
  seal: 'ativo' | 'desativado';
  sealed: number;
  /** Registros antigos (anteriores ao selo) sem checkpoint que os cubra. */
  unsealed: number;
  checkpointSeq: number | null;
}

/**
 * Log de auditoria encadeado por câmara: cada registro guarda o hash do anterior e
 * um hash SHA-256 sobre o próprio conteúdo. Alterar/remover qualquer registro quebra a cadeia.
 * O banco também bloqueia UPDATE/DELETE nesta tabela (ver DatabaseIntegrityService).
 * Com AUDIT_HMAC_KEY, cada registro novo leva um selo HMAC — sem a chave, ninguém com acesso
 * só ao banco consegue reescrever a cadeia de forma que a verificação aceite.
 */
@Injectable()
export class AuditService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(IntegrityCheckpoint)
    private readonly checkpointRepo: Repository<IntegrityCheckpoint>,
  ) {}

  static computeHash(e: {
    chamberId: string; sessionId?: string | null; userId?: string | null; action: string;
    targetType?: string | null; targetId?: string | null; detail?: any; ipAddress?: string | null;
    deviceInfo?: string | null; previousHash: string; seq: number; ts: string;
  }): string {
    return sha256(canonicalJson({
      chamberId: e.chamberId,
      sessionId: e.sessionId ?? null,
      userId: e.userId ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      detail: e.detail ?? null,
      ipAddress: e.ipAddress ?? null,
      deviceInfo: e.deviceInfo ?? null,
      previousHash: e.previousHash,
      seq: e.seq,
      ts: String(e.ts),
    }));
  }

  private static checkpointValue(c: { chamberId: string; chain: string; seq: number; headHash: string }) {
    return `${c.chamberId}:${c.chain}:${c.seq}:${c.headHash}`;
  }

  /**
   * Ao ativar o selo, a cabeça de cada cadeia existente (já conferida) recebe um checkpoint
   * selado. Roda a cada boot; câmaras que já têm checkpoint são ignoradas.
   */
  async onApplicationBootstrap() {
    if (!sealEnabled()) {
      this.logger.warn('AUDIT_HMAC_KEY ausente: auditoria sem selo HMAC (só cadeia de hash).');
      return;
    }
    try {
      await this.createCheckpoints();
    } catch (e: any) {
      // Esquema desatualizado (deploy sem sync) não pode derrubar a API; o /health já acusa.
      this.logger.error(`[selo] checkpoints não criados: ${e?.message}`);
    }
  }

  private async createCheckpoints() {
    const chambers: { chamberId: string }[] = await this.auditRepo.query(
      `SELECT DISTINCT a."chamberId" FROM audit_logs a
        WHERE NOT EXISTS (SELECT 1 FROM integrity_checkpoints c WHERE c."chamberId" = a."chamberId" AND c.chain = 'audit')
          AND EXISTS (SELECT 1 FROM audit_logs u WHERE u."chamberId" = a."chamberId" AND u.seal IS NULL AND u.seq IS NOT NULL)`,
    );
    for (const { chamberId } of chambers) {
      await this.auditRepo.manager.transaction(async m => {
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${chamberId}`]);
        const check = await this.verifyChain(chamberId, m);
        if (!check.valid) {
          this.logger.error(`[selo] cadeia da câmara ${chamberId} inválida (${check.reason}); checkpoint NÃO criado.`);
          return;
        }
        const head = await m.getRepository(AuditLog).createQueryBuilder('a')
          .where('a.chamberId = :c AND a.seq IS NOT NULL', { c: chamberId })
          .orderBy('a.seq', 'DESC').getOne();
        if (!head?.seq) return;
        const cp = { chamberId, chain: 'audit' as const, seq: head.seq, headHash: head.hash };
        await m.getRepository(IntegrityCheckpoint).insert({ ...cp, seal: seal('checkpoint', AuditService.checkpointValue(cp))! });
        this.logger.log(`[selo] checkpoint da câmara ${chamberId} em seq ${head.seq}`);
      });
    }
  }

  /** Grava um registro. Se `manager` vier de uma transação, participa dela. */
  async log(input: LogInput, manager?: EntityManager): Promise<AuditLog> {
    if (manager) return this.append(input, manager);
    return this.auditRepo.manager.transaction(m => this.append(input, m));
  }

  private async append(input: LogInput, m: EntityManager): Promise<AuditLog> {
    // Serializa escritas por câmara: dois logs simultâneos não podem apontar para o mesmo anterior.
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${input.chamberId}`]);
    const repo = m.getRepository(AuditLog);
    const last = await repo
      .createQueryBuilder('a')
      .where('a.chamberId = :c', { c: input.chamberId })
      .orderBy('a.seq', 'DESC', 'NULLS LAST')
      .addOrderBy('a.createdAt', 'DESC')
      .getOne();

    const previousHash = last?.hash ?? GENESIS_HASH;
    const seq = (last?.seq ?? 0) + 1;
    const ts = String(Date.now());
    const hash = AuditService.computeHash({ ...input, previousHash, seq, ts });

    return repo.save(repo.create({ ...input, previousHash, seq, ts, hash, seal: seal('audit', hash) }));
  }

  async findBySession(sessionId: string) {
    const logs = await this.auditRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });
    return logs.map(l => withPublicUser(l, 'user'));
  }

  async findByChamber(chamberId: string, limit = 100) {
    const logs = await this.auditRepo.find({
      where: { chamberId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
      relations: ['user'],
    });
    return logs.map(l => withPublicUser(l, 'user'));
  }

  /** resultHash gravado na auditoria quando a votação foi encerrada (fonte selada). */
  async closedResultHash(agendaItemId: string): Promise<string | null> {
    const [row] = await this.auditRepo.query(
      `SELECT detail->>'resultHash' AS h FROM audit_logs
        WHERE action = 'voting:closed' AND "targetId" = $1 ORDER BY seq DESC NULLS LAST LIMIT 1`,
      [agendaItemId],
    );
    return row?.h ?? null;
  }

  /** Último elo de cada cadeia (âncora pública: quem guardou uma cópia percebe reescrita do histórico). */
  async heads(): Promise<{ chamberId: string; seq: number; hash: string; createdAt: Date }[]> {
    return this.auditRepo.query(
      `SELECT DISTINCT ON (a."chamberId") a."chamberId", a.seq, a.hash, a."createdAt"
         FROM audit_logs a JOIN chambers c ON c.id::text = a."chamberId"::text AND c."isActive" = true
        WHERE a.seq IS NOT NULL
        ORDER BY a."chamberId", a.seq DESC`,
    );
  }

  /** Hash do registro na posição `seq` (para conferir uma âncora antiga). */
  async hashAt(chamberId: string, seq: number): Promise<string | null> {
    const row = await this.auditRepo.findOne({ where: { chamberId, seq }, select: ['id', 'hash'], loadEagerRelations: false });
    return row?.hash ?? null;
  }

  /** Recalcula cada hash a partir do conteúdo, confere o encadeamento e os selos. */
  async verifyChain(chamberId: string, manager?: EntityManager): Promise<ChainVerification> {
    const m = manager ?? this.auditRepo.manager;
    const logs = await m.getRepository(AuditLog)
      .createQueryBuilder('a')
      .where('a.chamberId = :c', { c: chamberId })
      .orderBy('a.seq', 'ASC', 'NULLS FIRST')
      .addOrderBy('a.createdAt', 'ASC')
      .getMany();

    const sealOn = sealEnabled();
    const cp = sealOn
      ? await m.getRepository(IntegrityCheckpoint).findOne({ where: { chamberId, chain: 'audit' }, order: { seq: 'ASC' } })
      : null;
    const base = { total: logs.length, seal: (sealOn ? 'ativo' : 'desativado') as 'ativo' | 'desativado', checkpointSeq: cp?.seq ?? null };
    let sealed = 0, unsealed = 0;
    const fail = (brokenAt: string | undefined, reason: string): ChainVerification =>
      ({ valid: false, brokenAt, reason, ...base, sealed, unsealed });

    if (cp && !sealMatches('checkpoint', AuditService.checkpointValue(cp), cp.seal)) {
      return fail(cp.id, 'checkpoint com selo inválido');
    }

    let prev = GENESIS_HASH;
    let lastSeq = 0;
    let sawSeal = false;
    for (const l of logs) {
      if (l.seq == null) { prev = l.hash; continue; } // registros antigos (antes do hash por conteúdo)
      if (l.seq !== lastSeq + 1) return fail(l.id, 'sequência com lacuna (registro removido)');
      lastSeq = l.seq;
      if (l.previousHash !== prev) return fail(l.id, 'encadeamento quebrado');
      if (AuditService.computeHash({ ...l, previousHash: l.previousHash, seq: l.seq, ts: l.ts! }) !== l.hash) {
        return fail(l.id, 'conteúdo alterado');
      }
      if (cp && l.seq === cp.seq && l.hash !== cp.headHash) return fail(l.id, 'histórico diverge do checkpoint selado');
      if (sealOn) {
        if (l.seal) {
          if (!sealMatches('audit', l.hash, l.seal)) return fail(l.id, 'selo inválido (registro forjado)');
          sealed++;
          sawSeal = true;
        } else if (cp && l.seq <= cp.seq) {
          sealed++; // coberto pelo checkpoint
        } else if (sawSeal || cp) {
          return fail(l.id, 'registro sem selo depois da ativação do selo (forjado)');
        } else {
          unsealed++;
        }
      }
      prev = l.hash;
    }
    if (cp && lastSeq < cp.seq) return fail(undefined, `registros removidos: cadeia termina em ${lastSeq}, checkpoint em ${cp.seq}`);
    return { valid: true, ...base, sealed, unsealed };
  }
}
