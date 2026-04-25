import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByIdentifierWithPassword(dto.identifier);
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const valid = await user.validatePassword(dto.password);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas');

    if (!user.isActive) throw new ForbiddenException('Conta desativada');

    await this.usersService.update(user.id, { lastLoginAt: new Date() });

    return this.generateTokens(user);
  }

  async refresh(dto: RefreshTokenDto) {
    const stored = await this.refreshTokenRepo.findOne({
      where: { token: dto.refreshToken, revoked: false },
      relations: ['user'],
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    // Rotate: revoke old, issue new
    stored.revoked = true;
    await this.refreshTokenRepo.save(stored);

    return this.generateTokens(stored.user);
  }

  async logout(userId: string) {
    await this.refreshTokenRepo.update({ userId, revoked: false }, { revoked: true });
    return { message: 'Logout realizado com sucesso' };
  }

  private async generateTokens(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      chamberId: user.chamberId,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshExpiresIn = this.config.get('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const refreshToken = randomUUID();
    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId: user.id,
        token: refreshToken,
        expiresAt,
      }),
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        chamberId: user.chamberId,
        initials: user.initials,
        party: user.party,
        avatarUrl: user.avatarUrl ?? null,
      },
    };
  }
}
