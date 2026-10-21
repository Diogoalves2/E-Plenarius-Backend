import { createHmac, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238): código de 6 dígitos que muda a cada 30 s, o mesmo do Google/Microsoft
 * Authenticator. HMAC-SHA1 porque é o único algoritmo que todos os apps aceitam.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / PERIOD);
}

/**
 * Aceita o passo atual e um vizinho (relógio do celular adiantado/atrasado até 30 s).
 * Passos já usados (≤ lastStep) são recusados: o mesmo código não serve duas vezes.
 * Retorna o passo aceito ou null.
 */
export function verifyTotp(key: Buffer, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'E-Plenarius'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD}`;
}
