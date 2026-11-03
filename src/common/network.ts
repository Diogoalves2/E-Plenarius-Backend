import { BlockList, isIP } from 'net';

/** "::ffff:200.1.2.3" (IPv4 dentro de IPv6, comum atrás de proxy) → "200.1.2.3". */
export function normalizeIp(ip: string | undefined | null): string {
  const v = (ip ?? '').trim();
  return v.toLowerCase().startsWith('::ffff:') && isIP(v.slice(7)) === 4 ? v.slice(7) : v;
}

/** Aceita IP único (200.1.2.3, 2804:...:1) ou faixa CIDR (200.1.2.0/24, 2804:abcd::/48). */
export function parseNetwork(raw: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [addr, bits] = raw.trim().split('/');
  const fam = isIP(addr);
  if (!fam) return null;
  const max = fam === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < (fam === 4 ? 8 : 16) || prefix > max) return null;
  return { address: addr, prefix, family: fam === 4 ? 'ipv4' : 'ipv6' };
}

export function ipInNetworks(ip: string, networks: string[]): boolean {
  const addr = normalizeIp(ip);
  const fam = isIP(addr);
  if (!fam) return false;
  const list = new BlockList();
  for (const n of networks) {
    const p = parseNetwork(n);
    if (p) list.addSubnet(p.address, p.prefix, p.family);
  }
  return list.check(addr, fam === 4 ? 'ipv4' : 'ipv6');
}
