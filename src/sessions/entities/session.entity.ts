import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany,
  JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { Chamber } from '../../chambers/entities/chamber.entity';
import { User } from '../../users/entities/user.entity';

export type SessionStatus = 'agendada' | 'em_andamento' | 'encerrada';
export type SessionType = 'ordinaria' | 'extraordinaria' | 'solene' | 'especial';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  chamberId: string;

  @ManyToOne(() => Chamber, { eager: false })
  @JoinColumn({ name: 'chamberId' })
  chamber: Chamber;

  @Column()
  number: number;

  @Column({ type: 'varchar', default: 'ordinaria' })
  type: SessionType;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  scheduledAt: Date;

  @Column({ nullable: true })
  startedAt: Date;

  @Column({ nullable: true })
  endedAt: Date;

  @Column({ type: 'varchar', default: 'agendada' })
  status: SessionStatus;

  @Column({ nullable: true })
  youtubeUrl: string;

  @Column({ nullable: true })
  youtubeThumbnailUrl: string;

  @Column({ nullable: true })
  createdById: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
