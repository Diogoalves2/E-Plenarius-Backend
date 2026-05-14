import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  chamberId: string;
  /** Quando presente, indica token emitido pelo app mobile (uuid do device atual). */
  mobileDevice?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) throw new UnauthorizedException();

    // Token do app mobile: valida que o device atual ainda é este.
    // Se o usuário fez login em outro tablet, o mobileDeviceId no banco mudou
    // e este token deve ser invalidado.
    if (payload.mobileDevice) {
      const user = await this.usersService.findRawById(payload.sub);
      if (!user || user.mobileDeviceId !== payload.mobileDevice) {
        throw new UnauthorizedException('Sessão encerrada: este usuário fez login em outro dispositivo.');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      chamberId: payload.chamberId,
    };
  }
}
