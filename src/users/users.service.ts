import { Injectable, NotFoundException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { sortMesaFirst } from '../common/legislative';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<Partial<User>> {
    const existing = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    if (dto.username) {
      const existingUsername = await this.usersRepo.findOne({
        where: { username: dto.username.toLowerCase() },
      });
      if (existingUsername) throw new ConflictException('Nome de usuário já em uso');
    }

    const user = this.usersRepo.create({
      chamberId: dto.chamberId,
      name: dto.name,
      email: dto.email,
      username: dto.username ? dto.username.toLowerCase() : null,
      passwordHash: dto.password,
      role: dto.role,
      title: dto.title,
      party: dto.party,
      initials: dto.initials || this.extractInitials(dto.name),
      avatarUrl: dto.avatarUrl,
    });

    const saved = await this.usersRepo.save(user);
    const { passwordHash, ...result } = saved;
    return result;
  }

  async findByChamber(chamberId: string): Promise<User[]> {
    const users = await this.usersRepo.find({
      where: { chamberId },
      select: ['id', 'name', 'email', 'username', 'role', 'title', 'party', 'initials', 'avatarUrl', 'isActive', 'lastLoginAt', 'audioChannel', 'createdAt'],
    });
    return sortMesaFirst(users);
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id },
      select: ['id', 'name', 'email', 'username', 'role', 'title', 'party', 'initials', 'avatarUrl', 'isActive', 'lastLoginAt', 'audioChannel', 'chamberId', 'createdAt'],
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByIdentifierWithPassword(identifier: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:id) OR LOWER(user.username) = LOWER(:id)', { id: identifier })
      .getOne();
  }

  async findRawById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } });
  }

  async saveRaw(user: User): Promise<User> {
    return this.usersRepo.save(user);
  }

  async findByIdWithPin(id: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.pinHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async setAudioChannel(userId: string, channel: number | null): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    user.audioChannel = channel;
    await this.usersRepo.save(user);
  }

  async setPin(userId: string, pin: string | null): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.pinHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado');
    user.pinHash = pin;
    // PIN novo derruba a sessão atual do app (token mobile + refresh mobile).
    user.mobileDeviceId = null;
    await this.usersRepo.save(user);
    await this.usersRepo.query(
      `UPDATE refresh_tokens SET revoked = true WHERE "userId" = $1 AND "mobileDevice" IS NOT NULL AND revoked = false`,
      [userId],
    );
  }

  /** Troca de senha encerra todas as sessões (web e app). */
  private async revokeAllSessions(userId: string): Promise<void> {
    await this.usersRepo.query(
      `UPDATE refresh_tokens SET revoked = true WHERE "userId" = $1 AND revoked = false`,
      [userId],
    );
    await this.usersRepo.update(userId, { mobileDeviceId: null });
  }

  async adminResetPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado');
    user.passwordHash = newPassword;
    await this.usersRepo.save(user);
    await this.revokeAllSessions(userId);
  }

  async update(id: string, dto: Partial<{ name: string; email: string; role: string; title: string; party: string; initials: string; avatarUrl: string; isActive: boolean; lastLoginAt: Date }>): Promise<Partial<User>> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);
    const { passwordHash, ...result } = saved as any;
    return result;
  }

  /** Superadmin gerencia qualquer um; presidente só membros da própria câmara (nunca superadmin). */
  async assertCanManage(actor: { id: string; role: string; chamberId: string | null }, targetId: string): Promise<void> {
    if (actor.role === 'superadmin') return;
    const target = await this.usersRepo.findOne({ where: { id: targetId }, select: ['id', 'chamberId', 'role'] });
    if (!target) throw new NotFoundException('Usuário não encontrado');
    if (!actor.chamberId || target.chamberId !== actor.chamberId || target.role === 'superadmin') {
      throw new ForbiddenException('Sem permissão para gerenciar este usuário');
    }
  }

  async updateProfile(id: string, dto: UpdateUserDto): Promise<Partial<User>> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (dto.email !== undefined && dto.email !== user.email) {
      const existing = await this.usersRepo.findOne({ where: { email: dto.email } });
      if (existing && existing.id !== id) throw new ConflictException('E-mail já cadastrado');
    }
    if (dto.username !== undefined) {
      dto.username = dto.username?.trim().toLowerCase() || null;
      if (dto.username) {
        const existing = await this.usersRepo.findOne({ where: { username: dto.username } });
        if (existing && existing.id !== id) throw new ConflictException('Nome de usuário já em uso');
      }
    }

    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);
    const { passwordHash, ...result } = saved as any;
    return result;
  }

  async updateMe(userId: string, dto: { username?: string }): Promise<Partial<User>> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (dto.username !== undefined) {
      const normalized = dto.username?.trim().toLowerCase() || null;
      if (normalized) {
        const existing = await this.usersRepo.findOne({ where: { username: normalized } });
        if (existing && existing.id !== userId) throw new ConflictException('Nome de usuário já em uso');
      }
      user.username = normalized;
    }

    const saved = await this.usersRepo.save(user);
    const { passwordHash, ...result } = saved as any;
    return result;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const valid = await user.validatePassword(currentPassword);
    if (!valid) throw new UnauthorizedException('Senha atual incorreta');

    user.passwordHash = newPassword;
    await this.usersRepo.save(user);
    await this.revokeAllSessions(userId);
  }

  private extractInitials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('');
  }
}
