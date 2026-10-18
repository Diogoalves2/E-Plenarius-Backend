import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** ThrottlerGuard só para HTTP — o guard padrão quebra no gateway WebSocket. */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  // req.ip já respeita X-Forwarded-For quando main.ts define 'trust proxy'.
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ip;
  }
}
