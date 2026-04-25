import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InscricaoExpediente } from './entities/inscricao-expediente.entity';
import { VotingGateway } from '../voting/voting.gateway';
import { InscreverExpedienteDto } from './dto/inscrever-expediente.dto';
import { CriarConvidadoDto } from './dto/criar-convidado.dto';

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
  inscricaoId: string;
  vereador: VereadorInfo;
  tipo: 'grande' | 'pequeno';
  paused: boolean;
  solicitacoes: SolicitacaoAparte[];
  aparteAtivo: AparteAtivo | null;
}

const APARTE_DURACAO = 120; // 2 minutos

@Injectable()
export class ExpedienteService {
  private timers = new Map<string, TimerState>();

  constructor(
    @InjectRepository(InscricaoExpediente)
    private inscricoesRepo: Repository<InscricaoExpediente>,
    private gateway: VotingGateway,
  ) {}

  // ─── Inscrições ────────────────────────────────────────────────────────────

  async inscrever(sessionId: string, userId: string, dto: InscreverExpedienteDto) {
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

    const timer = setInterval(async () => {
      const state = this.timers.get(sessionId);
      if (!state || state.paused) return;

      state.tempoRestante--;
      this.gateway.emitToSession(sessionId, 'expediente:tick', { tempoRestante: state.tempoRestante });

      if (state.tempoRestante <= 0) {
        this.clearTimer(sessionId);
        await this.inscricoesRepo.update(inscricaoId, { status: 'concluido' });
        this.gateway.emitToSession(sessionId, 'expediente:encerrado', { motivo: 'tempo_esgotado' });
      }
    }, 1000);

    this.timers.set(sessionId, {
      timer,
      tempoRestante: duracao,
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

    const { inscricaoId } = state;
    this.clearTimer(sessionId);
    await this.inscricoesRepo.update(inscricaoId, { status: 'concluido' });
    this.gateway.emitToSession(sessionId, 'expediente:encerrado', { motivo: 'encerrado_presidente' });
    return { ok: true };
  }

  getAtivo(sessionId: string) {
    const state = this.timers.get(sessionId);
    if (!state) return null;
    return {
      inscricaoId: state.inscricaoId,
      tipo: state.tipo,
      tempoRestante: state.tempoRestante,
      vereador: state.vereador,
      paused: state.paused,
      solicitacoesAparte: state.solicitacoes,
      aparteAtivo: state.aparteAtivo
        ? { tempoRestante: state.aparteAtivo.tempoRestante, vereador: state.aparteAtivo.vereador }
        : null,
    };
  }

  // ─── Apartes ───────────────────────────────────────────────────────────────

  solicitarAparte(sessionId: string, userId: string, vereador: VereadorInfo) {
    const state = this.timers.get(sessionId);
    if (!state) throw new BadRequestException('Nenhum expediente ativo');
    if (state.aparteAtivo) throw new BadRequestException('Já há um aparte em andamento');

    const jaExiste = state.solicitacoes.find(s => s.userId === userId);
    if (jaExiste) throw new BadRequestException('Já solicitou aparte');

    if (state.vereador.id === userId) throw new BadRequestException('O orador não pode solicitar aparte de si mesmo');

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

    clearInterval(state.aparteAtivo.timer);
    state.aparteAtivo = null;
    state.paused = false;

    this.gateway.emitToSession(sessionId, 'aparte:encerrado', {
      tempoRestanteOrador: state.tempoRestante,
    });
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
