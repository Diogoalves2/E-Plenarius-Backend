import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, Unique,
} from 'typeorm';
import { AgendaItem } from '../../agenda/entities/agenda-item.entity';
import { User } from '../../users/entities/user.entity';
import { Session } from '../../sessions/entities/session.entity';

export type VoteChoice = 'sim' | 'nao' | 'abstencao';

@Entity('votes')
@Unique(['agendaItemId', 'userId'])
export class Vote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => Session)
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column()
  agendaItemId: string;

  @ManyToOne(() => AgendaItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agendaItemId' })
  agendaItem: AgendaItem;

  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  chamberId: string;

  /** Em votação secreta grava 'secreta' — a escolha individual nunca é persistida. */
  @Column({ type: 'varchar' })
  choice: VoteChoice | 'secreta';

  /** Comprovante exibido ao vereador (prefixo do chainHash). */
  @Column({ unique: true })
  hash: string;

  /** Ordem do voto dentro do item (1, 2, 3...). */
  @Column({ type: 'int', nullable: true })
  seq: number | null;

  @Column({ nullable: true })
  prevHash: string | null;

  /** sha256(prevHash + dados do voto): alterar/remover um voto quebra a cadeia do item. */
  @Column({ nullable: true })
  chainHash: string | null;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  deviceInfo: string;

  @CreateDateColumn()
  createdAt: Date;
}
