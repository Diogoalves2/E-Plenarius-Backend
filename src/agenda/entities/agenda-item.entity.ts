import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { Majority } from '../../common/legislative';
import { Session } from '../../sessions/entities/session.entity';
import { User } from '../../users/entities/user.entity';

export type AgendaItemStatus = 'pendente' | 'em_votacao' | 'aprovado' | 'rejeitado' | 'retirado';
export type VotingType = 'aberta' | 'secreta';

@Entity('agenda_items')
export class AgendaItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column()
  chamberId: string;

  @Column()
  number: string;

  @Column()
  type: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  pdfUrl: string;

  @Column()
  authorName: string;

  @Column({ nullable: true })
  authorUserId: string;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'authorUserId' })
  authorUser: User;

  @Column({ type: 'varchar', default: 'aberta' })
  votingType: VotingType;

  @Column({ default: 5 })
  quorumMinimum: number;

  @Column({ type: 'varchar', default: 'simples' })
  majority: Majority;

  /** Votos SIM exigidos, calculado no encerramento (entra no resultHash). */
  @Column({ type: 'int', nullable: true })
  requiredVotes: number | null;

  /** Texto do resultado para ata/portal (ex.: "Aprovado — maioria absoluta exige 5 de 9..."). */
  @Column({ type: 'text', nullable: true })
  resultExplanation: string | null;

  @Column({ default: 0 })
  orderIndex: number;

  @Column({ type: 'varchar', default: 'pendente' })
  status: AgendaItemStatus;

  @Column({ nullable: true })
  votingOpenedAt: Date;

  @Column({ nullable: true })
  votingClosedAt: Date;

  @Column({ nullable: true })
  votesYes: number;

  @Column({ nullable: true })
  votesNo: number;

  @Column({ nullable: true })
  votesAbstain: number;

  /** Hash do resultado (placar + último elo da cadeia de votos). Vai impresso na ata. */
  @Column({ nullable: true })
  resultHash: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
