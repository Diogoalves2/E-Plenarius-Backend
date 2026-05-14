import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { Session } from '../sessions/entities/session.entity';
import { LoginDto, RefreshTokenDto, MobileLoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
  ) {}

  async login(dto: LoginDto) {
    this.logger.log(`[login] tentativa identifier=${dto.identifier}`);
    let user;
    try {
      user = await this.usersService.findByIdentifierWithPassword(dto.identifier);
    } catch (err: any) {
      this.logger.error(`[login] erro findByIdentifier: ${err?.message}`, err?.stack);
      throw err;
    }
    if (!user) {
      this.logger.warn(`[login] user not found: ${dto.identifier}`);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    let valid: boolean;
    try {
      valid = await user.validatePassword(dto.password);
    } catch (err: any) {
      this.logger.error(`[login] erro validatePassword: ${err?.message}`, err?.stack);
      throw err;
    }
    if (!valid) {
      this.logger.warn(`[login] senha invalida user=${user.id}`);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (!user.isActive) throw new ForbiddenException('Conta desativada');

    try {
      await this.usersService.update(user.id, { lastLoginAt: new Date() });
    } catch (err: any) {
      this.logger.error(`[login] erro updateLastLogin user=${user.id}: ${err?.message}`, err?.stack);
      throw err;
    }

    try {
      return await this.generateTokens(user);
    } catch (err: any) {
      this.logger.error(`[login] erro generateTokens user=${user.id}: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  async mobileLogin(dto: MobileLoginDto) {
    this.logger.log(`[mobile-login] userId=${dto.userId}`);

    const user = await this.usersService.findByIdWithPin(dto.userId);
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    if (!user.isActive) throw new ForbiddenException('Conta desativada');
    if (user.role !== 'vereador' && user.role !== 'presidente') {
      throw new ForbiddenException('Acesso ao app restrito a vereadores e presidente');
    }
    if (!user.pinHash) {
      throw new UnauthorizedException('PIN não cadastrado. Solicite ao presidente.');
    }

    const valid = await user.validatePin(dto.pin);
    if (!valid) throw new UnauthorizedException('PIN incorreto');

    // Regra: vereadores só podem entrar se houver sessão em andamento na câmara.
    // Presidente entra sempre (precisa abrir/gerenciar sessão).
    if (user.role === 'vereador') {
      const activeSession = await this.sessionRepo.findOne({
        where: { chamberId: user.chamberId as string, status: 'em_andamento' },
      });
      if (!activeSession) {
        throw new ForbiddenException('Sem sessão em andamento. Aguarde o presidente abrir a sessão para entrar.');
      }
    }

    // Single-device session: gera novo deviceId e invalida o token anterior
    // (qualquer outro tablet com o token antigo será deslogado no próximo request).
    const deviceId = randomUUID();
    user.mobileDeviceId = deviceId;
    user.lastLoginAt = new Date();
    await this.usersService.saveRaw(user);

    // Revoga todos os refresh tokens existentes para forçar o outro device a relogar.
    await this.refreshTokenRepo.update({ userId: user.id, revoked: false }, { revoked: true });

    return this.generateTokens(user, deviceId);
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

  private async generateTokens(user: any, mobileDevice?: string) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      chamberId: user.chamberId,
      ...(mobileDevice ? { mobileDevice } : {}),
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
