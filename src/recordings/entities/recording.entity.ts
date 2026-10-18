import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type RecordingStatus = 'enviando' | 'na_fila' | 'processando' | 'transcrito' | 'aprovado' | 'erro';

/** Gravação de áudio de uma sessão (mesa de som) e o estado da degravação. */
@Entity('session_recordings')
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  sessionId: string;

  @Column()
  chamberId: string;

  @Column()
  fileName: string;

  @Column({ type: 'bigint' })
  sizeBytes: string;

  @Column({ type: 'int' })
  partsTotal: number;

  @Column({ type: 'int', default: 0 })
  partsReceived: number;

  /** Momento em que a gravação começou (alinha o áudio com a linha do tempo da sessão). */
  @Column({ type: 'timestamptz', nullable: true })
  recordedStartAt: Date | null;

  @Column({ type: 'varchar', default: 'enviando' })
  status: RecordingStatus;

  /** 0–100 durante o processamento. */
  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Áudio de trabalho (MP3 mono) para o player da revisão. */
  @Column({ nullable: true })
  audioUrl: string | null;

  @Column({ type: 'float', nullable: true })
  durationSec: number | null;

  @Column({ nullable: true })
  model: string | null;

  @Column({ nullable: true })
  createdById: string | null;

  @Column({ nullable: true })
  approvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  /** SHA-256 da degravação aprovada (texto final + tempos + oradores). */
  @Column({ nullable: true })
  transcriptHash: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
