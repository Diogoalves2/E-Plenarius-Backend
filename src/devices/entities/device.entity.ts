import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DeviceStatus = 'pendente' | 'aprovado' | 'revogado';

/** Tablet autorizado a usar o app mobile numa câmara. */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  chamberId: string;

  /** sha256 da chave secreta gerada no tablet (a chave em si nunca é guardada). */
  @Column({ unique: true, select: false })
  keyHash: string;

  /** Código curto exibido no tablet e no painel para o presidente identificar o aparelho. */
  @Column({ length: 8 })
  code: string;

  /** Nome reportado pelo app (modelo do aparelho). */
  @Column({ nullable: true })
  name: string | null;

  /** Apelido dado pelo presidente (ex.: "Tablet 3 — bancada esquerda"). */
  @Column({ nullable: true })
  label: string | null;

  @Column({ type: 'varchar', default: 'pendente' })
  status: DeviceStatus;

  @Column({ nullable: true })
  lastUserId: string | null;

  @Column({ nullable: true })
  approvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
