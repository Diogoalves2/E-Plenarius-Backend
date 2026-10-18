import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Majority, PresidentVoteRule, SessionPhase } from '../../common/legislative';

@Entity('chambers')
export class Chamber {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column()
  city: string;

  @Column({ length: 2 })
  state: string;

  @Column({ nullable: true })
  logoUrl: string;

  @Column({ nullable: true, type: 'int' })
  legislaturaInicio: number | null;

  @Column({ nullable: true, type: 'int' })
  legislaturaFim: number | null;

  @Column({ nullable: true, type: 'int' })
  bienioInicio: number | null;

  @Column({ nullable: true, type: 'int' })
  bienioFim: number | null;

  @Column({ nullable: true, type: 'int' })
  anoBienio: number | null;

  @Column({ default: true })
  isActive: boolean;

  // ── Regimento (configurável pelo presidente) ─────────────────────────────

  /** Número de cadeiras (membros da Casa): base da maioria absoluta e de 2/3. Null = conta membros ativos. */
  @Column({ type: 'int', nullable: true })
  totalSeats: number | null;

  @Column({ type: 'varchar', default: 'always' })
  presidentVoteRule: PresidentVoteRule;

  /** Maioria padrão por tipo de matéria (ex.: { "Emenda à Lei Orgânica": "dois_tercos" }). */
  @Column({ type: 'jsonb', nullable: true })
  majorityByType: Record<string, Majority> | null;

  /** Quórum padrão (presentes) para abrir votação. */
  @Column({ type: 'int', nullable: true })
  defaultQuorum: number | null;

  /** Exige o PIN do vereador para confirmar cada voto. */
  @Column({ default: false })
  requirePinToVote: boolean;

  /** Abre o microfone na mesa de som ao liberar o tempo de fala (bridge). */
  @Column({ default: false })
  autoOpenMic: boolean;

  /** Fases do roteiro da sessão. Null = roteiro padrão. */
  @Column({ type: 'jsonb', nullable: true })
  sessionPhases: SessionPhase[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
