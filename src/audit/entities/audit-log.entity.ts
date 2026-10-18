import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  chamberId: string;

  @Column({ nullable: true })
  sessionId: string;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  action: string;

  @Column({ nullable: true })
  targetType: string;

  @Column({ nullable: true })
  targetId: string;

  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, any>;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  deviceInfo: string;

  @Column({ unique: true })
  hash: string;

  @Column({ nullable: true })
  previousHash: string;

  /** Posição na cadeia da câmara (1, 2, 3...). */
  @Column({ type: 'int', nullable: true })
  seq: number | null;

  /** Instante em ms usado no hash (createdAt do banco pode perder precisão/fuso). */
  @Column({ type: 'bigint', nullable: true })
  ts: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
