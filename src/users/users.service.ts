import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

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

  findByChamber(chamberId: string): Promise<User[]> {
    return this.usersRepo.find({
      where: { chamberId },
      order: { isActive: 'DESC', name: 'ASC' },
      select: ['id', 'name', 'email', 'username', 'role', 'title', 'party', 'initials', 'avatarUrl', 'isActive', 'lastLoginAt', 'createdAt'],
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id },
      select: ['id', 'name', 'email', 'username', 'role', 'title', 'party', 'initials', 'avatarUrl', 'isActive', 'lastLoginAt', 'chamberId', 'createdAt'],
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

  async adminResetPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado');
    user.passwordHash = newPassword;
    await this.usersRepo.save(user);
  }

  async update(id: string, dto: Partial<{ name: string; email: string; role: string; title: string; party: string; initials: string; avatarUrl: string; isActive: boolean; lastLoginAt: Date }>): Promise<Partial<User>> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
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
