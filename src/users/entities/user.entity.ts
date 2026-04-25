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

export type UserRole = 'superadmin' | 'presidente' | 'vereador' | 'secretaria';

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
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }
}
