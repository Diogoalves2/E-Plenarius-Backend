import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ChamberAccessService } from './chamber-access.service';

/** Rotas com :sessionId — usuário autenticado só opera sessões da própria câmara. Rotas @Public passam. */
@Injectable()
export class SessionChamberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ChamberAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest();
    const sessionId = req.params?.sessionId;
    if (sessionId) await this.access.assertSession(req.user, sessionId);
    return true;
  }
}
