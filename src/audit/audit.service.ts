import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { canonicalJson, GENESIS_HASH, sha256 } from '../common/integrity';

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

/**
 * Log de auditoria encadeado por câmara: cada registro guarda o hash do anterior e
 * um hash SHA-256 sobre o próprio conteúdo. Alterar/remover qualquer registro quebra a cadeia.
 * O banco também bloqueia UPDATE/DELETE nesta tabela (ver DatabaseIntegrityService).
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
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

    return repo.save(repo.create({ ...input, previousHash, seq, ts, hash }));
  }

  findBySession(sessionId: string): Promise<AuditLog[]> {
    return this.auditRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });
  }

  findByChamber(chamberId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditRepo.find({
      where: { chamberId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
      relations: ['user'],
    });
  }

  /** Recalcula cada hash a partir do conteúdo e confere o encadeamento. */
  async verifyChain(chamberId: string): Promise<{ valid: boolean; total: number; brokenAt?: string; reason?: string }> {
    const logs = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.chamberId = :c', { c: chamberId })
      .orderBy('a.seq', 'ASC', 'NULLS FIRST')
      .addOrderBy('a.createdAt', 'ASC')
      .getMany();

    let prev = GENESIS_HASH;
    let lastSeq = 0;
    for (const l of logs) {
      if (l.seq == null) { prev = l.hash; continue; } // registros antigos (antes do hash por conteúdo)
      if (l.seq !== lastSeq + 1) {
        return { valid: false, total: logs.length, brokenAt: l.id, reason: 'sequência com lacuna (registro removido)' };
      }
      lastSeq = l.seq;
      if (l.previousHash !== prev) {
        return { valid: false, total: logs.length, brokenAt: l.id, reason: 'encadeamento quebrado' };
      }
      if (AuditService.computeHash({ ...l, previousHash: l.previousHash, seq: l.seq, ts: l.ts! }) !== l.hash) {
        return { valid: false, total: logs.length, brokenAt: l.id, reason: 'conteúdo alterado' };
      }
      prev = l.hash;
    }
    return { valid: true, total: logs.length };
  }
}
