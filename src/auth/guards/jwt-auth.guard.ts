import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  private isPublic(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isPublic(context)) return super.canActivate(context) as Promise<boolean>;

    // Rota pública: autentica se houver token (req.user preenchido), mas nunca bloqueia.
    const req = context.switchToHttp().getRequest();
    if (!req.headers?.authorization) return true;
    try {
      await super.canActivate(context);
    } catch { /* token inválido em rota pública = visitante */ }
    return true;
  }

  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    if (this.isPublic(context)) return user || null;
    if (err || !user) throw err || new UnauthorizedException();
    return user;
  }
}
