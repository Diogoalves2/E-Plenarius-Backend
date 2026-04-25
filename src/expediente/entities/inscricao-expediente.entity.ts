import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Session } from '../../sessions/entities/session.entity';
import { User } from '../../users/entities/user.entity';

export type TipoExpediente = 'grande' | 'pequeno';
export type StatusInscricao = 'aguardando' | 'em_andamento' | 'concluido' | 'cancelado';

@Entity('inscricoes_expediente')
export class InscricaoExpediente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column({ nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true } as any)
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({ nullable: true, type: 'varchar' })
  guestName: string | null;

  @Column({ nullable: true, type: 'varchar' })
  guestCargo: string | null;

  @Column({ nullable: true, type: 'int' })
  guestTempo: number | null;

  @Column({ type: 'varchar' })
  tipo: TipoExpediente;

  @Column({ type: 'varchar', default: 'aguardando' })
  status: StatusInscricao;

  @CreateDateColumn()
  createdAt: Date;
}
