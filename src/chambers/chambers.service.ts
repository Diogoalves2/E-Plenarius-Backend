import { ipInNetworks, parseNetwork } from '../common/network';
import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Chamber } from './entities/chamber.entity';
import { User } from '../users/entities/user.entity';
import { Session } from '../sessions/entities/session.entity';
import { CreateChamberDto } from './dto/create-chamber.dto';
import { SetupChamberDto } from './dto/setup-chamber.dto';
import { ChamberSettingsDto } from './dto/chamber-settings.dto';
import { DEFAULT_PHASES, Majority, PresidentVoteRule, SessionPhase, sortMesaFirst } from '../common/legislative';

export interface ChamberRules {
  chamberId: string;
  seats: number;
  seatsConfigured: boolean;
  presidentVoteRule: PresidentVoteRule;
  majorityByType: Record<string, Majority>;
  defaultQuorum: number;
  requirePinToVote: boolean;
  votingNetworkOnly: boolean;
  votingNetworks: string[];
  autoOpenMic: boolean;
  sessionPhases: SessionPhase[];
}

@Injectable()
export class ChambersService {
  constructor(
    @InjectRepository(Chamber)
    private readonly chambersRepo: Repository<Chamber>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,
  ) {}

  async setup(dto: SetupChamberDto): Promise<{ chamber: Chamber; presidenteEmail: string; presidentePassword: string }> {
    const slug = dto.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    const existing = await this.chambersRepo.findOne({ where: { slug } });
    if (existing) throw new ConflictException(`Câmara com esse nome já existe`);

    const emailExists = await this.usersRepo.findOne({ where: { email: dto.presidenteEmail } });
    if (emailExists) throw new ConflictException(`E-mail "${dto.presidenteEmail}" já está em uso`);

    const chamber = await this.chambersRepo.save(
      this.chambersRepo.create({ slug, name: dto.name, city: dto.city, state: dto.state, logoUrl: dto.logoUrl }),
    );

    const plainPassword = dto.presidentePassword ?? randomBytes(5).toString('hex');
    const passwordHash = await bcrypt.hash(plainPassword, 12);

    const initials = dto.presidenteName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');

    const presidente = this.usersRepo.create({
      chamberId: chamber.id,
      name: dto.presidenteName,
      email: dto.presidenteEmail,
      passwordHash,
      role: 'presidente',
      initials,
      ...(dto.presidenteParty ? { party: dto.presidenteParty } : {}),
    });
    await this.usersRepo.save(presidente);

    return { chamber, presidenteEmail: dto.presidenteEmail, presidentePassword: plainPassword };
  }

  async create(dto: CreateChamberDto): Promise<Chamber> {
    const existing = await this.chambersRepo.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Slug "${dto.slug}" já está em uso`);
    const chamber = this.chambersRepo.create(dto);
    return this.chambersRepo.save(chamber);
  }

  findAll(): Promise<Chamber[]> {
    return this.chambersRepo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Chamber> {
    const chamber = await this.chambersRepo.findOne({ where: { id } });
    if (!chamber) throw new NotFoundException('Câmara não encontrada');
    return chamber;
  }

  /**
   * Suspende (ex.: falta de pagamento) ou reativa a câmara. Suspensa: ninguém dela entra,
   * os logins abertos caem (tokens revogados) e o portal público some. Dados ficam intactos.
   */
  async setStatus(id: string, active: boolean): Promise<Chamber> {
    const chamber = await this.findOne(id);
    if (!active) {
      const running = await this.sessionsRepo.count({ where: { chamberId: id, status: 'em_andamento' } as any });
      if (running) {
        throw new BadRequestException('Há uma sessão em andamento nesta Câmara. Encerre a sessão antes de suspender.');
      }
    }
    chamber.isActive = active;
    const saved = await this.chambersRepo.save(chamber);
    if (!active) {
      // Apaga (não só revoga): um token revogado reapresentado depois da reativação
      // dispararia o alarme de roubo e derrubaria o novo login do usuário.
      await this.chambersRepo.query(
        `DELETE FROM refresh_tokens WHERE "userId" IN (SELECT id FROM users WHERE "chamberId"::text = $1)`,
        [id],
      );
    }
    return saved;
  }

  async update(id: string, dto: Partial<{ name: string; city: string; state: string; logoUrl: string; isActive: boolean }>): Promise<Chamber> {
    const chamber = await this.findOne(id);
    Object.assign(chamber, dto);
    return this.chambersRepo.save(chamber);
  }

  async resetPresidentePassword(chamberId: string): Promise<{ presidenteEmail: string; presidentePassword: string }> {
    const presidente = await this.usersRepo.findOne({ where: { chamberId, role: 'presidente' } });
    if (!presidente) throw new NotFoundException('Presidente não encontrado para esta câmara');

    const plainPassword = randomBytes(5).toString('hex');
    presidente.passwordHash = await bcrypt.hash(plainPassword, 12);
    await this.usersRepo.save(presidente);

    return { presidenteEmail: presidente.email, presidentePassword: plainPassword };
  }

  /** Regras regimentais efetivas (com defaults resolvidos). */
  async getRules(chamberId: string): Promise<ChamberRules> {
    const c = await this.chambersRepo.createQueryBuilder('c')
      .addSelect('c.votingNetworks').where('c.id = :id', { id: chamberId }).getOne();
    if (!c) throw new NotFoundException('Câmara não encontrada');
    const members = await this.usersRepo.count({
      where: [
        { chamberId, isActive: true, role: 'vereador' },
        { chamberId, isActive: true, role: 'presidente' },
        { chamberId, isActive: true, role: 'vice_presidente' },
      ],
    });
    const seats = c.totalSeats ?? members;
    return {
      chamberId,
      seats,
      seatsConfigured: c.totalSeats != null,
      presidentVoteRule: c.presidentVoteRule ?? 'always',
      majorityByType: c.majorityByType ?? {},
      // Padrão: maioria absoluta dos membros presentes para deliberar.
      defaultQuorum: c.defaultQuorum ?? Math.floor(seats / 2) + 1,
      requirePinToVote: !!c.requirePinToVote,
      votingNetworkOnly: !!c.votingNetworkOnly,
      votingNetworks: c.votingNetworks ?? [],
      autoOpenMic: !!c.autoOpenMic,
      sessionPhases: c.sessionPhases?.length ? c.sessionPhases : DEFAULT_PHASES,
    };
  }

  async updateSettings(chamberId: string, dto: ChamberSettingsDto): Promise<ChamberRules> {
    const c = await this.findOne(chamberId);
    if (dto.majorityByType) {
      for (const [type, m] of Object.entries(dto.majorityByType)) {
        if (!['simples', 'absoluta', 'dois_tercos'].includes(m as string) || type.length > 100) {
          throw new BadRequestException(`Maioria inválida para "${type}"`);
        }
      }
    }
    if (dto.sessionPhases) {
      const keys = dto.sessionPhases.map(p => p.key);
      if (new Set(keys).size !== keys.length) throw new BadRequestException("Fases com chave repetida");
    }
    if (dto.votingNetworks) {
      const bad = dto.votingNetworks.find(n => !parseNetwork(n));
      if (bad) throw new BadRequestException(`Rede inválida: "${bad}". Use um IP (200.1.2.3) ou faixa (200.1.2.0/24).`);
      dto.votingNetworks = [...new Set(dto.votingNetworks.map(n => n.trim()))];
    }
    const networks = dto.votingNetworks ?? (await this.getRules(chamberId)).votingNetworks;
    if ((dto.votingNetworkOnly ?? c.votingNetworkOnly) && networks.length === 0) {
      throw new BadRequestException('Informe ao menos uma rede da Câmara antes de restringir a votação.');
    }
    Object.assign(c, dto);
    await this.chambersRepo.save(c);
    return this.getRules(chamberId);
  }

  /**
   * Barreiras antes de votar/registrar presença:
   * - vereador só pelo tablet aprovado (token do app com device), nunca pelo navegador;
   * - com "rede da Câmara" ligada, só a partir dos IPs/faixas cadastrados.
   */
  async assertVotingAccess(user: { role: string; chamberId: string; device?: string | null }, ip: string) {
    if (user.role === 'vereador' && !user.device) {
      throw new ForbiddenException({ statusCode: 403, code: 'DEVICE_REQUIRED', message: 'Voto e presença só pelo tablet autorizado da Câmara.' });
    }
    const rules = await this.getRules(user.chamberId);
    if (rules.votingNetworkOnly && !ipInNetworks(ip, rules.votingNetworks)) {
      throw new ForbiddenException({ statusCode: 403, code: 'NETWORK_NOT_ALLOWED', message: 'Voto e presença só pela rede (Wi-Fi) da Câmara.' });
    }
    return rules;
  }

  async findBySlug(slug: string): Promise<Chamber> {
    const chamber = await this.chambersRepo.findOne({ where: { slug } });
    if (!chamber) throw new NotFoundException('Câmara não encontrada');
    return chamber;
  }

  async findBySlugPublic(slug: string): Promise<{ id: string; name: string; city: string; state: string; logoUrl: string | null; isActive: boolean; requirePinToVote: boolean; hasActiveSession: boolean }> {
    const chamber = await this.chambersRepo.findOne({
      where: { slug },
      select: ['id', 'name', 'city', 'state', 'logoUrl', 'isActive', 'requirePinToVote'],
    });
    if (!chamber) throw new NotFoundException('Câmara não encontrada');

    const active = await this.sessionsRepo.findOne({
      where: { chamberId: chamber.id, status: 'em_andamento' },
      select: ['id'],
    });

    return { ...chamber, hasActiveSession: !!active };
  }

  async listVereadoresBySlug(slug: string): Promise<Array<{ id: string; name: string; initials: string; party: string | null; title: string | null; avatarUrl: string | null; hasPin: boolean; role: string }>> {
    const chamber = await this.chambersRepo.findOne({ where: { slug }, select: ['id'] });
    if (!chamber) throw new NotFoundException('Câmara não encontrada');

    const users = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.pinHash')
      .where('user.chamberId = :chamberId', { chamberId: chamber.id })
      .andWhere('user.isActive = true')
      .andWhere('user.role IN (:...roles)', { roles: ['vereador', 'presidente', 'vice_presidente'] })
      .orderBy('user.name', 'ASC')
      .getMany();

    return sortMesaFirst(users).map(u => ({
      id: u.id,
      name: u.name,
      initials: u.initials,
      party: u.party,
      title: u.title,
      avatarUrl: u.avatarUrl,
      hasPin: !!u.pinHash,
      role: u.role,
    }));
  }
}
