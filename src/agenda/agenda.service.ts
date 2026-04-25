import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgendaItem } from './entities/agenda-item.entity';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';

@Injectable()
export class AgendaService {
  constructor(
    @InjectRepository(AgendaItem)
    private readonly agendaRepo: Repository<AgendaItem>,
  ) {}

  async create(dto: CreateAgendaItemDto): Promise<AgendaItem> {
    const item = this.agendaRepo.create(dto);
    return this.agendaRepo.save(item);
  }

  findBySession(sessionId: string): Promise<AgendaItem[]> {
    return this.agendaRepo.find({
      where: { sessionId },
      order: { orderIndex: 'ASC' },
      relations: ['authorUser'],
    });
  }

  async findOne(id: string): Promise<AgendaItem> {
    const item = await this.agendaRepo.findOne({
      where: { id },
      relations: ['authorUser'],
    });
    if (!item) throw new NotFoundException('Item da pauta não encontrado');
    return item;
  }

  async findActiveVoting(sessionId: string): Promise<AgendaItem | null> {
    return this.agendaRepo.findOne({
      where: { sessionId, status: 'em_votacao' },
      relations: ['authorUser'],
    });
  }

  async openVoting(id: string): Promise<AgendaItem> {
    const item = await this.findOne(id);
    if (item.status !== 'pendente')
      throw new BadRequestException('Apenas itens pendentes podem ter votação aberta');

    const activeVoting = await this.findActiveVoting(item.sessionId);
    if (activeVoting)
      throw new BadRequestException('Já existe uma votação em andamento nessa sessão');

    item.status = 'em_votacao';
    item.votingOpenedAt = new Date();
    item.votesYes = 0;
    item.votesNo = 0;
    item.votesAbstain = 0;
    return this.agendaRepo.save(item);
  }

  async closeVoting(id: string): Promise<AgendaItem> {
    const item = await this.findOne(id);
    if (item.status !== 'em_votacao')
      throw new BadRequestException('Nenhuma votação em andamento para este item');
    item.status = (item.votesYes ?? 0) > (item.votesNo ?? 0) ? 'aprovado' : 'rejeitado';
    item.votingClosedAt = new Date();
    return this.agendaRepo.save(item);
  }

  async incrementVote(id: string, choice: 'sim' | 'nao' | 'abstencao'): Promise<AgendaItem> {
    const item = await this.findOne(id);
    if (choice === 'sim') item.votesYes = (item.votesYes ?? 0) + 1;
    else if (choice === 'nao') item.votesNo = (item.votesNo ?? 0) + 1;
    else item.votesAbstain = (item.votesAbstain ?? 0) + 1;
    return this.agendaRepo.save(item);
  }
}
