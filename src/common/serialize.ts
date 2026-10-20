/**
 * Campos de usuário que podem sair em respostas públicas, eventos do telão e listas.
 * Nunca: e-mail, username, mobileDeviceId, último acesso, canal de áudio, hashes.
 */
export interface PublicUser {
  id: string;
  name: string;
  party: string | null;
  title: string | null;
  role: string;
  initials: string | null;
  avatarUrl: string | null;
}

export function toPublicUser(u: any): PublicUser | null {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    party: u.party ?? null,
    title: u.title ?? null,
    role: u.role,
    initials: u.initials ?? null,
    avatarUrl: u.avatarUrl ?? null,
  };
}

/** Substitui a relação `key` (ex.: user, authorUser) pela versão pública. */
export function withPublicUser<T extends Record<string, any>>(obj: T, key: keyof T & string): T {
  if (!obj || !(key in obj)) return obj;
  return { ...obj, [key]: toPublicUser(obj[key]) };
}
