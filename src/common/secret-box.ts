import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Cifra AES-256-GCM para segredos guardados no banco (ex.: segredo da 2FA).
 * A chave vem do ambiente da API (MFA_ENC_KEY, ou derivada da AUDIT_HMAC_KEY via HKDF),
 * nunca do banco: um dump/backup vazado não revela os segredos.
 */
function key(): Buffer | null {
  const base = process.env.MFA_ENC_KEY || process.env.AUDIT_HMAC_KEY;
  if (!base || base.length < 32) return null;
  return Buffer.from(hkdfSync('sha256', base, 'eplenarius', 'mfa-secret-v1', 32));
}

export function secretBoxAvailable(): boolean {
  return key() !== null;
}

export function encryptSecret(plain: Buffer): string {
  const k = key();
  if (!k) throw new Error('Chave de cifra ausente (MFA_ENC_KEY/AUDIT_HMAC_KEY)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(box: string): Buffer {
  const k = key();
  if (!k) throw new Error('Chave de cifra ausente (MFA_ENC_KEY/AUDIT_HMAC_KEY)');
  const [v, iv, tag, ct] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Formato de segredo inválido');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
}
