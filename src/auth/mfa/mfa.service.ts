import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes } from 'crypto';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { LoginAttemptsService } from '../../common/access/login-attempts.service';
import { sha256 } from '../../common/integrity';
import { decryptSecret, encryptSecret, secretBoxAvailable } from '../../common/secret-box';
import { base32Encode, otpauthUrl, verifyTotp } from './totp';

/** Perfis do painel web com 2FA obrigatória. Vereadores (tablet) usam PIN + tablet aprovado. */
export const MFA_ROLES = ['superadmin', 'presidente'];

const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem 0/o, 1/l/i

type MfaUser = Pick<User, 'id' | 'email' | 'role' | 'chamberId' | 'mfaSecret' | 'mfaPendingSecret' | 'mfaEnabledAt' | 'mfaLastStep' | 'mfaRecoveryCodes'>;

@Injectable()
export class MfaService {
  /** Tokens de desafio/confiança assinados com segredo próprio: nunca valem como access token. */
  private readonly tokenSecret: string;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly attempts: LoginAttemptsService,
  ) {
    this.tokenSecret = createHmac('sha256', config.get<string>('JWT_SECRET') ?? '')
      .update('eplenarius-mfa-token-v1').digest('hex');
  }

  requiresMfa(role: string): boolean {
    return MFA_ROLES.includes(role);
  }

  private async load(userId: string): Promise<MfaUser> {
    const u = await this.users.createQueryBuilder('u')
      .addSelect(['u.mfaSecret', 'u.mfaPendingSecret', 'u.mfaLastStep', 'u.mfaRecoveryCodes'])
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return u;
  }

  private async trail(u: Pick<User, 'id' | 'chamberId'>, action: string, actorId?: string, ip?: string) {
    if (!u.chamberId) return; // superadmin não tem câmara (sem trilha)
    await this.audit.log({ chamberId: u.chamberId, userId: actorId ?? u.id, action, targetType: 'user', targetId: u.id, ipAddress: ip });
  }

  // ── Tokens curtos do fluxo de login ──

  /** Senha correta, falta o segundo fator: vale 5 min e só para os endpoints /auth/mfa/*. */
  challenge(userId: string): string {
    return this.jwt.sign({ sub: userId, purpose: 'mfa' }, { secret: this.tokenSecret, expiresIn: '5m' });
  }

  readChallenge(token: string): string {
    try {
      const p = this.jwt.verify(token, { secret: this.tokenSecret });
      if (p.purpose !== 'mfa' || !p.sub) throw new Error();
      return p.sub;
    } catch {
      throw new UnauthorizedException('Etapa de verificação expirada. Entre novamente com a senha.');
    }
  }

  /** "Confiar neste computador": 30 dias, invalidado se a 2FA for redefinida. */
  trustToken(u: Pick<User, 'id' | 'mfaEnabledAt'>): string {
    return this.jwt.sign(
      { sub: u.id, purpose: 'mfa-trust', v: u.mfaEnabledAt?.getTime() ?? 0 },
      { secret: this.tokenSecret, expiresIn: '30d' },
    );
  }

  trustValid(token: string | undefined, u: Pick<User, 'id' | 'mfaEnabledAt'>): boolean {
    if (!token || !u.mfaEnabledAt) return false;
    try {
      const p = this.jwt.verify(token, { secret: this.tokenSecret });
      return p.purpose === 'mfa-trust' && p.sub === u.id && p.v === u.mfaEnabledAt.getTime();
    } catch {
      return false;
    }
  }

  // ── Cadastro ──

  async setup(userId: string) {
    if (!secretBoxAvailable()) throw new ServiceUnavailableException('2FA indisponível: chave de cifra não configurada no servidor.');
    const u = await this.load(userId);
    if (!this.requiresMfa(u.role)) throw new ForbiddenException('2FA não se aplica a este perfil.');
    if (u.mfaEnabledAt) throw new ConflictException('A verificação em duas etapas já está ativa.');
    const secret = randomBytes(20);
    await this.users.update(u.id, { mfaPendingSecret: encryptSecret(secret) });
    const b32 = base32Encode(secret);
    return { secret: b32, otpauthUrl: otpauthUrl(b32, u.email) };
  }

  async enable(userId: string, code: string, ip?: string) {
    const u = await this.load(userId);
    if (u.mfaEnabledAt) throw new ConflictException('A verificação em duas etapas já está ativa.');
    if (!u.mfaPendingSecret) throw new ConflictException('Leia o QR code antes de confirmar.');
    const key = `mfa:${u.id}`;
    this.attempts.assertNotLocked(key);
    const step = verifyTotp(decryptSecret(u.mfaPendingSecret), code.trim(), null);
    if (step == null) {
      this.attempts.registerFailure(key);
      throw new UnauthorizedException('Código incorreto. Confira o horário do celular e tente o código atual.');
    }
    this.attempts.clear(key);
    const { codes, hashes } = this.newRecoveryCodes();
    const enabledAt = new Date();
    await this.users.update(u.id, {
      mfaSecret: u.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: enabledAt,
      mfaLastStep: step, mfaRecoveryCodes: hashes,
    });
    await this.trail(u, 'auth:mfa_enabled', undefined, ip);
    return { recoveryCodes: codes, mfaEnabledAt: enabledAt };
  }

  // ── Login ──

  /** Confere código do app ou de recuperação. Erros contam para o bloqueio (5 → 5 min). */
  async verify(userId: string, rawCode: string, ip?: string): Promise<'totp' | 'recovery'> {
    const u = await this.load(userId);
    if (!u.mfaEnabledAt || !u.mfaSecret) throw new UnauthorizedException('Verificação em duas etapas não configurada.');
    const key = `mfa:${u.id}`;
    this.attempts.assertNotLocked(key);
    const code = rawCode.trim();

    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(decryptSecret(u.mfaSecret), code, u.mfaLastStep ?? null);
      if (step != null) {
        // Condicional: dois logins simultâneos com o mesmo código não passam os dois.
        const r = await this.users.createQueryBuilder().update(User)
          .set({ mfaLastStep: step })
          .where('id = :id AND ("mfaLastStep" IS NULL OR "mfaLastStep" < :step)', { id: u.id, step })
          .execute();
        if (r.affected) {
          this.attempts.clear(key);
          return 'totp';
        }
      }
    } else {
      const h = sha256(code.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const left = u.mfaRecoveryCodes ?? [];
      if (left.includes(h)) {
        await this.users.update(u.id, { mfaRecoveryCodes: left.filter(x => x !== h) });
        this.attempts.clear(key);
        await this.trail(u, 'auth:mfa_recovery_used', undefined, ip);
        return 'recovery';
      }
    }
    this.attempts.registerFailure(key);
    throw new UnauthorizedException('Código incorreto.');
  }

  // ── Gestão ──

  async status(userId: string) {
    const u = await this.load(userId);
    return {
      required: this.requiresMfa(u.role),
      enabled: !!u.mfaEnabledAt,
      enabledAt: u.mfaEnabledAt,
      recoveryCodesLeft: u.mfaRecoveryCodes?.length ?? 0,
    };
  }

  async regenerateRecovery(userId: string, code: string, ip?: string) {
    await this.verify(userId, code, ip);
    const u = await this.load(userId);
    const { codes, hashes } = this.newRecoveryCodes();
    await this.users.update(u.id, { mfaRecoveryCodes: hashes });
    await this.trail(u, 'auth:mfa_recovery_regenerated', undefined, ip);
    return { recoveryCodes: codes };
  }

  /** Celular perdido: apaga a 2FA e derruba as sessões web. No próximo login, cadastra de novo. */
  async reset(targetId: string, actorId: string, ip?: string) {
    const u = await this.load(targetId);
    await this.users.update(u.id, {
      mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: null,
    });
    await this.users.query(
      `UPDATE refresh_tokens SET revoked = true WHERE "userId" = $1 AND "mobileDevice" IS NULL AND revoked = false`,
      [u.id],
    );
    await this.trail(u, 'auth:mfa_reset', actorId, ip);
    return { ok: true };
  }

  private newRecoveryCodes() {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      const bytes = randomBytes(8);
      const raw = Array.from(bytes, b => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
      codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    }
    return { codes, hashes: codes.map(c => sha256(c.replace('-', ''))) };
  }

}
