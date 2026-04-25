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

  @Column({ type: 'varchar' })
  choice: VoteChoice;

  @Column({ unique: true })
  hash: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  deviceInfo: string;

  @CreateDateColumn()
  createdAt: Date;
}
