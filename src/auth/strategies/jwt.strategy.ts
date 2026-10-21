import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { DevicesService } from '../../devices/devices.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  chamberId: string;
  /** Quando presente, indica token emitido pelo app mobile (uuid do device atual). */
  mobileDevice?: string;
  /** Id do tablet aprovado (tabela devices) usado no login mobile. */
  device?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly devices: DevicesService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || (payload as any).purpose) throw new UnauthorizedException();

    // Conta desativada perde o acesso na hora (sem esperar o token expirar).
    const user = await this.usersService.findRawById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('Conta desativada');

    // Token do app mobile: valida que o device atual ainda é este.
    // Se o usuário fez login em outro tablet, o mobileDeviceId no banco mudou
    // e este token deve ser invalidado.
    if (payload.mobileDevice && user.mobileDeviceId !== payload.mobileDevice) {
      throw new UnauthorizedException('Sessão encerrada: este usuário fez login em outro dispositivo.');
    }
    if (payload.device && !(await this.devices.isApproved(payload.device))) {
      throw new UnauthorizedException('Sessão encerrada: tablet bloqueado pelo presidente.');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      chamberId: payload.chamberId,
    };
  }
}
