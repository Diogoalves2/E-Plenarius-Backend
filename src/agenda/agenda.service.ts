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

  async findVotedByChamber(chamberId: string): Promise<AgendaItem[]> {
    return this.agendaRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.authorUser', 'author')
      .leftJoinAndSelect('item.session', 'session')
      .where('item.chamberId = :chamberId', { chamberId })
      .andWhere('item.status IN (:...statuses)', { statuses: ['aprovado', 'rejeitado'] })
      .orderBy('item.votingClosedAt', 'DESC')
      .addOrderBy('item.createdAt', 'DESC')
      .getMany();
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
}
