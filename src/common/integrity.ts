import { createHash } from 'crypto';

/** JSON com chaves ordenadas — o jsonb do Postgres reordena chaves, então o hash precisa ser canônico. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export const GENESIS_HASH = '0'.repeat(64);

interface CountsLike {
  votingType: string;
  status: string;
  votesYes: number | null;
  votesNo: number | null;
  votesAbstain: number | null;
}

/**
 * Votação secreta em andamento: o placar parcial não pode sair da API.
 * Quem acompanha o placar subindo a cada voto (com o nome de quem votou) descobriria a escolha.
 * Retorna só o total de votos; o placar aparece ao encerrar.
 */
export function maskSecretCounts<T extends CountsLike>(item: T): T & { votesTotal: number; countsHidden: boolean } {
  const total = (item.votesYes ?? 0) + (item.votesNo ?? 0) + (item.votesAbstain ?? 0);
  if (item.votingType === 'secreta' && item.status === 'em_votacao') {
    return { ...item, votesYes: null, votesNo: null, votesAbstain: null, votesTotal: total, countsHidden: true };
  }
  return { ...item, votesTotal: total, countsHidden: false };
}
