import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditLog } from './entities/audit-log.entity';

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

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(input: LogInput): Promise<AuditLog> {
    const lastLog = await this.auditRepo.findOne({
      where: { chamberId: input.chamberId },
      order: { createdAt: 'DESC' },
    });

    const previousHash = lastLog?.hash ?? '0x0000000000000000';
    const payload = JSON.stringify({ ...input, previousHash, timestamp: Date.now() });
    const hash = '0x' + createHash('sha256').update(payload).digest('hex').slice(0, 16);

    const entry = this.auditRepo.create({ ...input, hash, previousHash });
    return this.auditRepo.save(entry);
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
      take: limit,
      relations: ['user'],
    });
  }

  async verifyChain(chamberId: string): Promise<{ valid: boolean; brokenAt?: string }> {
    const logs = await this.auditRepo.find({
      where: { chamberId },
      order: { createdAt: 'ASC' },
    });
    for (let i = 1; i < logs.length; i++) {
      if (logs[i].previousHash !== logs[i - 1].hash) {
        return { valid: false, brokenAt: logs[i].id };
      }
    }
    return { valid: true };
  }
}
