import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/integrity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly repo: Repository<Device>,
    private readonly audit: AuditService,
  ) {}

  static hashKey(deviceKey: string): string {
    return sha256(`eplenarius-device:${deviceKey}`);
  }

  findByKey(deviceKey: string): Promise<Device | null> {
    return this.repo.findOne({ where: { keyHash: DevicesService.hashKey(deviceKey) } });
  }

  async createPending(chamberId: string, deviceKey: string, name: string | undefined, userId: string): Promise<Device> {
    const keyHash = DevicesService.hashKey(deviceKey);
    const device = await this.repo.save(this.repo.create({
      chamberId,
      keyHash,
      code: keyHash.slice(0, 6).toUpperCase(),
      name: name?.slice(0, 100) ?? null,
      status: 'pendente',
      lastUserId: userId,
    }));
    await this.audit.log({
      chamberId,
      userId,
      action: 'device:requested',
      targetType: 'device',
      targetId: device.id,
      detail: { code: device.code, name: device.name },
    });
    return device;
  }

  async isApproved(deviceId: string): Promise<boolean> {
    const d = await this.repo.findOne({ where: { id: deviceId }, select: ['id', 'status'] });
    return d?.status === 'aprovado';
  }

  async touch(deviceId: string, userId: string): Promise<void> {
    await this.repo.update(deviceId, { lastSeenAt: new Date(), lastUserId: userId });
  }

  async findById(id: string): Promise<Device> {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Dispositivo não encontrado');
    return d;
  }

  listByChamber(chamberId: string): Promise<Device[]> {
    return this.repo.find({ where: { chamberId }, order: { status: 'ASC', createdAt: 'DESC' } });
  }

  async setStatus(id: string, status: 'aprovado' | 'revogado', actorId: string, label?: string): Promise<Device> {
    const d = await this.findById(id);
    d.status = status;
    if (label !== undefined) d.label = label?.trim().slice(0, 100) || null;
    if (status === 'aprovado') {
      d.approvedById = actorId;
      d.approvedAt = new Date();
    }
    const saved = await this.repo.save(d);
    await this.audit.log({
      chamberId: d.chamberId,
      userId: actorId,
      action: status === 'aprovado' ? 'device:approved' : 'device:revoked',
      targetType: 'device',
      targetId: d.id,
      detail: { code: d.code, label: d.label },
    });
    return saved;
  }

  async rename(id: string, label: string | null): Promise<Device> {
    const d = await this.findById(id);
    d.label = label?.trim().slice(0, 100) || null;
    return this.repo.save(d);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const d = await this.findById(id);
    await this.repo.delete(id);
    await this.audit.log({
      chamberId: d.chamberId,
      userId: actorId,
      action: 'device:removed',
      targetType: 'device',
      targetId: d.id,
      detail: { code: d.code, label: d.label },
    });
  }
}
