import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Selo HMAC dos registros de integridade (auditoria, votos, resultado).
 *
 * O hash encadeado prova que nada mudou DEPOIS de gravado, mas quem tem acesso ao banco
 * poderia reescrever a cadeia inteira recalculando os hashes. O selo usa uma chave que fica
 * só no ambiente da API (AUDIT_HMAC_KEY no .env.prod), fora do banco e dos backups:
 * sem ela não dá para forjar um registro que passe na verificação.
 *
 * `kind` separa os domínios — o selo de um voto nunca serve como selo de auditoria.
 */
export type SealKind = 'audit' | 'vote' | 'result' | 'checkpoint';

function key(): string | null {
  const k = process.env.AUDIT_HMAC_KEY;
  return k && k.length >= 32 ? k : null;
}

export function sealEnabled(): boolean {
  return key() !== null;
}

export function seal(kind: SealKind, value: string): string | null {
  const k = key();
  return k ? createHmac('sha256', k).update(`${kind}:${value}`).digest('hex') : null;
}

export function sealMatches(kind: SealKind, value: string, given: string | null | undefined): boolean {
  const expected = seal(kind, value);
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
