import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

/**
 * Bloqueio após tentativas erradas de senha/PIN (login e confirmação de voto).
 * Em memória — o backend roda em instância única.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  static readonly MAX_FAILURES = 5;
  static readonly LOCK_MS = 5 * 60 * 1000;

  assertNotLocked(key: string) {
    const entry = this.failures.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      const min = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      throw new HttpException(
        `Muitas tentativas incorretas. Tente novamente em ${min} min.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  registerFailure(key: string) {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) entry.count = 0;
    entry.count += 1;
    if (entry.count >= LoginAttemptsService.MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LoginAttemptsService.LOCK_MS;
      this.logger.warn(`bloqueado ${key} por ${LoginAttemptsService.LOCK_MS / 60000} min`);
    }
    this.failures.set(key, entry);
  }

  clear(key: string) {
    this.failures.delete(key);
  }
}
