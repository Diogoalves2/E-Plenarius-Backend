import {
  Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Logger, UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Vote, VoteChoice } from './entities/vote.entity';
import { User } from '../users/entities/user.entity';
import { AgendaItem } from '../agenda/entities/agenda-item.entity';
import { Session } from '../sessions/entities/session.entity';
import { SessionPresence } from '../sessions/entities/session-presence.entity';
import { AgendaService } from '../agenda/agenda.service';
import { AuditService } from '../audit/audit.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { VotingGateway } from './voting.gateway';
import { canonicalJson, GENESIS_HASH, maskSecretCounts, sha256 } from '../common/integrity';
import { decide, presidentMayVote } from '../common/legislative';
import { seal, sealEnabled, sealMatches } from '../common/seal';
import { ChambersService } from '../chambers/chambers.service';
import { LoginAttemptsService } from '../common/access/login-attempts.service';

const VOTER_ROLES = ['vereador', 'presidente', 'vice_presidente'];

/**
 * Integridade da votação:
 * - cada voto entra numa cadeia de hash por item (seq, prevHash, chainHash), sob lock do item;
 * - votação secreta grava só "quem votou" — a escolha individual vai apenas para o placar agregado;
 * - ao encerrar, resultHash = hash(placar + último elo da cadeia), registrado na auditoria e na ata;
 * - o banco bloqueia UPDATE/DELETE em votes e audit_logs (DatabaseIntegrityService).
 */
@Injectable()
export class VotingService {
  private readonly logger = new Logger(VotingService.name);

  constructor(
    @InjectRepository(Vote)
    private readonly votesRepo: Repository<Vote>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly agendaService: AgendaService,
    private readonly auditService: AuditService,
    private readonly gateway: VotingGateway,
    private readonly chambers: ChambersService,
    private readonly attempts: LoginAttemptsService,
  ) {}

  /**
   * Quem preside a sessão: o presidente, se presente; na ausência dele, o vice-presidente presente.
   * A regra regimental de voto do presidente (só desempate etc.) vale para quem preside.
   */
  private async presidingUserId(m: EntityManager, sessionId: string): Promise<string | null> {
    const rows: { id: string; role: string }[] = await m.query(
      `SELECT u.id, u.role FROM session_presences p JOIN users u ON u.id = p."userId"
        WHERE p."sessionId" = $1 AND u.role IN ('presidente', 'vice_presidente')`,
      [sessionId],
    );
    return (rows.find(r => r.role === 'presidente') ?? rows.find(r => r.role === 'vice_presidente'))?.id ?? null;
  }

  /** Vereadores + presidente com presença confirmada na sessão. */
  async countPresentMembers(sessionId: string): Promise<number> {
    const [{ n }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM session_presences p JOIN users u ON u.id = p."userId"
        WHERE p."sessionId" = $1 AND u.role IN ('vereador', 'presidente', 'vice_presidente')`,
      [sessionId],
    );
    return n;
  }

  static voteChainHash(v: { prevHash: string; seq: number; agendaItemId: string; userId: string; choice: string }) {
    return sha256(canonicalJson({
      prevHash: v.prevHash, seq: v.seq, agendaItemId: v.agendaItemId, userId: v.userId, choice: v.choice,
    }));
  }

  static resultHash(item: AgendaItem, lastChainHash: string, totalVotes: number) {
    return sha256(canonicalJson({
      agendaItemId: item.id,
      sessionId: item.sessionId,
      chamberId: item.chamberId,
      votingType: item.votingType,
      status: item.status,
      votesYes: item.votesYes ?? 0,
      votesNo: item.votesNo ?? 0,
      votesAbstain: item.votesAbstain ?? 0,
      majority: item.majority ?? 'simples',
      requiredVotes: item.requiredVotes ?? null,
      totalVotes,
      lastChainHash,
    }));
  }

  private async lockItem(m: EntityManager, id: string): Promise<AgendaItem> {
    const item = await m.getRepository(AgendaItem)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :id', { id })
      .getOne();
    if (!item) throw new NotFoundException('Item da pauta não encontrado');
    return item;
  }

  private async assertSessionRunning(m: EntityManager, sessionId: string) {
    const session = await m.getRepository(Session).findOne({ where: { id: sessionId }, select: ['id', 'status'] });
    if (session?.status !== 'em_andamento') throw new BadRequestException('A sessão não está em andamento');
  }

  async openVoting(agendaItemId: string, user: any) {
    const current = await this.agendaService.findOne(agendaItemId);
    await this.assertSessionRunning(this.dataSource.manager, current.sessionId);

    // Quórum: membros (vereadores + presidente) com presença confirmada.
    const present = await this.countPresentMembers(current.sessionId);
    if (present < current.quorumMinimum) {
      throw new BadRequestException(
        `Quórum insuficiente: ${present} presente(s), mínimo ${current.quorumMinimum} para abrir esta votação.`,
      );
    }
    const item = await this.agendaService.openVoting(agendaItemId);

    await this.auditService.log({
      chamberId: item.chamberId,
      sessionId: item.sessionId,
      userId: user.id,
      action: 'voting:opened',
      targetType: 'agenda_item',
      targetId: item.id,
      detail: { title: item.title, number: item.number, votingType: item.votingType, majority: item.majority, present },
    });
    const pub = maskSecretCounts(item);
    this.gateway.emitToSession(item.sessionId, 'voting:opened', { agendaItem: pub, openedBy: user.id });
    return pub;
  }

  async closeVoting(agendaItemId: string, user: any) {
    const { item, votes, integrityOk } = await this.dataSource.transaction(async m => {
      const item = await this.lockItem(m, agendaItemId);
      if (item.status !== 'em_votacao')
        throw new BadRequestException('Nenhuma votação em andamento para este item');

      const votes = await m.getRepository(Vote).find({
        where: { agendaItemId },
        relations: ['user'],
        order: { seq: 'ASC' },
      });
      const lastChainHash = votes.length ? votes[votes.length - 1].chainHash ?? GENESIS_HASH : GENESIS_HASH;
      const counted = (item.votesYes ?? 0) + (item.votesNo ?? 0) + (item.votesAbstain ?? 0);
      const integrityOk = counted === votes.length;
      if (!integrityOk) {
        this.logger.error(`[integridade] item=${item.id} placar=${counted} votos=${votes.length}`);
      }

      const rules = await this.chambers.getRules(item.chamberId);
      const yes = item.votesYes ?? 0, no = item.votesNo ?? 0, abstain = item.votesAbstain ?? 0;
      const decision = decide({ majority: item.majority ?? 'simples', yes, no, abstain, seats: rules.seats });

      // Empate em maioria simples: se o regimento reserva o voto do presidente ao desempate,
      // ele precisa votar antes de encerrar.
      if (decision.tie && rules.presidentVoteRule !== 'always') {
        const presiding = await this.presidingUserId(m, item.sessionId);
        if (presiding && !votes.some(v => v.userId === presiding)) {
          throw new ConflictException({
            statusCode: 409,
            code: 'TIE_NEEDS_PRESIDENT',
            message: `Empate (${yes} a ${no}). Pelo regimento, quem preside a sessão deve votar para desempatar antes de encerrar.`,
          });
        }
      }

      item.status = decision.approved ? 'aprovado' : 'rejeitado';
      item.requiredVotes = decision.required;
      item.resultExplanation = decision.explanation;
      item.votingClosedAt = new Date();
      item.resultHash = VotingService.resultHash(item, lastChainHash, votes.length);
      item.resultSeal = seal('result', item.resultHash);
      await m.getRepository(AgendaItem).save(item);

      await this.auditService.log({
        chamberId: item.chamberId,
        sessionId: item.sessionId,
        userId: user.id,
        action: 'voting:closed',
        targetType: 'agenda_item',
        targetId: item.id,
        detail: {
          result: item.status,
          votingType: item.votingType,
          votesYes: item.votesYes ?? 0,
          votesNo: item.votesNo ?? 0,
          votesAbstain: item.votesAbstain ?? 0,
          totalVotes: votes.length,
          majority: item.majority,
          requiredVotes: item.requiredVotes,
          seats: rules.seats,
          explanation: item.resultExplanation,
          resultHash: item.resultHash,
          integrityOk,
        },
      }, m);
      return { item, votes, integrityOk };
    });

    const full = await this.agendaService.findOne(item.id);
    const pub = maskSecretCounts(full);
    this.gateway.emitToSession(item.sessionId, 'voting:closed', {
      agendaItem: pub,
      result: item.status,
      counts: { sim: item.votesYes ?? 0, nao: item.votesNo ?? 0, abstencao: item.votesAbstain ?? 0 },
      totalVotes: votes.length,
      resultHash: item.resultHash,
      integrityOk,
      votes: item.votingType === 'aberta' ? this.toPublicVotes(votes, item.votingType) : [],
    });
    return pub;
  }

  async castVote(dto: CastVoteDto, user: any, ipAddress: string) {
    if (!VOTER_ROLES.includes(user.role)) throw new ForbiddenException('Seu perfil não vota');
    const rules = await this.chambers.getRules(user.chamberId);

    // Confirmação do voto com o PIN do vereador (tablet esquecido aberto não vota sozinho).
    if (rules.requirePinToVote) {
      if (!dto.pin) {
        throw new BadRequestException({ statusCode: 400, code: 'PIN_REQUIRED', message: 'Confirme o voto com seu PIN.' });
      }
      const key = `pin:${user.id}`;
      this.attempts.assertNotLocked(key);
      const u = await this.usersRepo.createQueryBuilder('u').addSelect('u.pinHash').where('u.id = :id', { id: user.id }).getOne();
      if (!u || !(await u.validatePin(dto.pin))) {
        this.attempts.registerFailure(key);
        throw new UnauthorizedException({ statusCode: 401, code: 'PIN_INVALID', message: 'PIN incorreto.' });
      }
      this.attempts.clear(key);
    }

    let result: { vote: Vote; item: AgendaItem };
    try {
      result = await this.dataSource.transaction(async m => {
        // Lock do item serializa os votos dele: cadeia de hash e placar sem condição de corrida.
        const item = await this.lockItem(m, dto.agendaItemId);
        if (item.chamberId !== user.chamberId)
          throw new ForbiddenException('Você não pertence à câmara deste item');
        if (item.status !== 'em_votacao')
          throw new BadRequestException('Votação não está aberta para este item');
        await this.assertSessionRunning(m, item.sessionId);

        const presence = await m.getRepository(SessionPresence).findOne({
          where: { sessionId: item.sessionId, userId: user.id },
          select: ['id'],
          loadEagerRelations: false,
        });
        if (!presence) throw new ForbiddenException('Confirme sua presença na sessão antes de votar');

        if (rules.presidentVoteRule !== 'always'
          && (await this.presidingUserId(m, item.sessionId)) === user.id
          && !presidentMayVote(rules.presidentVoteRule, item.majority ?? 'simples', item.votesYes ?? 0, item.votesNo ?? 0)) {
          throw new ForbiddenException(rules.presidentVoteRule === 'tie_only'
            ? 'Pelo regimento, quem preside a sessão só vota em caso de empate.'
            : 'Pelo regimento, quem preside a sessão só vota para desempatar ou em matérias de maioria absoluta/2/3.');
        }

        const votes = m.getRepository(Vote);
        const existing = await votes.findOne({
          where: { agendaItemId: dto.agendaItemId, userId: user.id },
          select: ['id'],
          loadEagerRelations: false,
        });
        if (existing) throw new ConflictException('Você já votou neste item');

        const last = await votes.findOne({
          where: { agendaItemId: dto.agendaItemId },
          select: ['id', 'seq', 'chainHash'],
          order: { seq: 'DESC' },
          loadEagerRelations: false,
        });
        const seq = (last?.seq ?? 0) + 1;
        const prevHash = last?.chainHash ?? GENESIS_HASH;
        const storedChoice: VoteChoice | 'secreta' = item.votingType === 'aberta' ? dto.choice : 'secreta';
        const chainHash = VotingService.voteChainHash({
          prevHash, seq, agendaItemId: item.id, userId: user.id, choice: storedChoice,
        });

        const vote = await votes.save(votes.create({
          sessionId: item.sessionId,
          agendaItemId: item.id,
          userId: user.id,
          chamberId: item.chamberId,
          choice: storedChoice,
          hash: `0x${chainHash.slice(0, 16)}`,
          seq,
          prevHash,
          chainHash,
          seal: seal('vote', chainHash),
          ipAddress,
          deviceInfo: dto.deviceInfo,
        }));

        const column = dto.choice === 'sim' ? 'votesYes' : dto.choice === 'nao' ? 'votesNo' : 'votesAbstain';
        await m.createQueryBuilder()
          .update(AgendaItem)
          .set({ [column]: () => `COALESCE("${column}", 0) + 1` })
          .where('id = :id', { id: item.id })
          .execute();

        await this.auditService.log({
          chamberId: item.chamberId,
          sessionId: item.sessionId,
          userId: user.id,
          action: 'vote:cast',
          targetType: 'agenda_item',
          targetId: item.id,
          detail: { choice: storedChoice, receipt: vote.hash, seq },
          ipAddress,
        }, m);

        const updated = await m.getRepository(AgendaItem).findOne({ where: { id: item.id } });
        return { vote, item: updated! };
      });
    } catch (err: any) {
      // Duplo clique / dois devices ao mesmo tempo: a constraint UNIQUE(agendaItemId,userId) segura.
      if (err?.code === '23505') throw new ConflictException('Você já votou neste item');
      throw err;
    }

    const { vote, item } = result;
    const fullUser = await this.usersRepo.findOne({
      where: { id: user.id },
      select: ['id', 'name', 'avatarUrl', 'party', 'initials'],
    });
    const pub = maskSecretCounts(item);

    this.gateway.emitToSession(item.sessionId, 'vote:cast', {
      userId: user.id,
      userName: fullUser?.name ?? user.email,
      userAvatarUrl: fullUser?.avatarUrl ?? null,
      userParty: fullUser?.party ?? null,
      userInitials: fullUser?.initials ?? null,
      agendaItemId: item.id,
      choice: vote.choice,
      hash: vote.hash,
      // Secreta em andamento: placar parcial oculto (null) — só o total.
      counts: pub.countsHidden
        ? null
        : { sim: item.votesYes ?? 0, nao: item.votesNo ?? 0, abstencao: item.votesAbstain ?? 0 },
      totalVotes: pub.votesTotal,
    });

    return { hash: vote.hash, message: 'Voto registrado com sucesso' };
  }

  /** Recalcula a cadeia de votos do item e confere placar/resultHash. */
  async verifyItem(agendaItemId: string) {
    const item = await this.agendaService.findOne(agendaItemId);
    const votes = await this.votesRepo.find({ where: { agendaItemId }, order: { seq: 'ASC' } });
    const problems: string[] = [];

    const sealOn = sealEnabled();
    let prev = GENESIS_HASH;
    let sawSeal = false;
    votes.forEach((v, i) => {
      if (v.seq !== i + 1) problems.push(`voto ${v.id}: sequência ${v.seq}, esperado ${i + 1}`);
      if (v.prevHash !== prev) problems.push(`voto ${v.id}: encadeamento quebrado`);
      const h = VotingService.voteChainHash({
        prevHash: v.prevHash ?? '', seq: v.seq ?? 0, agendaItemId: v.agendaItemId, userId: v.userId, choice: v.choice,
      });
      if (h !== v.chainHash) problems.push(`voto ${v.id}: conteúdo alterado`);
      if (sealOn) {
        if (v.seal) {
          if (!sealMatches('vote', v.chainHash ?? '', v.seal)) problems.push(`voto ${v.id}: selo inválido (voto forjado)`);
          sawSeal = true;
        } else if (sawSeal) {
          problems.push(`voto ${v.id}: sem selo depois de votos selados (voto forjado)`);
        }
      }
      prev = v.chainHash ?? '';
    });

    const counted = (item.votesYes ?? 0) + (item.votesNo ?? 0) + (item.votesAbstain ?? 0);
    if (counted !== votes.length) problems.push(`placar soma ${counted}, mas há ${votes.length} votos registrados`);

    if (item.votingType === 'aberta') {
      const by = (c: string) => votes.filter(v => v.choice === c).length;
      if (by('sim') !== (item.votesYes ?? 0) || by('nao') !== (item.votesNo ?? 0) || by('abstencao') !== (item.votesAbstain ?? 0)) {
        problems.push('placar diverge dos votos nominais');
      }
    }

    if (item.status === 'aprovado' || item.status === 'rejeitado') {
      const expected = VotingService.resultHash(item, votes.length ? prev : GENESIS_HASH, votes.length);
      if (!item.resultHash) problems.push('item encerrado sem resultHash');
      else if (expected !== item.resultHash) problems.push('resultHash não confere com placar/cadeia atuais');
      if (item.resultHash && sealOn && item.resultSeal && !sealMatches('result', item.resultHash, item.resultSeal)) {
        problems.push('selo do resultado inválido (resultado reescrito)');
      }
      // O resultHash também foi gravado na auditoria (cadeia selada) no encerramento.
      const audited = await this.auditService.closedResultHash(item.id);
      if (audited && item.resultHash && audited !== item.resultHash) {
        problems.push('resultHash diverge do registrado na auditoria no encerramento');
      }
    }

    return {
      valid: problems.length === 0,
      agendaItemId,
      totalVotes: votes.length,
      resultHash: item.resultHash ?? null,
      sealed: sealOn && !!item.resultSeal,
      problems,
    };
  }

  getVotesByItem(agendaItemId: string): Promise<Vote[]> {
    return this.votesRepo.find({
      where: { agendaItemId },
      relations: ['user'],
      order: { seq: 'ASC', createdAt: 'ASC' },
    });
  }

  /** Lista para clientes: mesma câmara apenas; em votação secreta mostra quem votou, nunca a escolha. */
  async getVotesForViewer(agendaItemId: string, viewer: any) {
    const item = await this.agendaService.findOne(agendaItemId);
    if (viewer.role !== 'superadmin' && item.chamberId !== viewer.chamberId)
      throw new ForbiddenException('Sem acesso a esta votação');
    return this.toPublicVotes(await this.getVotesByItem(agendaItemId), item.votingType);
  }

  private toPublicVotes(votes: Vote[], votingType: string) {
    return votes.map(v => ({
      id: v.id,
      userId: v.userId,
      agendaItemId: v.agendaItemId,
      choice: votingType === 'aberta' ? v.choice : 'secreta',
      hash: v.hash,
      createdAt: v.createdAt,
      user: v.user && {
        id: v.user.id,
        name: v.user.name,
        avatarUrl: v.user.avatarUrl,
        party: v.user.party,
        initials: v.user.initials,
      },
    }));
  }

  async hasVoted(agendaItemId: string, userId: string): Promise<boolean> {
    const vote = await this.votesRepo.findOne({ where: { agendaItemId, userId }, select: ['id'], loadEagerRelations: false });
    return !!vote;
  }
}
