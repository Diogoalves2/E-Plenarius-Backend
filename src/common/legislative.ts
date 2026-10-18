/**
 * Regras legislativas configuráveis por câmara (regimento interno).
 * Funções puras: o mesmo cálculo serve para encerrar votação, verificar integridade e montar a ata.
 */

export type Majority = 'simples' | 'absoluta' | 'dois_tercos';

/**
 * Quando o presidente vota:
 * - always            → vota como qualquer membro
 * - tie_only          → só para desempatar (maioria simples empatada)
 * - tie_and_qualified → desempate + matérias de maioria absoluta / 2/3 (regra comum nas Leis Orgânicas)
 */
export type PresidentVoteRule = 'always' | 'tie_only' | 'tie_and_qualified';

export const MAJORITY_LABEL: Record<Majority, string> = {
  simples: 'maioria simples',
  absoluta: 'maioria absoluta',
  dois_tercos: 'dois terços',
};

export interface SessionPhase { key: string; label: string }

export const DEFAULT_PHASES: SessionPhase[] = [
  { key: 'abertura', label: 'Abertura' },
  { key: 'leitura_ata', label: 'Leitura e votação da ata anterior' },
  { key: 'pequeno_expediente', label: 'Pequeno Expediente' },
  { key: 'grande_expediente', label: 'Grande Expediente' },
  { key: 'ordem_do_dia', label: 'Ordem do Dia' },
  { key: 'explicacoes_pessoais', label: 'Explicações Pessoais' },
  { key: 'encerramento', label: 'Encerramento' },
];

/** Votos SIM necessários para aprovar. Maioria simples: mais SIM que NÃO (abstenção não conta). */
export function requiredVotes(majority: Majority, seats: number, no: number): number {
  switch (majority) {
    case 'absoluta': return Math.floor(seats / 2) + 1;
    case 'dois_tercos': return Math.ceil((seats * 2) / 3);
    default: return no + 1;
  }
}

export interface Decision {
  approved: boolean;
  tie: boolean;
  required: number;
  explanation: string;
}

export function decide(p: { majority: Majority; yes: number; no: number; abstain: number; seats: number }): Decision {
  const required = requiredVotes(p.majority, p.seats, p.no);
  const tie = p.majority === 'simples' && p.yes === p.no;
  const approved = p.yes >= required;
  const base = `${p.yes} SIM, ${p.no} NÃO, ${p.abstain} abstenção(ões)`;
  const explanation = p.majority === 'simples'
    ? `${approved ? 'Aprovado' : 'Rejeitado'} por ${MAJORITY_LABEL.simples}: ${base}${tie ? ' (empate)' : ''}.`
    : `${approved ? 'Aprovado' : 'Rejeitado'} — ${MAJORITY_LABEL[p.majority]} exige ${required} de ${p.seats} membros: ${base}.`;
  return { approved, tie, required, explanation };
}

/** Pode o presidente votar neste item agora? */
export function presidentMayVote(rule: PresidentVoteRule, majority: Majority, yes: number, no: number): boolean {
  if (rule === 'always') return true;
  const tie = majority === 'simples' && yes === no;
  if (rule === 'tie_only') return tie;
  return tie || majority !== 'simples';
}

/**
 * Posição na listagem: Mesa Diretora (presidente, vice, 1º e 2º secretários), depois os demais
 * vereadores; servidores (perfil sem voto) por último.
 */
export function mesaRank(u: { role?: string | null; title?: string | null }): number {
  if (u.role === 'presidente') return 0;
  const t = (u.title ?? '').trim();
  // Pelo perfil ou pelo cargo informado (cadastros antigos têm o cargo só no texto)
  if (u.role === 'vice_presidente' || /^vice[\s-]*presidente/i.test(t)) return 1;
  if (/^1\s*[º°o.]?\s*secret/i.test(t)) return 2;
  if (/^2\s*[º°o.]?\s*secret/i.test(t)) return 3;
  return u.role === 'vereador' ? 4 : 5;
}

/** Ativos antes de inativos; Mesa Diretora primeiro; depois ordem alfabética (pt-BR). */
export function sortMesaFirst<T extends { role?: string | null; title?: string | null; name: string; isActive?: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    Number(b.isActive !== false) - Number(a.isActive !== false)
    || mesaRank(a) - mesaRank(b)
    || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}
