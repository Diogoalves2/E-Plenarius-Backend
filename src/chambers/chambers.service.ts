import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Chamber } from './entities/chamber.entity';
import { User } from '../users/entities/user.entity';
import { CreateChamberDto } from './dto/create-chamber.dto';
import { SetupChamberDto } from './dto/setup-chamber.dto';

@Injectable()
export class ChambersService {
  constructor(
    @InjectRepository(Chamber)
    private readonly chambersRepo: Repository<Chamber>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
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

  async findBySlug(slug: string): Promise<Chamber> {
    const chamber = await this.chambersRepo.findOne({ where: { slug } });
    if (!chamber) throw new NotFoundException('Câmara não encontrada');
    return chamber;
  }
}
