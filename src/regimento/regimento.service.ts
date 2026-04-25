import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegimentoInterno } from './entities/regimento.entity';

interface CreateDto {
  title: string;
  description?: string;
  fileUrl: string;
  fileSize?: number;
  version?: string;
}

@Injectable()
export class RegimentoService {
  constructor(
    @InjectRepository(RegimentoInterno)
    private readonly repo: Repository<RegimentoInterno>,
  ) {}

  async create(chamberId: string, dto: CreateDto, userId: string): Promise<RegimentoInterno> {
    await this.repo.update({ chamberId, isActive: true }, { isActive: false });
    const r = this.repo.create({ ...dto, chamberId, uploadedById: userId, isActive: true });
    return this.repo.save(r);
  }

  findActive(chamberId: string): Promise<RegimentoInterno | null> {
    return this.repo.findOne({
      where: { chamberId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  findAll(chamberId: string): Promise<RegimentoInterno[]> {
    return this.repo.find({
      where: { chamberId },
      order: { createdAt: 'DESC' },
    });
  }

  async activate(id: string, chamberId: string): Promise<RegimentoInterno | null> {
    await this.repo.update({ chamberId }, { isActive: false });
    await this.repo.update(id, { isActive: true });
    return this.repo.findOne({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
