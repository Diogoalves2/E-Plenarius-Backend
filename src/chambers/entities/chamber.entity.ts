import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
