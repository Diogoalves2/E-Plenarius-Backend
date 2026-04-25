import {
  Injectable, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Vote } from './entities/vote.entity';
import { User } from '../users/entities/user.entity';
import { AgendaService } from '../agenda/agenda.service';
import { AuditService } from '../audit/audit.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { VotingGateway } from './voting.gateway';

@Injectable()
export class VotingService {
  constructor(
    @InjectRepository(Vote)
    private readonly votesRepo: Repository<Vote>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly agendaService: AgendaService,
    private readonly auditService: AuditService,
    private readonly gateway: VotingGateway,
  ) {}

  async openVoting(agendaItemId: string, user: any) {
    const item = await this.agendaService.openVoting(agendaItemId);
    await this.auditService.log({
      chamberId: item.chamberId,
      sessionId: item.sessionId,
      userId: user.id,
      action: 'voting:opened',
      targetType: 'agenda_item',
      targetId: item.id,
      detail: { title: item.title, number: item.number },
      ipAddress: user.ip,
    });
    this.gateway.emitToSession(item.sessionId, 'voting:opened', {
      agendaItem: item,
      openedBy: user.id,
    });
    return item;
  }

  async closeVoting(agendaItemId: string, user: any) {
    const item = await this.agendaService.closeVoting(agendaItemId);
    const votes = await this.getVotesByItem(agendaItemId);
    await this.auditService.log({
      chamberId: item.chamberId,
      sessionId: item.sessionId,
      userId: user.id,
      action: 'voting:closed',
      targetType: 'agenda_item',
      targetId: item.id,
      detail: {
        result: item.status,
        votesYes: item.votesYes,
        votesNo: item.votesNo,
        votesAbstain: item.votesAbstain,
      },
      ipAddress: user.ip,
    });
    this.gateway.emitToSession(item.sessionId, 'voting:closed', {
      agendaItem: item,
      result: item.status,
      counts: {
        sim: item.votesYes,
        nao: item.votesNo,
        abstencao: item.votesAbstain,
      },
      votes: item.votingType === 'aberta' ? votes : [],
    });
    return item;
  }

  async castVote(dto: CastVoteDto, user: any, ipAddress: string) {
    const item = await this.agendaService.findOne(dto.agendaItemId);

    if (item.status !== 'em_votacao')
      throw new BadRequestException('Votação não está aberta para este item');

    const existing = await this.votesRepo.findOne({
      where: { agendaItemId: dto.agendaItemId, userId: user.id },
    });
    if (existing) throw new ConflictException('Você já votou neste item');

    const hash = createHash('sha256')
      .update(`${user.id}:${dto.agendaItemId}:${dto.choice}:${Date.now()}`)
      .digest('hex');

    const vote = await this.votesRepo.save(
      this.votesRepo.create({
        sessionId: item.sessionId,
        agendaItemId: dto.agendaItemId,
        userId: user.id,
        chamberId: item.chamberId,
        choice: dto.choice,
        hash: `0x${hash.slice(0, 12)}`,
        ipAddress,
        deviceInfo: dto.deviceInfo,
      }),
    );

    const updatedItem = await this.agendaService.incrementVote(dto.agendaItemId, dto.choice);

    const fullUser = await this.usersRepo.findOne({
      where: { id: user.id },
      select: ['id', 'name', 'avatarUrl', 'party', 'initials'],
    });

    await this.auditService.log({
      chamberId: item.chamberId,
      sessionId: item.sessionId,
      userId: user.id,
      action: 'vote:cast',
      targetType: 'agenda_item',
      targetId: item.id,
      detail: {
        choice: item.votingType === 'aberta' ? dto.choice : 'secreta',
        hash: vote.hash,
      },
      ipAddress,
    });

    this.gateway.emitToSession(item.sessionId, 'vote:cast', {
      userId: user.id,
      userName: fullUser?.name ?? user.email,
      userAvatarUrl: fullUser?.avatarUrl ?? null,
      userParty: fullUser?.party ?? null,
      userInitials: fullUser?.initials ?? null,
      agendaItemId: dto.agendaItemId,
      choice: item.votingType === 'aberta' ? dto.choice : 'secreta',
      hash: vote.hash,
      counts: {
        sim: updatedItem.votesYes,
        nao: updatedItem.votesNo,
        abstencao: updatedItem.votesAbstain,
      },
    });

    return { hash: vote.hash, message: 'Voto registrado com sucesso' };
  }

  getVotesByItem(agendaItemId: string): Promise<Vote[]> {
    return this.votesRepo.find({
      where: { agendaItemId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async hasVoted(agendaItemId: string, userId: string): Promise<boolean> {
    const vote = await this.votesRepo.findOne({ where: { agendaItemId, userId } });
    return !!vote;
  }
}
