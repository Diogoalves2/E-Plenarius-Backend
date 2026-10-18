import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from './entities/session.entity';
import { SessionPresence } from './entities/session-presence.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { VotingGateway } from '../voting/voting.gateway';
import { AuditService } from '../audit/audit.service';
import { ChambersService } from '../chambers/chambers.service';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,
    @InjectRepository(SessionPresence)
    private readonly presenceRepo: Repository<SessionPresence>,
    private readonly gateway: VotingGateway,
    private readonly audit: AuditService,
    private readonly chambers: ChambersService,
  ) {}

  async create(dto: CreateSessionDto, createdById: string): Promise<Session> {
    const running = await this.sessionsRepo.findOne({
      where: { chamberId: dto.chamberId, status: 'em_andamento' },
    });
    if (running)
      throw new BadRequestException('Existe uma sessão em andamento. Encerre-a antes de criar uma nova.');
    const session = this.sessionsRepo.create({ ...dto, createdById });
    return this.sessionsRepo.save(session);
  }

  findByChamber(chamberId: string): Promise<Session[]> {
    return this.sessionsRepo.find({
      where: { chamberId },
      order: { date: 'DESC', number: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Session> {
    const session = await this.sessionsRepo.findOne({ where: { id } });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }

  async findActive(chamberId: string): Promise<Session | null> {
    return this.sessionsRepo.findOne({
      where: { chamberId, status: 'em_andamento' },
    });
  }

  async findCurrent(chamberId: string): Promise<Session | null> {
    const running = await this.sessionsRepo.findOne({
      where: { chamberId, status: 'em_andamento' },
    });
    if (running) return running;
    return this.sessionsRepo.findOne({
      where: { chamberId, status: 'agendada' },
      order: { date: 'ASC', number: 'ASC' },
    });
  }

  async start(id: string, userId: string): Promise<Session> {
    const session = await this.findOne(id);
    if (session.status !== 'agendada')
      throw new BadRequestException('Apenas sessões agendadas podem ser iniciadas');
    const { sessionPhases } = await this.chambers.getRules(session.chamberId);
    session.status = 'em_andamento';
    session.startedAt = new Date();
    session.phase = sessionPhases[0]?.key ?? null;
    session.phaseStartedAt = session.startedAt;
    const saved = await this.sessionsRepo.save(session);
    await this.audit.log({
      chamberId: session.chamberId, sessionId: id, userId, action: 'session:started',
      detail: { number: session.number, type: session.type, phase: session.phase },
    });
    this.gateway.emitToSession(id, 'session:phase', { sessionId: id, phase: session.phase, at: session.phaseStartedAt });
    return saved;
  }

  /** Avança/volta o roteiro da sessão (presidente). */
  async setPhase(id: string, phase: string, userId: string): Promise<Session> {
    const session = await this.findOne(id);
    if (session.status !== 'em_andamento') throw new BadRequestException('Sessão não está em andamento');
    const { sessionPhases } = await this.chambers.getRules(session.chamberId);
    const def = sessionPhases.find(p => p.key === phase);
    if (!def) throw new BadRequestException('Fase desconhecida no roteiro desta câmara');
    if (session.phase === phase) return session;
    const previous = session.phase;
    session.phase = phase;
    session.phaseStartedAt = new Date();
    const saved = await this.sessionsRepo.save(session);
    await this.audit.log({
      chamberId: session.chamberId, sessionId: id, userId, action: 'session:phase',
      detail: { phase, label: def.label, previous },
    });
    this.gateway.emitToSession(id, 'session:phase', { sessionId: id, phase, label: def.label, at: session.phaseStartedAt });
    return saved;
  }

  async updateStream(id: string, dto: { youtubeUrl?: string; youtubeThumbnailUrl?: string }): Promise<Session> {
    const session = await this.findOne(id);
    if (dto.youtubeUrl !== undefined) session.youtubeUrl = dto.youtubeUrl;
    if (dto.youtubeThumbnailUrl !== undefined) session.youtubeThumbnailUrl = dto.youtubeThumbnailUrl;
    return this.sessionsRepo.save(session);
  }

  async end(id: string, userId: string): Promise<Session> {
    const session = await this.findOne(id);
    if (session.status !== 'em_andamento')
      throw new BadRequestException('Sessão não está em andamento');
    session.status = 'encerrada';
    session.endedAt = new Date();
    session.phase = null;
    const saved = await this.sessionsRepo.save(session);
    const minutes = session.startedAt
      ? Math.round((session.endedAt.getTime() - new Date(session.startedAt).getTime()) / 60000)
      : null;
    await this.audit.log({
      chamberId: session.chamberId, sessionId: id, userId, action: 'session:ended',
      detail: { number: session.number, durationMin: minutes },
    });
    this.gateway.emitToSession(id, 'session:phase', { sessionId: id, phase: null, ended: true });
    return saved;
  }

  async confirmPresence(sessionId: string, userId: string): Promise<SessionPresence> {
    const existing = await this.presenceRepo.findOne({ where: { sessionId, userId } });
    if (existing) return existing;
    const presence = this.presenceRepo.create({ sessionId, userId });
    const saved = await this.presenceRepo.save(presence);
    const session = await this.findOne(sessionId);
    await this.audit.log({ chamberId: session.chamberId, sessionId, userId, action: 'presence:confirmed' });
    const presentCount = await this.presenceRepo.count({ where: { sessionId } });
    this.gateway.emitToSession(sessionId, 'quorum:updated', { sessionId, presentCount, userId, action: 'added' });
    return saved;
  }

  async getPresences(sessionId: string): Promise<SessionPresence[]> {
    return this.presenceRepo.find({
      where: { sessionId },
      relations: ['user'],
    });
  }

  async removePresence(sessionId: string, userId: string): Promise<void> {
    const res = await this.presenceRepo.delete({ sessionId, userId });
    if (res.affected) {
      const session = await this.findOne(sessionId);
      await this.audit.log({ chamberId: session.chamberId, sessionId, userId, action: 'presence:removed' });
    }
    const presentCount = await this.presenceRepo.count({ where: { sessionId } });
    this.gateway.emitToSession(sessionId, 'quorum:updated', { sessionId, presentCount, userId, action: 'removed' });
  }

  async leaveActiveSession(userId: string, chamberId?: string): Promise<void> {
    let sessionId: string | null = null;

    // Caminho primário: busca pelo chamberId do JWT (rápido)
    if (chamberId) {
      const session = await this.sessionsRepo.findOne({
        where: { chamberId, status: 'em_andamento' },
      });
      sessionId = session?.id ?? null;
    }

    // Fallback: JOIN direto entre sessão ativa e presença do usuário
    // Funciona independente do chamberId, e nunca retorna sessão encerrada
    if (!sessionId) {
      const activeSession = await this.sessionsRepo
        .createQueryBuilder('s')
        .innerJoin('session_presences', 'p', 'p."sessionId" = s.id AND p."userId" = :userId', { userId })
        .where('s.status = :status', { status: 'em_andamento' })
        .getOne();
      sessionId = activeSession?.id ?? null;
    }

    if (!sessionId) return;
    await this.removePresence(sessionId, userId);
  }
}
