import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Chamber } from '../../chambers/entities/chamber.entity';

export type UserRole = 'superadmin' | 'presidente' | 'vice_presidente' | 'vereador' | 'secretaria';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  chamberId: string | null;

  @ManyToOne(() => Chamber, { eager: false })
  @JoinColumn({ name: 'chamberId' })
  chamber: Chamber;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true, unique: true })
  username: string | null;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar', default: 'vereador' })
  role: UserRole;

  @Column({ nullable: true })
  title: string;

  @Column({ nullable: true })
  party: string;

  @Column({ nullable: true, length: 4 })
  initials: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  lastLoginAt: Date | null;

  @Column({ select: false, nullable: true })
  pinHash: string | null;

  @Column({ nullable: true })
  mobileDeviceId: string | null;

  @Column({ nullable: true, type: 'int' })
  audioChannel: number | null;

  // ── Verificação em duas etapas (TOTP) ──
  /** Segredo TOTP cifrado (AES-GCM, chave fora do banco). */
  @Column({ type: 'varchar', select: false, nullable: true })
  mfaSecret: string | null;

  /** Segredo gerado no cadastro, ainda não confirmado com um código. */
  @Column({ type: 'varchar', select: false, nullable: true })
  mfaPendingSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaEnabledAt: Date | null;

  /** Último passo TOTP aceito: o mesmo código não é aceito duas vezes. */
  @Column({ type: 'int', select: false, nullable: true })
  mfaLastStep: number | null;

  /** sha256 dos códigos de recuperação ainda não usados. */
  @Column({ type: 'jsonb', select: false, nullable: true })
  mfaRecoveryCodes: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.passwordHash && !this.passwordHash.startsWith('$2')) {
      this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
    }
    if (this.pinHash && !this.pinHash.startsWith('$2')) {
      this.pinHash = await bcrypt.hash(this.pinHash, 12);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }

  async validatePin(pin: string): Promise<boolean> {
    if (!this.pinHash) return false;
    return bcrypt.compare(pin, this.pinHash);
  }
}
