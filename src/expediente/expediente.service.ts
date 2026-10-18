import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InscricaoExpediente } from './entities/inscricao-expediente.entity';
import { User } from '../users/entities/user.entity';
import { SessionPresence } from '../sessions/entities/session-presence.entity';
import { VotingGateway } from '../voting/voting.gateway';
import { InscreverExpedienteDto } from './dto/inscrever-expediente.dto';
import { CriarConvidadoDto } from './dto/criar-convidado.dto';
import { Session } from '../sessions/entities/session.entity';
import { AuditService } from '../audit/audit.service';
import { ChambersService } from '../chambers/chambers.service';

type Interval = ReturnType<typeof setInterval>;

export interface VereadorInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
  party: string | null;
  initials: string | null;
  title: string | null;
}

export interface SolicitacaoAparte {
  userId: string;
  vereador: VereadorInfo;
  solicitadoEm: Date;
}

interface AparteAtivo {
  timer: Interval;
  tempoRestante: number;
  vereador: VereadorInfo;
}

interface TimerState {
  timer: Interval;
  tempoRestante: number;
  duracao: number;
  inscricaoId: string;
  vereador: VereadorInfo;
  tipo: 'grande' | 'pequeno';
  paused: boolean;
  solicitacoes: SolicitacaoAparte[];
  aparteAtivo: AparteAtivo | null;
}

const APARTE_DURACAO = 120; // 2 minutos

type TipoExpediente = 'grande' | 'pequeno';
export interface InscricoesAbertasState { grande: boolean; pequeno: boolean; }

@Injectable()
export class ExpedienteService {
  private timers = new Map<string, TimerState>();
  /** Estado de inscrições abertas por sessão. Default: ambos fechados. */
  private inscricoesAbertas = new Map<string, InscricoesAbertasState>();

  constructor(
    @InjectRepository(InscricaoExpediente)
    private inscricoesRepo: Repository<InscricaoExpediente>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(SessionPresence)
    private presencesRepo: Repository<SessionPresence>,
    private gateway: VotingGateway,
    @InjectRepository(Session)
    private sessionsRepo: Repository<Session>,
    private audit: AuditService,
    private chambers: ChambersService,
  ) {}

  private chamberBySession = new Map<string, string>();

  private async chamberOf(sessionId: string): Promise<string | null> {
    if (!this.chamberBySession.has(sessionId)) {
      const s = await this.sessionsRepo.findOne({ where: { id: sessionId }, select: ['id', 'chamberId'] });
      if (!s) return null;
      this.chamberBySession.set(sessionId, s.chamberId);
    }
    return this.chamberBySession.get(sessionId)!;
  }

  /** Registro na auditoria encadeada (alimenta a ata). Nunca derruba o fluxo do expediente. */
  private async record(sessionId: string, action: string, detail: Record<string, any>, userId?: string) {
    try {
      const chamberId = await this.chamberOf(sessionId);
      if (chamberId) await this.audit.log({ chamberId, sessionId, userId, action, detail });
    } catch { /* auditoria do expediente é best-effort */ }
  }

  // ─── Estado inscrições ─────────────────────────────────────────────────────

  private getEstado(sessionId: string): InscricoesAbertasState {
    if (!this.inscricoesAbertas.has(sessionId)) {
      this.inscricoesAbertas.set(sessionId, { grande: false, pequeno: false });
    }
    return this.inscricoesAbertas.get(sessionId)!;
  }

  getInscricoesStatus(sessionId: string): InscricoesAbertasState {
    return { ...this.getEstado(sessionId) };
  }

  abrirInscricoes(sessionId: string, tipo: TipoExpediente) {
    const state = this.getEstado(sessionId);
    state[tipo] = true;
    this.gateway.emitToSession(sessionId, 'expediente:inscricoes_status', { tipo, aberta: true });
    return { ok: true, tipo, aberta: true };
  }

  encerrarInscricoes(sessionId: string, tipo: TipoExpediente) {
    const state = this.getEstado(sessionId);
    state[tipo] = false;
    this.gateway.emitToSession(sessionId, 'expediente:inscricoes_status', { tipo, aberta: false });
    return { ok: true, tipo, aberta: false };
  }

  /** Emite audio:mute / audio:unmute via socket pra bridge agent local (mesa de som).
   *  Emite tanto pro room session:* (compat) quanto chamber:* (bridge persistente). */
  private async emitAudio(event: 'audio:mute' | 'audio:unmute', sessionId: string, userId: string | undefined, reason: string): Promise<void> {
    if (!userId) return;
    try {
      const user = await this.usersRepo.findOne({
        where: { id: userId },
        select: ['id', 'audioChannel', 'chamberId'],
      });
      if (!user?.audioChannel) return;
      if (event === 'audio:unmute' && user.chamberId && !(await this.chambers.getRules(user.chamberId)).autoOpenMic) return;
      const payload = { channel: user.audioChannel, userId, reason, sessionId };
      this.gateway.emitToSession(sessionId, event, payload);
      if (user.chamberId) this.gateway.emitToChamber(user.chamberId, event, payload);
    } catch { /* ignora — controle de áudio é best-effort */ }
  }

  private emitAudioMute(sessionId: string, userId: string | undefined, reason: string) {
    return this.emitAudio('audio:mute', sessionId, userId, reason);
  }

  // ─── Inscrições ────────────────────────────────────────────────────────────

  async inscrever(sessionId: string, userId: string, dto: InscreverExpedienteDto) {
    // 1. Inscrições abertas pelo presidente?
    const state = this.getEstado(sessionId);
    if (!state[dto.tipo]) {
      throw new BadRequestException(
        `Inscrições para o ${dto.tipo} expediente ainda não foram abertas pelo presidente.`,
      );
    }

    // 2. Presença confirmada na sessão?
    const presence = await this.presencesRepo.findOne({ where: { sessionId, userId } });
    if (!presence) {
      throw new BadRequestException('Você precisa confirmar sua presença na sessão antes de se inscrever.');
    }

    // 3. Já inscrito?
    const existing = await this.inscricoesRepo.findOne({
      where: { sessionId, userId, tipo: dto.tipo, status: 'aguardando' },
    });
    if (existing) throw new BadRequestException('Já inscrito neste expediente');

    const inscricao = this.inscricoesRepo.create({ sessionId, userId, tipo: dto.tipo, status: 'aguardando' });
    const saved = await this.inscricoesRepo.save(inscricao);
    this.gateway.emitToSession(sessionId, 'expediente:inscricao_atualizada', { tipo: dto.tipo, action: 'inscrito' });
    return saved;
  }

  async inscreverConvidado(sessionId: string, dto: CriarConvidadoDto) {
    const inscricao = this.inscricoesRepo.create({
      sessionId,
      userId: null,
      tipo: dto.tipo,
      status: 'aguardando',
      guestName: dto.nome,
      guestCargo: dto.cargo,
      guestTempo: dto.tempo,
    } as any);
    const saved = await this.inscricoesRepo.save(inscricao);
    this.gateway.emitToSession(sessionId, 'expediente:inscricao_atualizada', { tipo: dto.tipo, action: 'convidado_inscrito' });
    return saved;
  }

  async removerConvidado(sessionId: string, inscricaoId: string) {
    const inscricao = await this.inscricoesRepo.findOne({ where: { id: inscricaoId, sessionId } });
    if (!inscricao) throw new NotFoundException('Inscrição não encontrada');
    if (!inscricao.guestName) throw new BadRequestException('Apenas convidados podem ser removidos desta forma');
    await this.inscricoesRepo.delete(inscricaoId);
    this.gateway.emitToSession(sessionId, 'expediente:inscricao_atualizada', { tipo: inscricao.tipo, action: 'convidado_removido' });
    return { ok: true };
  }

  async cancelarInscricao(sessionId: string, userId: string, tipo: 'grande' | 'pequeno') {
    const inscricao = await this.inscricoesRepo.findOne({
      where: { sessionId, userId, tipo, status: 'aguardando' },
    });
    if (!inscricao) throw new NotFoundException('Inscrição não encontrada');
    await this.inscricoesRepo.update(inscricao.id, { status: 'cancelado' });
    this.gateway.emitToSession(sessionId, 'expediente:inscricao_atualizada', { tipo, action: 'cancelado' });
    return { ok: true };
  }

  async listarInscritos(sessionId: string) {
    return this.inscricoesRepo.find({
      where: { sessionId },
      relations: ['user'],
      order: { tipo: 'ASC', createdAt: 'ASC' },
    });
  }

  // ─── Tempo principal ───────────────────────────────────────────────────────

  async liberarTempo(sessionId: string, inscricaoId: string) {
    if (this.timers.has(sessionId)) {
      throw new BadRequestException('Já há um vereador com tempo liberado. Encerre antes de liberar outro.');
    }

    const inscricao = await this.inscricoesRepo.findOne({
      where: { id: inscricaoId, sessionId, status: 'aguardando' },
      relations: ['user'],
    });
    if (!inscricao) throw new NotFoundException('Inscrição não encontrada ou já utilizada');

    const isGuest = !!inscricao.guestName;
    if (!isGuest && !inscricao.user) throw new NotFoundException('Dados do vereador não encontrados');

    const duracao = isGuest
      ? (inscricao.guestTempo ?? 5) * 60
      : inscricao.tipo === 'grande' ? 10 * 60 : 5 * 60;

    await this.inscricoesRepo.update(inscricaoId, { status: 'em_andamento' });

    const deriveInitials = (name: string) =>
      name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();

    const vereador: VereadorInfo = isGuest
      ? {
          id: inscricao.id,
          name: inscricao.guestName!,
          avatarUrl: null,
          party: inscricao.guestCargo ?? null,
          initials: deriveInitials(inscricao.guestName!),
          title: inscricao.guestCargo ?? null,
        }
      : {
          id: inscricao.user!.id,
          name: inscricao.user!.name,
          avatarUrl: inscricao.user!.avatarUrl ?? null,
          party: (inscricao.user! as any).party ?? null,
          initials: (inscricao.user! as any).initials ?? null,
          title: (inscricao.user! as any).title ?? null,
        };

    this.gateway.emitToSession(sessionId, 'expediente:iniciado', {
      inscricaoId,
      tipo: inscricao.tipo,
      duracao,
      tempoRestante: duracao,
      vereador,
    });
    await this.record(sessionId, 'fala:iniciada', {
      tipo: inscricao.tipo, orador: vereador.name, cargo: vereador.title ?? vereador.party, convidado: isGuest, duracaoSeg: duracao,
    }, isGuest ? undefined : vereador.id);
    if (!isGuest) await this.emitAudio('audio:unmute', sessionId, vereador.id, 'fala_liberada');

    const timer = setInterval(async () => {
      const state = this.timers.get(sessionId);
      if (!state || state.paused) return;

      state.tempoRestante--;
      this.gateway.emitToSession(sessionId, 'expediente:tick', { tempoRestante: state.tempoRestante });

      if (state.tempoRestante <= 0) {
        this.clearTimer(sessionId);
        await this.inscricoesRepo.update(inscricaoId, { status: 'concluido' });
        this.gateway.emitToSession(sessionId, 'expediente:encerrado', { motivo: 'tempo_esgotado' });
        await this.emitAudioMute(sessionId, state.vereador?.id, 'tempo_esgotado');
        await this.record(sessionId, 'fala:encerrada', {
          tipo: state.tipo, orador: state.vereador?.name, motivo: 'tempo_esgotado', usadoSeg: state.duracao,
        });
      }
    }, 1000);

    this.timers.set(sessionId, {
      timer,
      tempoRestante: duracao,
      duracao,
      inscricaoId,
      vereador,
      tipo: inscricao.tipo,
      paused: false,
      solicitacoes: [],
      aparteAtivo: null,
    });

    return { ok: true, duracao, inscricaoId };
  }

  async ajustarTempo(sessionId: string, delta: 1 | -1) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');
    state.tempoRestante = Math.max(0, state.tempoRestante + delta * 60);
    this.gateway.emitToSession(sessionId, 'expediente:ajuste', {
      tempoRestante: state.tempoRestante,
      delta,
    });
    return { tempoRestante: state.tempoRestante };
  }

  async encerrar(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');

    if (state.aparteAtivo) {
      clearInterval(state.aparteAtivo.timer);
      state.aparteAtivo = null;
    }

    const { inscricaoId, vereador, tipo, duracao, tempoRestante } = state;
    this.clearTimer(sessionId);
    await this.inscricoesRepo.update(inscricaoId, { status: 'concluido' });
    this.gateway.emitToSession(sessionId, 'expediente:encerrado', { motivo: 'encerrado_presidente' });
    await this.emitAudioMute(sessionId, vereador?.id, 'encerrado_presidente');
    await this.record(sessionId, 'fala:encerrada', {
      tipo, orador: vereador?.name, motivo: 'encerrado_presidente', usadoSeg: Math.max(0, duracao - tempoRestante),
    });
    return { ok: true };
  }

  /** Botão "Cortar fala": muta canal do orador atual sem encerrar expediente. */
  async cortarFala(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');
    await this.emitAudioMute(sessionId, state.vereador?.id, 'cortar_fala');
    await this.record(sessionId, 'fala:cortada', { orador: state.vereador?.name });
    return { ok: true, channel: state.vereador?.id };
  }

  getAtivo(sessionId: string) {
    const state = this.timers.get(sessionId);
    const inscricoesStatus = this.getInscricoesStatus(sessionId);
    if (!state) return { ativo: null, inscricoesAbertas: inscricoesStatus };
    return {
      ativo: {
        inscricaoId: state.inscricaoId,
        tipo: state.tipo,
        tempoRestante: state.tempoRestante,
        vereador: state.vereador,
        paused: state.paused,
        solicitacoesAparte: state.solicitacoes,
        aparteAtivo: state.aparteAtivo
          ? { tempoRestante: state.aparteAtivo.tempoRestante, vereador: state.aparteAtivo.vereador }
          : null,
      },
      // backwards compat — frontend antigo lia direto da raiz
      inscricaoId: state.inscricaoId,
      tipo: state.tipo,
      tempoRestante: state.tempoRestante,
      vereador: state.vereador,
      paused: state.paused,
      solicitacoesAparte: state.solicitacoes,
      aparteAtivo: state.aparteAtivo
        ? { tempoRestante: state.aparteAtivo.tempoRestante, vereador: state.aparteAtivo.vereador }
        : null,
      inscricoesAbertas: inscricoesStatus,
    };
  }

  // ─── Apartes ───────────────────────────────────────────────────────────────

  async solicitarAparte(sessionId: string, userId: string) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');
    if (state.aparteAtivo) throw new BadRequestException('Já há um aparte em andamento');

    const jaExiste = state.solicitacoes.find(s => s.userId === userId);
    if (jaExiste) throw new BadRequestException('Já solicitou aparte');

    if (state.vereador.id === userId) throw new BadRequestException('O orador não pode solicitar aparte de si mesmo');

    // JWT só carrega id/email/role/chamberId — dados de exibição vêm do banco.
    const u = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'name', 'avatarUrl', 'party', 'initials', 'title'],
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    const vereador: VereadorInfo = {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl ?? null,
      party: u.party ?? null,
      initials: u.initials ?? null,
      title: u.title ?? null,
    };

    state.solicitacoes.push({ userId, vereador, solicitadoEm: new Date() });

    this.gateway.emitToSession(sessionId, 'aparte:solicitado', {
      userId,
      vereador,
      pendentes: state.solicitacoes.length,
    });

    return { ok: true };
  }

  cancelarAparte(sessionId: string, userId: string) {
    const state = this.timers.get(sessionId);
    if (!state) return { ok: true };
    state.solicitacoes = state.solicitacoes.filter(s => s.userId !== userId);
    this.gateway.emitToSession(sessionId, 'aparte:cancelado', { userId });
    return { ok: true };
  }

  aceitarAparte(sessionId: string, userId: string) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');
    if (state.aparteAtivo) throw new BadRequestException('Já há um aparte em andamento');

    const solicitacao = state.solicitacoes.find(s => s.userId === userId);
    if (!solicitacao) throw new BadRequestException('Solicitação não encontrada');

    state.solicitacoes = state.solicitacoes.filter(s => s.userId !== userId);
    state.paused = true;

    const { vereador } = solicitacao;
    let tempoRestante = APARTE_DURACAO;

    const aparteTimer = setInterval(() => {
      const s = this.timers.get(sessionId);
      if (!s || !s.aparteAtivo) return;

      tempoRestante--;
      s.aparteAtivo.tempoRestante = tempoRestante;

      this.gateway.emitToSession(sessionId, 'aparte:tick', { tempoRestante });

      if (tempoRestante <= 0) {
        this.encerrarAparteInterno(sessionId);
      }
    }, 1000);

    state.aparteAtivo = { timer: aparteTimer, tempoRestante, vereador };
    this.record(sessionId, 'aparte:iniciado', { aparteante: vereador.name, orador: state.vereador?.name }, vereador.id);
    this.emitAudio('audio:unmute', sessionId, vereador.id, 'aparte_concedido');

    this.gateway.emitToSession(sessionId, 'aparte:iniciado', {
      vereador,
      duracao: APARTE_DURACAO,
      tempoRestante: APARTE_DURACAO,
    });

    return { ok: true };
  }

  encerrarApartePorPresidente(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (!state?.aparteAtivo) throw new BadRequestException('Nenhum aparte ativo');
    this.encerrarAparteInterno(sessionId);
    return { ok: true };
  }

  private encerrarAparteInterno(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (!state?.aparteAtivo) return;

    const aparteVereadorId = state.aparteAtivo.vereador?.id;
    clearInterval(state.aparteAtivo.timer);
    state.aparteAtivo = null;
    state.paused = false;

    this.gateway.emitToSession(sessionId, 'aparte:encerrado', {
      tempoRestanteOrador: state.tempoRestante,
    });
    this.record(sessionId, 'aparte:encerrado', { orador: state.vereador?.name });
    // muta canal do aparteante
    this.emitAudioMute(sessionId, aparteVereadorId, 'aparte_encerrado').catch(() => {});
  }

  private clearTimer(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (state) {
      clearInterval(state.timer);
      if (state.aparteAtivo) clearInterval(state.aparteAtivo.timer);
      this.timers.delete(sessionId);
    }
  }
}
