import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /** sha256 do refresh token — o valor em si só existe no cliente. */
  @Column({ unique: true })
  token: string;

  /** Login do app: id de sessão single-device (users.mobileDeviceId) e tablet usado. */
  @Column({ nullable: true })
  mobileDevice: string | null;

  @Column({ nullable: true })
  deviceId: string | null;

  @Column()
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
