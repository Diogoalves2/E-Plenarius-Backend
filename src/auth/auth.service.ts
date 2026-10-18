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
import { randomBytes, randomUUID } from 'crypto';
import { sha256 } from '../common/integrity';
import { DevicesService } from '../devices/devices.service';
import { LoginAttemptsService } from '../common/access/login-attempts.service';
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
    private readonly devices: DevicesService,
    private readonly attempts: LoginAttemptsService,
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

    this.attempts.assertNotLocked(`pwd:${user.id}`);
    let valid: boolean;
    try {
      valid = await user.validatePassword(dto.password);
    } catch (err: any) {
      this.logger.error(`[login] erro validatePassword: ${err?.message}`, err?.stack);
      throw err;
    }
    if (!valid) {
      this.logger.warn(`[login] senha invalida user=${user.id}`);
      this.attempts.registerFailure(`pwd:${user.id}`);
      throw new UnauthorizedException('Credenciais inválidas');
    }
    this.attempts.clear(`pwd:${user.id}`);

    if (!user.isActive) throw new ForbiddenException('Conta desativada');

    // Vereador só entra se houver sessão em andamento.
    // Presidente, secretaria e superadmin sempre.
    if (user.role === 'vereador') {
      const activeSession = await this.sessionRepo.findOne({
        where: { chamberId: user.chamberId as string, status: 'em_andamento' },
      });
      if (!activeSession) {
        throw new ForbiddenException('Sem sessão em andamento. Aguarde o presidente abrir a sessão para entrar.');
      }
    }

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
    if (!['vereador', 'presidente', 'vice_presidente'].includes(user.role)) {
      throw new ForbiddenException('Acesso ao app restrito a vereadores e presidente');
    }
    if (!user.pinHash) {
      throw new UnauthorizedException('PIN não cadastrado. Solicite ao presidente.');
    }

    this.attempts.assertNotLocked(`pin:${user.id}`);

    // Tablet precisa estar cadastrado e aprovado pelo presidente da câmara.
    const device = await this.devices.findByKey(dto.deviceKey);
    if (device && device.chamberId !== user.chamberId) {
      throw new ForbiddenException('Este tablet está registrado em outra câmara.');
    }
    if (device?.status === 'revogado') {
      throw new ForbiddenException(`Este tablet (código ${device.code}) foi bloqueado. Procure o presidente da câmara.`);
    }
    if (device?.status === 'pendente') {
      throw new ForbiddenException(this.pendingMessage(device.code));
    }

    const valid = await user.validatePin(dto.pin);
    if (!valid) {
      this.attempts.registerFailure(`pin:${user.id}`);
      throw new UnauthorizedException('PIN incorreto');
    }
    this.attempts.clear(`pin:${user.id}`);

    // Tablet novo + PIN correto: registra como pendente. Só entra depois da aprovação.
    if (!device) {
      const created = await this.devices.createPending(user.chamberId as string, dto.deviceKey, dto.deviceName, user.id);
      this.logger.warn(`[mobile-login] tablet novo ${created.code} aguardando aprovação (user=${user.id})`);
      throw new ForbiddenException(this.pendingMessage(created.code));
    }

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

    // Single-device session: novo mobileDevice invalida tokens mobile antigos no próximo
    // request (JwtStrategy compara com users.mobileDeviceId). Sessão web não é afetada.
    const mobileDevice = randomUUID();
    user.mobileDeviceId = mobileDevice;
    user.lastLoginAt = new Date();
    await this.usersService.saveRaw(user);
    await this.devices.touch(device.id, user.id);

    return this.generateTokens(user, { mobileDevice, deviceId: device.id });
  }

  private pendingMessage(code: string) {
    return `Tablet não autorizado (código ${code}). Peça ao presidente para aprovar este código em Dispositivos, no painel web.`;
  }

  async refresh(dto: RefreshTokenDto) {
    const stored = await this.refreshTokenRepo.findOne({
      where: { token: sha256(dto.refreshToken) },
      relations: ['user'],
    });
    if (!stored) throw new UnauthorizedException('Refresh token inválido ou expirado');

    // Token já usado sendo reapresentado = provável roubo: revoga tudo do usuário.
    if (stored.revoked) {
      this.logger.warn(`[refresh] reuso de token revogado user=${stored.userId} — revogando todos`);
      await this.refreshTokenRepo.update({ userId: stored.userId, revoked: false }, { revoked: true });
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }
    if (stored.expiresAt < new Date() || !stored.user?.isActive) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    if (stored.mobileDevice) {
      if (stored.user.mobileDeviceId !== stored.mobileDevice) {
        throw new UnauthorizedException('Sessão encerrada: este usuário fez login em outro dispositivo.');
      }
      if (stored.deviceId && !(await this.devices.isApproved(stored.deviceId))) {
        throw new UnauthorizedException('Sessão encerrada: tablet bloqueado pelo presidente.');
      }
    }

    // Rotate: revoke old, issue new (mantendo o vínculo com o tablet)
    stored.revoked = true;
    await this.refreshTokenRepo.save(stored);

    return this.generateTokens(stored.user, {
      mobileDevice: stored.mobileDevice ?? undefined,
      deviceId: stored.deviceId ?? undefined,
    });
  }

  async logout(userId: string) {
    await this.refreshTokenRepo.update({ userId, revoked: false }, { revoked: true });
    return { message: 'Logout realizado com sucesso' };
  }

  private refreshTtlMs(): number {
    const raw = String(this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'));
    const m = /^(\d+)\s*([dhm])$/.exec(raw);
    if (!m) return 7 * 24 * 3600 * 1000;
    const unit = { d: 24 * 3600 * 1000, h: 3600 * 1000, m: 60 * 1000 }[m[2] as 'd' | 'h' | 'm'];
    return Number(m[1]) * unit;
  }

  private async generateTokens(user: any, mobile?: { mobileDevice?: string; deviceId?: string }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      chamberId: user.chamberId,
      ...(mobile?.mobileDevice ? { mobileDevice: mobile.mobileDevice } : {}),
      ...(mobile?.deviceId ? { device: mobile.deviceId } : {}),
    };

    const accessToken = this.jwtService.sign(payload);

    const expiresAt = new Date(Date.now() + this.refreshTtlMs());
    const refreshToken = randomBytes(32).toString('base64url');
    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId: user.id,
        token: sha256(refreshToken),
        expiresAt,
        mobileDevice: mobile?.mobileDevice ?? null,
        deviceId: mobile?.deviceId ?? null,
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
