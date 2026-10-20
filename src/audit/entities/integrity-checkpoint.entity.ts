import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Cabeça da cadeia de auditoria selada com HMAC no momento em que o selo foi ativado.
 * Como cada registro aponta para o anterior, selar a cabeça protege todo o histórico
 * gravado antes do selo por linha existir. Tabela somente-inserção.
 */
@Entity('integrity_checkpoints')
@Index(['chamberId', 'chain', 'seq'], { unique: true })
export class IntegrityCheckpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  chamberId: string;

  @Column({ type: 'varchar', length: 20 })
  chain: 'audit';

  @Column({ type: 'int' })
  seq: number;

  @Column()
  headHash: string;

  @Column()
  seal: string;

  @CreateDateColumn()
  createdAt: Date;
}
